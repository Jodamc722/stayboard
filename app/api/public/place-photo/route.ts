// Render-time photo repair for one local spot.
//
// Photos for restaurants and local places are sourced when the book is generated. That is a
// single shot at a moving target: the free photo APIs return nothing for plenty of small
// businesses, and a URL that resolved at generation can 404 weeks later. The guest is the
// one who finds out, and a card with no picture on a page built around pictures reads as a
// mistake. This route lets the rendered page ask for a replacement, and saves the answer so
// the next reader — and the printed PDF — gets it server-rendered.
//
// It is deliberately public, because the guest book itself is public: a share link has no
// session. Three things keep that safe. The guidebook id is an unguessable UUID, so you
// cannot enumerate books. The route only ever touches `photo` on an item in the two local
// sections — no other field, no other section, nothing else on the row. And it refuses to
// replace a photo that still loads, which it checks itself rather than believing the caller.
// The worst a bad actor can do is make us re-run a search that returns the same picture.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isPlaceSection, photoAlive, photoForPlace } from '@/lib/place-photo'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// A page renders up to six cards at once and React strict mode fires effects twice, so an
// identical request can arrive several times in a second. Serving the same promise to all of
// them keeps us to one search per spot instead of a burst, and holding the answer briefly
// stops a reload from starting over. Per-instance and short-lived by design — it is a
// stampede guard, not a cache.
const _inflight = new Map<string, Promise<string | null>>()
const _recent = new Map<string, { at: number; url: string | null }>()
const _TTL = 60_000

export async function POST(req: NextRequest) {
  const body: any = await req.json().catch(() => ({}))
  const id = String(body?.id || '')
  const section = String(body?.section || '')
  const index = Number(body?.index)
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 })
  if (!isPlaceSection(section)) return NextResponse.json({ error: 'bad section' }, { status: 400 })
  if (!Number.isInteger(index) || index < 0 || index > 11) return NextResponse.json({ error: 'bad index' }, { status: 400 })

  const key = id + ':' + section + ':' + index
  const hit = _recent.get(key)
  if (hit && Date.now() - hit.at < _TTL) return NextResponse.json({ ok: true, photo: hit.url, cached: true })
  const busy = _inflight.get(key)
  if (busy) return NextResponse.json({ ok: true, photo: await busy })

  const run = (async (): Promise<string | null> => {
    const db = supabaseAdmin()
    const { data } = await db.from('guidebooks').select('id, sections').eq('id', id).limit(1)
    const gb = (data || [])[0]
    if (!gb) return null
    const item = (gb as any)?.sections?.[section]?.items?.[index]
    if (!item || typeof item !== 'object') return null

    // Keep a photo that still works. This is the guard that makes a public write safe.
    if (item.photo && await photoAlive(item.photo)) return String(item.photo)

    const city = String(item.address || (gb as any)?.sections?.guidelines?.address || '').split(',')[1]?.trim() || ''
    const url = await photoForPlace({ name: item.name, city, section, index })
    if (!url) return null

    // Re-read before writing. The operator may be editing this book in another tab, and the
    // editor saves the whole `sections` object; narrowing the window to the moment between
    // read and write is the most we can do without a schema change, and a lost backfill is
    // self-healing anyway — the next render just asks again.
    const { data: fresh } = await db.from('guidebooks').select('sections').eq('id', id).limit(1)
    const sections = (fresh || [])[0]?.sections
    const target = sections?.[section]?.items?.[index]
    if (!target || typeof target !== 'object') return url
    if (String(target.name || '') !== String(item.name || '')) return url // list changed under us
    target.photo = url
    await db.from('guidebooks').update({ sections }).eq('id', id)
    return url
  })()

  _inflight.set(key, run)
  let url: string | null = null
  try { url = await run } catch { url = null } finally {
    _inflight.delete(key)
    _recent.set(key, { at: Date.now(), url })
    if (_recent.size > 500) _recent.forEach((v, k) => { if (Date.now() - v.at > _TTL) _recent.delete(k) })
  }
  return NextResponse.json({ ok: true, photo: url })
}
