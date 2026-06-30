// Assignable Breezeway team members (active), with the activities they do + region. Optional
// ?department= filter (housekeeping|inspection|maintenance|safety). Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { breezewayConfigured, listBreezewayPeople } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured.' }, { status: 503 })
  const dept = String(new URL(req.url).searchParams.get('department') || '').toLowerCase().trim()
  let people = await listBreezewayPeople()
  if (dept) people = people.filter(p => p.departments.length === 0 || p.departments.includes(dept))
  people.sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json({ ok: true, count: people.length, people })
}
