// AD STUDIO (Jon, 2026-11-02): "a video editor for ads … prompt, have you write scripts, get
// previews … think Final Cut Pro but AI, built for custom ads." Lives in Lighthouse so it can use our
// photo library, listings and the house contact card. See components/AdStudio + lib/ad-engine.
import { redirect } from 'next/navigation'

import { Shell } from '@/components/Shell'
import AdStudio from '@/components/AdStudio'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'

export const dynamic = 'force-dynamic'

// The ad's own type, loaded here so the canvas can draw with it (the app's UI fonts stay as they are).
// Faces by <link> at run time, not next/font at build time (see app/layout.tsx, 2026-11-03).
const face = (family: string, fallback: string) => ({ className: '', style: { fontFamily: "'" + family + "', " + fallback } })
const display = face('Bricolage Grotesque', 'sans-serif')
const condensed = face('Anton', 'sans-serif')
const elegant = face('Cormorant Garamond', 'serif')
const serif = face('Fraunces', 'serif')
const body = face('Instrument Sans', 'sans-serif')
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;700;800&family=Anton&family=Cormorant+Garamond:wght@600;700&family=Fraunces:wght@500;700;800&family=Instrument+Sans:wght@400;500;600;700&display=swap'

export default async function AdsPage({ searchParams }: { searchParams?: { full?: string } }) {
  const a = await getAccess()
  if (!a.user) redirect('/login')
  const lv = a.levels['ads']
  if (!atLeast(lv, 'view')) redirect(a.landing || '/command')
  const fonts = (
    <>
      <link rel="stylesheet" href={FONTS_CSS} />
      {/* Touch both faces once so the browser loads them before the canvas asks for them. */}
      <span aria-hidden style={{ fontFamily: display.style.fontFamily, position: 'absolute', opacity: 0, pointerEvents: 'none', fontWeight: 800 }}>Aa</span>
      <span aria-hidden style={{ fontFamily: body.style.fontFamily, position: 'absolute', opacity: 0, pointerEvents: 'none' }}>Aa</span>
      <span aria-hidden style={{ fontFamily: serif.style.fontFamily, position: 'absolute', opacity: 0, pointerEvents: 'none', fontWeight: 700 }}>Aa</span>
      <span aria-hidden style={{ fontFamily: condensed.style.fontFamily, position: 'absolute', opacity: 0, pointerEvents: 'none' }}>Aa</span>
      <span aria-hidden style={{ fontFamily: elegant.style.fontFamily, position: 'absolute', opacity: 0, pointerEvents: 'none', fontWeight: 700 }}>Aa</span>
    </>
  )
  // Full screen (Jon, 2026-11-02: "option to open in new tab full screen"): the editor alone, edge to edge.
  if (searchParams?.full === '1') {
    return (
      <div style={{ minHeight: '100vh', background: '#0E1116' }}>
        {fonts}
        <AdStudio full display={display.style.fontFamily} body={body.style.fontFamily} serif={serif.style.fontFamily} condensed={condensed.style.fontFamily} elegant={elegant.style.fontFamily} canEdit={atLeast(lv, 'edit')} canDelete={atLeast(lv, 'edit')} />
      </div>
    )
  }
  return (
    <Shell>
      {/* Top padding keeps the editor's top bar (voice + export buttons) clear of the floating Brief and bell buttons. */}
      <div style={{ padding: '56px 0 24px' }}>
        {fonts}
        <AdStudio display={display.style.fontFamily} body={body.style.fontFamily} serif={serif.style.fontFamily} condensed={condensed.style.fontFamily} elegant={elegant.style.fontFamily} canEdit={atLeast(lv, 'edit')} canDelete={atLeast(lv, 'edit')} />
      </div>
    </Shell>
  )
}
