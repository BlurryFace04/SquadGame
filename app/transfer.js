import Big from 'big.js'
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, ComputeBudgetProgram, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getAssociatedTokenAddress, createTransferInstruction, createAssociatedTokenAccountInstruction } from '@solana/spl-token'
import { Wallet } from '@project-serum/anchor'
import bs58 from 'bs58'
import { sendEmail } from './mail.js'
import { SecretManagerServiceClient } from '@google-cloud/secret-manager'
import dotenv from 'dotenv'
dotenv.config()

const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`, 'confirmed')

const sendcoinMintAddress = new PublicKey("SENDdRQtYMWaQrBroBrJ2Q53fgVuq95CV9UPGEvpCxa")

export async function transferSend(sendAmount, recipient) {
  console.log("Starting Transfer...")
  console.log(`Amount: ${sendAmount}`)
  console.log(`Recipient: ${recipient}`)

  const client = new SecretManagerServiceClient()
  const [response] = await client.accessSecretVersion({ name: `` })
  const private_key = response.payload.data.toString('utf8')

  const senderKeypair = Keypair.fromSecretKey(bs58.decode(private_key))
  const wallet = new Wallet(senderKeypair)

  let attempts = 0
  const maxRetries = 3

  while (attempts < maxRetries) {
    try {
      attempts++

      const transaction = new Transaction()

      transaction.add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: 1_000_000 // Adjust as needed
        })
      )

      // Fetch recent blockhash
      const { blockhash } = await connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
      transaction.feePayer = wallet.publicKey

      // Get the sender's associated token account for the mint
      const senderTokenAccount = await getAssociatedTokenAddress(
        sendcoinMintAddress,
        wallet.publicKey,
        false
      )

      const recipientPublicKey = new PublicKey(recipient)

      // Get the recipient's associated token account, allowing off-curve addresses (PDAs)
      const recipientTokenAccount = await getAssociatedTokenAddress(
        sendcoinMintAddress,
        recipientPublicKey,
        true // allowOwnerOffCurve must be true to allow using a PDA
      )

      const recipientTokenAccountInfo = await connection.getAccountInfo(recipientTokenAccount)
      if (!recipientTokenAccountInfo) {
        console.log(`The recipient's associated token account (${recipient}) doesn't exist. Creating one now...`)

        const createATAIx = createAssociatedTokenAccountInstruction(
          wallet.publicKey, // Payer
          recipientTokenAccount,
          recipientPublicKey,
          sendcoinMintAddress
        )
        transaction.add(createATAIx)
      }

      const transferTx = createTransferInstruction(
        senderTokenAccount,
        recipientTokenAccount,
        wallet.publicKey,
        BigInt(Math.round(sendAmount)),
        []
      )

      transaction.add(transferTx)

      // Sign the transaction with the sender's keypair
      transaction.sign(senderKeypair)

      const rawTransaction = transaction.serialize()
      const txid = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 2
      })
      await connection.confirmTransaction({
        blockhash,
        lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
        signature: txid
      })

      console.log(`https://solscan.io/tx/${txid}`)

      return { failed: false }

    } catch (error) {
      console.error(`Attempt ${attempts} failed:`, error)
      if (attempts >= maxRetries) {
        console.error('Max retries reached. Transaction failed.')
        return { failed: true }
      } else {
        console.error('Retrying...')
      }
    }
  }
}
