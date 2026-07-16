// Reschedule a task — but ONLY onto a day the unit is actually free.
// Rule (Jon): a task may only move to a CHECKOUT day or a VACANT day. If a guest is in the unit
// that day, refuse and say 'Active reservation'. Same walk-in rule as the vacant list.
//
// GET  ?listingId=&taskId=  -> next 14 days, each marked vacant | checkout | occupied (+ guest)
// POST { taskId, listingId, date } -> RE-CHECKS occupancy server-side, then moves the task.
// The re-check matters: a booking can land between the page loading and the click, so the UI
// greying out a day is not a guarantee — the server is the one that must say no.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { updateBreezewayTask } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const LIVE = /confirm|checked/i
const HORIZON = 14
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(iso: string, n: number) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

// One source of truth for 'is this unit free on day D'.
async function dayStates(listingId: string, today: string) {
  const db = supabaseAdmin()
  const end = addDays(today, HORIZON)
  const { data: res } = await db.from('guesty_reservations')
    .select('check_in,check_out,status,guest_name')
    .eq('listing_id', listingId).lte('check_in', end).gte('check_out', today).limit(200)
  const live = ((res || []) as any[]).filter(r => LIVE.test(str(r.status)))
  const days: { date: string; state: string; guest: string | null; allowed: boolean }[] = []
  for (let i = 0; i <= HORIZON; i++) {
    const d = addDays(today, i)
    // OCCUPIED = a live stay spans this day (check_in <= d < check_out).
    // A checkout on d does NOT span d, so checkout days stay free — unless someone checks IN on d.
    const occ = live.filter(r => str(r.check_in).slice(0, 10) <= d && str(r.check_out).slice(0, 10) > d)[0]
    const out = live.filter(r => str(r.check_out).slice(0, 10) === d)[0]
    const state = occ ? 'occupied' : (out ? 'checkout' : 'vacant')
    days.push({ date: d, state, guest: occ ? (occ.guest_name || 'Guest') : null, allowed: !occ })
  }
  return days
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const listingId = String(new URL(req.url).searchParams.get('listingId') || '').trim()
    if (!listingId) return NextResponse.json({ ok: false, error: 'listingId required' }, { status: 400 })
    const today = ymd(new Date())
    return NextResponse.json({ ok: true, today, days: await dayStates(listingId, today) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))
    const taskId = String(body?.taskId || '').trim()
    const listingId = String(body?.listingId || '').trim()
    const date = String(body?.date || '').trim()
    if (!taskId || !listingId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ ok: false, error: 'taskId, listingId and date are required' }, { status: 400 })
    const today = ymd(new Date())
    if (date < today) return NextResponse.json({ ok: false, error: 'Cannot move a task into the past' }, { status: 400 })
    // RE-CHECK at submit time — the UI's picture may be stale by seconds or hours.
    const days = await dayStates(listingId, today)
    const target = days.filter(d => d.date === date)[0]
    if (!target) return NextResponse.json({ ok: false, error: 'Pick a day within the next ' + HORIZON + ' days' }, { status: 400 })
    if (!target.allowed) {
      return NextResponse.json({ ok: false, blocked: true, state: target.state, guest: target.guest,
        error: 'Active reservation — ' + (target.guest || 'a guest') + ' is in this unit on ' + date + '. Move it to a checkout or vacant day.' }, { status: 409 })
    }
    const r = await updateBreezewayTask(taskId, { scheduled_date: date })
    if (!r.ok) return NextResponse.json({ ok: false, error: 'Breezeway ' + r.status + ': ' + String(r.text || '').slice(0, 160) }, { status: 502 })
    return NextResponse.json({ ok: true, taskId, date, state: target.state })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
