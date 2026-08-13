// ORDER EXPORTS — the same order, in the three shapes people actually need.
//
//   ?id=<orderId>&fmt=xlsx    line items for accounting or to hand a vendor
//   ?id=<orderId>&fmt=pdf     the printable quote an owner files or signs
//   ?id=<orderId>&fmt=csv     the plain fallback
//   ?id=<orderId>&fmt=buylist     THE PURCHASING SHEET — one page per vendor (Jon, 2026-08-13:
//                             "not sure yet where we will purchase from but could be Amazon, a
//                             partner with HostGPO, Wayfair, City Furniture")
//   ?id=<orderId>&fmt=workorder   THE INSTALL SHEET — one page per unit (Jon, 2026-08-13:
//                             "create work orders report, as items come in per unit. Here what goes
//                             in unit and here where it goes.")
//
// All three are generated from ffe_order_lines at request time, so the page, the spreadsheet and
// the PDF cannot drift apart — there is no second copy of the numbers to forget to update.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { makeXlsx, type XCell, type XSheet } from '@/lib/xlsx-lite'
import { buildQuotePdf, type QuoteSection } from '@/lib/order-pdf'
import { mergeChecklist, type FfeOverride } from '@/lib/ffe-checklist'
import { STAGE_LABEL } from '@/lib/ffe-catalog'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

