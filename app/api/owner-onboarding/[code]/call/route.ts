// The onboarding call on Google Calendar (lib/owner-onboard-calendar).
//   GET ?day=YYYY-MM-DD                         → the signed-in teammate's busy times that day
//   POST { day, time, minutes, agenda }         → creates (or moves) the calendar event with a Google Meet link,
//                                                 invites the owner, and puts the call on the owner's timeline
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readRecord, saveRecord } from '@/lib/owner-onboard-server'
import { busyOn, createCall } from '@/lib/owner-onboard-calendar'
import { teamView } from '@/lib/owner-onboard'

export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const g = await requireLevel('owner-onboarding', 'view'); if (!g.ok) return g.res
  const host = String(g.access.email || '')
  return NextResponse.json({ host, ...(await busyOn(host, String(req.nextUrl.searchParams.get('day') || ''))) })
}
export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'edit'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  const b = await req.json().catch(() => ({} as any))
  const host = String(g.access.email || '')
  const c = await createCall(r, { host, day: String(b?.day || ''), time: String(b?.time || ''), minutes: Number(b?.minutes) || 30, agenda: String(b?.agenda || '').slice(0, 500) })
  if (!c.ok) return NextResponse.json({ ok: false, error: c.error }, { status: 400 })
  r.call = { at: b.day + 'T' + b.time, link: c.link || '', note: String(b?.agenda || '').slice(0, 500), minutes: Number(b?.minutes) || 30, eventId: c.eventId, eventUrl: c.eventUrl, host }
  const st = r.steps.find(s => s.key === 'call'); if (st && st.status === 'todo') { st.status = 'doing'; st.date = String(b.day) }
  await saveRecord(r, host || null)
  return NextResponse.json({ ok: true, record: teamView(r) })
}
