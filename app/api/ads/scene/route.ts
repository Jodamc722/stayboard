// AD STUDIO — change one scene by asking (Jon, 2026-11-02: "allow me to prompt each scene once it's
// created, fix that part how I want with a prompt"). POST { project, index, ask } → the new scene.
// Nothing is saved here; the editor applies it (and Undo is one click there).
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { askJson } from '@/lib/ad-json'
import { normalize, scenePrompt, propertiesLine } from '@/lib/ad-studio'
import { tidyHead } from '@/lib/ad-engine'
import { searchPhotos } from '@/lib/photo-library'
import { withoutCollages } from '@/lib/collage'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: false, error: 'No Anthropic key configured.' }, { status: 503 })
  const b = await req.json().catch(() => ({} as any))
  const p = normalize(b?.project || {})
  const i = Number(b?.index)
  const ask = String(b?.ask || '').trim().slice(0, 800)
  // OPTIONS (2026-11-03): three alternative headline + line pairs for this scene, to pick from.
  if (b?.options) {
    if (!(i >= 0 && i < p.scenes.length)) return NextResponse.json({ ok: false, error: 'Pick a scene.' }, { status: 400 })
    const sc = p.scenes[i]
    const prompt = scenePrompt(p, i, 'Write THREE different options for this scene\'s headline and spoken line: one punchier, one warmer, one more specific/sensory. Keep the same meaning and the same photos. Each headline 2 to 7 words in sentence case with the key word marked **like this**.', await propertiesLine()) +
      '\nInstead of the single-scene JSON, reply with ONLY: {"options": [{"head": "...", "vo": "..."}, {"head": "...", "vo": "..."}, {"head": "...", "vo": "..."}]}'
    const a = await askJson(key, prompt, { maxTokens: 900, temperature: 0.8 })
    if (!a.ok) return NextResponse.json({ ok: false, error: a.error }, { status: 502 })
    const opts = (Array.isArray(a.json?.options) ? a.json.options : []).slice(0, 3).map((o: any) => ({ head: tidyHead(String(o?.head || sc.head).slice(0, 300)), vo: String(o?.vo || sc.vo).slice(0, 600) })).filter((o: any) => o.head)
    return NextResponse.json({ ok: true, options: opts })
  }
  if (!ask || !(i >= 0 && i < p.scenes.length)) return NextResponse.json({ ok: false, error: 'Say what to change.' }, { status: 400 })
  try {
    const a = await askJson(key, scenePrompt(p, i, ask, await propertiesLine()), { maxTokens: 1200, temperature: 0.5 })
    if (!a.ok) return NextResponse.json({ ok: false, error: a.error }, { status: 502 })
    const j = a.json
    const old = p.scenes[i]
    let photos = old.photos
    const q = String(j?.photoQuery || '').trim().slice(0, 60)
    if (q) {
      const want = j?.kind === 'wall' ? 4 : j?.kind === 'cards' ? 3 : 1
      try {
        const hits = (await searchPhotos(q, 60)).hits.filter(h => h.active && !/collage|grid|mosaic|side[- ]by[- ]side|split view|multiple (photos|images|views)|before.{0,4}after|floor ?plan/i.test(String(h.caption || '')))
        // photos that show what the scene says first, never one the ad already uses, never a collage
        const words = [j?.head, j?.sub, j?.vo, ask].join(' ').toLowerCase()
        const usedElsewhere = new Set(p.scenes.filter((_, k) => k !== i).flatMap(x => x.photos))
        const ranked = hits.map(h => ({ u: h.view || h.url, s: String(h.caption || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3 && words.includes(w)).length })).filter((x, k, a) => a.findIndex(y => y.u === x.u) === k && !usedElsewhere.has(x.u)).sort((a, b) => b.s - a.s).map(x => x.u)
        const got = (await withoutCollages(ranked.slice(0, 12))).slice(0, want)
        if (got.length) photos = got
      } catch { /* keep the old photos */ }
    }
    const next = normalize({ id: p.id, scenes: [{ ...old, kind: j?.kind || old.kind, badge: j?.badge ?? old.badge, vo: j?.vo ?? old.vo, head: j?.head ?? old.head, sub: j?.sub ?? old.sub, items: Array.isArray(j?.items) ? j.items : old.items, photos }] }).scenes[0]
    next.head = tidyHead(next.head)
    return NextResponse.json({ ok: true, scene: { ...next, id: old.id, sfx: old.sfx || '' }, photoQuery: q })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
