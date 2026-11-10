// The email gate on the website need list (/kit/plan): saves the lead, then the page downloads the Excel.
import { NextRequest, NextResponse } from 'next/server'
import { addLead } from '@/lib/need-list-leads'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}))
  if (b?.website) return NextResponse.json({ ok: true })            // a filled honeypot is a bot: say yes, keep nothing
  const r = await addLead({ ...b, source: (b?.source || req.headers.get('referer') || '').toString() })
  return NextResponse.json(r, { status: r.ok ? 200 : 400, headers: { 'Cache-Control': 'no-store' } })
}
