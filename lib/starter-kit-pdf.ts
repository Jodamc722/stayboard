// THE STARTER KIT AS A PDF (Jon, 2026-11-10: "once they select they should be able to download the
// report"). Built on the server from what the client saved, so the file always matches what the team
// sees: their name and home, the selected items room by room with quantities, the models they
// picked, their own product links, and the totals. Items they left out are not in the file.
//
// jspdf is already a dependency; it is imported dynamically so it stays out of every other bundle.
import 'server-only'
import { STAY_LOGO_PNG_BASE64 } from './brand-logo'
import { KIT_CATEGORIES, describeSize, fmtMoney, kitTotals, ruleText, type KitPublic } from './starter-kit'

const INK: [number, number, number] = [21, 33, 43]
const MUTED: [number, number, number] = [107, 120, 128]
const ACCENT: [number, number, number] = [31, 95, 91]
const LINE: [number, number, number] = [220, 226, 224]
const TIER = { must: 'Must-have', recommended: 'Recommended', optional: 'Optional' } as const

export function kitPdfName(kit: KitPublic): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `Stay starter kit - ${clean(kit.client) || 'Proposal'}.pdf`
}

export async function buildKitPdf(kit: KitPublic): Promise<ArrayBuffer> {
  const mod: any = await import('jspdf')
  const JsPDF = mod.jsPDF || mod.default?.jsPDF || mod.default
  const doc = new JsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48
  const t = kitTotals(kit.size, kit.selection)
  const grand = t.total + (kit.setupFee || 0)
  const date = new Date(kit.submitted?.at || kit.savedAt || kit.createdAt || Date.now()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  let y = M

  const color = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])
  const footer = () => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); color(MUTED)
    doc.text(`Stay Hospitality · Starter kit for ${kit.client}`, M, H - 24)
    doc.text(`Page ${doc.getNumberOfPages()}`, W - M, H - 24, { align: 'right' })
  }
  const need = (h: number) => { if (y + h > H - 48) { footer(); doc.addPage(); y = M } }

  // letterhead
  try { doc.addImage('data:image/png;base64,' + STAY_LOGO_PNG_BASE64, 'PNG', M, y, 84, 35) } catch { /* the name below still identifies it */ }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); color(MUTED)
  doc.text(date, W - M, y + 14, { align: 'right' })
  if (kit.preparedBy) doc.text(`Prepared by ${kit.preparedBy}`, W - M, y + 27, { align: 'right' })
  y += 66

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); color(ACCENT)
  doc.text('HOME INVENTORY & NEED LIST · PREPARED FOR', M, y); y += 26
  doc.setFont('times', 'normal'); doc.setFontSize(32); color(INK)
  doc.text(doc.splitTextToSize(kit.client, W - 2 * M), M, y); y += 14
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); color(MUTED)
  if (kit.property) { y += 12; doc.text(kit.property, M, y) }
  y += 16; doc.text(describeSize(kit.size), M, y)
  y += 22

  // the totals box
  const boxH = 74 + (kit.setupFee ? 16 : 0)
  doc.setFillColor(INK[0], INK[1], INK[2]); doc.roundedRect(M, y, W - 2 * M, boxH, 8, 8, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text('STILL TO BUY', M + 18, y + 22)
  doc.setFont('times', 'normal'); doc.setFontSize(30); doc.text(fmtMoney(grand), M + 18, y + 54)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  const rx = W - M - 18
  const rows: [string, string][] = [['Must-haves', fmtMoney(t.must)], ['Add-ons', fmtMoney(t.addOns)]]
  if (kit.setupFee) rows.push(['Setup & installation', fmtMoney(kit.setupFee)])
  rows.push([`${t.items} needed · ${t.toBuy} to buy`, ''])
  rows.forEach(([k, v], i) => { doc.text(k, rx - 120, y + 22 + i * 16); if (v) doc.text(v, rx, y + 22 + i * 16, { align: 'right' }) })
  y += boxH + 26

  if (kit.message) {
    doc.setFont('times', 'italic'); doc.setFontSize(12); color(INK)
    const lines = doc.splitTextToSize(kit.message, W - 2 * M - 16)
    need(lines.length * 15 + 20)
    doc.setDrawColor(ACCENT[0], ACCENT[1], ACCENT[2]); doc.setLineWidth(2); doc.line(M, y - 10, M, y - 10 + lines.length * 15 + 4)
    doc.text(lines, M + 14, y); y += lines.length * 15 + 18
  }

  // the kit, room by room — only what is included
  const colQty = W - M - 200, colPrice = W - M
  for (const cat of KIT_CATEGORIES) {
    const lines = t.lines.filter(l => l.item.category === cat && l.included)
    if (!lines.length) continue
    need(60)
    doc.setFont('times', 'normal'); doc.setFontSize(17); color(INK)
    doc.text(cat, M, y)
    const sub = lines.reduce((a, l) => a + (l.total || 0), 0)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); color(MUTED)
    doc.text(fmtMoney(sub), colPrice, y, { align: 'right' })
    y += 6; doc.setDrawColor(INK[0], INK[1], INK[2]); doc.setLineWidth(1); doc.line(M, y, W - M, y); y += 16
    for (const l of lines) {
      const it = l.item
      const detail = l.source === 'self' ? `You provide this (${l.detail})` : l.own ? `Your product: ${l.own}` : l.detail
      const dl = doc.splitTextToSize(detail, colQty - M - 20)
      const h = 14 + dl.length * 11 + 13 + 8
      need(h)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); color(INK)
      doc.text(it.name, M, y)
      const nw = doc.getTextWidth(it.name)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); color(it.tier === 'must' ? INK : ACCENT)
      doc.text(TIER[it.tier].toUpperCase(), M + nw + 8, y)
      doc.setFontSize(10.5); color(INK)
      doc.text(l.have ? `need ${l.qty} · have ${l.have} · buy ${l.toBuy}` : `need ${l.qty}`, colQty, y)
      doc.text(l.source === 'self' ? 'You provide' : l.toBuy === 0 ? 'Covered' : l.own ? 'Priced on review' : it.price === 0 ? 'Included' : fmtMoney(l.total || 0), colPrice, y, { align: 'right' })
      y += 13
      doc.setFontSize(9); color(l.own ? ACCENT : MUTED)
      doc.text(dl, M, y); y += dl.length * 11
      doc.setFontSize(8); color(ACCENT)
      doc.text(ruleText(it, kit.size), M, y); y += 8
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 16
    }
    y += 8
  }

  // the summary and the fine print
  need(150)
  doc.setFont('times', 'normal'); doc.setFontSize(17); color(INK); doc.text('Summary', M, y); y += 18
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5)
  const sum: [string, string][] = [['Items the home needs', String(t.items)], ['Already covered by what you have', String(t.covered)], ['Must-haves still to buy', fmtMoney(t.must)], ['Recommended and optional items to buy', fmtMoney(t.addOns)]]
  if (kit.setupFee) sum.push(['Setup, delivery and installation', fmtMoney(kit.setupFee)])
  if (t.ownLinks) sum.push([`${t.ownLinks} product${t.ownLinks === 1 ? '' : 's'} you linked`, 'Priced on review'])
  if (t.selfSupplied) sum.push([`${t.selfSupplied} item${t.selfSupplied === 1 ? '' : 's'} you provide`, 'Not charged'])
  for (const [k, v] of sum) { color(INK); doc.text(k, M, y); doc.text(v, W - M, y, { align: 'right' }); y += 8; doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.line(M, y, W - M, y); y += 14 }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('Total to buy', M, y + 4); doc.text(fmtMoney(grand), W - M, y + 4, { align: 'right' }); y += 26
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); color(MUTED)
  const fine = doc.splitTextToSize('Must-haves are what every home needs, not a requirement to use our products: you can send us a link to the one you prefer or provide it yourself. The coffee maker must be a Nespresso or Keurig pod machine; we supply the pods. Prices are current retail prices from when this kit was prepared and can change before we order; we confirm every price with you before anything is bought.', W - 2 * M)
  need(fine.length * 11 + 10); doc.text(fine, M, y); y += fine.length * 11
  if (kit.submitted) { y += 10; need(14); doc.text(`Sent to Stay by ${kit.submitted.name} on ${new Date(kit.submitted.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`, M, y) }
  footer()
  return doc.output('arraybuffer') as ArrayBuffer
}
