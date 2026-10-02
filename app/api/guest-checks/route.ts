// GUEST CHECKS — ID verified, deposit captured (Jon, 2026-10-02). Arrivals today and the next seven
// days whose channel asks for either check (lib/welcome-call-guide channelPolicy), with what we have
// recorded about each (guest_checks, migration 145; a Salato stay verified through its own link counts).
//   GET                                           → { rows, needed, done, canEdit }
//   POST { reservationId, id_status? | deposit_status? | deposit_amount? | note? }
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { channelOf, channelPolicy } from '@/lib/welcome-call-guide'
import { atLeast } from '@/lib/features'
export const dynamic = 'force-dynamic'

export type GuestCheckRow = {
  reservationId: string; guest: string; unit: string; listingId: string; checkIn: string; checkOut: string; channel: string; today: boolean
  needId: boolean; needDeposit: boolean
  idStatus: 'pending' | 'verified' | 'waived'; depositStatus: 'pending' | 'captured' | 'waived'; depositAmount: number | null; note: string | null; by: string | null
  salatoVerified: boolean
}
const str = (v: any) => (v == null ? '' : String(v))
const dayET = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

export async function GET() {
  const g = await requireLevel('welcome-calls', 'view')
  if (!g.ok) return g.res
  const db = supabaseAdmin()
  const today = dayET(), to = addDays(today, 7)
  try {
    const { data: res } = await db.from('guesty_reservations').select('id,listing_id,guest_name,listing_name,check_in,check_out,status,source').gte('check_in', today).lt('check_in', addDays(to, 1)).limit(800)
    const live = ((res || []) as any[]).filter(r => !/cancel|declin|inquir|expire/i.test(str(r.status)))
    const needs = live.map(r => { const ch = channelOf(str(r.source)); const p = channelPolicy(ch); return { r, ch, p } }).filter(x => x.p.verify || x.p.deposit)
    const ids = needs.map(x => str(x.r.id))
    const checks: Record<string, any> = {}
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db.from('guest_checks').select('*').in('reservation_id', ids.slice(i, i + 200))
      if (error && /relation|schema cache|find the table/i.test(error.message)) return NextResponse.json({ ok: false, error: 'Guest checks need migration 145 (guest_checks) — run it in Supabase and reload.' }, { status: 500 })
      for (const c of (data || []) as any[]) checks[str(c.reservation_id)] = c
    }
    const salato = new Set<string>()
    if (ids.length) {
      const { data: sv } = await db.from('app_settings').select('key,value').in('key', ids.map(id => 'sv:' + id))
      for (const s of (sv || []) as any[]) { try { const v = typeof s.value === 'string' ? JSON.parse(s.value) : s.value; if (v && v.status === 'verified') salato.add(str(s.key).slice(3)) } catch { /* not ours */ } }
    }
    const rows: GuestCheckRow[] = needs.map(({ r, ch, p }) => {
      const c = checks[str(r.id)] || {}
      const sal = salato.has(str(r.id))
      return {
        reservationId: str(r.id), guest: str(r.guest_name) || 'Guest', unit: str(r.listing_name), listingId: str(r.listing_id), checkIn: str(r.check_in).slice(0, 10), checkOut: str(r.check_out).slice(0, 10), channel: ch, today: str(r.check_in).slice(0, 10) === today,
        needId: p.verify, needDeposit: p.deposit,
        idStatus: (sal ? 'verified' : (c.id_status || 'pending')) as any, depositStatus: (c.deposit_status || 'pending') as any, depositAmount: c.deposit_amount == null ? null : Number(c.deposit_amount), note: c.note || null, by: c.updated_by || null,
        salatoVerified: sal,
      }
    }).sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.unit.localeCompare(b.unit))
    const needed = rows.reduce((a, r) => a + (r.needId ? 1 : 0) + (r.needDeposit ? 1 : 0), 0)
    const done = rows.reduce((a, r) => a + (r.needId && r.idStatus !== 'pending' ? 1 : 0) + (r.needDeposit && r.depositStatus !== 'pending' ? 1 : 0), 0)
    return NextResponse.json({ ok: true, today, rows, needed, done, canEdit: atLeast(g.access.levels['welcome-calls'], 'edit') })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('welcome-calls', 'edit')
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  const rid = str(b.reservationId).trim()
  if (!rid) return NextResponse.json({ ok: false, error: 'Which reservation?' }, { status: 400 })
  const patch: any = { reservation_id: rid, updated_at: new Date().toISOString(), updated_by: String(g.access.email || '') }
  if (['pending', 'verified', 'waived'].includes(str(b.id_status))) patch.id_status = b.id_status
  if (['pending', 'captured', 'waived'].includes(str(b.deposit_status))) patch.deposit_status = b.deposit_status
  if (b.deposit_amount !== undefined) patch.deposit_amount = b.deposit_amount === null || b.deposit_amount === '' ? null : Number(b.deposit_amount)
  if (b.note !== undefined) patch.note = str(b.note).slice(0, 500) || null
  const db = supabaseAdmin()
  const { data: cur } = await db.from('guest_checks').select('*').eq('reservation_id', rid).maybeSingle()
  const row = { ...(cur || {}), ...patch }
  const { error } = await db.from('guest_checks').upsert(row, { onConflict: 'reservation_id' })
  if (error) return NextResponse.json({ ok: false, error: /relation|schema cache|find the table/i.test(error.message) ? 'Guest checks need migration 145 (guest_checks) — run it in Supabase and reload.' : error.message }, { status: 500 })
  return NextResponse.json({ ok: true, row })
}
