import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { v1Gate, json, todayET, ymd } from '@/lib/api-v1'
import { loadCallsDesk } from '@/lib/call-desk'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function GET(req: NextRequest) {
  const g = await v1Gate(req, 'welcome-calls'); if (!g.ok) return g.res
  const today = todayET(), date = ymd(req.nextUrl.searchParams.get('date'), today)
  const d = await loadCallsDesk(supabaseAdmin(), today, date)
  const welcome = d.rows.filter(r => r.check_in === date).map(r => ({ kind: 'welcome', reservationId: r.id, guest: r.guest, listing: r.listing, building: r.building, checkIn: r.check_in, checkOut: r.status?.checkOut || null, tier: r.tier, mandatory: r.mandatory, done: r.done, outcome: r.outcome, attempts: r.attempts, calledBy: r.calledBy, calledAt: r.calledAt, closed: r.closed }))
  const followUp = d.outRows.filter(r => r.check_out === date).map(r => ({ kind: 'follow-up', reservationId: r.id, guest: r.guest, listing: r.listing, building: r.building, checkIn: r.check_in, checkOut: r.check_out, reasons: r.reasons, done: r.done, outcome: r.outcome, attempts: r.attempts, calledBy: r.calledBy, calledAt: r.calledAt, closed: r.closed }))
  return json({ welcome, followUp }, { date, counts: { welcome: welcome.length, welcomeOpen: welcome.filter(w => !w.done).length, followUp: followUp.length, followUpOpen: followUp.filter(f => !f.done).length } })
}