const str = (v: any) => (v == null ? '' : String(v))
const num = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const usd = (n: number | null) => n == null ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const safe = (s: string) => str(s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'order'

export async function GET(req: NextRequest) {
  const s = createClient()
  const { data: u } = await s.auth.getUser()
  if (!u.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const db = supabaseAdmin()
  const sp = req.nextUrl.searchParams
  const id = str(sp.get('id')).trim()
  const fmt = (str(sp.get('fmt')) || 'xlsx').toLowerCase()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  try {
    const [{ data: ords }, { data: lines }, { data: ovRows }] = await Promise.all([
      db.from('ffe_orders').select('*').eq('id', id).limit(1),
      db.from('ffe_order_lines').select('*').eq('order_id', id).limit(5000),
      db.from('ffe_checklist_items').select('room,item_key,en,es,ask,hidden,sort').limit(2000),
    ])
    const order = (ords || [])[0]
    if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })
    const ov = (ovRows || []) as FfeOverride[]

    const roomEn: Record<string, string> = {}, itemEn: Record<string, string> = {}
    for (const bd of [0, 1, 2, 3, 4]) {
      for (const r of mergeChecklist(bd, ov)) {
        roomEn[r.key] = r.en
        for (const i of r.items) itemEn[r.key + '::' + i.key] = i.en
      }
    }

    type Row = {
      unit: string; building: string; room: string; item: string; code: string; product: string
      spec: string; placement: string; qty: number; cost: number | null; total: number | null
      vendor: string; sku: string; url: string; stage: string; stageKey: string; received: string; po: string; note: string
    }
    const rows: Row[] = ((lines || []) as any[]).map(l => {
      const qty = Math.max(1, num(l.qty, 1))
      const cost = l.unit_cost == null ? null : num(l.unit_cost)
      return {
        unit: str(l.unit_name), building: str(l.building),
        room: roomEn[str(l.room)] || str(l.room),
        item: str(l.title) || itemEn[str(l.room) + '::' + str(l.item_key)] || str(l.item_key),
        code: str(l.code), product: str(l.product), spec: str(l.spec),
        placement: str(l.placement), qty, cost,
        total: cost == null ? null : Math.round(cost * qty * 100) / 100,
        vendor: str(l.vendor), sku: str(l.vendor_sku), url: str(l.url),
        stage: STAGE_LABEL[str(l.stage)] || str(l.stage),
        stageKey: str(l.stage),
        received: l.received_at ? String(l.received_at).slice(0, 10) : '',
        po: str(l.po_number), note: str(l.note),
      }
    }).sort((a, b) =>
      a.unit.localeCompare(b.unit, undefined, { numeric: true }) || a.room.localeCompare(b.room) || a.item.localeCompare(b.item))

    // Declined lines are shown but never counted — an owner's "no" must not quietly inflate a total.
    const live = rows.filter(r => r.stage !== STAGE_LABEL.declined)
    const grand = live.reduce((a, r) => a + (r.total || 0), 0)
    const unpriced = live.filter(r => r.total == null).length
    const stamp = new Date().toISOString().slice(0, 10)
    const base = safe(str(order.order_no) + '-' + str(order.owner_name))

    // ── CSV ──
    if (fmt === 'csv') {
      const esc = (v: any) => { const t = str(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t }
      const head = ['Code', 'Product', 'Size / spec', 'Building', 'Unit', 'Room', 'Replacing', 'Where it goes', 'Qty', 'Unit cost', 'Line total', 'Vendor', 'Vendor SKU', 'Stage', 'PO', 'Product link', 'Note']
      const body = rows.map(r => [r.code, r.product, r.spec, r.building, r.unit, r.room, r.item, r.placement, r.qty,
        r.cost == null ? '' : r.cost, r.total == null ? '' : r.total, r.vendor, r.sku, r.stage, r.po, r.url, r.note].map(esc).join(','))
      const csv = [head.join(','), ...body, '', ['', '', '', '', '', '', '', '', '', 'Total', grand].map(esc).join(',')].join('\n')
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${base}-${stamp}.csv"`,
        },
      })
    }

    // ── BUY LIST: one page per vendor, for whoever places the orders ──
    // The mirror image of the work order. That sheet is organised by WHERE IT GOES; this one by
    // WHERE IT COMES FROM, because those are two different people doing two different jobs on two
    // different days. Quantities are rolled up across every unit — you buy 26 nightstands once, not
    // twice a unit — and the units are listed underneath so a partial delivery can still be placed.
    if (fmt === 'buylist') {
      // Only what the owner has actually said yes to. Buying off an unapproved quote is the
      // expensive mistake this whole feature exists to prevent.
      const BUYABLE = ['approved', 'ordered', 'delivered', 'installed']
      const use = (sp.get('all') ? rows : rows.filter(r => BUYABLE.indexOf(r.stageKey) >= 0))
        .filter(r => r.stageKey !== 'declined')

      type Grp = { code: string; product: string; spec: string; sku: string; url: string; qty: number; cost: number | null; units: Record<string, number> }
      const byVendor: Record<string, Record<string, Grp>> = {}
      for (const r of use) {
        const v = r.vendor || 'Not decided yet'
        const k = (r.code || '~' + r.item) + '|' + r.spec
        const g = (byVendor[v] = byVendor[v] || {})
        const row = g[k] = g[k] || { code: r.code, product: r.product || r.item, spec: r.spec, sku: r.sku, url: r.url, qty: 0, cost: r.cost, units: {} }
        row.qty += r.qty
        row.units[r.unit] = (row.units[r.unit] || 0) + r.qty
        if (row.cost == null) row.cost = r.cost
      }

      // Whoever we have not chosen a supplier for goes LAST and is named as such, so it reads as a
      // decision still outstanding rather than a vendor called "Not decided yet".
      const vendors = Object.keys(byVendor).sort((a, b) =>
        (a === 'Not decided yet' ? 1 : 0) - (b === 'Not decided yet' ? 1 : 0) || a.localeCompare(b))

      let grandBuy = 0
      const sections: QuoteSection[] = vendors.map(v => {
        const gs = Object.values(byVendor[v]).sort((a, b) => (a.code || 'zz').localeCompare(b.code || 'zz'))
        const sub = gs.reduce((a, g) => a + (g.cost == null ? 0 : g.cost * g.qty), 0)
        grandBuy += sub
        return {
          newPage: true,
          heading: v,
          sub: gs.length + ' line(s) · ' + gs.reduce((a, g) => a + g.qty, 0) + ' piece(s)',
          rows: gs.map(g => [
            g.code || '—',
            g.product,
            g.spec || '—',
            g.sku || '—',
            String(g.qty),
            g.cost == null ? 'TBC' : usd(g.cost),
            g.cost == null ? 'TBC' : usd(Math.round(g.cost * g.qty * 100) / 100),
            Object.keys(g.units).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
              .map(u => u + (g.units[u] > 1 ? ' x' + g.units[u] : '')).join(', '),
          ]),
          subtotal: 'Subtotal ' + usd(sub),
        }
      })

      const pdf = buildQuotePdf({
        title: 'Buy list — ' + str(order.order_no),
        subtitle: str(order.title) || str(order.owner_name),
        meta: [
          { label: 'Suppliers', value: String(vendors.length) },
          { label: 'Pieces', value: String(use.reduce((a, r) => a + r.qty, 0)) },
          { label: 'Undecided', value: byVendor['Not decided yet'] ? Object.keys(byVendor['Not decided yet']).length + ' line(s)' : 'none' },
          { label: 'Printed', value: stamp },
        ],
        columns: [
          { header: 'Code', width: 11 },
          { header: 'Product', width: 24 },
          { header: 'Size / spec', width: 11 },
          { header: 'Their SKU', width: 12 },
          { header: 'Qty', width: 6, align: 'r' },
          { header: 'Each', width: 9, align: 'r' },
          { header: 'Extended', width: 11, align: 'r' },
          { header: 'For which units', width: 26 },
        ],
        sections,
        totals: [{ label: 'To spend', value: usd(Math.round(grandBuy * 100) / 100), strong: true }],
        note: str(order.note) || undefined,
        footer: 'Quantities are rolled up across every unit on this order. Lines under "Not decided yet" still ' +
          'need a supplier chosen — set one on the product in the Catalog tab and reprint. Only owner-approved ' +
          'lines appear here.',
      })
      return new NextResponse(pdf as any, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${safe(str(order.order_no) + '-buy-list')}-${stamp}.pdf"`,
        },
      })
    }

    // ── WORK ORDERS: one page per unit, for whoever carries the boxes upstairs ──
    // Deliberately NOT a quote. No prices, no owner, no totals — a person standing in a hallway
    // with a dolly needs to know what belongs in this unit and which room each piece goes to, and
    // every number on the page beyond a quantity is noise they have to read past.
    if (fmt === 'workorder') {
      // Default to what has actually been bought. A sheet listing things nobody ordered sends
      // somebody looking for a box that does not exist.
      const ONWAY = ['ordered', 'delivered', 'installed']
      const wanted = sp.get('all') ? rows : rows.filter(r => ONWAY.indexOf(r.stageKey) >= 0)
      const scope = str(sp.get('unit')).trim()
      const use = scope ? wanted.filter(r => r.unit === scope) : wanted

      const byUnit: Record<string, Row[]> = {}
      for (const r of use) (byUnit[r.unit] = byUnit[r.unit] || []).push(r)
      const unitNames = Object.keys(byUnit).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

      const sections: QuoteSection[] = []
      for (const unit of unitNames) {
        const rs = byUnit[unit].slice().sort((a, b) => a.room.localeCompare(b.room) || a.item.localeCompare(b.item))
        sections.push({
          newPage: true,
          heading: unit,
          sub: (rs[0]?.building || '') + ' · ' + rs.reduce((a, r) => a + r.qty, 0) + ' piece(s)',
          rows: rs.map(r => [
            r.received ? 'YES' : '[  ]',
            r.code || '—',
            r.product || r.item,
            r.spec || '—',
            // WHERE IT GOES, in the words the walker used: the room, then the placement note.
            r.room + (r.placement && r.placement !== r.room ? ' — ' + r.placement : ''),
            String(r.qty),
          ]),
        })
      }

      const pdf = buildQuotePdf({
        title: 'Work order — ' + str(order.order_no),
        subtitle: str(order.title) || str(order.owner_name),
        meta: [
          { label: 'Units', value: String(unitNames.length) },
          { label: 'Pieces', value: String(use.reduce((a, r) => a + r.qty, 0)) },
          { label: 'Received', value: use.filter(r => r.received).length + ' of ' + use.length + ' lines' },
          { label: 'Printed', value: stamp },
        ],
        columns: [
          { header: 'Got it', width: 8 },
          { header: 'Code', width: 12 },
          { header: 'What it is', width: 30 },
          { header: 'Size / spec', width: 14 },
          { header: 'Where it goes', width: 30 },
          { header: 'Qty', width: 6, align: 'r' },
        ],
        sections,
        totals: [{ label: 'Pieces to place', value: String(use.reduce((a, r) => a + r.qty, 0)), strong: true }],
        note: str(order.note) || undefined,
        footer: 'Tick each piece as it goes in. Anything missing or damaged, photograph it and tell the office ' +
          'before it is installed. This sheet lists only what has been ordered.',
      })
      return new NextResponse(pdf as any, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${safe(str(order.order_no) + '-work-order' + (scope ? '-' + scope : ''))}-${stamp}.pdf"`,
        },
      })
    }

    // ── PDF ──
    if (fmt === 'pdf') {
      const byUnit: Record<string, Row[]> = {}
      for (const r of rows) (byUnit[r.unit] = byUnit[r.unit] || []).push(r)
      const sections: QuoteSection[] = Object.keys(byUnit).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(unit => {
        const rs = byUnit[unit]
        const sub = rs.filter(r => r.stage !== STAGE_LABEL.declined).reduce((a, r) => a + (r.total || 0), 0)
        return {
          heading: unit,
          sub: rs[0]?.building ? rs[0].building : undefined,
          rows: rs.map(r => [
            r.code || '—',
            r.product || r.item,
            (r.spec ? r.spec + ' — ' : '') + r.room + (r.placement ? ' · ' + r.placement : ''),
            String(r.qty),
            r.cost == null ? 'TBC' : usd(r.cost),
            r.stage === STAGE_LABEL.declined ? 'not taken' : (r.total == null ? 'TBC' : usd(r.total)),
          ]),
          subtotal: 'Subtotal ' + usd(sub),
        }
      })
      const pdf = buildQuotePdf({
        title: 'FF&E Order ' + str(order.order_no),
        subtitle: str(order.title) || str(order.owner_name),
        meta: [
          { label: 'Owner', value: str(order.owner_name) || '—' },
          { label: 'Units', value: String(new Set(rows.map(r => r.unit)).size) },
          { label: 'Pieces', value: String(live.reduce((a, r) => a + r.qty, 0)) },
          { label: 'Prepared', value: stamp },
          { label: 'Status', value: str(order.status) },
        ],
        columns: [
          { header: 'Code', width: 12 },
          { header: 'Product', width: 26 },
          { header: 'Size / spec', width: 12 },
          { header: 'Where it goes', width: 26 },
          { header: 'Qty', width: 6, align: 'r' },
          { header: 'Each', width: 10, align: 'r' },
          { header: 'Total', width: 12, align: 'r' },
        ],
        sections,
        totals: [
          ...(unpriced ? [{ label: unpriced + ' line(s) still to be priced', value: 'TBC' }] : []),
          { label: 'Order total', value: usd(grand), strong: true },
        ],
        note: str(order.note) || undefined,
        footer: 'Prices are per piece and exclude delivery, installation and tax unless stated. ' +
          'This is a furniture order — no maintenance work is created by approving it.',
      })
      return new NextResponse(pdf as any, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${base}-${stamp}.pdf"`,
        },
      })
    }

    // ── XLSX ──
    const H = (v: string): XCell => ({ v, s: 3 })
    const sheet1: XSheet = {
      name: 'Order lines',
      widths: [11, 30, 14, 14, 24, 18, 22, 22, 6, 11, 12, 16, 14, 13, 12, 30],
      rows: [],
      links: [],
    }
    sheet1.rows.push([{ v: 'FF&E Order ' + str(order.order_no), s: 2 }])
    sheet1.rows.push([{ v: str(order.title) || str(order.owner_name), s: 8 }])
    sheet1.rows.push([])
    sheet1.rows.push(['Code', 'Product', 'Size / spec', 'Building', 'Unit', 'Room', 'Replacing', 'Where it goes', 'Qty',
      'Unit cost', 'Line total', 'Vendor', 'Vendor SKU', 'Stage', 'PO', 'Product link'].map(H))
    let r0 = sheet1.rows.length
    for (const r of rows) {
      sheet1.rows.push([
        { v: r.code }, { v: r.product || r.item }, { v: r.spec }, { v: r.building }, { v: r.unit }, { v: r.room },
        { v: r.item }, { v: r.placement }, { v: r.qty, num: true },
        r.cost == null ? { v: '' } : { v: r.cost, num: true, s: 4 },
        r.total == null ? { v: '' } : { v: r.total, num: true, s: 4 },
        { v: r.vendor }, { v: r.sku }, { v: r.stage }, { v: r.po },
        { v: r.url, s: r.url ? 9 : 0 },
      ])
      if (r.url) sheet1.links!.push({ ref: 'P' + (r0 + 1), url: r.url })
      r0 += 1
    }
    sheet1.rows.push([])
    sheet1.rows.push([{ v: '' }, { v: '' }, { v: '' }, { v: '' }, { v: '' }, { v: '' }, { v: '' }, { v: '' }, { v: '' },
      { v: 'Order total', s: 7 }, { v: Math.round(grand * 100) / 100, num: true, s: 6 }])

    // A second sheet the way a buyer actually orders: one row per product code, not per unit.
    const byCode: Record<string, { code: string; product: string; spec: string; vendor: string; sku: string; qty: number; cost: number | null; units: Set<string> }> = {}
    for (const r of live) {
      // Grouped by code AND spec: a 9x12 rug and an 8x10 rug are two different things to buy.
      const k = (r.code || ('~' + r.item)) + '|' + r.spec
      const b = byCode[k] = byCode[k] || { code: r.code, product: r.product || r.item, spec: r.spec, vendor: r.vendor, sku: r.sku, qty: 0, cost: r.cost, units: new Set<string>() }
      b.qty += r.qty
      b.units.add(r.unit)
      if (b.cost == null) b.cost = r.cost
    }
    const sheet2: XSheet = {
      name: 'By product',
      widths: [11, 34, 14, 18, 16, 8, 12, 13, 9],
      rows: [
        [{ v: 'What to buy', s: 2 }],
        [{ v: 'One row per product code and size — total quantity across every unit on this order.', s: 8 }],
        [],
        ['Code', 'Product', 'Size / spec', 'Vendor', 'Vendor SKU', 'Qty', 'Unit cost', 'Extended', 'Units'].map(H),
      ],
    }
    const codeRows = Object.values(byCode).sort((a, b) => (a.code || 'zz').localeCompare(b.code || 'zz'))
    for (const b of codeRows) {
      sheet2.rows.push([
        { v: b.code || '—' }, { v: b.product }, { v: b.spec }, { v: b.vendor }, { v: b.sku },
        { v: b.qty, num: true },
        b.cost == null ? { v: '' } : { v: b.cost, num: true, s: 4 },
        b.cost == null ? { v: '' } : { v: Math.round(b.cost * b.qty * 100) / 100, num: true, s: 4 },
        { v: b.units.size, num: true },
      ])
    }
    sheet2.rows.push([])
    sheet2.rows.push([{ v: '' }, { v: '' }, { v: '' }, { v: '' }, { v: '' }, { v: '' }, { v: 'Order total', s: 7 },
      { v: Math.round(grand * 100) / 100, num: true, s: 6 }])

    const buf = makeXlsx([sheet1, sheet2])
    return new NextResponse(buf as any, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${base}-${stamp}.xlsx"`,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
