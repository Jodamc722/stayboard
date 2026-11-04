// AD STUDIO — the AI writes the ad (Jon, 2026-11-02: "have you write scripts").
// POST { prompt, seconds, audience, format, current? } → { name, scenes } with photos already found
// in our photo library for each scene's search words. Nothing is saved here; the editor decides.
//
// FACTS ONLY. The prompt (lib/ad-studio scriptPrompt) carries the house facts and Jon's standing copy
// rules from the October sales videos — no invented numbers, no fee or revenue percentage, the words
// the voice mispronounces kept out of spoken lines.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { askJson } from '@/lib/ad-json'
import { HOUSE_FACTS, GUEST_FACTS, numbersIn, tidyHead } from '@/lib/ad-engine'
import { scriptPrompt, normalize, propertiesLine } from '@/lib/ad-studio'
import { searchPhotos } from '@/lib/photo-library'
import { areasIn, buildingsIn, inBuildings, AREA_LABEL, AREAS, type AreaKey } from '@/lib/ad-places'
import { isCollagePhoto } from '@/lib/collage'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

/** A photo that is itself a collage / grid / split image never goes in an ad (Jon, 2026-11-02). */
const isCollage = (h: { caption?: string; url?: string }) => /collage|grid|mosaic|montage|side[- ]by[- ]side|split view|multiple (photos|images|views)|before.{0,4}after|floor ?plan/i.test(String(h.caption || '') + ' ' + String(h.url || ''))
/** Subjects a line can be about, with the caption words that show them. */
const SUBJECTS: { word: string; any: RegExp }[] = [
  { word: 'rooftop', any: /roof ?top|rooftop/i },
  { word: 'pool', any: /pool|swim/i },
  { word: 'ocean', any: /ocean|beach|sea\b|sand|waterfront|oceanfront|shore/i },
  { word: 'marina', any: /marina|boat|yacht|dock/i },
  { word: 'view', any: /view|skyline|bay\b|vista|panoram|city|downtown|urban|nightlife|lights/i },
  { word: 'balcony', any: /balcon|terrace|patio/i },
  { word: 'bedroom', any: /bed(room)?\b|suite|king|queen|sleep|comfort|cozy|cosy|rest\b|pillow|linen/i },
  { word: 'kitchen', any: /kitchen|cook|chef/i },
  { word: 'living', any: /living|lounge|sofa|couch|relax|unwind|space to/i },
  { word: 'bathroom', any: /bath|shower|spa\b/i },
  { word: 'lobby', any: /lobby|reception|entrance|front desk/i },
  { word: 'gym', any: /gym|fitness|workout/i },
  { word: 'garden', any: /garden|tropical|palm|landscap/i },
  { word: 'dining', any: /dining|restaurant|bar\b|cafe|breakfast|coffee|morning/i },
  { word: 'sunset', any: /sunset|dusk|twilight|night|evening/i },
  { word: 'exterior', any: /building|exterior|facade|tower|aerial/i },
]
function subjectOf(text: string): { word: string; any: RegExp } | null {
  const t = String(text || '').replace(/\*\*/g, '')
  let best: { word: string; any: RegExp } | null = null, at = 1e9
  for (const s of SUBJECTS) { const m = t.search(s.any); if (m >= 0 && m < at) { at = m; best = s } }
  return best
}
/** Which photos make a strong opener: wide establishing shots, never the bathroom or a close-up. */
const OPENER = /exterior|building|aerial|facade|tower|roof ?top|pool|ocean|beach|skyline|view|balcon|terrace|marina|sunset|dusk|night/i
const WEAK = /bath|toilet|shower|closet|hallway|corridor|laundry|washer|dryer|stair|garage|parking|sign|floor ?plan|map|detail|close[- ]?up|towel|amenit/i
/** The caption with numbers and filler stripped — two photos with the same core are the same room from another angle. */
const core = (c: string) => String(c || '').toLowerCase().replace(/\b(the|a|an|with|and|of|in|at|view|photo|image)\b/g, '').replace(/[^a-z ]/g, '').trim().split(/\s+/).slice(0, 3).join(' ')
/** The best unused, non-collage photo for a slot (Jon, 2026-11-04: "use the library and think about photo use").
 *  Scored by: shows the subject (caption) · fits the frame (portrait photos for 9:16, landscape for 16:9) · size ·
 *  an opener wants an establishing shot · weak rooms (bathroom, hallway, closet) only when asked for · not the
 *  same room as a photo already in the ad. Small files (< 900 px) are out. */
