// THE REGENERATE PIPELINE, SHARED (2026-11-05). One listing's full regenerate — copy, photo order and
// first five, captions, mirror and/or enhance every photo, amenity photos from sibling units — as plain
// functions, so the listing page and the property page's bulk run do exactly the same thing.
// Browser-side: each step is one of the existing routes; nothing is written until push().

import { fitToCap } from './listing-fit'

export type RegenOpts = { title: boolean; sections: boolean; order: boolean; captions: boolean; enhance: boolean; mirror: boolean; amenities: boolean }
export type Content = { title: string; summary: string; space: string; access: string; neighborhood: string; transit: string; notes: string }
export const SECTION_KEYS: (keyof Content)[] = ['summary', 'space', 'access', 'neighborhood', 'transit', 'notes']
export type Pic = { id: string; url: string; thumb: string; caption: string }
export type Borrow = { url: string; thumb: string; caption: string; amenity: string; label: string; fromUnit: string }
export type RegenResult = {
  listingId: string
  base: Pic[]
  copy: { current: Content; proposed: Content; titleMax: number; factIssues: string[]; warnings: string[] } | null
  order: string[] | null
  caps: Record<string, string>
  imgs: Record<string, string>
  imgLabel: string
  borrow: Borrow[]
  errors: string[]
}

