import { NextRequest } from 'next/server'
import bs58 from 'bs58'
import { connectToDB } from '@/utils/database'
import Tx from '@/models/tx'
import { LAMPORTS_PER_SOL } from "@solana/web3.js"

export const POST = async (req: NextRequest) => {
  await connectToDB()

  try {
    const webhookData = await req.json()

    console.log('Received Solana Webhook:')
    const transactions = webhookData.map(async (transaction: any) => {
      console.log('--- Transaction ---')
      console.log(transaction)
      console.log('Signature:', transaction.signature)
      console.log('Type:', transaction.type)
      console.log('Description:', transaction.description)

      let memo = ''
      const regex = /^SquadGames_(\d+)_(.+)$/

      // Process instructions to extract memo
      if (transaction.instructions.length > 0) {
        console.log('Instructions:')
        for (const instruction of transaction.instructions) {
          console.log(instruction)
          if (instruction.programId === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') { 
            const encodedMemo = instruction.data
            try {
              // Decode Base58
              const memoBuffer = bs58.decode(encodedMemo)
              console.log('Memo buffer:', memoBuffer)

              // Convert to UTF-8 String
              memo = new TextDecoder().decode(memoBuffer) 
              console.log('Memo decoded:', memo) 
            } catch (error) {
              console.error('Error decoding memo:', error) // Handle decoding errors
            }
          }
        }
      }

      // Validate memo with regex
      if (!regex.test(memo)) {
        console.log('Invalid memo format in !regex.test(memo). Transaction will not be saved.')
        return
      }

      // Extract address and betAmount from nativeTransfers
      if (transaction.nativeTransfers.length > 0) {
        const address = transaction.nativeTransfers[0].fromUserAccount
        const amount = transaction.nativeTransfers[0].amount / LAMPORTS_PER_SOL

        const match = memo.match(regex)
        console.log('Match:', match)

        if (!match) {
          console.log('Invalid memo format in  memo.match(regex). Transaction will not be saved.')
          return
        }
        
        const game = match[1]
        const x = match[2]

        // Create a new transaction document
        const newTx = new Tx({
          address,
          game,
          amount,
          x,
          signature: transaction.signature,
          description: transaction.description,
          webhookTimestamp: transaction.timestamp
        })

        // Save the transaction document
        try {
          await newTx.save()
          console.log('Transaction saved successfully:', newTx)
        } catch (error) {
          console.error('Error saving transaction:', error)
        }
      } else {
        console.log('No sol transfers found. Transaction will not be saved.')
      }
    })

    // Wait for all transactions to be processed
    await Promise.all(transactions)

    return new Response('OK', { status: 200 })

  } catch (error) {
    console.error(error)
    return new Response('Internal Server Error', { status: 500 })
  }
}
