// THE SCHEDULER'S MULTI-CALENDAR (Jon, 2026-11-10: "Love a multi calendar for scheduler, so we can
// block units, but also filter by checkouts, checkout/arrivals, vacant etc." · "Blocks only for
// certain team" · "calendar on scheduler / multi cal view on tab at top").
//
//   GET  /api/schedule/multical?start=YYYY-MM-DD&days=21
//        → { today, days[], units[{ listingId, unit, building, market, beds, cells[], stays[] }], unsure[], canBlock }
//   POST /api/schedule/multical { op:'block', listingId, from, to, reason, note }
//        → blocks the NIGHTS from..to (inclusive) in Guesty
//
// REVAMP (Jon, 2026-11-10: "not great … blocking hard to do, hard to see, really ugly" → mockup
// approved "better"). The page gets the raw material and works out each day itself: the live stays
// (with their Guesty notes, and isNew for a booking made in the last 36h — "just say new booking"),
// and Guesty's own blocks collapsed into runs of nights with their reason and note.
//
// WHO MAY BLOCK. Blocking closes the dates on every channel, so it is gated twice: 'schedule' at edit
// level (the page's own write gate), AND the person is an admin, carries the per-person feature flag
// `calendar_blocker`, or is on the list in app_settings 'multical_blockers' ({ emails: [...] }).
// Until Jon names people, that means admins only.
// The server re-reads the stays before writing and refuses any night a live stay covers.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pageRows } from '@/lib/db-page'
import { blockListingNights, getMultiCalendar, isOpsBlock } from '@/lib/guesty'
import { rollupBuilding } from '@/lib/optimize-score'
import { isLiveStay } from '@/lib/stay-status'
import { getSetting } from '@/lib/app-settings'
import { marketOf, type Market } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const str = (v: any) => String(v ?? '').trim()
const isYmd = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)
const plus = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)

export type McUnit = { listingId: string; unit: string; building: string; market: Market; beds: number | null }
export type McStay = { id: string; listingId: string; guest: string; ci: string; co: string; nights: number; source: string | null; owner: boolean; note: string | null; isNew: boolean }
export type McBlock = { listingId: string; from: string; to: string; kind: 'owner' | 'hold'; label: string; note: string | null }
export type MultiCalData = { ok: true; today: string; start: string; days: string[]; units: McUnit[]; stays: McStay[]; blocks: McBlock[]; unsure: string[]; canBlock: boolean }

/** A new booking = made in the last 36 hours, the same window the Board uses. */
const NEW_MS = 36 * 3600_000

async function mayBlock(access: any): Promise<boolean> {
  if (access?.role === 'admin') return true
  if (String(access?.email || '').toLowerCase() === 'jon@stay-hospitality.com') return true
  if ((access?.features as any)?.calendar_blocker === true) return true // per-person flag, like door_code_approver
  const email = String(access?.email || '').toLowerCase()
  if (!email) return false
  const v = await getSetting<any>('multical_blockers', null).catch(() => null)
  const list: string[] = Array.isArray(v?.emails) ? v.emails.map((x: any) => String(x).toLowerCase().trim()) : []
  return list.indexOf(email) >= 0
}

/** Every live VR listing, with its market — the same exclusions the owner reports use. */
async function liveListings(): Promise<McUnit[]> {
  const db = supabaseAdmin()
  const r = await pageRows<any>((a, b) => db.from('guesty_listings').select('id,nickname,title,building,unit,bedrooms,status,address_city').order('id').range(a, b), 3)
  return (r.rows as any[]).filter(l => {
    const st = str(l.status).toLowerCase()
    if (['inactive', 'disabled', 'archived', 'deleted'].indexOf(st) >= 0) return false
    return !/\bfull\b/i.test(str(l.nickname || l.title))
  }).map(l => ({
    listingId: str(l.id),
    unit: str(l.unit) || str(l.nickname || l.title),
    building: rollupBuilding(str(l.building), str(l.nickname || l.title)) || 'Other',
    market: marketOf(l.building, l.address_city, l.nickname || l.title),
    beds: l.bedrooms == null ? null : Number(l.bedrooms),
  }))
}

/** Guesty notes come as a string or as { guest, other, … }; one readable line either way. */
function noteText(col: any, raw: any): string | null {
  const parts: string[] = []
  if (typeof col === 'string' && col.trim()) parts.push(col.trim())
  if (raw && typeof raw === 'object') {
    for (const v of Object.values(raw)) { if (typeof v === 'string' && v.trim() && parts.indexOf(v.trim()) < 0) parts.push(v.trim()) }
  } else if (typeof raw === 'string' && raw.trim() && parts.indexOf(raw.trim()) < 0) parts.push(raw.trim())
  const t = parts.join(' · ').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, 500) : null
}

