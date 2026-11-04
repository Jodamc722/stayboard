// LOST & FOUND ← SLACK, from the page.
//   GET          → the sync state (channel, last scan, last error) + the channels the bot can see
//   POST         → run a scan now ({days} to re-read further back)
//   PUT {channelId} → choose which channel is the lost-and-found channel
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { fetchChannels } from '@/lib/slack'
import { readState, writeState, resolveChannel, scanLostFound } from '@/lib/lost-found-slack'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const str = (v: any): string => typeof v === 'string' ? v : (v == null ? '' : String(v))

export async function GET() {
  const gate = await requireLevel('lost-found', 'view')
  if (!gate.ok) return gate.res
  const s = await readState()
  const ch = await resolveChannel(s)
  let channels: { id: string; name: string; isMember: boolean }[] = []
  try { channels = (await fetchChannels()).map(c => ({ id: c.id, name: c.name, isMember: c.isMember })).sort((a, b) => a.name.localeCompare(b.name)) } catch { /* Slack not connected */ }
  return NextResponse.json({ ok: true, state: s, channel: ch, channels })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('lost-found', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({} as any))
  const days = Math.min(30, Math.max(0, Number(b?.days) || 0)) || undefined
  const r = await scanLostFound({ days, by: gate.access.email })
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

export async function PUT(req: NextRequest) {
  const gate = await requireLevel('lost-found', 'full')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({} as any))
  const id = str(b?.channelId).trim()
  const s = await readState()
  if (!id) { s.channelId = null; s.channelName = null }
  else {
    let name = str(b?.channelName).trim()
    if (!name) { try { name = (await fetchChannels()).find(c => c.id === id)?.name || id } catch { name = id } }
    s.channelId = id; s.channelName = name
  }
  s.lastTs = null; s.lastError = null        // a new channel starts from the start date, not the old bookmark
  const w = await writeState(s, gate.access.email)
  if (!w.ok) return NextResponse.json({ ok: false, error: w.error || 'Could not save' }, { status: 500 })
  return NextResponse.json({ ok: true, state: s })
}
