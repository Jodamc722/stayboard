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
import { HOUSE_FACTS, GUEST_FACTS, numbersIn } from '@/lib/ad-engine'
import { scriptPrompt, normalize } from '@/lib/ad-studio'
import { searchPhotos } from '@/lib/photo-library'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

/** A photo that is itself a collage / grid / split image never goes in an ad (Jon, 2026-11-02). */
const isCollage = (h: { caption?: string; url?: string }) => /collage|grid|mosaic|montage|side[- ]by[- ]side|split view|multiple (photos|images|views)|before.{0,4}after|floor ?plan/i.test(String(h.caption || '') + ' ' + String(h.url || ''))
function pickPhotos(hits: { url: string; view: string; width: number | null; height: number | null; active: boolean; caption?: string }[], n: number): string[] {
  // Prefer active units and real resolution; a low-res photo looks soft at 1080p. Never a collage.
  const ranked = hits.filter(h => !isCollage(h)).slice().sort((a, b) => (Number(b.active) - Number(a.active)) || ((b.width || 1200) - (a.width || 1200)))
  const out: string[] = []
  for (let i = 0; i < ranked.length && out.length < n; i++) { const u = ranked[i].view || ranked[i].url; if (out.indexOf(u) < 0) out.push(u) }
  return out
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: false, error: 'No Anthropic key configured.' }, { status: 503 })
  const b = await req.json().catch(() => ({} as any))
  const seconds = Math.max(10, Math.min(120, Number(b?.seconds) || 30))
  const prompt = scriptPrompt({
    prompt: String(b?.prompt || '').slice(0, 8000), seconds, format: String(b?.format || '16:9'),
    audience: String(b?.audience || 'property owners').slice(0, 80),
    current: b?.current ? normalize(b.current) : null,
  })
  try {
    const ans = await askJson(key, prompt, { maxTokens: 5000, temperature: 0.6 })
    if (!ans.ok) return NextResponse.json({ ok: false, error: ans.error }, { status: 502 })
    const j: any = ans.json
    const raw: any[] = Array.isArray(j?.scenes) ? j.scenes.slice(0, 20) : []
    // Photos: one library search per distinct query, shared across scenes that ask for the same thing.
    const cache: Record<string, string[]> = {}
    const scenes = await Promise.all(raw.map(async (s: any, i: number) => {
      const q = String(s?.photoQuery || '').trim().slice(0, 60)
      let photos: string[] = []
      const want = s?.kind === 'wall' ? 4 : s?.kind === 'cards' ? 3 : s?.kind === 'contact' ? 0 : 1
      if (q && want) {
        if (!cache[q]) { try { cache[q] = pickPhotos((await searchPhotos(q, 60)).hits as any, 16) } catch { cache[q] = [] } }
        photos = cache[q].slice(0, Math.max(want, 6))
      }
      return { id: 's' + (i + 1), kind: s?.kind, tr: s?.tr, anim: s?.anim, cam: s?.cam, badge: s?.badge, vo: s?.vo, head: s?.head, sub: s?.sub, items: s?.items, photos, photoQuery: q }
    }))
    // Different photos for different scenes: each scene takes the first of its matches the ad has not used yet.
    const used = new Set<string>()
    scenes.forEach(x => {
      const want = x.kind === 'wall' ? 4 : x.kind === 'cards' ? 3 : x.kind === 'contact' ? 0 : 1
      const fresh = x.photos.filter(u => !used.has(u))
      x.photos = (fresh.length >= want ? fresh : x.photos).slice(0, want)
      x.photos.forEach(u => used.add(u))
    })
    // Every photo-led design needs a photo: borrow one the ad already has, so no scene renders empty.
    const pool: string[] = []
    scenes.forEach(x => x.photos.forEach(u => { if (pool.indexOf(u) < 0) pool.push(u) }))
    if (!pool.length && cache && Object.keys(cache).length) Object.values(cache).forEach(a => a.forEach(u => { if (pool.indexOf(u) < 0) pool.push(u) }))
    let rot = 0
    scenes.forEach(x => { if (!x.photos.length && x.kind !== 'contact' && pool.length) { x.photos = [pool[(rot++ + 1) % pool.length]] } })
    const norm = normalize({ id: 'x', scenes })
    // FACT GUARD: a number the facts (or the brief) do not contain never reaches the ad. Numbers in rows are
    // dropped with their row; numbers in a line or headline come back as a warning to check.
    const allowed = new Set(numbersIn([HOUSE_FACTS, GUEST_FACTS, String(b?.prompt || ''), '1M 1000000 651 200 8283 01 02 03'].join(' ')))
    const bad = (t: string) => numbersIn(t).filter(n => !allowed.has(n))
    const warnings: string[] = []
    norm.scenes = norm.scenes.map((x, k) => {
      const items = x.items.filter(r => !bad(r).length)
      if (items.length !== x.items.length) warnings.push(`Scene ${k + 1}: removed a row with a number that is not in our facts`)
      const lines = [x.vo, x.head, x.sub, x.badge || ''].map(bad).flat()
      if (lines.length) warnings.push(`Scene ${k + 1}: check ${Array.from(new Set(lines)).join(', ')} — not in our facts`)
      return { ...x, items }
    })
    // a contact card in a guest ad is the wrong end card — the writer is told, this is the backstop
    if (/guest/i.test(String(b?.audience || ''))) norm.scenes = norm.scenes.map(s => (s.kind === 'contact' ? { ...s, kind: 'cta' as const, items: s.items.length ? s.items : ['Book at stay-hospitality.com'] } : s))
    return NextResponse.json({ ok: true, name: String(j?.name || '').slice(0, 120), scenes: norm.scenes, queries: scenes.map(s => s.photoQuery), warnings })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
