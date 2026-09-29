// LAST COMMENT ON A TASK — read on demand, never in bulk.
//
// Breezeway's board carries a "last comment" column; ours reads it when a row is opened rather
// than fetching comments for every task on the day. That is a deliberate limit: comments are a
// per-task API call, and a 60-unit day would be 200 calls against a rate-limited API to fill a
// column most people scroll past.
import { NextRequest, NextResponse } from 'next/server'
import { breezewayConfigured, listBreezewayComments } from '@/lib/breezeway'
import { requireVrUser } from '@/lib/vr-gate'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  if (!breezewayConfigured()) return NextResponse.json({ ok: true, comments: [] })
  const ids = String(new URL(req.url).searchParams.get('taskIds') || '')
    .split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s)).slice(0, 8)
  if (!ids.length) return NextResponse.json({ ok: false, error: 'taskIds required' }, { status: 400 })
  const out: Record<string, { body: string; at: string } | null> = {}
  await Promise.all(ids.map(async id => {
    try {
      const r = await listBreezewayComments(id)
      const last = (r.comments || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]
      out[id] = last ? { body: String(last.body || '').slice(0, 300), at: last.at } : null
    } catch { out[id] = null }
  }))
  return NextResponse.json({ ok: true, comments: out })
}
