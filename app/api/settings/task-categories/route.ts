// THE TASK TAXONOMY — read, save, reset.
//
// See lib/task-categories.ts for the rule semantics. This route validates through resolveCats()
// rather than trusting the body, so a malformed save can never leave the board with no categories.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'
import { TASK_CATS_KEY, resolveCats, DEFAULT_CATS } from '@/lib/task-categories'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const saved = await getSetting<any>(TASK_CATS_KEY, null).catch(() => null)
  return NextResponse.json({
    ok: true,
    categories: resolveCats(saved),
    isCustom: Array.isArray(saved) && saved.length > 0,
    defaults: DEFAULT_CATS,
  })
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  // Round-trip through the resolver: what gets stored is exactly what the board will run, so the
  // editor can never save something that reads back differently from how it was typed.
  const categories = resolveCats(body?.categories)
  const res = await setSetting(TASK_CATS_KEY, categories, access.email)
  if (!res.ok) return NextResponse.json({ error: res.error || 'Could not save.' }, { status: 500 })
  return NextResponse.json({ ok: true, categories })
}

export async function DELETE() {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  const res = await setSetting(TASK_CATS_KEY, [], access.email)
  if (!res.ok) return NextResponse.json({ error: res.error || 'Could not reset.' }, { status: 500 })
  return NextResponse.json({ ok: true, categories: DEFAULT_CATS })
}