export async function GET(req: NextRequest) {
  const gate = await requireLevel('schedule', 'view')
  if (!gate.ok) return gate.res
  const today = ymd(new Date())
  const sp = req.nextUrl.searchParams
  const start = isYmd(str(sp.get('start'))) ? str(sp.get('start')) : plus(today, -2)
  const n = Math.min(42, Math.max(7, Number(sp.get('days')) || 21))
  const days = Array.from({ length: n }, (_, i) => plus(start, i))
  const last = days[days.length - 1]
  const unsure: string[] = []
  try {
    const units = (await liveListings())
      .sort((a, b) => a.market.localeCompare(b.market) || a.building.localeCompare(b.building) || a.unit.localeCompare(b.unit, 'en', { numeric: true }))
    const ids = units.map(u => u.listingId)
    const db = supabaseAdmin()
    const [res, cal] = await Promise.all([
      pageRows<any>((a, b) => db.from('guesty_reservations')
        .select('id,listing_id,check_in,check_out,status,guest_name,source,nights,created_at,notes,raw_notes:raw->notes')
        .in('listing_id', ids).gte('check_out', start).lte('check_in', last).order('id').range(a, b), 10),
      getMultiCalendar(ids, start, last).catch(() => null),
    ])
    if (res.truncated) unsure.push('some reservations could not be read')
    if (!cal) unsure.push('Guesty blocks could not be read — owner stays and holds may be missing')
    const now = Date.now()
    const stays: McStay[] = []
    for (const r of (res.rows as any[])) {
      if (!isLiveStay(r.status)) continue
      const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
      if (!ci || !co) continue
      const t = Date.parse(str(r.created_at))
      stays.push({
        id: str(r.id), listingId: str(r.listing_id), guest: str(r.guest_name) || 'Guest', ci, co,
        nights: Number(r.nights) || Math.max(1, Math.round((Date.parse(co) - Date.parse(ci)) / 86400000)),
        source: r.source ? str(r.source) : null, owner: /^owner/i.test(str(r.source)),
        note: noteText(r.notes, r.raw_notes),
        isNew: Number.isFinite(t) && now - t <= NEW_MS,
      })
    }
    // Guesty blocks (not reservations), collapsed into runs of nights with their label and note.
    const byL: Record<string, { d: string; label: string; note: string | null; occupied: boolean; ref: string }[]> = {}
    for (const d of (cal || [])) {
      if (!isOpsBlock(d)) continue
      const ref = d.refs?.[0]
      const label = (ref?.reason || 'Blocked').slice(0, 40)
      const note = (ref?.note || d.note || null)
      const keys = Object.keys(d.blocks || {}).filter(k => (d.blocks as any)[k]).map(k => k.toLowerCase())
      const occupied = keys.includes('o') || String(ref?.type || '').toLowerCase() === 'o' || /owner|stay|guest|family|friend|tenant|personal use/i.test(label + ' ' + (note || ''))
      ;(byL[d.listingId] = byL[d.listingId] || []).push({ d: d.date, label, note: note ? String(note).slice(0, 300) : null, occupied, ref: ref?.id || label + (note || '') })
    }
    const blocks: McBlock[] = []
    for (const lid of Object.keys(byL)) {
      const list = byL[lid].sort((x, y) => x.d.localeCompare(y.d))
      let cur: McBlock | null = null, curRef = ''
      for (const x of list) {
        if (cur && curRef === x.ref && plus(cur.to, 1) === x.d) { cur.to = x.d; continue }
        cur = { listingId: lid, from: x.d, to: x.d, kind: x.occupied ? 'owner' : 'hold', label: x.label, note: x.note }
        curRef = x.ref
        blocks.push(cur)
      }
    }
    const body: MultiCalData = { ok: true, today, start, days, units, stays, blocks, unsure, canBlock: await mayBlock(gate.access) }
    return NextResponse.json(body)
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('schedule', 'edit')
  if (!gate.ok) return gate.res
  if (!(await mayBlock(gate.access))) return NextResponse.json({ error: 'Blocking is limited to approved team members — ask Jon to add you.' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  if (body?.op !== 'block') return NextResponse.json({ error: 'unknown op' }, { status: 400 })
  const listingId = str(body?.listingId)
  const from = str(body?.from).slice(0, 10)
  const to = str(body?.to || body?.from).slice(0, 10)
  const today = ymd(new Date())
  if (!listingId || !isYmd(from) || !isYmd(to) || to < from) return NextResponse.json({ error: 'pick a unit and the nights to block' }, { status: 400 })
  if (from < today) return NextResponse.json({ error: 'pick nights from today on' }, { status: 400 })
  if (plus(from, 60) < to) return NextResponse.json({ error: 'block at most 60 nights at a time' }, { status: 400 })
  const reason = body?.reason === 'Owner block' ? 'Owner block' : body?.reason === 'Other' ? 'Other' : 'Maintenance'
  // Re-read the stays now — never trust the page's copy. Any live stay covering a chosen night stops it.
  const { data: rs } = await supabaseAdmin().from('guesty_reservations').select('check_in,check_out,status,guest_name')
    .eq('listing_id', listingId).lte('check_in', to).gt('check_out', from).limit(20)
  const clash = ((rs || []) as any[]).filter(x => isLiveStay(x.status))
  if (clash.length) return NextResponse.json({ error: `${clash[0].guest_name || 'A guest'} is booked ${str(clash[0].check_in).slice(0, 10)} → ${str(clash[0].check_out).slice(0, 10)} — nothing was blocked` }, { status: 409 })
  const who = String(gate.access?.email || '').split('@')[0] || 'team'
  const note = `${str(body?.note).slice(0, 200) || reason} — blocked from Lighthouse Schedule calendar by ${who}`
  try { await blockListingNights(listingId, from, to, note, reason) } catch (e: any) {
    return NextResponse.json({ error: 'Guesty refused: ' + String(e?.message || e).slice(0, 160) }, { status: 502 })
  }
  return NextResponse.json({ ok: true, listingId, from, to, reason })
}
