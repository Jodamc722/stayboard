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

function buildPptx(P: Any, c: Any, t: Any, heroData: string | null, logoData?: string | null): Any {
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
  // The mark leads the exported deck the same way it leads the page.
  if (logoData) s1.addImage({ data: logoData, x: 5.56, y: 0.5, w: 2.2, h: 0.93, sizing: { type: 'contain', w: 2.2, h: 0.93 } })
  else s1.addText(String(hero.eyebrow || ''), { x: 0.6, y: 0.7, w: 12.13, h: 0.3, align: 'center', fontSize: 12, bold: true, color: ACC, charSpacing: 4 })
  s1.addText(String(hero.dateLabel || 'OWNER REVIEW'), { x: 0.6, y: logoData ? 1.52 : 1.06, w: 12.13, h: 0.3, align: 'center', fontSize: 11, bold: true, color: GOLD, charSpacing: 4 })
  s1.addText(String(hero.title || ''), { x: 0.6, y: logoData ? 1.86 : 1.4, w: 12.13, h: 1.1, align: 'center', fontSize: 52, bold: true, color: INK })
  s1.addText(String(hero.headline || ''), { x: 1.6, y: logoData ? 3.05 : 2.62, w: 10.13, h: 0.7, align: 'center', fontSize: 16, color: BODY })
  if (heroData) s1.addImage({ data: heroData, x: 0.6, y: logoData ? 3.86 : 3.5, w: 12.13, h: logoData ? 2.85 : 3.2, sizing: { type: 'cover', w: 12.13, h: 3.2 } })
  else s1.addShape('roundRect', { x: 0.6, y: logoData ? 3.86 : 3.5, w: 12.13, h: logoData ? 2.85 : 3.2, fill: { color: CHIP }, rectRadius: 0.06 })
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

// ONE QUESTION ON THE CALL. `live` is true for anyone who can edit — including while presenting,
// because filling these in during the meeting is the entire point of the document. An owner
// reading it later sees the answer, or an honest "not discussed yet".
function AskBlock({ ask, live, set, t }: { ask: Any; live: boolean; set: (v: string) => void; t: Any }) {
  const a = String(ask.a || '')
  const done = !!a.trim()
  return (
    <div className="pl-5" style={{ borderLeft: '2px solid ' + (done ? t.good : t.rule) }}>
      <p className="text-[15.5px] font-bold leading-snug" style={{ color: t.ink }}>{ask.q}</p>
      {ask.hint ? <p className="text-[13px] mt-1 leading-relaxed" style={{ color: t.muted }}>{ask.hint}</p> : null}
      {live ? (
        <input
          value={a}
          onChange={e => set(e.target.value)}
          placeholder="type the answer while you talk&hellip;"
          className="onb-ask mt-2.5 w-full text-[15px] pb-1.5"
          style={{ background: 'transparent', border: 0, borderBottom: '1px ' + (done ? 'solid ' + t.accent : 'dashed ' + t.rule), color: t.ink, fontFamily: 'inherit' }}
        />
      ) : done ? (
        <p className="mt-2 text-[15px]" style={{ color: t.body }}>{a}</p>
      ) : (
        <p className="mt-2 text-[13px] font-semibold uppercase tracking-[0.1em]" style={{ color: t.gold }}>Not discussed yet</p>
      )}
    </div>
  )
}

// TEXT YOU CAN FIX WHILE YOU READ IT ALOUD (Jon, 2026-09-16: "editable in view mode"). No
// toolbar, no mode switch — a team viewer just clicks into the listing copy and types. It reads
// as plain text until focused, so an owner looking at the same page sees a document, not a form.
function LiveText({ v, set, live, single, t, cls, ro }: { v: string; set: (s: string) => void; live: boolean; single?: boolean; t: Any; cls?: string; ro?: string }) {
  if (!live) {
    return <p className={ro || 'text-[15px] leading-[1.7] whitespace-pre-line'} style={{ color: t.body }}>{v || '\u2014'}</p>
  }
  const common = {
    value: v,
    onChange: (e: Any) => set(e.target.value),
    className: cls || 'onb-live w-full text-[15px] leading-[1.7] rounded-lg px-3 py-2 -mx-3',
    style: { color: t.body, background: 'transparent', border: '1px solid transparent', fontFamily: 'inherit' } as Any,
  }
  return single
    ? <input {...common} />
    : <textarea {...common} rows={Math.max(2, Math.min(9, Math.ceil((v.length || 1) / 68) + 1))} style={{ ...common.style, resize: 'vertical' }} />
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
  // A PRESENTER HAS TO BE ABLE TO JUMP (Jon, 2026-09-16: "think flow, think functionality").
  // An owner interrupts on slide 3 to ask how they get paid; arrowing through four slides to
  // reach it is what makes a deck feel amateur. Each onboarding section carries data-nav, and
  // the names are read off the DOM at present time rather than kept in a second list that would
  // silently drift out of step with what is actually on the page.
  const [navNames, setNavNames] = useState<string[]>([])
  function readNavNames() {
    setNavNames(slideEls().map((el, i) => {
      const n = el.querySelector('[data-nav]')
      const v = n ? String(n.getAttribute('data-nav') || '') : ''
      return v || (i === 0 ? 'Cover' : 'Slide ' + (i + 1))
    }))
  }
  function enterPresent() {
    setEdit(false); setAiKey(null); setPicker(false)
    setPresent(true); setSlide(0)
    setTimeout(readNavNames, 60)
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

  // ANSWERS SAVE THEMSELVES. They are typed mid-sentence on a call, often while presenting, where
  // no toolbar is on screen — so a question answered and never saved is the one failure this
  // document cannot have. Debounced, and deliberately NOT save(): that one flips you into edit
  // mode, which would drop a presenter out of their slideshow.
  const cRef = useRef<Any>(c)
  cRef.current = c
  const askTimer = useRef<Any>(null)
  const [askSaved, setAskSaved] = useState(false)
  function answerChanged() {
    if (!canEdit) return
    if (askTimer.current) clearTimeout(askTimer.current)
    askTimer.current = setTimeout(async () => {
      try {
        const r = await fetch('/api/reports', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: initial.id, content: cRef.current }),
        })
        const d = await r.json()
        if (d?.ok) { setAskSaved(true); setTimeout(() => setAskSaved(false), 1800) }
      } catch { /* the next keystroke tries again */ }
    }, 1200)
  }
  function setAnswer(section: string, i: number, v: string) {
    patch(section + '.asks.' + i + '.a', v)
    answerChanged()
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
    const logoData = await fetchImageDataUrl(mark.logo).catch(() => null)
    return buildPptx((window as Any).PptxGenJS, c, t, heroData, logoData)
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
  // THE NEXT SEASON SECTION BELONGS TO THE PROJECTION REPORT, NOT THE OWNER REVIEW (Jon,
  // 2026-09-08). Reports generated before today still carry the projection content in their
  // stored JSON, so gating on the report's kind — not on whether the data exists — is what
  // actually clears it from the reviews already out there. Older projection reports predate
  // meta.kind, so their hero label stands in for it.
  const isOnboarding = String((c.meta || {}).kind || '') === 'onboarding'
  // THE MARK, ON EVERY OWNER-FACING REPORT (Jon, 2026-09-16: "here our logo, brand all our owner
  // facing reports"). One asset in /public, used by the review, the projection and the onboarding
  // alike; a report can still override it from its own content. The file is black ink on
  // transparency, so on the dark themes it is inverted to white rather than swapped for a second
  // asset that would then have to be kept in step.
  const darkGround = (() => {
    const h = String(t.bg || '#ffffff').replace('#', '')
    if (h.length < 6) return false
    const n = parseInt(h.slice(0, 6), 16)
    const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
    return lum < 0.45
  })()
  const mark = {
    logo: String((c.meta || {}).logoUrl || '/stay-logo.png'),
    word: String((c.meta || {}).wordmark || 'STAY HOSPITALITY'),
    style: (darkGround ? { filter: 'invert(1) brightness(1.9)' } : undefined) as Any,
  }
  const isProjectionReport = String((c.meta || {}).kind || '') === 'projection'
    || /SEASON PROJECTION/i.test(String((c.hero || {}).dateLabel || ''))
  const projection = isProjectionReport ? (c.projection || null) : null
  const voices = c.voices || {}
  const projects = c.projects || {}
  const footer = (hero.title || '') + '  ·  ' + (hero.dateLabel || 'OWNER REVIEW')
  const customSecs: Any[] = (Array.isArray(c.custom) ? c.custom : []).filter((cs: Any) => cs && (String(cs.title || '').trim() || String(cs.body || '').trim()))
  // JON'S EIGHT, PLUS ANY EXTRA SWITCHED BACK ON (see the onboarding block below). Present mode
  // counts slides off this, so a deck with the extras off says "6 of 8" and not "6 of 17".
  const onboardingSectionKeys = ['welcome', 'agenda', 'team', 'overview', 'listings', 'guesty', 'statement', 'notes',
    'unit', 'strategy', 'ramp', 'season', 'tech', 'money', 'comms', 'checklist', 'nextup']
  const onboardingListingSlides = isOnboarding && !isHidden('listings')
    ? (Array.isArray((c.listings || {}).items) ? (c.listings as Any).items.length : 0)
    : 0
  const presentCount = isOnboarding
    ? 1 + onboardingSectionKeys.filter(k => !isHidden(k)).length + onboardingListingSlides + customSecs.length
    : ((['hero', 'snapshot',
    (c.pacing ? 'pacing' : null),
    (plan ? 'plan' : null),
    ((c.statement && ((Array.isArray(c.statement.kpis) && c.statement.kpis.length) || (Array.isArray(c.statement.items) && c.statement.items.length))) ? 'statement' : null),
    'ahead', 'voices', 'projects'] as (string | null)[])
    .filter(k => !!k && (k === 'hero' || !isHidden(k as string))).length + customSecs.length)

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
        /* The onboarding document breathes more than a report: it is read one section at a time,
           out loud, on a call. */
        .onb-sec { padding-top: 5.5rem; }
        /* The cover is the first thing an owner sees and the only slide that is allowed to be
           loud. It fills the glass when presenting and stays a tall card when read as a page. */
        .onb-cover { min-height: 460px; }
        .onb-cover-in { min-height: 460px; }
        .onb-more > summary { list-style: none; }
        .onb-more > summary::-webkit-details-marker { display: none; }
        .onb-more > summary::before { content: '+ '; }
        .onb-more[open] > summary::before { content: '– '; }
        @media (max-width: 860px) { .onb-team { grid-template-columns: 1fr 1fr !important; } }
        .sb-navbar { scrollbar-width: none; }
        .sb-navbar::-webkit-scrollbar { display: none; }
        .sb-report .onb-sec { padding-bottom: 0.5rem; }
        .onb-link { text-decoration: none; border-bottom: 1px solid transparent; }
        .onb-link:hover { border-bottom-color: currentColor; }
        .onb-live:hover { background: ${t.chip} !important; }
        .onb-live:focus { background: ${t.card} !important; border-color: ${t.accent} !important; outline: none; }
        .onb-ask:focus { outline: none; border-bottom-color: ${t.accent} !important; }
        @media (max-width: 680px) {
          .onb-row { grid-template-columns: 1fr !important; }
          .onb-strip { grid-template-columns: 1fr 1fr !important; }
          .onb-cover, .onb-cover-in { min-height: 380px; }
          .onb-team { grid-template-columns: 1fr 1fr !important; }
          .onb-shots { grid-template-columns: 1fr 1fr !important; }
          .onb-shots img { grid-row: auto !important; aspect-ratio: 4 / 3 !important; }
        }
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
        /* SNAP ON PROXIMITY, NOT MANDATORY (Jon, 2026-09-16: "present mode moves seamlessly
           through the sections without cutting anything off"). Mandatory snapping pins the
           viewport to a slide's start, so any section TALLER than the glass — a listing review
           with five photos, the statement, a long checklist — simply could not be scrolled into;
           its bottom was unreachable. Proximity keeps the slide-to-slide feel for sections that
           fit and lets the tall ones scroll like a page. */
        .sb-present { position: fixed; inset: 0; height: 100vh; width: 100vw; overflow-y: scroll; scroll-snap-type: y proximity; scroll-behavior: smooth; z-index: 40; background: ${t.bg}; -ms-overflow-style: none; scrollbar-width: none; }
        .sb-present::-webkit-scrollbar { display: none; }
        .sb-present > section, .sb-present > header { min-height: 100vh; display: flex; flex-direction: column; justify-content: center; scroll-snap-align: start; scroll-snap-stop: normal; padding: 6vh 7vw; box-sizing: border-box; border: 0 !important; margin: 0 !important; }
        /* A slide taller than the glass stops centring — otherwise its first line sits above the
           top edge with nothing to scroll back to. */
        .sb-present > section > * { max-height: none; }
        .sb-present > header { padding: 0 !important; }
        .sb-present > header > .relative, .sb-present > header > div { padding: 0 !important; }
        .sb-present .onb-cover { min-height: 100vh; border-radius: 0 !important; }
        .sb-present .onb-cover-in { min-height: 100vh; padding: 8vh 7vw; }
        @supports (height: 100dvh) { .sb-present > section:has(> .onb-sec) { justify-content: safe center; } }
        .sb-present .onb-sec > .onb-head h2 { font-size: clamp(26px, 2.5vw, 36px); }
        .sb-present .onb-lead { max-height: 34vh; }
        .sb-present .onb-strip img { max-height: 15vh; }
        .sb-present .onb-team img, .sb-present .onb-team > div > div:first-child { max-height: 20vh; }
        .sb-present .onb-shots img { max-height: 28vh; }
        .sb-present .onb-shot img, .sb-present .onb-shot > div { max-height: 26vh; aspect-ratio: auto !important; }
        .sb-present .onb-sec > *:first-child { margin-top: 0; }
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
        .sb-present .onb-sec { padding-top: 0 !important; }
        .sb-present header img { height: auto !important; max-height: 42vh !important; width: 100%; object-fit: cover; border-radius: 18px; }
        .sb-present img { object-fit: cover; }
      `}</style>

      {/* Presenting an onboarding: the mark sits on every slide, top-left, quietly. */}
      {present && (
        <div className="sb-noprint fixed top-5 left-6 z-[55] pointer-events-none">
          {mark.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mark.logo} alt={mark.word} style={{ height: 22, width: 'auto', objectFit: 'contain', opacity: 0.75, ...(mark.style || {}) }} />
          ) : (
            <span className="text-[9.5px] font-bold" style={{ color: t.muted, letterSpacing: '0.36em' }}>{mark.word}</span>
          )}
        </div>
      )}

      {/* Answers save themselves; say so once, briefly, so a presenter can trust it. */}
      {askSaved && (
        <div className="sb-noprint fixed bottom-5 right-5 z-[65] rounded-full px-3.5 py-2 text-[12px] font-semibold shadow-lg"
          style={{ background: t.card, border: '1px solid ' + t.toolbarBorder, color: t.good }}>
          <Check size={12} className="inline -mt-0.5 mr-1" /> Answer saved
        </div>
      )}

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
          {isOnboarding && navNames.length ? (
            <div className="sb-navbar fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-1 rounded-full px-2 py-1.5 shadow-lg max-w-[92vw] overflow-x-auto" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
              {navNames.map((n, i) => (
                <button key={i} onClick={() => goTo(i)}
                  className="rounded-full px-3 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors"
                  style={i === slide ? { background: t.ink, color: t.bg } : { color: t.sub }}>
                  {n}
                </button>
              ))}
            </div>
          ) : (
          <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 rounded-full px-3 py-2 shadow-lg" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
            {Array.from({ length: presentCount }).map((_x, i) => (
              <button key={i} onClick={() => goTo(i)} className="rounded-full transition-all" style={{ width: i === slide ? 22 : 8, height: 8, background: i === slide ? t.accent : t.toolbarBorder }} />
            ))}
          </div>
          )}
        </>
      )}

      <div ref={scrollRef} onScroll={onPresentScroll} className={present ? 'sb-present' : 'sb-report max-w-4xl mx-auto px-5 sm:px-8 pb-20'}>

        {/* ---------- COVER ---------- */}
        {/* AN ONBOARDING OPENS ON THEIR PROPERTY, NOT ON OUR LOGO. The review report's cover — a
            centred mark on cream with a photo tucked underneath — is right for a monthly
            performance document and wrong for the first slide of a meeting. The owner has just
            handed us an asset; the first thing on the screen should be that asset, full-bleed,
            with their name on it. Everything else on this slide is small and white. */}
        {isOnboarding ? (
          <header className="relative pt-8 pb-10">
            {edit && (
              <button onClick={() => openAi('hero')} className="sb-noprint absolute top-2 right-2 z-10 inline-flex items-center gap-1 rounded-full shadow px-2.5 py-1 text-[11px] font-semibold" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder, color: t.accent }}>
                <Sparkles size={11} /> AI
              </button>
            )}
            <div className="onb-cover relative overflow-hidden rounded-3xl" style={{ background: t.band }}>
              {hero.heroImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={hero.heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
              ) : null}
              <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(8,11,16,0.58) 0%, rgba(8,11,16,0.28) 26%, rgba(8,11,16,0.62) 64%, rgba(8,11,16,0.93) 100%)' }} />
              <div className="onb-cover-in relative flex flex-col px-7 sm:px-11 pt-9 pb-9">
                {mark.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mark.logo} alt={mark.word} style={{ height: 34, width: 'auto', objectFit: 'contain', filter: 'invert(1) brightness(2.2)' }} />
                ) : (
                  <p className="text-[11px] font-bold" style={{ color: '#fff', letterSpacing: '0.42em' }}>{mark.word}</p>
                )}
                <div className="mt-auto pt-16">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.26em]" style={{ color: 'rgba(255,255,255,0.72)' }}>
                    <Ed v={hero.dateLabel || 'OWNER ONBOARDING'} set={v => patch('hero.dateLabel', v)} edit={edit} />
                  </p>
                  <h1 className="mt-3 text-[34px] sm:text-[46px] font-semibold tracking-[-0.025em] leading-[1.05]" style={{ color: '#fff', maxWidth: '18ch' }}>
                    <Ed v={hero.title || ''} set={v => patch('hero.title', v)} edit={edit} />
                  </h1>
                  <p className="mt-4 text-[16px] sm:text-[18px] leading-[1.5]" style={{ color: 'rgba(255,255,255,0.86)', maxWidth: '42ch' }}>
                    <Ed v={hero.headline || ''} set={v => patch('hero.headline', v)} edit={edit} multiline />
                  </p>
                  <p className="mt-7 text-[11.5px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    <Ed v={hero.preparedFor || ''} set={v => patch('hero.preparedFor', v)} edit={edit} />
                    {'  ·  '}{meta.asOf ? new Date(String(meta.asOf) + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''}
                  </p>
                </div>
              </div>
              {/* AND A WAY TO CHANGE IT. Guesty's first picture is whatever the last person
                  uploaded first — for this owner it is a four-up amenity collage, which is the
                  one thing a cover must not be. Same cycler the sections have, so the cover is
                  chosen in the room in two clicks. */}
              {canEdit && (() => {
                const cpool: string[] = Array.isArray(c.photoPool) ? c.photoPool : []
                if (!cpool.length) return null
                const cur = String(hero.heroImage || '')
                const step = (d: number) => {
                  const ix = cpool.indexOf(cur)
                  patch('hero.heroImage', cpool[(ix + d + cpool.length + (ix < 0 ? 1 : 0)) % cpool.length])
                  answerChanged()
                }
                return (
                  <div className="sb-noprint absolute bottom-4 right-4 flex items-center gap-1.5">
                    <button onClick={() => step(-1)} className="rounded-full px-2.5 py-1.5 text-[11px] font-semibold shadow" style={{ background: 'rgba(255,255,255,0.92)', color: '#111' }}>&#8592;</button>
                    <button onClick={() => step(1)} className="rounded-full px-3 py-1.5 text-[11px] font-semibold shadow" style={{ background: 'rgba(255,255,255,0.92)', color: '#111' }}>Change cover photo</button>
                  </div>
                )
              })()}
            </div>
          </header>
        ) : (
        <header className="relative pt-14 pb-12 text-center border-b" style={{ borderColor: t.rule }}>
          {edit && (
            <button onClick={() => openAi('hero')} className="absolute top-4 right-4 inline-flex items-center gap-1 rounded-full shadow px-2.5 py-1 text-[11px] font-semibold" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder, color: t.accent }}>
              <Sparkles size={11} /> AI
            </button>
          )}
          {/* THE MARK (Jon, 2026-09-16: "with our Stay logo"). An image when one is set on the
              house template, otherwise the letterspaced wordmark this company's owner-facing
              documents already use. Set logoUrl in the onboarding template and it swaps here,
              on every presented slide, and on nothing else. */}
          {mark.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mark.logo} alt={mark.word} className="mx-auto mb-8" style={{ height: 46, width: 'auto', objectFit: 'contain', ...(mark.style || {}) }} />
          ) : (
            <p className="mb-8 text-[12px] font-bold" style={{ color: t.ink, letterSpacing: '0.42em' }}>{mark.word}</p>
          )}
          {(hero.eyebrow || edit) ? <Eyebrow>{hero.eyebrow || ''}</Eyebrow> : null}
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
        )}


        {/* ═══════════ OWNER ONBOARDING — the welcome presentation ═══════════
            A different document on the same rails: same row, same share link, same editor,
            themes, PPTX and Present mode. Sections come from lib/onboarding-report, which merges
            the house template (settings) with this owner's facts at generate time.

            EIGHT SECTIONS, AND NO INTAKE (Jon, 2026-09-16: "1. Agenda: Welcome to Stay
            Hospitality with a picture 2. What we're going to cover 3. Meet the team 4. Overview
            of Stay Hospitality 5. Review listing 6. Guesty owner portal with photos, etc.
            7. Guesty owner statements 8. Other notes").

            AND IT IS A DECK, NOT A DOCUMENT (Jon, 2026-09-16: "looks noisy and loud… think
            visual, think flow, think functionality"). Three rules hold this layout up:

            1. ONE IDEA PER SECTION, AND THE PICTURE CARRIES IT. The owner's own photographs are
               the most persuasive thing we have — it is their property, and they are proud of it.
               They lead; the words follow at reading size.
            2. INK IS EARNED. The old version shouted eight times: a tracked uppercase eyebrow, a
               38px black headline and a subtitle, on every section, plus accent-coloured labels
               on every field. Now there is one quiet line, one heading at a normal weight, and
               the accent is reserved for things you can click.
            3. THE PRESENTER HAS TO BE ABLE TO DRIVE IT. An owner interrupts to ask how they get
               paid; scrolling past four sections to find it is what makes a deck feel amateur.
               Every section carries data-nav, and present mode turns that into a named jump. */}
        {isOnboarding && (() => {
          const sec = (k: string) => (c[k] || {})
          // A DECK GENERATED BEFORE THIS RESTRUCTURE HAS NO `overview` AND NO `notes`, and its
          // `omit` is empty, so every retired section would come back. Treating a missing section
          // object as hidden means the old drafts still read straight instead of printing empty
          // headings; regenerating gives them the full eight.
          const hid = (k: string) => isHidden(k) || !c[k] || typeof c[k] !== 'object'
          const CORE: { k: string; label: string }[] = [
            { k: 'welcome', label: 'Welcome' },
            { k: 'agenda', label: 'What we will cover' },
            { k: 'team', label: 'Meet the team' },
            { k: 'overview', label: 'About Stay Hospitality' },
            { k: 'listings', label: 'Your listing' },
            { k: 'guesty', label: 'Your owner portal' },
            { k: 'statement', label: 'Your statements' },
            { k: 'notes', label: 'Other notes' },
          ]
          const EXTRA: { k: string; label: string }[] = [
            { k: 'unit', label: 'Your unit' }, { k: 'strategy', label: 'Goals & strategy' },
            { k: 'ramp', label: 'The ramp' }, { k: 'season', label: 'Seasonality' },
            { k: 'tech', label: 'Your tech' }, { k: 'money', label: 'Billables' },
            { k: 'comms', label: 'Communication' }, { k: 'checklist', label: 'Still to do' },
            { k: 'nextup', label: 'What happens next' },
          ]
          const askSecs = CORE.concat(EXTRA)
          const open: { label: string; q: string }[] = []
          for (const x of askSecs) {
            if (hid(x.k)) continue
            const as: Any[] = Array.isArray(sec(x.k).asks) ? sec(x.k).asks : []
            for (const a of as) if (!String(a.a || '').trim()) open.push({ label: x.label, q: a.q })
          }
          const answered = askSecs.reduce((n, x) => n + (hid(x.k) ? 0 : (sec(x.k).asks || []).filter((a: Any) => String(a.a || '').trim()).length), 0)
          const totalAsks = answered + open.length
          const extraOn = EXTRA.filter(x => !hid(x.k))
          const running = CORE.filter(x => !hid(x.k))
            .concat(extraOn.filter(x => ['unit', 'strategy', 'ramp', 'season', 'tech'].indexOf(x.k) >= 0))
          const numOf = (k: string) => {
            const i = running.findIndex(x => x.k === k)
            return i < 0 ? '' : String(i + 1).padStart(2, '0')
          }

          // ONE QUIET LINE, ONE HEADING. No rule, no accent, no uppercase.
          const Head = ({ k, label }: { k: string; label: string }) => (
            <div className="onb-head">
              <p className="text-[12px] font-medium tabular-nums" style={{ color: t.muted }}>
                {(() => {
                  const n = numOf(k)
                  const h = String(sec(k).headline || '').toLowerCase()
                  const l = label.toLowerCase()
                  // "03  Meet the team" directly above "Meet the team" is the page saying the
                  // same thing twice in two sizes — exactly the noise this pass removes.
                  const dupe = !!h && (h.indexOf(l) >= 0 || l.indexOf(h) >= 0)
                  return n ? (dupe ? n : n + '\u2003' + label) : (dupe ? '' : label)
                })()}
              </p>
              <h2 className="mt-4 text-[26px] sm:text-[31px] font-semibold tracking-[-0.018em] leading-[1.16]" style={{ color: t.ink, maxWidth: '22ch' }}>
                <Ed v={sec(k).headline || ''} set={v => patch(k + '.headline', v)} edit={edit} multiline />
              </h2>
              {(sec(k).subtitle || edit) ? (
                <p className="mt-3 text-[15px] leading-[1.6]" style={{ color: t.muted, maxWidth: '56ch' }}>
                  <Ed v={sec(k).subtitle || ''} set={v => patch(k + '.subtitle', v)} edit={edit} multiline />
                </p>
              ) : null}
            </div>
          )

          const pool: string[] = Array.isArray(c.photoPool) ? c.photoPool : []
          const Shot = ({ k, ratio }: { k: string; ratio?: string }) => {
            const cur = String(sec(k).photo || '')
            if (!cur && !edit) return null
            const step = (d: number) => {
              if (!pool.length) return
              const i = pool.indexOf(cur)
              patch(k + '.photo', pool[(i + d + pool.length + (i < 0 ? 1 : 0)) % pool.length])
            }
            return (
              <div className="onb-shot relative mt-9">
                {cur ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cur} alt="" className="w-full object-cover rounded-2xl" style={{ aspectRatio: ratio || '21 / 9' }} />
                ) : (
                  <div className="w-full rounded-2xl flex items-center justify-center text-[12px]" style={{ aspectRatio: ratio || '21 / 9', background: t.chip, color: t.muted }}>
                    No photo on this section
                  </div>
                )}
                {edit && (
                  <div className="sb-noprint absolute bottom-3 right-3 flex items-center gap-1.5">
                    <button onClick={() => step(-1)} className="rounded-full px-2 py-1 text-[11px] font-semibold shadow" style={{ background: t.card, color: t.ink }}>&#8592;</button>
                    <button onClick={() => step(1)} className="rounded-full px-2.5 py-1 text-[11px] font-semibold shadow" style={{ background: t.card, color: t.ink }}>
                      {cur ? 'Next photo' : 'Add photo'}
                    </button>
                    {cur && <button onClick={() => patch(k + '.photo', '')} className="rounded-full px-2 py-1 text-[11px] font-semibold shadow" style={{ background: t.card, color: t.accent }}>Clear</button>}
                  </div>
                )}
              </div>
            )
          }

          // A strip of their own rooms, used where a section needs air rather than another photo
          // the size of a billboard. Offset so it never repeats the section's own Shot.
          const Strip = ({ from, n }: { from: number; n: number }) => {
            if (pool.length < n) return null
            const pics = Array.from({ length: n }, (_x, i) => pool[(from + i) % pool.length])
            return (
              <div className="onb-strip mt-9 grid gap-2.5" style={{ gridTemplateColumns: 'repeat(' + n + ',1fr)' }}>
                {pics.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={src} alt="" className="w-full object-cover rounded-xl" style={{ aspectRatio: '4 / 3' }} />
                ))}
              </div>
            )
          }

          const Note = ({ k }: { k: string }) => {
            const has = !!String(sec(k).note || '').trim()
            if (!has && !canEdit) return null
            return (
              <div className="mt-9 pl-5" style={{ borderLeft: '2px solid ' + (has ? t.rule : t.chip) }}>
                <p className="text-[12px] mb-1.5" style={{ color: t.muted }}>Notes</p>
                <LiveText v={String(sec(k).note || '')} live={canEdit} t={t}
                  set={v => { patch(k + '.note', v); answerChanged() }} />
              </div>
            )
          }

          const Body = ({ k, field }: { k: string; field?: string }) => (
            <p className="mt-8 text-[16px] leading-[1.75] whitespace-pre-line" style={{ color: t.body, maxWidth: '62ch' }}>
              <Ed v={sec(k)[field || 'body'] || ''} set={v => patch(k + '.' + (field || 'body'), v)} edit={edit} multiline />
            </p>
          )

          // Label/value pairs. The label is a quiet semibold, not a tracked capital — twelve of
          // those in a column is the single loudest thing a page can do.
          const Rows = ({ rows, kw }: { rows: Any[]; kw?: string }) => (
            <div className="mt-8">
              {(rows || []).map((r: Any, i: number) => (
                <div key={i} className="onb-row grid gap-x-8 gap-y-1.5 py-4 border-t" style={{ borderColor: t.rule, gridTemplateColumns: (kw || '190px') + ' 1fr' }}>
                  <div className="text-[13.5px] font-semibold pt-px" style={{ color: t.sub }}>{r.k}</div>
                  <div className="text-[15px] leading-[1.7]" style={{ color: t.body }}>{r.v}</div>
                </div>
              ))}
            </div>
          )

          const Asks = ({ k }: { k: string }) => {
            const as: Any[] = Array.isArray(sec(k).asks) ? sec(k).asks : []
            if (!as.length) return null
            return (
              <div className="mt-12 pt-8 border-t" style={{ borderColor: t.rule }}>
                <p className="text-[12px] mb-5" style={{ color: t.muted }}>On the call</p>
                <div className="flex flex-col gap-5">
                  {as.map((a: Any, i: number) => (
                    <AskBlock key={a.id || i} ask={a} live={canEdit} t={t} set={v => setAnswer(k, i, v)} />
                  ))}
                </div>
              </div>
            )
          }

          /* THE LISTING SLIDE. A guest meets this property as a photograph and then as a
             sentence, in that order, so that is the order it is reviewed in: one large frame,
             a strip of the rest, then the words at reading size with a quiet label above each.
             The words stay editable without entering edit mode — you fix a line while you are
             reading it out loud, which is the only moment anyone ever actually fixes it. */
          const COPY = [
            { f: 'title', l: 'Listing title', cap: 50 },
            { f: 'summary', l: 'Summary' },
            { f: 'space', l: 'The space' },
          ]

          const ListingBlock = ({ L, li }: { L: Any; li: number }) => {
            const pics: string[] = (L.photos || []).slice(0, 5)
            return (
              <div key={L.id || li}>
                <div className="flex items-end justify-between gap-6 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-[18px] font-semibold tracking-[-0.01em]" style={{ color: t.ink }}>{L.name}</p>
                    <p className="text-[13px] mt-1" style={{ color: t.muted }}>{L.sub}</p>
                  </div>
                  {(L.links || []).length > 0 && (
                    <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                      {(L.links || []).map((k: Any) => (
                        <a key={k.name} href={k.url} target="_blank" rel="noopener noreferrer"
                          className="text-[13px] font-medium onb-link" style={{ color: t.accent }}>{k.name} &#8599;</a>
                      ))}
                    </div>
                  )}
                </div>

                {pics.length > 0 && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pics[0]} alt="" className="onb-lead mt-5 w-full object-cover rounded-2xl" style={{ aspectRatio: '16 / 9' }} />
                    {pics.length > 1 && (
                      <div className="onb-strip mt-2.5 grid gap-2.5" style={{ gridTemplateColumns: 'repeat(' + Math.min(4, pics.length - 1) + ',1fr)' }}>
                        {pics.slice(1, 5).map((src: string, pi: number) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={pi} src={src} alt="" className="w-full object-cover rounded-xl" style={{ aspectRatio: '4 / 3' }} />
                        ))}
                      </div>
                    )}
                  </>
                )}

                <div className="mt-10 flex flex-col gap-8">
                  {COPY.map(F => {
                    const val = String(L[F.f] || '')
                    const over = !!F.cap && val.length > F.cap
                    return (
                      <div key={F.f}>
                        <p className="text-[12px] mb-2" style={{ color: t.muted }}>
                          {F.l}{over ? <span style={{ color: t.gold }}>{' · ' + val.length + ' of ' + F.cap + ' characters'}</span> : null}
                        </p>
                        {F.f === 'title' ? (
                          <LiveText v={val} live={canEdit} t={t} single
                            ro="text-[19px] sm:text-[21px] font-medium leading-[1.3]"
                            cls="onb-live w-full text-[19px] sm:text-[21px] font-medium leading-[1.3] rounded-lg px-3 py-1.5 -mx-3"
                            set={v => { patch('listings.items.' + li + '.' + F.f, v); answerChanged() }} />
                        ) : (
                          <LiveText v={val} live={canEdit} t={t}
                            ro="text-[16px] leading-[1.8] whitespace-pre-line"
                            cls="onb-copy w-full text-[16px] leading-[1.8] rounded-lg px-3 py-2 -mx-3"
                            set={v => { patch('listings.items.' + li + '.' + F.f, v); answerChanged() }} />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          }

          return (
            <>
              {/* ---------- 1 · WELCOME ---------- */}
              <SectionShell id="welcome" title="Welcome" hidden={hid('welcome')} edit={edit} onToggle={() => toggleSection('welcome')} onAi={() => openAi('welcome')}>
                <div className="onb-sec" data-nav="Welcome">
                  <Head k="welcome" label="Welcome" />
                  <p className="mt-8 text-[18px] leading-[1.65] whitespace-pre-line" style={{ color: t.body, maxWidth: '50ch' }}>
                    <Ed v={sec('welcome').body || ''} set={v => patch('welcome.body', v)} edit={edit} multiline />
                  </p>
                  <Shot k="welcome" ratio="16 / 9" />
                  <Note k="welcome" />
                </div>
              </SectionShell>

              {/* ---------- 2 · WHAT WE WILL COVER ---------- */}
              {/* Two columns on a wide screen: eight agenda lines in one narrow column is a
                  scroll, and an agenda you have to scroll is not an agenda. */}
              <SectionShell id="agenda" title="What we will cover" hidden={hid('agenda')} edit={edit} onToggle={() => toggleSection('agenda')}>
                <div className="onb-sec" data-nav="Agenda">
                  <Head k="agenda" label="What we will cover" />
                  <div className="onb-agenda mt-9 grid gap-x-12 gap-y-0" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
                    {(sec('agenda').items || []).map((it: Any, i: number) => (
                      <div key={i} className="grid gap-x-5 py-4 border-t items-baseline" style={{ borderColor: t.rule, gridTemplateColumns: '26px 1fr' }}>
                        <span className="text-[12px] tabular-nums" style={{ color: t.muted }}>{String(i + 1).padStart(2, '0')}</span>
                        <div>
                          <p className="text-[15.5px] font-semibold" style={{ color: t.ink }}>
                            <Ed v={it.k || ''} set={v => patch('agenda.items.' + i + '.k', v)} edit={edit} />
                          </p>
                          <p className="text-[14px] mt-1 leading-[1.6]" style={{ color: t.muted }}>
                            <Ed v={it.v || ''} set={v => patch('agenda.items.' + i + '.v', v)} edit={edit} multiline />
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {edit && (
                    <button onClick={() => mutate(d => { d.agenda.items = Array.isArray(d.agenda.items) ? d.agenda.items : []; d.agenda.items.push({ k: 'New line', v: '' }) })}
                      className="mt-6 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold"
                      style={{ background: t.card, border: '1px dashed ' + t.cardBorder, color: t.sub }}>
                      <Plus size={12} /> Add a line
                    </button>
                  )}
                  <Note k="agenda" />
                </div>
              </SectionShell>

              {/* ---------- 3 · MEET THE TEAM ---------- */}
              {/* Four people, four faces, four direct lines. Not a directory — the point of this
                  slide is that the owner leaves the call able to picture who walks into the unit. */}
              <SectionShell id="team" title="Meet the team" hidden={hid('team')} edit={edit} onToggle={() => toggleSection('team')}>
                <div className="onb-sec" data-nav="The team">
                  <Head k="team" label="Meet the team" />
                  <div className="onb-team mt-10 grid gap-x-9 gap-y-10" style={{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
                    {(sec('team').people || []).map((p: Any, pi: number) => (
                      <div key={pi}>
                        {p.photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.photo} alt="" className="rounded-2xl object-cover mb-4 w-full" style={{ aspectRatio: '1 / 1' }} />
                        ) : (
                          <div className="rounded-full mb-4 flex items-center justify-center text-[15px] font-semibold"
                            style={{ width: 46, height: 46, background: t.chip, color: t.sub }}>
                            {String(p.name || '?').trim().split(/\s+/).slice(0, 2).map((w: string) => w[0]).join('')}
                          </div>
                        )}
                        <p className="text-[16px] font-semibold tracking-[-0.01em]" style={{ color: t.ink }}>
                          <Ed v={p.name || ''} set={v => patch('team.people.' + pi + '.name', v)} edit={edit} />
                        </p>
                        <p className="text-[13px] mt-0.5 mb-2.5" style={{ color: t.muted }}>
                          <Ed v={p.role || ''} set={v => patch('team.people.' + pi + '.role', v)} edit={edit} />
                        </p>
                        <p className="text-[14px] leading-[1.65]" style={{ color: t.body }}>
                          <Ed v={p.blurb || ''} set={v => patch('team.people.' + pi + '.blurb', v)} edit={edit} multiline placeholder="What they do for this owner&hellip;" />
                        </p>
                        {(p.phone || p.email || edit) && (
                          <div className="mt-2.5 flex flex-col gap-0.5 text-[13px]" style={{ color: t.sub }}>
                            {(p.phone || edit) && <span><Ed v={p.phone || ''} set={v => patch('team.people.' + pi + '.phone', v)} edit={edit} placeholder="Direct line" /></span>}
                            {(p.email || edit) && <span><Ed v={p.email || ''} set={v => patch('team.people.' + pi + '.email', v)} edit={edit} placeholder="Email" /></span>}
                          </div>
                        )}
                        {edit && (
                          <button onClick={() => mutate(d => { d.team.people.splice(pi, 1) })} className="mt-2 text-[11px] font-semibold" style={{ color: t.accent }}>Remove</button>
                        )}
                      </div>
                    ))}
                  </div>
                  {edit && (
                    <button
                      onClick={() => mutate(d => { d.team.people = Array.isArray(d.team.people) ? d.team.people : []; d.team.people.push({ name: 'Name', role: 'Role', blurb: '', photo: null, phone: '', email: '' }) })}
                      className="mt-7 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold"
                      style={{ background: t.card, border: '1px dashed ' + t.cardBorder, color: t.sub }}>
                      <Plus size={12} /> Add person
                    </button>
                  )}
                  <Note k="team" />
                </div>
              </SectionShell>

              {/* ---------- 4 · ABOUT STAY HOSPITALITY ---------- */}
              {/* One sentence at speaking size, one paragraph under it, four numbers on a
                  hairline. That is the whole slide — a company overview that runs longer than
                  this is about us, and the owner did not come to hear about us. */}
              <SectionShell id="overview" title="About Stay Hospitality" hidden={hid('overview')} edit={edit} onToggle={() => toggleSection('overview')} onAi={() => openAi('overview')}>
                <div className="onb-sec" data-nav="About Stay">
                  <Head k="overview" label="About Stay Hospitality" />
                  {(() => {
                    const full = String(sec('overview').body || '')
                    const cut = full.indexOf('\n\n')
                    const lead = cut > 0 ? full.slice(0, cut) : full
                    const rest = cut > 0 ? full.slice(cut + 2) : ''
                    if (edit) return <Body k="overview" />
                    return (
                      <>
                        <p className="mt-8 text-[19px] sm:text-[20px] leading-[1.6] whitespace-pre-line" style={{ color: t.body, maxWidth: '46ch' }}>{lead}</p>
                        {rest ? (
                          <p className="mt-5 text-[15.5px] leading-[1.75] whitespace-pre-line" style={{ color: t.muted, maxWidth: '58ch' }}>{rest}</p>
                        ) : null}
                      </>
                    )
                  })()}
                  {(sec('overview').stats || []).length > 0 && (
                    <div className="mt-11 pt-9 grid gap-y-8 gap-x-10 border-t" style={{ borderColor: t.rule, gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
                      {(sec('overview').stats || []).map((f: Any, i: number) => (
                        <div key={i}>
                          <p className="text-[18px] sm:text-[19px] font-semibold tracking-[-0.015em] leading-[1.3]" style={{ color: t.ink }}>
                            <Ed v={f.v || ''} set={v => patch('overview.stats.' + i + '.v', v)} edit={edit} multiline />
                          </p>
                          <p className="text-[12.5px] mt-1.5" style={{ color: t.muted }}>
                            <Ed v={f.k || ''} set={v => patch('overview.stats.' + i + '.k', v)} edit={edit} />
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  <Strip from={7} n={3} />
                  <Note k="overview" />
                </div>
              </SectionShell>

              {/* ---------- 5 · YOUR LISTING ---------- */}
              <SectionShell id="listings" title="Your listing" hidden={hid('listings')} edit={edit} onToggle={() => toggleSection('listings')}>
                <div className="onb-sec" data-nav="Your listing">
                  <Head k="listings" label="Your listing" />
                  {/* ONE UNIT PER SLIDE WHEN PRESENTING. Six units stacked in one section made a
                      single 8,000px slide — technically scrollable, useless to present from. On
                      the page they stay together; on a call each unit gets the screen to itself. */}
                  {!present && (
                    <div className="mt-10 flex flex-col gap-16">
                      {(sec('listings').items || []).map((L: Any, li: number) => (
                        <ListingBlock key={L.id || li} L={L} li={li} />
                      ))}
                    </div>
                  )}
                  <p className="mt-10 text-[13px] leading-[1.7]" style={{ color: t.muted, maxWidth: '60ch' }}>
                    The copy above is live &mdash; edit it as we read it and it saves itself. Pushing it out to the channels, and setting amenities, happens on the unit page in the dashboard.
                  </p>
                  <Asks k="listings" />
                </div>
              </SectionShell>

              {present && !hid('listings') && (sec('listings').items || []).map((L: Any, li: number) => (
                <section key={'pres-' + (L.id || li)}>
                  <div className="onb-sec" data-nav={String(L.name || 'Unit')}><ListingBlock L={L} li={li} /></div>
                </section>
              ))}

              {/* ---------- 6 · YOUR OWNER PORTAL ---------- */}
              {/* THE ADDRESS IS A HOUSE SETTING, THE LOGIN IS THEIRS. Guesty does not expose a
                  per-owner portal URL — an account gets exactly one `<name>.guestyowners.com`
                  and every owner signs into it with their own email. So the link is the house's,
                  seeded from the onboarding template and correctable here, and the line that IS
                  theirs is the email it belongs to. No box around it: on a call this is one
                  address read out loud, not a form. */}
              <SectionShell id="guesty" title="Your owner portal" hidden={hid('guesty')} edit={edit} onToggle={() => toggleSection('guesty')} onAi={() => openAi('guesty')}>
                <div className="onb-sec" data-nav="Owner portal">
                  <Head k="guesty" label="Your owner portal" />
                  <div className="mt-9 pt-8 border-t" style={{ borderColor: t.ink }}>
                    {canEdit ? (
                      <input
                        value={String(sec('guesty').portalUrl || '')}
                        onChange={e => { patch('guesty.portalUrl', e.target.value); answerChanged() }}
                        placeholder="https://your-name.guestyowners.com"
                        className="onb-live w-full text-[22px] sm:text-[27px] font-medium tracking-[-0.02em] rounded-lg px-3 py-1.5 -mx-3"
                        style={{ color: t.accent, background: 'transparent', border: '1px solid transparent', fontFamily: 'inherit' }}
                      />
                    ) : (
                      <a href={String(sec('guesty').portalUrl || '#')} target="_blank" rel="noopener noreferrer"
                        className="onb-link block text-[22px] sm:text-[27px] font-medium tracking-[-0.02em] break-words"
                        style={{ color: t.accent }}>
                        {String(sec('guesty').portalUrl || '').replace(/^https?:\/\//, '') || 'Portal address to be set'}
                      </a>
                    )}
                    <div className="mt-6 grid gap-x-12 gap-y-5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
                      <div>
                        <p className="text-[12px]" style={{ color: t.muted }}>You sign in as</p>
                        <p className="text-[15.5px] mt-1 break-words" style={{ color: t.ink }}>
                          <Ed v={String(sec('guesty').loginEmail || '')} set={v => patch('guesty.loginEmail', v)} edit={edit} placeholder="owner@email.com" />
                          {!String(sec('guesty').loginEmail || '') && !edit ? <span style={{ color: t.gold }}>the email we set up on this call</span> : null}
                        </p>
                      </div>
                      <div>
                        <p className="text-[12px]" style={{ color: t.muted }}>Password</p>
                        <p className="text-[15.5px] mt-1" style={{ color: t.body }}>You set it from the invite email. We never hold it.</p>
                      </div>
                    </div>
                  </div>
                  <Body k="guesty" />
                  <Rows rows={sec('guesty').items || []} kw="190px" />
                  {/* Portal screenshots from the template, so every owner sees the same tour
                      without anyone re-uploading them. */}
                  {(sec('guesty').shots || []).length > 0 && (
                    <div className="mt-10 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
                      {(sec('guesty').shots || []).map((src: string, si: number) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={si} src={src} alt="" className="w-full object-cover rounded-xl" style={{ border: '1px solid ' + t.cardBorder }} />
                      ))}
                    </div>
                  )}
                  <Shot k="guesty" />
                  <Note k="guesty" />
                </div>
              </SectionShell>

              {/* ---------- 7 · YOUR STATEMENTS ---------- */}
              {/* The worked month first, because a number an owner can follow beats any amount of
                  policy. Then the three rules they will actually repeat afterwards. The full
                  small print sits underneath for the ones who read it — and some do. */}
              <SectionShell id="statement" title="Your statements" hidden={hid('statement')} edit={edit} onToggle={() => toggleSection('statement')}>
                <div className="onb-sec" data-nav="Statements">
                  <Head k="statement" label="Your statements" />
                  <div className="mt-9 rounded-2xl overflow-hidden" style={{ border: '1px solid ' + t.cardBorder }}>
                    <div className="px-6 py-4" style={{ background: t.chip }}>
                      <p className="text-[15.5px] font-semibold" style={{ color: t.ink }}>{sec('statement').unitLabel}</p>
                      <p className="text-[12.5px] mt-0.5" style={{ color: t.muted }}>{sec('statement').period}</p>
                    </div>
                    <div className="px-6 pt-3 pb-5" style={{ background: t.card }}>
                      {(sec('statement').lines || []).map((ln: Any, i: number) => (
                        <div key={i} className="flex justify-between gap-5 py-3 border-b" style={{ borderColor: t.rule }}>
                          <span className="text-[15px]" style={{ color: t.body }}>
                            {ln.k}{ln.sub ? <small className="block text-[12.5px] mt-0.5" style={{ color: t.muted }}>{ln.sub}</small> : null}
                          </span>
                          <span className="text-[15px] font-medium whitespace-nowrap tabular-nums" style={{ color: ln.neg ? t.gold : t.ink }}>{ln.v}</span>
                        </div>
                      ))}
                      <div className="flex justify-between gap-5 pt-4 mt-1" style={{ borderTop: '1px solid ' + t.ink }}>
                        <span className="text-[17px] font-semibold" style={{ color: t.ink }}>Net to you</span>
                        <span className="text-[17px] font-semibold tabular-nums" style={{ color: t.ink }}>{sec('statement').net}</span>
                      </div>
                      <p className="text-[13px] mt-2" style={{ color: t.good }}>{sec('statement').paid}</p>
                    </div>
                    <div style={{ background: t.card, borderTop: '1px solid ' + t.rule }}>
                      <p className="px-6 py-2.5 text-[12px]" style={{ color: t.muted }}>
                        The {sec('statement').chargesTotal} owner charge, in full
                      </p>
                      <div className="lh-hscroll px-6 pb-5">
                        <table className="w-full text-[13.5px]">
                          <thead>
                            <tr>{['Date', 'Work', 'Labor', 'Materials', 'Total'].map((h, i) => (
                              <th key={h} className="text-[11.5px] font-medium pb-2 pr-4 border-b whitespace-nowrap" style={{ color: t.muted, borderColor: t.rule, textAlign: i >= 2 ? 'right' : 'left' }}>{h}</th>
                            ))}</tr>
                          </thead>
                          <tbody>
                            {(sec('statement').charges || []).map((ch: Any, i: number) => (
                              <tr key={i}>
                                <td className="py-3 pr-4 border-b whitespace-nowrap align-top" style={{ borderColor: t.rule, color: t.muted }}>{ch.date}</td>
                                <td className="py-3 pr-4 border-b align-top" style={{ borderColor: t.rule, color: t.body }}>
                                  {ch.work}<small className="block text-[12px] mt-0.5" style={{ color: t.muted }}>{ch.who}</small>
                                </td>
                                <td className="py-3 pr-4 border-b text-right whitespace-nowrap align-top tabular-nums" style={{ borderColor: t.rule, color: t.body }}>{ch.labor}</td>
                                <td className="py-3 pr-4 border-b text-right whitespace-nowrap align-top tabular-nums" style={{ borderColor: t.rule, color: t.body }}>{ch.materials}</td>
                                <td className="py-3 border-b text-right whitespace-nowrap align-top tabular-nums font-medium" style={{ borderColor: t.rule, color: t.ink }}>{ch.total}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* THE THREE AN OWNER REPEATS AFTERWARDS. */}
                  {(sec('statement').highlights || []).length > 0 && (
                    <div className="onb-three mt-10 grid gap-x-10 gap-y-7" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))' }}>
                      {(sec('statement').highlights || []).map((h: Any, i: number) => (
                        <div key={i} className="pt-5 border-t" style={{ borderColor: t.ink }}>
                          <p className="text-[15.5px] font-semibold leading-[1.35]" style={{ color: t.ink }}>
                            <Ed v={h.k || ''} set={v => patch('statement.highlights.' + i + '.k', v)} edit={edit} multiline />
                          </p>
                          <p className="text-[14px] mt-2 leading-[1.65]" style={{ color: t.muted }}>
                            <Ed v={h.v || ''} set={v => patch('statement.highlights.' + i + '.v', v)} edit={edit} multiline />
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="mt-10 text-[15px] leading-[1.75]" style={{ color: t.body, maxWidth: '62ch' }}>
                    <Ed v={sec('statement').note || ''} set={v => patch('statement.note', v)} edit={edit} multiline />
                  </p>

                  {/* The small print, kept and kept quiet. */}
                  {(sec('statement').rules || []).length > 0 && (
                    <details className="onb-more mt-9">
                      <summary className="text-[13.5px] font-medium cursor-pointer" style={{ color: t.sub }}>Every rule behind those lines</summary>
                      <Rows rows={sec('statement').rules || []} kw="200px" />
                      {(sec('statement').also || []).length > 0 && (
                        <>
                          <p className="mt-9 text-[12px]" style={{ color: t.muted }}>Other lines you may see</p>
                          <Rows rows={sec('statement').also || []} kw="200px" />
                        </>
                      )}
                    </details>
                  )}
                  <Note k="statement" />
                </div>
              </SectionShell>

              {/* ══════ SECTIONS THAT ARE OFF BY DEFAULT ══════
                  Built, kept in the document, and rendered only once someone switches them on
                  for this owner. */}
              {!hid('unit') && (
                <SectionShell id="unit" title="Your unit" hidden={false} edit={edit} onToggle={() => toggleSection('unit')} onAi={() => openAi('unit')}>
                  <div className="onb-sec" data-nav="Your unit">
                    <Head k="unit" label="Your unit" />
                    <Body k="unit" />
                    <Rows rows={sec('unit').facts || []} kw="200px" />
                    <Shot k="unit" />
                    <Note k="unit" />
                    <Asks k="unit" />
                  </div>
                </SectionShell>
              )}
              {!hid('strategy') && (
                <SectionShell id="strategy" title="Goals & strategy" hidden={false} edit={edit} onToggle={() => toggleSection('strategy')} onAi={() => openAi('strategy')}>
                  <div className="onb-sec" data-nav="Strategy">
                    <Head k="strategy" label="Goals & strategy" />
                    <Body k="strategy" />
                    <Shot k="strategy" />
                    <Note k="strategy" />
                    <Asks k="strategy" />
                  </div>
                </SectionShell>
              )}
              {!hid('ramp') && (
                <SectionShell id="ramp" title="The ramp" hidden={false} edit={edit} onToggle={() => toggleSection('ramp')} onAi={() => openAi('ramp')}>
                  <div className="onb-sec" data-nav="The ramp">
                    <Head k="ramp" label="The ramp" />
                    <Rows rows={sec('ramp').bands || []} kw="130px" />
                    <p className="mt-9 text-[15px] leading-[1.75] pl-5" style={{ color: t.body, maxWidth: '60ch', borderLeft: '2px solid ' + t.rule }}>
                      <Ed v={sec('ramp').note || ''} set={v => patch('ramp.note', v)} edit={edit} multiline />
                    </p>
                    <Note k="ramp" />
                    <Asks k="ramp" />
                  </div>
                </SectionShell>
              )}
              {!hid('season') && (
                <SectionShell id="season" title="Seasonality" hidden={false} edit={edit} onToggle={() => toggleSection('season')} onAi={() => openAi('season')}>
                  <div className="onb-sec" data-nav="Seasonality">
                    <Head k="season" label="Seasonality" />
                    <Body k="season" />
                    <div className="mt-10 flex items-end gap-1.5" style={{ height: 108 }}>
                      {(sec('season').months || []).map((m: Any, mi: number) => (
                        <div key={mi} className="flex-1 flex flex-col items-center gap-2">
                          <div className="w-full rounded-t" style={{ height: Math.max(8, (Number(m.level) + 1) * 24), background: Number(m.level) >= 3 ? hexA(t.accent, 0.85) : Number(m.level) >= 2 ? hexA(t.accent, 0.45) : hexA(t.accent, 0.18) }} />
                          <span className="text-[10.5px]" style={{ color: t.muted }}>{m.m}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-8 text-[13.5px] leading-[1.7]" style={{ color: t.muted, maxWidth: '60ch' }}>
                      <Ed v={sec('season').note || ''} set={v => patch('season.note', v)} edit={edit} multiline />
                    </p>
                    <Note k="season" />
                    <Asks k="season" />
                  </div>
                </SectionShell>
              )}
              {!hid('tech') && (
                <SectionShell id="tech" title="Your tech" hidden={false} edit={edit} onToggle={() => toggleSection('tech')} onAi={() => openAi('tech')}>
                  <div className="onb-sec" data-nav="Your tech">
                    <Head k="tech" label="Your tech" />
                    <Body k="tech" />
                    <Rows rows={sec('tech').rows || []} kw="176px" />
                    <Shot k="tech" />
                    <Note k="tech" />
                    <Asks k="tech" />
                  </div>
                </SectionShell>
              )}
              {!hid('money') && (
                <SectionShell id="money" title="Billables" hidden={false} edit={edit} onToggle={() => toggleSection('money')} onAi={() => openAi('money')}>
                  <div className="onb-sec" data-nav="Billables">
                    <Head k="money" label="Billables" />
                    <Body k="money" />
                    <Rows rows={sec('money').rules || []} kw="200px" />
                    <div className="mt-10 grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))' }}>
                      {(sec('money').examples || []).map((ex: Any, xi: number) => (
                        <div key={xi} className="rounded-2xl p-5" style={{ background: t.card, border: '1px solid ' + (ex.tone === 'hold' ? t.gold : t.cardBorder) }}>
                          <p className="text-[14.5px] font-semibold leading-snug" style={{ color: t.ink }}>{ex.title}</p>
                          <div className="mt-3.5">
                            {(ex.lines || []).map((ln: Any, i: number) => (
                              <div key={i} className="flex justify-between gap-4 py-2 border-t text-[14px]" style={{ borderColor: t.rule }}>
                                <span style={{ color: t.body }}>{ln.k}</span>
                                <span className="font-medium whitespace-nowrap tabular-nums" style={{ color: t.ink }}>{ln.v}</span>
                              </div>
                            ))}
                          </div>
                          {ex.total ? (
                            <div className="flex justify-between gap-4 pt-2.5 mt-1" style={{ borderTop: '1px solid ' + t.ink }}>
                              <span className="text-[14px] font-semibold" style={{ color: t.ink }}>Total</span>
                              <span className="text-[14px] font-semibold tabular-nums" style={{ color: t.ink }}>{ex.total}</span>
                            </div>
                          ) : null}
                          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: ex.tone === 'hold' ? t.gold : t.good }}>{ex.verdict}</p>
                        </div>
                      ))}
                    </div>
                    <Note k="money" />
                    <Asks k="money" />
                  </div>
                </SectionShell>
              )}
              {!hid('comms') && (
                <SectionShell id="comms" title="Communication" hidden={false} edit={edit} onToggle={() => toggleSection('comms')} onAi={() => openAi('comms')}>
                  <div className="onb-sec" data-nav="Communication">
                    <Head k="comms" label="Communication" />
                    <Body k="comms" />
                    <Rows rows={sec('comms').rows || []} kw="156px" />
                    <Note k="comms" />
                    <Asks k="comms" />
                  </div>
                </SectionShell>
              )}
              {!hid('checklist') && (
                <SectionShell id="checklist" title="Still to do" hidden={false} edit={edit} onToggle={() => toggleSection('checklist')}>
                  <div className="onb-sec" data-nav="Still to do">
                    <Head k="checklist" label="Still to do" />
                    <div className="mt-9">
                      {(sec('checklist').rows || []).map((r: Any, ri: number) => (
                        <div key={ri} className="onb-row grid gap-x-6 gap-y-1 py-3.5 border-t items-baseline" style={{ borderColor: t.rule, gridTemplateColumns: '1fr 92px 108px' }}>
                          <span className="text-[15px]" style={{ color: t.ink }}>
                            <Ed v={r.item || ''} set={v => patch('checklist.rows.' + ri + '.item', v)} edit={edit} multiline />
                          </span>
                          <span className="text-[12.5px]" style={{ color: String(r.who).toLowerCase() === 'stay' ? t.sub : t.gold }}>
                            <Ed v={r.who || ''} set={v => patch('checklist.rows.' + ri + '.who', v)} edit={edit} />
                          </span>
                          <span className="text-[13px]">
                            <LiveText v={String(r.by || '')} live={canEdit} t={t} single
                              set={v => { patch('checklist.rows.' + ri + '.by', v); answerChanged() }} />
                          </span>
                        </div>
                      ))}
                    </div>
                    <Note k="checklist" />
                  </div>
                </SectionShell>
              )}
              {!hid('nextup') && (
                <SectionShell id="nextup" title="What happens next" hidden={false} edit={edit} onToggle={() => toggleSection('nextup')}>
                  <div className="onb-sec" data-nav="What's next">
                    <Head k="nextup" label="What happens next" />
                    <Rows rows={sec('nextup').rows || []} kw="200px" />
                    <Note k="nextup" />
                  </div>
                </SectionShell>
              )}

              {/* ---------- 8 · OTHER NOTES ---------- */}
              <SectionShell id="notes" title="Other notes" hidden={hid('notes')} edit={edit} onToggle={() => toggleSection('notes')}>
                <div className="onb-sec" data-nav="Other notes">
                  <Head k="notes" label="Other notes" />
                  <div className="mt-9">
                    <LiveText
                      v={String(sec('notes').body || '')}
                      live={canEdit}
                      t={t}
                      ro="text-[16px] leading-[1.8] whitespace-pre-line"
                      cls="onb-copy w-full text-[16px] leading-[1.8] rounded-lg px-3 py-2 -mx-3"
                      set={v => { patch('notes.body', v); answerChanged() }}
                    />
                  </div>
                  {totalAsks > 0 && (
                    <div className="mt-12 pt-9 border-t" style={{ borderColor: t.ink }}>
                      <p className="text-[13px]" style={{ color: open.length ? t.gold : t.good }}>
                        {answered} of {totalAsks} answered
                      </p>
                      {open.length === 0 ? (
                        <p className="mt-4 text-[16px]" style={{ color: t.good }}>Nothing open &mdash; every question on this page has an answer.</p>
                      ) : (
                        <div className="mt-4">
                          {open.map((o, oi) => (
                            <div key={oi} className="onb-row grid gap-x-8 gap-y-1 py-3.5 border-t items-baseline" style={{ borderColor: t.rule, gridTemplateColumns: '148px 1fr' }}>
                              <span className="text-[12.5px]" style={{ color: t.muted }}>{o.label}</span>
                              <span className="text-[15px]" style={{ color: t.ink }}>{o.q}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <Note k="notes" />
                </div>
              </SectionShell>

              {/* Switch an off-by-default section back on for this owner. Edit mode only. */}
              {edit && (
                <div className="sb-noprint onb-sec">
                  <div className="rounded-2xl px-6 py-5" style={{ background: t.chip, border: '1px dashed ' + t.cardBorder }}>
                    <p className="text-[13px] font-semibold mb-1" style={{ color: t.sub }}>More sections</p>
                    <p className="text-[13px] mb-4" style={{ color: t.muted, maxWidth: '58ch' }}>
                      Written and ready, off by default. Add any of these to this owner&rsquo;s deck &mdash; it changes this document only, never the template.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {EXTRA.map(x => {
                        const on = !hid(x.k)
                        return (
                          <button key={x.k} onClick={() => toggleSection(x.k)}
                            className="rounded-full px-3.5 py-1.5 text-[12px] font-medium"
                            style={on
                              ? { background: t.ink, color: t.bg }
                              : { background: t.card, border: '1px solid ' + t.cardBorder, color: t.sub }}>
                            {on ? '✓ ' : '+ '}{x.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </>
          )
        })()}

        {!isOnboarding && (<>
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

        </>)}

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
        <footer className="mt-16 pt-8 border-t text-center" style={{ borderColor: t.rule }}>
          {mark.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mark.logo} alt={mark.word} className="mx-auto mb-4" style={{ height: 22, width: 'auto', objectFit: 'contain', opacity: 0.55, ...(mark.style || {}) }} />
          ) : null}
          <p className="text-[10px] uppercase tracking-[0.22em] font-semibold" style={{ color: t.footA }}>{footer}</p>
          <p className="text-[10px] mt-1" style={{ color: t.footB }}>Prepared by Stay Hospitality</p>
        </footer>
      </div>
    </div>
  )
}
