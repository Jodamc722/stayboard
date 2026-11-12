// THE FREE TOOLS' PDF, DESIGNED (Jon, 2026-11-12: "the PDF is broken… looks bad"). Built in the browser
// with jsPDF so it downloads as a real file on any phone, laid out like the magazine: a dark header band
// with the Stay mark, the headline figure, stat cards, then the list as a checklist (a box, the item, its
// type, the count) in sections, a notes panel, and a footer with the contact and page numbers.
// Client-only: imported dynamically from components/FreeTool.
import type { IncomeFull, InventoryFull } from './free-tools'
import { money0, PARTNER_NOTE } from './free-tools'

type RGB = [number, number, number]
const NAVY: RGB = [20, 22, 27], INK: RGB = [16, 17, 20], BODY: RGB = [58, 59, 64], MUTE: RGB = [107, 108, 114]
const ACC: RGB = [140, 109, 58], RULE: RGB = [228, 226, 221], SOFT: RGB = [247, 246, 243], WHITE: RGB = [255, 255, 255]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const TIER: Record<string, string> = { must: 'Must-have', recommended: 'Recommended', suggested: 'Optional' }

export type PdfContact = { name?: string; role?: string; phone?: string; email?: string }

async function dataUrl(src: string): Promise<string | null> {
  try {
    const b = await fetch(src).then(r => (r.ok ? r.blob() : Promise.reject()))
    return await new Promise<string>(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(b) })
  } catch { return null }
}

