'use client'
// THE DESIGN PICKER (Jon, 2026-11-10: "audit and fix the ad studio to make it easier to use"). The scene designs
// used to be a wall of 35 text buttons — Text mask, Ticker, Polaroid — and you had to press each one to learn what
// it did. Here every design is a live thumbnail of THIS scene (its words, its photo, the ad's look), drawn by the
// same renderer as the player, grouped by what the design is for. The same picker adds a scene.
import { useEffect, useRef } from 'react'
import { type AdProject, type AdScene, type AdKind, type AdAssets, FORMATS, KINDS, PRO_KINDS, timeline, drawFrame } from '@/lib/ad-engine'

const UI = { bg: '#0E1116', panel: '#151A21', panel2: '#1B222B', line: '#262E39', ink: '#E8EBEF', mut: '#8C96A3', gold: '#D2B077' }

/** What a design shows when the scene has no rows yet — examples only, never saved into the ad. */
const SAMPLE: Partial<Record<AdKind, string[]>> = {
  callouts: ['Rooftop pool', 'Walk to the beach', 'Full kitchen'],
  event: ['DEC 5–7'],
  cards: ['Morning|Coffee on the balcony', 'Noon|Pool', 'Night|The city'],
  stats: ['450+|listings', '4|markets', '10|years'],
  feed: ['Clean scheduled|Unit 302 · 11 am', 'Guest checked in|Unit 604', 'Review received|5 stars'],
  checks: ['Listing rebuilt', 'Pricing set daily', 'Cleaned and inspected'],
  rise: ['More bookings', 'Better reviews'],
  timeline: ['Week 1|Agreement', 'Week 2|Photos', 'Week 3|Live'],
  team: ['Nick|Owner relations', 'Jon|General manager'],
  poster: ['DEC 20–26', 'Book at stay-hospitality.com'],
  cta: ['Book at stay-hospitality.com'],
  tiles: ['450+|listings', '4|markets', '10|years'],
  dates: ['Dec|Art Basel Miami Beach|$309|$899', 'Mar|Ultra|$289|$749'],
  hub: ['Airbnb', 'Vrbo', 'Booking.com', 'stay-hospitality.com'],
  tilegrid: ['Pricing', 'Cleaning', 'Guests', 'Owners', 'Maintenance', 'Reviews'],
  livefeed: ['Clean scheduled|Unit 302|#4CC488', 'Rate raised|Art Basel|#D2B077', 'Review|5 stars|#4C8DF6'],
  roles: ['Revenue', 'Guest team', 'Housekeeping', 'Maintenance'],
  curve: ['More revenue', 'Lower fee'],
  triad: ['Revenue|Priced every day', 'Care|Cleaned and inspected', 'Reach|Every channel'],
  beforeafter: ['New photos', 'New title', 'New pricing'],
  calendar: ['Illustrative rates', '189,179,179,199,249,289,219'],
}
const GROUPS: { title: string; note: string; kinds: AdKind[] }[] = [
  { title: 'Photo and a headline', note: 'Works with any scene — the photo carries it.', kinds: ['cinema', 'title', 'photo', 'reveal', 'kinetic', 'mask', 'panel', 'ticker', 'polaroid', 'quote', 'wall'] },
  { title: 'Lists and numbers', note: 'These need rows — add them under Words once picked.', kinds: ['stats', 'checks', 'callouts', 'cards', 'feed', 'rise', 'timeline', 'team', 'event'] },
  { title: 'Posters and end cards', note: 'A designed page, the Book now card, the Nick contact card.', kinds: ['poster', 'cta', 'contact'] },
  { title: 'Pro designs · from the sales videos', note: 'The twelve from the two sales videos.', kinds: PRO_KINDS },
]

