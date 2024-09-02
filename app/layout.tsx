'use client'

import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {

  // Default metadata values
  let title = "Squad Game"
  let description = "Enter the game, but trust no one—where alliances shatter, and only the cunning survive. The Squad Protocol decides your fate."
  let url = `https://squadgames.sendarcade.fun/`
  let imageUrl = "https://squadgames.sendarcade.fun/og.png"

  return (
    <html lang="en">
      <head>
        <title>{title}</title>
        <meta name="description" content={description} />

        {/* Facebook Meta Tags */}
        <meta property="og:url" content={url} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={imageUrl} />

        {/* Twitter Meta Tags */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta property="twitter:domain" content="squadgames.sendarcade.fun" />
        <meta property="twitter:url" content={url} />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={imageUrl} />
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  )
}
