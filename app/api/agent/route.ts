// The in-app "Brain" assistant. Answers Jon using a live snapshot of the business
// (reservations, approvals, open work) and Stay Hospitality operating rules.
// Requires ANTHROPIC_API_KEY. Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured - add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })

  const body = await req.json().catch(() => ({} as any))
  const messages = Array.isArray(body?.messages)
    ? body.messages.filter((m: any) => m && m.role && m.content).slice(-12)
    : []
  if (!messages.length) return NextResponse.json({ error: 'no messages' }, { status: 400 })

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const in7 = addDays(today, 7)

  let context: any = { today: todayStr }
  try {
    const [
      { count: pendingCount }, { count: openCount },
      { count: checkInsToday }, { count: checkOutsToday }, { count: arrivals7 },
      { data: arrivals }, { data: openWork }, { count: listingsCount }
    ] = await Promise.all([
      supabase.from('field_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('field_requests').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
      supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).eq('check_in', todayStr),
      supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).eq('check_out', todayStr),
      supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).gt('check_in', todayStr).lte('check_in', in7),
      supabase.from('guesty_reservations').select('guest_name,listing_name,nights,check_in').gte('check_in', todayStr).lte('check_in', in7).order('check_in').limit(40),
      supabase.from('field_requests').select('title,building,unit,priority,due_at,status,assignee_email').in('status', ['open', 'in_progress']).order('due_at', { ascending: true, nullsFirst: false }).limit(30),
      supabase.from('guesty_listings').select('*', { count: 'exact', head: true })
    ])
    const overdue = (openWork || []).filter((r: any) => r.due_at && r.due_at < todayStr)
    context = {
      today: todayStr,
      listings: listingsCount ?? null,
      approvalsPending: pendingCount ?? 0,
      openWork: openCount ?? 0,
      overdue: overdue.length,
      checkInsToday: checkInsToday ?? 0,
      checkOutsToday: checkOutsToday ?? 0,
      arrivalsNext7: arrivals7 ?? 0,
      upcomingArrivals: (arrivals || []).slice(0, 30),
      openItems: (openWork || []).slice(0, 30)
    }
  } catch (e) { /* fall back to minimal context */ }

  const SYSTEM = `You are "the Brain" - the warm, friendly, hospitality-first in-app operations assistant for Stay Hospitality, a South Florida short-term-rental property manager. The teams are: CCS (central guest communications & customer service), the Miami Team (field/turnover/maintenance for Miami), and the Broward Team (field/turnover/maintenance for Broward). You talk directly to Jon (owner / Mini GM); you are his kind, sharp right hand and his eyes on the business. Be genuinely warm and encouraging, but concise, practical, and decisive.
Live snapshot (JSON):
${JSON.stringify(context)}
Rules:
- Answer from the snapshot when relevant. If something isn't in the snapshot, say what you'd need rather than guessing. Never invent reservations or numbers.
- When asked to plan or dispatch work, organize actions by CCS, Miami Team, and Broward Team (guest-comms/review/service items go to CCS; field/turnover/maintenance to Miami or Broward by market).
- For guest-review replies: never admit fault, never mention unit numbers, and never affirm or name bed bugs, pests, or anyone entering/"walking in" - thank them for feedback and note corrective action.
- Keep answers tight. Use short bullets only when they help.`

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SYSTEM,
        messages: messages.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) }))
      })
    })
    const d: any = await r.json()
    if (!r.ok) return NextResponse.json({ error: `Anthropic ${r.status}: ${(d?.error?.message || JSON.stringify(d)).slice(0, 200)}` }, { status: 502 })
    const reply = Array.isArray(d?.content) ? d.content.map((c: any) => c?.text || '').join('').trim() : ''
    return NextResponse.json({ reply: reply || '(no response)' })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