function Thumb({ proj, scene, kind, assets, order }: { proj: AdProject; scene: AdScene; kind: AdKind; assets: () => AdAssets; order: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [FW, FH] = FORMATS[proj.format]
  const w = 180, h = Math.round(w * Math.min(1.25, FH / FW))
  useEffect(() => {
    const draw = () => {
      const cv = ref.current; if (!cv) return
      const head = scene.head || (kind === 'contact' ? 'Book a **call.**' : 'Your **headline**')
      const one: AdScene = { ...scene, id: 'pv', kind, vo: '', dur: 4, tr: 'auto', fx: [], fxo: {}, sfx: '', head, items: scene.items.filter(Boolean).length ? scene.items : (SAMPLE[kind] || []) }
      const q: AdProject = { ...proj, captions: false, voice: null, scenes: [one] }
      const T = timeline(q)
      const c2 = document.createElement('canvas')
      c2.width = Math.round(480 * FW / Math.max(FW, FH)); c2.height = Math.round(480 * FH / Math.max(FW, FH))
      const g = c2.getContext('2d'); if (!g) return
      try { drawFrame(g, q, T, Math.max(0, Math.min(T.total - 0.05, T.total * 0.8)), assets()) } catch { return }
      const x = cv.getContext('2d'); if (!x) return
      x.clearRect(0, 0, cv.width, cv.height)
      const s2 = Math.max(cv.width / c2.width, cv.height / c2.height)
      x.drawImage(c2, (cv.width - c2.width * s2) / 2, (cv.height - c2.height * s2) / 2, c2.width * s2, c2.height * s2)
    }
    // Staggered so thirty-five frames do not land in one tick; drawn again once the photos have arrived.
    const ids = [setTimeout(draw, 30 + order * 25), setTimeout(draw, 1100 + order * 15), setTimeout(draw, 2800)]
    return () => ids.forEach(clearTimeout)
  }, [kind, scene.id, proj.look, proj.format]) // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} width={w * 2} height={h * 2} style={{ width: '100%', aspectRatio: `${w}/${h}`, display: 'block', background: '#000' }} />
}

export default function AdDesignPicker({ proj, scene, assets, current, title, sub, display, onPick, onClose }: {
  proj: AdProject; scene: AdScene; assets: () => AdAssets
  /** the design in use — ringed in gold */ current?: AdKind
  title: string; sub: string; display: string
  onPick: (kind: AdKind) => void; onClose: () => void
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  let n = 0
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 90, display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(1040px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 14, color: UI.ink }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '14px 18px', borderBottom: '1px solid ' + UI.line }}>
          <span style={{ fontFamily: display, fontWeight: 800, fontSize: 19 }}>{title}</span>
          <span style={{ fontSize: 12.5, color: UI.mut }}>{sub}</span>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid ' + UI.line, color: UI.mut, borderRadius: 8, padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Close</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '4px 18px 18px' }}>
          {GROUPS.map(gp => (
            <div key={gp.title}>
              <p style={{ margin: '14px 0 8px', fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: gp.kinds === PRO_KINDS ? UI.gold : UI.ink }}>{gp.title} <span style={{ fontWeight: 500, letterSpacing: 0, textTransform: 'none', color: UI.mut }}>· {gp.note}</span></p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                {gp.kinds.map(kind => {
                  const k = KINDS.find(x => x.kind === kind); if (!k) return null
                  const on = current === kind
                  return (
                    <button key={kind} type="button" title={k.hint.replace(/^Pro · /, '')} onClick={() => onPick(kind)}
                      style={{ padding: 0, border: '2px solid ' + (on ? UI.gold : UI.line), borderRadius: 9, overflow: 'hidden', cursor: 'pointer', background: UI.panel2, color: UI.ink, textAlign: 'left' }}>
                      <Thumb proj={proj} scene={scene} kind={kind} assets={assets} order={n++} />
                      <span style={{ display: 'block', fontSize: 12, fontWeight: 700, padding: '5px 8px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{on ? '✓ ' : ''}{k.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
