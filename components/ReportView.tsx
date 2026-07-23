'use client'
// Owner Report renderer + edit-in-place. Renders the ReportContent JSON as a stacked
// "deck" of sections in the Capri look (navy/coral/gold on cream). When canEdit,
// an Edit toggle turns every text/number into an inline input, lets quotes/themes/
// project items be removed/added, and sections be hidden/shown (content.omit).
// Save PUTs the whole content JSON to /api/reports. Subcomponents live at module
// scope (never inline in render) so inputs keep focus while typing.
import { useEffect, useRef, useState } from 'react'
import { Pencil, Save, Loader2, Eye, EyeOff, X, Plus, Link as LinkIcon, Check, Paperclip, Image as ImageIcon, Download, UploadCloud, Sparkles, Star, Play, ChevronLeft, ChevronRight, Lock, RefreshCw } from 'lucide-react'
import { type Basis, BASES, BASIS_SHORT, BASIS_LABEL, basisTriple } from '@/lib/basis'

type Any = any
// Money formatter matching the report engine's fmtK ($1.2M / $18K / $940).
function fmtMoney(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M'
  if (a >= 1000) return '$' + Math.round(n / 1000) + 'K'
  return '$' + Math.round(n).toLocaleString()
}
// The gross figure for a snapshot card: prefer the structured field, else parse it from the sub-line.
function cardGross(card: Any): string {
  if (card && card.gross) return String(card.gross)
  const m = /Gross[^:]*:\s*(\$?[\d.,]+\s*[KM]?)/i.exec((card && card.sub) || '')
  return m ? m[1].trim() : ''
}
// Does an object carry the raw numbers needed to compute any basis?
function hasBasisRaw(o: Any): boolean {
  return o && o.accomNum != null && o.accomGrossNum != null && o.cleaningNum != null
}
// Formatted Revenue / ADR / RevPAR strings for a basis, from a raw-carrying object (snap / listing / metrics).
function basisStrings(o: Any, b: Basis): { rev: string; adr: string; revpar: string } {
  const t = basisTriple({ accomNum: o.accomNum || 0, accomGrossNum: o.accomGrossNum || 0, cleaningNum: o.cleaningNum || 0, occNights: o.occNights || 0, availNights: o.availNights || 0 }, b)
  return { rev: fmtMoney(t.revenue), adr: '$' + t.adr, revpar: '$' + t.revpar }
}
// Edit-mode segmented control for choosing a section's revenue basis.
function BasisPicker({ label, value, withNone, onPick, t }: Any) {
  const opts: { val: string; name: string }[] = (withNone ? [{ val: 'none', name: 'None' }] : []).concat(BASES.map((b: Basis) => ({ val: b, name: BASIS_SHORT[b] })))
  return (
    <span className="inline-flex items-center gap-1.5">
      {label && <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: t.muted }}>{label}</span>}
      <span className="inline-flex rounded-full p-0.5" style={{ background: t.chip, border: '1px solid ' + t.cardBorder }}>
        {opts.map((o) => (
          <button key={o.val} onClick={() => onPick(o.val)} className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ background: value === o.val ? t.accent : 'transparent', color: value === o.val ? t.card : t.ink }}>{o.name}</button>
        ))}
      </span>
    </span>
  )
}

// ---------- themes (P4): every color in the page comes from the active theme ----------
const THEMES: Record<string, Any> = {
  capri: {
    label: 'Capri', bg: '#FAF6EF', ink: '#102A43', body: '#41586e', sub: '#6b7c8d', muted: '#93a3b3',
    card: '#ffffff', cardBorder: '#efe8d8', chip: '#faf8f2', accent: '#E2725B', gold: '#C9A227', band: '#102A43',
    statusHotBg: '#fdeee9', statusHotInk: '#E2725B', statusColdBg: '#eef3f7', statusColdInk: '#5a7186',
    good: '#1a7f4f', downGray: '#a6b1bc', rule: '#eadfc9', toolbarBg: 'rgba(250,246,239,0.92)', toolbarBorder: '#d9d0bc',
    trackBg: '#fffdf7', footA: '#a89f8a', footB: '#c2baa4', barA: '#102A43', barB: '#E2725B',
    edBg: 'rgba(255,255,255,0.7)', edBorder: '#C9A227',
  },
  minimal: {
    label: 'Minimal', bg: '#ffffff', ink: '#111827', body: '#374151', sub: '#6b7280', muted: '#9ca3af',
    card: '#ffffff', cardBorder: '#e5e7eb', chip: '#f9fafb', accent: '#111827', gold: '#6b7280', band: '#111827',
    statusHotBg: '#f3f4f6', statusHotInk: '#111827', statusColdBg: '#f3f4f6', statusColdInk: '#6b7280',
    good: '#15803d', downGray: '#9ca3af', rule: '#e5e7eb', toolbarBg: 'rgba(255,255,255,0.92)', toolbarBorder: '#d1d5db',
    trackBg: '#fafafa', footA: '#9ca3af', footB: '#d1d5db', barA: '#111827', barB: '#111827',
    edBg: 'rgba(0,0,0,0.03)', edBorder: '#9ca3af',
  },
  lux: {
    label: 'Dark Luxe', bg: '#101216', ink: '#F4EFE6', body: '#c9c4b8', sub: '#9a958a', muted: '#6e7684',
    card: '#181b21', cardBorder: '#262a32', chip: '#1f232b', accent: '#C9A227', gold: '#C9A227', band: '#1e222a',
    statusHotBg: 'rgba(201,162,39,0.15)', statusHotInk: '#C9A227', statusColdBg: '#262a32', statusColdInk: '#9a958a',
    good: '#5fbf8f', downGray: '#6e7684', rule: '#262a32', toolbarBg: 'rgba(16,18,22,0.92)', toolbarBorder: '#33383f',
    trackBg: '#15181d', footA: '#6e6a61', footB: '#4f4b43', barA: '#4a5160', barB: '#C9A227',
    edBg: 'rgba(255,255,255,0.08)', edBorder: '#C9A227',
  },
}

// ---------- PPTX export (P5): built in the browser from the content JSON + active theme ----------
const PPTX_CDN = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js'

function cx(v: string, fb: string): string {
  return (v && v.indexOf('#') === 0) ? v.slice(1) : fb
}

async function fetchImageDataUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const blob = await r.blob()
    return await new Promise<string | null>(resolve => {
      const fr = new FileReader()
      fr.onload = () => {
        const d = String(fr.result || '')
        resolve(d ? d.replace(/^data:/, '') : null)
      }
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    })
  } catch { return null }
}

