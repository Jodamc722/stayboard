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
import { paceTier, paceStatus, paceThresholds, PACE_TONE } from '@/lib/pacing'

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
// feeNum is required too: without it Net can't deduct the channel fee, so a section
// missing it gets refetched on the next edit-mode open rather than shown as-is.
function hasBasisRaw(o: Any): boolean {
  return o && o.accomNum != null && o.accomGrossNum != null && o.cleaningNum != null && o.feeNum != null
}
// Formatted Revenue / ADR / RevPAR strings for a basis, from a raw-carrying object (snap / listing / metrics).
function basisStrings(o: Any, b: Basis): { rev: string; adr: string; revpar: string } {
  const t = basisTriple({ accomNum: o.accomNum || 0, accomGrossNum: o.accomGrossNum || 0, cleaningNum: o.cleaningNum || 0, feeNum: o.feeNum == null ? undefined : (o.feeNum || 0), occNights: o.occNights || 0, availNights: o.availNights || 0 }, b)
  return { rev: fmtMoney(t.revenue), adr: '$' + t.adr, revpar: '$' + t.revpar }
}
// LOOKING AHEAD CARD NUMBERS — one answer for the screen, the deck and the owner.
//
// Jon, 2026-08-25: "need to be able to edit these numbers on owner reports". Until now the
// Looking Ahead cards were only editable on reports old enough to have no raw components —
// anything the current engine generated printed a derived figure with no way in, because the
// number is recomputed from accommodation / cleaning / fees every time the basis changes.
//
// So an edit is stored as an OVERRIDE PER BASIS rather than overwriting the raw. The figure you
// typed while looking at "Net + fees" is not the answer for "Gross", so switching basis falls
// back to the computed number instead of quietly relabelling your edit. Clearing the box hands
// the card back to the engine. Legacy months (no raw) keep editing their stored string directly.
function aheadValues(m: Any, b: Basis): {
  adr: string; revpar: string; adrComputed: string; revparComputed: string; adrOv: boolean; revparOv: boolean
} {
  const raw = hasBasisRaw(m) ? basisStrings(m, b) : null
  const adrComputed = raw ? raw.adr : String((m && m.adr) || '')
  const revparComputed = raw ? raw.revpar : String((m && m.revpar) || '')
  const ovA = m && m.adrOv && typeof m.adrOv[b] === 'string' ? String(m.adrOv[b]) : null
  const ovR = m && m.revparOv && typeof m.revparOv[b] === 'string' ? String(m.revparOv[b]) : null
  return {
    adr: ovA != null ? ovA : adrComputed,
    revpar: ovR != null ? ovR : revparComputed,
    adrComputed, revparComputed,
    adrOv: ovA != null, revparOv: ovR != null,
  }
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
  // ── 2026-08-17 additions (Jon: "more options on visual customizations"). Each new theme's
  // pace-strip triple (barA / barB / good) was run through the dataviz palette validator against
  // its own background: Ocean worst-pair ΔE 19.1, Porcelain 15.3 — clean passes; Sage's plum sits
  // at ΔE 7.5 (deutan), legal because every pace bar carries a direct chip label. That validation
  // is WHY Ocean's accent is azure rather than teal (teal vs the 'good' green was ΔE 8.8 even for
  // normal vision) and why Sage's accent is plum rather than clay (clay vs green: protan 4.2).
  ocean: {
    label: 'Ocean', bg: '#F7FAFC', ink: '#0B2B3A', body: '#3A5568', sub: '#64798A', muted: '#8FA3B2',
    card: '#ffffff', cardBorder: '#E3EBF1', chip: '#F2F7FA', accent: '#1774C6', gold: '#9C7A3C', band: '#0B2B3A',
    statusHotBg: '#E8F1FB', statusHotInk: '#1774C6', statusColdBg: '#EDF2F6', statusColdInk: '#5A7186',
    good: '#1a7f4f', downGray: '#A2B1BD', rule: '#E3EBF1', toolbarBg: 'rgba(247,250,252,0.92)', toolbarBorder: '#D3DEE7',
    trackBg: '#FBFDFE', footA: '#93A5B3', footB: '#C0CDD8', barA: '#0B2B3A', barB: '#1774C6',
    edBg: 'rgba(255,255,255,0.7)', edBorder: '#1774C6',
  },
  sage: {
    label: 'Sage', bg: '#F7F6F1', ink: '#24352A', body: '#46564B', sub: '#6C7A70', muted: '#96A19A',
    card: '#ffffff', cardBorder: '#E7E5DA', chip: '#F4F3EC', accent: '#8A4F7D', gold: '#A98E4A', band: '#24352A',
    statusHotBg: '#F4EAF1', statusHotInk: '#8A4F7D', statusColdBg: '#EDF0EC', statusColdInk: '#6C7A70',
    good: '#1a7f4f', downGray: '#A7B0AA', rule: '#E7E5DA', toolbarBg: 'rgba(247,246,241,0.92)', toolbarBorder: '#D8D5C6',
    trackBg: '#FCFBF7', footA: '#9A9B8C', footB: '#C4C4B4', barA: '#24352A', barB: '#8A4F7D',
    edBg: 'rgba(255,255,255,0.7)', edBorder: '#A98E4A',
  },
  porcelain: {
    label: 'Porcelain', bg: '#F5F6F8', ink: '#1F2430', body: '#434B5C', sub: '#6A7385', muted: '#949CAC',
    card: '#ffffff', cardBorder: '#E5E8EE', chip: '#F1F3F6', accent: '#5B6CB2', gold: '#7B84A8', band: '#1F2430',
    statusHotBg: '#EDF0FA', statusHotInk: '#5B6CB2', statusColdBg: '#EEF0F3', statusColdInk: '#6A7385',
    good: '#1a7f4f', downGray: '#A6ADBB', rule: '#E5E8EE', toolbarBg: 'rgba(245,246,248,0.92)', toolbarBorder: '#D5D9E1',
    trackBg: '#FAFBFC', footA: '#9AA1B0', footB: '#C4C9D4', barA: '#1F2430', barB: '#5B6CB2',
    edBg: 'rgba(255,255,255,0.7)', edBorder: '#5B6CB2',
  },
}

// ── FONT PAIRINGS (2026-08-17) ──────────────────────────────────────────────────────────────────
// The single biggest "make it more beautiful" lever a document has. Headings only: body copy and
// every number stay in the system sans (numbers in a display serif drift out of column alignment).
// Loaded from Google Fonts only when a non-default pairing is picked, so the default report ships
// exactly the bytes it shipped yesterday.
const FONT_PAIRS: Record<string, { label: string; display: string; href: string }> = {
  modern: { label: 'Modern', display: '', href: '' },
  editorial: {
    label: 'Editorial',
    display: "'Fraunces', Georgia, 'Times New Roman', serif",
    href: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700;9..144,900&display=swap',
  },
  classic: {
    label: 'Classic',
    display: "'Playfair Display', Georgia, 'Times New Roman', serif",
    href: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800;900&display=swap',
  },
}

// ---------- on-the-books pacing chips (P14) ----------
// Pacing reads against LEAD TIME, not one fixed number: ~30% on the books entering a
// month is pacing well, and ~20% for a month still 60 days out is as good or better,
// because more of the booking window is still open. No threshold is ever printed —
// the tiers only decide a chip's wording and a bar's colour.
// Tier and tone are derived from occPct at render time rather than read from the stored
// status string, so reports generated before this existed pick up the new labels too.
function hexA(hex: string, a: number): string {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return hex
  const n = parseInt(h, 16)
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'
}

/** Chip label + colours for an `ahead` month. The in-progress month is never tiered. */
function paceChip(t: Any, occPct: unknown, inMonth: boolean, monthsOut = 1): { label: string; style: Any } {
  const tone = inMonth ? 'hot' : PACE_TONE[paceTier(occPct, monthsOut)]
  const label = paceStatus(occPct, inMonth, monthsOut)
  if (tone === 'hi') return { label, style: { background: hexA(t.good, 0.15), color: t.good } }
  if (tone === 'hot') return { label, style: { background: t.statusHotBg, color: t.statusHotInk } }
  return { label, style: { background: t.statusColdBg, color: t.statusColdInk } }
}

