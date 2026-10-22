// GE LOG ENTRIES — add, edit, tick off or remove a line written straight onto the log
// (lib/ge-log-entries). A line headed for Breezeway goes through /api/ops-today/add-task instead.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { changeEntries, entriesFor } from '@/lib/ge-log-entries'

export const dynamic = 'force-dynamic'

const ymd = (v: any) => { const s = String(v ?? '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '' }

export async function GET(req: NextRequest) {
  const gate = await requireLevel('plan', 'view')
  if (!gate.ok) return gate.res
  const date = ymd(new URL(req.url).searchParams.get('date'))
  if (!date) return NextResponse.json({ ok: false, error: 'date is required' }, { status: 400 })
  return NextResponse.json({ ok: true, entries: await entriesFor(date) })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('plan', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({} as any))
  const date = ymd(b?.date)
  const op = b?.op === 'update' || b?.op === 'delete' ? b.op : 'add'
  if (!date) return NextResponse.json({ ok: false, error: 'date is required' }, { status: 400 })
  try {
    const entries = await changeEntries(date, op, b, String(gate.access?.email || ''))
    try { const { bustBoards } = await import('@/lib/bust'); bustBoards() } catch { /* cache only */ }
    return NextResponse.json({ ok: true, entries })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 400 })
  }
}
