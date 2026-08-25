// EVE LOOKING AT THINGS.
//
// Jon, 2026-08-24: "Just get smart slowly but daily better to view, learn and improve right, what
// makes you better is you can see things too."
//
// He is right, and it corrects what I proposed an hour ago. I argued against a vision pass on the
// grounds that the guidebook pipeline already produces photo labels as a by-product, so we should
// just run more guidebooks. That treats seeing as a SIDE EFFECT of some other job. It is not. It is
// a sense. An assistant that can read every number about a unit and cannot look at it is missing
// the thing a person would use first, and no amount of metadata substitutes for it — you cannot
// answer "is this sofa the one in the photos" or "does that balcony have a rail" from an amenity
// list.
//
// TWO RULES, BOTH FROM HIS SENTENCE.
//
//   SLOWLY BUT DAILY. There is no big-bang scan. A quota of photos gets looked at each night,
//   worst-covered units first. Cheaper, self-healing when new photos land, never spikes a bill, and
//   a job that fails halfway costs one night rather than a whole run.
//
//   THE QUOTA DEFAULTS TO ZERO, AND THAT IS DELIBERATE. Jon, on being told what the nightly pass
//   would cost: "only if you think this is useful." Held to that honestly, the nightly pass over
//   LISTING photos does not earn it. Those are marketing photos — professionally staged, shot on
//   listing day, sometimes years old. They tell you what the unit looked like when a photographer
//   was there, not what it looks like now, so the "operator flags" that were the best argument for
//   the pass are the thing those photos are least able to show. And Guesty already holds the
//   amenity list as structured data, which beats inferring a dishwasher from a countertop.
//
//   So the background pass ships OFF. Set eve_vision_nightly_quota in app_settings to switch it on
//   for a specific reason. The capability that does earn its place is the on-demand one below, and
//   the honest next step is pointing this at OPERATIONAL photos — audit_items, claim_items, glitch
//   and inspection captures — where the picture is current and a second pair of eyes adds something
//   a caption does not.
//
//   SHE CAN LOOK NOW. The quota is the background. On top of it she has a tool that looks at a unit
//   ON DEMAND — if we have not seen it yet, she opens a handful of photos and answers from what is
//   actually there. Seeing is not something she waits for a cron to grant her.
//
// ON MODEL CHOICE. Classifying a room is a cheap job, not a hard one, and the whole portfolio costs
// single-digit dollars either way. The default is the Sonnet model already proven elsewhere in this
// codebase rather than a Haiku id I have not verified against this account — a wrong model string
// fails silently at 3am and nobody finds out for a week. Override it in app_settings under
// "eve_vision_model" once a cheaper id is confirmed working.
import 'server-only'
import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting } from '@/lib/app-settings'
import { lc, DEAD_LISTING } from './ctx'

const DEFAULT_MODEL = 'claude-sonnet-4-6'
const VISION_MODEL_KEY = 'eve_vision_model'
const QUOTA_KEY = 'eve_vision_nightly_quota'

export type Seen = {
  url: string
  room: string          // kitchen | bedroom | bathroom | living | balcony | exterior | amenity | other
  label: string         // what is actually in it, in a few words
  appliance: string | null
  quality: number       // 1-5, how good a photo it is
  notes: string | null  // anything a person would want flagged: damage, clutter, dated fittings
}

function idFor(listingId: string, url: string): string {
  return String(listingId) + ':' + createHash('sha256').update(String(url)).digest('hex').slice(0, 16)
}

const SYSTEM = `You are cataloguing photographs of short-term rental apartments so an operations assistant can answer questions about what is actually in each unit.

For EACH image return one object:
  i         the index you were given
  room      one of: kitchen, bedroom, bathroom, living, dining, balcony, exterior, amenity, hallway, laundry, other
  label     what the photo shows, in under twelve words, concrete and specific
  appliance if a specific appliance or fixture is the subject, name it exactly (e.g. "Nespresso Vertuo", "stacked LG washer dryer"); otherwise null
  quality   1-5 for how usable the photograph is
  notes     anything an operator would want to know — visible damage, wear, clutter, dated fittings, a missing item — or null

Describe ONLY what is visible. Do not infer that a unit has something because apartments usually do. If an image is a floor plan, a logo or a text card, set room to "other" and say so in label.

Return a JSON array and nothing else.`

