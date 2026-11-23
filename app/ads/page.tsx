// AD STUDIO (Jon, 2026-11-02): "a video editor for ads … prompt, have you write scripts, get
// previews … think Final Cut Pro but AI, built for custom ads." Lives in Lighthouse so it can use our
// photo library, listings and the house contact card. See components/AdStudio + lib/ad-engine.
// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely."):
// the page now mounts components/adx/AdStudioShell, which keeps the earlier studio as it was and sends the calendar's
// special-date pieces to the new engine (lib/adx).
import { redirect } from 'next/navigation'

import { Shell } from '@/components/Shell'
import AdStudioShell from '@/components/adx/AdStudioShell'
import { getAccess, isSuperadmin } from '@/lib/access'
import { getSetting } from '@/lib/app-settings'
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
  // The new engine is a pilot: on for Jon, off for everyone else until the `adx` setting says on.
  const newEngine = isSuperadmin(a.email) || !!(await getSetting<{ on?: boolean }>('adx', {}).catch(() => ({} as { on?: boolean }))).on
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
        <AdStudioShell full display={display.style.fontFamily} body={body.style.fontFamily} serif={serif.style.fontFamily} condensed={condensed.style.fontFamily} elegant={elegant.style.fontFamily} canEdit={atLeast(lv, 'edit')} canDelete={atLeast(lv, 'edit')} newEngine={newEngine} />
      </div>
    )
  }
  return (
    <Shell>
      {/* No top padding: the Brief and bell buttons have their own strip above the page since 2026-11-09, so the 56px that used to clear them was an empty band (2026-11-23 audit). */}
      <div style={{ padding: '0 0 24px' }}>
        {fonts}
        <AdStudioShell display={display.style.fontFamily} body={body.style.fontFamily} serif={serif.style.fontFamily} condensed={condensed.style.fontFamily} elegant={elegant.style.fontFamily} canEdit={atLeast(lv, 'edit')} canDelete={atLeast(lv, 'edit')} newEngine={newEngine} />
      </div>
    </Shell>
  )
}
