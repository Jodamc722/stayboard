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
import { scriptPrompt, normalize } from '@/lib/ad-studio'
import { searchPhotos } from '@/lib/photo-library'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

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
        if (!cache[q]) { try { cache[q] = pickPhotos((await searchPhotos(q, 60)).hits as any, 12) } catch { cache[q] = [] } }
        photos = cache[q].slice(0, want)
      }
      return { id: 's' + (i + 1), kind: s?.kind, tr: s?.tr, vo: s?.vo, head: s?.head, sub: s?.sub, items: s?.items, photos, photoQuery: q }
    }))
    const norm = normalize({ id: 'x', scenes })
    // a contact card in a guest ad is the wrong end card — the writer is told, this is the backstop
    if (/guest/i.test(String(b?.audience || ''))) norm.scenes = norm.scenes.map(s => (s.kind === 'contact' ? { ...s, kind: 'cta' as const, items: s.items.length ? s.items : ['Book at stay-hospitality.com'] } : s))
    return NextResponse.json({ ok: true, name: String(j?.name || '').slice(0, 120), scenes: norm.scenes, queries: scenes.map(s => s.photoQuery) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
