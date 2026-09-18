// COMMAND CENTER — the day in one read (lib/command-day). Tiles + the "Do next" engine.
import { NextResponse } from 'next/server'
import { buildCommandDay } from '@/lib/command-day'
import { requireUser } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

export async function GET() {
  const gate = await requireUser()
  if (!gate.ok) return gate.res
  const user = gate.access.user
  try {
    const day = await buildCommandDay()
    return NextResponse.json(day)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