function buildPptx(P: Any, c: Any, t: Any, heroData: string | null): Any {
  const pptx = new P()
  pptx.layout = 'LAYOUT_WIDE'
  const BG = cx(t.bg, 'FFFFFF'), INK = cx(t.ink, '111827'), BODY = cx(t.body, '41586e'), SUB = cx(t.sub, '6b7c8d')
  const MUT = cx(t.muted, '93a3b3'), CARD = cx(t.card, 'FFFFFF'), CB = cx(t.cardBorder, 'e5e7eb'), ACC = cx(t.accent, 'E2725B')
  const GOLD = cx(t.gold, 'C9A227'), BAND = cx(t.band, '102A43'), GOOD = cx(t.good, '1a7f4f'), GRAY = cx(t.downGray, 'a6b1bc')
  const CHIP = cx(t.chip, 'f5f5f5'), BARA = cx(t.barA, '102A43'), BARB = cx(t.barB, 'E2725B')
  const hero = c.hero || {}, snap = c.snapshot || {}, plan = c.plan, ahead = c.ahead || {}, voices = c.voices || {}, projects = c.projects || {}, meta = c.meta || {}
  const isDown = (v: Any) => String(v || '').trim().indexOf('-') === 0 || String(v || '').trim().indexOf('−') === 0
  // content band: header lives above CT, content fills CT..CBOT so no empty bottom strip
  const CT = 1.85, CBOT = 6.95
  function head(s: Any, eyebrow: string, headline: string, subtitle?: string) {
    s.background = { color: BG }
    s.addText(eyebrow, { x: 0.6, y: 0.4, w: 12.13, h: 0.3, fontSize: 12, bold: true, color: ACC, charSpacing: 3 })
    s.addText(String(headline || '').slice(0, 120), { x: 0.6, y: 0.72, w: 12.13, h: 0.7, fontSize: 25, bold: true, color: INK })
    if (subtitle) s.addText(String(subtitle).slice(0, 160), { x: 0.6, y: 1.44, w: 12.13, h: 0.3, fontSize: 11, color: SUB })
  }

  // hero — full-width photo, big title
  const s1 = pptx.addSlide()
  s1.background = { color: BG }
  s1.addText(String(hero.eyebrow || ''), { x: 0.6, y: 0.7, w: 12.13, h: 0.3, align: 'center', fontSize: 12, bold: true, color: ACC, charSpacing: 4 })
  s1.addText(String(hero.dateLabel || 'OWNER REVIEW'), { x: 0.6, y: 1.06, w: 12.13, h: 0.3, align: 'center', fontSize: 11, bold: true, color: GOLD, charSpacing: 4 })
  s1.addText(String(hero.title || ''), { x: 0.6, y: 1.4, w: 12.13, h: 1.1, align: 'center', fontSize: 52, bold: true, color: INK })
  s1.addText(String(hero.headline || ''), { x: 1.6, y: 2.62, w: 10.13, h: 0.7, align: 'center', fontSize: 16, color: BODY })
  if (heroData) s1.addImage({ data: heroData, x: 0.6, y: 3.5, w: 12.13, h: 3.2, sizing: { type: 'cover', w: 12.13, h: 3.2 } })
  else s1.addShape('roundRect', { x: 0.6, y: 3.5, w: 12.13, h: 3.2, fill: { color: CHIP }, rectRadius: 0.06 })
  s1.addText(String(hero.preparedFor || '') + '  ·  STAY HOSPITALITY', { x: 0.6, y: 6.88, w: 12.13, h: 0.3, align: 'center', fontSize: 9, bold: true, color: MUT, charSpacing: 2 })

  // snapshot
  const s2 = pptx.addSlide()
  head(s2, 'SNAPSHOT', snap.headline, snap.subtitle)
  const cards = (snap.cards || []).slice(0, 4)
  const cn = Math.max(1, cards.length), cgap = 0.19, cw = (12.13 - (cn - 1) * cgap) / cn
  for (let i = 0; i < cards.length; i++) {
    const x = 0.6 + i * (cw + cgap)
    s2.addShape('roundRect', { x, y: CT, w: cw, h: 2.05, fill: { color: CARD }, line: { color: CB }, rectRadius: 0.06 })
    s2.addText(String(cards[i].label || ''), { x: x + 0.18, y: CT + 0.16, w: cw - 0.32, h: 0.25, fontSize: 9.5, bold: true, color: ACC, charSpacing: 2 })
    s2.addText(String(cards[i].value || ''), { x: x + 0.18, y: CT + 0.46, w: cw - 0.32, h: 0.66, fontSize: 30, bold: true, color: INK })
    s2.addText(String(cards[i].sub || '').slice(0, 95), { x: x + 0.18, y: CT + 1.2, w: cw - 0.3, h: 0.78, fontSize: 8.5, color: SUB })
  }
  if (snap.ytd) {
    const by = CT + 2.3
    s2.addShape('roundRect', { x: 0.6, y: by, w: 12.13, h: CBOT - by, fill: { color: BAND }, rectRadius: 0.06 })
    s2.addText((meta.asOf ? String(meta.asOf).slice(0, 4) : '') + ' YEAR-TO-DATE', { x: 0.95, y: by + 0.26, w: 6, h: 0.3, fontSize: 10, bold: true, color: GOLD, charSpacing: 2 })
    s2.addText(String(snap.ytd.text || '').slice(0, 260), { x: 0.95, y: by + 0.64, w: 6.6, h: 1.55, fontSize: 13, color: 'FFFFFF', valign: 'top' })
    const stats = (snap.ytd.stats || []).slice(0, 3)
    const sy = by + (CBOT - by) / 2 - 0.35
    for (let i = 0; i < stats.length; i++) {
      const x = 7.95 + i * 1.55
      s2.addText(String(stats[i].value || ''), { x, y: sy, w: 1.5, h: 0.55, align: 'center', fontSize: 22, bold: true, color: 'FFFFFF' })
      s2.addText(String(stats[i].label || ''), { x, y: sy + 0.6, w: 1.5, h: 0.3, align: 'center', fontSize: 8, bold: true, color: 'CCCCCC', charSpacing: 1 })
    }
  }

  // pacing — rows fill the frame
  if (c.pacing) {
    const s = pptx.addSlide()
    head(s, 'PACING VS. MARKET', c.pacing.headline, c.pacing.subtitle)
    const rows = (c.pacing.rows || []).slice(0, 4)
    const n = Math.max(1, rows.length), rgap = 0.22, rh = (CBOT - CT - (n - 1) * rgap) / n
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], y = CT + i * (rh + rgap), cyc = y + rh / 2
      s.addShape('roundRect', { x: 0.6, y, w: 12.13, h: rh, fill: { color: CARD }, line: { color: CB }, rectRadius: 0.06 })
      s.addText(String(r.metric || ''), { x: 0.95, y: cyc - 0.2, w: 2.7, h: 0.4, fontSize: 15, bold: true, color: INK })
      s.addText(String(r.ours || ''), { x: 3.9, y: cyc - 0.44, w: 2.5, h: 0.58, align: 'center', fontSize: 25, bold: true, color: INK })
      s.addText(String(meta.scopeLabel || 'US'), { x: 3.9, y: cyc + 0.18, w: 2.5, h: 0.25, align: 'center', fontSize: 8.5, bold: true, color: ACC, charSpacing: 1 })
      s.addText(String(r.comps || ''), { x: 6.7, y: cyc - 0.44, w: 2.5, h: 0.58, align: 'center', fontSize: 25, bold: true, color: MUT })
      s.addText('COMP SET', { x: 6.7, y: cyc + 0.18, w: 2.5, h: 0.25, align: 'center', fontSize: 8.5, bold: true, color: MUT, charSpacing: 1 })
      s.addText(String(r.delta || ''), { x: 9.9, y: cyc - 0.38, w: 2.5, h: 0.5, align: 'right', fontSize: 19, bold: true, color: isDown(r.delta) ? GRAY : GOOD })
      s.addText('VS. COMPS', { x: 9.9, y: cyc + 0.2, w: 2.5, h: 0.25, align: 'right', fontSize: 8.5, color: MUT, charSpacing: 1 })
    }
  }

  // performance vs plan
  if (plan) {
    const s = pptx.addSlide()
    head(s, 'PERFORMANCE VS. PLAN', plan.headline)
    const months = (plan.months || []).slice(0, 4)
    const n = Math.max(1, months.length), mgap = 0.22, mh = (CBOT - CT - (n - 1) * mgap) / n
    for (let mi = 0; mi < months.length; mi++) {
      const m = months[mi], y = CT + mi * (mh + mgap)
      s.addShape('roundRect', { x: 0.6, y, w: 12.13, h: mh, fill: { color: CARD }, line: { color: CB }, rectRadius: 0.06 })
      s.addText(String(m.label || ''), { x: 0.95, y: y + 0.16, w: 2.5, h: 0.3, fontSize: 14, bold: true, color: INK, charSpacing: 2 })
      s.addText(String(m.status || ''), { x: 3.3, y: y + 0.19, w: 3.6, h: 0.25, fontSize: 9.5, bold: true, color: ACC, charSpacing: 1 })
      const rows = (m.rows || []).slice(0, 4)
      const rn = Math.max(1, rows.length), cgap2 = 0.18, chW = (11.43 - (rn - 1) * cgap2) / rn
      const chY = y + 0.52, chH = mh - (m.note ? 0.92 : 0.66)
      for (let ri = 0; ri < rows.length; ri++) {
        const r = rows[ri], x = 0.95 + ri * (chW + cgap2)
        s.addShape('roundRect', { x, y: chY, w: chW, h: chH, fill: { color: CHIP }, rectRadius: 0.05 })
        s.addText(String(r.metric || ''), { x: x + 0.12, y: chY + 0.1, w: chW - 0.24, h: 0.2, fontSize: 8, bold: true, color: MUT, charSpacing: 1 })
        s.addText(String(r.actual || ''), { x: x + 0.12, y: chY + 0.32, w: chW - 0.7, h: 0.4, fontSize: 16, bold: true, color: INK })
        s.addText(String(r.budget || ''), { x: x + 0.12, y: chY + 0.72, w: chW - 0.3, h: 0.22, fontSize: 8.5, color: MUT })
        s.addText(String(r.delta || ''), { x: x + chW - 0.9, y: chY + 0.38, w: 0.78, h: 0.3, align: 'right', fontSize: 10.5, bold: true, color: r.good ? GOOD : GRAY })
      }
      if (m.note) s.addText(String(m.note).slice(0, 180), { x: 0.95, y: y + mh - 0.34, w: 11.4, h: 0.28, fontSize: 9, color: BODY })
    }
  }

  // owner statement
  if (c.statement && (c.statement.items || []).length) {
    const s = pptx.addSlide()
    head(s, 'OWNER STATEMENT', c.statement.headline || 'Owner statement summary.')
    const items = (c.statement.items || []).slice(0, 4)
    const n = Math.max(1, items.length), igap = 0.22, ih = (CBOT - CT - (n - 1) * igap) / n
    for (let i = 0; i < items.length; i++) {
      const y = CT + i * (ih + igap)
      s.addShape('roundRect', { x: 0.6, y, w: 12.13, h: ih, fill: { color: CARD }, line: { color: CB }, rectRadius: 0.06 })
      s.addText(String(items[i].title || ''), { x: 0.95, y: y + 0.16, w: 11.4, h: 0.3, fontSize: 13, bold: true, color: INK })
      s.addText(String(items[i].summary || '').slice(0, 320), { x: 0.95, y: y + 0.54, w: 11.4, h: ih - 0.68, fontSize: 11, color: BODY, valign: 'top' })
    }
  }

  // looking ahead
  const s6 = pptx.addSlide()
  head(s6, 'LOOKING AHEAD', ahead.headline, ahead.subtitle)
  const aMonths = (ahead.months || []).slice(0, 3)
  const an = Math.max(1, aMonths.length), acw = (12.13 - (an - 1) * 0.25) / an
  for (let i = 0; i < aMonths.length; i++) {
    const m = aMonths[i], x = 0.6 + i * (acw + 0.25)
    s6.addShape('roundRect', { x, y: CT, w: acw, h: 2.7, fill: { color: CARD }, line: { color: CB }, rectRadius: 0.06 })
    s6.addText(String(m.label || ''), { x: x + 0.24, y: CT + 0.2, w: acw - 1.5, h: 0.3, fontSize: 13, bold: true, color: INK, charSpacing: 1 })
    s6.addText(String(m.status || ''), { x: x + acw - 1.6, y: CT + 0.23, w: 1.4, h: 0.25, align: 'right', fontSize: 9, bold: true, color: ACC, charSpacing: 1 })
    s6.addText(String(m.occPct != null ? m.occPct : 0) + '%', { x: x + 0.24, y: CT + 0.62, w: acw - 0.4, h: 0.78, fontSize: 32, bold: true, color: INK })
    s6.addText('on the books', { x: x + 0.26, y: CT + 1.34, w: acw - 0.4, h: 0.28, fontSize: 10, color: MUT })
    s6.addText('ADR ' + String(m.adr || '') + '  ·  RevPAR ' + String(m.revpar || ''), { x: x + 0.24, y: CT + 1.66, w: acw - 0.4, h: 0.3, fontSize: 11, bold: true, color: BODY })
    if (m.note) s6.addText(String(m.note).slice(0, 190), { x: x + 0.24, y: CT + 1.98, w: acw - 0.4, h: 0.66, fontSize: 9, color: SUB, valign: 'top' })
  }
  const strip = (ahead.strip || []).slice(0, 8)
  if (strip.length) {
    const stripTop = CT + 2.95
    s6.addText('MONTHS AHEAD  ·  OCCUPANCY %', { x: 0.6, y: stripTop, w: 8, h: 0.25, fontSize: 9.5, bold: true, color: MUT, charSpacing: 2 })
    const baseY = 7.0, maxBar = 1.55, bw = 12.13 / strip.length
    for (let i = 0; i < strip.length; i++) {
      const pct = Number(strip[i].occPct) || 0, bh = Math.max(0.08, (pct / 100) * maxBar), x = 0.6 + i * bw
      s6.addShape('rect', { x: x + bw * 0.2, y: baseY - bh, w: bw * 0.6, h: bh, fill: { color: i === 1 ? BARB : BARA } })
      s6.addText(String(pct) + '%', { x, y: baseY - bh - 0.28, w: bw, h: 0.24, align: 'center', fontSize: 9, bold: true, color: INK })
      s6.addText(String(strip[i].month || ''), { x, y: baseY + 0.06, w: bw, h: 0.24, align: 'center', fontSize: 9, color: SUB })
    }
  }

  // guest voices — reviews KPI band + quotes
  const quotes = (voices.quotes || []).slice(0, 4)
  const kpi = voices.kpi
  if (quotes.length || kpi) {
    const s = pptx.addSlide()
    head(s, 'GUEST VOICES', voices.headline, voices.subtitle)
    let qTop = CT
    if (kpi) {
      const kh = 1.15
      s.addShape('roundRect', { x: 0.6, y: CT, w: 12.13, h: kh, fill: { color: CARD }, line: { color: CB }, rectRadius: 0.06 })
      const kstats = [
        { v: (kpi.avg != null ? String(kpi.avg) : '—'), l: 'AVG RATING' },
        { v: (kpi.count != null ? String(kpi.count) : '—'), l: 'REVIEWS' },
        { v: (kpi.fiveStar != null ? String(kpi.fiveStar) : '—'), l: '5-STAR' }
      ]
      const sw = 12.13 / 3
      for (let i = 0; i < 3; i++) {
        const x = 0.6 + i * sw
        if (i) s.addShape('rect', { x, y: CT + 0.22, w: 0.012, h: kh - 0.44, fill: { color: CB } })
        s.addText(kstats[i].v, { x, y: CT + 0.2, w: sw, h: 0.55, align: 'center', fontSize: 26, bold: true, color: i === 0 ? GOLD : INK })
        s.addText(kstats[i].l, { x, y: CT + 0.78, w: sw, h: 0.25, align: 'center', fontSize: 9, bold: true, color: SUB, charSpacing: 2 })
      }
      if (kpi.from && kpi.to) s.addText(String(kpi.from) + '  →  ' + String(kpi.to), { x: 0.6, y: CT + kh + 0.06, w: 12.13, h: 0.22, align: 'center', fontSize: 8.5, color: MUT })
      qTop = CT + kh + 0.36
    }
    const qn = quotes.length, qrows = Math.max(1, Math.ceil(qn / 2)), qgap = 0.22
    const qh = (CBOT - qTop - (qrows - 1) * qgap) / qrows, qcw = (12.13 - 0.25) / 2
    for (let i = 0; i < quotes.length; i++) {
      const q = quotes[i], x = 0.6 + (i % 2) * (qcw + 0.25), y = qTop + Math.floor(i / 2) * (qh + qgap)
      s.addShape('roundRect', { x, y, w: qcw, h: qh, fill: { color: CARD }, line: { color: CB }, rectRadius: 0.06 })
      s.addText('“' + String(q.text || '').slice(0, 240) + '”', { x: x + 0.28, y: y + 0.18, w: qcw - 0.52, h: qh - 0.72, fontSize: 10.5, italic: true, color: BODY, valign: 'top' })
      s.addText(String(q.guest || ''), { x: x + 0.28, y: y + qh - 0.44, w: 3, h: 0.3, fontSize: 9, bold: true, color: INK, charSpacing: 1 })
      s.addText(String(q.unit || '') + (q.br ? ' · ' + q.br : ''), { x: x + qcw - 2.9, y: y + qh - 0.44, w: 2.6, h: 0.3, align: 'right', fontSize: 8.5, color: MUT })
    }
  }

  // hearing / doing
  const themes = (voices.themes || []).slice(0, 3)
  if (themes.length) {
    const s = pptx.addSlide()
    s.background = { color: BAND }
    s.addText("WHAT WE'RE HEARING  ·  AND WHAT WE'RE DOING", { x: 0.6, y: 0.5, w: 12.13, h: 0.4, fontSize: 14, bold: true, color: GOLD, charSpacing: 2 })
    const n = Math.max(1, themes.length), tTop = 1.45, tgap = 0.3, th = (CBOT - tTop - (n - 1) * tgap) / n
    for (let i = 0; i < themes.length; i++) {
      const y = tTop + i * (th + tgap)
      s.addShape('rect', { x: 0.6, y: y + 0.05, w: 0.05, h: th - 0.1, fill: { color: ACC } })
      s.addText(String(themes[i].title || ''), { x: 0.95, y, w: 11.6, h: 0.4, fontSize: 15, bold: true, color: 'FFFFFF' })
      s.addText(String(themes[i].body || '').slice(0, 300), { x: 0.95, y: y + 0.46, w: 11.6, h: th - 1.0, fontSize: 11.5, color: 'DDDDDD', valign: 'top' })
      s.addText(String(themes[i].action || '').slice(0, 240), { x: 0.95, y: y + th - 0.5, w: 11.6, h: 0.45, fontSize: 11.5, color: GOLD })
    }
  }

  // projects
  const weeks = (projects.weeks || []).slice(0, 3)
  if (weeks.length) {
    const s = pptx.addSlide()
    head(s, 'PROJECTS', projects.headline, projects.subtitle)
    const tracking = (projects.tracking || []).slice(0, 4)
    const colBottom = tracking.length ? 6.05 : CBOT
    const n = Math.max(1, weeks.length), wgap = 0.2, ww = (12.13 - (n - 1) * wgap) / n
    for (let wi = 0; wi < weeks.length; wi++) {
      const w = weeks[wi], x = 0.6 + wi * (ww + wgap)
      s.addShape('roundRect', { x, y: CT, w: ww, h: colBottom - CT, fill: { color: CARD }, line: { color: CB }, rectRadius: 0.06 })
      s.addText(String(w.label || ''), { x: x + 0.22, y: CT + 0.15, w: ww - 0.4, h: 0.3, fontSize: 11, bold: true, color: ACC, charSpacing: 1 })
      let body = ''
      const groups = (w.groups || []).slice(0, 4)
      for (let gi = 0; gi < groups.length; gi++) {
        body += String(groups[gi].category || '').toUpperCase() + '\n'
        const items = (groups[gi].items || []).slice(0, 5)
        for (let ii = 0; ii < items.length; ii++) body += '• ' + String(items[ii]).slice(0, 90) + '\n'
        body += '\n'
      }
      s.addText(body.slice(0, 1000), { x: x + 0.22, y: CT + 0.52, w: ww - 0.44, h: colBottom - CT - 0.6, fontSize: 9, color: BODY, valign: 'top' })
    }
    if (tracking.length) {
      s.addShape('roundRect', { x: 0.6, y: 6.25, w: 12.13, h: 0.7, fill: { color: cx(t.trackBg, 'FFFDF7') }, line: { color: GOLD, dashType: 'dash' }, rectRadius: 0.06 })
      let names = ''
      for (let i = 0; i < tracking.length; i++) names += (i ? '   ·   ' : '') + String(tracking[i].title || '')
      s.addText('IN PROGRESS:  ' + names.slice(0, 200), { x: 0.95, y: 6.42, w: 11.4, h: 0.4, fontSize: 10.5, bold: true, color: GOLD })
    }
  }

  // manually-added completed work (grouped by type) — its own clean slide when present
  const manual = Array.isArray(projects.manual) ? projects.manual : []
  const manualG: Any[] = (manual.length && typeof manual[0] === 'string')
    ? [{ category: 'COMPLETED WORK', items: (manual as Any[]).filter(x => typeof x === 'string') }]
    : (manual as Any[]).filter(g => g && typeof g === 'object' && Array.isArray(g.items) && g.items.length)
  if (manualG.length) {
    const s = pptx.addSlide()
    head(s, 'COMPLETED WORK', projects.headline || 'Work completed this period.')
    let body = ''
    for (const g of manualG.slice(0, 8)) {
      body += String(g.category || 'COMPLETED WORK').toUpperCase() + '\n'
      for (const it of (g.items || []).slice(0, 12)) body += '• ' + String(it).slice(0, 110) + '\n'
      body += '\n'
    }
    s.addText(body.slice(0, 2200), { x: 0.6, y: CT, w: 12.13, h: CBOT - CT, fontSize: 12, color: BODY, valign: 'top' })
  }

  // custom sections (owner-added) — one clean slide each
  const custom = Array.isArray(c.custom) ? c.custom : []
  for (let ci = 0; ci < custom.length; ci++) {
    const cs = custom[ci]
    if (!cs || (!String(cs.title || '').trim() && !String(cs.body || '').trim())) continue
    const s = pptx.addSlide()
    head(s, String(cs.eyebrow || 'SECTION').toUpperCase().slice(0, 40), String(cs.title || ''))
    s.addText(String(cs.body || ''), { x: 0.6, y: CT, w: 12.13, h: CBOT - CT, fontSize: 14, color: BODY, valign: 'top' })
  }

  return pptx
}

