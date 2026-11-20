// Owner financials: the P&L from the owner statements (lib/owner-financials).
//   GET ?from=YYYY-MM&to=YYYY-MM          the report (omit both for every month with statements)
//   GET …&format=xlsx                      the same report as an Excel workbook
//   GET ?span=1                            which months have statements, for the pickers
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { buildFinancials, statementSpan } from '@/lib/owner-financials'
import { financialsWorkbook } from '@/lib/owner-financials-doc'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const g = await requireLevel('owner-audit', 'view'); if (!g.ok) return g.res
  const q = req.nextUrl.searchParams
  try {
    if (q.get('span') === '1') return NextResponse.json({ ok: true, ...(await statementSpan()) })
    const f = await buildFinancials(String(q.get('from') || ''), String(q.get('to') || ''))
    if (q.get('format') === 'xlsx') {
      const buf = await financialsWorkbook(f)
      return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="owner-financials-${f.from}-to-${f.to}.xlsx"`, 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json({ ok: true, financials: f })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