async function callVision(key: string, model: string, urls: string[]): Promise<Seen[] | null> {
  const content: any[] = []
  urls.forEach((u, i) => {
    content.push({ type: 'text', text: `Image ${i}:` })
    content.push({ type: 'image', source: { type: 'url', url: u } })
  })
  content.push({ type: 'text', text: `Return the JSON array for images 0 to ${urls.length - 1}.` })

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 2000, system: SYSTEM, messages: [{ role: 'user', content }] }),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) return null
    const text = Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('') : ''
    const m = text.match(/\[[\s\S]*\]/)
    if (!m) return null
    const rows: any[] = JSON.parse(m[0])
    return rows.map((x: any) => {
      const i = Number(x?.i)
      const url = Number.isFinite(i) && urls[i] ? urls[i] : ''
      if (!url) return null
      return {
        url,
        room: String(x?.room || 'other').toLowerCase().slice(0, 20),
        label: String(x?.label || '').slice(0, 120),
        appliance: x?.appliance ? String(x.appliance).slice(0, 80) : null,
        quality: Math.min(Math.max(Number(x?.quality) || 3, 1), 5),
        notes: x?.notes ? String(x.notes).slice(0, 240) : null,
      } as Seen
    }).filter(Boolean) as Seen[]
  } catch { return null }
}

async function saveSeen(listingId: string, rows: Seen[], model: string): Promise<number> {
  if (!rows.length) return 0
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const payload = rows.map(r => ({
    id: idFor(listingId, r.url), listing_id: String(listingId), url: r.url,
    room: r.room, label: r.label, appliance: r.appliance, quality: r.quality, notes: r.notes,
    model, seen_at: now,
  }))
  const { error } = await db.from('listing_photo_vision').upsert(payload, { onConflict: 'id' })
  return error ? 0 : payload.length
}

