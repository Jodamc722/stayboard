// One vendor, everything about them, for the hover card (lib/project-vendors.ts vendorSummary).
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/access'
import { vendorSummary } from '@/lib/project-vendors'
import { todayISO } from '@/lib/projects-shared'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { key: string } }) {
  const g = await requireUser()
  if (!g.ok) return g.res
  const s = await vendorSummary(String(params.key || ''), todayISO())
  if (!s) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true, ...s })
}
