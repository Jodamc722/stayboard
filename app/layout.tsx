import './globals.css'
import type { Metadata, Viewport } from 'next'
import { Inter, Fraunces } from 'next/font/google'

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter',
  display: 'swap'
})

// THE DECK SERIF (2026-09-22). Owner-facing documents set their titles and their figures in a
// display serif — it is the single cheapest thing that separates a report an owner keeps from a
// dashboard screenshot. Loaded as a variable so only the deck reaches for it; the app itself
// stays on Inter. NOT PRELOADED (2026-09-28 audit): next/font preloads by default, so every page
// of the app downloaded three serif weights only the decks and reports use. It still loads — on
// the pages that set a Fraunces face.
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-serif',
  display: 'swap',
  preload: false,
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
  themeColor: '#15161a',
  // The on-screen keyboard SHRINKS the layout instead of sliding it up behind itself. Without this
  // the Eve composer and every filter box scrolled under the keyboard the moment you typed.
  interactiveWidget: 'resizes-content',
}

// NOTE (2026-08-21): <BrainChat /> used to render here, on top of everything, on every page.
// It was Eve v1 — no memory, no tool domains, no thumbs, a fresh thread on every navigation — and
// it sat at z-50 directly over EveFloat (Eve v2, z-40, rendered inside Shell). Every "Ask Eve" tap
// in the app was landing on the OLD assistant, and on a phone its bottom-5/right-5 anchor parked it
// squarely on top of the mobile bottom nav bar. Deleted; Shell renders the real one.
// THEME BEFORE FIRST PAINT (2026-10-02). The saved theme lives in app_users.prefs and takes a
// round-trip to read, so the device keeps a copy in localStorage and this inline script applies it
// before anything renders — no flash of the other theme. Shell reconciles with the saved copy once
// /api/access/prefs answers. Only the two known values are ever applied.
const THEME_BOOT = "try{var t=localStorage.getItem('lh:theme');if(t==='legacy')document.documentElement.setAttribute('data-theme','legacy')}catch(e){}"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable + ' ' + fraunces.variable} suppressHydrationWarning>
      <head>
        {/* Lighthouse theme faces. Geist is not in this Next version's font list, so both come from
            Google Fonts; Legacy never uses them and the browser only fetches a face it renders. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Instrument+Serif&display=swap" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="bg-app text-ink antialiased font-sans">
        {children}
      </body>
    </html>
  )
}
