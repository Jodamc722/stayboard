// The leads the free tools brought in, for the sales desk (/sales). Same store as the website need list.
import { NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { listLeads } from '@/lib/need-list-leads'

export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await requireLevel('sales', 'view')
  if (!g.ok) return g.res
  const all = await listLeads(1000)
  return NextResponse.json({ ok: true, leads: all.filter(l => /^Free tool/.test(l.source || '')).slice(0, 300) }, { headers: { 'Cache-Control': 'no-store' } })
}
