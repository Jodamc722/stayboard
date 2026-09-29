// Assignable Breezeway team members (active), with the activities they do + region. Optional
// ?department= filter (housekeeping|inspection|maintenance|safety). Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { breezewayConfigured, listBreezewayPeople } from '@/lib/breezeway'
import { requireUser } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// ONE ROSTER READ PER TEN MINUTES (2026-09-28 audit). Every open of the Command Center, Today in
// Ops and the Scheduler (plus the capacity panel and Add task) made a live Breezeway call for a list
// that changes a few times a month. An EMPTY list is never cached: listBreezewayPeople returns []
// when Breezeway fails, and ten minutes of an empty roster would blank every assign picker.
const cachedPeople = unstable_cache(async () => {
  const people = await listBreezewayPeople()
  if (!people.length) throw new Error('empty roster — not cached')
  return people
}, ['bz-people-v1'], { revalidate: 600, tags: ['bz-people'] })

export async function GET(req: NextRequest) {
  const gate = await requireUser()
  if (!gate.ok) return gate.res
  const user = gate.access.user
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured.' }, { status: 503 })
  const dept = String(new URL(req.url).searchParams.get('department') || '').toLowerCase().trim()
  let people: Awaited<ReturnType<typeof listBreezewayPeople>> = []
  try { people = await cachedPeople() } catch { people = [] }   // the same empty answer as before
  if (dept) people = people.filter(p => p.departments.length === 0 || p.departments.includes(dept))
  people.sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json({ ok: true, count: people.length, people })
}
