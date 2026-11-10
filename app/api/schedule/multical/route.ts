// THE SCHEDULER'S MULTI-CALENDAR (Jon, 2026-11-10: "Love a multi calendar for scheduler, so we can
// block units, but also filter by checkouts, checkout/arrivals, vacant etc." · "Blocks only for
// certain team" · "calendar on scheduler / multi cal view on tab at top").
//
//   GET  /api/schedule/multical?start=YYYY-MM-DD&days=21
//        → { today, days[], units[{ listingId, unit, building, market, beds, cells[], stays[] }], unsure[], canBlock }
//   POST /api/schedule/multical { op:'block', listingId, from, to, reason, note }
//        → blocks the NIGHTS from..to (inclusive) in Guesty
//
// The cells are the Upkeep calendar's (lib/upkeep-cells): one per unit per day, from the live stays
// and Guesty's own calendar, never guessed — open, out (checkout, nobody in), in (arrival), turn
// (checkout + arrival the same day), stay (guest in all day), block (owner / someone staying), hold
// (any other Guesty block). The page filters on those.
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
import { buildUnitCells, type CalUnit } from '@/lib/upkeep-cells'
import { blockListingNights } from '@/lib/guesty'
import { isLiveStay } from '@/lib/stay-status'
import { getSetting } from '@/lib/app-settings'
import { marketOf, type Market } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const str = (v: any) => String(v ?? '').trim()
const isYmd = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)
const plus = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)

export type MultiCalUnit = CalUnit & { market: Market; beds: number | null }
export type MultiCalData = { ok: true; today: string; start: string; days: string[]; units: MultiCalUnit[]; unsure: string[]; canBlock: boolean }

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
async function liveListings() {
  const db = supabaseAdmin()
  const r = await pageRows<any>((a, b) => db.from('guesty_listings').select('id,nickname,title,building,unit,bedrooms,status,address_city').order('id').range(a, b), 3)
  return (r.rows as any[]).filter(l => {
    const st = str(l.status).toLowerCase()
    if (['inactive', 'disabled', 'archived', 'deleted'].indexOf(st) >= 0) return false
    return !/\bfull\b/i.test(str(l.nickname || l.title))
  }).map(l => ({
    id: str(l.id),
    market: marketOf(l.building, l.address_city, l.nickname || l.title),
    beds: l.bedrooms == null ? null : Number(l.bedrooms),
  }))
}

export async function GET(req: NextRequest) {
  const gate = await requireLevel('schedule', 'view')
  if (!gate.ok) return gate.res
  const today = ymd(new Date())
  const sp = req.nextUrl.searchParams
  const start = isYmd(str(sp.get('start'))) ? str(sp.get('start')) : today
  const n = Math.min(42, Math.max(7, Number(sp.get('days')) || 21))
  try {
    const ls = await liveListings()
    const meta: Record<string, { market: Market; beds: number | null }> = {}
    for (const l of ls) meta[l.id] = { market: l.market, beds: l.beds }
    const out = await buildUnitCells(ls.map(l => l.id), 'housekeeping', start, n)
    const units: MultiCalUnit[] = out.units
      .map(u => ({ ...u, market: meta[u.listingId]?.market || 'Miami', beds: meta[u.listingId]?.beds ?? null }))
      .sort((a, b) => a.market.localeCompare(b.market) || a.building.localeCompare(b.building) || a.unit.localeCompare(b.unit, 'en', { numeric: true }))
    const body: MultiCalData = { ok: true, today, start, days: out.days, units, unsure: out.unsure, canBlock: await mayBlock(gate.access) }
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