// ---------- tiny editable primitives (module scope: keeps input focus) ----------
function Ed({ v, set, edit, className, multiline, placeholder }: {
  v: string; set: (s: string) => void; edit: boolean; className?: string; multiline?: boolean; placeholder?: string
}) {
  if (!edit) return <span className={className}>{v}</span>
  if (multiline) {
    return (
      <textarea
        value={v}
        placeholder={placeholder}
        onChange={e => set(e.target.value)}
        rows={Math.max(2, Math.ceil((v || '').length / 60))}
        className={(className || '') + ' w-full rounded-md px-1.5 py-0.5 outline-none'}
        style={{ color: 'inherit', font: 'inherit', letterSpacing: 'inherit', background: 'var(--ed-bg)', border: '1px dashed var(--ed-border)' }}
      />
    )
  }
  return (
    <input
      value={v}
      placeholder={placeholder}
      onChange={e => set(e.target.value)}
      className={(className || '') + ' rounded-md px-1.5 outline-none min-w-0'}
      style={{ color: 'inherit', font: 'inherit', letterSpacing: 'inherit', width: Math.max(4, (v || '').length + 2) + 'ch', background: 'var(--ed-bg)', border: '1px dashed var(--ed-border)' }}
    />
  )
}

function SectionShell({ id, title, hidden, edit, onToggle, onAi, children }: {
  id: string; title: string; hidden: boolean; edit: boolean; onToggle: () => void; onAi?: () => void; children: React.ReactNode
}) {
  if (hidden && !edit) return null
  return (
    <section className="relative">
      {edit && (
        <div className="absolute -top-3 right-4 z-10 flex items-center gap-1.5">
          {onAi && (
            <button
              onClick={onAi}
              className="inline-flex items-center gap-1 rounded-full shadow px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: 'var(--t-card)', border: '1px solid var(--t-border)', color: 'var(--t-accent)' }}
            >
              <Sparkles size={11} /> AI
            </button>
          )}
          <button
            onClick={onToggle}
            className="inline-flex items-center gap-1 rounded-full shadow px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: 'var(--t-card)', border: '1px solid var(--t-border)', color: 'var(--t-ink)' }}
          >
            {hidden ? <Eye size={11} /> : <EyeOff size={11} />} {hidden ? 'Show ' + title : 'Hide ' + title}
          </button>
        </div>
      )}
      <div className={hidden ? 'opacity-30 pointer-events-none select-none' : ''}>{children}</div>
    </section>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-[0.28em]" style={{ color: 'var(--t-accent)' }}>{children}</p>
}

// ---------- main ----------
export function ReportView({ initial, canEdit, isTeam }: { initial: Any; canEdit: boolean; isTeam?: boolean }) {
  const [c, setC] = useState<Any>(initial.content || {})
  const [edit, setEdit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [copied, setCopied] = useState(false)
  const [themeKey, setThemeKey] = useState<string>(THEMES[initial.theme] ? initial.theme : 'capri')
  const t = THEMES[themeKey]
  function switchTheme(k: string) {
    setThemeKey(k)
    fetch('/api/reports', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: initial.id, theme: k }) }).catch(() => {})
  }
  const [busy, setBusy] = useState('')
  const [attachMsg, setAttachMsg] = useState('')
  const [picker, setPicker] = useState(false)
  const [pool, setPool] = useState<{ url: string; thumb: string; listing: string }[] | null>(null)
  const [manualLine, setManualLine] = useState('')
  const [manualCat, setManualCat] = useState('')
  const [manualAiNotes, setManualAiNotes] = useState('')
  const manualFileRef = useRef<HTMLInputElement>(null)
  const [pwMode, setPwMode] = useState<'set' | 'unlock' | null>(null)
  const [pwValue, setPwValue] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const pacingRef = useRef<HTMLInputElement>(null)
  const stmtRef = useRef<HTMLInputElement>(null)
  const heroRef = useRef<HTMLInputElement>(null)
  const aiFileRef = useRef<HTMLInputElement>(null)
  const [aiKey, setAiKey] = useState<string | null>(null)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiFiles, setAiFiles] = useState<string[]>([])
  const [aiBusy, setAiBusy] = useState(false)
  const [rvFrom, setRvFrom] = useState('')
  const [rvTo, setRvTo] = useState('')
  const [rvBusy, setRvBusy] = useState(false)

  // ---------- present mode (full-screen slideshow) ----------
  const [present, setPresent] = useState(false)
  const [showMonths, setShowMonths] = useState(false)
  const [snFrom, setSnFrom] = useState('')
  const [snTo, setSnTo] = useState('')
  const [snLabel, setSnLabel] = useState('')
  const [snBusy, setSnBusy] = useState(false)
  const [showListings, setShowListings] = useState(false)
  const [blBusy, setBlBusy] = useState(false)
  const grossMode = !!c.showGross // legacy flag; superseded by the basis config below
  // ---- revenue basis (see lib/basis.ts): per-section, falling back to the report default ----
  const bcfg: Any = c.basis || {}
  const bDefault: Basis = bcfg.default || 'netota'
  const bSection = (k: 'snaps' | 'byListing'): Basis => (bcfg[k] || bDefault)
  const snapPrimary: Basis = bcfg.snapshotPrimary || bDefault
  const snapSecondary: Basis | 'none' = (bcfg.snapshotSecondary === undefined ? 'gross' : bcfg.snapshotSecondary)
  const setBasis = (field: string, val: string) => mutate((d: Any) => { d.basis = { ...(d.basis || {}), [field]: val } })
  const [fltBld, setFltBld] = useState('')
  const [fltBr, setFltBr] = useState('')
  const [fltUnit, setFltUnit] = useState('')
  const [slide, setSlide] = useState(0)
  const slideRef = useRef(0)
  slideRef.current = slide
  const scrollRef = useRef<HTMLDivElement>(null)
  function slideEls(): HTMLElement[] {
    const el = scrollRef.current
    if (!el) return []
    return (Array.prototype.slice.call(el.children) as HTMLElement[]).filter(ch => ch.tagName === 'SECTION' || ch.tagName === 'HEADER')
  }
  function goTo(idx: number) {
    const kids = slideEls()
    if (!kids.length) return
    const i = Math.max(0, Math.min(kids.length - 1, idx))
    setSlide(i)
    if (kids[i]) kids[i].scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  function enterPresent() {
    setEdit(false); setAiKey(null); setPicker(false)
    setPresent(true); setSlide(0)
    setTimeout(() => {
      const el = scrollRef.current
      try {
        const rf = (el && (el as Any).requestFullscreen) ? (el as Any).requestFullscreen() : ((document.documentElement as Any).requestFullscreen && (document.documentElement as Any).requestFullscreen())
        if (rf && rf.catch) rf.catch(() => {})
      } catch {}
      if (el) el.scrollTop = 0
    }, 40)
  }
  function exitPresent() {
    setPresent(false)
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        const p = document.exitFullscreen()
        if (p && (p as Any).catch) (p as Any).catch(() => {})
      }
    } catch {}
  }
  function onPresentScroll() {
    const el = scrollRef.current
    if (!present || !el) return
    const kids = slideEls()
    const mid = el.scrollTop + el.clientHeight / 2
    let best = 0
    for (let i = 0; i < kids.length; i++) { if (kids[i].offsetTop <= mid) best = i }
    if (best !== slideRef.current) setSlide(best)
  }
  useEffect(() => {
    if (!present) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { exitPresent() }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); goTo(slideRef.current + 1) }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); goTo(slideRef.current - 1) }
    }
    function onFs() { if (!document.fullscreenElement) setPresent(false) }
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFs)
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present])

  // path setter: patch('voices.quotes.0.text', v)
  function patch(path: string, value: Any) {
    setC((prev: Any) => {
      const next = JSON.parse(JSON.stringify(prev))
      const parts = path.split('.')
      let node = next
      for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]]
      node[parts[parts.length - 1]] = value
      return next
    })
  }
  function mutate(fn: (draft: Any) => void) {
    setC((prev: Any) => { const next = JSON.parse(JSON.stringify(prev)); fn(next); return next })
  }
  const omit: string[] = Array.isArray(c.omit) ? c.omit : []
  const isHidden = (k: string) => omit.indexOf(k) >= 0
  function toggleSection(k: string) {
    mutate(d => {
      d.omit = Array.isArray(d.omit) ? d.omit : []
      const i = d.omit.indexOf(k)
      if (i >= 0) d.omit.splice(i, 1); else d.omit.push(k)
    })
  }

  async function save() {
    setSaving(true)
    try {
      const r = await fetch('/api/reports', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: initial.id, content: c }),
      })
      const d = await r.json()
      if (d?.ok) { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2000) }
      else { setAttachMsg(d && d.error === 'unauthorized' ? 'Session expired — refresh and sign in to save.' : 'Could not save — try again.') }
    } catch { setAttachMsg('Could not save — check your connection.') }
    setSaving(false)
    setEdit(true) // stay in edit mode after saving
  }

  function copyLink() {
    try { navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {}
  }

  // shared team-edit password: set (team) / unlock (anyone with the link + password)
  function openPw(mode: 'set' | 'unlock') { setPwMode(mode); setPwValue(''); setPwMsg('') }
  async function submitPw() {
    if (!pwValue || pwBusy) return
    setPwBusy(true); setPwMsg('')
    try {
      const r = await fetch('/api/reports/edit-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: pwMode, password: pwValue }) })
      const d = await r.json()
      if (d?.ok) {
        if (pwMode === 'unlock') { window.location.reload(); return }
        setPwMsg('Saved. Share the link + password with your team.'); setPwValue(''); setTimeout(() => setPwMode(null), 1400)
      } else { setPwMsg((d && d.error) || 'Something went wrong.') }
    } catch { setPwMsg('Something went wrong.') }
    setPwBusy(false)
  }

  // manual "completed work" — typed lines or a parsed file, grouped by type, added on top of the Breezeway pull.
  // Model: projects.manual = [{ category, items[] }]. Legacy reports stored a flat string[]; we migrate on first write.
  function manualGroups(): Any[] {
    const arr = Array.isArray(projects.manual) ? projects.manual : []
    if (arr.length && typeof arr[0] === 'string') return [{ category: 'COMPLETED WORK', items: (arr as Any[]).filter(x => typeof x === 'string') }]
    return (arr as Any[]).filter(g => g && typeof g === 'object').map(g => ({ category: String(g.category || 'COMPLETED WORK'), items: Array.isArray(g.items) ? g.items.filter((x: Any) => typeof x === 'string') : [] }))
  }
  function addManualToGroup(dr: Any, category: string, line: string) {
    dr.projects = dr.projects || {}
    let m: Any[] = Array.isArray(dr.projects.manual) ? dr.projects.manual : []
    if (m.length && typeof m[0] === 'string') m = [{ category: 'COMPLETED WORK', items: m.filter(x => typeof x === 'string') }]
    const cat = (category || 'COMPLETED WORK').toUpperCase().slice(0, 40)
    let g = m.find(x => x && String(x.category || '').toUpperCase() === cat)
    if (!g) { g = { category: cat, items: [] }; m.push(g) }
    if (!Array.isArray(g.items)) g.items = []
    g.items.push(line)
    dr.projects.manual = m
  }
  function addManualLine() {
    const v = manualLine.trim(); if (!v) return
    const cat = manualCat.trim() || 'COMPLETED WORK'
    mutate(d => addManualToGroup(d, cat, v))
    setManualLine('')
  }
  async function onManualFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0]; if (!f) return
    setAttachMsg(''); setBusy('completed')
    const url = await uploadOne(f)
    if (url) {
      try {
        const r = await fetch('/api/reports/attach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportId: initial.id, kind: 'completed', url }) })
        const d = await r.json()
        const groups: Any[] = Array.isArray(d?.groups) ? d.groups : (Array.isArray(d?.items) ? [{ category: 'COMPLETED WORK', items: d.items }] : [])
        const total = groups.reduce((a: number, g: Any) => a + ((Array.isArray(g?.items) ? g.items : []).length), 0)
        if (d?.ok && total) {
          mutate(dr => { for (const g of groups) { const cat = String(g?.category || 'COMPLETED WORK'); for (const it of (Array.isArray(g?.items) ? g.items : [])) if (String(it).trim()) addManualToGroup(dr, cat, String(it)) } })
          setAttachMsg('Added ' + total + ' item(s) from the file — review, then Save.')
        } else { setAttachMsg((d && d.error) || 'Could not read work items from that file.') }
      } catch { setAttachMsg('Could not read that file.') }
    }
    setBusy(''); if (manualFileRef.current) manualFileRef.current.value = ''
  }
  // Type rough notes → AI sorts them into type groups and fills COMPLETED WORK.
  async function autofillFromNotes() {
    const notes = manualAiNotes.trim(); if (!notes || busy) return
    setAttachMsg(''); setBusy('completed-ai')
    try {
      const r = await fetch('/api/reports/attach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportId: initial.id, kind: 'completed', text: notes }) })
      const d = await r.json()
      const groups: Any[] = Array.isArray(d?.groups) ? d.groups : []
      const total = groups.reduce((a: number, g: Any) => a + ((Array.isArray(g?.items) ? g.items : []).length), 0)
      if (d?.ok && total) {
        mutate(dr => { for (const g of groups) { const cat = String(g?.category || 'COMPLETED WORK'); for (const it of (Array.isArray(g?.items) ? g.items : [])) if (String(it).trim()) addManualToGroup(dr, cat, String(it)) } })
        setManualAiNotes(''); setAttachMsg('Added ' + total + ' item(s) from your notes — review, then Save.')
      } else { setAttachMsg((d && d.error) || 'Could not turn those notes into work items.') }
    } catch { setAttachMsg('Could not process those notes.') }
    setBusy('')
  }
  // Re-pull the latest Breezeway completed work for the period and replace the grouped weeks.
  async function refreshBreezeway() {
    if (busy) return
    setAttachMsg(''); setBusy('refresh-work')
    try {
      const r = await fetch('/api/reports/attach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportId: initial.id, kind: 'refresh-work' }) })
      const d = await r.json()
      if (d?.ok && Array.isArray(d.weeks)) {
        mutate(dr => { dr.projects = dr.projects || {}; dr.projects.weeks = d.weeks })
        const n = d.weeks.reduce((a: number, w: Any) => a + (w.groups || []).reduce((b: number, g: Any) => b + (g.items || []).length, 0), 0)
        setAttachMsg('Pulled the latest Breezeway work (' + n + ' item(s)) — review, then Save.')
      } else { setAttachMsg((d && d.error) || 'Could not refresh from Breezeway.') }
    } catch { setAttachMsg('Could not refresh from Breezeway.') }
    setBusy('')
  }

  // ---- attachments on an existing report (P3.5) ----
  async function uploadOne(file: File): Promise<string | null> {
    const fd = new FormData()
    fd.append('file', file)
    try {
      const r = await fetch('/api/guidebook/upload', { method: 'POST', body: fd })
      const d = await r.json()
      if (d?.ok && d?.url) return d.url
      setAttachMsg(d?.error || 'Upload failed')
    } catch { setAttachMsg('Upload failed') }
    return null
  }
  async function parseAttach(payload: Any): Promise<Any | null> {
    try {
      const r = await fetch('/api/reports/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: initial.id, ...payload }),
      })
      const d = await r.json()
      if (d?.ok && d?.section) return d.section
      setAttachMsg(d?.error || 'Could not read that PDF')
    } catch { setAttachMsg('Could not read that PDF') }
    return null
  }
  async function onPacingPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    setAttachMsg(''); setBusy('pacing')
    const url = await uploadOne(f)
    if (url) {
      const section = await parseAttach({ kind: 'pacing', url })
      if (section) patch('pacing', section)
    }
    setBusy(''); e.target.value = ''
  }
  async function onStatementsPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files).slice(0, 4) : []
    if (!files.length) return
    setAttachMsg(''); setBusy('statements')
    const urls: string[] = []
    for (const f of files) {
      const url = await uploadOne(f)
      if (url) urls.push(url)
    }
    if (urls.length) {
      const section = await parseAttach({ kind: 'statements', urls })
      if (section) patch('statement', section)
    }
    setBusy(''); e.target.value = ''
  }
  async function onHeroPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    setAttachMsg(''); setBusy('hero')
    const url = await uploadOne(f)
    if (url) { patch('hero.heroImage', url); setPicker(false) }
    setBusy(''); e.target.value = ''
  }
  function openPicker() {
    setPicker(!picker)
    if (pool === null) {
      fetch('/api/reports/attach?photos=' + encodeURIComponent(initial.id)).then(r => r.json()).then(d => {
        setPool(Array.isArray(d?.photos) ? d.photos : [])
      }).catch(() => setPool([]))
    }
  }
  async function makePptx(): Promise<Any> {
    if (!(window as Any).PptxGenJS) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script')
        s.src = PPTX_CDN
        s.onload = resolve
        s.onerror = () => reject(new Error('load failed'))
        document.head.appendChild(s)
      })
    }
    const h = c.hero || {}
    let heroData: string | null = null
    if (h.heroImage) heroData = await fetchImageDataUrl(h.heroImage)
    return buildPptx((window as Any).PptxGenJS, c, t, heroData)
  }
  async function downloadPptx() {
    if (busy) return
    setAttachMsg(''); setBusy('pptx')
    try {
      const pptx = await makePptx()
      const h = c.hero || {}
      const name = String(h.title || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report'
      await pptx.writeFile({ fileName: name + '-owner-review.pptx' })
    } catch (_e) {
      setAttachMsg('PPTX export failed — try again.')
    }
    setBusy('')
  }
  async function sendToDrive() {
    if (busy) return
    setAttachMsg(''); setBusy('drive')
    try {
      const pptx = await makePptx()
      const b64 = await pptx.write('base64')
      const h = c.hero || {}
      const fileName = String(h.title || 'Owner Review') + ' — ' + String(h.eyebrow || 'Owner Review')
      const r = await fetch('/api/reports/pptx-to-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, base64: b64 }),
      })
      const d = await r.json()
      if (d?.ok && d?.link) {
        setAttachMsg('Sent to Google Drive ✓')
        window.open(d.link, '_blank')
      } else if (d?.needAuth) {
        setAttachMsg('Connect Google in the popup, then press Slides again.')
        window.open('/api/google/auth', 'gauth', 'width=540,height=680')
      } else {
        setAttachMsg((d && d.error) || 'Drive upload failed — try again.')
      }
    } catch (_e) {
      setAttachMsg('Drive upload failed — try again.')
    }
    setBusy('')
  }
  function openAi(k: string) { setAiKey(k); setAiPrompt(''); setAiFiles([]) }
  async function onAiFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    const url = await uploadOne(f)
    if (url) setAiFiles(prev => prev.concat([url]))
    e.target.value = ''
  }
  async function runAi() {
    if (!aiKey || !aiPrompt.trim() || aiBusy) return
    setAiBusy(true); setAttachMsg('')
    try {
      const r = await fetch('/api/reports/ai-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: initial.id, sectionKey: aiKey, section: c[aiKey] || {}, prompt: aiPrompt, fileUrls: aiFiles }),
      })
      const d = await r.json()
      if (d?.ok && d?.section) {
        patch(aiKey, d.section)
        setAttachMsg('AI updated the section — review it, then Save.')
        setAiKey(null)
      } else {
        setAttachMsg((d && d.error) || 'AI edit failed — try again.')
      }
    } catch (_e) { setAttachMsg('AI edit failed — try again.') }
    setAiBusy(false)
  }
  async function pullReviewsNow() {
    if (!rvFrom || !rvTo || rvBusy) return
    setRvBusy(true); setAttachMsg('')
    try {
      const r = await fetch('/api/reports/reviews?id=' + encodeURIComponent(initial.id) + '&from=' + rvFrom + '&to=' + rvTo)
      const d = await r.json()
      if (d?.ok && d?.kpi) {
        mutate(dr => { dr.voices = dr.voices || {}; dr.voices.kpi = d.kpi; dr.voices.all = d.reviews })
        setAttachMsg('Pulled ' + (d.kpi.count || 0) + ' reviews — Save to keep them on the report.')
      } else {
        setAttachMsg((d && d.error) || 'Could not pull reviews.')
      }
    } catch (_e) { setAttachMsg('Could not pull reviews.') }
    setRvBusy(false)
  }
  // Add an extra snapshot for a custom date range — same metrics engine as the main report.
  async function addSnapshotRange() {
    if (!snFrom || !snTo || snBusy) return
    if (snFrom > snTo) { setAttachMsg('Snapshot start date must be on or before the end date.'); return }
    setSnBusy(true); setAttachMsg('')
    try {
      const q = '/api/reports/snapshot-range?id=' + encodeURIComponent(initial.id) + '&from=' + snFrom + '&to=' + snTo + (snLabel.trim() ? '&label=' + encodeURIComponent(snLabel.trim()) : '')
      const r = await fetch(q)
      const d = await r.json()
      if (d?.ok && d?.snap) {
        mutate(dr => { dr.snaps = Array.isArray(dr.snaps) ? dr.snaps : []; dr.snaps.push(d.snap) })
        setSnFrom(''); setSnTo(''); setSnLabel('')
        setAttachMsg('Added snapshot "' + d.snap.label + '" — review, then Save.')
      } else { setAttachMsg((d && d.error) || 'Could not build that snapshot.') }
    } catch (_e) { setAttachMsg('Could not build that snapshot.') }
    setSnBusy(false)
  }
  // Pull each listing's own performance for the report period (Revenue/Occ/ADR/RevPAR per unit).
  async function loadListingBreakdown() {
    if (blBusy) return
    setAttachMsg(''); setBlBusy(true)
    try {
      const r = await fetch('/api/reports/listing-breakdown?id=' + encodeURIComponent(initial.id))
      const d = await r.json()
      if (d?.ok && Array.isArray(d.listings)) {
        mutate(dr => { dr.byListing = d.listings })
        setShowListings(true)
        setAttachMsg('Pulled per-listing performance (' + d.listings.length + ' listing(s)) — review, then Save.')
      } else { setAttachMsg((d && d.error) || 'Could not pull per-listing performance.') }
    } catch (_e) { setAttachMsg('Could not pull per-listing performance.') }
    setBlBusy(false)
  }

  const meta = c.meta || {}
  const hero = c.hero || {}
  const snap = c.snapshot || {}
  const plan = c.plan
  const ahead = c.ahead || {}
  const voices = c.voices || {}
  const projects = c.projects || {}
  const footer = (hero.title || '') + '  ·  ' + (hero.dateLabel || 'OWNER REVIEW')
  const customSecs: Any[] = (Array.isArray(c.custom) ? c.custom : []).filter((cs: Any) => cs && (String(cs.title || '').trim() || String(cs.body || '').trim()))
  const presentCount = (['hero', 'snapshot',
    (c.pacing ? 'pacing' : null),
    (plan ? 'plan' : null),
    ((c.statement && Array.isArray(c.statement.items) && c.statement.items.length) ? 'statement' : null),
    'ahead', 'voices', 'projects'] as (string | null)[])
    .filter(k => !!k && (k === 'hero' || !isHidden(k as string))).length + customSecs.length

  return (
    <div className="min-h-screen" style={{ background: t.bg, color: t.ink, '--ed-bg': t.edBg, '--ed-border': t.edBorder, '--t-card': t.card, '--t-border': t.toolbarBorder, '--t-ink': t.ink, '--t-accent': t.accent } as Any}>
      {/* toolbar (edit only appears for logged-in team) */}
      {canEdit && (
        <div className="sticky top-0 z-20 flex items-center justify-end gap-2 px-4 py-2.5 flex-wrap" style={{ background: t.toolbarBg, backdropFilter: 'blur(6px)', borderBottom: '1px solid ' + t.rule }}>
          <div className="mr-auto inline-flex items-center gap-1 rounded-full p-0.5" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
            {Object.keys(THEMES).map(k => (
              <button key={k} onClick={() => switchTheme(k)} className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={themeKey === k ? { background: t.ink, color: t.bg } : { color: t.sub }}>
                {THEMES[k].label}
              </button>
            ))}
          </div>
          {attachMsg && <span className="text-[11px] font-semibold" style={{ color: t.accent }}>{attachMsg}</span>}
          {edit && (
            <>
              <input ref={pacingRef} type="file" accept="application/pdf" className="hidden" onChange={onPacingPick} />
              <input ref={stmtRef} type="file" accept="application/pdf" multiple className="hidden" onChange={onStatementsPick} />
              <input ref={heroRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onHeroPick} />
              <button onClick={() => pacingRef.current && pacingRef.current.click()} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
                {busy === 'pacing' ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />} Pacing PDF
              </button>
              <button onClick={() => stmtRef.current && stmtRef.current.click()} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
                {busy === 'statements' ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />} Statements
              </button>
              <button onClick={openPicker} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={picker ? { background: t.ink, color: t.bg } : { background: t.card, border: '1px solid ' + t.toolbarBorder }}>
                {busy === 'hero' ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />} Hero photo
              </button>
            </>
          )}
          {isTeam && (
            <button onClick={() => openPw('set')} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
              <Lock size={12} /> Team password
            </button>
          )}
          <button onClick={downloadPptx} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
            {busy === 'pptx' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} PPTX
          </button>
          <button onClick={sendToDrive} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
            {busy === 'drive' ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />} Slides
          </button>
          <button onClick={enterPresent} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold" style={{ background: t.ink, color: t.bg }}>
            <Play size={12} /> Present
          </button>
          <button onClick={copyLink} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
            {copied ? <Check size={12} /> : <LinkIcon size={12} />} {copied ? 'Copied' : 'Copy share link'}
          </button>
          {edit && (
            <button onClick={save} disabled={saving} className="inline-flex items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60" style={{ background: t.accent, color: t.card, minWidth: 132 }}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} {saving ? 'Saving…' : savedFlash ? 'Saved ✓' : 'Save changes'}
            </button>
          )}
          <button onClick={() => setEdit(!edit)} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold" style={edit ? { background: t.ink, color: t.bg } : { background: t.card, border: '1px solid ' + t.toolbarBorder }}>
            <Pencil size={12} /> {edit ? 'Done editing' : 'Edit report'}
          </button>
        </div>
      )}

      {/* hero photo picker: pick from the scoped listings' Guesty photos, or upload */}
      {canEdit && edit && picker && (
        <div className="px-4 py-3 border-b" style={{ background: t.trackBg, borderColor: t.rule }}>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.gold }}>HERO PHOTO  ·  FROM THE LISTING</p>
            <button onClick={() => heroRef.current && heroRef.current.click()} disabled={!!busy} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
              <Plus size={11} /> Upload instead
            </button>
            {hero.heroImage && (
              <button onClick={() => patch('hero.heroImage', null)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder, color: t.accent }}>
                <X size={11} /> Remove current
              </button>
            )}
            <button onClick={() => setPicker(false)} className="ml-auto" style={{ color: t.muted }}><X size={14} /></button>
          </div>
          {pool === null ? (
            <p className="mt-2 text-[12px] italic" style={{ color: t.muted }}>Loading listing photos&hellip;</p>
          ) : pool.length ? (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {pool.map((p, i) => (
                <button key={i} onClick={() => { patch('hero.heroImage', p.url); setPicker(false) }} className="shrink-0 rounded-lg overflow-hidden border-2" style={{ borderColor: hero.heroImage === p.url ? t.accent : t.cardBorder }} title={p.listing}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumb} alt="" loading="lazy" className="h-20 w-28 object-cover" />
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[12px] italic" style={{ color: t.muted }}>No listing photos found for this report&rsquo;s properties &mdash; use Upload instead.</p>
          )}
        </div>
      )}

      {/* AI section editor (P7): prompt + optional file attachments, rewrites one section */}
      {canEdit && edit && aiKey && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[min(680px,92vw)] rounded-2xl shadow-xl border p-4" style={{ background: t.card, borderColor: t.toolbarBorder }}>
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.gold }}>AI EDIT &middot; {aiKey}</p>
            <button onClick={() => setAiKey(null)} className="ml-auto" style={{ color: t.muted }}><X size={14} /></button>
          </div>
          <textarea
            value={aiPrompt}
            onChange={e => setAiPrompt(e.target.value)}
            rows={2}
            placeholder="Tell the AI what to change in this section &mdash; e.g. make it punchier, add the roof project, fold in the attached vendor report&hellip;"
            className="mt-2 w-full rounded-xl px-3 py-2 text-[13px] outline-none"
            style={{ background: t.chip, border: '1px solid ' + t.cardBorder, color: t.ink }}
          />
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <input ref={aiFileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={onAiFilePick} />
            <button onClick={() => aiFileRef.current && aiFileRef.current.click()} disabled={aiBusy} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50" style={{ background: t.chip, border: '1px solid ' + t.cardBorder, color: t.ink }}>
              <Paperclip size={11} /> Attach file
            </button>
            {aiFiles.map((u, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]" style={{ background: t.chip, color: t.sub }}>
                file {i + 1}
                <button onClick={() => setAiFiles(aiFiles.filter((_x, xi) => xi !== i))} style={{ color: t.accent }}><X size={11} /></button>
              </span>
            ))}
            <button onClick={runAi} disabled={aiBusy || !aiPrompt.trim()} className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: t.accent, color: t.card }}>
              {aiBusy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Apply
            </button>
          </div>
        </div>
      )}

      {/* elevated look: smoother rhythm + hairline dividers between sections */}
      <style>{`
        html { scroll-behavior: smooth; }
        .sb-report > section { margin-top: 2.25rem; border-top: 1px solid ${t.rule}; }
        .sb-report > section:first-of-type { border-top: 0; margin-top: 0; }
        .sb-present { position: fixed; inset: 0; height: 100vh; width: 100vw; overflow-y: scroll; scroll-snap-type: y mandatory; z-index: 40; background: ${t.bg}; -ms-overflow-style: none; scrollbar-width: none; }
        .sb-present::-webkit-scrollbar { display: none; }
        .sb-present > section, .sb-present > header { min-height: 100vh; display: flex; flex-direction: column; justify-content: center; scroll-snap-align: start; padding: 5vh 7vw; box-sizing: border-box; border: 0 !important; margin: 0 !important; }
        .sb-present > header { text-align: center; }
        .sb-present > footer { display: none; }
        .sb-present > section > *, .sb-present > header > * { max-width: 1080px; width: 100%; margin-left: auto; margin-right: auto; }
        .sb-present > section > * > .pt-12 { padding-top: 0 !important; }
        .sb-present header img { height: 58vh !important; max-height: 58vh !important; width: 100%; object-fit: cover; border-radius: 18px; }
        .sb-present img { object-fit: cover; }
      `}</style>

      {/* Present + unlock-editing buttons for viewers (no edit toolbar) */}
      {!canEdit && !present && (
        <div className="fixed top-4 right-4 z-30 flex items-center gap-2">
          <button onClick={() => openPw('unlock')} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-semibold shadow-lg" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder, color: t.ink }}>
            <Lock size={12} /> Team edit
          </button>
          <button onClick={enterPresent} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold shadow-lg" style={{ background: t.ink, color: t.bg }}>
            <Play size={13} /> Present
          </button>
        </div>
      )}

      {/* team-edit password modal (set / unlock) */}
      {pwMode && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(16,42,67,0.35)' }} onClick={() => !pwBusy && setPwMode(null)}>
          <div className="w-[min(420px,94vw)] rounded-2xl shadow-xl border p-5" style={{ background: t.card, borderColor: t.toolbarBorder }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <Lock size={14} style={{ color: t.accent }} />
              <p className="text-[13px] font-bold" style={{ color: t.ink }}>{pwMode === 'set' ? 'Set the team edit password' : 'Unlock editing'}</p>
              <button onClick={() => setPwMode(null)} className="ml-auto" style={{ color: t.muted }}><X size={15} /></button>
            </div>
            <p className="mt-1.5 text-[12px]" style={{ color: t.sub }}>
              {pwMode === 'set' ? 'Teammates can edit any report by opening its link and entering this password.' : 'Enter the team password to edit this report on this device.'}
            </p>
            <input
              type="password" value={pwValue} autoFocus
              onChange={e => setPwValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitPw() }}
              placeholder={pwMode === 'set' ? 'New team password' : 'Team password'}
              className="mt-3 w-full rounded-xl px-3 py-2 text-[14px] outline-none"
              style={{ background: t.chip, border: '1px solid ' + t.cardBorder, color: t.ink }}
            />
            {pwMsg && <p className="mt-2 text-[12px] font-semibold" style={{ color: t.accent }}>{pwMsg}</p>}
            <button onClick={submitPw} disabled={pwBusy || !pwValue} className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: t.accent, color: t.card }}>
              {pwBusy ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />} {pwMode === 'set' ? 'Save password' : 'Unlock'}
            </button>
          </div>
        </div>
      )}

      {/* Present-mode overlay controls */}
      {present && (
        <>
          <button onClick={exitPresent} className="fixed top-4 right-4 z-[60] inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-semibold shadow-lg" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder, color: t.ink }}>
            <X size={13} /> Exit
          </button>
          <button onClick={() => goTo(slide - 1)} disabled={slide <= 0} className="fixed left-3 top-1/2 -translate-y-1/2 z-[60] rounded-full p-2.5 shadow-lg disabled:opacity-25" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder, color: t.ink }}>
            <ChevronLeft size={22} />
          </button>
          <button onClick={() => goTo(slide + 1)} disabled={slide >= presentCount - 1} className="fixed right-3 top-1/2 -translate-y-1/2 z-[60] rounded-full p-2.5 shadow-lg disabled:opacity-25" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder, color: t.ink }}>
            <ChevronRight size={22} />
          </button>
          <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 rounded-full px-3 py-2 shadow-lg" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
            {Array.from({ length: presentCount }).map((_x, i) => (
              <button key={i} onClick={() => goTo(i)} className="rounded-full transition-all" style={{ width: i === slide ? 22 : 8, height: 8, background: i === slide ? t.accent : t.toolbarBorder }} />
            ))}
          </div>
        </>
      )}

      <div ref={scrollRef} onScroll={onPresentScroll} className={present ? 'sb-present' : 'sb-report max-w-4xl mx-auto px-5 sm:px-8 pb-20'}>

        {/* ---------- HERO ---------- */}
        <header className="relative pt-14 pb-12 text-center border-b" style={{ borderColor: t.rule }}>
          {edit && (
            <button onClick={() => openAi('hero')} className="absolute top-4 right-4 inline-flex items-center gap-1 rounded-full shadow px-2.5 py-1 text-[11px] font-semibold" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder, color: t.accent }}>
              <Sparkles size={11} /> AI
            </button>
          )}
          <Eyebrow>{hero.eyebrow || ''}</Eyebrow>
          <p className="mt-5 text-[12px] font-bold uppercase tracking-[0.3em]" style={{ color: t.gold }}>
            <Ed v={hero.dateLabel || 'OWNER REVIEW'} set={v => patch('hero.dateLabel', v)} edit={edit} />
          </p>
          <h1 className="mt-2 text-5xl sm:text-6xl font-black tracking-tight" style={{ color: t.ink }}>
            <Ed v={hero.title || ''} set={v => patch('hero.title', v)} edit={edit} />
          </h1>
          <p className="mt-5 text-lg sm:text-xl font-medium max-w-2xl mx-auto" style={{ color: t.body }}>
            <Ed v={hero.headline || ''} set={v => patch('hero.headline', v)} edit={edit} multiline />
          </p>
          {hero.heroImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hero.heroImage} alt="" className="mt-8 w-full rounded-2xl shadow-md object-cover" style={{ maxHeight: 420 }} />
          )}
          <p className="mt-8 text-[12px] uppercase tracking-[0.18em] font-semibold" style={{ color: t.footA }}>
            <Ed v={hero.preparedFor || ''} set={v => patch('hero.preparedFor', v)} edit={edit} />  ·  STAY HOSPITALITY
          </p>
        </header>

        {/* ---------- SNAPSHOT ---------- */}
        <SectionShell id="snapshot" title="Snapshot" hidden={isHidden('snapshot')} edit={edit} onToggle={() => toggleSection('snapshot')} onAi={() => openAi('snapshot')}>
          <div className="pt-12">
            <Eyebrow>SNAPSHOT</Eyebrow>
            <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
              <Ed v={snap.headline || ''} set={v => patch('snapshot.headline', v)} edit={edit} multiline />
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: t.sub }}>
              <Ed v={snap.subtitle || ''} set={v => patch('snapshot.subtitle', v)} edit={edit} />
            </p>
            {edit && hasBasisRaw(snap.metrics) && (
              <div className="mt-4 flex items-center gap-3 flex-wrap rounded-xl p-3" style={{ background: t.chip, border: '1px dashed ' + t.cardBorder }}>
                <BasisPicker label="Big number" value={snapPrimary} onPick={(v: string) => setBasis('snapshotPrimary', v)} t={t} />
                <BasisPicker label="Below it" value={snapSecondary} withNone onPick={(v: string) => setBasis('snapshotSecondary', v)} t={t} />
              </div>
            )}
            <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
              {(snap.cards || []).map((card: Any, i: number) => {
                const M = snap.metrics
                const canBasis = hasBasisRaw(M) && (card.key === 'revenue' || card.key === 'adr' || card.key === 'revpar')
                const pick = (b: Basis) => { const s = basisStrings(M, b); return card.key === 'revenue' ? s.rev : card.key === 'adr' ? s.adr : s.revpar }
                const primaryVal = canBasis ? pick(snapPrimary) : null
                const secondaryVal = canBasis && snapSecondary !== 'none' ? pick(snapSecondary as Basis) : null
                return (
                <div key={card.key || i} className="relative rounded-2xl p-5 shadow-sm border flex flex-col" style={{ background: t.card, borderColor: t.cardBorder }}>
                  {edit && (
                    <button onClick={() => mutate(d => d.snapshot.cards.splice(i, 1))} className="absolute top-2 right-2" style={{ color: t.accent }}><X size={13} /></button>
                  )}
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.accent }}>
                    <Ed v={card.label || ''} set={v => patch('snapshot.cards.' + i + '.label', v)} edit={edit} />
                  </p>
                  <p className="mt-2 text-4xl font-black tabular-nums" style={{ color: t.ink }}>
                    {primaryVal != null ? primaryVal : <Ed v={card.value || ''} set={v => patch('snapshot.cards.' + i + '.value', v)} edit={edit} />}
                  </p>
                  {secondaryVal != null ? (
                    <p className="mt-1 text-[13px] font-bold tabular-nums" style={{ color: t.accent }}>{BASIS_SHORT[snapSecondary as Basis]} {secondaryVal}</p>
                  ) : (grossMode && cardGross(card) && (
                    <p className="mt-1 text-[13px] font-bold tabular-nums" style={{ color: t.accent }}>Gross {cardGross(card)}</p>
                  ))}
                  <p className="mt-auto pt-2 text-[11px] leading-snug" style={{ color: t.sub }}>
                    <Ed v={card.sub || ''} set={v => patch('snapshot.cards.' + i + '.sub', v)} edit={edit} multiline />
                  </p>
                </div>
                )
              })}
            </div>
            {snap.ytd && (
              <div className="mt-5 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-5" style={{ background: t.band, color: 'white' }}>
                <div className="flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.gold }}>{meta.asOf ? String(meta.asOf).slice(0, 4) : ''} YEAR-TO-DATE</p>
                  <p className="mt-1.5 text-sm text-white/85">
                    <Ed v={snap.ytd.text || ''} set={v => patch('snapshot.ytd.text', v)} edit={edit} multiline />
                  </p>
                </div>
                <div className="flex gap-6">
                  {(snap.ytd.stats || []).map((s: Any, i: number) => (
                    <div key={i} className="text-center">
                      <p className="text-2xl font-black tabular-nums"><Ed v={s.value || ''} set={v => patch('snapshot.ytd.stats.' + i + '.value', v)} edit={edit} /></p>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-white/60 font-semibold mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SectionShell>

        {/* ---------- MONTH-BY-MONTH (toggle, only for multi-month periods) ---------- */}
        {Array.isArray(c.byMonth) && c.byMonth.length >= 2 && (
          <div className="pt-10">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Eyebrow>MONTH BY MONTH</Eyebrow>
              <button onClick={() => setShowMonths(v => !v)} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold" style={{ background: showMonths ? t.accent : t.chip, border: '1px solid ' + (showMonths ? t.accent : t.cardBorder), color: showMonths ? t.card : t.ink }}>
                {showMonths ? 'Hide monthly view' : 'View by month'}
              </button>
            </div>
            {showMonths && (
              <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {c.byMonth.map((m: Any, i: number) => (
                  <div key={i} className="rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                    <p className="text-sm font-black tracking-[0.14em]" style={{ color: t.accent }}>{m.label}</p>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div><p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.muted }}>Revenue</p><p className="text-xl font-black tabular-nums" style={{ color: t.ink }}>{m.revenue}</p></div>
                      <div><p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.muted }}>Occupancy</p><p className="text-xl font-black tabular-nums" style={{ color: t.ink }}>{m.occPct}%</p></div>
                      <div><p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.muted }}>ADR</p><p className="text-xl font-black tabular-nums" style={{ color: t.ink }}>{m.adr}</p></div>
                      <div><p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.muted }}>RevPAR</p><p className="text-xl font-black tabular-nums" style={{ color: t.ink }}>{m.revpar}</p></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---------- MORE SNAPSHOTS (custom date-range snapshots) ---------- */}
        {(edit || (Array.isArray(c.snaps) && c.snaps.length > 0)) && (
          <div className="pt-10">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Eyebrow>MORE SNAPSHOTS</Eyebrow>
              {edit && (
                <BasisPicker label="Basis" value={bSection('snaps')} onPick={(v: string) => setBasis('snaps', v)} t={t} />
              )}
            </div>
            {edit && (
              <div className="mt-3 flex items-center gap-2 flex-wrap rounded-xl p-3" style={{ background: t.chip, border: '1px dashed ' + t.cardBorder }}>
                <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: t.muted }}>Add snapshot</span>
                <input value={snLabel} onChange={e => setSnLabel(e.target.value)} placeholder="Title (optional)" className="rounded-md px-2 py-1 text-[12px] w-44" style={{ background: t.card, border: '1px solid ' + t.cardBorder, color: t.ink }} />
                <input type="date" value={snFrom} onChange={e => setSnFrom(e.target.value)} className="rounded-md px-2 py-1 text-[12px]" style={{ background: t.card, border: '1px solid ' + t.cardBorder, color: t.ink }} />
                <span style={{ color: t.muted }}>&rarr;</span>
                <input type="date" value={snTo} onChange={e => setSnTo(e.target.value)} className="rounded-md px-2 py-1 text-[12px]" style={{ background: t.card, border: '1px solid ' + t.cardBorder, color: t.ink }} />
                <button onClick={addSnapshotRange} disabled={snBusy || !snFrom || !snTo} className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold disabled:opacity-50" style={{ background: t.ink, color: t.bg }}>
                  {snBusy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add snapshot
                </button>
              </div>
            )}
            {Array.isArray(c.snaps) && c.snaps.length > 0 && (
              <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {c.snaps.map((s: Any, i: number) => {
                  const sb = bSection('snaps')
                  const sv = hasBasisRaw(s) ? basisStrings(s, sb) : { rev: sb === 'net' ? s.revenue : (s.grossRevenue || s.revenue), adr: sb === 'net' ? s.adr : (s.grossAdr || s.adr), revpar: sb === 'net' ? s.revpar : (s.grossRevpar || s.revpar) }
                  return (
                  <div key={s.key || i} className="relative rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                    {edit && (
                      <button onClick={() => mutate(d => d.snaps.splice(i, 1))} className="absolute top-2 right-2" style={{ color: t.accent }}><X size={13} /></button>
                    )}
                    <p className="text-sm font-black tracking-[0.14em] pr-5" style={{ color: t.accent }}>
                      <Ed v={s.label || ''} set={v => patch('snaps.' + i + '.label', v)} edit={edit} />
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div><p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.muted }}>Revenue</p><p className="text-xl font-black tabular-nums" style={{ color: t.ink }}>{sv.rev}</p></div>
                      <div><p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.muted }}>Occupancy</p><p className="text-xl font-black tabular-nums" style={{ color: t.ink }}>{s.occPct}%</p></div>
                      <div><p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.muted }}>ADR</p><p className="text-xl font-black tabular-nums" style={{ color: t.ink }}>{sv.adr}</p></div>
                      <div><p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.muted }}>RevPAR</p><p className="text-xl font-black tabular-nums" style={{ color: t.ink }}>{sv.revpar}</p></div>
                    </div>
                    {(s.from && s.to) && <p className="mt-3 text-[11px]" style={{ color: t.muted }}>{s.from} &rarr; {s.to}{s.reservations != null ? ' · ' + s.reservations + ' res' : ''}</p>}
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ---------- PERFORMANCE BY LISTING ---------- */}
        {(edit || (Array.isArray(c.byListing) && c.byListing.length > 0)) && (
          <div className="pt-10">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Eyebrow>PERFORMANCE BY LISTING</Eyebrow>
              <div className="flex items-center gap-2">
                {edit && (
                  <BasisPicker label="Basis" value={bSection('byListing')} onPick={(v: string) => setBasis('byListing', v)} t={t} />
                )}
                {Array.isArray(c.byListing) && c.byListing.length > 0 && (
                  <button onClick={() => setShowListings(v => !v)} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold" style={{ background: showListings ? t.accent : t.chip, border: '1px solid ' + (showListings ? t.accent : t.cardBorder), color: showListings ? t.card : t.ink }}>
                    {showListings ? 'Hide by listing' : 'View by listing'}
                  </button>
                )}
                {edit && (
                  <button onClick={loadListingBreakdown} disabled={blBusy} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder, color: t.ink }}>
                    {blBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {Array.isArray(c.byListing) && c.byListing.length ? 'Refresh' : 'Pull per-listing'}
                  </button>
                )}
              </div>
            </div>
            {showListings && Array.isArray(c.byListing) && c.byListing.length > 0 && (() => {
              const allL: Any[] = c.byListing
              const buildings: string[] = Array.from(new Set(allL.map((l: Any) => String(l.building || '')).filter(Boolean))).sort()
              const brs: number[] = Array.from(new Set(allL.map((l: Any) => l.bedrooms).filter((v: Any) => v != null))).sort((a: Any, b: Any) => a - b)
              const rows: Any[] = allL.filter((l: Any) => (!fltBld || String(l.building || '') === fltBld) && (fltBr === '' || String(l.bedrooms) === fltBr) && (!fltUnit || l.id === fltUnit))
              const filtered = !!(fltBld || fltBr || fltUnit)
              const lb = bSection('byListing')
              const hasRaw = rows.length > 0 && rows.every((l: Any) => l.accomNum != null && l.availNights != null)
              const occN = rows.reduce((s: number, l: Any) => s + (l.occNights || 0), 0)
              const avN = rows.reduce((s: number, l: Any) => s + (l.availNights || 0), 0)
              const accom = rows.reduce((s: number, l: Any) => s + (l.accomNum || 0), 0)
              const accomGrossV = rows.reduce((s: number, l: Any) => s + (l.accomGrossNum != null ? l.accomGrossNum : (l.accomNum || 0)), 0)
              const grossV = rows.reduce((s: number, l: Any) => s + (l.grossNum || 0), 0)
              const val = lb === 'net' ? accom : lb === 'gross' ? grossV : accomGrossV
              const selStyle = { background: t.card, border: '1px solid ' + t.cardBorder, color: t.ink }
              const kpi = [
                { label: 'Revenue', value: fmtMoney(val) },
                { label: 'Occupancy', value: (avN ? Math.round((occN / avN) * 100) : 0) + '%' },
                { label: 'ADR', value: '$' + (occN ? Math.round(val / occN) : 0) },
                { label: 'RevPAR', value: '$' + (avN ? Math.round(val / avN) : 0) },
              ]
              return (
                <div>
                  {/* live filter bar */}
                  <div className="mt-4 flex items-center gap-2 flex-wrap rounded-xl p-3" style={{ background: t.chip, border: '1px solid ' + t.cardBorder }}>
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: t.muted }}>Filter</span>
                    {buildings.length > 1 && (
                      <select value={fltBld} onChange={e => setFltBld(e.target.value)} className="rounded-md px-2 py-1 text-[12px]" style={selStyle}>
                        <option value="">All buildings</option>
                        {buildings.map((b: string) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    )}
                    {brs.length > 1 && (
                      <select value={fltBr} onChange={e => setFltBr(e.target.value)} className="rounded-md px-2 py-1 text-[12px]" style={selStyle}>
                        <option value="">All room types</option>
                        {brs.map((b: number) => <option key={b} value={String(b)}>{b}BR</option>)}
                      </select>
                    )}
                    <select value={fltUnit} onChange={e => setFltUnit(e.target.value)} className="rounded-md px-2 py-1 text-[12px] max-w-[12rem]" style={selStyle}>
                      <option value="">All listings</option>
                      {allL.map((l: Any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                    {filtered && (
                      <button onClick={() => { setFltBld(''); setFltBr(''); setFltUnit('') }} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: t.card, border: '1px solid ' + t.cardBorder, color: t.ink }}><X size={11} /> Clear</button>
                    )}
                    <span className="text-[11px]" style={{ color: t.muted }}>{rows.length} of {allL.length} listing{allL.length === 1 ? '' : 's'}</span>
                  </div>
                  {/* live KPI strip for the current slice */}
                  {hasRaw && (
                    <div className="mt-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] mb-2" style={{ color: t.accent }}>{filtered ? 'Filtered slice' : 'All listings'} · {BASIS_LABEL[lb]}</p>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        {kpi.map((k: Any) => (
                          <div key={k.label} className="rounded-2xl p-4 border" style={{ background: t.card, borderColor: t.cardBorder }}>
                            <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.muted }}>{k.label}</p>
                            <p className="mt-1 text-2xl font-black tabular-nums" style={{ color: t.ink }}>{k.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* per-listing table (filtered) */}
                  <div className="mt-4 overflow-hidden rounded-2xl border" style={{ borderColor: t.cardBorder }}>
                    <div className="grid gap-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider" style={{ background: t.chip, color: t.muted, gridTemplateColumns: '1.7fr 1fr 0.8fr 1fr 1fr' }}>
                      <div>Listing</div><div className="text-right">Revenue</div><div className="text-right">Occ</div><div className="text-right">ADR</div><div className="text-right">RevPAR</div>
                    </div>
                    {rows.map((l: Any, i: number) => {
                      const lv = hasBasisRaw(l) ? basisStrings(l, lb) : { rev: lb === 'net' ? l.revenue : (l.grossRevenue || l.revenue), adr: lb === 'net' ? l.adr : (l.grossAdr || l.adr), revpar: lb === 'net' ? l.revpar : (l.grossRevpar || l.revpar) }
                      return (
                      <div key={l.id || i} className="grid gap-2 px-4 py-3 items-center border-t" style={{ borderColor: t.cardBorder, gridTemplateColumns: '1.7fr 1fr 0.8fr 1fr 1fr', background: t.card }}>
                        <div className="text-[13px] font-semibold truncate" style={{ color: t.ink }}>{l.name}{l.bedrooms != null ? <span className="ml-1.5 text-[11px] font-normal" style={{ color: t.muted }}>{l.bedrooms}BR</span> : null}</div>
                        <div className="text-right text-[13px] font-black tabular-nums" style={{ color: t.ink }}>{lv.rev}</div>
                        <div className="text-right text-[13px] tabular-nums" style={{ color: t.sub }}>{l.occPct}%</div>
                        <div className="text-right text-[13px] tabular-nums" style={{ color: t.sub }}>{lv.adr}</div>
                        <div className="text-right text-[13px] tabular-nums" style={{ color: t.sub }}>{lv.revpar}</div>
                      </div>
                      )
                    })}
                    {rows.length === 0 && <div className="px-4 py-6 text-center text-[13px]" style={{ color: t.muted }}>No listings match this filter.</div>}
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {/* ---------- PACING (only when data exists) ---------- */}
        {c.pacing && (
          <SectionShell id="pacing" title="Pacing" hidden={isHidden('pacing')} edit={edit} onToggle={() => toggleSection('pacing')} onAi={() => openAi('pacing')}>
            <div className="pt-12">
              <Eyebrow>PACING VS. MARKET</Eyebrow>
              <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
                <Ed v={c.pacing.headline || ''} set={v => patch('pacing.headline', v)} edit={edit} multiline />
              </h2>
              <p className="mt-1 text-[13px]" style={{ color: t.sub }}>
                <Ed v={c.pacing.subtitle || ''} set={v => patch('pacing.subtitle', v)} edit={edit} />
              </p>
              <div className="mt-6 space-y-4">
                {(c.pacing.rows || []).map((r: Any, i: number) => (
                  <div key={i} className="relative rounded-2xl p-5 shadow-sm border grid items-center gap-3" style={{ background: t.card, borderColor: t.cardBorder, gridTemplateColumns: 'minmax(6rem,1.15fr) 1fr 1fr minmax(5rem,1fr)' }}>
                    {edit && (
                      <button onClick={() => mutate(d => d.pacing.rows.splice(i, 1))} className="absolute top-2 right-2" style={{ color: t.accent }}><X size={13} /></button>
                    )}
                    <div className="text-sm font-bold" style={{ color: t.ink }}>{r.metric}</div>
                    <div className="text-center">
                      <p className="text-2xl font-black tabular-nums" style={{ color: t.ink }}><Ed v={r.ours || ''} set={v => patch('pacing.rows.' + i + '.ours', v)} edit={edit} /></p>
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.accent }}>{meta.scopeLabel || 'Us'}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-black tabular-nums" style={{ color: t.muted }}><Ed v={r.comps || ''} set={v => patch('pacing.rows.' + i + '.comps', v)} edit={edit} /></p>
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.muted }}>Comp set</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black" style={{ color: (String(r.delta || '').trim().indexOf('-') === 0 || String(r.delta || '').trim().indexOf('−') === 0) ? t.downGray : t.good }}><Ed v={r.delta || ''} set={v => patch('pacing.rows.' + i + '.delta', v)} edit={edit} /></p>
                      <p className="text-[10px] uppercase tracking-wider" style={{ color: t.muted }}>vs. comps</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </SectionShell>
        )}

        {/* ---------- PERFORMANCE VS PLAN ---------- */}
        {plan && (
          <SectionShell id="plan" title="Plan" hidden={isHidden('plan')} edit={edit} onToggle={() => toggleSection('plan')} onAi={() => openAi('plan')}>
            <div className="pt-12">
              <Eyebrow>PERFORMANCE VS. PLAN</Eyebrow>
              <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
                <Ed v={plan.headline || ''} set={v => patch('plan.headline', v)} edit={edit} multiline />
              </h2>
              <div className="mt-6 space-y-4">
                {(plan.months || []).map((m: Any, mi: number) => (
                  <div key={mi} className="relative rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                    {edit && (
                      <button onClick={() => mutate(d => d.plan.months.splice(mi, 1))} className="absolute top-2 right-2" style={{ color: t.accent }}><X size={13} /></button>
                    )}
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-black tracking-[0.14em]">{m.label}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider" style={(m.status === 'IN MONTH' || m.status === 'PACING') ? { background: t.statusHotBg, color: t.statusHotInk } : { background: t.statusColdBg, color: t.statusColdInk }}>
                        <Ed v={m.status || ''} set={v => patch('plan.months.' + mi + '.status', v)} edit={edit} />
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {(m.rows || []).map((r: Any, ri: number) => (
                        <div key={ri} className="rounded-xl px-3 py-2.5" style={{ background: t.chip }}>
                          <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.muted }}>{r.metric}</p>
                          <p className="text-xl font-black tabular-nums mt-0.5"><Ed v={r.actual || ''} set={v => patch('plan.months.' + mi + '.rows.' + ri + '.actual', v)} edit={edit} /></p>
                          <p className="text-[11px]" style={{ color: t.muted }}><Ed v={r.budget || ''} set={v => patch('plan.months.' + mi + '.rows.' + ri + '.budget', v)} edit={edit} /></p>
                          <p className="text-[12px] font-bold mt-0.5" style={{ color: r.good ? t.good : t.downGray }}>
                            <Ed v={r.delta || ''} set={v => patch('plan.months.' + mi + '.rows.' + ri + '.delta', v)} edit={edit} />
                          </p>
                        </div>
                      ))}
                    </div>
                    {(m.note || edit) && (
                      <p className="mt-3 text-[13px]" style={{ color: t.body }}>
                        <Ed v={m.note || ''} set={v => patch('plan.months.' + mi + '.note', v)} edit={edit} multiline placeholder="One-line commentary…" />
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </SectionShell>
        )}

        {/* ---------- OWNER STATEMENT (P3 — renders when present) ---------- */}
        {c.statement && (
          <SectionShell id="statement" title="Statement" hidden={isHidden('statement')} edit={edit} onToggle={() => toggleSection('statement')} onAi={() => openAi('statement')}>
            <div className="pt-12">
              <Eyebrow>OWNER STATEMENT</Eyebrow>
              <div className="mt-4 space-y-3">
                {(c.statement.items || []).map((it: Any, i: number) => (
                  <div key={i} className="relative rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                    {edit && (
                      <button onClick={() => mutate(d => d.statement.items.splice(i, 1))} className="absolute top-2 right-2" style={{ color: t.accent }}><X size={13} /></button>
                    )}
                    <p className="text-sm font-bold"><Ed v={it.title || ''} set={v => patch('statement.items.' + i + '.title', v)} edit={edit} /></p>
                    <p className="text-[13px] mt-1" style={{ color: t.body }}><Ed v={it.summary || ''} set={v => patch('statement.items.' + i + '.summary', v)} edit={edit} multiline /></p>
                  </div>
                ))}
              </div>
            </div>
          </SectionShell>
        )}

        {/* ---------- LOOKING AHEAD ---------- */}
        <SectionShell id="ahead" title="Looking Ahead" hidden={isHidden('ahead')} edit={edit} onToggle={() => toggleSection('ahead')} onAi={() => openAi('ahead')}>
          <div className="pt-12">
            <Eyebrow>LOOKING AHEAD</Eyebrow>
            <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
              <Ed v={ahead.headline || ''} set={v => patch('ahead.headline', v)} edit={edit} multiline />
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: t.sub }}>
              <Ed v={ahead.subtitle || ''} set={v => patch('ahead.subtitle', v)} edit={edit} />
            </p>
            <div className={'mt-6 grid gap-4 ' + (((ahead.months || []).length >= 3) ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
              {(ahead.months || []).map((m: Any, i: number) => (
                <div key={i} className="relative rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                  {edit && (
                    <button onClick={() => mutate(d => d.ahead.months.splice(i, 1))} className="absolute top-2 right-2" style={{ color: t.accent }}><X size={13} /></button>
                  )}
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-black tracking-[0.14em]"><Ed v={m.label || ''} set={v => patch('ahead.months.' + i + '.label', v)} edit={edit} /></span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider" style={{ background: t.statusHotBg, color: t.statusHotInk }}>{m.status}</span>
                  </div>
                  <p className="mt-3 text-4xl font-black tabular-nums">
                    {edit ? <Ed v={String(m.occPct ?? 0)} set={v => patch('ahead.months.' + i + '.occPct', Number(v) || 0)} edit /> : (m.occPct ?? 0)}%
                    <span className="text-sm font-semibold ml-2" style={{ color: t.muted }}>on the books</span>
                  </p>
                  <p className="mt-1.5 text-[13px] font-semibold" style={{ color: t.body }}>
                    ADR <Ed v={m.adr || ''} set={v => patch('ahead.months.' + i + '.adr', v)} edit={edit} />   ·   RevPAR <Ed v={m.revpar || ''} set={v => patch('ahead.months.' + i + '.revpar', v)} edit={edit} />
                  </p>
                  {(m.note || edit) && (
                    <p className="mt-3 text-[13px]" style={{ color: t.sub }}>
                      <Ed v={m.note || ''} set={v => patch('ahead.months.' + i + '.note', v)} edit={edit} multiline placeholder="Commentary…" />
                    </p>
                  )}
                </div>
              ))}
            </div>
            {Array.isArray(ahead.strip) && ahead.strip.length > 0 && (
              <div className="mt-6 rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-4" style={{ color: t.muted }}>MONTHS AHEAD  ·  OCCUPANCY %</p>
                <div className="flex items-end gap-3 h-36">
                  {ahead.strip.map((s: Any, i: number) => (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                      <span className="text-[12px] font-black tabular-nums mb-1">{s.occPct}%</span>
                      <div className="w-full rounded-t-md" style={{ height: Math.max(4, (Number(s.occPct) || 0)) + '%', background: i === 1 ? t.barB : t.barA, opacity: i === 0 ? 0.35 : 1 }} />
                      <span className="text-[11px] font-semibold mt-1.5" style={{ color: t.sub }}>{s.month}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SectionShell>

        {/* ---------- GUEST VOICES ---------- */}
        <SectionShell id="voices" title="Guest Voices" hidden={isHidden('voices')} edit={edit} onToggle={() => toggleSection('voices')} onAi={() => openAi('voices')}>
          <div className="pt-12">
            <Eyebrow>GUEST VOICES</Eyebrow>
            <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
              <Ed v={voices.headline || ''} set={v => patch('voices.headline', v)} edit={edit} multiline />
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: t.sub }}>
              <Ed v={voices.subtitle || ''} set={v => patch('voices.subtitle', v)} edit={edit} />
            </p>
            {voices.kpi && (
              <div className="mt-5 rounded-2xl p-4 shadow-sm border grid grid-cols-3 gap-3 text-center" style={{ background: t.card, borderColor: t.cardBorder }}>
                <div>
                  <p className="text-3xl font-black tabular-nums inline-flex items-center gap-1.5" style={{ color: t.ink }}><Star size={20} style={{ color: t.gold }} />{voices.kpi.avg != null ? voices.kpi.avg : '—'}</p>
                  <p className="text-[10px] uppercase tracking-[0.18em] font-semibold mt-0.5" style={{ color: t.muted }}>Avg rating</p>
                </div>
                <div>
                  <p className="text-3xl font-black tabular-nums" style={{ color: t.ink }}>{voices.kpi.count}</p>
                  <p className="text-[10px] uppercase tracking-[0.18em] font-semibold mt-0.5" style={{ color: t.muted }}>Reviews</p>
                </div>
                <div>
                  <p className="text-3xl font-black tabular-nums" style={{ color: t.ink }}>{voices.kpi.fiveStar != null ? voices.kpi.fiveStar : '—'}</p>
                  <p className="text-[10px] uppercase tracking-[0.18em] font-semibold mt-0.5" style={{ color: t.muted }}>5-star</p>
                </div>
              </div>
            )}
            {voices.kpi && (
              <p className="mt-1.5 text-center text-[11px]" style={{ color: t.muted }}>{voices.kpi.from} &rarr; {voices.kpi.to}</p>
            )}
            {edit && (
              <div className="mt-4 flex items-center gap-2 flex-wrap rounded-xl p-3" style={{ background: t.chip, border: '1px dashed ' + t.cardBorder }}>
                <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: t.muted }}>Reviews window</span>
                <input type="date" value={rvFrom} onChange={e => setRvFrom(e.target.value)} className="rounded-md px-2 py-1 text-[12px]" style={{ background: t.card, border: '1px solid ' + t.cardBorder, color: t.ink }} />
                <span style={{ color: t.muted }}>&rarr;</span>
                <input type="date" value={rvTo} onChange={e => setRvTo(e.target.value)} className="rounded-md px-2 py-1 text-[12px]" style={{ background: t.card, border: '1px solid ' + t.cardBorder, color: t.ink }} />
                <button onClick={pullReviewsNow} disabled={rvBusy || !rvFrom || !rvTo} className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold disabled:opacity-50" style={{ background: t.ink, color: t.bg }}>
                  {rvBusy ? <Loader2 size={12} className="animate-spin" /> : <Star size={12} />} Pull reviews
                </button>
                <button onClick={() => mutate(d => { d.voices = d.voices || {}; d.voices.showAll = !d.voices.showAll })} className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold" style={voices.showAll ? { background: t.ink, color: t.bg } : { background: t.card, border: '1px solid ' + t.cardBorder, color: t.ink }}>
                  {voices.showAll ? 'Showing all' : 'Show all reviews'}
                </button>
              </div>
            )}
            <div className="mt-6 grid sm:grid-cols-2 gap-4">
              {(voices.quotes || []).map((q: Any, i: number) => (
                <div key={i} className="relative rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                  {edit && (
                    <button onClick={() => mutate(d => d.voices.quotes.splice(i, 1))} className="absolute top-2 right-2 rounded-full p-1 hover:bg-red-50" style={{ color: t.accent }}><X size={13} /></button>
                  )}
                  <span className="text-4xl leading-none font-serif" style={{ color: t.gold }}>“</span>
                  <p className="mt-1 text-[14px] leading-relaxed" style={{ color: t.body }}>
                    <Ed v={q.text || ''} set={v => patch('voices.quotes.' + i + '.text', v)} edit={edit} multiline />
                  </p>
                  <p className="mt-3 text-[11px] font-bold tracking-[0.14em]" style={{ color: t.ink }}>
                    <Ed v={q.guest || ''} set={v => patch('voices.quotes.' + i + '.guest', v)} edit={edit} />
                    <span className="font-semibold ml-2" style={{ color: t.muted }}>
                      <Ed v={q.unit || ''} set={v => patch('voices.quotes.' + i + '.unit', v)} edit={edit} /> · <Ed v={q.br || ''} set={v => patch('voices.quotes.' + i + '.br', v)} edit={edit} />
                    </span>
                  </p>
                </div>
              ))}
            </div>
            {edit && (
              <button onClick={() => mutate(d => { d.voices.quotes = d.voices.quotes || []; d.voices.quotes.push({ text: '', guest: 'GUEST', unit: '', br: '' }) })} className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: t.accent }}><Plus size={12} /> Add quote</button>
            )}

            {voices.showAll && Array.isArray(voices.all) && voices.all.length > 0 && (
              <div className="mt-6 rounded-2xl shadow-sm border overflow-hidden pb-3" style={{ background: t.card, borderColor: t.cardBorder }}>
                <p className="px-5 pt-4 text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.gold }}>ALL REVIEWS{voices.kpi ? ' · ' + voices.kpi.from + ' → ' + voices.kpi.to : ''}</p>
                <div className="mt-2">
                  {voices.all.map((r: Any, i: number) => (
                    <div key={i} className="px-5 py-3" style={{ borderTop: i ? '1px solid ' + t.rule : 'none' }}>
                      <div className="flex items-center gap-2 flex-wrap text-[11px] font-semibold" style={{ color: t.sub }}>
                        <span style={{ color: t.ink }}>{r.guest}</span>
                        {r.rating != null && <span className="inline-flex items-center gap-0.5" style={{ color: t.gold }}><Star size={10} />{r.rating}</span>}
                        <span>{r.unit}{r.br ? ' · ' + r.br : ''}</span>
                        <span className="ml-auto" style={{ color: t.muted }}>{r.date}</span>
                      </div>
                      {r.text && <p className="mt-1 text-[12.5px] leading-snug" style={{ color: t.body }}>{r.text}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-8 rounded-2xl p-6" style={{ background: t.band, color: 'white' }}>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.gold }}>WHAT WE&rsquo;RE HEARING  ·  AND WHAT WE&rsquo;RE DOING</p>
              <div className="mt-4 space-y-4">
                {(voices.themes || []).map((t: Any, i: number) => (
                  <div key={i} className="relative border-l-2 pl-4" style={{ borderColor: t.accent }}>
                    {edit && (
                      <button onClick={() => mutate(d => d.voices.themes.splice(i, 1))} className="absolute top-0 right-0 rounded-full p-1 text-white/50 hover:text-white"><X size={13} /></button>
                    )}
                    <p className="text-sm font-bold"><Ed v={t.title || ''} set={v => patch('voices.themes.' + i + '.title', v)} edit={edit} /></p>
                    <p className="text-[13px] text-white/75 mt-0.5"><Ed v={t.body || ''} set={v => patch('voices.themes.' + i + '.body', v)} edit={edit} multiline /></p>
                    <p className="text-[13px] mt-0.5" style={{ color: t.gold }}><Ed v={t.action || ''} set={v => patch('voices.themes.' + i + '.action', v)} edit={edit} multiline /></p>
                  </div>
                ))}
              </div>
              {edit && (
                <button onClick={() => mutate(d => { d.voices.themes = d.voices.themes || []; d.voices.themes.push({ title: 'New theme', body: '', action: '' }) })} className="mt-4 inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: t.gold }}><Plus size={12} /> Add theme</button>
              )}
            </div>
          </div>
        </SectionShell>

        {/* ---------- PROJECTS ---------- */}
        <SectionShell id="projects" title="Projects" hidden={isHidden('projects')} edit={edit} onToggle={() => toggleSection('projects')} onAi={() => openAi('projects')}>
          <div className="pt-12">
            <Eyebrow>PROJECTS</Eyebrow>
            <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
              <Ed v={projects.headline || ''} set={v => patch('projects.headline', v)} edit={edit} multiline />
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: t.sub }}>
              <Ed v={projects.subtitle || ''} set={v => patch('projects.subtitle', v)} edit={edit} />
            </p>
            {edit && (
              <button onClick={refreshBreezeway} disabled={!!busy} className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder, color: t.ink }}>
                {busy === 'refresh-work' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh from Breezeway
              </button>
            )}
            <div className="mt-6 grid md:grid-cols-3 gap-4 items-stretch">
              {(projects.weeks || []).map((w: Any, wi: number) => (
                <div key={wi} className="relative rounded-2xl p-5 shadow-sm border h-full flex flex-col" style={{ background: t.card, borderColor: t.cardBorder }}>
                  {edit && (
                    <button onClick={() => mutate(d => d.projects.weeks.splice(wi, 1))} className="absolute top-2 right-2" style={{ color: t.accent }}><X size={13} /></button>
                  )}
                  <p className="text-[11px] font-black tracking-[0.16em] pb-2 border-b" style={{ color: t.accent, borderColor: t.rule }}>
                    <Ed v={w.label || ''} set={v => patch('projects.weeks.' + wi + '.label', v)} edit={edit} />
                  </p>
                  {(w.groups || []).map((g: Any, gi: number) => (
                    <div key={gi} className="mt-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: t.muted }}>
                        <Ed v={g.category || ''} set={v => patch('projects.weeks.' + wi + '.groups.' + gi + '.category', v)} edit={edit} />
                      </p>
                      <ul className="mt-1.5 space-y-1.5">
                        {(g.items || []).map((it: string, ii: number) => (
                          <li key={ii} className="relative text-[12.5px] leading-snug pl-3" style={{ color: t.body }}>
                            <span className="absolute left-0 top-[7px] w-1 h-1 rounded-full" style={{ background: t.gold }} />
                            <Ed v={it} set={v => patch('projects.weeks.' + wi + '.groups.' + gi + '.items.' + ii, v)} edit={edit} multiline />
                            {edit && (
                              <button onClick={() => mutate(d => d.projects.weeks[wi].groups[gi].items.splice(ii, 1))} className="absolute -left-4 top-0.5" style={{ color: t.accent }}><X size={11} /></button>
                            )}
                          </li>
                        ))}
                      </ul>
                      {edit && (
                        <button onClick={() => mutate(d => d.projects.weeks[wi].groups[gi].items.push(''))} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: t.accent }}><Plus size={11} /> Add item</button>
                      )}
                    </div>
                  ))}
                  {edit && (
                    <button onClick={() => mutate(d => d.projects.weeks[wi].groups.push({ category: 'NEW GROUP', items: [''] }))} className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: t.muted }}><Plus size={11} /> Add group</button>
                  )}
                </div>
              ))}
            </div>

            {((projects.manual && projects.manual.length) || edit) ? (
              <div className="mt-4 rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                <p className="text-[11px] font-black tracking-[0.16em]" style={{ color: t.accent }}>COMPLETED WORK</p>
                {(() => {
                  const raw: Any[] = Array.isArray(projects.manual) ? projects.manual : []
                  const legacy = raw.length > 0 && typeof raw[0] === 'string'
                  if (legacy) return (
                    <ul className="mt-2 space-y-1.5">
                      {raw.map((it: Any, i: number) => (
                        <li key={i} className="relative text-[12.5px] leading-snug pl-3" style={{ color: t.body }}>
                          <span className="absolute left-0 top-[7px] w-1 h-1 rounded-full" style={{ background: t.gold }} />
                          <Ed v={String(it)} set={v => patch('projects.manual.' + i, v)} edit={edit} multiline />
                          {edit && (<button onClick={() => mutate(d => d.projects.manual.splice(i, 1))} className="absolute -left-4 top-0.5" style={{ color: t.accent }}><X size={11} /></button>)}
                        </li>
                      ))}
                    </ul>
                  )
                  return (
                    <div className="mt-3 space-y-3">
                      {raw.map((g: Any, gi: number) => (
                        <div key={gi} className="relative">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black tracking-[0.14em] uppercase" style={{ color: t.muted }}>
                              <Ed v={String(g.category || 'COMPLETED WORK')} set={v => patch('projects.manual.' + gi + '.category', v)} edit={edit} />
                            </span>
                            {edit && (<button onClick={() => mutate(d => d.projects.manual.splice(gi, 1))} style={{ color: t.accent }}><X size={12} /></button>)}
                          </div>
                          <ul className="mt-1.5 space-y-1.5">
                            {(Array.isArray(g.items) ? g.items : []).map((it: Any, ii: number) => (
                              <li key={ii} className="relative text-[12.5px] leading-snug pl-3" style={{ color: t.body }}>
                                <span className="absolute left-0 top-[7px] w-1 h-1 rounded-full" style={{ background: t.gold }} />
                                <Ed v={String(it)} set={v => patch('projects.manual.' + gi + '.items.' + ii, v)} edit={edit} multiline />
                                {edit && (<button onClick={() => mutate(d => d.projects.manual[gi].items.splice(ii, 1))} className="absolute -left-4 top-0.5" style={{ color: t.accent }}><X size={11} /></button>)}
                              </li>
                            ))}
                          </ul>
                          {edit && (
                            <button onClick={() => mutate(d => { d.projects.manual[gi].items = Array.isArray(d.projects.manual[gi].items) ? d.projects.manual[gi].items : []; d.projects.manual[gi].items.push('') })} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: t.accent }}><Plus size={11} /> Add item</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })()}
                {edit && (
                  <div className="mt-3 rounded-xl p-3" style={{ background: t.chip, border: '1px solid ' + t.cardBorder }}>
                    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: t.accent }}><Sparkles size={12} /> Auto-fill from notes</div>
                    <textarea value={manualAiNotes} onChange={e => setManualAiNotes(e.target.value)} rows={2} placeholder="Type or paste what got done — e.g. 'Fixed AC in 409, replaced Yale lock 404, delivered wine opener to 501' — and AI sorts it into type sections." className="mt-2 w-full rounded-lg px-3 py-2 text-[13px] outline-none resize-y" style={{ background: t.card, border: '1px solid ' + t.cardBorder, color: t.ink }} />
                    <button onClick={autofillFromNotes} disabled={!!busy || !manualAiNotes.trim()} className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: t.accent, color: t.card }}>{busy === 'completed-ai' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Auto-fill with AI</button>
                  </div>
                )}
                {edit && (
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <input value={manualCat} onChange={e => setManualCat(e.target.value)} placeholder="Type (e.g. Maintenance)" className="w-[150px] rounded-lg px-3 py-1.5 text-[13px] outline-none" style={{ background: t.chip, border: '1px solid ' + t.cardBorder, color: t.ink }} />
                    <input value={manualLine} onChange={e => setManualLine(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addManualLine() } }} placeholder="Add a completed item, press Enter" className="flex-1 min-w-[180px] rounded-lg px-3 py-1.5 text-[13px] outline-none" style={{ background: t.chip, border: '1px solid ' + t.cardBorder, color: t.ink }} />
                    <button onClick={addManualLine} disabled={!manualLine.trim()} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: t.accent, color: t.card }}><Plus size={12} /> Add</button>
                    <input ref={manualFileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={onManualFilePick} />
                    <button onClick={() => manualFileRef.current && manualFileRef.current.click()} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>{busy === 'completed' ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />} Upload file</button>
                  </div>
                )}
                {edit && <p className="mt-2 text-[11px] italic" style={{ color: t.muted }}>Grouped by type. Add a type + item, or upload a PDF/photo and the AI sorts the completed items into type sections. Added on top of the Breezeway-pulled work above.</p>}
              </div>
            ) : null}

            {(Array.isArray(projects.tracking) && projects.tracking.length > 0) || edit ? (
              <div className="mt-6 rounded-2xl p-5 border-2 border-dashed" style={{ borderColor: t.gold, background: t.trackBg }}>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.gold }}>IN PROGRESS  ·  ITEMS WE&rsquo;RE TRACKING</p>
                <div className="mt-3 grid sm:grid-cols-2 gap-4">
                  {(projects.tracking || []).map((t: Any, i: number) => (
                    <div key={i} className="relative">
                      {edit && (
                        <button onClick={() => mutate(d => d.projects.tracking.splice(i, 1))} className="absolute top-0 right-0" style={{ color: t.accent }}><X size={13} /></button>
                      )}
                      <p className="text-sm font-bold"><Ed v={t.title || ''} set={v => patch('projects.tracking.' + i + '.title', v)} edit={edit} /></p>
                      <p className="text-[12.5px] mt-0.5" style={{ color: t.body }}><Ed v={t.body || ''} set={v => patch('projects.tracking.' + i + '.body', v)} edit={edit} multiline /></p>
                    </div>
                  ))}
                </div>
                {edit && (
                  <button onClick={() => mutate(d => { d.projects.tracking = d.projects.tracking || []; d.projects.tracking.push({ title: 'New item', body: '' }) })} className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: t.gold }}><Plus size={12} /> Add tracked item</button>
                )}
              </div>
            ) : null}
          </div>
        </SectionShell>

        {/* ---------- CUSTOM SECTIONS (owner-added: label + write anything) ---------- */}
        {(Array.isArray(c.custom) ? c.custom : []).map((cs: Any, ci: number) => {
          if (!edit && !String(cs.title || '').trim() && !String(cs.body || '').trim()) return null
          return (
            <section key={cs.id || ci} className="relative">
              {edit && (
                <button onClick={() => mutate(d => { d.custom.splice(ci, 1) })} className="absolute -top-3 right-4 z-10 inline-flex items-center gap-1 rounded-full shadow px-2.5 py-1 text-[11px] font-semibold" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder, color: t.accent }}>
                  <X size={11} /> Remove section
                </button>
              )}
              <div className="pt-12">
                {(edit || String(cs.eyebrow || '').trim()) && (
                  <p className="text-[11px] font-bold uppercase tracking-[0.28em]" style={{ color: t.accent }}>
                    <Ed v={cs.eyebrow || ''} set={v => patch('custom.' + ci + '.eyebrow', v)} edit={edit} placeholder="OVERLINE (OPTIONAL)" />
                  </p>
                )}
                <h2 className="mt-2 text-3xl sm:text-4xl font-black tracking-tight" style={{ color: t.ink }}>
                  <Ed v={cs.title || ''} set={v => patch('custom.' + ci + '.title', v)} edit={edit} placeholder="Section title" />
                </h2>
                <div className="mt-4 text-[15px] leading-relaxed whitespace-pre-line" style={{ color: t.body }}>
                  <Ed v={cs.body || ''} set={v => patch('custom.' + ci + '.body', v)} edit={edit} multiline placeholder="Write anything you want in this section&hellip;" />
                </div>
              </div>
            </section>
          )
        })}

        {/* Add a custom section (edit mode only) */}
        {edit && (
          <div className="mt-10 flex justify-center">
            <button
              onClick={() => mutate(d => { d.custom = Array.isArray(d.custom) ? d.custom : []; d.custom.push({ id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), eyebrow: '', title: 'New section', body: '' }) })}
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold shadow-sm"
              style={{ background: t.card, border: '1px dashed ' + t.accent, color: t.accent }}
            >
              <Plus size={13} /> Add section
            </button>
          </div>
        )}

        {/* footer */}
        <footer className="mt-16 pt-6 border-t text-center" style={{ borderColor: t.rule }}>
          <p className="text-[10px] uppercase tracking-[0.22em] font-semibold" style={{ color: t.footA }}>{footer}</p>
          <p className="text-[10px] mt-1" style={{ color: t.footB }}>Prepared by Stay Hospitality</p>
        </footer>
      </div>
    </div>
  )
}
