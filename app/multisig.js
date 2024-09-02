import * as multisig from '@squads-protocol/multisig'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  PublicKey
} from '@solana/web3.js'
import Big from 'big.js'
import mongoose from 'mongoose'
import { Player, Multisig, Tx } from './models.js'
import { performSwap } from './swap.js'
import { transferSend } from './transfer.js'
import { sendEmail } from './mail.js'
import bs58 from 'bs58'
import dotenv from 'dotenv'
dotenv.config()

const uri = process.env.MONGODB_URI

mongoose.connect(uri, { dbName: 'SquadGames' })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Error connecting to MongoDB:', err))

export const createMultisig = async (req, res) => {
  console.log("Received a request for creating a multisig")

  // Set CORS headers for preflight and main requests
  res.set('Access-Control-Allow-Origin', '*') // You can replace '*' with your Vercel domain for more security
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).send()
  }

  try {
    const { game } = req.body
    console.log("Request body:", req.body)

    if (!game) {
      console.error("Missing game field in request body")
      return res.status(400).send('Bad Request: Missing required fields')
    }

    const players = await Tx.find({ game }).select('address')

    const threshold = Math.floor((players.length + 2) / 2)

    const { Permission, Permissions } = multisig.types

    const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`, 'confirmed')

    const createKey = Keypair.generate()
    console.log("✨ Create Key:", createKey.publicKey.toBase58())

    // Derive the multisig account PDA
    const [multisigPda] = multisig.getMultisigPda({
      createKey: createKey.publicKey,
    })

    console.log("✨ Multisig PDA:", multisigPda.toBase58())

    const [vaultPda] = multisig.getVaultPda({
      multisigPda,
      index: 0,
    })

    console.log("✨ Vault PDA:", vaultPda.toBase58())

    const private_key = process.env.PRIVATE_KEY
    const creator = Keypair.fromSecretKey(bs58.decode(private_key))

    const programConfigPda = multisig.getProgramConfigPda({})[0]

    console.log("✨ Program Config PDA:", programConfigPda.toBase58())

    const programConfig =
      await multisig.accounts.ProgramConfig.fromAccountAddress(
        connection,
        programConfigPda
      )

    const configTreasury = programConfig.treasury
    console.log("✨ Config Treasury:", configTreasury.toBase58())

    const transaction = new Transaction()

    const { blockhash } = await connection.getLatestBlockhash()
    transaction.recentBlockhash = blockhash
    transaction.feePayer = creator.publicKey

    const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 100_000
    })

    transaction.add(priorityFeeIx)

    // Create the multisig
    console.log("✨ Creating Squad...")

    // Map players to members array
    const members = players.map(player => ({
      key: new PublicKey(player.address),
      permissions: Permissions.fromPermissions([Permission.Vote])
    }))

    // Add the creator as a member with all permissions
    members.unshift({
      key: creator.publicKey,
      permissions: Permissions.all()
    })

    const multisigCreateV2Instruction = multisig.instructions.multisigCreateV2({
      // One time random Key
      createKey: createKey.publicKey,
      // The creator & fee payer
      creator: creator.publicKey,
      multisigPda,
      configAuthority: creator.publicKey,
      timeLock: 0,
      members,
      threshold,
      rentCollector: creator.publicKey,
      treasury: configTreasury,
    })

    transaction.add(multisigCreateV2Instruction)

    transaction.sign(creator, createKey)

    const rawTransaction = transaction.serialize()
    const signature = await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: true,
      maxRetries: 2
    })

    await connection.confirmTransaction({
      blockhash,
      lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
      signature
    })

    console.log(`https://solscan.io/tx/${signature}`)

    console.log("✅ Squad Created:", signature)

    const newMultisig = new Multisig({
      game,
      creator: creator.publicKey.toBase58(),
      createKey: createKey.publicKey.toBase58(),
      multisigPda: multisigPda.toBase58(),
      vaultPda: vaultPda.toBase58(),
      programConfigPda: programConfigPda.toBase58(),
      configTreasury: configTreasury.toBase58(),
      signature
    })
    await newMultisig.save()

    const transactions = await Tx.find({ game })

    let totalAmountInSOL = transactions.reduce((sum, tx) => sum + tx.amount, 0)
    totalAmountInSOL = parseFloat(totalAmountInSOL.toFixed(9))

    console.log(`Total Amount in SOL for Game ${game}: ${totalAmountInSOL} SOL`)

    const swapResult = await performSwap(totalAmountInSOL)

    if (swapResult.failed) {
      console.error("Swap failed")
      return res.status(500).send('Internal Server Error')
    }

    const sendAmount = swapResult.sendReceived
    console.log(`Amount to send: ${sendAmount} SEND`)

    const sendResult = await transferSend(sendAmount, vaultPda.toBase58())

    if (sendResult.failed) {
      console.error("Send failed")
      return res.status(500).send('Internal Server Error')
    }

    return res.status(200).json({
      vaultPda: vaultPda.toBase58(),
      sendAmount
    })

  } catch (error) {
    console.error('error:', error)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
}
