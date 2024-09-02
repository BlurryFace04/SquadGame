import {
  Connection,
  Keypair,
  VersionedTransaction,
  ComputeBudgetProgram,
  TransactionInstruction,
  TransactionMessage,
  AddressLookupTableAccount,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL
} from '@solana/web3.js'
import { NATIVE_MINT, createSyncNativeInstruction, getOrCreateAssociatedTokenAccount } from "@solana/spl-token"
import fetch from 'cross-fetch'
import { Wallet } from '@project-serum/anchor'
import bs58 from 'bs58'
import { sendEmail } from './mail.js'
import { SecretManagerServiceClient } from '@google-cloud/secret-manager'
import dotenv from 'dotenv'
dotenv.config()

const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`, 'confirmed')

async function getTokenBalance(pubkey, tokenMint) {
  const response = await connection.getParsedTokenAccountsByOwner(pubkey, { mint: tokenMint })
  const tokenAccount = response.value[0]?.account.data.parsed.info.tokenAmount.uiAmount || 0
  return tokenAccount
}

export async function performSwap(amountInSol) {
  console.log("Starting Swap...")

  const outputMint = new PublicKey('SENDdRQtYMWaQrBroBrJ2Q53fgVuq95CV9UPGEvpCxa')

  const client = new SecretManagerServiceClient()
  const [response] = await client.accessSecretVersion({ name: `` })
  const private_key = response.payload.data.toString('utf8')

  const senderKeypair = Keypair.fromSecretKey(bs58.decode(private_key))
  const wallet = new Wallet(senderKeypair)

  let attempts = 0
  const maxRetries = 3
  let txid

  while (attempts < maxRetries) {
    try {
      attempts++

      // Convert SOL amount to lamports
      const amountInLamports = Math.floor(amountInSol * LAMPORTS_PER_SOL)
      console.log(`Amount in lamports: ${amountInLamports}`)

      // Initial balance
      const initialBalance = await getTokenBalance(wallet.publicKey, outputMint) * 1_000_000
      console.log(`Initial balance: ${initialBalance}`)

      let associatedTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        wallet,
        NATIVE_MINT,
        wallet.publicKey
      )

      // Fetch quote
      const quoteResponse = await (
        await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112\
&outputMint=SENDdRQtYMWaQrBroBrJ2Q53fgVuq95CV9UPGEvpCxa\
&amount=${amountInLamports}\
&slippageBps=300`)
      ).json()

      console.log({ quoteResponse })

      const outAmount = quoteResponse.outAmount
      const otherAmountThreshold = quoteResponse.otherAmountThreshold

      // Get serialized transactions for the swap
      const instructions = await (
        await fetch('https://quote-api.jup.ag/v6/swap-instructions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            quoteResponse,
            userPublicKey: wallet.publicKey.toString(),
            dynamicComputeUnitLimit: true,
            // prioritizationFeeLamports: 'auto',
            // wrapAndUnwrapSol: true,
          })
        })
      ).json()

      if (instructions.error) {
        throw new Error("Failed to get swap instructions: " + instructions.error)
      }

      const {
        tokenLedgerInstruction, // If you are using `useTokenLedger = true`.
        computeBudgetInstructions, // The necessary instructions to setup the compute budget.
        setupInstructions, // Setup missing ATA for the users.
        swapInstruction: swapInstructionPayload, // The actual swap instruction.
        cleanupInstruction, // Unwrap the SOL if `wrapAndUnwrapSol = true`.
        addressLookupTableAddresses, // The lookup table addresses that you can use if you are using versioned transaction.
      } = instructions
      
      const deserializeInstruction = (instruction) => {
        return new TransactionInstruction({
          programId: new PublicKey(instruction.programId),
          keys: instruction.accounts.map((key) => ({
            pubkey: new PublicKey(key.pubkey),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
          })),
          data: Buffer.from(instruction.data, "base64"),
        })
      }
      
      const getAddressLookupTableAccounts = async (
        keys
      ) => {
        const addressLookupTableAccountInfos =
          await connection.getMultipleAccountsInfo(
            keys.map((key) => new PublicKey(key))
          )
      
        return addressLookupTableAccountInfos.reduce((acc, accountInfo, index) => {
          const addressLookupTableAddress = keys[index]
          if (accountInfo) {
            const addressLookupTableAccount = new AddressLookupTableAccount({
              key: new PublicKey(addressLookupTableAddress),
              state: AddressLookupTableAccount.deserialize(accountInfo.data),
            })
            acc.push(addressLookupTableAccount)
          }
      
          return acc
        }, [])
      }
      
      const addressLookupTableAccounts = []

      addressLookupTableAccounts.push(
        ...(await getAddressLookupTableAccounts(addressLookupTableAddresses))
      )

      // Get the latest block hash
      const blockhash = (await connection.getLatestBlockhash()).blockhash

      const messageV0 = new TransactionMessage({
        payerKey: wallet.payer.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({
            units: 400_000,
          }),
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: 1_000_000 * 1,
          }),
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: associatedTokenAccount.address,
            lamports: amountInLamports,
          }),
          createSyncNativeInstruction(associatedTokenAccount.address),
          // uncomment if needed: ...setupInstructions.map(deserializeInstruction),
          // ...setupInstructions.map(deserializeInstruction),
          deserializeInstruction(swapInstructionPayload),
          // uncomment if needed: deserializeInstruction(cleanupInstruction),
          // deserializeInstruction(cleanupInstruction)
        ],
      }).compileToV0Message(addressLookupTableAccounts)
      const transaction = new VersionedTransaction(messageV0)

      // Re-sign the transaction with the new blockhash
      transaction.sign([wallet.payer])

      // get the latest block hash
      const latestBlockHash = await connection.getLatestBlockhash()

      // Execute the transaction
      console.log('Sending transaction...')
      const rawTransaction = transaction.serialize()
      txid = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 2
      })

      // Confirm the transaction
      console.log(`Confirming transaction ${txid}...`)
      await connection.confirmTransaction({
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
        signature: txid
      })

      console.log(`Transaction successful: https://solscan.io/tx/${txid}`)

      // Final balance
      const finalBalance = await getTokenBalance(wallet.publicKey, outputMint) * 1_000_000
      console.log(`Final balance: ${finalBalance}`)

      const sendReceived = finalBalance - initialBalance
      console.log(`Amount received from swap: ${sendReceived}`)

      if (sendReceived === 0) {
        console.error(`Amount received is 0. Transaction may have failed.`)
        throw new Error(`Amount received is 0. Transaction may have failed.`)
      }

      if (sendReceived < otherAmountThreshold || sendReceived > outAmount * 1.05) {
        console.error(`Amount received ${sendReceived} is out of expected range [${otherAmountThreshold}, ${outAmount}]`)
        return { sendReceived, failed: true }
      }

      return { sendReceived, failed: false }
    } catch (error) {
      console.error(`Attempt ${attempts} failed:`, error)
      if (attempts >= maxRetries) {
        console.error('Max retries reached. Transaction failed.')
        return { sendReceived: 0, failed: true }
      } else {
        console.error('Retrying...')
      }
    }
  }
}