/** Bar colour for the months-ahead strip, scaled to how far out the month sits. */
function paceBar(t: Any, occPct: unknown, isCurrent: boolean, monthsOut = 1): string {
  if (isCurrent) return t.barB
  const n = Number(occPct) || 0
  const th = paceThresholds(monthsOut)
  if (n >= th.exceptional) return t.good
  if (n >= th.strong) return t.barB
  return t.barA
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

// Statement figures arrive as exact dollars from the recognised owner ledger. Round for
// display only — a negative reads as "−$1,234", never as "$-1,234".
function usdP(n: Any): string {
  const v = Number(n)
  if (!isFinite(v)) return '$0'
  return (v < 0 ? '−$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US')
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
    s2.addText(String((typeof cards[i].override === 'string' && cards[i].override.trim() !== '' ? cards[i].override : cards[i].value) || ''), { x: x + 0.18, y: CT + 0.46, w: cw - 0.32, h: 0.66, fontSize: 30, bold: true, color: INK })
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

  // owner statement — KPI band + month table off the recognised ledger. Legacy reports that
  // still carry the old parsed-PDF `items` fall back to the card layout they were built for.
  const stKpis = (c.statement && Array.isArray(c.statement.kpis)) ? c.statement.kpis : []
  const stItems = (c.statement && Array.isArray(c.statement.items)) ? c.statement.items : []
  if (c.statement && (stKpis.length || stItems.length)) {
    const s = pptx.addSlide()
    head(s, 'OWNER STATEMENT', c.statement.headline || 'Owner statement summary.', c.statement.subtitle || '')
    if (stKpis.length) {
      const ks = stKpis.slice(0, 4)
      const kn = Math.max(1, ks.length), kgap = 0.25, kw = (12.13 - (kn - 1) * kgap) / kn
      for (let i = 0; i < ks.length; i++) {
        const x = 0.6 + i * (kw + kgap)
        s.addShape('roundRect', { x, y: CT, w: kw, h: 1.5, fill: { color: CARD }, line: { color: CB }, rectRadius: 0.06 })
        s.addText(String(ks[i].label || '').toUpperCase(), { x: x + 0.22, y: CT + 0.16, w: kw - 0.44, h: 0.24, fontSize: 8.5, bold: true, color: MUT, charSpacing: 1 })
        s.addText(String(ks[i].value || ''), { x: x + 0.22, y: CT + 0.44, w: kw - 0.44, h: 0.52, fontSize: 22, bold: true, color: INK })
        s.addText(String(ks[i].sub || ''), { x: x + 0.22, y: CT + 1.0, w: kw - 0.44, h: 0.3, fontSize: 9.5, color: SUB })
      }
      const ms = (Array.isArray(c.statement.months) ? c.statement.months : []).slice(0, 8)
      if (ms.length) {
        const tTop = CT + 1.85
        const cols = ['MONTH', 'RENTAL', 'COMMISSION', 'NET TO OWNER', 'PAID OUT']
        const cw = [3.0, 2.3, 2.3, 2.3, 2.23]
        let cx = 0.6
        for (let i = 0; i < cols.length; i++) {
          s.addText(cols[i], { x: cx + 0.1, y: tTop, w: cw[i] - 0.2, h: 0.26, fontSize: 8.5, bold: true, color: MUT, charSpacing: 1, align: i ? 'right' : 'left' })
          cx += cw[i]
        }
        for (let r = 0; r < ms.length; r++) {
          const y = tTop + 0.34 + r * 0.34
          const m = ms[r]
          const cells = [String(m.label || m.month || ''), usdP(m.rental), usdP(m.commission), usdP(m.net), usdP(m.paid)]
          let x2 = 0.6
          for (let i = 0; i < cells.length; i++) {
            s.addText(cells[i], { x: x2 + 0.1, y, w: cw[i] - 0.2, h: 0.3, fontSize: 10.5, bold: i === 3, color: i === 3 ? INK : BODY, align: i ? 'right' : 'left' })
            x2 += cw[i]
          }
        }
      }
      if (c.statement.note) s.addText(String(c.statement.note).slice(0, 240), { x: 0.6, y: CBOT - 0.4, w: 12.13, h: 0.36, fontSize: 9, color: SUB })
    } else {
      const items = stItems.slice(0, 4)
      const n = Math.max(1, items.length), igap = 0.22, ih = (CBOT - CT - (n - 1) * igap) / n
      for (let i = 0; i < items.length; i++) {
        const y = CT + i * (ih + igap)
        s.addShape('roundRect', { x: 0.6, y, w: 12.13, h: ih, fill: { color: CARD }, line: { color: CB }, rectRadius: 0.06 })
        s.addText(String(items[i].title || ''), { x: 0.95, y: y + 0.16, w: 11.4, h: 0.3, fontSize: 13, bold: true, color: INK })
        s.addText(String(items[i].summary || '').slice(0, 320), { x: 0.95, y: y + 0.54, w: 11.4, h: ih - 0.68, fontSize: 11, color: BODY, valign: 'top' })
      }
    }
  }

  // owner statement — unit performance. Its own slide because a per-unit table never fits
  // under the KPI band, and the portfolio line has to travel with it or the column stops
  // footing to net.
  const stUnits: Any[] = (c.statement && Array.isArray(c.statement.units)) ? c.statement.units : []
  if (stUnits.length) {
    const real = stUnits.filter((u: Any) => !u.portfolio)
    const port = stUnits.filter((u: Any) => u.portfolio)
    const CAPP = 14
    const sumU = (a: Any[], k: string) => a.reduce((s: number, x: Any) => s + (Number(x[k]) || 0), 0)
    const tail = real.slice(CAPP)
    const body: Any[] = [...real.slice(0, CAPP)]
    if (tail.length) body.push({ name: tail.length + ' other units', rental: sumU(tail, 'rental'), commission: sumU(tail, 'commission'), other: sumU(tail, 'other'), net: sumU(tail, 'net') })
    body.push(...port)
    const totU = { rental: sumU(stUnits, 'rental'), commission: sumU(stUnits, 'commission'), other: sumU(stUnits, 'other'), net: sumU(stUnits, 'net') }
    const su = pptx.addSlide()
    head(su, 'UNIT PERFORMANCE', real.length + ' unit' + (real.length === 1 ? '' : 's') + ' on the statement.', 'Net per unit after commission and charges · ' + String((c.statement && c.statement.scope) || ''))
    const ucols = ['UNIT', 'RENTAL', 'COMMISSION', 'CHARGES / CREDITS', 'NET TO OWNER']
    const ucw = [4.4, 1.95, 1.95, 2.05, 1.78]
    let ucx = 0.6
    for (let i = 0; i < ucols.length; i++) {
      su.addText(ucols[i], { x: ucx + 0.1, y: CT, w: ucw[i] - 0.2, h: 0.26, fontSize: 8.5, bold: true, color: MUT, charSpacing: 1, align: i ? 'right' : 'left' })
      ucx += ucw[i]
    }
    for (let r = 0; r < body.length; r++) {
      const y = CT + 0.34 + r * 0.30
      const u = body[r]
      const neg = (Number(u.net) || 0) < 0
      const cells = [String(u.name || u.listingId || '').slice(0, 44), usdP(u.rental), usdP(u.commission), usdP(u.other), usdP(u.net)]
      let x2 = 0.6
      for (let i = 0; i < cells.length; i++) {
        su.addText(cells[i], { x: x2 + 0.1, y, w: ucw[i] - 0.2, h: 0.28, fontSize: 10, bold: i === 4, color: i === 4 && neg ? ACC : i === 4 ? INK : BODY, align: i ? 'right' : 'left' })
        x2 += ucw[i]
      }
    }
    const uy = CT + 0.34 + body.length * 0.30 + 0.06
    su.addShape('rect', { x: 0.6, y: uy, w: 12.13, h: 0.012, fill: { color: INK }, line: { color: INK } })
    const tcells = ['TOTAL', usdP(totU.rental), usdP(totU.commission), usdP(totU.other), usdP(totU.net)]
    let tx = 0.6
    for (let i = 0; i < tcells.length; i++) {
      su.addText(tcells[i], { x: tx + 0.1, y: uy + 0.1, w: ucw[i] - 0.2, h: 0.28, fontSize: 10.5, bold: true, color: INK, align: i ? 'right' : 'left' })
      tx += ucw[i]
    }
  }

  // owner statement — fee and expense breakdown, on Guesty's own line names.
  const stFees: Any[] = (c.statement && Array.isArray(c.statement.fees)) ? c.statement.fees.filter((f: Any) => f.kind !== 'rental') : []
  if (stFees.length) {
    const sf = pptx.addSlide()
    const totF = stFees.reduce((s: number, f: Any) => s + (Number(f.amount) || 0), 0)
    head(sf, 'FEES, EXPENSES AND CREDITS', usdP(totF) + ' off rental income.', 'Negative is money out; positive is a credit back to the owner')
    const fbody = stFees.slice(0, 16)
    const fcols = ['LINE', 'CODE', 'ENTRIES', 'AMOUNT']
    const fcw = [6.9, 1.6, 1.7, 1.93]
    let fcx = 0.6
    for (let i = 0; i < fcols.length; i++) {
      sf.addText(fcols[i], { x: fcx + 0.1, y: CT, w: fcw[i] - 0.2, h: 0.26, fontSize: 8.5, bold: true, color: MUT, charSpacing: 1, align: i ? 'right' : 'left' })
      fcx += fcw[i]
    }
    for (let r = 0; r < fbody.length; r++) {
      const y = CT + 0.34 + r * 0.30
      const f = fbody[r]
      const amt = Number(f.amount) || 0
      const cells = [String(f.label || '').slice(0, 60), String(f.code || ''), String(Number(f.rows) || 0), usdP(amt)]
      let x2 = 0.6
      for (let i = 0; i < cells.length; i++) {
        sf.addText(cells[i], { x: x2 + 0.1, y, w: fcw[i] - 0.2, h: 0.28, fontSize: 10, bold: i === 3, color: i === 3 && amt < 0 ? ACC : i === 3 ? INK : BODY, align: i ? 'right' : 'left' })
        x2 += fcw[i]
      }
    }
    if (stFees.length > fbody.length) {
      sf.addText(String(stFees.length - fbody.length) + ' smaller lines not shown', { x: 0.7, y: CT + 0.34 + fbody.length * 0.30 + 0.08, w: 6.8, h: 0.28, fontSize: 9, color: MUT })
    }
  }

  // looking ahead
  const s6 = pptx.addSlide()
  head(s6, 'LOOKING AHEAD', ahead.headline, ahead.subtitle)
  // The deck used to print m.adr / m.revpar — the stored legacy strings — while the page printed
  // the figure derived for the section's basis (and now any hand-set override). Two numbers for
  // one card. Same helper both sides, so the export can no longer drift from the screen.
  const aheadBasis: Basis = ((c.basis && (c.basis.ahead || c.basis.default)) || 'netota') as Basis
  const aMonths = (ahead.months || []).slice(0, 3)
  const an = Math.max(1, aMonths.length), acw = (12.13 - (an - 1) * 0.25) / an
  for (let i = 0; i < aMonths.length; i++) {
    const m = aMonths[i], x = 0.6 + i * (acw + 0.25)
    s6.addShape('roundRect', { x, y: CT, w: acw, h: 2.7, fill: { color: CARD }, line: { color: CB }, rectRadius: 0.06 })
    s6.addText(String(m.label || ''), { x: x + 0.24, y: CT + 0.2, w: acw - 1.5, h: 0.3, fontSize: 13, bold: true, color: INK, charSpacing: 1 })
    s6.addText(String(m.status || ''), { x: x + acw - 1.6, y: CT + 0.23, w: 1.4, h: 0.25, align: 'right', fontSize: 9, bold: true, color: ACC, charSpacing: 1 })
    s6.addText(String(m.occPct != null ? m.occPct : 0) + '%', { x: x + 0.24, y: CT + 0.62, w: acw - 0.4, h: 0.78, fontSize: 32, bold: true, color: INK })
    s6.addText('on the books', { x: x + 0.26, y: CT + 1.34, w: acw - 0.4, h: 0.28, fontSize: 10, color: MUT })
    const av6 = aheadValues(m, aheadBasis)
    s6.addText('ADR ' + av6.adr + '  ·  RevPAR ' + av6.revpar, { x: x + 0.24, y: CT + 1.66, w: acw - 0.4, h: 0.3, fontSize: 11, bold: true, color: BODY })
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
  // ── style overrides (content.style): custom accent + font pairing (2026-08-17) ──
  // The accent override is merged into the theme object itself, so every downstream consumer —
  // pace chips, bars, buttons, the PPTX export — inherits it with no further plumbing.
  const styleCfg: Any = (c && c.style) || {}
  const accentOv: string = /^#[0-9a-fA-F]{6}$/.test(String(styleCfg.accent || '')) ? String(styleCfg.accent) : ''
  const fontKey: string = FONT_PAIRS[styleCfg.font] ? styleCfg.font : 'modern'
  const fontPair = FONT_PAIRS[fontKey]
  const t = {
    ...THEMES[themeKey],
    ...(accentOv ? { accent: accentOv, statusHotInk: accentOv, statusHotBg: hexA(accentOv, 0.13), barB: accentOv, edBorder: accentOv } : {}),
  }
  function switchTheme(k: string) {
    setThemeKey(k)
    fetch('/api/reports', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: initial.id, theme: k }) }).catch(() => {})
  }
  /** Persist a style override the same way switchTheme persists: apply live, save quietly. */
  function setStyle(patchObj: Any) {
    const next = { ...c, style: { ...(c.style || {}), ...patchObj } }
    setC(next)
    fetch('/api/reports', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: initial.id, content: next }) }).catch(() => {})
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
  const heroRef = useRef<HTMLInputElement>(null)
  const aiFileRef = useRef<HTMLInputElement>(null)
  const [aiKey, setAiKey] = useState<string | null>(null)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiFiles, setAiFiles] = useState<string[]>([])
  const [aiBusy, setAiBusy] = useState(false)
  const [rvFrom, setRvFrom] = useState('')
  const [rvTo, setRvTo] = useState('')
  const [rvBusy, setRvBusy] = useState(false)
  // ---- report period, editable in place (no new report, same /r/<code> link) ----
  const [pdFrom, setPdFrom] = useState(String((initial.content as Any)?.meta?.periodStart || initial.period_start || ''))
  const [pdTo, setPdTo] = useState(String((initial.content as Any)?.meta?.periodEnd || initial.period_end || ''))
  const [pdBusy, setPdBusy] = useState(false)

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
  const bSection = (k: 'snaps' | 'byListing' | 'byMonth' | 'ahead'): Basis => (bcfg[k] || bDefault)
  const snapPrimary: Basis = bcfg.snapshotPrimary || bDefault
  const snapSecondary: Basis | 'none' = (bcfg.snapshotSecondary === undefined ? 'gross' : bcfg.snapshotSecondary)
  const setBasis = (field: string, val: string) => mutate((d: Any) => { d.basis = { ...(d.basis || {}), [field]: val } })
  // Hand-set ADR / RevPAR on a Looking Ahead card, stored per basis (see aheadValues above).
  // An empty box deletes the override, so the card goes straight back to the computed figure.
  const setAheadOv = (i: number, field: 'adrOv' | 'revparOv', b: Basis, v: string) => mutate((d: Any) => {
    const m = d.ahead.months[i]
    const next = { ...(m[field] || {}) }
    if (String(v).trim() === '') delete next[b]; else next[b] = v
    if (Object.keys(next).length) m[field] = next; else delete m[field]
  })
  // Listings blocked/off-market for the period — dropped from revenue AND the occupancy denominator.
  const excluded: string[] = Array.isArray(c.excludeListings) ? c.excludeListings : []
  const toggleExclude = (id: string) => mutate((d: Any) => { d.excludeListings = Array.isArray(d.excludeListings) ? d.excludeListings : []; const i = d.excludeListings.indexOf(id); if (i >= 0) d.excludeListings.splice(i, 1); else d.excludeListings.push(id) })
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

  // In edit mode, back-fill the raw basis numbers on older reports (generated before the 3-basis
  // model) so the per-section basis tabs immediately drive Revenue/ADR/RevPAR. Fetches the snapshot
  // metrics for the report's own period and re-pulls per-listing raw if it's missing the new fields.
  const exKey = (Array.isArray(c.excludeListings) ? c.excludeListings : []).join(',')
  useEffect(() => {
    if (!edit) return
    let cancelled = false
    const exQ = exKey ? '&exclude=' + encodeURIComponent(exKey) : ''
    ;(async () => {
      const m = c.meta || {}
      // Refresh snapshot metrics whenever the exclusion set changes (occupancy/availability depend on it),
      // or when the report predates the 3-basis model and has no raw numbers yet.
      if ((!hasBasisRaw(c.snapshot?.metrics) || exKey) && m.periodStart && m.periodEnd) {
        try {
          const r = await fetch('/api/reports/snapshot-range?id=' + encodeURIComponent(initial.id) + '&from=' + m.periodStart + '&to=' + m.periodEnd + exQ)
          const d = await r.json()
          if (!cancelled && d?.ok && d?.snap) {
            const s = d.snap
            mutate((dr: Any) => { dr.snapshot = dr.snapshot || {}; dr.snapshot.metrics = { accomNum: s.accomNum, accomGrossNum: s.accomGrossNum, cleaningNum: s.cleaningNum, feeNum: s.feeNum, occNights: s.occNights, availNights: s.availNights, reservations: s.reservations, units: s.units, occPct: s.occPct } })
          }
        } catch (_e) { /* keep the stored (single-basis) values */ }
      }
      if (Array.isArray(c.byListing) && c.byListing.length > 0 && c.byListing.some((l: Any) => l.accomGrossNum == null || l.feeNum == null)) {
        try {
          const r = await fetch('/api/reports/listing-breakdown?id=' + encodeURIComponent(initial.id))
          const d = await r.json()
          if (!cancelled && d?.ok && Array.isArray(d.listings)) mutate((dr: Any) => { dr.byListing = d.listings })
        } catch (_e) { /* keep the stored per-listing values */ }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, exKey])

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
  // Statement PDFs are no longer uploaded or AI-parsed. The Owner Statement section is built
  // in the generator from statements picked out of the Guesty owner-ledger mirror, so there is
  // nothing to attach here.
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
  // Change the report's own reporting period in place. The server recomputes the snapshot,
  // month-by-month and per-listing rows and writes them back to THIS report — no new report row,
  // so the /r/<code> link already sent to an owner keeps working and just shows the new window.
  async function applyPeriod() {
    if (!pdFrom || !pdTo || pdBusy) return
    if (pdFrom > pdTo) { setAttachMsg('Report start date must be on or before the end date.'); return }
    setPdBusy(true); setAttachMsg('')
    try {
      const r = await fetch('/api/reports/reperiod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: initial.id, from: pdFrom, to: pdTo }),
      })
      const d = await r.json()
      if (d?.ok && d?.content) {
        setC(d.content) // already persisted server-side; no Save needed for the numbers
        setAttachMsg('Report period updated to ' + pdFrom + ' → ' + pdTo + '. The headline and written sections were left as-is — edit them if they mention dates.')
      } else {
        setAttachMsg((d && d.error) || 'Could not update the report period.')
      }
    } catch (_e) { setAttachMsg('Could not update the report period.') }
    setPdBusy(false)
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
  const projection = c.projection || null
  const voices = c.voices || {}
  const projects = c.projects || {}
  const footer = (hero.title || '') + '  ·  ' + (hero.dateLabel || 'OWNER REVIEW')
  const customSecs: Any[] = (Array.isArray(c.custom) ? c.custom : []).filter((cs: Any) => cs && (String(cs.title || '').trim() || String(cs.body || '').trim()))
  const presentCount = (['hero', 'snapshot',
    (c.pacing ? 'pacing' : null),
    (plan ? 'plan' : null),
    ((c.statement && ((Array.isArray(c.statement.kpis) && c.statement.kpis.length) || (Array.isArray(c.statement.items) && c.statement.items.length))) ? 'statement' : null),
    'ahead', 'voices', 'projects'] as (string | null)[])
    .filter(k => !!k && (k === 'hero' || !isHidden(k as string))).length + customSecs.length

  return (
    /* px-safe: this report is the share link — it renders with NO Shell around it, so the padding
       that keeps content clear of an iPhone's notch in landscape has to come from here. It sits on
       the outer element so the reading column's own px-5 gutter is untouched. */
    <div className="min-h-screen px-safe" style={{ background: t.bg, color: t.ink, '--ed-bg': t.edBg, '--ed-border': t.edBorder, '--t-card': t.card, '--t-border': t.toolbarBorder, '--t-ink': t.ink, '--t-accent': t.accent } as Any}>
      {/* toolbar (edit only appears for logged-in team) */}
      {canEdit && (
        /* The editing toolbar wraps to five or six rows on a phone; sticky at that height it would
           cover most of the report it is meant to be editing, so it only sticks from 640px up. */
        <div className="sb-noprint z-20 sm:sticky sm:top-0 flex items-center justify-end gap-2 px-4 py-2.5 flex-wrap" style={{ background: t.toolbarBg, backdropFilter: 'blur(6px)', borderBottom: '1px solid ' + t.rule }}>
          <div className="mr-auto flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 rounded-full p-0.5" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
              {Object.keys(THEMES).map(k => (
                <button key={k} onClick={() => switchTheme(k)} className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={themeKey === k ? { background: t.ink, color: t.bg } : { color: t.sub }}>
                  {THEMES[k].label}
                </button>
              ))}
            </span>
            {/* Font pairing — headings only, body stays system for number alignment. */}
            <span className="inline-flex items-center gap-1 rounded-full p-0.5" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
              {Object.keys(FONT_PAIRS).map(k => (
                <button key={k} onClick={() => setStyle({ font: k })} title={'Heading typeface: ' + FONT_PAIRS[k].label}
                  className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={fontKey === k ? { background: t.ink, color: t.bg } : { color: t.sub, fontFamily: FONT_PAIRS[k].display || undefined }}>
                  {FONT_PAIRS[k].label}
                </button>
              ))}
            </span>
            {/* Custom accent — one dot of brand colour, everywhere at once. */}
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-1" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
              <label className="relative inline-flex items-center cursor-pointer" title="Custom accent colour — flows into chips, bars, buttons and the PPTX export">
                <span className="w-4 h-4 rounded-full border" style={{ background: t.accent, borderColor: t.toolbarBorder }} />
                <input type="color" value={accentOv || t.accent} onChange={e => setStyle({ accent: e.target.value })}
                  className="absolute inset-0 opacity-0 w-4 h-4 cursor-pointer" />
              </label>
              <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: t.sub }}>Accent</span>
              {accentOv && (
                <button onClick={() => setStyle({ accent: null })} title="Back to the theme's own accent" style={{ color: t.muted }}>
                  <X size={11} />
                </button>
              )}
            </span>
          </div>
          {attachMsg && <span className="text-[11px] font-semibold" style={{ color: t.accent }}>{attachMsg}</span>}
          {edit && (
            <>
              <input ref={pacingRef} type="file" accept="application/pdf" className="hidden" onChange={onPacingPick} />
              <input ref={heroRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onHeroPick} />
              <button onClick={() => pacingRef.current && pacingRef.current.click()} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
                {busy === 'pacing' ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />} Pacing PDF
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

      {/* Display typeface for the chosen pairing — loaded only when a serif pairing is active. */}
      {fontPair.href ? <link rel="stylesheet" href={fontPair.href} /> : null}

      {/* elevated look: smoother rhythm + hairline dividers between sections */}
      <style>{`
        html { scroll-behavior: smooth; }
        .sb-report > section { margin-top: 2.5rem; border-top: 1px solid ${t.rule}; }
        .sb-report > section:first-of-type { border-top: 0; margin-top: 0; }
        /* Headings wear the display face; body and numbers stay system so columns line up. */
        ${fontPair.display ? `
        .sb-report h1, .sb-report h2, .sb-report h3, .sb-present h1, .sb-present h2, .sb-present h3 {
          font-family: ${fontPair.display}; letter-spacing: -0.01em; font-weight: 700;
        }
        .sb-report h1, .sb-present h1 { font-weight: 900; }` : ''}
        /* Numbers align down a column everywhere — tables, stat rows, statements. */
        .sb-report, .sb-present { font-variant-numeric: tabular-nums; }
        /* A printed / PDF'd share page gets the report, not the chrome. */
        @media print {
          .sb-noprint { display: none !important; }
          .sb-report > section { break-inside: avoid; }
        }
        .sb-present { position: fixed; inset: 0; height: 100vh; width: 100vw; overflow-y: scroll; scroll-snap-type: y mandatory; z-index: 40; background: ${t.bg}; -ms-overflow-style: none; scrollbar-width: none; }
        .sb-present::-webkit-scrollbar { display: none; }
        .sb-present > section, .sb-present > header { min-height: 100vh; display: flex; flex-direction: column; justify-content: center; scroll-snap-align: start; padding: 5vh 7vw; box-sizing: border-box; border: 0 !important; margin: 0 !important; }
        /* PHONE: Safari counts the URL bar inside 100vh, so a presented slide was taller than the
           glass and the Exit button and slide dots sat permanently below the fold. dvh is what you
           can actually see; on a desktop dvh and vh are the same number. */
        @supports (height: 100dvh) {
          .sb-present { height: 100dvh; }
          .sb-present > section, .sb-present > header { min-height: 100dvh; }
        }
        /* Two grids below are laid out with inline grid-template-columns (their widths are computed
           in the component), which no utility class can override — so their phone shape lives here.
           Nothing in this block applies above 639px: the desktop report is untouched. */
        @media (max-width: 639px) {
          /* Pacing: metric | ours | comps | delta is four columns in ~295px, which crushes the
             two big figures. Metric and delta take a full line each; the two figures share one. */
          .sb-pacerow { grid-template-columns: 1fr 1fr !important; }
          .sb-pacerow .sb-pace-span { grid-column: 1 / -1; }
          /* Stacked, the fee-summary cells kept the divider that only makes sense in a row. */
          .sb-feesplit > div { border-left: 0 !important; }
        }
        .sb-present > header { text-align: center; }
        .sb-present > footer { display: none; }
        .sb-present > section > *, .sb-present > header > * { max-width: 1080px; width: 100%; margin-left: auto; margin-right: auto; }
        .sb-present > section > * > .pt-12 { padding-top: 0 !important; }
        .sb-present header img { height: 58vh !important; max-height: 58vh !important; width: 100%; object-fit: cover; border-radius: 18px; }
        .sb-present img { object-fit: cover; }
      `}</style>

      {/* Present + unlock-editing buttons for viewers (no edit toolbar) */}
      {!canEdit && !present && (
        <div className="sb-noprint fixed top-4 right-4 z-30 flex items-center gap-2">
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
            <img src={hero.heroImage} alt="" className="mt-8 w-full rounded-2xl object-cover" style={{ maxHeight: 420, border: '1px solid ' + t.cardBorder, boxShadow: '0 24px 48px -28px rgba(0,0,0,0.35)' }} />
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
            {edit && (
              <div className="mt-4 flex items-center gap-2 flex-wrap rounded-xl p-3" style={{ background: t.chip, border: '1px dashed ' + t.cardBorder }}>
                <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: t.muted }}>Report period</span>
                <input type="date" value={pdFrom} onChange={e => setPdFrom(e.target.value)} className="rounded-md px-2 py-1 text-[12px]" style={{ background: t.card, border: '1px solid ' + t.cardBorder, color: t.ink }} />
                <span style={{ color: t.muted }}>&rarr;</span>
                <input type="date" value={pdTo} onChange={e => setPdTo(e.target.value)} className="rounded-md px-2 py-1 text-[12px]" style={{ background: t.card, border: '1px solid ' + t.cardBorder, color: t.ink }} />
                <button
                  onClick={applyPeriod}
                  disabled={pdBusy || !pdFrom || !pdTo}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold disabled:opacity-50"
                  style={{ background: t.ink, color: t.bg }}
                >
                  {pdBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  {pdFrom === (meta.periodStart || '') && pdTo === (meta.periodEnd || '') ? 'Resync numbers' : 'Update dates'}
                </button>
                <span className="text-[11px]" style={{ color: t.muted }}>Recomputes this report — same link, no new report. Run it on the same dates to pull every figure, card and headline back into agreement.</span>
              </div>
            )}
            {edit && hasBasisRaw(snap.metrics) && (
              <div className="mt-3 flex items-center gap-3 flex-wrap rounded-xl p-3" style={{ background: t.chip, border: '1px dashed ' + t.cardBorder }}>
                <BasisPicker label="Big number" value={snapPrimary} onPick={(v: string) => setBasis('snapshotPrimary', v)} t={t} />
                <BasisPicker label="Below it" value={snapSecondary} withNone onPick={(v: string) => setBasis('snapshotSecondary', v)} t={t} />
              </div>
            )}
            <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
              {(snap.cards || []).map((card: Any, i: number) => {
                const M = snap.metrics
                const canBasis = hasBasisRaw(M) && (card.key === 'revenue' || card.key === 'adr' || card.key === 'revpar')
                const pick = (b: Basis) => { const s = basisStrings(M, b); return card.key === 'revenue' ? s.rev : card.key === 'adr' ? s.adr : s.revpar }
                const primaryVal = canBasis ? pick(snapPrimary) : (hasBasisRaw(M) && card.key === 'occupancy' && M.occPct != null ? (M.occPct + '%') : null)
                const secondaryVal = canBasis && snapSecondary !== 'none' ? pick(snapSecondary as Basis) : null
                // Manual override for the big number: computed values are the default, but any card
                // can be typed over (card.override). Clearing the field goes back to the computed one.
                const override = typeof card.override === 'string' && card.override.trim() !== '' ? card.override : null
                const shownVal = override != null ? override : primaryVal
                return (
                <div key={card.key || i} className="relative rounded-2xl p-5 shadow-sm border flex flex-col" style={{ background: t.card, borderColor: t.cardBorder }}>
                  {edit && (
                    <button onClick={() => mutate(d => d.snapshot.cards.splice(i, 1))} className="absolute top-2 right-2" style={{ color: t.accent }}><X size={13} /></button>
                  )}
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.accent }}>
                    <Ed v={card.label || ''} set={v => patch('snapshot.cards.' + i + '.label', v)} edit={edit} />
                  </p>
                  <p className="mt-2 text-4xl font-black tabular-nums" style={{ color: t.ink }}>
                    {primaryVal != null
                      ? (edit
                        ? <Ed v={override != null ? String(card.override) : ''} placeholder={String(primaryVal)} set={v => patch('snapshot.cards.' + i + '.override', v)} edit={edit} />
                        : shownVal)
                      : <Ed v={card.value || ''} set={v => patch('snapshot.cards.' + i + '.value', v)} edit={edit} />}
                  </p>
                  {edit && primaryVal != null && (
                    <p className="mt-1 text-[10px]" style={{ color: t.muted }}>
                      {override != null ? (
                        <>overriding the computed {primaryVal}{' — '}
                          <button onClick={() => patch('snapshot.cards.' + i + '.override', '')} className="underline font-semibold" style={{ color: t.accent }}>back to auto</button></>
                      ) : (
                        <>auto from the numbers — type to override</>
                      )}
                    </p>
                  )}
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
              <span className="inline-flex items-center gap-3 flex-wrap">
                {edit && showMonths && (
                  <BasisPicker label="Basis" value={bSection('byMonth')} onPick={(v: string) => setBasis('byMonth', v)} t={t} />
                )}
                <button onClick={() => setShowMonths(v => !v)} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold" style={{ background: showMonths ? t.accent : t.chip, border: '1px solid ' + (showMonths ? t.accent : t.cardBorder), color: showMonths ? t.card : t.ink }}>
                  {showMonths ? 'Hide monthly view' : 'View by month'}
                </button>
              </span>
            </div>
            {showMonths && (() => {
              // These cards used to print the stored legacy-Net strings whatever basis was
              // selected, so they disagreed with the snapshot above them. Reports generated
              // before the raw components existed have no basis numbers to work from — those
              // keep showing their stored strings rather than a silently wrong figure.
              const mb = bSection('byMonth')
              return (
              <>
                <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {c.byMonth.map((m: Any, i: number) => {
                    const mv = hasBasisRaw(m) ? basisStrings(m, mb) : { rev: m.revenue, adr: m.adr, revpar: m.revpar }
                    return (
                    <div key={i} className="rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                      <p className="text-sm font-black tracking-[0.14em]" style={{ color: t.accent }}>{m.label}</p>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <div><p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.muted }}>Revenue</p><p className="text-xl font-black tabular-nums" style={{ color: t.ink }}>{mv.rev}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.muted }}>Occupancy</p><p className="text-xl font-black tabular-nums" style={{ color: t.ink }}>{m.occPct}%</p></div>
                        <div><p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.muted }}>ADR</p><p className="text-xl font-black tabular-nums" style={{ color: t.ink }}>{mv.adr}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.muted }}>RevPAR</p><p className="text-xl font-black tabular-nums" style={{ color: t.ink }}>{mv.revpar}</p></div>
                      </div>
                    </div>
                    )
                  })}
                </div>
                <p className="mt-3 text-[11px]" style={{ color: t.muted }}>
                  {c.byMonth.some((m: Any) => hasBasisRaw(m))
                    ? BASIS_LABEL[mb]
                    : 'Generated before per-basis monthly figures — regenerate to switch basis here.'}
                </p>
              </>
              )
            })()}
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
              const allL: Any[] = (c.byListing as Any[]).filter((l: Any) => excluded.indexOf(l.id) < 0)
              const excludedRows: Any[] = (c.byListing as Any[]).filter((l: Any) => excluded.indexOf(l.id) >= 0)
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
                  {edit && excludedRows.length > 0 && (
                    <div className="mt-3 flex items-center gap-2 flex-wrap text-[11px]">
                      <span className="font-bold uppercase tracking-[0.14em]" style={{ color: t.muted }}>Excluded (blocked)</span>
                      {excludedRows.map((l: Any) => (
                        <button key={l.id} onClick={() => toggleExclude(l.id)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1" style={{ background: t.chip, border: '1px solid ' + t.cardBorder, color: t.ink }}>{l.name} <span style={{ color: t.accent }}>restore</span></button>
                      ))}
                    </div>
                  )}
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
                    {/* Listing · revenue · occ · ADR · RevPAR is five columns of money in 335px of
                        phone — every figure wrapped mid-number. Header and rows share one sideways
                        scroller so they stay in step; above 640px the grid is fluid as before. */}
                    <div className="lh-hscroll">
                    <div className="min-w-[560px] sm:min-w-0">
                    <div className="grid gap-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider" style={{ background: t.chip, color: t.muted, gridTemplateColumns: '1.7fr 1fr 0.8fr 1fr 1fr' }}>
                      <div>Listing</div><div className="text-right">Revenue</div><div className="text-right">Occ</div><div className="text-right">ADR</div><div className="text-right">RevPAR</div>
                    </div>
                    {rows.map((l: Any, i: number) => {
                      const lv = hasBasisRaw(l) ? basisStrings(l, lb) : { rev: lb === 'net' ? l.revenue : (l.grossRevenue || l.revenue), adr: lb === 'net' ? l.adr : (l.grossAdr || l.adr), revpar: lb === 'net' ? l.revpar : (l.grossRevpar || l.revpar) }
                      return (
                      <div key={l.id || i} className="grid gap-2 px-4 py-3 items-center border-t" style={{ borderColor: t.cardBorder, gridTemplateColumns: '1.7fr 1fr 0.8fr 1fr 1fr', background: t.card }}>
                        <div className="text-[13px] font-semibold truncate flex items-center gap-1.5" style={{ color: t.ink }}>{edit && <button onClick={() => toggleExclude(l.id)} title="Exclude — blocked/off-market this period" style={{ color: t.muted }}><X size={12} /></button>}<span className="truncate">{l.name}</span>{l.bedrooms != null ? <span className="text-[11px] font-normal" style={{ color: t.muted }}>{l.bedrooms}BR</span> : null}</div>
                        <div className="text-right text-[13px] font-black tabular-nums" style={{ color: t.ink }}>{lv.rev}</div>
                        <div className="text-right text-[13px] tabular-nums" style={{ color: t.sub }}>{l.occPct}%</div>
                        <div className="text-right text-[13px] tabular-nums" style={{ color: t.sub }}>{lv.adr}</div>
                        <div className="text-right text-[13px] tabular-nums" style={{ color: t.sub }}>{lv.revpar}</div>
                      </div>
                      )
                    })}
                    </div>
                    </div>
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
                  <div key={i} className="sb-pacerow relative rounded-2xl p-5 shadow-sm border grid items-center gap-3" style={{ background: t.card, borderColor: t.cardBorder, gridTemplateColumns: 'minmax(6rem,1.15fr) 1fr 1fr minmax(5rem,1fr)' }}>
                    {edit && (
                      <button onClick={() => mutate(d => d.pacing.rows.splice(i, 1))} className="absolute top-2 right-2" style={{ color: t.accent }}><X size={13} /></button>
                    )}
                    <div className="sb-pace-span text-sm font-bold" style={{ color: t.ink }}>{r.metric}</div>
                    <div className="text-center">
                      <p className="text-2xl font-black tabular-nums" style={{ color: t.ink }}><Ed v={r.ours || ''} set={v => patch('pacing.rows.' + i + '.ours', v)} edit={edit} /></p>
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.accent }}>{meta.scopeLabel || 'Us'}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-black tabular-nums" style={{ color: t.muted }}><Ed v={r.comps || ''} set={v => patch('pacing.rows.' + i + '.comps', v)} edit={edit} /></p>
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.muted }}>Comp set</p>
                    </div>
                    <div className="sb-pace-span text-right">
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
              <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
                <Ed v={c.statement.headline || ''} set={v => patch('statement.headline', v)} edit={edit} multiline />
              </h2>
              {(c.statement.subtitle || edit) && (
                <p className="mt-1 text-[13px]" style={{ color: t.sub }}>
                  <Ed v={c.statement.subtitle || ''} set={v => patch('statement.subtitle', v)} edit={edit} placeholder="Subtitle…" />
                </p>
              )}
              {(c.statement.note || edit) && (
                <p className="mt-1 text-[12px] italic" style={{ color: t.muted }}>
                  <Ed v={c.statement.note || ''} set={v => patch('statement.note', v)} edit={edit} multiline placeholder="Methodology note…" />
                </p>
              )}

              {/* KPI band — the four figures an owner actually asks about. */}
              {Array.isArray(c.statement.kpis) && c.statement.kpis.length > 0 && (
                <div className={'mt-6 grid gap-4 ' + (c.statement.kpis.length >= 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-2')}>
                  {c.statement.kpis.map((k: Any, i: number) => {
                    // Measured on the live report: the card is 196px wide, so a seven-figure value
                    // at text-3xl needs 171px of a 154px inner box and spills past the border. A
                    // label that wraps to two lines ("MANAGEMENT COMMISSION") also pushes its value
                    // 15px below the other three. Reserve two label lines and step the value size
                    // down by length so the band stays flush whatever an owner's figures are.
                    const vlen = String(k.value || '').length
                    const vpx = vlen >= 12 ? 20 : vlen >= 10 ? 24 : vlen >= 9 ? 27 : 30
                    return (
                    <div key={i} className="rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] leading-[1.3] min-h-[26px]" style={{ color: t.muted }}>{k.label}</p>
                      <p className="mt-2 font-black tabular-nums whitespace-nowrap" style={{ color: t.ink, fontSize: vpx, lineHeight: 1.1 }}>
                        <Ed v={k.value || ''} set={v => patch('statement.kpis.' + i + '.value', v)} edit={edit} />
                      </p>
                      <p className="mt-1 text-[12px] font-semibold" style={{ color: t.sub }}>{k.sub}</p>
                    </div>
                    )
                  })}
                </div>
              )}

              {/* Earned vs paid, month by month. Bars share one scale so the two series are
                  directly comparable; the gap between them is settlement timing. */}
              {Array.isArray(c.statement.months) && c.statement.months.length > 0 && (() => {
                const ms: Any[] = c.statement.months
                const peak = Math.max(1, ...ms.map((m: Any) => Math.max(Number(m.net) || 0, Number(m.paid) || 0)))
                const pct = (v: Any) => Math.max(1.5, ((Number(v) || 0) / peak) * 100)
                return (
                  <div className="mt-6 rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                    <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.muted }}>NET TO OWNER  ·  PAID OUT</p>
                      <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: t.muted }}>
                        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: t.barA }} />Net earned</span>
                        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: t.accent }} />Paid out</span>
                      </div>
                    </div>
                    <div className="flex items-end gap-3" style={{ height: 150 }}>
                      {ms.map((m: Any, i: number) => (
                        <div key={i} className="flex-1 flex items-end justify-center gap-1 h-full">
                          <div className="w-1/2 rounded-t-md" style={{ height: pct(m.net) + '%', background: t.barA }} title={'Net ' + usdP(m.net)} />
                          <div className="w-1/2 rounded-t-md" style={{ height: pct(m.paid) + '%', background: hexA(t.accent, 0.85) }} title={'Paid ' + usdP(m.paid)} />
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-3 mt-1.5">
                      {ms.map((m: Any, i: number) => (
                        <span key={i} className="flex-1 text-center text-[11px] font-semibold" style={{ color: t.sub }}>
                          {String(m.label || m.month || '').split(' ')[0].slice(0, 3)}
                        </span>
                      ))}
                    </div>

                    {/* The statement tables already scrolled sideways; what they lacked was a floor
                        width, so on a phone the browser squeezed the columns instead and "Net to
                        owner" wrapped to three lines per cell. The min width is dropped at 640px,
                        so desktop — and print, which lays out far wider — is unchanged. */}
                    <div className="mt-5 overflow-x-auto">
                      <table className="w-full min-w-[480px] sm:min-w-0 text-[12.5px]">
                        <thead>
                          <tr style={{ color: t.muted }}>
                            <th className="text-left font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Month</th>
                            <th className="text-right font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Rental</th>
                            <th className="text-right font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Commission</th>
                            <th className="text-right font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Net to owner</th>
                            <th className="text-right font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Paid out</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ms.map((m: Any, i: number) => (
                            <tr key={i} style={{ borderTop: '1px solid ' + t.rule }}>
                              <td className="py-1.5 font-semibold" style={{ color: t.ink }}>{m.label || m.month}</td>
                              <td className="py-1.5 text-right tabular-nums" style={{ color: t.body }}>{usdP(m.rental)}</td>
                              <td className="py-1.5 text-right tabular-nums" style={{ color: t.body }}>{usdP(m.commission)}</td>
                              <td className="py-1.5 text-right tabular-nums font-black" style={{ color: t.ink }}>{usdP(m.net)}</td>
                              <td className="py-1.5 text-right tabular-nums" style={{ color: t.body }}>{usdP(m.paid)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}

              {/* Owner-level split, only worth showing when the scope covers more than one. */}
              {Array.isArray(c.statement.owners) && c.statement.owners.length > 1 && (
                <div className="mt-4 rounded-2xl p-5 shadow-sm border overflow-x-auto" style={{ background: t.card, borderColor: t.cardBorder }}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-3" style={{ color: t.muted }}>BY OWNER</p>
                  <table className="w-full min-w-[540px] sm:min-w-0 text-[12.5px]">
                    <thead>
                      <tr style={{ color: t.muted }}>
                        <th className="text-left font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Owner</th>
                        <th className="text-right font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Months</th>
                        <th className="text-right font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Rental</th>
                        <th className="text-right font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Commission</th>
                        <th className="text-right font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Net</th>
                        <th className="text-right font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.statement.owners.map((o: Any, i: number) => (
                        <tr key={i} style={{ borderTop: '1px solid ' + t.rule }}>
                          <td className="py-1.5 font-semibold" style={{ color: t.ink }}>{o.ownerName}</td>
                          <td className="py-1.5 text-right tabular-nums" style={{ color: t.body }}>{o.months}</td>
                          <td className="py-1.5 text-right tabular-nums" style={{ color: t.body }}>{usdP(o.rental)}</td>
                          <td className="py-1.5 text-right tabular-nums" style={{ color: t.body }}>{usdP(o.commission)}</td>
                          <td className="py-1.5 text-right tabular-nums font-black" style={{ color: t.ink }}>{usdP(o.net)}</td>
                          <td className="py-1.5 text-right tabular-nums" style={{ color: t.body }}>{usdP(o.paid)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Unit performance, straight off the statement lines. Every ledger row that
                  carries a listing lands on its unit; the rows that carry none (owner charges,
                  transfers, adjustments booked at the portfolio) land on one explicit line so
                  the column foots to net exactly rather than being spread or dropped. */}
              {Array.isArray(c.statement.units) && c.statement.units.length > 0 && (() => {
                const all: Any[] = c.statement.units
                const real = all.filter((u: Any) => !u.portfolio)
                const port = all.filter((u: Any) => u.portfolio)
                const CAP = 30
                // Keep the table readable at portfolio scale without ever losing a dollar: the
                // tail is folded into one honest aggregate row rather than truncated away.
                const shown = real.slice(0, CAP)
                const restArr = real.slice(CAP)
                const sum = (a: Any[], k: string) => a.reduce((s: number, x: Any) => s + (Number(x[k]) || 0), 0)
                const rest = restArr.length ? [{
                  listingId: '__rest__', name: restArr.length + ' other units', rest: true,
                  rental: sum(restArr, 'rental'), commission: sum(restArr, 'commission'),
                  other: sum(restArr, 'other'), net: sum(restArr, 'net'), nights: sum(restArr, 'nights'),
                }] : []
                const rows: Any[] = [...shown, ...rest, ...port]
                const peak = Math.max(1, ...rows.map((u: Any) => Math.abs(Number(u.net) || 0)))
                const tot = {
                  rental: sum(all, 'rental'), commission: sum(all, 'commission'),
                  other: sum(all, 'other'), net: sum(all, 'net'), nights: sum(real, 'nights'),
                }
                const best = real.length ? real[0] : null
                const nUnits = real.length
                return (
                  <div className="mt-4 rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                    <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.muted }}>UNIT PERFORMANCE</p>
                      <p className="text-[11px] font-semibold tabular-nums" style={{ color: t.sub }}>
                        {nUnits} unit{nUnits === 1 ? '' : 's'}
                        {best ? '  ·  top unit ' + best.name + ' at ' + usdP(best.net) : ''}
                      </p>
                    </div>
                    <p className="text-[11px] italic mb-4" style={{ color: t.muted }}>
                      Net per unit after commission and charges. Bars are scaled to the largest unit.
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] sm:min-w-0 text-[12.5px]">
                        <thead>
                          <tr style={{ color: t.muted }}>
                            <th className="text-left font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Unit</th>
                            <th className="text-right font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Lines</th>
                            <th className="text-right font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Rental</th>
                            <th className="text-right font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Commission</th>
                            <th className="text-right font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Charges / credits</th>
                            <th className="text-right font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Net to owner</th>
                            <th className="text-left font-bold uppercase tracking-[0.12em] text-[10px] pb-2 pl-3" style={{ width: '18%' }}>Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((u: Any, i: number) => {
                            const net = Number(u.net) || 0
                            const w = Math.max(1.5, (Math.abs(net) / peak) * 100)
                            const oth = Number(u.other) || 0
                            return (
                              <tr key={i} style={{ borderTop: '1px solid ' + t.rule }}>
                                <td className="py-1.5 pr-3 font-semibold" style={{ color: u.portfolio ? t.sub : t.ink }}>
                                  {u.name || u.listingId}
                                </td>
                                <td className="py-1.5 text-right tabular-nums" style={{ color: t.muted }}>{u.portfolio ? '—' : (Number(u.nights) || 0)}</td>
                                <td className="py-1.5 text-right tabular-nums" style={{ color: t.body }}>{usdP(u.rental)}</td>
                                <td className="py-1.5 text-right tabular-nums" style={{ color: t.body }}>{usdP(u.commission)}</td>
                                <td className="py-1.5 text-right tabular-nums" style={{ color: oth < 0 ? t.accent : t.body }}>{usdP(oth)}</td>
                                <td className="py-1.5 text-right tabular-nums font-black" style={{ color: net < 0 ? t.accent : t.ink }}>{usdP(net)}</td>
                                <td className="py-1.5 pl-3">
                                  <span className="inline-flex items-center gap-2 w-full">
                                    <span className="inline-block h-2 rounded-sm" style={{ width: w + '%', background: net < 0 ? hexA(t.accent, 0.75) : t.barA }} />
                                    <span className="text-[10.5px] tabular-nums font-semibold" style={{ color: t.muted }}>
                                      {tot.net ? (Math.round((net / tot.net) * 1000) / 10).toFixed(1) + '%' : '—'}
                                    </span>
                                  </span>
                                </td>
                              </tr>
                            )
                          })}
                          <tr style={{ borderTop: '2px solid ' + t.ink }}>
                            <td className="pt-2 font-black uppercase tracking-[0.1em] text-[10.5px]" style={{ color: t.ink }}>Total</td>
                            <td className="pt-2 text-right tabular-nums font-semibold" style={{ color: t.muted }}>{tot.nights}</td>
                            <td className="pt-2 text-right tabular-nums font-bold" style={{ color: t.ink }}>{usdP(tot.rental)}</td>
                            <td className="pt-2 text-right tabular-nums font-bold" style={{ color: t.ink }}>{usdP(tot.commission)}</td>
                            <td className="pt-2 text-right tabular-nums font-bold" style={{ color: t.ink }}>{usdP(tot.other)}</td>
                            <td className="pt-2 text-right tabular-nums font-black" style={{ color: t.ink }}>{usdP(tot.net)}</td>
                            <td />
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}

              {/* Fee and expense breakdown. Grouped on Guesty's own line name rather than the
                  charge code: a single code mixes real owner charges with channel-fee
                  reimbursements, which would net to one meaningless number. Rental income is
                  the top line above, so this table is everything that moves it to net. */}
              {Array.isArray(c.statement.fees) && c.statement.fees.length > 0 && (() => {
                const lines: Any[] = c.statement.fees.filter((f: Any) => f.kind !== 'rental')
                if (!lines.length) return null
                const peak = Math.max(1, ...lines.map((f: Any) => Math.abs(Number(f.amount) || 0)))
                const charges = lines.filter((f: Any) => (Number(f.amount) || 0) < 0)
                const credits = lines.filter((f: Any) => (Number(f.amount) || 0) >= 0)
                const sumOf = (a: Any[]) => a.reduce((s: number, f: Any) => s + (Number(f.amount) || 0), 0)
                const totCharge = sumOf(charges), totCredit = sumOf(credits)
                const rentalTop = Number((c.statement.totals || {}).rental) || 0
                return (
                  <div className="mt-4 rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.muted }}>FEES, EXPENSES AND CREDITS</p>
                    <p className="text-[11px] italic mt-1 mb-4" style={{ color: t.muted }}>
                      {c.statement.feeLabels === false
                        ? 'Grouped by charge code. A negative figure is money out; a positive figure is a credit back to the owner.'
                        : 'Every line as Guesty names it on the statement. A negative figure is money out; a positive figure is a credit back to the owner.'}
                    </p>

                    {/* Rental → deductions → credits → net, so the arithmetic is visible. */}
                    <div className="sb-feesplit grid gap-0 sm:grid-cols-4 mb-4">
                      {[
                        { l: 'Rental income', v: rentalTop, c: t.ink },
                        { l: 'Charges and commission', v: totCharge, c: t.accent },
                        { l: 'Credits back', v: totCredit, c: t.ink },
                        { l: 'Net to owner', v: rentalTop + totCharge + totCredit, c: t.ink },
                      ].map((k, i) => (
                        <div key={i} className="py-2 px-3" style={{ borderLeft: i ? '1px solid ' + t.rule : 'none' }}>
                          <p className="text-[9.5px] font-bold uppercase tracking-[0.14em]" style={{ color: t.muted }}>{k.l}</p>
                          <p className="mt-0.5 text-[17px] font-black tabular-nums" style={{ color: k.c }}>{usdP(k.v)}</p>
                        </div>
                      ))}
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] sm:min-w-0 text-[12.5px]">
                        <thead>
                          <tr style={{ color: t.muted }}>
                            <th className="text-left font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Line</th>
                            <th className="text-right font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Code</th>
                            <th className="text-right font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Entries</th>
                            <th className="text-right font-bold uppercase tracking-[0.12em] text-[10px] pb-2">Amount</th>
                            <th className="text-left font-bold uppercase tracking-[0.12em] text-[10px] pb-2 pl-3" style={{ width: '26%' }}>Scale</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((f: Any, i: number) => {
                            const amt = Number(f.amount) || 0
                            const w = Math.max(1.5, (Math.abs(amt) / peak) * 100)
                            return (
                              <tr key={i} style={{ borderTop: '1px solid ' + t.rule }}>
                                <td className="py-1.5 pr-3 font-semibold" style={{ color: t.ink }}>{f.label}</td>
                                <td className="py-1.5 text-right tabular-nums text-[11px]" style={{ color: t.muted }}>{f.code || '—'}</td>
                                <td className="py-1.5 text-right tabular-nums" style={{ color: t.muted }}>{Number(f.rows) || 0}</td>
                                <td className="py-1.5 text-right tabular-nums font-bold" style={{ color: amt < 0 ? t.accent : t.ink }}>{usdP(amt)}</td>
                                <td className="py-1.5 pl-3">
                                  <span className="inline-block h-2 rounded-sm" style={{ width: w + '%', background: amt < 0 ? hexA(t.accent, 0.75) : t.barA }} />
                                </td>
                              </tr>
                            )
                          })}
                          <tr style={{ borderTop: '2px solid ' + t.ink }}>
                            <td className="pt-2 font-black uppercase tracking-[0.1em] text-[10.5px]" style={{ color: t.ink }}>Total off rental</td>
                            <td />
                            <td className="pt-2 text-right tabular-nums font-semibold" style={{ color: t.muted }}>
                              {lines.reduce((s: number, f: Any) => s + (Number(f.rows) || 0), 0)}
                            </td>
                            <td className="pt-2 text-right tabular-nums font-black" style={{ color: t.ink }}>{usdP(totCharge + totCredit)}</td>
                            <td />
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}

              {/* Legacy: reports generated from uploaded PDFs before the mirror existed. */}
              {!(Array.isArray(c.statement.kpis) && c.statement.kpis.length) && (
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
              )}
            </div>
          </SectionShell>
        )}

        {/* ---------- LOOKING AHEAD ---------- */}
        <SectionShell id="ahead" title="Looking Ahead" hidden={isHidden('ahead')} edit={edit} onToggle={() => toggleSection('ahead')} onAi={() => openAi('ahead')}>
          <div className="pt-12">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Eyebrow>LOOKING AHEAD</Eyebrow>
              {edit && (ahead.months || []).some((m: Any) => hasBasisRaw(m)) && (
                <BasisPicker label="Basis" value={bSection('ahead')} onPick={(v: string) => setBasis('ahead', v)} t={t} />
              )}
            </div>
            <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
              <Ed v={ahead.headline || ''} set={v => patch('ahead.headline', v)} edit={edit} multiline />
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: t.sub }}>
              <Ed v={ahead.subtitle || ''} set={v => patch('ahead.subtitle', v)} edit={edit} />
            </p>
            <div className={'mt-6 grid gap-4 ' + (((ahead.months || []).length >= 3) ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
              {(ahead.months || []).map((m: Any, i: number) => {
                // The first card is the month already underway (its stored status says so);
                // everything after it is a future month, and how far out it sits decides how
                // its occupancy reads — index 1 is next month, index 2 is roughly 60 days out.
                const inMonth = i === 0 && String(m.status || '').toUpperCase() === 'IN MONTH'
                const chip = paceChip(t, m.occPct, inMonth, Math.max(1, i))
                // These cards used to print their stored legacy-Net strings whatever basis was
                // selected, so they disagreed with the snapshot above. Reports generated before
                // the raw components existed have nothing to re-derive from — those keep their
                // stored, hand-editable strings rather than a silently wrong figure.
                const aRaw = hasBasisRaw(m)
                const ab = bSection('ahead')
                const av = aheadValues(m, ab)
                return (
                <div key={i} className="relative rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                  {edit && (
                    <button onClick={() => mutate(d => d.ahead.months.splice(i, 1))} className="absolute top-2 right-2" style={{ color: t.accent }}><X size={13} /></button>
                  )}
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-black tracking-[0.14em]"><Ed v={m.label || ''} set={v => patch('ahead.months.' + i + '.label', v)} edit={edit} /></span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider" style={chip.style}>{chip.label}</span>
                  </div>
                  <p className="mt-3 text-4xl font-black tabular-nums">
                    {edit ? <Ed v={String(m.occPct ?? 0)} set={v => patch('ahead.months.' + i + '.occPct', Number(v) || 0)} edit /> : (m.occPct ?? 0)}%
                    <span className="text-sm font-semibold ml-2" style={{ color: t.muted }}>on the books</span>
                  </p>
                  <p className="mt-1.5 text-[13px] font-semibold" style={{ color: t.body }}>
                    ADR <Ed v={av.adr} className="tabular-nums" edit={edit}
                          set={v => (aRaw ? setAheadOv(i, 'adrOv', ab, v) : patch('ahead.months.' + i + '.adr', v))} />
                    {'   ·   '}
                    RevPAR <Ed v={av.revpar} className="tabular-nums" edit={edit}
                          set={v => (aRaw ? setAheadOv(i, 'revparOv', ab, v) : patch('ahead.months.' + i + '.revpar', v))} />
                  </p>
                  {/* What the engine says, kept in view the moment you depart from it — and one
                      click back. Edit mode only: the owner sees the number, never the argument. */}
                  {edit && aRaw && (av.adrOv || av.revparOv) && (
                    <p className="mt-1 text-[10.5px] flex items-center gap-1.5 flex-wrap" style={{ color: t.muted }}>
                      <span>Hand-set · {BASIS_SHORT[ab]} computes ADR {av.adrComputed} · RevPAR {av.revparComputed}</span>
                      <button
                        onClick={() => mutate((d: Any) => { delete d.ahead.months[i].adrOv; delete d.ahead.months[i].revparOv })}
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{ background: t.chip, border: '1px solid ' + t.cardBorder, color: t.accent }}>
                        Use computed
                      </button>
                    </p>
                  )}
                  {(m.note || edit) && (
                    <p className="mt-3 text-[13px]" style={{ color: t.sub }}>
                      <Ed v={m.note || ''} set={v => patch('ahead.months.' + i + '.note', v)} edit={edit} multiline placeholder="Commentary…" />
                    </p>
                  )}
                </div>
              )})}
            </div>
            {(ahead.months || []).some((m: Any) => hasBasisRaw(m)) && (
              <p className="mt-3 text-[11px]" style={{ color: t.muted }}>
                ADR / RevPAR on the books &middot; {BASIS_LABEL[bSection('ahead')]}
                {edit && (ahead.months || []).some((m: Any) => aheadValues(m, bSection('ahead')).adrOv || aheadValues(m, bSection('ahead')).revparOv)
                  ? ' · some figures on this basis are hand-set' : ''}
              </p>
            )}
            {Array.isArray(ahead.strip) && ahead.strip.length > 0 && (
              <div className="mt-6 rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                <div className="flex items-baseline justify-between mb-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.muted }}>MONTHS AHEAD  ·  OCCUPANCY %</p>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: t.muted }}>ON THE BOOKS</p>
                </div>
                {/* Bar band is a fixed 144px so every bar is drawn against the same scale.
                    No reference line: an owner reads a dashed line as a target we are under,
                    and how much is on the books depends entirely on how far out the month is. */}
                <div className="relative" style={{ height: 144 }}>
                  <div className="flex items-end gap-3 h-full">
                    {ahead.strip.map((s: Any, i: number) => (
                      <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                        <span className="text-[12px] font-black tabular-nums mb-1">
                          {edit ? <Ed v={String(s.occPct ?? 0)} set={v => patch('ahead.strip.' + i + '.occPct', Number(v) || 0)} edit /> : (s.occPct)}%
                        </span>
                        <div className="w-full rounded-t-md" style={{ height: Math.max(4, (Number(s.occPct) || 0)) + '%', background: paceBar(t, s.occPct, i === 1, Math.max(1, i - 1)), opacity: i === 0 ? 0.35 : 1 }} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3 mt-1.5">
                  {ahead.strip.map((s: Any, i: number) => (
                    <span key={i} className="flex-1 text-center text-[11px] font-semibold" style={{ color: t.sub }}>
                      {edit ? <Ed v={s.month || ''} set={v => patch('ahead.strip.' + i + '.month', v)} edit /> : s.month}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SectionShell>

        {/* ---------- NEXT SEASON PROJECTION (Jon, 2026-08-22) ---------- */}
        {projection && Array.isArray(projection.monthLabels) && projection.monthLabels.length > 0 && (
          <SectionShell id="projection" title="Next Season" hidden={isHidden('projection')} edit={edit} onToggle={() => toggleSection('projection')} onAi={() => openAi('projection')}>
            <div className="pt-12">
              <Eyebrow>NEXT SEASON</Eyebrow>
              <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
                <Ed v={projection.headline || ''} set={v => patch('projection.headline', v)} edit={edit} multiline />
              </h2>
              <p className="mt-1 text-[13px]" style={{ color: t.sub }}>
                <Ed v={projection.subtitle || ''} set={v => patch('projection.subtitle', v)} edit={edit} />
              </p>
              <div className="mt-6 rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                <div className="flex items-baseline justify-between flex-wrap gap-2 mb-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.muted }}>PROJECTED NET OWNER REVENUE</p>
                  <p className="text-2xl font-black tabular-nums">${Number(projection.total || 0).toLocaleString()}<span className="text-sm font-semibold ml-2" style={{ color: t.muted }}>season total · after {projection.mgmtPct}% management</span></p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]" style={{ minWidth: 560 }}>
                    <thead>
                      <tr>
                        <th className="text-left font-bold text-[10px] uppercase tracking-wider py-1.5" style={{ color: t.muted }}>Unit</th>
                        {projection.monthLabels.map((m: string, i: number) => (
                          <th key={i} className="text-right font-bold text-[10px] uppercase tracking-wider py-1.5" style={{ color: t.muted }}>{m}</th>
                        ))}
                        <th className="text-right font-bold text-[10px] uppercase tracking-wider py-1.5" style={{ color: t.muted }}>Season</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(projection.units || []).map((u: Any, i: number) => (
                        <tr key={i} style={{ borderTop: '1px solid ' + t.cardBorder }}>
                          <td className="py-1.5 font-semibold">
                            {u.name}
                            {u.health != null ? (
                              <span title={'Property health ' + u.health + '/100 (' + (u.band || '') + ')' + (u.rating != null ? ' · guest rating ' + Number(u.rating).toFixed(1) : '')}
                                className="ml-1.5 inline-block w-2 h-2 rounded-full align-middle"
                                style={{ background: u.health >= 85 ? '#059669' : u.health >= 70 ? '#84cc16' : u.health >= 55 ? '#f59e0b' : '#e11d48' }} />
                            ) : null}
                          </td>
                          {(u.months || []).map((v: number, j: number) => (
                            <td key={j} className="py-1.5 text-right tabular-nums">${Number(v || 0).toLocaleString()}</td>
                          ))}
                          <td className="py-1.5 text-right tabular-nums font-bold">${Number(u.total || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: '2px solid ' + t.accent }}>
                        <td className="py-2 font-black">Total</td>
                        {(projection.byMonth || []).map((v: number, j: number) => (
                          <td key={j} className="py-2 text-right tabular-nums font-black">${Number(v || 0).toLocaleString()}</td>
                        ))}
                        <td className="py-2 text-right tabular-nums font-black">${Number(projection.total || 0).toLocaleString()}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              {Array.isArray(projection.upsides) && projection.upsides.length > 0 && (
                <div className="mt-4 rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-3" style={{ color: t.muted }}>WHERE ADR CAN IMPROVE</p>
                  <div className="space-y-2">
                    {projection.upsides.map((r: Any, i: number) => (
                      <div key={i} className="flex items-start gap-2.5 text-[13px]" style={{ color: t.body }}>
                        {edit && (
                          <button onClick={() => mutate(d => d.projection.upsides.splice(i, 1))} style={{ color: t.accent }} className="mt-0.5"><X size={12} /></button>
                        )}
                        <span className="shrink-0 text-[11px] font-black px-1.5 py-0.5 rounded-md tabular-nums" style={{ background: t.accentSoft || '#ecfdf5', color: t.accent }}>+{r.adrPct}% ADR</span>
                        <span><b>{r.unit}:</b> <Ed v={r.text || ''} set={v => patch('projection.upsides.' + i + '.text', v)} edit={edit} multiline /></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(projection.note || edit) && (
                <p className="mt-3 text-[12px]" style={{ color: t.sub }}>
                  <Ed v={projection.note || ''} set={v => patch('projection.note', v)} edit={edit} multiline placeholder="Methodology note…" />
                </p>
              )}
            </div>
          </SectionShell>
        )}

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
