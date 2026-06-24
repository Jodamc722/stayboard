import './globals.css'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { BrainChat } from '@/components/BrainChat'

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter',
  display: 'swap'
})

export const metadata: Metadata = {
  title: 'STAYBOARD',
  description: 'Stay Hospitality operations dashboard',
  manifest: '/manifest.json'
}
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: '#0f172a'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-app text-ink antialiased font-sans">
        {children}
        <BrainChat />
      </body>
    </html>
  )
}