async function bestPhoto(hits: any[], subj: { word: string; any: RegExp } | null, used: Set<string>, skip: number, opts: { format?: string; opener?: boolean; usedCores?: Set<string>; place?: string[] } = {}): Promise<string> {
  const seen = new Set<string>()
  const portrait = /^9:16$|^4:5$/.test(String(opts.format || ''))
  const landscape = String(opts.format || '') === '16:9'
  const cands = hits.filter(h => { const u = h.view || h.url; if (!u || used.has(u) || seen.has(u)) return false; if ((h.width || 1200) < 900) return false; seen.add(u); return true })
  const score = (h: any) => {
    const cap = String(h.caption || '')
    let sc = subj && subj.any.test(cap) ? 1000 : 0
    sc += Math.min(400, (h.width || 1200) / 10)
    const w = h.width || 0, ht = h.height || 0
    if (w && ht) { const r = ht / w; if (portrait) sc += r >= 1 ? 260 : r >= 0.75 ? 120 : 0; else if (landscape) sc += r <= 0.8 ? 200 : r <= 1 ? 80 : -120 }
    if (opts.opener) sc += OPENER.test(cap) ? 350 : -150
    if (WEAK.test(cap) && !(subj && subj.any.test(cap))) sc -= 700
    if (opts.usedCores && cap && opts.usedCores.has(core(cap))) sc -= 500
    // LOCATION (Jon, 2026-11-04): a Fort Lauderdale event shows our Fort Lauderdale listings, Miami shows Miami.
    if (opts.place && opts.place.length) sc += inBuildings(String(h.building || ''), opts.place) ? 900 : -600
    return sc
  }
  cands.sort((a, b) => score(b) - score(a))
  let skipped = 0
  for (const h of cands.slice(0, 16)) {
    const u = h.view || h.url
    if (await isCollagePhoto(u)) continue
    if (skipped++ < skip) continue
    if (opts.usedCores && h.caption) opts.usedCores.add(core(String(h.caption)))
    return u
  }
  return ''
}


