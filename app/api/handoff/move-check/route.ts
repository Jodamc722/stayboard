// THE GUEST-MOVE WATCH, ON DEMAND (lib/move-watch). Admins only.
// GET → what the watch finds right now (nothing is sent), and whether it is switched on.
// POST {} → find and raise them as alerts now. POST { on: true|false } → switch the half-hourly run
// (app_settings 'move_watch'; it ships OFF so its first findings are looked at before they go out).
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const g = await requireAdmin('admin')
  if (!g.ok) return g.res
  const { findMoveConflicts } = await import('@/lib/move-watch')
  const { getSetting } = await import('@/lib/app-settings')
  const mw = await getSetting<{ on?: boolean }>('move_watch', { on: false })
  return NextResponse.json({ ok: true, on: !!mw.on, ...(await findMoveConflicts()) })
}
export async function POST(req: Request) {
  const g = await requireAdmin('admin')
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  if (typeof b?.on === 'boolean') {
    const { setSetting } = await import('@/lib/app-settings')
    const r = await setSetting('move_watch', { on: b.on }, g.access.email)
    return NextResponse.json({ ok: r.ok, on: b.on, error: r.error })
  }
  const { runMoveWatch } = await import('@/lib/move-watch')
  const r = await runMoveWatch()
  const { runHandoffs } = await import('@/lib/handoff-store')
  const h = await runHandoffs()
  return NextResponse.json({ ok: true, ...r, handoffs: h })
}
