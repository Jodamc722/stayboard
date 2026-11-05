// CLEANING INVOICES (lib/clean-invoices).
//   GET                      → every invoice, newest first
//   GET ?id=                 → one invoice with its lines, flags and unbilled cleans (+ a link to the file)
//   POST multipart file      → upload, read, check against the cleans (edit level)
//   POST { op, id, … }       → approve | dispute | reopen | resolve (one line) | recheck | delete
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { listInvoices, getInvoice, saveInvoice, submitInvoice, recheckInvoice, removeInvoice, fileUrl } from '@/lib/clean-invoices'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const g = await requireLevel('clean-invoices', 'view')
  if (!g.ok) return g.res
  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    const inv = await getInvoice(id)
    if (!inv) return NextResponse.json({ ok: false, error: 'No such invoice.' }, { status: 404 })
    return NextResponse.json({ ok: true, invoice: inv, fileUrl: await fileUrl(inv).catch(() => null) })
  }
  return NextResponse.json({ ok: true, invoices: await listInvoices() })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('clean-invoices', 'edit')
  if (!g.ok) return g.res
  const who = String((g as any).access?.email || '') || null
  try {
    if ((req.headers.get('content-type') || '').includes('multipart/form-data')) {
      const fd = await req.formData()
      const file = fd.get('file')
      if (!(file instanceof File) || !file.size) return NextResponse.json({ ok: false, error: 'Attach the invoice file.' }, { status: 400 })
      if (file.size > 20 * 1024 * 1024) return NextResponse.json({ ok: false, error: 'That file is over 20 MB.' }, { status: 400 })
      const inv = await submitInvoice(file, who, { vendor: String(fd.get('vendor') || '').trim() || undefined, periodFrom: String(fd.get('periodFrom') || ''), periodTo: String(fd.get('periodTo') || '') })
      return NextResponse.json({ ok: true, invoice: inv })
    }
    const b: any = await req.json().catch(() => ({}))
    const id = String(b.id || '')
    if (b.op === 'recheck') { const inv = await recheckInvoice(id); return inv ? NextResponse.json({ ok: true, invoice: inv }) : NextResponse.json({ ok: false, error: 'No such invoice.' }, { status: 404 }) }
    if (b.op === 'delete') { await removeInvoice(id); return NextResponse.json({ ok: true }) }
    const inv = await getInvoice(id)
    if (!inv) return NextResponse.json({ ok: false, error: 'No such invoice.' }, { status: 404 })
    const now = new Date().toISOString()
    if (b.op === 'approve' || b.op === 'dispute' || b.op === 'reopen') {
      inv.status = b.op === 'approve' ? 'approved' : b.op === 'dispute' ? 'disputed' : 'review'
      inv.note = b.note != null ? String(b.note).slice(0, 2000) || null : inv.note
      inv.reviewedBy = b.op === 'reopen' ? null : who; inv.reviewedAt = b.op === 'reopen' ? null : now
    } else if (b.op === 'resolve') {
      const l = inv.lines.find(x => x.n === Number(b.n))
      if (!l) return NextResponse.json({ ok: false, error: 'No such line.' }, { status: 404 })
      l.resolved = b.clear ? null : { by: who || 'someone', at: now, note: String(b.note || '').slice(0, 500) }
    } else if (b.op === 'edit') {
      if (b.vendor != null) inv.vendor = String(b.vendor).slice(0, 120) || inv.vendor
      if (b.number != null) inv.number = String(b.number).slice(0, 60) || null
    } else return NextResponse.json({ ok: false, error: 'Unknown op.' }, { status: 400 })
    await saveInvoice(inv)
    return NextResponse.json({ ok: true, invoice: inv })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
