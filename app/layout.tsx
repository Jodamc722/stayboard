import './globals.css'
import type { Metadata, Viewport } from 'next'
// FONTS BY <link>, NOT next/font (2026-11-03). next/font downloads Google's CSS at BUILD time, and
// when that response changes shape the whole deploy fails ("next/font … Cannot read properties of
// null") — two production builds died on it today with nothing wrong in the code. The browser
// fetches the same faces at run time instead; the CSS variables keep their names, so nothing that
// reads var(--font-inter) / var(--font-serif) changes. Fraunces is still only downloaded by the
// pages that render it.
const FONT_VARS = ":root{--font-inter:'Inter';--font-serif:'Fraunces'}"

export const metadata: Metadata = {
  title: 'LIGHTHOUSE — Stay Hospitality',
  description: 'Every property, watched. The Stay Hospitality operating system.',
  manifest: '/manifest.json',
  // THE MARK EVERYWHERE (Jon, 2026-10-07: "make sure that the Lighthouse logo is updated across all
  // parts of our platform, from the login to when you save it to your phone"). One icon set, drawn
  // from components/ui/LighthouseMark: the ink tile, the paper tower and beams, the brass lamp.
  // ?v=2 so browsers and phones drop the old blue icon they cached.
  icons: {
    icon: [
      { url: '/favicon.svg?v=2', type: 'image/svg+xml' },
      { url: '/favicon-32.png?v=2', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png?v=2', sizes: '192x192', type: 'image/png' },
    ],
    shortcut: '/favicon.ico?v=2',
    apple: { url: '/icon-180.png?v=2', sizes: '180x180' },
  },
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
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Lighthouse theme faces. Geist is not in this Next version's font list, so both come from
            Google Fonts; Legacy never uses them and the browser only fetches a face it renders. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Instrument+Serif&display=swap" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Fraunces:wght@300;400;500&display=swap" />
        <style dangerouslySetInnerHTML={{ __html: FONT_VARS }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="bg-app text-ink antialiased font-sans">
        {children}
      </body>
    </html>
  )
}