// A STEP THAT HITS A RATE LIMIT WAITS AND TRIES AGAIN (Jon, 2026-11-06: "says too many requests").
// Anthropic, the image service and Guesty all answer "slow down" when a run sends many calls close
// together; that used to fail the step outright. Now a rate limit, an overload, a gateway error or a
// timeout is retried up to three more times (6s, 15s, 30s). A real refusal (a rule, a missing unit)
// is not retried — it is reported as it is.
const TRANSIENT = /too many|rate.?limit|429|overload|529|503|502|504|timed out|took longer|temporar|try again|fetch failed|network|ECONN/i
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
export async function call(url: string, body?: any, method?: string): Promise<any> {
  let last: Error | null = null
  for (const wait of [0, 6000, 15000, 30000]) {
    if (wait) await sleep(wait)
    try {
      const r = await fetch(url, body ? { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
      const t = await r.text()
      let d: any = null; try { d = JSON.parse(t) } catch { d = { error: r.status === 504 ? 'took longer than the server allows' : 'server problem (' + r.status + ')' } }
      if (r.ok && !d?.error) return d
      last = new Error(d?.error || 'HTTP ' + r.status)
      if (!(TRANSIENT.test(String(d?.error || '')) || [429, 502, 503, 504, 529].includes(r.status))) throw last
    } catch (e: any) {
      last = e instanceof Error ? e : new Error(String(e))
      if (!TRANSIENT.test(last.message)) throw last
    }
  }
  throw new Error((last?.message || 'failed') + ' — still busy after 3 retries; run it again in a minute')
}

export const REGEN_INSTRUCTION = (steer: string) =>
  'REGENERATE THIS LISTING: rewrite the title and all six sections with fresh wording and a fresh structure. KEEP THE SAME CONTENT — the same facts, features, rules and details already in the listing, nothing added that is not true of this unit, nothing important dropped. Keep the house voice exactly as specified.' + (steer.trim() ? ' Also make sure to: ' + steer.trim() : '')

export async function runRegenerate(listingId: string, opts: RegenOpts, steer: string, onStep: (step: string) => void = () => {}): Promise<RegenResult> {
  const res: RegenResult = { listingId, base: [], copy: null, order: null, caps: {}, imgs: {}, imgLabel: '', borrow: [], errors: [] }
  try {
    const lib = await call('/api/photos/library?listing=' + encodeURIComponent(listingId))
    res.base = (lib.photos || []).map((p: any) => ({ id: String(p.id), url: String(p.url), thumb: String(p.thumb || p.url), caption: String(p.caption || '') }))
  } catch (e: any) { res.errors.push('photos: ' + String(e?.message || e)) }
  if (opts.title || opts.sections) {
    onStep('copy')
    try {
      const d = await call('/api/optimize-listing', { listingId, instruction: REGEN_INSTRUCTION(steer) })
      res.copy = { current: d.current, proposed: d.proposed, titleMax: d.titleMax || 50, factIssues: Array.isArray(d.factIssues) ? d.factIssues : [], warnings: Array.isArray(d.warnings) ? d.warnings : [] }
    } catch (e: any) { res.errors.push('copy: ' + String(e?.message || e)) }
  }
  if (opts.order || opts.captions) {
    onStep('photo order + captions')
    try {
      const d = await call('/api/optimize-photos', { listingId, ...(opts.captions ? { regenerateCaptions: true } : {}), ...(opts.order ? { autoHero: true } : {}), ...(steer.trim() ? { guidance: steer.trim() } : {}) })
      if (opts.order && Array.isArray(d.proposedOrder) && d.proposedOrder.length) res.order = d.proposedOrder.map(String)
      if (opts.captions) for (const p of (d.photos || []) as any[]) if (p && p._id && typeof p.caption === 'string' && p.caption.trim() && !p.captionIsPlaceholder) res.caps[String(p._id)] = p.caption.trim()
    } catch (e: any) { res.errors.push('photo order: ' + String(e?.message || e)) }
  }
  if ((opts.mirror || opts.enhance) && res.base.length) {
    const ids = res.base.map(p => p.id), size = opts.mirror ? 6 : 8
    res.imgLabel = opts.mirror && opts.enhance ? 'Mirrored + enhanced' : opts.mirror ? 'Mirrored' : 'Enhanced'
    let failed = 0
    for (let i = 0; i < ids.length; i += size) {
      onStep('images ' + Math.min(i + size, ids.length) + '/' + ids.length)
      const chunk = ids.slice(i, i + size)
      const body: any = { listingId, photoIds: chunk, force: true }
      if (opts.mirror) { body.flip = true; if (opts.enhance) body.flipEnhance = true }
      const d = await call('/api/photo-enhance', body).catch(() => { failed += chunk.length; return null })
      if (!d) continue
      for (const p of (d.photos || []) as any[]) { const u = p.flippedUrl || p.enhancedUrl; if (u) res.imgs[String(p._id)] = u }
      failed += (d.errors || []).length
    }
    if (failed) res.errors.push(failed + ' photo(s) could not be ' + res.imgLabel.toLowerCase())
  }
  if (opts.amenities) {
    onStep('amenity photos')
    try {
      const d = await call('/api/listing-regenerate/amenity-photos?listingId=' + encodeURIComponent(listingId))
      res.borrow = d.photos || []
    } catch (e: any) { res.errors.push('amenity photos: ' + String(e?.message || e)) }
  }
  return res
}

/** What a result would change, given the parts left ticked. */
export function regenDiff(r: RegenResult, opts: RegenOpts, use: { copy: boolean; order: boolean; captions: boolean; images: boolean; amenities: boolean }, title?: string, borrowOff?: Set<number>) {
  const byId = new Map(r.base.map(p => [p.id, p]))
  const live = r.base.map(p => p.id)
  const order = use.order && r.order ? r.order.filter(id => byId.has(id)).concat(live.filter(id => !r.order!.includes(id))) : live
  const capChanged = use.captions ? Object.entries(r.caps).filter(([id, c]) => byId.has(id) && (byId.get(id)!.caption || '') !== c) : []
  const t = (title ?? r.copy?.proposed.title ?? '').trim()
  const titleChanged = use.copy && opts.title && !!r.copy && !!t && t !== (r.copy.current.title || '').trim()
  const sections = use.copy && opts.sections && r.copy ? SECTION_KEYS.filter(k => (r.copy!.proposed[k] || '').trim() && (r.copy!.proposed[k] || '').trim() !== (r.copy!.current[k] || '').trim()) : []
  const imgs = use.images ? r.imgs : {}
  const borrowed = use.amenities ? r.borrow.filter((_, i) => !borrowOff || !borrowOff.has(i)) : []
  const orderChanged = !!(use.order && r.order && order.join() !== live.join())
  const photoWork = orderChanged || capChanged.length > 0 || Object.keys(imgs).length > 0 || borrowed.length > 0
  return { order, capChanged, titleChanged, title: t, sections, imgs, borrowed, orderChanged, photoWork, any: titleChanged || sections.length > 0 || photoWork }
}

/** Write one listing's regenerate to Guesty: copy, then photos. Returns what went. */
export async function pushRegenerate(r: RegenResult, diff: ReturnType<typeof regenDiff>, opts: { allowFactIssues?: boolean } = {}): Promise<string[]> {
  const done: string[] = []
  if (r.copy && (diff.titleChanged || diff.sections.length)) {
    if (r.copy.factIssues?.length && !opts.allowFactIssues) throw new Error('copy held back — ' + r.copy.factIssues[0])
    if (diff.titleChanged && diff.title.length > r.copy.titleMax) throw new Error('title over ' + r.copy.titleMax + ' characters')
    const sections: Record<string, string> = {}
    for (const k of diff.sections) sections[k] = k === 'summary' ? fitToCap(r.copy.proposed[k], 500).text : r.copy.proposed[k].trim()
    await call('/api/listing-content', { listingId: r.listingId, title: diff.titleChanged ? diff.title : undefined, publicDescription: sections, recreate: true })
    done.push('copy')
  }
  if (diff.photoWork) {
    const adds: Record<string, { url: string; caption: string }> = {}
    diff.borrowed.forEach((b, i) => { adds['borrow-' + i + '-' + Date.now().toString(36)] = { url: b.url, caption: b.caption } })
    const body: any = { listingId: r.listingId, order: diff.order.concat(Object.keys(adds)) }
    if (diff.capChanged.length) body.captions = Object.fromEntries(diff.capChanged)
    if (Object.keys(diff.imgs).length) body.urls = diff.imgs
    if (Object.keys(adds).length) body.adds = adds
    await call('/api/photo-order', body)
    done.push('photos')
  }
  return done
}


// ── DID IT SYNC? (Jon, 2026-11-06: "have ability to push again if changes did not sync") ──────────
// After a push, read Guesty back: the title and every pushed section must be there word for word,
// and the photos must be in the order sent. Anything that is not is listed, and Push again resends.
const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()
export type SyncCheck = { synced: boolean; missing: string[] }
export async function verifyPush(r: RegenResult, diff: ReturnType<typeof regenDiff>, done: string[]): Promise<SyncCheck> {
  const missing: string[] = []
  if (done.includes('copy') && r.copy) {
    try {
      const live = await call('/api/listing-content?listingId=' + encodeURIComponent(r.listingId))
      if (diff.titleChanged && !same(live.title || '', diff.title)) missing.push('title')
      for (const k of diff.sections) {
        const sent = k === 'summary' ? fitToCap(r.copy.proposed[k], 500).text : r.copy.proposed[k]
        if (!same(live.sections?.[k] || '', sent)) missing.push(k)
      }
    } catch (e: any) { missing.push('copy (could not read Guesty: ' + String(e?.message || e) + ')') }
  }
  if (done.includes('photos')) {
    try {
      const c = await call('/api/photos/guesty-check?listing=' + encodeURIComponent(r.listingId))
      const row = (c.results || [])[0]
      if (row && (row.orderDiffers || row.onlyInLighthouse > 0 || row.captionDiffs > 0)) missing.push('photos' + (row.orderDiffers ? ' (order)' : '') + (row.captionDiffs ? ` (${row.captionDiffs} captions)` : ''))
    } catch (e: any) { missing.push('photos (could not read Guesty: ' + String(e?.message || e) + ')') }
  }
  return { synced: missing.length === 0, missing }
}
