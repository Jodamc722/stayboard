// DAILY ACTIVATION SYNC for the guest guide pages.
//
// The hotel publishes its programme on its own events calendar ("The Daily Fun-cast"). This job
// reads that page every morning, turns it into our Activation shape and writes it into the guide
// so /guide/<slug> is never showing last month's line-up.
//
// GET  - what the Vercel cron calls (auth: CRON_SECRET bearer when configured, else open).
// POST - what the admin "Sync now" button calls (auth: session, guide cookie, or admin password).
//
// SAFE MERGE: only items this job created (src: 'web') are replaced. Anything typed by hand on
// the page survives, so a manual one-off is never wiped by the scrape.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createClient } from '@/lib/supabase-server'
import { adminPasswordOk } from '@/lib/shareAuth'
import { verifyEditToken } from '@/lib/edit-access'
import { guideKey, normSlug, seedFor, todayIso, DOW_NAMES, type Guide, type Activation } from '@/lib/guide'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DEFAULT_SOURCE = 'https://www.thegardenhotelandresort.com/the-daily-fun-cast/'
const GUIDE_COOKIE = 'sb_guide'
const SRC = 'web'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

function parseJson(raw: string): any {
  const t = (s: string) => { try { return JSON.parse(s) } catch { return null } }
  let o = t(raw)
  // Models sometimes wrap JSON in a code fence or a sentence; take what is between the braces.
  if (!o) { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); if (a !== -1 && b > a) o = t(raw.slice(a, b + 1)) }
  return o && typeof o === 'object' ? o : null
}

// HTML -> readable text. Scripts and styles out, tags to spaces, entities back to characters.
function textOf(html: string): string {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/&quot;|&#8220;|&#8221;/gi, '"').replace(/&#8211;|&ndash;/gi, '-').replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

async function readGuide(slug: string): Promise<Guide> {
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', guideKey(slug)).limit(1)
    const row = (data || [])[0] as any
    if (row && row.value) {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
      if (parsed && typeof parsed === 'object') return parsed as Guide
    }
  } catch { /* seed below */ }
  return seedFor(slug)
}

async function writeGuide(slug: string, content: Guide): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabaseAdmin().from('app_settings').upsert(
      { key: guideKey(slug), value: JSON.stringify(content), updated_by: 'activation-sync', updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}

const SYSTEM = [
  'You read a hotel events calendar and return its programme as strict JSON. No prose, no markdown.',
  'Shape: {"events":[{"name":"","time":"","where":"","desc":"","repeat":"daily|weekly|once","dow":0,"date":"YYYY-MM-DD","at":"HH:MM"}]}',
  'Rules:',
  '- name: the event as guests would say it, title case, no emoji, no venue suffix.',
  '- time: exactly how the page words it ("3 - 6 PM", "8 PM", "10:30 AM").',
  '- at: 24h start time, for ordering.',
  '- repeat "daily" for everyday things; "weekly" with dow (0 Sunday .. 6 Saturday) for a weekday pattern;',
  '  "once" with date for a dated one-off. Never invent a schedule the page does not state.',
  '- where: the venue named on the page, else "".',
  '- desc: one short sentence from the page, or "" if there is none. Never write marketing copy of your own.',
  '- Skip anything that is not a guest-facing event (menus, room offers, navigation, footer text).',
  '- Return at most 25 events, soonest first. If the page shows nothing, return {"events":[]}.',
].join('\n')

async function scrape(sourceUrl: string): Promise<{ events: Activation[]; error?: string; chars?: number }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { events: [], error: 'AI not configured' }
  let html = ''
  try {
    const r = await fetch(sourceUrl, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; StayBoardGuide/1.0)' },
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    })
    if (!r.ok) return { events: [], error: 'Source returned ' + r.status }
    html = await r.text()
  } catch (e: any) { return { events: [], error: 'Fetch failed: ' + String(e?.message || e) } }

  const text = textOf(html).slice(0, 18000)
  if (text.length < 200) return { events: [], error: 'Source page had no readable text' }

  const today = todayIso()
  const USER = 'TODAY IS ' + today + ' (America/New_York).\n\nCALENDAR PAGE TEXT:\n' + text

  let parsed: any = null
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, system: SYSTEM, messages: [{ role: 'user', content: USER }] }),
      signal: AbortSignal.timeout(45000),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) return { events: [], error: 'AI ' + r.status + ' ' + str(d?.error?.message).slice(0, 120), chars: text.length }
    parsed = parseJson(Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('') : '')
  } catch (e: any) { return { events: [], error: 'AI call failed: ' + String(e?.message || e), chars: text.length } }

  const out: Activation[] = []
  for (const e of (parsed?.events || [])) {
    const name = str(e?.name).trim()
    if (!name) continue
    const repeat = /^(daily|weekly|once)$/.test(str(e?.repeat)) ? str(e?.repeat) as 'daily' | 'weekly' | 'once' : 'weekly'
    const dowNum = Number(e?.dow)
    const dow = repeat === 'weekly' && dowNum >= 0 && dowNum <= 6 ? dowNum : undefined
    const date = /^\d{4}-\d{2}-\d{2}$/.test(str(e?.date)) ? str(e?.date) : ''
    if (repeat === 'once' && !date) continue
    // A one-off that has already been and gone is not news to a guest reading today.
    if (repeat === 'once' && date < today) continue
    const day = repeat === 'daily' ? 'Daily' : repeat === 'weekly' ? DOW_NAMES[dow == null ? 6 : dow] : date
    out.push({
      day,
      time: str(e?.time).trim().slice(0, 40),
      name: name.slice(0, 80),
      where: str(e?.where).trim().slice(0, 60),
      desc: str(e?.desc).trim().slice(0, 240),
      repeat,
      ...(dow == null ? {} : { dow }),
      ...(repeat === 'once' ? { date } : {}),
      ...(/^\d{1,2}:\d{2}$/.test(str(e?.at)) ? { at: str(e?.at) } : {}),
      src: SRC,
    })
    if (out.length >= 25) break
  }
  return { events: out, chars: text.length }
}