export async function toolPdf(opts: { tool: 'income' | 'inventory'; full: IncomeFull | InventoryFull; title: string; kicker: string; contact?: PdfContact; file: string; estimateNote?: string; subtitle?: string }) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 46
  const logo = await dataUrl('/stay-logo-white.png')
  const fill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2])
  const color = (c: RGB) => doc.setTextColor(c[0], c[1], c[2])
  const draw = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2])
  const font = (f: 'helvetica' | 'times', st: 'normal' | 'bold' | 'italic', size: number) => { doc.setFont(f, st); doc.setFontSize(size) }
  // EVERYTHING FITS ITS SPACE (Jon, 2026-11-12: "make sure the data fits the page"): text that would run
  // past its box steps its size down to a floor, then wraps; nothing is cut and nothing overlaps.
  const fitSize = (t: string, f: 'helvetica' | 'times', st: 'normal' | 'bold' | 'italic', size: number, maxW: number, min = size * 0.6) => {
    let z = size
    doc.setFont(f, st)
    while (z > min && doc.getStringUnitWidth(t) * z > maxW) z -= 0.5
    doc.setFontSize(z); return z
  }
  const caps = (t: string, x: number, y: number, c: RGB = ACC, size = 7.5, align: 'left' | 'right' | 'center' = 'left') => {
    font('helvetica', 'bold', size); color(c); doc.text(t.toUpperCase(), x, y, { align, charSpace: 1.1 } as any)
  }

  // ── header band ──
  const header = (first: boolean) => {
    fill(NAVY); doc.rect(0, 0, W, first ? 150 : 54, 'F')
    if (logo) doc.addImage(logo, 'PNG', M, first ? 30 : 16, first ? 76 : 52, first ? 32 : 22)
    else { font('helvetica', 'bold', 14); color(WHITE); doc.text('STAY', M, first ? 52 : 34) }
    caps(opts.kicker, W - M, first ? 46 : 34, [196, 167, 112], 7, 'right')
    if (first) {
      fitSize(opts.title, 'times', 'normal', 30, W - M * 2, 18); color(WHITE); doc.text(opts.title, M, 112)
      fill(ACC); doc.rect(M, 126, 36, 1.4, 'F')
    }
  }
  header(true)
  let y = 182
  const pageBreak = (need: number) => { if (y + need > H - 70) { doc.addPage(); header(false); y = 86 } }

  const statCards = (cards: [string, string, string][]) => {
    const gap = 10, w = (W - M * 2 - gap * (cards.length - 1)) / cards.length
    cards.forEach(([label, value, sub], i) => {
      const x = M + i * (w + gap)
      fill(SOFT); doc.roundedRect(x, y, w, 62, 6, 6, 'F')
      caps(label.length > 26 ? label.slice(0, 25) + '…' : label, x + 12, y + 18, MUTE, 6.5)
      fitSize(value, 'times', 'normal', 19, w - 24, 11); color(INK); doc.text(value, x + 12, y + 41)
      fitSize(sub, 'helvetica', 'normal', 7.5, w - 24, 6); color(MUTE); doc.text(sub, x + 12, y + 54)
    })
    y += 82
  }
  const section = (t: string, right?: string) => {
    pageBreak(48)
    caps(t, M, y)
    if (right) { fitSize(right, 'helvetica', 'normal', 7.5, (W - M * 2) / 2, 6); color(MUTE); doc.text(right, W - M, y, { align: 'right' }) }
    draw(INK); doc.setLineWidth(0.8); doc.line(M, y + 7, W - M, y + 7)
    y += 22
  }
  let zebra = false
  // A row: an optional tick box, the name (wrapping to as many lines as it needs, with an optional second
  // line in grey), the type in its own column, the count right-aligned. The row grows with its text.
  const item = (name: string, type: string, count: string, box = true, sub = '') => {
    const left = M + (box ? 24 : 8)
    const typeW = type ? 92 : 0
    font('times', 'bold', 11.5); const countW = Math.max(36, doc.getStringUnitWidth(count) * 11.5 + 10)
    const nameW = W - M - left - typeW - countW - 10
    font('helvetica', 'normal', 9.5); const lines: string[] = doc.splitTextToSize(name, nameW)
    font('helvetica', 'normal', 7.8); const subs: string[] = sub ? doc.splitTextToSize(sub, nameW) : []
    const h = Math.max(19, 7 + lines.length * 12 + subs.length * 10)
    pageBreak(h + 2)
    if (zebra) { fill(SOFT); doc.rect(M, y - 12, W - M * 2, h, 'F') }
    zebra = !zebra
    if (box) { draw(MUTE); doc.setLineWidth(0.7); doc.rect(M + 6, y - 7.5, 8, 8) }
    font('helvetica', 'normal', 9.5); color(INK); doc.text(lines, left, y)
    if (subs.length) { font('helvetica', 'normal', 7.8); color(MUTE); doc.text(subs, left, y + lines.length * 12 - 1) }
    if (type) { fitSize(type.toUpperCase(), 'helvetica', 'bold', 6.8, typeW - 6, 5.5); color(type === 'Must-have' ? ACC : MUTE); doc.text(type.toUpperCase(), W - M - countW - typeW, y) }
    fitSize(count, 'times', 'bold', 11.5, countW - 6, 8); color(INK); doc.text(count, W - M - 8, y, { align: 'right' })
    y += h
  }
  const para = (t: string, size = 9.5, c: RGB = BODY, style: 'normal' | 'italic' = 'normal', f: 'helvetica' | 'times' = 'helvetica') => {
    font(f, style, size); color(c)
    const ls = doc.splitTextToSize(t, W - M * 2)
    pageBreak(ls.length * size * 1.35 + 4)
    doc.text(ls, M, y); y += ls.length * size * 1.35 + 6
  }
  const panel = (label: string, t: string) => {
    font('helvetica', 'normal', 9.5)
    const ls = doc.splitTextToSize(t, W - M * 2 - 32)
    const h = 34 + ls.length * 13
    pageBreak(h + 10)
    fill(SOFT); doc.roundedRect(M, y, W - M * 2, h, 6, 6, 'F'); fill(ACC); doc.rect(M, y, 3, h, 'F')
    caps(label, M + 16, y + 18); font('helvetica', 'normal', 9.5); color(INK); doc.text(ls, M + 16, y + 34)
    y += h + 14
  }

  if (opts.subtitle) { para(opts.subtitle, 10, MUTE); y += 4 }
  if (opts.tool === 'income') {
    const f = opts.full as IncomeFull
    if (!f.found) {
      para('We do not have enough figures for this home yet. We will email you a projection built for it within 48 hours.', 12, INK, 'normal', 'times')
    } else {
      caps('Could earn in a year' + (f.area ? ', ' + f.area : ''), M, y); y += 30
      fitSize(money0(f.lo) + ' – ' + money0(f.hi), 'times', 'normal', 34, W - M * 2, 20); color(INK); doc.text(money0(f.lo) + ' – ' + money0(f.hi), M, y); y += 16
      font('helvetica', 'italic', 8.5); color(MUTE); doc.text('Gross rental revenue for an established listing, before booking-site and management fees', M, y); y += 24
      statCards([
        ['Per month, average', money0(f.monthLo) + '–' + money0(f.monthHi).slice(1), 'across the year'],
        ['Nightly rate', money0(f.nightlyLo) + '–' + money0(f.nightlyHi).slice(1), f.occLo + '–' + f.occHi + '% occupancy'],
        ['You keep, est.', money0(f.netLo) + '–' + money0(f.netHi).slice(1), f.mgmtPct ? 'after fees and management' : 'self-managed, after fees'],
      ])
      // the year as bars: the low end solid, the high end above it
      section('Through the year', 'low end solid, high end light')
      const ch = 110, cw = (W - M * 2) / 12, max = Math.max(1, ...f.months.map(m => m.hi))
      pageBreak(ch + 30)
      f.months.forEach((m, i) => {
        const x = M + i * cw + cw * 0.22, w = cw * 0.56
        const hh = (m.hi / max) * ch, hl = (m.lo / max) * ch
        fill([214, 210, 202]); doc.rect(x, y + ch - hh, w, hh, 'F')
        fill(NAVY); doc.rect(x, y + ch - hl, w, hl, 'F')
        font('helvetica', 'normal', 6.5); color(MUTE); doc.text(MONTHS[i].toUpperCase(), x + w / 2, y + ch + 11, { align: 'center' })
        font('helvetica', 'bold', 6.3); color(INK); doc.text('$' + (m.hi / 1000).toFixed(1) + 'K', x + w / 2, y + ch - hh - 4, { align: 'center' })
      })
      y += ch + 30
      const adj = (f as any).adjustments as { label: string; pct: number }[] | undefined
      if (adj && adj.length) { section('What moved the number'); zebra = false; adj.forEach(a => item(a.label, '', (a.pct > 0 ? '+' : '') + a.pct + '%', false)) }
      const comps = (f as any).comps as { name: string; market: string; gross: string; nightly: string; occ: string }[] | undefined
      if (comps && comps.length) { section('The comparables behind it'); zebra = false; comps.forEach(c => item(c.name, '', c.gross, false, [c.market, c.nightly, c.occ].filter(Boolean).join('  ·  '))) }
      const places = f.places || []
      if (places.length) { section('Nearby', f.beachMi != null ? 'about ' + (f.beachMi < 0.95 ? f.beachMi.toFixed(1) : Math.round(f.beachMi)) + ' mi to the beach' : ''); zebra = false; places.forEach(p => item(p.name, p.kind, p.mi + ' mi', false)) }
      para('From ' + f.basisLabel + ': ' + f.basis + ' comparable home' + (f.basis === 1 ? '' : 's') + ' in Stay Hospitality’s South Florida projections, then adjusted as listed. “You keep” takes off booking-site fees (' + f.channelPct + '%)' + (f.mgmtPct ? ' and a ' + f.mgmtPct + '% management fee.' : '; self-managed, so no management fee, but cleaning, supplies and your time are yours.'), 8.5, MUTE, 'italic')
    }
    panel('This is an estimate', opts.estimateNote || 'For a more granular estimate built for your exact unit, reach out to ' + (opts.contact?.name || 'our team') + '.')
  } else {
    const f = opts.full as InventoryFull
    para(f.describe, 10, MUTE)
    y += 4
    statCards([
      ['Everything', (f.pieces + f.linenPieces).toLocaleString() + ' pieces', 'supplies and linen'],
      ['Supplies', f.items + ' items', f.pieces + ' pieces in ' + f.groups.length + ' sets'],
      ['Linen at par', f.linenPieces + ' pieces', f.par + ' sets in rotation'],
    ])
    for (const g of f.groups) {
      section(g.group, 'Tick as you go')
      zebra = false
      f.rows.filter(r => r.group === g.group).forEach(r => item(r.name, TIER[r.tier] || '', String(r.qty)))
      y += 6
    }
    const lg = Array.from(new Set(f.linen.map(r => r.group)))
    for (const g of lg) {
      section('Linen · ' + g, f.parText.length < 70 ? f.parText : '')
      zebra = false
      f.linen.filter(r => r.group === g).forEach(r => item(r.name + (r.size ? '  ·  ' + r.size : ''), 'At par', String(r.qty)))
      y += 6
    }
    panel('Notes', PARTNER_NOTE + ' Counts are a starting point for a home of this size.')
  }

  // ── footer on every page ──
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    draw(RULE); doc.setLineWidth(0.6); doc.line(M, H - 44, W - M, H - 44)
    font('helvetica', 'normal', 7.5); color(MUTE)
    const c = opts.contact
    const who = [c?.name, c?.role, c?.phone, c?.email].filter(Boolean).join('  ·  ') || 'Stay Hospitality'
    fitSize(who, 'helvetica', 'normal', 7.5, W - M * 2 - 120, 5.5); doc.text(who, M, H - 28)
    font('helvetica', 'normal', 7.5)
    doc.text('stay-hospitality.com   ' + i + ' / ' + n, W - M, H - 28, { align: 'right' })
  }
  doc.save(opts.file)
}
