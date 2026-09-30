// LINEN DOCUMENTS (Jon, 2026-09-30: "It should then draft an invoice and a quantity sheet that we can
// send to our vendors for purchasing. It should also know how the ordering works. Some of these
// items have to be bulk ordered.") POST, built at request time, nothing stored:
//
//   { doc: 'invoice',   tier, units, billTo? }  → the owner's invoice, a DRAFT, as a PDF
//   { doc: 'order',     tier, units }           → the vendor order / quantity sheet as a PDF, a page per vendor
//   { doc: 'order-csv', tier, units }           → the same vendor order as CSV
//
// `units` is whatever the page is quoting — typed in on the Quote view, or picked listings on the
// Calculator — as shapes: [{ name, bedrooms, bathrooms, guests, beds: { King: 1 }, copies }]. At most
// 200 units, validated and capped by lib/linens.ts manualUnits. The layouts are lib/linen-docs.ts.
//
// PRICED FROM THE SAVED STANDARD, never from the page: these documents go to an owner or a vendor, so
// they carry the prices Jon saved, not an edit still in progress (the page greys the buttons while
// the standard has unsaved changes and says why).
//
// TWO BILLS, ON PURPOSE. The invoice bills the owner for the pieces their unit receives. The vendor
// order is in whole cases, pooled across every unit, with the overage going to stock.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel, type Gate } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { getSetting } from '@/lib/app-settings'
import { buildQuotePdf } from '@/lib/order-pdf'
import { LINEN_STANDARD_KEY, MANUAL_LIMITS, normLinenStandard, isLinenTier, manualUnits, linenQuote, vendorOrder, vendorOrderCsv, type LinenTier } from '@/lib/linens'
import { linenInvoiceDoc, linenOrderDoc, linenDraftNo } from '@/lib/linen-docs'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MAX_BODY = 100_000
const DOCS = ['invoice', 'order', 'order-csv'] as const
type Doc = typeof DOCS[number]
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status })
const str = (v: any, max: number) => (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Same door as /api/onboard/linens: Onboarding at view, and a vacation-rental login. */
async function gate(): Promise<Gate> {
  const g = await requireLevel('onboarding', 'view')
  if (!g.ok) return g
  if (!isVrLogin(g.access)) return { ok: false, res: hotelOnlyRes(), access: g.access }
  return g
}

/** Today in Eastern time, as YYYY-MM-DD and as "Sep 30, 2026". */
function today(): { ymd: string; label: string } {
  const now = new Date()
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)
  const label = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }).format(now)
  return { ymd, label }
}

export async function POST(req: NextRequest) {
  const g = await gate()
  if (!g.ok) return g.res
  try {
    const raw = await req.text().catch(() => '')
    if (raw.length > MAX_BODY) return fail('That request is too large.', 413)
    let body: any = null
    try { body = JSON.parse(raw) } catch { body = null }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Send { doc, tier, units }.', 400)
    const doc = body.doc as Doc
    if (!DOCS.includes(doc)) return fail('doc must be invoice, order or order-csv.', 400)
    if (!isLinenTier(body.tier)) return fail('Pick Low, Mid or Luxury.', 400)
    const tier: LinenTier = body.tier
    if (!Array.isArray(body.units) || !body.units.length) return fail('Add at least one unit.', 400)
    if (body.units.length > MANUAL_LIMITS.units) return fail(`At most ${MANUAL_LIMITS.units} units on one document.`, 400)
    const { units, requested, labels } = manualUnits(body.units)
    if (requested > MANUAL_LIMITS.units) return fail(`At most ${MANUAL_LIMITS.units} units on one document — that asks for ${requested}.`, 400)

    const standard = normLinenStandard(await getSetting<any>(LINEN_STANDARD_KEY, null))
    const { ymd, label: dateLabel } = today()
    const pdfHeaders = (name: string) => ({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' })

    if (doc === 'invoice') {
      // Never a $0.00 invoice: a tier with nothing priced has nothing to bill yet.
      if (linenQuote(standard, units, tier).priced === 0) return fail('Nothing in this tier is priced yet — add prices on the Standard view first.', 400)
      const pdf = buildQuotePdf(linenInvoiceDoc(standard, units, tier, { labels, dateLabel, invoiceNo: linenDraftNo(ymd), billTo: str(body.billTo, 120) }))
      return new NextResponse(pdf as any, { headers: pdfHeaders(`linen-invoice-${tier}-${ymd}.pdf`) })
    }
    if (doc === 'order-csv') {
      return new NextResponse(vendorOrderCsv(vendorOrder(standard, units, tier)), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="linen-order-${tier}-${ymd}.csv"`, 'Cache-Control': 'no-store' },
      })
    }
    const pdf = buildQuotePdf(linenOrderDoc(standard, units, tier, { labels, dateLabel }))
    return new NextResponse(pdf as any, { headers: pdfHeaders(`linen-order-${tier}-${ymd}.pdf`) })
  } catch (e: any) {
    return fail(String(e?.message || e).slice(0, 200), 500)
  }
}
