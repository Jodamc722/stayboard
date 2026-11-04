// CLOUDBEDS WEBHOOK (lib/garden/realtime). Cloudbeds sends X-Garden-Token, set when Lighthouse
// subscribed. Answers at once and syncs after the response, as Cloudbeds asks.
//   POST (Cloudbeds)                        → 200, incremental sync in the background
//   PUT  { op: 'subscribe' } (signed in)    → subscribe every event Lighthouse uses
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { hookState, onEvent, subscribe } from '@/lib/garden/realtime'
import { requireGarden } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const h = await hookState()
  const token = req.headers.get('x-garden-token') || req.nextUrl.searchParams.get('token') || ''
  if (token !== h.token) return NextResponse.json({ error: 'bad token' }, { status: 401 })
  waitUntil(onEvent().catch(() => {}))
  return NextResponse.json({ ok: true })
}

export async function PUT(req: NextRequest) {
  const gate = await requireGarden('setup', 'edit')
  if (!gate.ok) return gate.res
  try { return NextResponse.json({ ok: true, ...(await subscribe(req.nextUrl.origin)) }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
}

export async function GET() {
  const gate = await requireGarden('setup', 'view')
  if (!gate.ok) return gate.res
  const h = await hookState()
  return NextResponse.json({ ok: true, lastEventAt: h.lastEventAt || null, lastSyncAt: h.lastSyncAt || null, events: h.events || 0 })
}