export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: false, error: 'No Anthropic key configured.' }, { status: 503 })
  const b = await req.json().catch(() => ({} as any))
  const seconds = Math.max(10, Math.min(120, Number(b?.seconds) || 30))
  // Where the ad is set: given by the studio (a calendar moment), else read from the brief.
  const areas: AreaKey[] = (Array.isArray(b?.where) ? b.where : []).filter((x: any) => AREAS.some(a => a.key === x))
  const where = areas.length ? areas : areasIn(String(b?.prompt || ''))
  const placeSet = buildingsIn(where)
  const placeLine = where.length ? `\nWHERE THIS AD IS SET: ${where.map(k => AREA_LABEL[k]).join(' and ')}. Feature ONLY our properties there: ${placeSet.join(', ')}. Every photoQuery starts with one of those property names; never show a property from another area.` : ''
  const prompt = scriptPrompt({
    prompt: String(b?.prompt || '').slice(0, 8000) + placeLine, seconds, format: String(b?.format || '16:9'),
    audience: String(b?.audience || 'property owners').slice(0, 80),
    current: b?.current ? normalize(b.current) : null,
    props: await propertiesLine(),
  })
  try {
    const ans = await askJson(key, prompt, { maxTokens: 5000, temperature: 0.6 })
    if (!ans.ok) return NextResponse.json({ ok: false, error: ans.error }, { status: 502 })
    const j: any = ans.json
    const raw: any[] = Array.isArray(j?.scenes) ? j.scenes.slice(0, 20) : []
    // PHOTOS THAT MATCH THE WORDS (Jon, 2026-11-03: "photos need to match the descriptions", "sometimes
    // using the same photo", "don't like collage photos"). Each scene's subject (pool, bedroom, view …) is
    // read from what the scene SAYS; its photo must show that subject (by caption), be of the property the
    // writer searched for, never repeat in the ad, and never be a collage (caption or the image itself).
    const searches: Record<string, any[]> = {}
    const search = async (q: string) => { if (!searches[q]) { try { searches[q] = ((await searchPhotos(q, 80)).hits as any[]).filter(h => h.active !== false && !isCollage(h)) } catch { searches[q] = [] } } return searches[q] }
    const used = new Set<string>()
    const usedCores = new Set<string>()
    const fmt = String(b?.format || '16:9')
    const scenes: { id: string; kind: string; badge: string; vo: string; head: string; sub: string; items: string[]; photos: string[]; photoQuery: string }[] = []
    // Pass 1: every slot's candidate list (subject-matched first). Pass 2: slots with the fewest good
    // candidates choose first, so a scene that needs "the pool" is not left with the pool already taken.
    type Slot = { scene: number; k: number; subj: ReturnType<typeof subjectOf>; cands: any[] }
    const slots: Slot[] = []
    for (let i = 0; i < raw.length; i++) {
      const s = raw[i]
      const q = String(s?.photoQuery || '').trim().slice(0, 60)
      const want = s?.kind === 'wall' ? 4 : s?.kind === 'cards' ? 3 : s?.kind === 'contact' ? 0 : 1
      const place = q.split(/\s+/)[0] || ''
      const items: string[] = Array.isArray(s?.items) ? s.items.map((x: any) => String(x || '')) : []
      const texts = s?.kind === 'cards' ? items.slice(0, 3).map(x => x + ' ' + q) : Array.from({ length: want }, () => [s?.head, s?.sub, s?.vo, q, items.join(' ')].join(' '))
      scenes.push({ id: 's' + (i + 1), kind: s?.kind, badge: i === raw.findIndex((x: any) => x?.badge) ? s?.badge : '', vo: s?.vo, head: s?.head, sub: s?.sub, items: s?.items, photos: [], photoQuery: q })
      for (let k = 0; k < want; k++) {
        const subj = subjectOf(texts[k] || '')
        const pools = [subj && place ? await search(place + ' ' + subj.word) : [], q ? await search(q) : [], place ? await search(place) : []]
        // the area's own buildings, by subject, so there is always a right-place candidate
        for (const bname of placeSet.slice(0, 6)) pools.push(subj ? await search(bname + ' ' + subj.word) : await search(bname))
        slots.push({ scene: i, k, subj, cands: pools.flat() })
      }
    }
    const good = (sl: Slot) => sl.subj ? sl.cands.filter(h => sl.subj!.any.test(String(h.caption || ''))).length : sl.cands.length
    const order = slots.map((sl, idx) => ({ idx, n: good(sl) })).sort((a, b) => a.n - b.n || a.idx - b.idx)
    const picks: Record<string, string> = {}
    for (const { idx } of order) {
      const sl = slots[idx]
      const u = await bestPhoto(sl.cands, sl.subj, used, 0, { format: fmt, opener: sl.scene === 0 && sl.k === 0, usedCores, place: placeSet })
      if (u) { used.add(u); picks[sl.scene + ':' + sl.k] = u }
    }
    slots.forEach(sl => { const u = picks[sl.scene + ':' + sl.k]; if (u) scenes[sl.scene].photos[sl.k] = u })
    scenes.forEach(x => { x.photos = x.photos.filter(Boolean) })
    const everything = Object.values(searches).flat()
    for (const x of scenes) {
      if (x.photos.length || x.kind === 'contact') continue
      const u = await bestPhoto(everything, subjectOf([x.head, x.sub, x.vo].join(' ')), used, 0, { format: fmt, usedCores, place: placeSet })
      if (u) { x.photos = [u]; used.add(u) }
    }
    const norm = normalize({ id: 'x', scenes })
    // FACT GUARD: a number the facts (or the brief) do not contain never reaches the ad. Numbers in rows are
    // dropped with their row; numbers in a line or headline come back as a warning to check.
    const allowed = new Set(numbersIn([HOUSE_FACTS, GUEST_FACTS, String(b?.prompt || ''), '1M 1000000 651 200 8283 01 02 03'].join(' ')))
    const bad = (t: string) => numbersIn(t).filter(n => !allowed.has(n))
    const warnings: string[] = []
    norm.scenes = norm.scenes.map(x => ({ ...x, head: tidyHead(x.head) }))
    norm.scenes = norm.scenes.map((x, k) => {
      const items = x.items.filter(r => !bad(r).length)
      if (items.length !== x.items.length) warnings.push(`Scene ${k + 1}: removed a row with a number that is not in our facts`)
      const lines = [x.vo, x.head, x.sub, x.badge || ''].map(bad).flat()
      if (lines.length) warnings.push(`Scene ${k + 1}: check ${Array.from(new Set(lines)).join(', ')} — not in our facts`)
      return { ...x, items }
    })
    // a contact card in a guest ad is the wrong end card — the writer is told, this is the backstop
    if (/guest/i.test(String(b?.audience || ''))) norm.scenes = norm.scenes.map(s => (s.kind === 'contact' ? { ...s, kind: 'cta' as const, items: s.items.length ? s.items : ['Book at stay-hospitality.com'] } : s))
    return NextResponse.json({ ok: true, name: String(j?.name || '').slice(0, 120), scenes: norm.scenes, queries: scenes.map(s => s.photoQuery), warnings, where })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
