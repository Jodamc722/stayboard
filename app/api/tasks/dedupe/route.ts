// Duplicate open tasks (lib/task-dedupe). GET: the list, nothing changes. POST: cancel the extra
// copies, keeping the latest-dated one of each. Admins only. The morning run does the same on its own.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/access'
import { findDuplicates, cancelDuplicates } from '@/lib/task-dedupe'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const only = (req: NextRequest) => { const q = req.nextUrl.searchParams.get('name'); return q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : undefined }

export async function GET(req: NextRequest) {
  const gate = await requireAdmin('admin')
  if (!gate.ok) return gate.res
  // ?probe=<taskId>: what Breezeway itself says about one task (status object, fields) — read-only.
  const probe = req.nextUrl.searchParams.get('probe')
  if (probe && /^\d+$/.test(probe)) {
    const { retrieveBreezewayTask } = await import('@/lib/breezeway')
    const r = await retrieveBreezewayTask(probe)
    const t: any = r.data?.task || r.data || {}
    return NextResponse.json({ ok: r.ok, status: r.status, type_task_status: t.type_task_status ?? null, statusField: t.status ?? null, keys: Object.keys(t).slice(0, 80) })
  }
  const groups = await findDuplicates({ only: only(req) })
  return NextResponse.json({ ok: true, groups: groups.length, extra: groups.reduce((a, g) => a + g.cancel.length, 0), list: groups.slice(0, 200) })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin('admin')
  if (!gate.ok) return gate.res
  const r = await cancelDuplicates({ only: only(req) })
  return NextResponse.json({ ok: true, ...r })
}
