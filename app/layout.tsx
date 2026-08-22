import './globals.css'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter',
  display: 'swap'
})

export const metadata: Metadata = {
  title: 'LIGHTHOUSE — Stay Hospitality',
  description: 'Every property, watched. The Stay Hospitality operating system.',
  manifest: '/manifest.json',
  icons: { icon: '/icon-192.png', apple: '/icon-180.png' },
  // Added to the home screen, Lighthouse opens as an app rather than a Safari tab: no URL bar
  // eating 60px of a 667px screen, and the bottom nav bar sits where a native tab bar would.
  appleWebApp: { capable: true, title: 'Lighthouse', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
}
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: '#0f172a',
  // The on-screen keyboard SHRINKS the layout instead of sliding it up behind itself. Without this
  // the Eve composer and every filter box scrolled under the keyboard the moment you typed.
  interactiveWidget: 'resizes-content',
}

// NOTE (2026-08-21): <BrainChat /> used to render here, on top of everything, on every page.
// It was Eve v1 — no memory, no tool domains, no thumbs, a fresh thread on every navigation — and
// it sat at z-50 directly over EveFloat (Eve v2, z-40, rendered inside Shell). Every "Ask Eve" tap
// in the app was landing on the OLD assistant, and on a phone its bottom-5/right-5 anchor parked it
// squarely on top of the mobile bottom nav bar. Deleted; Shell renders the real one.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-app text-ink antialiased font-sans">
        {children}
      </body>
    </html>
  )
}