async function run(slug: string) {
  const content = await readGuide(slug)
  const acts = (content.activations && content.activations.items) || []
  const source = str(content.activations && (content.activations as any).source) || DEFAULT_SOURCE
  const { events, error, chars } = await scrape(source)
  if (error) return { ok: false, error, source, chars }
  // Nothing parsed is treated as a bad read, not as "the hotel cancelled everything".
  if (!events.length) return { ok: false, error: 'No events found on the source page', source, chars }

  const manual = acts.filter(a => str((a as any).src) !== SRC)
  const next: Guide = {
    ...content,
    activations: {
      ...content.activations,
      items: events.concat(manual),
      source,
      syncedAt: new Date().toISOString(),
    } as any,
  }
  const saved = await writeGuide(slug, next)
  if (!saved.ok) return { ok: false, error: saved.error || 'Save failed', source }
  return { ok: true, source, synced: events.length, kept: manual.length, syncedAt: (next.activations as any).syncedAt }
}

function slugOf(req: NextRequest): string {
  return normSlug(new URL(req.url).searchParams.get('slug') || 'garden') || 'garden'
}

// Vercel cron. Open when CRON_SECRET is unset so the schedule works without extra configuration.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    if (auth !== 'Bearer ' + secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const slugs = str(new URL(req.url).searchParams.get('slugs') || slugOf(req)).split(',').map(normSlug).filter(Boolean)
  const results: any[] = []
  for (const s of slugs.slice(0, 10)) results.push({ slug: s, ...(await run(s)) })
  return NextResponse.json({ ok: results.some(r => r.ok), results })
}

// The "Sync now" button on the page.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  let allowed = false
  try {
    const { data } = await createClient().auth.getUser()
    allowed = !!(data && data.user)
  } catch { allowed = false }
  if (!allowed) { try { allowed = verifyEditToken(cookies().get(GUIDE_COOKIE)?.value) } catch { allowed = false } }
  if (!allowed) {
    const gate = await adminPasswordOk(str(body?.adminPassword))
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.reason || 'Locked' }, { status: 401 })
  }
  const slug = normSlug(str(body?.slug)) || slugOf(req)
  const res = await run(slug)
  const fresh = await readGuide(slug)
  return NextResponse.json({ ...res, content: fresh }, { status: res.ok ? 200 : 502 })
}
