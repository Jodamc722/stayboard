// AD STUDIO (Jon, 2026-11-02): "a video editor for ads … prompt, have you write scripts, get
// previews … think Final Cut Pro but AI, built for custom ads." Lives in Lighthouse so it can use our
// photo library, listings and the house contact card. See components/AdStudio + lib/ad-engine.
import { redirect } from 'next/navigation'
import { Bricolage_Grotesque, Instrument_Sans, Fraunces } from 'next/font/google'
import { Shell } from '@/components/Shell'
import AdStudio from '@/components/AdStudio'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'

export const dynamic = 'force-dynamic'

// The ad's own type, loaded here so the canvas can draw with it (the app's UI fonts stay as they are).
const display = Bricolage_Grotesque({ subsets: ['latin'], weight: ['500', '700', '800'], display: 'swap' })
const serif = Fraunces({ subsets: ['latin'], weight: ['500', '700', '800'], display: 'swap' })
const body = Instrument_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap' })

export default async function AdsPage({ searchParams }: { searchParams?: { full?: string } }) {
  const a = await getAccess()
  if (!a.user) redirect('/login')
  const lv = a.levels['ads']
  if (!atLeast(lv, 'view')) redirect(a.landing || '/command')
  const fonts = (
    <>
      {/* Touch both faces once so the browser loads them before the canvas asks for them. */}
      <span aria-hidden className={display.className} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', fontWeight: 800 }}>Aa</span>
      <span aria-hidden className={body.className} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}>Aa</span>
      <span aria-hidden className={serif.className} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', fontWeight: 700 }}>Aa</span>
    </>
  )
  // Full screen (Jon, 2026-11-02: "option to open in new tab full screen"): the editor alone, edge to edge.
  if (searchParams?.full === '1') {
    return (
      <div style={{ minHeight: '100vh', background: '#0E1116' }}>
        {fonts}
        <AdStudio full display={display.style.fontFamily} body={body.style.fontFamily} serif={serif.style.fontFamily} canEdit={atLeast(lv, 'edit')} canDelete={atLeast(lv, 'full')} />
      </div>
    )
  }
  return (
    <Shell>
      {/* Top padding keeps the editor's top bar (voice + export buttons) clear of the floating Brief and bell buttons. */}
      <div style={{ padding: '56px 0 24px' }}>
        {fonts}
        <AdStudio display={display.style.fontFamily} body={body.style.fontFamily} serif={serif.style.fontFamily} canEdit={atLeast(lv, 'edit')} canDelete={atLeast(lv, 'full')} />
      </div>
    </Shell>
  )
}
