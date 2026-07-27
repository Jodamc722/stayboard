// UNIT SIGNALS for Today in Ops — the proactive layer. For every unit on today's board it answers
// three questions a field coordinator would otherwise have to dig for:
//   1. PENDING   - open Breezeway work on this unit from the last 60 days that never got finished
//   2. REVIEW    - a bad review (<=3*) inside the last 5 reviews -> inspection needed
//   3. UPKEEP    - recurring work that has aged out (lock batteries, A/C filter, PM, audit, deep clean)
// It also returns a 14-day occupancy strip so a task can be scheduled on a day the unit is EMPTY.
// Read-only: nothing is created here, the board creates tasks on an explicit click.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function todayET(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }
function addDays(ymd: string, n: number): string { const d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() + n); return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function monthsBetween(from: string, to: string): number { const a = new Date(from + 'T12:00:00'), b = new Date(to + 'T12:00:00'); return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 30.44) }

const isDone = (s: string) => /complete|finish|close|approv/.test(s)
const isGone = (s: string) => /delete|cancel/.test(s)

// Recurring upkeep the ops team owns. `every` is in MONTHS; `match` is tested against the
// Breezeway task NAME of completed work, so "when was this last actually done" comes straight
// from the field, not a spreadsheet. Add a row here to track another recurring job.
const UPKEEP: { key: string; label: string; short: string; every: number; match: RegExp; template: string }[] = [
  { key: 'batteries', label: 'Change lock batteries', short: 'Lock batteries', every: 12, match: /batter/i, template: 'batteries' },
  { key: 'acfilter', label: 'Change A/C filter', short: 'A/C filter', every: 3, match: /a\/?c filter|air filter|hvac filter|filter change|change filter/i, template: 'acfilter' },
  { key: 'pm', label: 'Preventative maintenance due', short: 'PM check', every: 6, match: /preventative|preventive|(^|\s)pm(\s|$)/i, template: 'pm' },
  { key: 'audit', label: 'Annual quality audit due', short: 'Quality audit', every: 12, match: /audit/i, template: 'audit' },
  { key: 'deepclean', label: 'Deep clean due', short: 'Deep clean', every: 6, match: /deep clean/i, template: 'deepclean' },
]
// Names that are day-to-day turnover work, never "upkeep" — excluded from the discovery catalog.
const ROUTINE = /departure clean|turnover clean|strip|walkthrough|unit check|guest reported|glitch|field reported|inspection/i

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const sp = req.nextUrl.searchParams
    const ids = str(sp.get('ids')).split(',').map(s => s.trim()).filter(Boolean).slice(0, 150)
    if (!ids.length) return NextResponse.json({ ok: true, signals: {} })
    const today = todayET()
    const pendingFrom = addDays(today, -60)   // open work from the last 60 days still counts
    const historyFrom = addDays(today, -800)  // enough history to age a 12-month cadence
    const calTo = addDays(today, 14)
    const db = supabaseAdmin()

    const [tasksR, revR, resR] = await Promise.all([
      db.from('breezeway_tasks_sync')
        .select('id,reference_property_id,name,status,scheduled_date,finished_at,type_department,report_url')
        .in('reference_property_id', ids).gte('scheduled_date', historyFrom).limit(8000),
      db.from('guesty_reviews')
        .select('id,listing_id,rating,content,guest_name,created_at,channel')
        .in('listing_id', ids).order('created_at', { ascending: false }).limit(3000),
      db.from('guesty_reservations')
        .select('listing_id,check_in,check_out,status,guest_name')
        .in('listing_id', ids).in('status', ['confirmed', 'closed'])
        .lt('check_in', calTo).gte('check_out', today).limit(3000),
    ])
    const tasks = (tasksR.data || []) as any[]
    const reviews = (revR.data || []) as any[]
    const res = (resR.data || []) as any[]

    // group by listing
    const byListing: Record<string, any[]> = {}
    for (const t of tasks) { const k = str(t.reference_property_id); (byListing[k] = byListing[k] || []).push(t) }
    const revByListing: Record<string, any[]> = {}
    for (const r of reviews) { const k = str(r.listing_id); (revByListing[k] = revByListing[k] || []).push(r) }
    const resByListing: Record<string, any[]> = {}
    for (const r of res) { const k = str(r.listing_id); (resByListing[k] = resByListing[k] || []).push(r) }

    const signals: Record<string, any> = {}
    const catalog: Record<string, number> = {}

    for (const id of ids) {
      const mine = byListing[id] || []

      // 1. PENDING — scheduled in the last 60 days, before today, still not done
      const pending = mine
        .filter(t => {
          const d = str(t.scheduled_date).slice(0, 10)
          const st = str(t.status).toLowerCase()
          return d >= pendingFrom && d < today && !t.finished_at && !isDone(st) && !isGone(st)
        })
        .sort((a, b) => str(a.scheduled_date).localeCompare(str(b.scheduled_date)))
        .map(t => ({
          id: str(t.id), name: str(t.name), date: str(t.scheduled_date).slice(0, 10),
          dept: str(t.type_department), reportUrl: str(t.report_url) || null,
          daysOld: Math.round((new Date(today + 'T12:00:00').getTime() - new Date(str(t.scheduled_date).slice(0, 10) + 'T12:00:00').getTime()) / 86400000),
        }))

      // 2. REVIEW — worst review at or below 3 stars inside the last 5 reviews
      const last5 = (revByListing[id] || []).slice(0, 5)
      let review: any = null
      for (const r of last5) {
        const rating = Number(r.rating)
        if (Number.isFinite(rating) && rating <= 3 && (!review || rating < review.rating)) {
          review = { rating, at: str(r.created_at).slice(0, 10), guest: str(r.guest_name), channel: str(r.channel), excerpt: str(r.content).slice(0, 220), id: str(r.id) }
        }
      }

      // 3. UPKEEP — when was each recurring job last COMPLETED, and is it overdue
      const doneTasks = mine.filter(t => t.finished_at || isDone(str(t.status).toLowerCase()))
      const upkeep: any[] = []
      for (const rule of UPKEEP) {
        let last: string | null = null
        for (const t of doneTasks) {
          if (!rule.match.test(str(t.name))) continue
          const when = str(t.finished_at || t.scheduled_date).slice(0, 10)
          if (when && (!last || when > last)) last = when
        }
        const months = last ? monthsBetween(last, today) : null
        // Never done in the window we can see = treat as due, but say so honestly.
        if (months === null || months >= rule.every) {
          upkeep.push({ key: rule.key, label: rule.label, short: rule.short, template: rule.template, lastAt: last, monthsAgo: months === null ? null : Math.round(months * 10) / 10, every: rule.every, neverSeen: months === null })
        }
      }

      // 14-DAY OCCUPANCY — which days the unit is empty, and where the checkouts land
      const stays = resByListing[id] || []
      const days: any[] = []
      for (let i = 0; i < 14; i++) {
        const d = addDays(today, i)
        let occupied = false, checkout = false, checkin = false
        for (const s of stays) {
          const ci = str(s.check_in).slice(0, 10), co = str(s.check_out).slice(0, 10)
          if (ci <= d && d < co) occupied = true
          if (co === d) checkout = true
          if (ci === d) checkin = true
        }
        days.push({ date: d, occupied, checkout, checkin, free: !occupied })
      }
      const nextFree = (days.filter(d => d.free)[0] || {}).date || null
      const nextCheckout = (days.filter(d => d.checkout)[0] || {}).date || null

      signals[id] = { pending, review, upkeep, days, nextFree, nextCheckout }

      // discovery: what other recurring work exists that we are NOT tracking yet
      for (const t of doneTasks) {
        const nm = str(t.name).trim()
        if (!nm || ROUTINE.test(nm)) continue
        if (UPKEEP.some(r => r.match.test(nm))) continue
        const key = nm.toLowerCase().replace(/[0-9#]+/g, '').replace(/\s+/g, ' ').slice(0, 60)
        catalog[key] = (catalog[key] || 0) + 1
      }
    }

    const discover = sp.get('discover') === '1'
      ? Object.keys(catalog).map(k => ({ name: k, n: catalog[k] })).sort((a, b) => b.n - a.n).slice(0, 40)
      : undefined
    return NextResponse.json({ ok: true, today, signals, discover })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
