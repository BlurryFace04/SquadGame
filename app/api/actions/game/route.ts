import { NextRequest } from 'next/server'
import { ActionGetResponse, ActionPostRequest, ActionPostResponse, ActionError, ACTIONS_CORS_HEADERS, createPostResponse, MEMO_PROGRAM_ID } from "@solana/actions"
import { Transaction, TransactionInstruction, PublicKey, ComputeBudgetProgram, Connection, clusterApiUrl, SystemProgram, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js"
import { GoogleAuth, IdTokenClient } from 'google-auth-library'
import { connectToDB } from '@/utils/database'
import Player from '@/models/player'
import Tx from '@/models/tx'

const ACTION_URL = "https://squadgames.sendarcade.fun/api/actions/game"

const ADDRESS = new PublicKey('6W1c1XSBGMigN51LhD8A7ScA2dJiVVRksRr6ut9LJpUS')

async function getIdentityToken(targetAudience: any) {
  const auth = new GoogleAuth()
  const client = await auth.getIdTokenClient(targetAudience)
  const idTokenClient = client

  const tokenResponse = await idTokenClient.getRequestHeaders()
  const identityToken = tokenResponse.Authorization?.split(' ')[1]

  if (!identityToken) {
    throw new Error('Failed to retrieve identity token.')
  }

  return identityToken
}

export const GET = async (req: Request) => {

  const payload: ActionGetResponse = {
    icon: "https://blue-magnetic-wallaby-228.mypinata.cloud/ipfs/QmRuTdnBUgCDLcskZu5MZ8HMhrzw5n6nvV4L2mkboVeng5",
    label: "Pay 0.69 SOL",
    title: "Suqad Game",
    description: "Enter the game, but trust no one—where alliances shatter, and only the cunning survive. The Squad Protocol decides your fate.",
    disabled: false,
    links: {
      actions: [
        {
          href: `${ACTION_URL}?x={x}`,
          label: "Pay 0.69 SOL",
          parameters: [
            {
              name: "x",
              label: "X username",
              required: true
            }
          ]
        }
      ]
    }
  }

  return Response.json(payload, {
    headers: ACTIONS_CORS_HEADERS
  })
}

export const OPTIONS = GET

export const POST = async (req: NextRequest) => {
  await connectToDB()

  try {
    const body: ActionPostRequest = await req.json()

    let account: PublicKey

    try { 
      account = new PublicKey(body.account)
    } catch (err) {
      return new Response('Invalid account provided', {
        status: 400,
        headers: ACTIONS_CORS_HEADERS
      })
    }

    console.log("Address:", account.toBase58())

    const x = req.nextUrl.searchParams.get('x')
    console.log("X Username:", x)

    if (!x) {
      return new Response('Missing required parameters', {
        status: 400,
        headers: ACTIONS_CORS_HEADERS
      })
    }

    const existingTx = await Tx.findOne({ address: account.toBase58(), game: 1 })
    if (existingTx) {
      return new Response(JSON.stringify({ message: "You are already in the game!" }), {
        status: 403,
        headers: {
          ...ACTIONS_CORS_HEADERS,
          'Content-Type': 'application/json'
        }
      })
    }

    if (x !== "{x}") {
      const player = new Player({
        address: account.toBase58(),
        x,
        game: 1,
        round: 0
      })

      await player.save()
    }

    // const connection = new Connection(clusterApiUrl("mainnet-beta"))
    // const connection = new Connection(`https://solana-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`)
    const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`)

    const transaction = new Transaction()

    transaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 1000
      }),
      SystemProgram.transfer({
        fromPubkey: account,
        toPubkey: ADDRESS,
        lamports: 690_000_000
        // lamports: 0.001 * LAMPORTS_PER_SOL
      }),
      new TransactionInstruction({
        programId: new PublicKey(MEMO_PROGRAM_ID),
        data: Buffer.from(`SquadGames_1_${x}`, "utf-8"),
        keys: []
      })
    )

    transaction.feePayer = account
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash

    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        transaction,
        message: `Welcome to the game—your life depends on every move. Do not let it be your last.`,
      },
    })

    return Response.json(payload, { headers: ACTIONS_CORS_HEADERS })
  } catch (err) {
    console.error(err)
    return Response.json("An unknown error occured", { status: 500 })
  }
}
