// GUIDEBOOK REVIEW (Jon, 2026-11-06: "a place to go one by one and approve each one … page by page
// review. Once approved it should push to Guesty"). State lives on the book in sections._review
// (lib/guidebook-audit ReviewState) and in guidebooks.status: draft → approved → live (pushed).
//
// POST { id, action }
//   'page'      { page, ok }  tick / untick one review page
//   'note'      { note }      a note for the team
//   'approve'                 status approved, then the guest link is written to Guesty's Guidebook
//                             field (the push-guesty route) → status live
//   'unapprove'               back to draft
//   'photos'                  vision pass over the book's photos: marks collages and text-bearing
//                             images, and swaps any used on a page for the best clean scene photo
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel, getAccess } from '@/lib/access'
import { modelFor } from '@/lib/ai-models'
import { anthropicMessages, textOf } from '@/lib/anthropic-call'
import { parseJson } from '@/lib/json-repair'
import { POST as pushToGuesty } from '../push-guesty/route'
import { auditGuidebook, reviewOf, stageOf } from '@/lib/guidebook-audit'
import { guestUnitFull } from '@/lib/guest-unit'
import { rollupBuilding } from '@/lib/optimize-score'
import { pageRows } from '@/lib/db-page'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const urlOf = (p: any): string => (typeof p === 'string' ? p : p && (p.original || p.url || p.thumbnail)) || ''
const SCENE = ['bedroom', 'living', 'kitchen', 'dining', 'bathroom', 'pool', 'beach', 'view', 'exterior', 'amenity']