function picturesOf(l: any): string[] {
  const pics: any[] = Array.isArray(l?.pictures) ? l.pictures : (Array.isArray(l?.raw?.pictures) ? l.raw.pictures : [])
  return pics.map((p: any) => String(p?.original || p?.large || p?.url || p?.thumbnail || p || '')).filter(u => /^https?:\/\//.test(u))
}

/**
 * Look at ONE unit now. Returns what we have already seen, and — when asked and when there is
 * anything unseen — opens a few more photos on the spot. This is the difference between an
 * assistant that has read a report about a room and one that has looked at it.
 */
export async function lookAtUnit(listingId: string, opts?: { lookNow?: boolean; max?: number }): Promise<{
  seen: Seen[]; total: number; unseen: number; lookedNow: number; error?: string
}> {
  const db = supabaseAdmin()
  const { data: ls } = await db.from('guesty_listings').select('id,pictures,raw').eq('id', String(listingId)).limit(1)
  const l: any = (ls || [])[0]
  if (!l) return { seen: [], total: 0, unseen: 0, lookedNow: 0, error: 'listing not found' }
  const urls = picturesOf(l)

  const { data: have } = await db.from('listing_photo_vision').select('url,room,label,appliance,quality,notes')
    .eq('listing_id', String(listingId)).order('room').limit(300)
  const seen: Seen[] = (have || []) as any
  const seenUrls = new Set(seen.map(s => s.url))
  let unseen = urls.filter(u => !seenUrls.has(u))

  let lookedNow = 0
  if (opts?.lookNow && unseen.length) {
    const key = process.env.ANTHROPIC_API_KEY || ''
    if (!key) return { seen, total: urls.length, unseen: unseen.length, lookedNow: 0, error: 'No ANTHROPIC_API_KEY set, so I cannot look at anything.' }
    const model = await getSetting<string>(VISION_MODEL_KEY, DEFAULT_MODEL)
    const batch = unseen.slice(0, Math.min(opts?.max || 8, 12))
    const rows = await callVision(key, model, batch)
    if (rows?.length) {
      lookedNow = await saveSeen(String(listingId), rows, model)
      seen.push(...rows)
      unseen = unseen.filter(u => !rows.some(r => r.url === u))
    }
  }
  return { seen, total: urls.length, unseen: unseen.length, lookedNow }
}

/**
 * The nightly quota. Worst-covered units first, a fixed number of photos, then stop.
 *
 * DEFAULTS TO OFF. See the header: a scheduled crawl over staged marketing photos is motion rather
 * than progress. This exists so it can be switched on deliberately — for a specific question, or
 * once it is pointed at photographs that show a unit as it is today rather than as it was sold.
 */
export async function nightlyVision(quotaOverride?: number): Promise<{
  ok: boolean; looked: number; units: number; quota: number; skipped?: string; errors: string[]
}> {
  const errors: string[] = []
  const key = process.env.ANTHROPIC_API_KEY || ''
  if (!key) return { ok: false, looked: 0, units: 0, quota: 0, skipped: 'no ANTHROPIC_API_KEY', errors }

  // Off unless somebody turned it on, for the reasons in the header.
  const quota = Math.min(Math.max(quotaOverride ?? await getSetting<number>(QUOTA_KEY, 0), 0), 1000)
  if (!quota) return { ok: true, looked: 0, units: 0, quota: 0, skipped: 'nightly quota is 0 — background photo scanning is off by default', errors }

  const db = supabaseAdmin()
  const model = await getSetting<string>(VISION_MODEL_KEY, DEFAULT_MODEL)

  const { data: ls } = await db.from('guesty_listings').select('id,nickname,title,status,pictures,raw').order('id').limit(400)
  const live = (ls || []).filter((l: any) => !DEAD_LISTING.test(lc(l.status)))
  const { data: have } = await db.from('listing_photo_vision').select('listing_id,url').limit(20000)
  const seenBy: Record<string, Set<string>> = {}
  for (const r of (have || [])) {
    const row: any = r
    ;(seenBy[String(row.listing_id)] ||= new Set()).add(String(row.url))
  }

  // Worst-covered first: a unit we have never looked at teaches us more than the 31st photo of one
  // we already know.
  const work = live.map((l: any) => {
    const urls = picturesOf(l)
    const seen = seenBy[String(l.id)] || new Set()
    return { id: String(l.id), unseen: urls.filter(u => !seen.has(u)), coverage: urls.length ? seen.size / urls.length : 1 }
  }).filter(w => w.unseen.length).sort((a, b) => a.coverage - b.coverage)

  let looked = 0
  let units = 0
  for (const w of work) {
    if (looked >= quota) break
    units++
    // Cap per unit so one 60-photo listing cannot eat a whole night and starve everything else.
    const take = w.unseen.slice(0, Math.min(quota - looked, 24))
    for (let i = 0; i < take.length; i += 8) {
      if (looked >= quota) break
      const batch = take.slice(i, i + 8)
      const rows = await callVision(key, model, batch)
      if (!rows) { errors.push(`vision failed on ${w.id}`); break }
      looked += await saveSeen(w.id, rows, model)
      await new Promise(r => setTimeout(r, 200))
    }
  }
  return { ok: true, looked, units, quota, errors }
}

/** Portfolio coverage — how much of the estate Eve has actually laid eyes on. */
export async function visionCoverage(): Promise<{ units: number; photos: number; seen: number; unitsFullySeen: number; unitsNeverSeen: number }> {
  const db = supabaseAdmin()
  const { data: ls } = await db.from('guesty_listings').select('id,status,pictures,raw').order('id').limit(400)
  const live = (ls || []).filter((l: any) => !DEAD_LISTING.test(lc(l.status)))
  const { data: have } = await db.from('listing_photo_vision').select('listing_id,url').limit(20000)
  const seenBy: Record<string, Set<string>> = {}
  for (const r of (have || [])) (seenBy[String((r as any).listing_id)] ||= new Set()).add(String((r as any).url))

  let photos = 0, seen = 0, full = 0, never = 0
  for (const l of live) {
    const urls = picturesOf(l)
    const s = seenBy[String(l.id)] || new Set()
    photos += urls.length
    const n = urls.filter(u => s.has(u)).length
    seen += n
    if (urls.length && n >= urls.length) full++
    if (urls.length && n === 0) never++
  }
  return { units: live.length, photos, seen, unitsFullySeen: full, unitsNeverSeen: never }
}