// GET ?queue=1 — the one-by-one walk on the Admin desk (Guidebooks tab): every book, property by
// property (Surfside, then Salato, then A–Z), units in number order, with its flags and review state.
const ORDER = [/surfside|boynton/i, /salato/i]
const rankB = (b: string) => { const i = ORDER.findIndex(re => re.test(b)); return i < 0 ? 99 : i }
export async function GET() {
  const gate = await requireLevel('guidebooks', 'view')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const { rows: books } = await pageRows<any>((a, b) => db.from('guidebooks').select('id, listing_id, listing_name, title, status, updated_at, sections, answers').order('updated_at', { ascending: false }).order('id').range(a, b), 6)
  const newest: Record<string, any> = {}
  for (const b of books || []) { const k = String(b.listing_id || b.id); if (!newest[k]) newest[k] = b }
  const { data: ls } = await db.from('guesty_listings').select('id, nickname, title, building, unit, status').not('building', 'is', null).limit(1000)
  const listings = (ls || []).filter((l: any) => !/\bfull\b/i.test(String(l.nickname || l.title || '')) && !/inactive|disabled|archived|deleted/i.test(String(l.status || '')))
  const items: any[] = []
  const missing: Record<string, number> = {}
  for (const l of listings as any[]) {
    const building = rollupBuilding(String(l.building || '').trim())
    if (!building || building === 'Unassigned') continue
    const gb = newest[l.id]
    if (!gb || !gb.sections) { missing[building] = (missing[building] || 0) + 1; continue }
    const rv = reviewOf(gb)
    items.push({
      id: gb.id, building, unit: guestUnitFull(l) || String(l.nickname || l.title || ''), name: String(gb.listing_name || gb.title || '').split(/\s+\|\s+/)[0],
      stage: stageOf(gb), flags: auditGuidebook(gb, l), printOk: !!(rv.pages && rv.pages.print), needsFix: rv.needsFix || null, format: gb.sections?._print?.format === 'flyer' ? 'flyer' : 'magazine', note: rv.note || '', photosChecked: !!rv.photosCheckedAt, pushError: rv.pushError || '',
    })
  }
  items.sort((a, b) => rankB(a.building) - rankB(b.building) || a.building.localeCompare(b.building) || a.unit.localeCompare(b.unit, undefined, { numeric: true }))
  return NextResponse.json({ items, missing })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('guidebooks', 'edit')
  if (!gate.ok) return gate.res
  let who = ''
  try { const a = await getAccess(); who = String(a.user?.email || a.email || '') } catch { /* anonymous edit cannot happen past the gate */ }
  const body = await req.json().catch(() => ({} as any))
  const id = String(body?.id || '')
  const action = String(body?.action || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = supabaseAdmin()
  const { data } = await db.from('guidebooks').select('id, status, sections, listing_id').eq('id', id).limit(1)
  const gb: any = (data || [])[0]
  if (!gb || !gb.sections) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const sections = gb.sections
  const rv = (sections._review && typeof sections._review === 'object') ? sections._review : {}
  const now = new Date().toISOString()
  const save = async (patch: Record<string, any> = {}) => {
    sections._review = rv
    const { error } = await db.from('guidebooks').update({ sections, updated_at: now, ...patch }).eq('id', id)
    return error ? error.message : ''
  }

  if (action === 'page') {
    const page = String(body?.page || '').slice(0, 30)
    if (!page) return NextResponse.json({ error: 'page required' }, { status: 400 })
    rv.pages = rv.pages || {}
    if (body?.ok === false) delete rv.pages[page]
    else rv.pages[page] = now + ' ' + who
    const err = await save()
    return err ? NextResponse.json({ error: err }, { status: 500 }) : NextResponse.json({ ok: true, review: rv })
  }
  if (action === 'note') {
    rv.note = String(body?.note || '').slice(0, 2000)
    const err = await save()
    return err ? NextResponse.json({ error: err }, { status: 500 }) : NextResponse.json({ ok: true, review: rv })
  }
  // NEEDS FIX (Jon, 2026-11-06: "have a way to mark need to fix and add note") — flagged back to the team
  // with what is wrong; cleared by { action: 'fix', clear: true } or by approving.
  if (action === 'fix') {
    if (body?.clear === true) delete rv.needsFix
    else rv.needsFix = { note: String(body?.note || '').slice(0, 2000), at: now, by: who }
    const err = await save(body?.clear === true ? {} : { status: 'draft' })
    return err ? NextResponse.json({ error: err }, { status: 500 }) : NextResponse.json({ ok: true, review: rv })
  }
  // PRINT FORMAT — what prints for this unit: the magazine or the 1-pager (set per property from Admin).
  if (action === 'format') {
    const f = body?.format === 'flyer' ? 'flyer' : 'magazine'
    sections._print = { ...(sections._print || {}), format: f }
    const err = await save()
    return err ? NextResponse.json({ error: err }, { status: 500 }) : NextResponse.json({ ok: true, format: f })
  }
  if (action === 'unapprove') {
    delete rv.approvedAt; delete rv.approvedBy
    const err = await save({ status: 'draft' })
    return err ? NextResponse.json({ error: err }, { status: 500 }) : NextResponse.json({ ok: true, status: 'draft', review: rv })
  }
  if (action === 'approve') {
    rv.approvedAt = now; rv.approvedBy = who; delete rv.needsFix
    rv.pages = { ...(rv.pages || {}), guest: now + ' ' + who }
    let err = await save({ status: 'approved' })
    if (err) return NextResponse.json({ error: err }, { status: 500 })
    // Write the guest link into Guesty (same route as the Guidebooks "Push to Guesty" button).
    let pushed = false, pushError = ''
    try {
      const r = await pushToGuesty(new NextRequest(new URL('/api/guidebook/push-guesty', req.url), { method: 'POST', headers: { 'content-type': 'application/json', cookie: req.headers.get('cookie') || '' }, body: JSON.stringify({ bookIds: [id] }) }))
      const j: any = await r.json().catch(() => ({}))
      const res = Array.isArray(j?.results) ? j.results[0] : null
      pushed = r.ok && !!res && res.ok !== false
      if (!pushed) pushError = String(res?.error || j?.error || ('HTTP ' + r.status)).slice(0, 300)
    } catch (e: any) { pushError = String(e?.message || e).slice(0, 300) }
    if (pushed) { rv.pushedAt = now; delete rv.pushError } else rv.pushError = pushError
    err = await save(pushed ? { status: 'live' } : {})
    return NextResponse.json({ ok: !err, status: pushed ? 'live' : 'approved', pushed, pushError, review: rv })
  }
  if (action === 'photos') {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) return NextResponse.json({ error: 'AI is not configured' }, { status: 503 })
    const pa = sections._photoAssign || {}
    const pool: string[] = []
    for (const u of [...Object.values(pa).map(urlOf), ...(Array.isArray(sections._photos) ? sections._photos.map(urlOf) : [])]) if (u && /^https?:/.test(u) && pool.indexOf(u) < 0) pool.push(u)
    const list = pool.slice(0, 18)
    if (!list.length) return NextResponse.json({ ok: true, checked: 0 })
    const model = await modelFor('guidebook')
    const ASK = 'For EACH image return a JSON array of {"i":index,"collage":true|false,"hasText":true|false,"category":"bedroom|living|kitchen|dining|bathroom|pool|beach|view|exterior|amenity|appliance|map|logo|other","quality":1-5,"coverWorthy":true|false}. collage = several photos combined in one frame (grid, split screen, side-by-side, before/after, montage, picture-in-picture) — when in doubt, true. hasText = any overlaid text, badges, logos, watermarks or captions. category "map" = a map, floor plan or diagram. coverWorthy = one striking, well-lit single photo that works full-bleed behind white text. STRICT minified JSON array only.'
    // One bad picture (a dead link, an unsupported file) fails the whole request, so a failed batch is
    // split until the bad ones are isolated; those are marked dead and never used on a page.
    const results: Record<string, any> = {}
    const dead: string[] = []
    let lastErr = ''
    const classify = async (urls: string[]): Promise<void> => {
      if (!urls.length) return
      const content: any[] = urls.flatMap((u, i) => [{ type: 'text', text: 'IMAGE ' + i + ':' }, { type: 'image', source: { type: 'url', url: u } }])
      content.push({ type: 'text', text: ASK })
      const call = await anthropicMessages(key, { model, max_tokens: 2500, messages: [{ role: 'user', content }] }, 'claude-sonnet-4-6', 'guidebook')
      const parsed = call.ok ? parseJson(textOf(call.data) || '') : null
      if (Array.isArray(parsed)) { for (const p of parsed) { const u = urls[Number(p?.i)]; if (u) results[u] = p } return }
      lastErr = String(call.data?.error?.message || ('HTTP ' + call.status)).slice(0, 200)
      if (urls.length === 1) { if (!call.ok && call.status === 400) dead.push(urls[0]); return }
      const half = Math.ceil(urls.length / 2)
      await classify(urls.slice(0, half)); await classify(urls.slice(half))
    }
    await classify(list)
    if (!Object.keys(results).length && !dead.length) return NextResponse.json({ error: 'The photo check did not answer — ' + (lastErr || 'try again') }, { status: 502 })
    const parsed: any[] = Object.entries(results).map(([u, p]) => ({ ...p, i: list.indexOf(u) }))
    for (const u of dead) parsed.push({ i: list.indexOf(u), collage: false, hasText: true, category: 'other', quality: 0, coverWorthy: false, dead: true })
    const meta: any[] = Array.isArray(sections._photoMeta) ? sections._photoMeta.slice() : []
    const byUrl: Record<string, any> = {}
    for (const m of meta) if (m && m.url) byUrl[m.url] = m
    for (const p of parsed) {
      const i = Number(p?.i); const u = list[i]
      if (!u) continue
      byUrl[u] = { ...(byUrl[u] || { url: u, brightness: 'mid', label: '' }), url: u, collage: p.collage === true, hasText: p.hasText === true, dead: p.dead === true, category: String(p.category || byUrl[u]?.category || 'other'), quality: Number(p.quality) || 3, coverWorthy: p.coverWorthy === true }
    }
    sections._photoMeta = Object.values(byUrl)
    const ok = (u: string) => { const m = byUrl[u]; return m && !m.dead && !m.collage && !m.hasText && m.category !== 'map' && m.category !== 'logo' && m.category !== 'appliance' }
    const ranked = list.filter(ok).sort((a, b) => ((SCENE.includes(byUrl[b].category) ? 1 : 0) - (SCENE.includes(byUrl[a].category) ? 1 : 0)) || (byUrl[b].quality - byUrl[a].quality))
    const used = new Set(Object.values(pa).map(urlOf).filter(ok))
    const swapped: string[] = []
    for (const slot of Object.keys(pa)) {
      const u = urlOf(pa[slot])
      if (!u || ok(u)) continue
      const pref = slot === 'cover' ? ranked.find(x => byUrl[x].coverWorthy && !used.has(x)) : null
      const next = pref || ranked.find(x => !used.has(x)) || null
      pa[slot] = next; if (next) used.add(next)
      swapped.push(slot)
    }
    sections._photoAssign = pa
    // The guest guide's own photo list loses collages too (it falls back to the first photo).
    if (Array.isArray(sections._photos)) sections._photos = sections._photos.filter((p: any) => { const u = urlOf(p); return !byUrl[u] || ok(u) })
    rv.photosCheckedAt = now
    const err = await save()
    const collages = list.filter(u => byUrl[u]?.collage).length
    return err ? NextResponse.json({ error: err }, { status: 500 }) : NextResponse.json({ ok: true, checked: list.length, collages, dead: dead.length, swapped })
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
