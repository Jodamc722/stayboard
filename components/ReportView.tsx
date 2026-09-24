'use client'
// Owner Report renderer + edit-in-place. Renders the ReportContent JSON as a stacked
// "deck" of sections in the Capri look (navy/coral/gold on cream). When canEdit,
// an Edit toggle turns every text/number into an inline input, lets quotes/themes/
// project items be removed/added, and sections be hidden/shown (content.omit).
// Save PUTs the whole content JSON to /api/reports. Subcomponents live at module
// scope (never inline in render) so inputs keep focus while typing.
import { buildVerdict } from '@/lib/report-verdict'
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Pencil, Save, Loader2, Eye, EyeOff, X, Plus, Link as LinkIcon, Check, Paperclip, Image as ImageIcon, Download, UploadCloud, Sparkles, Star, Play, ChevronLeft, ChevronRight, Lock, RefreshCw } from 'lucide-react'
import { type Basis, BASES, BASIS_SHORT, BASIS_LABEL, BASIS_NOTE, basisTriple, isBasis } from '@/lib/basis'
import { paceTier, paceStatus, paceThresholds, PACE_TONE } from '@/lib/pacing'
import { SAMPLE_STATEMENT, statementHasRows, statementIsHouseSample, STATEMENT_ALSO } from '@/lib/statement-sample'
import {
  houseLine, houseRows, agendaStale, channelBodyStale, statementAlsoRowsStale, AGENDA_ROWS, HERO_HEADLINE,
  AI_HEADLINE, AI_SUBTITLE, AI_PILLARS, AI_NOTE, AI_PILLARS_RETIRED_MARKS,
  STACK_BODY_PAIR, LIGHTHOUSE_LINE, BREEZEWAY_LINE, houseLogo, WORDMARK_LOGOS,
  CHECKLIST_HEADLINE, CHECKLIST_SUBTITLE, RAMP_HEADLINE, RAMP_SUBTITLE,
  WELCOME_BODY, SUPPORT_NOTE, RAMP_BANDS, RAMP_BANDS_RETIRED_MARKS, RAMP_NOTE,
  SECTION_HEAD, SECTION_SUB, SEASON_LABEL, houseAsk,
  MONEY_RULES, PORTAL_ITEMS, CHECKLIST_ROWS, CLEANS_HIGHLIGHT,
  MONEY_RULES_RETIRED_MARK, PORTAL_ITEMS_RETIRED_MARK, CHECKLIST_RETIRED_MARK,
  houseBody, OVERVIEW_BODY_RETIRED_MARK, COMPANY_STATS_RETIRED_MARK, pitchSectionStale,
  OVERVIEW_BODY_2, COMPANY_STATS_2,
  EXPERIENCE_BODY, EXPERIENCE_ITEMS, EXPERIENCE_PROOF, EXPERIENCE_HEADLINE, EXPERIENCE_SUBTITLE, EXPERIENCE_INTRO,
  CRAFT_BODY, CRAFT_ROWS, CRAFT_HEADLINE, CRAFT_SUBTITLE,
  GUEST_BODY, GUEST_STAGES, GUEST_BREEZEWAY, GUEST_HEADLINE, GUEST_SUBTITLE,
  REVENUE_BODY, REVENUE_LEVERS, REVENUE_NOTE, REVENUE_HEADLINE, REVENUE_SUBTITLE, REVENUE_PARTNER, REVENUE_PARTNER_HEAD, REVENUE_PARTNER_INTRO, REVENUE_PARTNER_GROUPS, PACER_LOGO,
  RAMP_ACTIONS, RAMP_ACTIONS_NOTE, RAMP_ACTIONS_HEADLINE, RAMP_ACTIONS_SUBTITLE,
  STACK_BODY, STACK_TOOLS, STACK_CHANNELS, STACK_NOTE, STACK_HEADLINE, STACK_SUBTITLE,
  housePortalUrl, houseTeamSubtitle, STATEMENT_HIGHLIGHTS, statementHighlightsStale,
} from '@/lib/onboarding-copy'
import { AMENITY_VOCAB, groupAmenities } from '@/lib/amenity-catalog'
import { SEASON_SHAPE, SEASON_PEAK_SHARE, SEASON_PEAK_LABEL, SEASON_BODY, seasonBodyStale } from '@/lib/season-shape'
import { CANVAS, TYPE, blend, SERIF, inkA, type SlideTone } from '@/lib/deck'
import { CHANNEL_MARKS, CHANNEL_BODY, CHANNEL_COUNT, CHANNEL_COUNT_RETIRED } from '@/lib/channel-marks'
import OwnerPortalDemo from '@/components/OwnerPortalDemo'

type Any = any
/** Drop a trailing "· live on N channels" / "· not yet live" from a stored listing sub-line. */
function stripChannelCount(sub: unknown): string {
  return String(sub || '')
    .replace(/\s*\u00b7\s*live on \d+ channels?\s*$/i, '')
    .replace(/\s*\u00b7\s*not yet live\s*$/i, '')
    .replace(/^\s*(live on \d+ channels?|not yet live)\s*$/i, '')
    .trim()
}
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
  // BRIGHTENED 2026-09-23 (Jon: "do a clean revamp and brighten it up a little bit. Looks a little
  // faded."). It read faded for a measurable reason, not a matter of taste: three of the five text
  // tokens were below the 4.5:1 contrast floor on the slide's own white card — `muted`, which
  // carries every label, footer and caption in the deck, sat at 2.58:1, roughly half of legible.
  // Grey text on cream is exactly what "faded" looks like.
  //
  // So the fix is contrast, not saturation. Ground lifted to a cleaner warm white, ink and body
  // deepened, and the terracotta taken from #E2725B (3.09:1, washed out) to #B54B33, which reads
  // RICHER rather than louder and finally holds as label text. Every token now clears 4.5:1 on all
  // three grounds the deck uses — the white card, the warm tint and the navy band — checked, not
  // eyeballed:
  //
  //             on white          on tint (#F8F4ED)
  //   ink       15.19  (was 14.64)   13.85
  //   body       8.23  (was  7.38)    7.51
  //   sub        5.28  (was  4.29)    4.82
  //   muted      4.90  (was  2.58)    4.82
  //   accent     5.23  (was  3.09)    4.77
  //
  // NOTE: this theme is shared with owner REPORTS, not just onboarding. That is deliberate — the
  // same numbers were failing there too — but it means a report regenerated today looks different
  // from one sent last month.
  capri: {
    label: 'Capri', bg: '#FCFAF6', ink: '#0E2740', body: '#3A5167', sub: '#5A6E80', muted: '#5A6E80',
    card: '#ffffff', cardBorder: '#E7DFCF', chip: '#F8F4ED', accent: '#B54B33', gold: '#9C7A23', band: '#0E2740',
    statusHotBg: '#fbeae5', statusHotInk: '#B54B33', statusColdBg: '#eaf1f6', statusColdInk: '#43607a',
    good: '#157044', downGray: '#8d99a4', rule: '#E7DFCF', toolbarBg: 'rgba(252,250,246,0.94)', toolbarBorder: '#d9d0bc',
    trackBg: '#fffdf9', footA: '#8a8271', footB: '#a79f8c', barA: '#0E2740', barB: '#B54B33',
    edBg: 'rgba(255,255,255,0.7)', edBorder: '#9C7A23',
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
const FONT_PAIRS: Record<string, { label: string; display: string; href: string; body?: string }> = {
  modern: { label: 'Modern', display: '', href: '' },
  stay: {
    label: 'Stay',
    display: "'Instrument Serif', Georgia, 'Times New Roman', serif",
    body: "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif",
    href: 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&display=swap',
  },
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
// AN EDIT BOX HAS TO BE THE SIZE OF THE TEXT IT REPLACES.
//
// Jon, 2026-09-17, with a screenshot of the team slide in edit mode: "look when I click edit."
// Every headline had a box twice its own height, the cards below were sliced off mid-photo, and
// the names, roles and blurbs were pushed off the slide entirely.
//
// The cause was `rows={Math.max(2, ceil(len / 60))}`. "Meet your team" is fourteen characters,
// so it asked for the minimum of two rows -- at a 40px display face that is ~88px of textarea
// standing in for ~44px of rendered heading. Every multiline field on every slide paid that
// tax, and on a fixed 630px canvas the overflow has nowhere to go.
//
// A textarea cannot size to its content in CSS, so it is measured: set the height to nothing,
// read scrollHeight, set that. Done in a layout effect, so it happens before paint and never
// flashes at the wrong size, and repeated on every keystroke so the box grows with the sentence
// as it is typed. Edit mode now occupies the same space the finished slide does, which is the
// only way a WYSIWYG page on a fixed canvas can work.
function AutoArea({ v, set, className, placeholder, style, max }: {
  v: string; set: (s: string) => void; className?: string; placeholder?: string; style?: Any; max?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    const want = el.scrollHeight
    el.style.height = (max && want > max ? max : want) + 'px'
    el.style.overflowY = (max && want > max) ? 'auto' : 'hidden'
  }
  useLayoutEffect(fit, [v])
  // The slide is scaled by a transform and re-scaled on resize; a box measured at one scale is
  // still right at another, but a font landing late is not, so re-measure once fonts settle.
  useEffect(() => {
    let done = false
    const again = () => { if (!done) fit() }
    const id = setTimeout(again, 300)
    try { (document as Any).fonts?.ready?.then?.(again) } catch { /* no font API */ }
    return () => { done = true; clearTimeout(id) }
  }, [])
  return (
    <textarea
      ref={ref}
      value={v}
      placeholder={placeholder}
      onChange={e => { set(e.target.value); fit() }}
      rows={1}
      className={(className || '') + ' w-full rounded-md px-1.5 outline-none block'}
      style={{
        color: 'inherit', font: 'inherit', letterSpacing: 'inherit', lineHeight: 'inherit',
        background: 'var(--ed-bg)', border: '1px dashed var(--ed-border)',
        resize: 'none', overflow: 'hidden', paddingTop: 1, paddingBottom: 1,
        ...(style || {}),
      }}
    />
  )
}

// THE SAME PROBLEM ON ONE LINE. A single-line field sized itself with `width: (len + 2)ch`,
// which is a decent guess for body text and wrong wherever the type is tracked out: the cover
// eyebrow is letter-spaced 0.28em, so "OWNER ONBOARDING" needs roughly a third more width than
// its character count implies and the box cut it to "OWNER ONBOA". `ch` cannot know that,
// because letter-spacing is not part of the character advance it measures.
//
// So the text is measured instead of estimated: a hidden span carrying the identical computed
// font, tracking and weight is laid out next to the input and its width is read back. Same
// method as AutoArea, same reason — the edit box should occupy exactly what the finished slide
// occupies, whatever the type is doing.
function AutoInput({ v, set, className, placeholder }: {
  v: string; set: (s: string) => void; className?: string; placeholder?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const ghost = useRef<HTMLSpanElement>(null)
  const fit = () => {
    const el = ref.current, g = ghost.current
    if (!el || !g) return
    const cs = getComputedStyle(el)
    g.style.font = cs.font
    g.style.letterSpacing = cs.letterSpacing
    g.style.textTransform = cs.textTransform
    g.textContent = v || placeholder || ''
    el.style.width = Math.ceil(g.getBoundingClientRect().width + 18) + 'px'
  }
  useLayoutEffect(fit, [v])
  useEffect(() => {
    let done = false
    const again = () => { if (!done) fit() }
    const id = setTimeout(again, 300)
    try { (document as Any).fonts?.ready?.then?.(again) } catch { /* no font API */ }
    return () => { done = true; clearTimeout(id) }
  }, [])
  return (
    <>
      <span ref={ghost} aria-hidden style={{
        position: 'absolute', visibility: 'hidden', whiteSpace: 'pre', pointerEvents: 'none',
        left: -9999, top: 0,
      }} />
      <input
        ref={ref}
        value={v}
        placeholder={placeholder}
        onChange={e => { set(e.target.value); fit() }}
        className={(className || '') + ' rounded-md px-1.5 outline-none min-w-0'}
        style={{
          color: 'inherit', font: 'inherit', letterSpacing: 'inherit', maxWidth: '100%',
          background: 'var(--ed-bg)', border: '1px dashed var(--ed-border)',
        }}
      />
    </>
  )
}

function Ed({ v, set, edit, className, multiline, placeholder, max }: {
  v: string; set: (s: string) => void; edit: boolean; className?: string; multiline?: boolean; placeholder?: string
  /** Cap the grown height, for a field in a box that cannot grow with it (a team card). */
  max?: number
}) {
  if (!edit) return <span className={className}>{v}</span>
  if (multiline) return <AutoArea v={v} set={set} className={className} placeholder={placeholder} max={max} />
  return <AutoInput v={v} set={set} className={className} placeholder={placeholder} />
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

// ── THE MONTH ───────────────────────────────────────────────────────────────────────────────────
// The page an owner reads if they read nothing else (Jon, 2026-09-22). Three numbers, a verdict
// sentence and the handful of facts that answer "how did we do and what are you doing about it".
//
// Everything is DERIVED from the report's own content by lib/report-verdict, so every review that
// already exists gained this page on deploy without being regenerated. Editing any line writes the
// whole block into content.verdict, and from then on the typed words win — which is why the edit
// handler materialises the derived object rather than patching a field that does not exist yet.
function TheMonth({ v, t, edit, setVerdict }: { v: Any; t: Any; edit: boolean; setVerdict: (next: Any) => void }) {
  if (!v) return null
  const TONE: Record<string, string> = { good: t.good, watch: t.accent, flat: t.sub }
  const setLine = (i: number, text: string) => {
    const lines = (v.lines || []).map((l: Any, j: number) => (j === i ? { ...l, text } : l))
    setVerdict({ ...v, lines, edited: true })
  }
  return (
    <section className="pt-16 sm:pt-24">
      <Eyebrow>THE MONTH</Eyebrow>
      <h2 className="mt-2 text-[30px] sm:text-[40px] font-extrabold tracking-tight leading-[1.08]" style={{ color: t.ink }}>
        <Ed v={v.headline || ''} set={x => setVerdict({ ...v, headline: x, edited: true })} edit={edit} multiline />
      </h2>

      {(v.numbers || []).length > 0 && (
        <div className="mt-7 grid gap-3" style={{ gridTemplateColumns: 'repeat(' + Math.min(3, v.numbers.length) + ', minmax(0,1fr))' }}>
          {v.numbers.map((n: Any) => (
            <div key={n.key} className="rounded-2xl px-5 py-5" style={{ background: t.card, border: '1px solid ' + t.cardBorder }}>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: t.accent }}>{n.label}</p>
              <p className="mt-1.5 text-[34px] sm:text-[42px] font-extrabold leading-none tracking-tight" style={{ color: t.ink }}>{n.value}</p>
              {n.sub ? <p className="mt-1.5 text-[12px]" style={{ color: t.muted }}>{n.sub}</p> : null}
            </div>
          ))}
        </div>
      )}

      {(v.lines || []).length > 0 && (
        <ul className="mt-7 space-y-3.5">
          {v.lines.map((l: Any, i: number) => (
            <li key={l.key || i} className="flex gap-3.5">
              <span className="mt-[9px] shrink-0 rounded-full" style={{ width: 7, height: 7, background: TONE[l.tone] || t.sub }} />
              <p className="text-[17px] sm:text-[19px] leading-[1.5]" style={{ color: t.body }}>
                <Ed v={l.text || ''} set={x => setLine(i, x)} edit={edit} multiline />
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-[12px]" style={{ color: t.muted }}>
        Everything below is the detail behind these lines.
      </p>
    </section>
  )
}

// ── THE SECTION PHOTOGRAPH ──────────────────────────────────────────────────────────────────────
// One of the two devices Jon took from the onboarding deck (2026-09-22): a picture of the thing
// being discussed, introducing each section. Optional by design — a report whose listings carry no
// usable photos renders exactly as it did before rather than showing a broken frame, which is what
// makes this safe to switch on for every existing review at once.
function SectionPhoto({ src, t }: { src?: string | null; t: Any }) {
  if (!src) return null
  return (
    <div className="mb-8 overflow-hidden rounded-[20px] sb-sectionphoto" style={{ border: '1px solid ' + t.cardBorder }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" loading="lazy" className="w-full object-cover" style={{ height: 'clamp(150px, 24vw, 260px)' }} />
    </div>
  )
}

// ONE QUESTION ON THE CALL. `live` is true for anyone who can edit — including while presenting,
// because filling these in during the meeting is the entire point of the document. An owner
// reading it later sees the answer, or an honest "not discussed yet".
// THE QUESTION ITSELF IS EDITABLE (Jon, 2026-09-22: "Need to be able to edir the qeistions on the
// addinatl notes secitons too"). The answer box was always live on the call; the question above it
// was fixed house copy, which is wrong the moment a call needs a question this owner's situation
// actually raises. In edit mode the question and its hint are typed in place and saved on the
// report, so the deck Jon walks in with is the deck he asks from.
function AskBlock({ ask, live, set, t, edit, setQ, setHint, onRemove }: {
  ask: Any; live: boolean; set: (v: string) => void; t: Any
  edit?: boolean; setQ?: (v: string) => void; setHint?: (v: string) => void; onRemove?: () => void
}) {
  const a = String(ask.a || '')
  const done = !!a.trim()
  return (
    <div className="pl-5 relative" style={{ borderLeft: '2px solid ' + (done ? t.good : t.rule) }}>
      <p className="text-[15.5px] font-bold leading-snug" style={{ color: t.ink }}>
        {edit && setQ
          ? <Ed v={String(ask.q || '')} set={setQ} edit placeholder="The question you want to ask" multiline />
          : houseAsk(ask.q)}
      </p>
      {(ask.hint || (edit && setHint)) ? (
        <p className="text-[13px] mt-1 leading-relaxed" style={{ color: t.muted }}>
          {edit && setHint
            ? <Ed v={String(ask.hint || '')} set={setHint} edit placeholder="A hint under it, if it needs one" multiline />
            : String(ask.hint || '')}
        </p>
      ) : null}
      {edit && onRemove ? (
        <button onClick={onRemove} title="Remove this question" className="sb-noprint absolute" style={{ top: 0, right: 0, color: t.muted }}><X size={13} /></button>
      ) : null}
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

// ── THE SLIDE ────────────────────────────────────────────────────────────────
// PowerPoint, in the app (Jon, 2026-09-16: "make it look like a power point but in my app
// format"). A deck is not a document that snaps — it is a fixed canvas that everything is
// composed onto. So every slide is authored at exactly 1120×630 and then scaled to whatever
// box it is dropped into: ~1:1 when the deck is read as a page, 1.7× on a shared screen. One
// composition, identical proportions everywhere, and nothing reflows between the version Jon
// builds and the version the owner sees on the call.
//
// This is deliberately the same primitive the owner reports will move onto next, which is why
// it takes only children and a nav label and knows nothing about onboarding.
// ── HOVER ON A CHART MARK ────────────────────────────────────────────────────────────────────
// Jon, 2026-09-22: "if i hover over the charts on this slide it can show adr, rev gorss values".
// A slide has room for one number per mark and no more, so the rest of the story — rate, RevPAR,
// revenue, what the plan said — lives here and costs the composition nothing. It is hover only:
// nothing in this card is load-bearing, because a printed deck and a PDF never get to see it.
function ChartTip({ title, rows, dark, children, style, className, empty }: {
  title: string
  rows: [string, string][]
  dark?: boolean
  children: React.ReactNode
  style?: Any
  className?: string
  /** Shown instead of the rows when a mark has nothing beyond the number it already prints. */
  empty?: string
}) {
  const [on, setOn] = useState(false)
  // A slide clips its own overflow, so a card opening upward from a mark near the top of the
  // frame would be cut in half. Measure against the slide on the way in and flip it downward.
  const [below, setBelow] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  // A row with nothing in it is dropped rather than printed as an em dash.
  //
  // IT USED TO REFUSE TO OPEN ON ONE ROW, which looked like a broken hover rather than a quiet
  // one (Jon, 2026-09-22: "Why is the hover over november not working, need sto be able to hover
  // over all"). November is far enough out that it has occupancy on the books and no rate yet, so
  // its card was down to a single line and never appeared — while October's, two columns over,
  // opened fine. A chart where only some marks answer is worse than one where none do: you stop
  // trusting the ones that do. Every mark opens now; a card with nothing but the number already
  // printed on the mark says so in words instead of staying shut.
  const live = rows.filter(r => r[1] && String(r[1]).trim() && r[1] !== '—')
  return (
    <div ref={wrap} className={className} style={{ position: 'relative', ...(style || {}) }}
      onMouseEnter={() => {
        const el = wrap.current
        if (el) {
          const slide = el.closest('.sb-slide')
          if (slide) setBelow(el.getBoundingClientRect().top - slide.getBoundingClientRect().top < 120)
        }
        setOn(true)
      }}
      onMouseLeave={() => setOn(false)}>
      {children}
      {on && (live.length || empty) ? (
        <div className="sb-noprint" style={{
          position: 'absolute', left: '50%', transform: 'translateX(-50%)',
          ...(below ? { top: 'calc(100% + 9px)' } : { bottom: 'calc(100% + 9px)' }),
          zIndex: 8, whiteSpace: 'nowrap', pointerEvents: 'none', borderRadius: 9, padding: '10px 13px',
          background: dark ? '#ffffff' : '#0E2436', color: dark ? '#0E2436' : '#ffffff',
          boxShadow: '0 10px 30px -12px rgba(0,0,0,0.55)',
        }}>
          <p style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', opacity: 0.55, margin: 0 }}>{title}</p>
          {live.map(([k, v]) => (
            <p key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 18, fontSize: 12.5, margin: '6px 0 0', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ opacity: 0.65 }}>{k}</span><span style={{ fontWeight: 600 }}>{v}</span>
            </p>
          ))}
          {live.length < 2 && empty ? (
            <p style={{ fontSize: 12.5, margin: '6px 0 0', opacity: 0.75, maxWidth: 220, whiteSpace: 'normal' }}>{empty}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const SLIDE_W = CANVAS.w
const SLIDE_H = CANVAS.h

// BIGGER TYPE, WITHOUT A NEW SET OF FONT SIZES (Jon, 2026-09-17: "change font size too, need
// that feature"). Every size on a slide is an inline px value against the fixed 1120x630
// canvas, so there is no single number to turn and a CSS variable cannot reach any of them.
// What CAN be turned is the canvas: author the same slide into a SMALLER logical box and scale
// it up by the same factor, and every glyph on it lands larger while the layout reflows to suit.
// 1.1 gives a slide authored at 1018x573 shown at 110% — type 10% bigger, margins in proportion,
// and the spill warning still measures against the box the content actually has.
const TextScale = createContext(1)

function Slide({ nav, children, pad, bleed, warn, ground, h, noteKey }: {
  nav?: string; children: React.ReactNode; pad?: number; bleed?: boolean; warn?: boolean
  /** Which content.slideNotes entry this slide shows, so presenter notes can land on it. */
  noteKey?: string
  /** Resolved background for this slide's tone. Set by the deck, never guessed here. */
  ground?: string
  /**
   * A taller design height than the 630 canvas, for the one kind of slide that genuinely cannot be
   * a 16:9 rectangle: a table of every unit. Splitting that across three frames to respect the
   * aspect ratio made the reader hold a running total in their head across two page-turns. The
   * frame keeps scaling by width, so a tall slide is simply a taller card in the deck, and in
   * Present mode it scrolls inside its own frame rather than running off the glass.
   */
  h?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  const [spill, setSpill] = useState(0)
  const tz = useContext(TextScale)
  const DESIGN_H = h && h > SLIDE_H ? h : SLIDE_H
  const LW = Math.round(SLIDE_W / tz)
  const LH = Math.round(DESIGN_H / tz)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => {
      const w = el.clientWidth
      if (w > 0) setScale(w / LW)
    }
    fit()
    let ro: Any = null
    try { ro = new ResizeObserver(fit); ro.observe(el) } catch { window.addEventListener('resize', fit) }
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', fit) }
  }, [LW])
  // Measured after paint, and again whenever the content changes, because the content here is
  // editable — a paragraph typed on the call is exactly when a slide starts overflowing.
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const measure = () => {
      const inner = c.firstElementChild as HTMLElement | null
      setSpill(inner ? Math.max(0, Math.round(inner.scrollHeight - LH)) : 0)
    }
    measure()
    const id = setTimeout(measure, 400)
    let mo: Any = null
    try { mo = new MutationObserver(measure); mo.observe(c, { subtree: true, childList: true, characterData: true }) } catch {}
    return () => { clearTimeout(id); if (mo) mo.disconnect() }
  })
  return (
    <div ref={box} className="sb-slide" data-nav={nav || undefined} data-note={noteKey || undefined} data-tall={h && h > SLIDE_H ? '1' : undefined}
      style={{ ...(ground ? { background: ground } : {}), ...(h && h > SLIDE_H ? { aspectRatio: String(SLIDE_W) + ' / ' + String(DESIGN_H) } : {}) }}>
      {/* Until the first measurement lands, scale 0 would flash a collapsed slide; hold it
          invisible for that one frame instead. */}
      <div
        ref={canvas}
        className="sb-slide-canvas"
        style={{
          width: LW, height: LH, transform: 'scale(' + (scale || 1) + ')',
          opacity: scale ? 1 : 0, padding: bleed ? 0 : (pad == null ? 64 : pad),
        }}
      >
        {children}
      </div>
      {warn && spill > 8 ? (
        <div className="sb-noprint" style={{
          position: 'absolute', left: 12, bottom: 12, zIndex: 5, borderRadius: 999,
          padding: '5px 11px', fontSize: 11, fontWeight: 600, background: '#C9A227', color: '#fff',
        }}>
          {spill}px past the edge &mdash; trim this slide
        </div>
      ) : null}
    </div>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-[0.28em]" style={{ color: 'var(--t-accent)' }}>{children}</p>
}

// ---------- main ----------
// ── THE PITCH SECTIONS, AS A DECK THAT PREDATES THEM WOULD NEED THEM ────────
// Jon, 2026-09-23: the onboarding deck became a roadmap — who we are, what we have run, what we
// do to the listing, how a stay is run, how the rate is set, what it all runs on, and how we
// shorten the ramp. Six new sections.
//
// A deck generated before today has none of these keys, so the slides would render as a headline
// over nothing. These defaults seed a MISSING section only; a section somebody has edited is
// never touched, here or anywhere else in the repair pass.
/**
 * ONE TILE IN THE TECH-STACK ROW: the vendor's own mark when we have a URL for it, the monogram
 * when we do not — and the monogram again if the image fails to load.
 *
 * That last part is the whole reason this is a component. A logo referenced from somebody else's
 * service can be blocked, slow, or simply gone, and four broken-image glyphs on an owner's screen
 * is worse than four clean letters. `onError` swaps back silently, so the row always reads as a row.
 */
function StackMark({ logo, mono, name, accent, card, border, wide, bare, lockup, height }: {
  logo?: string; mono?: string; name?: string; accent: string; card: string; border: string; wide?: boolean
  bare?: boolean; lockup?: boolean; height?: number
}) {
  const [failed, setFailed] = useState(false)
  const src = String(logo || '').trim()
  // JUST THE LOGO (Jon, 2026-09-24: "can we just use the logo, not the name of the app or tech").
  // No tile, no border, one height for every mark, so the column reads as a row of logos. An app
  // icon (Lighthouse) is set as a lockup: the icon beside its name in the brand's own colour,
  // which is how the mark is drawn, not a caption beside a logo.
  if (bare) {
    const h = height || 30
    if (src && !failed && lockup) return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, height: h + 4 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" onError={() => setFailed(true)} style={{ width: h, height: h, borderRadius: Math.round(h * 0.24) }} />
        <span style={{ fontSize: Math.round(h * 0.72), fontWeight: 700, letterSpacing: '-0.02em', color: '#4c4fd3', lineHeight: 1 }}>{name}</span>
      </span>
    )
    if (src && !failed) return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={String(name || '')} onError={() => setFailed(true)}
        style={{ height: h, width: 'auto', maxWidth: 160, objectFit: 'contain', display: 'block' }} />
    )
    return <span style={{ fontSize: Math.round(h * 0.7), fontWeight: 700, color: accent, lineHeight: 1 }}>{name || mono}</span>
  }
  // A WORDMARK STANDS IN FOR THE NAME (Jon, 2026-09-24: "just use the logo"), so it gets a tile wide
  // enough to be read at a glance rather than squeezed into the square an icon needs.
  if (src && !failed && wide) {
    return (
      <span style={{ flex: '0 0 auto', width: 150, height: 50, padding: '0 14px', borderRadius: 12, background: card, border: '1px solid ' + border, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={String(name || '')} onError={() => setFailed(true)}
          style={{ maxWidth: 122, maxHeight: 28, objectFit: 'contain' }} />
      </span>
    )
  }
  if (src && !failed) {
    return (
      // A WORDMARK IS NOT A SQUARE. Breezeway and Pacer publish horizontal logos; Guesty publishes
      // a square icon. Forcing both into a 46px box squashes the wordmarks to an unreadable smear,
      // so the tile keeps the 46px height and grows sideways up to 132px for whatever it is given.
      <span style={{ flex: '0 0 auto', minWidth: 46, maxWidth: 132, height: 46, padding: '0 8px', borderRadius: 11, background: card, border: '1px solid ' + border, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={String(name || '')} onError={() => setFailed(true)}
          style={{ maxWidth: 116, maxHeight: 30, objectFit: 'contain' }} />
      </span>
    )
  }
  return (
    <span style={{
      flex: '0 0 auto', minWidth: 46, height: 46, borderRadius: 11, background: accent, color: card,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: mono && String(mono).length > 1 ? 15 : 19, fontWeight: 700, letterSpacing: '-0.02em',
    }}>{mono || '\u00b7'}</span>
  )
}

const PITCH_DEFAULTS: Record<string, Any> = {
  experience: { headline: EXPERIENCE_HEADLINE, subtitle: EXPERIENCE_SUBTITLE, body: EXPERIENCE_BODY, intro: EXPERIENCE_INTRO, items: EXPERIENCE_ITEMS, proof: EXPERIENCE_PROOF, photo: null },
  craft: { headline: CRAFT_HEADLINE, subtitle: CRAFT_SUBTITLE, body: CRAFT_BODY, rows: CRAFT_ROWS },
  guestcare: { headline: GUEST_HEADLINE, subtitle: GUEST_SUBTITLE, body: GUEST_BODY, stages: GUEST_STAGES, note: GUEST_BREEZEWAY },
  revenue: { headline: REVENUE_HEADLINE, subtitle: REVENUE_SUBTITLE, body: REVENUE_BODY, rows: REVENUE_LEVERS, note: REVENUE_NOTE, partnerHead: REVENUE_PARTNER_HEAD, partnerIntro: REVENUE_PARTNER_INTRO, partner: REVENUE_PARTNER, partnerGroups: REVENUE_PARTNER_GROUPS, partnerLogo: PACER_LOGO },
  rampsteps: { headline: RAMP_ACTIONS_HEADLINE, subtitle: RAMP_ACTIONS_SUBTITLE, rows: RAMP_ACTIONS, note: RAMP_ACTIONS_NOTE },
  stack: { headline: STACK_HEADLINE, subtitle: STACK_SUBTITLE, body: STACK_BODY, tools: STACK_TOOLS, rows: STACK_CHANNELS, note: STACK_NOTE },
}
const PITCH_SEEDS: string[] = Object.keys(PITCH_DEFAULTS)

export function ReportView({ initial, canEdit, isTeam, gallery, listingTable, recs, delta }: { initial: Any; canEdit: boolean; isTeam?: boolean; gallery?: string[]; listingTable?: Any; recs?: Any; delta?: Any }) {
  const [c, setC] = useState<Any>(initial.content || {})
  // Marks every in-slide scroll area that has more below it (see .onb-scroll[data-more] above).
  useEffect(() => {
    if (typeof document === 'undefined') return
    const els = Array.from(document.querySelectorAll<HTMLElement>('.onb-scroll'))
    const upd = (e: HTMLElement) => {
      const more = e.scrollHeight - e.clientHeight > 6 && e.scrollTop + e.clientHeight < e.scrollHeight - 6
      if (more) { if (e.getAttribute('data-more') !== '1') e.setAttribute('data-more', '1') }
      else if (e.hasAttribute('data-more')) e.removeAttribute('data-more')
    }
    const onScroll = (ev: Event) => upd(ev.currentTarget as HTMLElement)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(list => list.forEach(x => {
      const el = x.target as HTMLElement
      upd(el.classList.contains('onb-scroll') ? el : (el.parentElement as HTMLElement))
    })) : null
    els.forEach(e => {
      upd(e); e.addEventListener('scroll', onScroll, { passive: true })
      if (ro) { ro.observe(e); if (e.firstElementChild) ro.observe(e.firstElementChild) }
    })
    return () => { els.forEach(e => e.removeEventListener('scroll', onScroll)); if (ro) ro.disconnect() }
  })
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
  const fontKey: string = FONT_PAIRS[styleCfg.font] ? styleCfg.font
    : (String(((c || {}).meta || {}).kind || '') === 'onboarding' ? 'stay' : 'modern')
  const fontPair = FONT_PAIRS[fontKey]
  // Type size rides with the other style overrides, so it saves and shares like the rest.
  const TEXT_SIZES: { k: string; label: string; v: number }[] = [
    { k: 's', label: 'S', v: 0.92 }, { k: 'm', label: 'M', v: 1 },
    { k: 'l', label: 'L', v: 1.1 }, { k: 'xl', label: 'XL', v: 1.22 },
  ]
  const sizeKey: string = TEXT_SIZES.some(z => z.k === styleCfg.textSize) ? String(styleCfg.textSize) : 'm'
  const textScale: number = (TEXT_SIZES.find(z => z.k === sizeKey) || { v: 1 }).v
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
  const [photoPick, setPhotoPick] = useState<{ title: string; cur: string; set: (u: string) => void; choices?: string[]; choicesLabel?: string; groups?: { id: string; name: string; pics: string[] }[] } | null>(null)
  // The properties slide's galleries, by building (Jon, 2026-09-24: "let me select").
  const [buildingListings, setBuildingListings] = useState<Record<string, { id: string; name: string; pics: string[] }[]>>({})
  const [buildingChosen, setBuildingChosen] = useState<Record<string, string>>({})
  const [buildingAuto, setBuildingAuto] = useState<Record<string, string>>({})
  const [pickGroup, setPickGroup] = useState<string>('')
  // The properties-slide picker (Jon, 2026-09-24: "see only the property listing photos; once
  // select, save for all properties"). Its own modal, not the general photo picker.
  const [propPick, setPropPick] = useState<{ i: number; b: string; name: string; cur: string } | null>(null)
  const [propMsg, setPropMsg] = useState('')
  const [stdArm, setStdArm] = useState<'' | 'armed' | 'busy' | 'done' | 'fail'>('')
  const [photoUrl, setPhotoUrl] = useState('')
  // Upload state for the picker. One picker serves every photo slot in the deck, so wiring
  // upload here covers the cover, the team cards, the portal shots and any slide added by hand.
  const [upBusy, setUpBusy] = useState(false)
  const [upMsg, setUpMsg] = useState('')
  const [amenityMsg, setAmenityMsg] = useState<Record<string, string>>({})
  const [copyMsg, setCopyMsg] = useState<Record<string, string>>({})
  // ONE STATEMENT SLIDE, AND IT ANSWERS BACK (Jon, 2026-09-17: "the owner statements should be
  // on one slide, interactive"). Clicking a category on the summary shows the bookings that
  // produced it, which is the whole argument of the section — every line traces to a stay.
  const [stmtCat, setStmtCat] = useState<string | null>(null)
  const [amenQ, setAmenQ] = useState('')
  const [teamSaveMsg, setTeamSaveMsg] = useState('')
  // OPTIMIZE FROM WHERE THE COPY IS READ (Jon, 2026-09-16: "make sure we have prompt or use AI
  // to optimize listing, from there"). /api/optimize-listing already writes to the house rules
  // and the honesty block; this is a caller, not a second optimizer. It PROPOSES — the draft
  // lands in the slide, Jon reads it aloud, and Push to Guesty is still a separate decision.
  const [opt, setOpt] = useState<{ id: string; li: number; name: string } | null>(null)
  const [optInstr, setOptInstr] = useState('')
  const [optBusy, setOptBusy] = useState(false)
  const [optMsg, setOptMsg] = useState('')
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
  // PRESENTER NOTES (Jon, 2026-09-21): a drawer only the presenter sees, on every slide, where
  // notes typed during the call land. They are stored on the deck (content.notes.recap) and
  // shown on the last slide as the recap, so the owner leaves with the record.
  const [notesOpen, setNotesOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [tidyBusy, setTidyBusy] = useState(false)
  const [tidyMsg, setTidyMsg] = useState('')
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
  // The note key of each slide, read off the DOM at the same moment as its name, so a note typed
  // while presenting lands on the slide actually on the glass (Jon, 2026-09-22: "Need to be able
  // to see notes on the prester mode so i can add").
  const [navNotes, setNavNotes] = useState<string[]>([])
  function readNavNames() {
    const kids = slideEls()
    setNavNames(kids.map((el, i) => {
      const n = el.querySelector('[data-nav]')
      const v = n ? String(n.getAttribute('data-nav') || '') : ''
      return v || (i === 0 ? 'Cover' : 'Slide ' + (i + 1))
    }))
    setNavNotes(kids.map(el => {
      const n = el.querySelector('[data-note]')
      return n ? String(n.getAttribute('data-note') || '') : ''
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
      // CREATE THE BRANCH ON THE WAY DOWN. Every path patch() had ever been given pointed at a key
      // that already existed ('hero.title', 'snapshot.headline'), so walking blindly worked and the
      // limitation was invisible. The 2026-09-22 deck added the first paths into objects a report
      // has never carried — slideNotes, slidePhotos, recsText — and every one of them threw
      // "Cannot set properties of undefined" on the first keystroke. Found by double-checking, not
      // by using it, which is the only reason it did not reach Jon.
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i]
        if (node[k] == null || typeof node[k] !== 'object') node[k] = {}
        node = node[k]
      }
      node[parts[parts.length - 1]] = value
      return next
    })
  }
  function mutate(fn: (draft: Any) => void) {
    setC((prev: Any) => { const next = JSON.parse(JSON.stringify(prev)); fn(next); return next })
  }

  // ADOPT THE HOUSE COPY, ONCE, WHEN EDITING STARTS (Jon, 2026-09-18: "it's also not letting me
  // edit the text"). The fallbacks further down draw current copy over retired copy, which is
  // right for a reader and a trap for an editor: the typed value goes into the content, the
  // staleness test still sees the old stored value, and the next render paints the house line
  // back over the edit. The field looks like it refuses to take input.
  //
  // So on the way into edit mode, anything still carrying retired copy is written into this
  // deck's own content. After this runs there is nothing left to substitute, every field reads
  // from storage, and edits behave like edits. It marks the deck dirty, which is honest -- the
  // document really did just change -- and it is idempotent, so it settles after one pass.
  // Sections whose stored discussion questions still carry a retired wording.
  const staleAsks = (cc: Any): Record<string, true> => {
    const out: Record<string, true> = {}
    for (const k of Object.keys(cc || {})) {
      const as = ((cc as Any)[k] || {}).asks
      if (Array.isArray(as) && as.some((a: Any) => a && houseAsk(a.q) !== String(a.q || ''))) out[k] = true
    }
    return out
  }
  useEffect(() => {
    // Computed here rather than reusing the `isOnboarding` further down, which is declared after
    // this effect and would be a temporal-dead-zone reference.
    const onb = String(((c || {}).meta || {}).kind || '') === 'onboarding'
    if (!edit || !onb) return
    // Only write when there is genuinely something retired to adopt. Without this the deck is
    // marked unsaved every time it is opened for editing, and "you have unsaved changes" on a
    // document nobody touched is how people learn to ignore that warning.
    const g = (k: string) => (c as Any)[k] || {}
    const stale =
      houseLine(g('hero').headline, HERO_HEADLINE) !== (g('hero').headline || '') ||
      CHANNEL_COUNT_RETIRED.indexOf(String(g('channels').count || '').trim()) >= 0 ||
      channelBodyStale(g('channels').subtitle) ||
      agendaStale(g('agenda').items) ||
      statementAlsoRowsStale(g('statement').also) ||
      statementHighlightsStale(g('statement').highlights) ||
      houseTeamSubtitle(g('team').subtitle, ((g('team').people || []) as Any[]).length) !== (g('team').subtitle || '') ||
      houseLine(g('ramp').headline, RAMP_HEADLINE) !== (g('ramp').headline || '') ||
      houseLine(g('ramp').subtitle, RAMP_SUBTITLE) !== (g('ramp').subtitle || '') ||
      houseRows<Any>(g('ramp').bands, RAMP_BANDS_RETIRED_MARKS, RAMP_BANDS as Any[]) !== g('ramp').bands ||
      houseLine(g('ramp').note, RAMP_NOTE) !== (g('ramp').note || '') ||
      houseLine(g('welcome').body, WELCOME_BODY) !== (g('welcome').body || '') ||
      houseLine((g('team').support || {}).note, SUPPORT_NOTE) !== ((g('team').support || {}).note || '') ||
      seasonBodyStale(g('season').body) ||
      houseLine(g('season').peakLabel, SEASON_LABEL) !== (g('season').peakLabel || '') ||
      Object.keys(SECTION_HEAD).some(k => houseLine(g(k).headline, SECTION_HEAD[k]) !== (g(k).headline || '')) ||
      Object.keys(SECTION_SUB).some(k => houseLine(g(k).subtitle, SECTION_SUB[k]) !== (g(k).subtitle || '')) ||
      Object.keys(staleAsks(c)).length > 0 ||
      houseLine(g('checklist').headline, CHECKLIST_HEADLINE) !== (g('checklist').headline || '') ||
      houseLine(g('checklist').subtitle, CHECKLIST_SUBTITLE) !== (g('checklist').subtitle || '') ||
      houseRows<Any>(g('checklist').rows, CHECKLIST_RETIRED_MARK, CHECKLIST_ROWS as Any[]) !== g('checklist').rows ||
      houseRows<Any>(g('money').rules, MONEY_RULES_RETIRED_MARK, MONEY_RULES as Any[]) !== g('money').rules ||
      houseRows<Any>(g('guesty').items, PORTAL_ITEMS_RETIRED_MARK, PORTAL_ITEMS as Any[]) !== g('guesty').items ||
      housePortalUrl(g('guesty').portalUrl) !== (g('guesty').portalUrl || '') ||
      houseBody(g('overview').body, OVERVIEW_BODY_RETIRED_MARK, OVERVIEW_BODY_2) !== (g('overview').body || '') ||
      houseRows<Any>(g('overview').stats, COMPANY_STATS_RETIRED_MARK, COMPANY_STATS_2 as Any[]) !== g('overview').stats ||
      // THE PITCH SLIDES (2026-09-23). A deck generated before today has no `experience`,
      // `craft`, `guestcare`, `revenue`, `rampsteps` or `stack` key at all, so those slides would
      // render as a headline over nothing. Seeded here rather than only in the generator, so an
      // owner meeting scheduled off an existing draft gets the same deck as one built this
      // afternoon. Only ever fills a MISSING section — an edited one is never touched.
      PITCH_SEEDS.some(k => !((c as Any)[k] && Object.keys((c as Any)[k]).length) || pitchSectionStale((c as Any)[k], k))
    if (!stale) return
    mutate(d => {
      const hero = d.hero || (d.hero = {})
      hero.headline = houseLine(hero.headline, HERO_HEADLINE)
      const ch = d.channels || (d.channels = {})
      if (CHANNEL_COUNT_RETIRED.indexOf(String(ch.count || '').trim()) >= 0 || !String(ch.count || '').trim()) ch.count = CHANNEL_COUNT
      if (channelBodyStale(ch.subtitle)) ch.subtitle = CHANNEL_BODY
      const ag = d.agenda || (d.agenda = {})
      if (agendaStale(ag.items)) ag.items = JSON.parse(JSON.stringify(AGENDA_ROWS))
      const st = d.statement || (d.statement = {})
      if (statementAlsoRowsStale(st.also)) st.also = JSON.parse(JSON.stringify(STATEMENT_ALSO))
      if (statementHighlightsStale(st.highlights)) st.highlights = JSON.parse(JSON.stringify(STATEMENT_HIGHLIGHTS))
      const tm = d.team || (d.team = {})
      tm.subtitle = houseTeamSubtitle(tm.subtitle, ((tm.people || []) as Any[]).length)
      for (const k of PITCH_SEEDS) {
        // Missing (a deck from before these slides existed) or still carrying this morning's first
        // draft (a deck generated between the two ships today). An edited section matches neither.
        if (!d[k] || !Object.keys(d[k]).length || pitchSectionStale(d[k], k)) d[k] = JSON.parse(JSON.stringify(PITCH_DEFAULTS[k]))
      }
      const rp = d.ramp || (d.ramp = {})
      rp.headline = houseLine(rp.headline, RAMP_HEADLINE)
      rp.subtitle = houseLine(rp.subtitle, RAMP_SUBTITLE)
      rp.bands = houseRows<Any>(rp.bands, RAMP_BANDS_RETIRED_MARKS, RAMP_BANDS as Any[])
      rp.note = houseLine(rp.note, RAMP_NOTE)
      const wl = d.welcome || (d.welcome = {})
      wl.body = houseLine(wl.body, WELCOME_BODY)
      const tm2 = d.team || (d.team = {})
      if (tm2.support) tm2.support.note = houseLine(tm2.support.note, SUPPORT_NOTE)
      const sn = d.season || (d.season = {})
      if (seasonBodyStale(sn.body)) sn.body = SEASON_BODY
      sn.peakLabel = houseLine(sn.peakLabel, SEASON_LABEL)
      for (const k of Object.keys(SECTION_HEAD)) { const x = d[k] || (d[k] = {}); x.headline = houseLine(x.headline, SECTION_HEAD[k]) }
      for (const k of Object.keys(SECTION_SUB)) { const x = d[k] || (d[k] = {}); x.subtitle = houseLine(x.subtitle, SECTION_SUB[k]) }
      for (const k of Object.keys(d)) { const as = (d[k] || {}).asks; if (Array.isArray(as)) for (const a of as) if (a && a.q) a.q = houseAsk(a.q) }
      const cl = d.checklist || (d.checklist = {})
      cl.headline = houseLine(cl.headline, CHECKLIST_HEADLINE)
      cl.subtitle = houseLine(cl.subtitle, CHECKLIST_SUBTITLE)
      cl.rows = houseRows<Any>(cl.rows, CHECKLIST_RETIRED_MARK, CHECKLIST_ROWS as Any[])
      const mn = d.money || (d.money = {})
      mn.rules = houseRows<Any>(mn.rules, MONEY_RULES_RETIRED_MARK, MONEY_RULES as Any[])
      const gy = d.guesty || (d.guesty = {})
      gy.items = houseRows<Any>(gy.items, PORTAL_ITEMS_RETIRED_MARK, PORTAL_ITEMS as Any[])
      gy.portalUrl = housePortalUrl(gy.portalUrl)
      const ov = d.overview || (d.overview = {})
      ov.body = houseBody(ov.body, OVERVIEW_BODY_RETIRED_MARK, OVERVIEW_BODY_2)
      ov.stats = houseRows<Any>(ov.stats, COMPANY_STATS_RETIRED_MARK, COMPANY_STATS_2 as Any[])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit])

  // OUR PROPERTIES PICTURES (boss, 2026-09-24). A deck reseeded above, or generated before the
  // pictures existed, has blank `pic` fields on the properties slide. Fill them once from the
  // buildings' own Guesty photos, only in edit mode (a viewer never mutates), only the blanks —
  // an uploaded picture is never replaced. Runs after the repair above so it sees the new list.
  useEffect(() => {
    if (!edit) return
    const items: Any[] = Array.isArray((c as Any).experience?.items) ? (c as Any).experience.items : []
    if (!items.length) return
    let dead = false
    fetch('/api/reports/building-photos?all=1').then(r => r.json()).then(j => {
      if (dead) return
      if (j && j.listings) setBuildingListings(j.listings)
      if (j && j.chosen) setBuildingChosen(j.chosen)
      if (j && j.auto) setBuildingAuto(j.auto)
      const photos: Record<string, string> = (j && j.photos) || {}
      const auto: Record<string, string> = (j && j.auto) || {}
      // Fill a blank tile, and replace an AUTO picture (first Guesty shot) with the one chosen for
      // all decks. A picture somebody uploaded by hand on this deck is never touched.
      // A deck seeded before every property had a key: borrow the key from the house list by name,
      // so Monroe's picture is saved under the same key on every deck.
      const houseB = (it: Any) => it.b || (EXPERIENCE_ITEMS.find(x => x.k === it.k) || {}).b || ''
      const keyOf = (it: Any) => String(houseB(it) || it.k || '')
      const stale = (it: Any) => it && keyOf(it) && photos[keyOf(it)] && (!it.pic || (it.pic === auto[keyOf(it)] && it.pic !== photos[keyOf(it)]))
      if (!items.some(stale) && !items.some(it => !it.b && houseB(it))) return
      mutate(d => {
        const ex = d.experience || (d.experience = {})
        if (Array.isArray(ex.items)) ex.items = ex.items.map((it: Any) => ({ ...it, b: houseB(it) || undefined, ...(stale(it) ? { pic: photos[keyOf(it)] } : {}) }))
      })
    }).catch(() => { /* blank tiles; Change still works */ })
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, (c as Any).experience?.items?.length])
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
  function addRecap(text: string, on: string) {
    const tx = String(text || '').trim()
    if (!tx) return
    // THE OWNER REVIEW HAS NO RECAP SLIDE. The onboarding deck ends on one, which is where its
    // notes belong; a review ends on the work we did. So on a review the note is appended to the
    // slide that was on the glass when it was typed — the same content.slideNotes entry the
    // slide already renders, so the owner sees it in context rather than as a list at the end.
    if (!isOnboarding) {
      const key = presentNoteKey()
      if (key) {
        const cur = String(((c.slideNotes || {}) as Any)[key] || '')
        patch('slideNotes.' + key, cur ? cur + '\n' + tx : tx)
        answerChanged()
        return
      }
    }
    mutate(d => {
      const n = d.notes || (d.notes = {})
      n.recap = Array.isArray(n.recap) ? n.recap : []
      n.recap.push({ t: tx, on, at: new Date().toISOString() })
    })
    answerChanged()
  }
  /** The note key of the slide currently on the glass (or the first one, outside present mode). */
  function presentNoteKey(): string {
    if (present) return String(navNotes[slide] || '')
    const el = scrollRef.current
    const n = el ? el.querySelector('[data-note]') : null
    return n ? String(n.getAttribute('data-note') || '') : ''
  }
  function editRecap(i: number, text: string) { patch('notes.recap.' + i + '.t', text); answerChanged() }
  function removeRecap(i: number) {
    mutate(d => { const n = d.notes || {}; if (Array.isArray(n.recap)) n.recap.splice(i, 1) })
    answerChanged()
  }
  // TIDY WITH AI (Jon, 2026-09-21: "AI ability to rewrite the note to be better organized,
  // keep the original draft in case it does not work"). The rewrite goes through the same
  // section editor the slides use. The first time it runs, the raw notes are kept as
  // notes.recapDraft so "Restore original" always has the presenter's own words to go back to.
  async function tidyRecap() {
    const recap: Any[] = Array.isArray((c.notes || {}).recap) ? (c.notes || {}).recap : []
    if (!recap.length || tidyBusy) return
    setTidyBusy(true); setTidyMsg('')
    try {
      const r = await fetch('/api/reports/ai-edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: initial.id, sectionKey: 'notes', section: { recap },
          prompt: 'These are the presenter\u2019s notes typed during an owner onboarding call, in order. Rewrite them as a clean recap for the owner: group related points, one clear sentence per item, plain professional English, no fluff. Keep every fact, figure, name and date exactly; add nothing. Merge duplicates, split run-ons. Keep each item\u2019s "on" and "at" fields (use the source item\u2019s values; when merging, use the first). Return the same shape: { "recap": [ { "t", "on", "at" } ] }.',
        }),
      })
      const d = await r.json().catch(() => ({}))
      const rows: Any[] = d?.ok && d?.section && Array.isArray(d.section.recap) ? d.section.recap : []
      const clean = rows.map((x: Any) => ({ t: String((x && x.t) || '').trim(), on: String((x && x.on) || ''), at: String((x && x.at) || '') })).filter(x => x.t)
      if (!clean.length) { setTidyMsg((d && d.error) || 'Could not tidy \u2014 notes unchanged.'); setTidyBusy(false); return }
      mutate(dd => {
        const n = dd.notes || (dd.notes = {})
        if (!Array.isArray(n.recapDraft) || !n.recapDraft.length) n.recapDraft = JSON.parse(JSON.stringify(recap))
        n.recap = clean
      })
      answerChanged()
      setTidyMsg('Tidied. Your original is kept \u2014 Restore original brings it back.')
    } catch { setTidyMsg('Could not tidy \u2014 notes unchanged.') }
    setTidyBusy(false)
  }
  function restoreRecap() {
    mutate(d => {
      const n = d.notes || (d.notes = {})
      if (Array.isArray(n.recapDraft) && n.recapDraft.length) { n.recap = n.recapDraft; delete n.recapDraft }
    })
    answerChanged(); setTidyMsg('Original restored.')
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
      if (section) {
        patch('pacing', section)
        // SAY WHEN THE READ WAS CORRECTED (2026-09-22). The PDF is read off a chart, so the
        // server reconciles it against arithmetic and our own board before it lands on the
        // slide. A silent correction is the same trap as a silent misread -- Jon has to know
        // which numbers came out of the document and which ones we fixed.
        const notes: string[] = Array.isArray((section as any).notes) ? (section as any).notes : []
        if (notes.length) setAttachMsg('Read and corrected: ' + notes.join(' '))
      }
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

  // THE MONTH + SECTION PHOTOGRAPHY (Jon, 2026-09-22 rebuild). Both are derived rather than stored,
  // so every review that already existed gained them on deploy. `gallery` is resolved server-side
  // from the report's own listings (lib/report-gallery) and is empty when nothing usable came back,
  // in which case every section falls back to plain typography.
  const verdict = useMemo(() => (isOnboarding ? null : buildVerdict(c)), [c, isOnboarding])
  // DECK OR REPORT (Jon, 2026-09-22: "more like a powerpoint view"). The review now renders on the
  // same fixed 1120x630 canvas as the onboarding deck — which is what lib/deck was built for — and
  // opens there. The scrolling report is kept behind a toggle rather than deleted because the
  // period resync, the basis pickers and the attach-a-PDF buttons all live in its sections; losing
  // them to make the owner view prettier would be a bad trade.
  const [reviewDeck, setReviewDeck] = useState(true)
  // Which budget month the deck's Against-budget slide is detailing. Jon, 2026-09-22: "Budget
  // should show how we are trending for the next month and be able to add previous months and as
  // many future months as we want." The rail shows every month loaded; this picks the one whose
  // lines are broken out beneath it.
  const [planIx, setPlanIx] = useState(0)
  // Which money the per-listing slide shows. Jon asked for gross AND net "but make it a selecter"
  // (2026-09-22) — both by default, because the two answer different questions: gross is what the
  // guest paid us, net is what the statement is built on, and an owner asking "what did 515 make?"
  // usually means the first while their accountant means the second.
  const [listingCols, setListingCols] = useState<'both' | 'gross' | 'net'>('both')
  const isReviewDeck = !isOnboarding && reviewDeck
  const isDeck = isOnboarding || isReviewDeck
  const setVerdict = (next: Any) => patch('verdict', next)
  // A fixed order so a photo belongs to the same section every time the page renders, and so the
  // snapshot — which sits directly under The Month — is left clean rather than double-imaged.
  // Everything the photo picker can offer. Onboarding decks carry content.photoPool; an owner
  // review never has one, so without the gallery the picker opened on an empty grid and the only
  // way to change a picture was to paste a URL.
  const pickPool: string[] = (() => {
    const a = Array.isArray(c.photoPool) ? (c.photoPool as string[]) : []
    const b = Array.isArray(gallery) ? gallery : []
    const seen: Record<string, true> = {}
    return a.concat(b).filter(u => !!u && !seen[u] && (seen[u] = true))
  })()
  const PHOTO_ORDER = ['pacing', 'plan', 'statement', 'ahead', 'voices', 'projects']
  const photoFor = (key: string): string | null => {
    const pics = Array.isArray(gallery) ? gallery : []
    if (!pics.length) return null
    const i = PHOTO_ORDER.indexOf(key)
    return i >= 0 && i < pics.length ? pics[i] : null
  }
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
  // A custom slide is kept if it has ANY content — a photo page and a notes page are both
  // legitimately empty of body copy on the day they are added (Jon, 2026-09-22).
  const customSecs: Any[] = (Array.isArray(c.custom) ? c.custom : []).filter((cs: Any) => cs && (String(cs.title || '').trim() || String(cs.body || '').trim() || String(cs.kind || '') === 'photos' || String(cs.kind || '') === 'notes'))
  // JON'S EIGHT, PLUS ANY EXTRA SWITCHED BACK ON (see the onboarding block below). Present mode
  // counts slides off this, so a deck with the extras off says "6 of 8" and not "6 of 17".
  const onboardingSectionKeys = ['welcome', 'agenda', 'team', 'overview', 'experience', 'craft', 'guestcare',
    'revenue', 'stack', 'listings', 'guesty', 'statement', 'notes',
    'unit', 'strategy', 'ramp', 'rampsteps', 'season', 'ai', 'tech', 'money', 'comms', 'checklist', 'nextup']
  const onboardingListingSlides = isOnboarding && !isHidden('listings')
    ? (Array.isArray((c.listings || {}).items) ? (c.listings as Any).items.length : 0)
    : 0
  const presentCount = isOnboarding
    ? 1 + onboardingSectionKeys.filter(k => !isHidden(k)).length + onboardingListingSlides + customSecs.length
    : isReviewDeck
    // COUNT WHAT RENDERS, NOT WHAT MIGHT. The first version counted one slide per section key and
    // reported 11 where 12 were on the page: the listing table paginates at nine rows a slide, and
    // sections with no data build no slide at all. Present mode then ran out of numbers before it
    // ran out of deck.
    ? (1
        + ((verdict && !isHidden('verdict')) ? 1 : 0)
        + (!isHidden('snapshot') ? 1 : 0)
        + ((listingTable && listingTable.rows.length && !isHidden('listings')) ? 1 : 0)
        + ((c.pacing && (c.pacing.rows || []).length && !isHidden('pacing')) ? 1 : 0)
        + ((plan && (plan.months || []).length && !isHidden('plan')) ? 1 : 0)
        + ((c.statement && (((c.statement.kpis || []).length) || ((c.statement.months || []).length)) && !isHidden('statement')) ? 1 : 0)
        + (((ahead.months || []).length && !isHidden('ahead')) ? 1 : 0)
        + ((((voices.quotes || []).length || (voices.themes || []).length) && !isHidden('voices')) ? 1 : 0)
        + ((recs && (recs.items || []).length && !isHidden('recs')) ? 1 : 0)
        + (((projects.weeks || []).length && !isHidden('projects')) ? 1 : 0)
        + customSecs.length)
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
            {/* DECK OR REPORT (Jon, 2026-09-22). Deck is what the owner sees; Report is where the
                period resync, the basis pickers and the attach buttons live. */}
            {!isOnboarding && (
              <span className="inline-flex items-center gap-1 rounded-full p-0.5" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
                {([[true, 'Deck'], [false, 'Report']] as [boolean, string][]).map(([v, lab]) => (
                  <button key={lab} onClick={() => setReviewDeck(v)} className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                    style={reviewDeck === v ? { background: t.ink, color: t.bg } : { color: t.sub }}>
                    {lab}
                  </button>
                ))}
              </span>
            )}
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
            {/* Type size — the whole deck at once. See TextScale for why it is a canvas trick. */}
            <span className="inline-flex items-center gap-1 rounded-full p-0.5" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5" style={{ color: t.sub }}>Size</span>
              {TEXT_SIZES.map(z => (
                <button key={z.k} onClick={() => setStyle({ textSize: z.k })} title={'Type size: ' + z.label}
                  className="rounded-full px-2 py-1 text-[11px] font-semibold"
                  style={sizeKey === z.k ? { background: t.ink, color: t.bg } : { color: t.sub }}>
                  {z.label}
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
          {/* PDF is the format an owner can actually be sent (Jon, 2026-09-17). The print
              stylesheet already lays the deck out one slide to a landscape page at full size, so
              this only has to leave edit mode first — the dashed field outlines and the spill
              badge are tools, not something to hand someone — and open the print dialog, where
              "Save as PDF" is the destination. Rendering server-side would mean a headless
              browser in the deploy; the browser already here does it faithfully, because it is
              the same engine that drew the slides. */}
          <button
            onClick={() => {
              if (edit) setEdit(false)
              setTimeout(() => { try { window.print() } catch { /* dialog blocked */ } }, edit ? 400 : 60)
            }}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold"
            style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}
            title="One slide per page — choose Save as PDF in the print dialog">
            <Download size={12} /> PDF
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
          {/* LOCK IN AS THE STANDARD (Jon, 2026-09-24). Two clicks, because it rewrites the template
              every future deck is generated from. Saves this deck first so what is locked in is
              what is on screen. */}
          {edit && isOnboarding && (
            <button onClick={async () => {
                if (stdArm !== 'armed') { setStdArm('armed'); setTimeout(() => setStdArm(a => a === 'armed' ? '' : a), 6000); return }
                setStdArm('busy')
                try {
                  await save()
                  const r = await fetch('/api/reports/standard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: initial.id }) })
                  const d = await r.json().catch(() => ({}))
                  setStdArm(r.ok && d?.ok ? 'done' : 'fail'); setTimeout(() => setStdArm(''), 3000)
                } catch { setStdArm('fail'); setTimeout(() => setStdArm(''), 3000) }
              }}
              disabled={stdArm === 'busy'} title="Every new onboarding deck will start with this deck's wording, sections and pictures"
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold disabled:opacity-60"
              style={stdArm === 'armed' ? { background: t.gold, color: t.ink } : { background: t.card, border: '1px solid ' + t.toolbarBorder }}>
              {stdArm === 'busy' ? <Loader2 size={12} className="animate-spin" /> : <Star size={12} />}
              {stdArm === 'armed' ? 'Click again to make this the standard' : stdArm === 'busy' ? 'Locking in…' : stdArm === 'done' ? 'This is the standard ✓' : stdArm === 'fail' ? 'Could not lock in' : 'Make this the standard'}
            </button>
          )}
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

        /* ── THE SLIDE ──────────────────────────────────────────────────
           Read as a page, a deck is a stack of cards with a little lift under each — that
           shadow is what says "slide" before a single word is read. Presented, the same card
           loses its edges and fills the glass. Identical composition either way, because the
           canvas inside is always 1120×630 and only the scale changes. */
        .sb-slide { position: relative; width: 100%; aspect-ratio: 16 / 9; overflow: hidden;
          border-radius: 16px; background: ${t.card}; border: 1px solid ${t.cardBorder};
          box-shadow: 0 22px 46px -30px rgba(0,0,0,0.42), 0 2px 6px -3px rgba(0,0,0,0.10); }
        .sb-slide-canvas { position: absolute; top: 0; left: 0; transform-origin: top left;
          box-sizing: border-box; }
        .sb-deck > section { margin-top: 26px !important; border-top: 0 !important; }
        .sb-deck > section:first-of-type { margin-top: 0 !important; }
        .sb-deck > header { padding-bottom: 26px !important; }
        /* Inside a slide the app's utility resets do not apply, so the two live-editing fields
           carry their own type rather than inheriting a 15px default from a class. */
        .sb-slide .onb-live, .sb-slide .onb-copy { width: 100%; background: transparent;
          border: 1px solid transparent; border-radius: 8px; padding: 4px 8px; margin-left: -8px;
          font-family: inherit; color: ${t.body}; resize: vertical; }
        .sb-slide .onb-copy { font-size: 14.5px; line-height: 1.7; }
        /* The listing title is a headline on its slide, so it is set like one — display face,
           not the 15px form field it used to be. */
        .sb-slide .onb-title-live { width: 100%; background: transparent; border: 1px solid transparent;
          border-radius: 8px; padding: 2px 8px; margin-left: -8px; color: ${t.ink};
          font-size: 30px; line-height: 1.2; letter-spacing: -0.02em;
          font-family: ${fontPair.display || 'inherit'}; }
        .sb-slide p.onb-title-live { padding: 2px 0; margin-left: 0; }
        /* Any slide headline, whether it is an h2 or a p standing in for one. */
        .sb-slide .onb-h { font-family: ${fontPair.display || 'inherit'} !important;
          font-weight: 400 !important; letter-spacing: -0.02em; }
        .sb-slide .onb-live { font-size: 15px; }
        /* Only a deck gets the inset treatment; a scrolling report keeps its own background. */
        .sb-present-deck { background: ${blend(t.bg, t.ink, darkGround ? 0.10 : 0.14)} !important; }
        .sb-present-deck .sb-slide[data-tall] { overflow-y: auto; overscroll-behavior: contain; }
        .sb-present-deck .sb-slide, .sb-present-deck .onb-cover {
          border-radius: 12px; border: 0;
          box-shadow: 0 30px 70px -34px rgba(0,0,0,0.5);
          width: min(90vw, calc(82vh * 16 / 9)) !important;
          min-height: 0 !important; aspect-ratio: 16 / 9; }
        @supports (height: 100dvh) {
          .sb-present-deck .sb-slide, .sb-present-deck .onb-cover { width: min(90vw, calc(82dvh * 16 / 9)) !important; }
        }
        /* A 16:9 SLIDE ON A PHONE HELD UPRIGHT (Jon, 2026-09-17: "we need to make it better on
           phone too"). An owner opens the link on a phone, and the deck is authored on a 1120px
           canvas: across 390px of portrait screen that is a scale of 0.31, so a 13px label lands
           at 4px. Nobody reads that.
           The screen has 844px the other way. Turning the slide a quarter turn spends the long
           axis on the long edge of the slide: min(95vh, 173vw), which on a 390x844 phone is a
           675px slide instead of 351 — the same 13px label at 7.8px, near twice the size, with
           the whole slide still on screen. The rotated box is 380 x 675 inside 390 x 844, which
           is where those two multipliers come from; change one and check the other.
           Turn the phone and the rule stops applying, because landscape already gives the slide
           the room it wants. */
        /* The selector carries BOTH root classes on purpose. A later rule in this same sheet
           sets a width of 100vw, flagged important, for narrow screens at equal specificity, and on equal
           specificity the last one wins — which is why the first version of this block rotated
           the slide correctly and then left it 390px long anyway. Naming both root classes
           outranks it whatever the order. */
        /* FLEX CENTRING CANNOT CENTRE SOMETHING WIDER THAN ITS CONTAINER, and this slide is
           deliberately wider: its LAYOUT box is 675px across inside a 390px phone, because only
           the rotation makes it fit. Asked to centre an item that overflows, the browser clamps
           it to the start edge rather than placing it at a negative offset, so the box sat at
           x=0 instead of x=-142 and the rotation pivoted 142px right of where it should have.
           Measured on a 390x844 phone: the slide landed at x=148 with a width of 380, i.e. its
           right edge at 528 against a 390px screen — a third of every slide cut off, and a dead
           grey band down the left. That is the "present mode does not work on phone".
           Pinning the centre with absolute positioning takes the slide out of flex flow, so
           there is no overflow to clamp and the pivot is exact: left/top 50% puts the box's
           corner at the centre, translate(-50%,-50%) pulls its own centre onto that point, and
           the rotation then happens about the middle of the screen by construction. */
        @media (max-width: 760px) and (orientation: portrait) {
          .sb-present.sb-present-deck > section, .sb-present.sb-present-deck > header {
            padding: 0 !important; overflow: hidden !important; position: relative !important; }
          .sb-present.sb-present-deck .sb-slide, .sb-present.sb-present-deck .onb-cover {
            width: min(95vh, 173vw) !important;
            height: auto !important;
            aspect-ratio: 16 / 9 !important;
            min-height: 0 !important;
            position: absolute !important;
            left: 50% !important;
            top: 50% !important;
            margin: 0 !important;
            transform: translate(-50%, -50%) rotate(90deg) !important;
            transform-origin: center center !important; }
        }
        .sb-present-deck .onb-cover-in { min-height: 0 !important; height: 100%; padding: 6% 6%; }
        /* A phone in portrait has no room to give away. */
        @media (max-width: 700px) {
          .sb-present-deck .sb-slide, .sb-present-deck .onb-cover { width: 100vw !important; border-radius: 0; }
        }
        /* The cover is the first thing an owner sees and the only slide that is allowed to be
           loud. It fills the glass when presenting and stays a tall card when read as a page. */
        .onb-cover { min-height: 460px; }
        .onb-cover-in { min-height: 460px; }
        .onb-more > summary { list-style: none; }
        .onb-more > summary::-webkit-details-marker { display: none; }
        .onb-more > summary::before { content: '+ '; }
        .onb-more[open] > summary::before { content: '– '; }
        @media (max-width: 860px) { .onb-team { grid-template-columns: 1fr 1fr !important; } }
        .sb-pick > span { opacity: 0; transition: opacity .13s ease; }
        .sb-pick:hover > span { opacity: 1; }
        .sb-pick:hover { box-shadow: inset 0 0 0 2px ${t.accent}; }
        /* Lists inside a slide scroll on their own and do not hand the wheel back to the page
           halfway through, which is what made the amenity list feel like it was stuck. */
        .onb-scroll { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin;
          scrollbar-color: ${t.cardBorder} transparent; }
        .onb-scroll::-webkit-scrollbar { width: 7px; }
        .onb-scroll::-webkit-scrollbar-thumb { background: ${t.cardBorder}; border-radius: 4px; }
        .onb-scroll::-webkit-scrollbar-track { background: transparent; }
        /* SAY WHEN THERE IS MORE (Jon, 2026-09-24: "make it more obvious when there is a scrollable
           section"). A thin grey bar was the only clue, and on a Mac it is invisible until you
           scroll. While a section has more below, it shows a pill that stays on the bottom edge,
           and its scrollbar takes the accent colour; both go away at the end of the list. */
        .onb-scroll[data-more="1"] { scrollbar-color: ${t.accent} transparent; }
        .onb-scroll[data-more="1"]::-webkit-scrollbar-thumb { background: ${t.accent}; }
        .onb-scroll[data-more="1"]::after { content: 'Scroll for more ↓'; position: sticky; bottom: 4px;
          display: block; width: max-content; margin: 10px 0 0 auto; padding: 4px 11px; border-radius: 999px;
          background: ${t.accent}; color: #fff; font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
          box-shadow: 0 3px 10px rgba(0,0,0,0.18); pointer-events: none; z-index: 2; }
        @media print { .onb-scroll::after { display: none !important; } }
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
        ${(fontPair as Any).body ? `
        .sb-report, .sb-present { font-family: ${(fontPair as Any).body}; }
        /* A high-contrast serif carries its weight through shape, not stroke — asking for 700
           of a 400-weight face is what makes browsers synthesise a smeared fake bold. */
        .sb-report h1, .sb-report h2, .sb-present h1, .sb-present h2 { font-weight: 400 !important; letter-spacing: -0.015em; }` : ''}
        /* Numbers align down a column everywhere — tables, stat rows, statements. */
        .sb-report, .sb-present { font-variant-numeric: tabular-nums; }
        /* A printed / PDF'd share page gets the report, not the chrome. */
        @media print {
          .sb-noprint { display: none !important; }
          .sb-report > section { break-inside: avoid; }
        }
        /* ONE SLIDE, ONE PAGE (Jon, 2026-09-17: "I can share this link with owners… in PDF
           format"). A deck on screen is a column of slides, each drawn on a 1120x630 canvas and
           scaled down by a transform to whatever width the column happens to be. Printed as-is
           that gives a strip of shrunken slides two to a sheet with the page breaks landing
           wherever they land.
           So for print the scale is dropped and the canvas prints at its authored size, one to a
           page, on a sheet cut to the same 16:9 — the page IS the slide, with no margin to
           letterbox it. The !important flag is what reaches the inline transform React writes.
           print-color-adjust keeps the navy slides navy; without it the dark pages come out
           white and the reversed type disappears. */
        /* The sheet must be at least as big as the slide or a sliver spills onto a page of
           its own: 1120x630px is 296.33 x 166.69mm, and a 296mm page is 1.3px short of the
           slide's width — which is exactly the blank 17th page the first PDF ended on. 297 x
           167mm clears it with about 2px to spare on each axis. */
        @page { size: 297mm 167mm; margin: 0; }
        @media print {
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          body * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .sb-report, .sb-deck { max-width: none !important; width: 1120px !important;
            margin: 0 !important; padding: 0 !important; }
          /* BREAK BEFORE, NEVER AFTER. Breaking after every slide asks for a page following
             the last one, and whatever sits at the end of the deck — even an empty node — lands
             on it: the first PDF came out 18 pages for 17 slides, the last one blank. Breaking
             BEFORE each slide except the opening cover gives exactly one page per slide with
             nothing trailing. */
          .sb-deck > section, .sb-deck > header {
            margin: 0 !important; padding: 0 !important; border: 0 !important;
            break-after: auto !important; page-break-after: auto !important;
            break-inside: avoid; page-break-inside: avoid; }
          .sb-deck > section { break-before: page; page-break-before: always; }
          .sb-deck > header { break-before: auto; page-break-before: auto; }
          /* Anything after the last slide is chrome, and chrome is not a page. The page-credit
             FOOTER is the one that kept producing a blank 17th sheet: 105px of centred text with
             no break rules on it, sitting past the final slide. Every slide already carries the
             mark in its own foot, so on paper this line has nothing left to say. */
          .sb-deck > div, .sb-deck > p, .sb-deck > footer { display: none !important; }
          .sb-slide, .onb-cover {
            width: 1120px !important; height: 630px !important; min-height: 0 !important;
            aspect-ratio: auto !important; border-radius: 0 !important; border: 0 !important;
            box-shadow: none !important; overflow: hidden !important; }
          .sb-slide-canvas { transform: none !important; width: 1120px !important; height: 630px !important; }
          /* The spill badge and the edit affordances are working tools, never artefacts on a
             page an owner is holding. */
          .sb-pick, textarea, input { border-color: transparent !important; background: transparent !important; }
        }
        /* SNAP ON PROXIMITY, NOT MANDATORY (Jon, 2026-09-16: "present mode moves seamlessly
           through the sections without cutting anything off"). Mandatory snapping pins the
           viewport to a slide's start, so any section TALLER than the glass — a listing review
           with five photos, the statement, a long checklist — simply could not be scrolled into;
           its bottom was unreachable. Proximity keeps the slide-to-slide feel for sections that
           fit and lets the tall ones scroll like a page. */
        .sb-present { position: fixed; inset: 0; height: 100vh; width: 100vw; overflow-y: scroll; scroll-snap-type: y proximity; scroll-behavior: smooth; z-index: 40; background: ${t.bg}; -ms-overflow-style: none; scrollbar-width: none; }
        .sb-present::-webkit-scrollbar { display: none; }
        .sb-present > section, .sb-present > header { min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; scroll-snap-align: start; scroll-snap-stop: normal; padding: 6vh 7vw; box-sizing: border-box; border: 0 !important; margin: 0 !important; }
        /* A slide brings its own 16:9 frame, so the presenter padding would only shrink it. */
        .sb-present-deck > section, .sb-present-deck > header {
          padding: 0 !important; display: flex !important; align-items: center !important;
          justify-content: center !important; }
        /* SectionShell wraps each slide in a plain div. In a centring flex row that div
           shrink-fits to its content's intrinsic width (1080px) while the slide sizes itself
           from the viewport (1181px) — so the slide overflowed its own wrapper to the right and
           sat 50px off centre with its edge clipped. The wrapper takes the full line and does
           the centring; the slide keeps its viewport-derived size. */
        /* Sections only. The cover builds its own absolutely-positioned layout inside the
           header, and forcing flex onto that wrapper made the mark a flex item that stretched
           to the full slide height — the logo filled the cover. */
        .sb-present-deck > section > div {
          width: 100% !important; display: flex !important; justify-content: center !important; }
        .sb-present-deck > header { width: 100%; }
        .sb-present-deck > header > div { margin-left: auto; margin-right: auto; }
        /* THE MARK IS CLAMPED, NOT NEGOTIATED. The cover's inner column is a flex container,
           and in present mode the slide is re-sized by CSS — between the two, the logo kept
           being handed a height it had not asked for and filled the cover. Inline height was
           not winning, so the size is pinned here where nothing downstream can touch it. */
        .onb-cover > div > img:first-child {
          height: 26px !important; max-height: 26px !important; width: auto !important;
          max-width: 190px !important; flex: 0 0 auto !important; align-self: flex-start !important;
          object-fit: contain !important; }
        .sb-present-deck .onb-cover > div > img:first-child {
          height: 24px !important; max-height: 24px !important; }
        .sb-present-deck .sb-slide, .sb-present-deck .onb-cover { margin-left: auto !important; margin-right: auto !important; flex: 0 0 auto; }
        /* A slide taller than the glass stops centring — otherwise its first line sits above the
           top edge with nothing to scroll back to. */
        .sb-present > section > * { max-height: none; }
        .sb-present > header > .relative, .sb-present > header > div { padding: 0 !important; }
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
            <img src={mark.logo} alt={mark.word} style={{ height: 16, width: 'auto', objectFit: 'contain', opacity: 0.75, ...(mark.style || {}) }} />
          ) : (
            <span className="text-[9.5px] font-bold" style={{ color: t.muted, letterSpacing: '0.36em' }}>{mark.word}</span>
          )}
        </div>
      )}

      {/* PRESENTER NOTES: the button and drawer exist only for a signed-in presenter. An owner
          on the share link never sees them; the recap they produce lands on the last slide. */}
      {canEdit && (isOnboarding || isReviewDeck) && (() => { const recap: Any[] = Array.isArray((c.notes || {}).recap) ? (c.notes || {}).recap : []; return (
        <div className="sb-noprint fixed z-[64]" style={{ left: 16, bottom: 72 }}>
          {notesOpen ? (
            <div className="rounded-2xl shadow-2xl" style={{ width: 340, maxHeight: '62vh', display: 'flex', flexDirection: 'column', background: t.card, border: '1px solid ' + t.toolbarBorder }}>
              <div className="flex items-center justify-between" style={{ padding: '10px 14px', borderBottom: '1px solid ' + t.rule }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: t.ink }}>Presenter notes</span>
                <button onClick={() => setNotesOpen(false)} style={{ color: t.muted }} aria-label="Close notes"><X size={14} /></button>
              </div>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid ' + t.rule }}>
                <textarea
                  value={noteDraft}
                  onChange={e => setNoteDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addRecap(noteDraft, present ? (navNames[slide] || '') : ''); setNoteDraft('') } }}
                  placeholder="Type a note, press Enter"
                  rows={2}
                  style={{ width: '100%', resize: 'none', fontSize: 13, lineHeight: 1.5, padding: '8px 10px', borderRadius: 8, border: '1px solid ' + t.cardBorder, background: t.bg, color: t.ink, fontFamily: 'inherit', outline: 'none' }}
                />
                <div className="flex items-center justify-between" style={{ marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: t.muted }}>
                    {isOnboarding
                      ? (present && navNames[slide] ? 'On: ' + navNames[slide] : 'Lands on the last slide as the recap')
                      : (presentNoteKey() ? 'Lands on ' + (present && navNames[slide] ? navNames[slide] : 'this slide') : 'Move to a slide that takes a note')}
                  </span>
                  <button onClick={() => { addRecap(noteDraft, present ? (navNames[slide] || '') : ''); setNoteDraft('') }}
                    style={{ fontSize: 12, fontWeight: 600, borderRadius: 999, padding: '5px 12px', background: t.ink, color: t.bg }}>Add</button>
                </div>
              </div>
              {(recap.length > 0 || (Array.isArray((c.notes || {}).recapDraft) && (c.notes || {}).recapDraft.length > 0)) ? (
                <div className="flex items-center" style={{ gap: 8, padding: '8px 14px', borderBottom: '1px solid ' + t.rule, flexWrap: 'wrap' }}>
                  {recap.length > 0 ? (
                    <button onClick={tidyRecap} disabled={tidyBusy}
                      className="inline-flex items-center gap-1"
                      style={{ fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: '5px 11px', background: t.card, border: '1px solid ' + t.cardBorder, color: t.ink, opacity: tidyBusy ? 0.6 : 1 }}>
                      {tidyBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} {tidyBusy ? 'Tidying\u2026' : 'Tidy with AI'}
                    </button>
                  ) : null}
                  {Array.isArray((c.notes || {}).recapDraft) && (c.notes || {}).recapDraft.length > 0 ? (
                    <button onClick={restoreRecap}
                      style={{ fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: '5px 11px', background: 'transparent', border: '1px dashed ' + t.cardBorder, color: t.sub }}>
                      Restore original
                    </button>
                  ) : null}
                  {tidyMsg ? <span style={{ fontSize: 11, color: t.muted, width: '100%' }}>{tidyMsg}</span> : null}
                </div>
              ) : null}
              <div style={{ overflowY: 'auto', padding: '6px 14px 10px' }}>
                {recap.length === 0 ? (
                  <p style={{ fontSize: 12, color: t.muted, padding: '8px 0' }}>No notes yet.</p>
                ) : recap.map((r: Any, i: number) => (
                  <div key={i} className="flex items-start" style={{ gap: 8, padding: '7px 0', borderTop: i ? '1px solid ' + t.rule : 'none' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {r.on ? <p style={{ fontSize: 10.5, color: t.muted }}>{r.on}</p> : null}
                      <p style={{ fontSize: 13, lineHeight: 1.45, color: t.ink, whiteSpace: 'pre-line' }}>{r.t}</p>
                    </div>
                    <button onClick={() => removeRecap(i)} title="Remove" style={{ color: t.muted, flexShrink: 0 }}><X size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <button onClick={() => setNotesOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-semibold shadow-lg"
              style={{ background: t.card, border: '1px solid ' + t.toolbarBorder, color: t.ink }}>
              <Pencil size={12} /> Notes{recap.length ? ' \u00b7 ' + recap.length : ''}
            </button>
          )}
        </div>
      ) })()}

      {/* Answers save themselves; say so once, briefly, so a presenter can trust it. */}
      {askSaved && (
        <div className="sb-noprint fixed bottom-5 right-5 z-[65] rounded-full px-3.5 py-2 text-[12px] font-semibold shadow-lg"
          style={{ background: t.card, border: '1px solid ' + t.toolbarBorder, color: t.good }}>
          <Check size={12} className="inline -mt-0.5 mr-1" /> Answer saved
        </div>
      )}

      {/* WHAT A SHARED LINK OFFERS: the deck, and a way to full-screen it. Nothing else.
          (Jon, 2026-09-17: "make the shareable link uneditable.") The document was already
          read-only for anyone without a login or the team cookie — no fields, no contenteditable
          — but it still put a "Team edit" button in the corner of the owner's screen. That is an
          invitation to try the door of a document about their own money, and the answer to
          "can I change this?" should be that there is nothing there to ask. The team still
          unlocks the same way: open it signed in, or use ?edit=1 with the password prompt from
          the reports desk. */}
      {!canEdit && !present && (
        <div className="sb-noprint fixed top-4 right-4 z-30 flex items-center gap-2">
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

      {opt && (
        <div className="sb-noprint fixed inset-0 z-[80] flex items-center justify-center p-5"
          style={{ background: 'rgba(10,14,20,0.66)' }}
          onClick={() => { if (!optBusy) { setOpt(null); setOptMsg(''); setOptInstr('') } }}>
          <div onClick={e => e.stopPropagation()} className="rounded-2xl w-full max-w-xl p-5"
            style={{ background: t.card, border: '1px solid ' + t.cardBorder }}>
            <p className="text-[15px] font-semibold" style={{ color: t.ink }}>Optimize this listing</p>
            <p className="text-[13px] mt-1" style={{ color: t.muted }}>
              {opt.name} &mdash; writes a new title and description to the house rules. It fills the slide; pushing to Guesty stays a separate click.
            </p>
            <textarea
              value={optInstr}
              onChange={e => setOptInstr(e.target.value)}
              rows={3}
              placeholder="Anything to steer it? e.g. lead with the balcony, this is a business traveller unit, drop the pool mention…"
              className="mt-3 w-full rounded-lg px-3 py-2 text-[13px]"
              style={{ background: t.chip, border: '1px solid ' + t.cardBorder, color: t.ink }}
            />
            {optMsg ? <p className="mt-2 text-[12.5px]" style={{ color: /could not|error|failed/i.test(optMsg) ? t.gold : t.sub }}>{optMsg}</p> : null}
            <div className="mt-3 flex items-center gap-2 justify-end">
              <button disabled={optBusy} onClick={() => { setOpt(null); setOptMsg(''); setOptInstr('') }}
                className="rounded-lg px-3.5 py-2 text-[13px] font-semibold" style={{ color: t.sub }}>Cancel</button>
              <button
                disabled={optBusy}
                onClick={async () => {
                  setOptBusy(true); setOptMsg('Writing\u2026 this takes up to a minute.')
                  try {
                    const r = await fetch('/api/optimize-listing', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ listingId: opt.id, instruction: optInstr.trim() || undefined }),
                    })
                    const d = await r.json().catch(() => ({}))
                    if (!r.ok || !d?.proposed) { setOptMsg(d?.error || 'Could not optimize this listing.'); setOptBusy(false); return }
                    mutate(dr => {
                      const it = dr.listings.items[opt.li]
                      if (d.proposed.title) it.title = String(d.proposed.title)
                      if (d.proposed.summary) it.summary = String(d.proposed.summary)
                      if (d.proposed.space) it.space = String(d.proposed.space)
                    })
                    answerChanged()
                    setOptBusy(false)
                    setOpt(null); setOptInstr('')
                    setCopyMsg(m => ({ ...m, [opt.id]: 'Draft written \u2014 read it, then push.' }))
                  } catch {
                    setOptMsg('Could not reach the optimizer.'); setOptBusy(false)
                  }
                }}
                className="rounded-lg px-3.5 py-2 text-[13px] font-semibold disabled:opacity-50"
                style={{ background: t.ink, color: t.bg }}>
                {optBusy ? 'Writing\u2026' : 'Write a new draft'}
              </button>
            </div>
          </div>
        </div>
      )}

      {propPick && (() => {
        const groups = buildingListings[propPick.b] || []
        const pics = pickGroup ? (groups.find(g => g.id === pickGroup)?.pics || []) : Array.from(new Set(groups.flatMap(g => g.pics)))
        const choose = async (u: string) => {
          // Clearing the saved choice puts the building's own first photo back, never a blank tile.
          patch('experience.items.' + propPick.i + '.pic', u || buildingAuto[propPick.b] || ''); answerChanged()
          setPropMsg('Saving for all decks…')
          try {
            const r = await fetch('/api/reports/building-photos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ building: propPick.b, url: u }) })
            if (!r.ok) throw new Error()
            setBuildingChosen(c => ({ ...c, [propPick.b]: u }))
            setPropPick(null); setPropMsg('')
          } catch { setPropMsg('Set on this deck, but could not save it for the others.') }
        }
        return (
          <div className="sb-noprint fixed inset-0 z-[80] flex items-center justify-center p-5" style={{ background: 'rgba(10,14,20,0.66)' }}
            onClick={() => { if (!upBusy) setPropPick(null) }}>
            <div onClick={e => e.stopPropagation()} className="rounded-2xl w-full max-w-3xl max-h-[86vh] overflow-auto p-5" style={{ background: t.card, border: '1px solid ' + t.cardBorder }}>
              <div className="flex items-center justify-between gap-4 mb-1">
                <p className="text-[15px] font-semibold" style={{ color: t.ink }}>{propPick.name}</p>
                <button onClick={() => setPropPick(null)} className="rounded-full p-1.5" style={{ color: t.sub }}><X size={16} /></button>
              </div>
              <p className="text-[12.5px] mb-4" style={{ color: propMsg ? t.gold : t.muted }}>{propMsg || 'Pick a photo. It is saved for every onboarding deck, not just this one.'}</p>
              {groups.length > 1 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {[{ id: '', name: 'All units' }, ...groups].map(g => (
                    <button key={g.id} onClick={() => setPickGroup(g.id)} className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
                      style={{ background: pickGroup === g.id ? t.ink : t.chip, color: pickGroup === g.id ? t.bg : t.ink, border: '1px solid ' + (pickGroup === g.id ? t.ink : t.cardBorder) }}>{g.name}</button>
                  ))}
                </div>
              )}
              {pics.length > 0 ? (
                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
                  {pics.map((src: string, i: number) => (
                    <button key={i} onClick={() => choose(src)} className="relative rounded-lg overflow-hidden"
                      style={{ aspectRatio: '4 / 3', border: '2px solid ' + (src === propPick.cur ? t.accent : 'transparent') }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </button>
                  ))}
                </div>
              ) : (
                // No listing on Guesty for this one (the Garden, the Monroe): upload is the only way.
                <label className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-semibold cursor-pointer" style={{ background: t.ink, color: t.bg, opacity: upBusy ? 0.6 : 1 }}>
                  <UploadCloud size={14} /> {upBusy ? 'Uploading…' : 'No listing photos for this property — upload one'}
                  <input type="file" accept="image/*" disabled={upBusy} className="hidden" onChange={async e => {
                    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return
                    setUpBusy(true)
                    try {
                      const fd = new FormData(); fd.append('file', f)
                      const r = await fetch('/api/deck-photo', { method: 'POST', body: fd }); const d = await r.json().catch(() => ({}))
                      if (r.ok && d?.url) await choose(String(d.url)); else setPropMsg(d?.error || 'Upload failed.')
                    } catch { setPropMsg('Could not reach the server.') }
                    setUpBusy(false)
                  }} />
                </label>
              )}
              {buildingChosen[propPick.b] && (
                <button onClick={() => choose('')} className="mt-4 text-[12.5px] font-semibold" style={{ color: t.accent }}>Clear the saved choice</button>
              )}
            </div>
          </div>
        )
      })()}

      {photoPick && (
        <div className="sb-noprint fixed inset-0 z-[80] flex items-center justify-center p-5"
          style={{ background: 'rgba(10,14,20,0.66)' }}
          onClick={() => { if (!upBusy) { setPhotoPick(null); setPhotoUrl(''); setUpMsg('') } }}>
          <div onClick={e => e.stopPropagation()} className="rounded-2xl w-full max-w-3xl max-h-[86vh] overflow-auto p-5"
            style={{ background: t.card, border: '1px solid ' + t.cardBorder }}>
            <div className="flex items-center justify-between gap-4 mb-4">
              <p className="text-[15px] font-semibold" style={{ color: t.ink }}>{photoPick.title}</p>
              <button onClick={() => { setPhotoPick(null); setPhotoUrl('') }} className="rounded-full p-1.5" style={{ color: t.sub }}><X size={16} /></button>
            </div>
            {/* UPLOAD FIRST, because it is the answer for every photo that is not already on
                the listing — headshots above all (Jon, 2026-09-17: "have upload path for all
                images"). Paste-a-URL stays underneath for a portal screenshot already hosted. */}
            <div className="mb-3">
              <label className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-semibold cursor-pointer"
                style={{ background: t.ink, color: t.bg, opacity: upBusy ? 0.6 : 1 }}>
                <UploadCloud size={14} />
                {upBusy ? 'Uploading\u2026' : 'Upload a photo'}
                <input
                  type="file"
                  accept="image/*"
                  disabled={upBusy}
                  className="hidden"
                  onChange={async e => {
                    const f = e.target.files && e.target.files[0]
                    e.target.value = ''
                    if (!f) return
                    setUpBusy(true); setUpMsg('')
                    try {
                      const fd = new FormData()
                      fd.append('file', f)
                      const r = await fetch('/api/deck-photo', { method: 'POST', body: fd })
                      const d = await r.json().catch(() => ({}))
                      if (!r.ok || !d?.url) { setUpMsg(d?.error || 'Upload failed.'); setUpBusy(false); return }
                      photoPick.set(String(d.url)); answerChanged()
                      setUpBusy(false); setPhotoPick(null); setPhotoUrl(''); setUpMsg('')
                    } catch {
                      setUpMsg('Could not reach the server.'); setUpBusy(false)
                    }
                  }}
                />
              </label>
              <span className="text-[12px] ml-3" style={{ color: upMsg ? t.gold : t.muted }}>
                {upMsg || 'JPG or PNG, up to 12MB. Resized and optimised automatically.'}
              </span>
            </div>
            <div className="flex gap-2 mb-4">
              <input value={photoUrl} onChange={e => setPhotoUrl(e.target.value)} placeholder="Or paste an image URL — a headshot, a portal screenshot…"
                className="flex-1 rounded-lg px-3 py-2 text-[13px]" style={{ background: t.chip, border: '1px solid ' + t.cardBorder, color: t.ink }} />
              <button disabled={!photoUrl.trim()}
                onClick={() => { photoPick.set(photoUrl.trim()); answerChanged(); setPhotoPick(null); setPhotoUrl('') }}
                className="rounded-lg px-3.5 py-2 text-[13px] font-semibold disabled:opacity-40"
                style={{ background: t.ink, color: t.bg }}>Use</button>
            </div>
            {pickPool.length > 0 && (
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] mb-2" style={{ color: t.muted }}>Or pick one from the listing</p>
            )}
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))' }}>
              {pickPool.map((src: string, i: number) => (
                <button key={i} onClick={() => { photoPick.set(src); answerChanged(); setPhotoPick(null); setPhotoUrl('') }}
                  className="relative rounded-lg overflow-hidden" style={{ aspectRatio: '4 / 3', border: '2px solid ' + (src === photoPick.cur ? t.accent : 'transparent') }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              ))}
            </div>
            {photoPick.cur ? (
              <button onClick={() => { photoPick.set(''); answerChanged(); setPhotoPick(null) }}
                className="mt-4 text-[12.5px] font-semibold" style={{ color: t.accent }}>Clear this photo</button>
            ) : null}
          </div>
        </div>
      )}

      <div ref={scrollRef} onScroll={onPresentScroll} className={present ? ('sb-present' + (isDeck ? ' sb-present-deck' : '')) : ('sb-report ' + (isDeck ? 'sb-deck max-w-[1180px]' : 'max-w-4xl') + ' mx-auto px-5 sm:px-8 pb-20')}>

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
                  <img src={mark.logo} alt={mark.word} style={{ height: 26, width: 'auto', alignSelf: 'flex-start', objectFit: 'contain', filter: 'invert(1) brightness(2.2)' }} />
                ) : (
                  <p className="text-[11px] font-bold" style={{ color: '#fff', letterSpacing: '0.42em', alignSelf: 'flex-start' }}>{mark.word}</p>
                )}
                <div className="mt-auto pt-16">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.26em]" style={{ color: 'rgba(255,255,255,0.72)' }}>
                    <Ed v={hero.dateLabel || 'OWNER ONBOARDING'} set={v => patch('hero.dateLabel', v)} edit={edit} />
                  </p>
                  <h1 className="mt-3 text-[34px] sm:text-[46px] font-semibold tracking-[-0.025em] leading-[1.05]" style={{ color: '#fff', maxWidth: '18ch' }}>
                    <Ed v={hero.title || ''} set={v => patch('hero.title', v)} edit={edit} />
                  </h1>
                  <p className="mt-4 text-[16px] sm:text-[18px] leading-[1.5]" style={{ color: 'rgba(255,255,255,0.86)', maxWidth: '42ch' }}>
                    <Ed v={isOnboarding ? houseLine(hero.headline, HERO_HEADLINE) : (hero.headline || '')} set={v => patch('hero.headline', v)} edit={edit} multiline />
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
              {edit && (
                <button
                  onClick={() => { setPhotoUrl(''); setPhotoPick({ title: 'Cover photo', cur: String(hero.heroImage || ''), set: u => patch('hero.heroImage', u) }) }}
                  className="sb-noprint absolute bottom-4 right-4 rounded-full px-3.5 py-2 text-[11.5px] font-semibold shadow"
                  style={{ background: 'rgba(255,255,255,0.94)', color: '#111' }}>
                  Change cover photo
                </button>
              )}
            </div>
          </header>
        ) : (
        isReviewDeck ? null : (
        <header className="relative pt-20 sm:pt-28 pb-16 sm:pb-20 text-center border-b" style={{ borderColor: t.rule }}>
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
          <h1 className="mt-2.5 text-[52px] sm:text-[76px] font-black tracking-[-0.03em] leading-[0.95]" style={{ color: t.ink }}>
            <Ed v={hero.title || ''} set={v => patch('hero.title', v)} edit={edit} />
          </h1>
          <p className="mt-6 text-lg sm:text-[22px] font-medium max-w-2xl mx-auto leading-[1.45]" style={{ color: t.body }}>
            <Ed v={isOnboarding ? houseLine(hero.headline, HERO_HEADLINE) : (hero.headline || '')} set={v => patch('hero.headline', v)} edit={edit} multiline />
          </p>
          {hero.heroImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hero.heroImage} alt="" className="mt-10 w-full rounded-[22px] object-cover" style={{ height: 'clamp(260px, 44vw, 520px)', border: '1px solid ' + t.cardBorder, boxShadow: '0 30px 60px -32px rgba(0,0,0,0.38)' }} />
          )}
          <p className="mt-8 text-[12px] uppercase tracking-[0.18em] font-semibold" style={{ color: t.footA }}>
            <Ed v={hero.preparedFor || ''} set={v => patch('hero.preparedFor', v)} edit={edit} />  ·  STAY HOSPITALITY
          </p>
        </header>
        ))}


        {/* ═══════════ OWNER ONBOARDING — the deck ═══════════
            AUDIT, 2026-09-16. Jon: "make it look like a power point but in my app format…
            needs to look amazing." What was wrong was never the type sizes:

            1. IT WAS A DOCUMENT, NOT A DECK. Sections were stacked divs that happened to snap.
               Nothing was composed, because there was no canvas to compose onto. Now every
               slide is authored at 1120×630 and scaled to its container, so the thing Jon
               builds on the page IS the thing the owner sees on the call, proportion for
               proportion.
            2. THIRTEEN SLIDES, ONE SHAPE. Every section was a left-aligned single column.
               A deck needs rhythm: full-bleed, split, grid, panel, and at least one dark slide
               to punctuate. There are now six layouts and two dark slides.
            3. PHOTOGRAPHS WERE DECORATION. They sat in 21:9 bands between paragraphs. On a
               slide a photograph either bleeds off an edge or holds half the composition —
               it is the argument, not the garnish. It is the owner's own property.
            4. NO FURNITURE. Real decks have a footer, a section mark and a slide number. That
               one detail carries more "this is a real deck" than any amount of type tuning.
            5. NO MEASURE DISCIPLINE. Body copy ran to 62 characters at essay length. Slide
               copy is 46–52 characters and stops.

            Phones: a 16:9 canvas on a portrait phone is inherently ~5× too small, which is why
            every deck tool renders slides small there and lets you rotate or pinch. Same here,
            with a rotate hint. Jon presents from a desktop; the owner reads on one. */}
        {isOnboarding && (() => {
          const sec = (k: string): Any => {
            const v = c[k]
            if (PITCH_DEFAULTS[k] && v && typeof v === 'object' && pitchSectionStale(v, k)) return PITCH_DEFAULTS[k]
            return v || {}
          }
          const hid = (k: string) => isHidden(k) || !c[k] || typeof c[k] !== 'object'
          const pool: string[] = Array.isArray(c.photoPool) ? c.photoPool : []
          // Section photography starts past the frames the listing slides use as their own
          // heroes, so the same room does not turn up on the cover, the welcome and the gallery.
          const heroCount = Math.min(pool.length - 1, ((sec('listings').items || []).length || 0) + 1)
          const pic = (n: number) => (pool.length ? pool[(n + Math.max(0, heroCount)) % pool.length] : '')

          // Ink on a dark slide. Two of these in the deck, and they are what stop thirteen
          // cream rectangles reading as a single long beige afternoon.
          const D = {
            ink: '#ffffff',
            body: 'rgba(255,255,255,0.86)',
            muted: 'rgba(255,255,255,0.56)',
            rule: 'rgba(255,255,255,0.22)',
          }
          // THREE GROUNDS, DERIVED FROM THE THEME so a deck can run in Capri, Ocean or Dark Luxe
          // without a single slide knowing which. `tint` is the bone pulled 7% toward the ink —
          // enough to separate two reading slides, not enough to read as a coloured box.
          const GROUND: Record<SlideTone, string> = {
            light: t.card,
            // The tint was the theme's cream washed 7% toward navy, which produces a cool grey —
            // and grey is where the accent and the muted label both fell under the contrast floor.
            // The theme's own `chip` is the same warmth as the ground, one step down, and every
            // token clears 4.5:1 against it.
            tint: t.chip,
            dark: t.band,
          }
          // Brass earns its keep on the tinted ground, where clay on bone goes muddy. Two
          // accents, each with one job, is the difference between layered and busy.
          const brass = t.gold

          const CORE: { k: string; label: string }[] = [
            { k: 'welcome', label: 'Welcome' },
            { k: 'agenda', label: 'Agenda' },
            { k: 'team', label: 'Your team' },
            { k: 'overview', label: 'About Stay Hospitality' },
            { k: 'experience', label: 'Our properties' },
            { k: 'craft', label: 'The listing' },
            { k: 'channels', label: 'Where it sells' },
            { k: 'guestcare', label: 'The guest experience' },
            { k: 'revenue', label: 'Revenue management' },
            { k: 'stack', label: 'The tech stack' },
            { k: 'listings', label: 'Your listing' },
            { k: 'season', label: 'The season' },
            { k: 'ramp', label: 'Ramp' },
            { k: 'rampsteps', label: 'How we shorten it' },
            { k: 'guesty', label: 'Owner portal' },
            { k: 'statement', label: 'Owner statements' },
            { k: 'notes', label: 'Other notes' },
          ]
          const EXTRA: { k: string; label: string }[] = [
            { k: 'unit', label: 'Your unit' }, { k: 'strategy', label: 'Goals & strategy' },
            { k: 'ai', label: 'Lighthouse' }, { k: 'tech', label: 'Your tech' }, { k: 'money', label: 'Billables' },
            { k: 'comms', label: 'Communication' }, { k: 'checklist', label: 'Still to do' },
            { k: 'nextup', label: 'What happens next' },
          ]
          const askSecs = CORE.concat(EXTRA)
          // EACH OPEN ITEM REMEMBERS WHERE IT CAME FROM (Jon, 2026-09-22: "Still cant edit").
          // This roll-up was built as flat {label, q} strings, so the closing slide could list an
          // open question but had no way back to the ask it came from — the one list a presenter
          // actually works through at the end of a call was the one list that was read-only. Each
          // row now carries its section key and index, so the question is editable and the answer
          // is typed right here, closing the item off the same slide it is listed on.
          const open: { label: string; q: string; k: string; i: number }[] = []
          // The communication slide no longer shows its questions (Jon, 2026-09-21), so they
          // neither count nor appear as open on the last slide.
          const asksShown = (k: string) => !hid(k) && k !== 'comms' && k !== 'ai'  // ai: removed 2026-09-24
          for (const x of askSecs) {
            if (!asksShown(x.k)) continue
            const as: Any[] = Array.isArray(sec(x.k).asks) ? sec(x.k).asks : []
            as.forEach((a: Any, ai: number) => {
              if (!String(a.a || '').trim()) open.push({ label: x.label, q: houseAsk(a.q), k: x.k, i: ai })
            })
          }
          const answered = askSecs.reduce((n, x) => n + (!asksShown(x.k) ? 0 : (sec(x.k).asks || []).filter((a: Any) => String(a.a || '').trim()).length), 0)
          const totalAsks = answered + open.length

          // ── slide furniture ────────────────────────────────────────────────
          let pageNo = 0
          const Foot = ({ label, dark }: { label: string; dark?: boolean }) => {
            pageNo += 1
            const n = pageNo
            return (
              <div className="flex items-center justify-between pt-4" style={{ borderTop: '1px solid ' + (dark ? D.rule : t.rule) }}>
                <span style={{ fontSize: 11.5, letterSpacing: '0.08em', color: dark ? D.muted : t.muted }}>{label}</span>
                <span className="flex items-center" style={{ gap: 13 }}>
                  {mark.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mark.logo} alt={mark.word} style={{
                      height: 14, width: 'auto', objectFit: 'contain', display: 'block',
                      opacity: dark ? 0.8 : 0.55,
                      filter: (dark || darkGround) ? 'invert(1) brightness(2.2)' : undefined,
                    }} />
                  ) : (
                    <span style={{ fontSize: 11.5, letterSpacing: '0.16em', color: dark ? D.muted : t.muted }}>{mark.word}</span>
                  )}
                  <span style={{ fontSize: 11.5, color: dark ? D.muted : t.muted, borderLeft: '1px solid ' + (dark ? D.rule : t.rule), paddingLeft: 13 }}>
                    {String(n).padStart(2, '0')}
                  </span>
                </span>
              </div>
            )
          }

          // Title block. An accent hairline sits under the eyebrow — the one place the brand
          // colour appears on a light slide, which is what makes it read as a mark rather than
          // as decoration sprayed across every label.
          // HOUSE LINES THAT MOVED ON. Only the retired text verbatim is replaced, so a deck
          // whose headline was edited keeps the edit; see lib/onboarding-copy for why the test is
          // deliberately this blunt. Both of these used to assume the unit had not opened yet.
          const HOUSE_HEAD = SECTION_HEAD
          const HOUSE_SUB = SECTION_SUB
          // The team line counts the cards rather than saying "four" — see lib/onboarding-copy.
          const teamCount = ((sec('team').people || []) as Any[]).length
          const Title = ({ k, dark, sub, rule, narrow }: { k: string; dark?: boolean; sub?: boolean; rule?: string; narrow?: boolean }) => (
            <div>
              <div style={{ width: 30, height: 2, background: rule || (dark ? D.ink : t.accent), marginBottom: 18 }} />
              <h2 style={{
                fontSize: narrow ? 34 : TYPE.title.size, lineHeight: TYPE.title.line, letterSpacing: TYPE.title.track,
                fontWeight: 600, color: dark ? D.ink : t.ink, maxWidth: narrow ? '15ch' : '17ch', margin: 0,
              }}>
                <Ed v={HOUSE_HEAD[k] ? houseLine(sec(k).headline, HOUSE_HEAD[k]) : (sec(k).headline || '')} set={v => patch(k + '.headline', v)} edit={edit} multiline />
              </h2>
              {sub !== false && (sec(k).subtitle || edit) ? (
                <p style={{ marginTop: 14, fontSize: 16.5, lineHeight: 1.55, color: dark ? D.muted : t.muted, maxWidth: '50ch' }}>
                  <Ed v={k === 'team' ? houseTeamSubtitle(sec(k).subtitle, teamCount) : HOUSE_SUB[k] ? houseLine(sec(k).subtitle, HOUSE_SUB[k]) : (sec(k).subtitle || '')} set={v => patch(k + '.subtitle', v)} edit={edit} multiline />
                </p>
              ) : null}
            </div>
          )

          // TWO COLUMNS FOR THE WORDY SLIDES (Jon, 2026-09-24: "Some of the wording is not showing").
          // Headline, subtitle and the paragraph stacked on the left used most of the slide's height
          // before the list began, so every list ran off the bottom into a scroll area nobody saw.
          // The argument goes on the left, the list gets the full height on the right, the same
          // answer the How-we-run-it slide reached.
          const Split = ({ k, left, right, leftW, dark }: { k: string; left?: React.ReactNode; right: React.ReactNode; leftW?: number; dark?: boolean }) => (
            <div className="flex-1 min-h-0 flex" style={{ gap: 44, paddingBottom: 18 }}>
              <div className="flex flex-col min-h-0 onb-scroll" style={{ width: leftW || 340, flexShrink: 0 }}>
                <Title k={k} narrow dark={dark} />
                {left}
              </div>
              <div className="flex-1 min-w-0 min-h-0 flex flex-col onb-scroll">
                {/* Top-aligned (2026-09-24 audit): centred, the list floated at a different height on
                    every slide and never lined up with the headline beside it. */}
                <div style={{ width: '100%', paddingTop: 2 }}>{right}</div>
              </div>
            </div>
          )
          const leftBody = (v: string, set: (v: string) => void, top?: number) => (
            <p style={{ fontSize: 14, lineHeight: 1.6, color: t.body, marginTop: top == null ? 18 : top, paddingTop: 16, borderTop: '1px solid ' + t.cardBorder, whiteSpace: 'pre-line' }}>
              <Ed v={v} set={set} edit={edit} multiline />
            </p>
          )

          // A photograph that holds half the composition and bleeds off the slide edge.
          const Half = ({ src, side, title, set }: {
            src: string; side: 'left' | 'right'; title?: string; set?: (u: string) => void
          }) => (
            <Pick
              title={title || 'Choose a photo'}
              cur={src}
              set={set || (() => {})}
              style={{ position: 'absolute', top: 0, bottom: 0, width: 452, [side]: 0, background: t.chip } as Any}
            />
          )

          // Any image in the deck, with the picker hung off it in edit mode. `Edit photo` only
          // appears for the team; everywhere else the whole frame is the target, because on a
          // gallery slide a button per frame would be five buttons on five photographs.
          // `pos` is object-position. It matters most for faces: a cover crop defaults to the
          // middle of the source, and the middle of a portrait photograph is a torso.
          const Pick = ({ title, cur, set, style, cover, pos, choices, choicesLabel, groups }: {
            title: string; cur: string; set: (u: string) => void; style?: Any; cover?: boolean; pos?: string; choices?: string[]; choicesLabel?: string; groups?: { id: string; name: string; pics: string[] }[]
          }) => (
            <div style={{ position: 'relative', overflow: 'hidden', ...(style || {}) }}>
              {cur ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cur} alt="" style={{ width: '100%', height: '100%', objectFit: cover === false ? 'contain' : 'cover', objectPosition: pos || 'center' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', background: t.chip }} />
              )}
              {/* IN EDIT MODE, NOT WHENEVER YOU HAPPEN TO HAVE PERMISSION (Jon, 2026-09-17:
                  "the change photo needs to show in edit mode"). Gated on canEdit, a "Change"
                  chip sat on every photo any time Jon had the deck open — including the moment
                  he shares his screen on the call, where it reads as a half-built page. It is a
                  tool, so it appears when the tools are out. */}
              {edit && (
                <button
                  onClick={() => { setPhotoUrl(''); setPickGroup(''); setPhotoPick({ title, cur, set, choices, choicesLabel, groups }) }}
                  className="sb-noprint sb-pick"
                  title="Change this photo"
                  style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0, cursor: 'pointer' }}>
                  <span style={{
                    position: 'absolute', bottom: 10, right: 10, fontSize: 11, fontWeight: 600,
                    padding: '5px 11px', borderRadius: 999, background: 'rgba(255,255,255,0.94)', color: '#111',
                  }}>Change</span>
                </button>
              )}
            </div>
          )

          // `dark`: on a dark-ground slide the question was drawn in the light theme's ink — navy on
          // navy, so the question itself vanished and only the hint showed (Jon, 2026-09-24, the
          // "How we run it" slide: "this looks terrible"). The dark palette goes to the block too.
          const Asks = ({ k, dark, top }: { k: string; dark?: boolean; top?: number }) => {
            const as: Any[] = Array.isArray(sec(k).asks) ? sec(k).asks : []
            if (!as.length && !edit) return null
            const tt = dark ? { ...t, ink: D.ink, body: D.body, muted: D.muted, rule: D.rule } : t
            return (
              <div style={{ marginTop: top == null ? 26 : top }}>
                <p style={{ fontSize: 12, color: tt.muted, marginBottom: 14 }}><Lab id="onTheCall" d="On the call" /></p>
                <div className="flex flex-col" style={{ gap: 14 }}>
                  {as.map((a: Any, i: number) => (
                    <AskBlock key={a.id || i} ask={a} live={canEdit} t={tt} edit={edit}
                      set={v => setAnswer(k, i, v)}
                      setQ={v => patch(k + '.asks.' + i + '.q', v)}
                      setHint={v => patch(k + '.asks.' + i + '.hint', v)}
                      onRemove={() => mutate((d: Any) => { const sc = d[k]; if (sc && Array.isArray(sc.asks)) sc.asks.splice(i, 1) })} />
                  ))}
                </div>
                {edit ? (
                  <button className="sb-noprint" style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: t.accent }}
                    onClick={() => mutate((d: Any) => { const sc = d[k] || (d[k] = {}); sc.asks = Array.isArray(sc.asks) ? sc.asks : []; sc.asks.push({ id: 'a' + Date.now().toString(36), q: '', hint: '' }) })}>
                    + Add a question
                  </button>
                ) : null}
              </div>
            )
          }

          // EVERY WORD ON THIS DECK IS EDITABLE (Jon, 2026-09-22: "on owner onboarding we need to
          // be able to edit all texts"). The section copy always was; what was not, and what an
          // owner still reads, are the fixed LABELS — "On the call", "Password", "Category",
          // "Worth adding". They are written once here and stored per report under
          // content.labels.<id>, so a label Jon retypes on one owner's deck stays retyped on that
          // deck and every other deck keeps the house wording.
          const Lab = ({ id, d, style, className }: { id: string; d: string; style?: Any; className?: string }) => {
            const saved = String((c.labels || {})[id] || '').trim()
            return (
              <span className={className} style={style}>
                <Ed v={saved || d} set={v => patch('labels.' + id, v)} edit={edit} />
              </span>
            )
          }

          const slides: { key: string; node: React.ReactNode; ai?: boolean }[] = []

          // ── 1 · WELCOME — split, photo bleeding right ──────────────────────
          if (!hid('welcome')) slides.push({ key: 'welcome', ai: true, node: (
            <Slide nav="Welcome" warn={edit} bleed ground={GROUND.light}>
              <div style={{ position: 'absolute', inset: 0 }}>
                <Half src={String(sec('welcome').photo || pic(0))} side="right"
                  title="Welcome slide photo" set={u => patch('welcome.photo', u)} />
                <div style={{ position: 'absolute', top: 64, bottom: 44, left: 64, width: 586 }} className="flex flex-col">
                  <div className="flex-1 min-h-0 flex flex-col justify-center">
                    <Title k="welcome" sub={false} narrow />
                    <p style={{ marginTop: 20, fontSize: 17, color: t.muted }}>
                      <Ed v={sec('welcome').subtitle || ''} set={v => patch('welcome.subtitle', v)} edit={edit} />
                    </p>
                    <p style={{ marginTop: 26, fontSize: 19, lineHeight: 1.65, color: t.body, maxWidth: '42ch', whiteSpace: 'pre-line' }}>
                      <Ed v={houseLine(sec('welcome').body, WELCOME_BODY)} set={v => patch('welcome.body', v)} edit={edit} multiline />
                    </p>
                  </div>
                  <div style={{ paddingBottom: 18 }}>
                    <p style={{ fontSize: 12.5, color: t.muted }}>
                      {String(hero.preparedFor || '')}
                      {meta.asOf ? '\u2002\u00b7\u2002' + new Date(String(meta.asOf) + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''}
                    </p>
                  </div>
                  <Foot label="Welcome" />
                </div>
              </div>
            </Slide>
          ) })

          // ── 2 · AGENDA — two columns ───────────────────────────────────────
          if (!hid('agenda')) slides.push({ key: 'agenda', node: (
            <Slide nav="Agenda" warn={edit} ground={GROUND.tint}>
              <div className="flex flex-col h-full">
                <Title k="agenda" sub={false} rule={brass} />
                <div className="flex-1 min-h-0" style={{ marginTop: 30 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 52, rowGap: 0 }}>
                    {(agendaStale(sec('agenda').items) ? (AGENDA_ROWS as Any[]) : (sec('agenda').items || [])).slice(0, 8).map((it: Any, i: number) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '30px 1fr', columnGap: 14, padding: '14px 0', borderTop: '1px solid ' + t.rule, alignItems: 'baseline' }}>
                        <span style={{ fontSize: 12.5, color: brass, fontWeight: 600 }}>{String(i + 1).padStart(2, '0')}</span>
                        <div>
                          <p style={{ fontSize: 16, fontWeight: 600, color: t.ink, lineHeight: 1.35 }}>
                            <Ed v={it.k || ''} set={v => patch('agenda.items.' + i + '.k', v)} edit={edit} />
                          </p>
                          <p style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.55, color: t.muted }}>
                            <Ed v={it.v || ''} set={v => patch('agenda.items.' + i + '.v', v)} edit={edit} multiline />
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <Foot label="Agenda" />
              </div>
            </Slide>
          ) })

          // ── 3 · THE TEAM — four up, with the contact details on the card ───
          if (!hid('team')) slides.push({ key: 'team', node: (
            <Slide nav="Your team" warn={edit} ground={GROUND.light}>
              <div className="flex flex-col h-full">
                <Title k="team" />
                {/* FOUR WAS A HARD CAP, AND THAT WAS THE BUG (Jon, 2026-09-17: "need to be
                    able to edit meet the team names, roles, etc. Not letting me"). The fields
                    themselves were always editable; what was missing was any way to ADD a fifth
                    person or remove one, so a roster that did not happen to be exactly these
                    four could not be made right at all. The grid now follows the count, to six
                    — past that the cards are too narrow to read on a call. */}
                <div className="flex-1 min-h-0 flex items-start" style={{ marginTop: 22, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + Math.min(6, Math.max(1, (sec('team').people || []).length || 1)) + ',1fr)', gap: (sec('team').people || []).length > 4 ? 16 : 24, width: '100%' }}>
                    {/* CONTACT SITS ON THE FLOOR OF THE CARD, NOT UNDER THE ROLE. Two of these
                        four have a direct line and two do not, so a block that simply follows
                        the role puts half the emails on one baseline and half a line lower —
                        four cards, two ragged rows of addresses. Pushing the block to the bottom
                        of an equal-height card lands every email on the same line whether or not
                        there is a number above it. */}
                    {(sec('team').people || []).slice(0, 6).map((p: Any, pi: number) => (
                      <div key={pi} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        {/* ZOOM OUT BY MAKING THE FRAME PORTRAIT, NOT BY MAKING IT SHORTER
                            (Jon, 2026-09-17: "readjust my photo, general manager, to fit better
                            — zoom it out, not so in"). The frame ran the full card width at 229
                            x 149, and `object-fit: cover` fills that from a 798 x 1200 headshot
                            by scaling until the WIDTH matches — which leaves 43% of the person's
                            height on screen and 57% cropped away. Height was not the lever: the
                            card cannot grow. Width was. At 124 x 155 the same photo shows 83% of
                            its height, because the box is now shaped like the thing inside it.
                            A landscape headshot trades the other way and loses side margin it
                            can afford. See the arithmetic in the commit.

                            A HEADSHOT IS A PORTRAIT, AND THIS FRAME WAS A LETTERBOX (Jon,
                            2026-09-17: "fix the photo headshots, look at the way they look").
                            230px wide by 132 tall is a horizontal band, and `object-fit: cover`
                            fills it from the middle of the source — so a phone photo of a
                            colleague came out as a strip across their chest with the head cut
                            off above it. The frame is now taller than it is wide, and the crop
                            is pulled up to where a face actually sits in a portrait. */}
                        {p.photo ? (
                          <Pick
                            title={'Headshot \u2014 ' + String(p.name || '')}
                            cur={String(p.photo)}
                            set={u => patch('team.people.' + pi + '.photo', u)}
                            pos="center 20%"
                            style={{ width: 120, aspectRatio: '4 / 5', borderRadius: 12, marginBottom: 10 }}
                          />
                        ) : (
                          <div
                            onClick={edit ? () => { setPhotoUrl(''); setPhotoPick({ title: 'Headshot \u2014 ' + String(p.name || ''), cur: '', set: u => patch('team.people.' + pi + '.photo', u) }) } : undefined}
                            style={{ width: 120, aspectRatio: '4 / 5', borderRadius: 12, marginBottom: 10, background: t.chip, color: t.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 600, letterSpacing: '0.04em', cursor: canEdit ? 'pointer' : 'default' }}>
                            {String(p.name || '?').trim().split(/\s+/).slice(0, 2).map((w: string) => w[0]).join('')}
                          </div>
                        )}
                        <p style={{ fontSize: 16, fontWeight: 600, color: t.ink, letterSpacing: '-0.01em' }}>
                          <Ed v={p.name || ''} set={v => patch('team.people.' + pi + '.name', v)} edit={edit} />
                        </p>
                        <p style={{ fontSize: 12.5, color: t.accent, marginTop: 2 }}>
                          <Ed v={p.role || ''} set={v => patch('team.people.' + pi + '.role', v)} edit={edit} />
                        </p>
                        {/* NO BLURB (Jon, 2026-09-17: "just remove this part of the about team,
                            title is fine"). Two clamped lines ending in an ellipsis said less
                            than the role above them already did, and four of them across the row
                            read as four unfinished sentences. The name and the title carry it.
                            The field is still on the record and still saved to the template — it
                            is only off this card, so nothing is lost if it earns a place back. */}
                        {/* CONTACT ON THE CARD (Jon, 2026-09-16: "Contact info"). The whole
                            promise of this slide is that the owner leaves with a number, not
                            an inbox — so the number is on the slide, not in a footnote. */}
                        {/* The card is down to a name, a title and how to reach them, so an
                            empty contact block is just a stray rule under a role. It draws only
                            when there is something in it, or when you are editing and need the
                            fields to type into. */}
                        {/* MEASURED, NOT ESTIMATED. The row gives the card 270px and the card
                            wanted 295, so the last line — the email, the thing an owner is meant
                            to write to — was sliced in half by the support band. The portrait
                            keeps its 4:5 shape, so taking it from 142 to 120 wide scales it
                            rather than re-cropping it: still 83% of the person in frame, 28px
                            back in the budget, and the whole card inside the row. */}
                        {(p.phone || p.email || edit) ? (
                        <div style={{ marginTop: 'auto', paddingTop: 9, borderTop: '1px solid ' + t.rule }}>
                          <p style={{ fontSize: 12.5, color: t.ink }}>
                            <Ed v={p.phone || ''} set={v => patch('team.people.' + pi + '.phone', v)} edit={edit} placeholder="Direct line" />
                          </p>
                          <p style={{ fontSize: 12.5, color: t.muted, marginTop: 2, wordBreak: 'break-all' }}>
                            <Ed v={p.email || ''} set={v => patch('team.people.' + pi + '.email', v)} edit={edit} placeholder="Email" />
                          </p>
                        </div>
                        ) : null}
                        {edit && (
                          <button
                            onClick={() => mutate(d => { d.team.people.splice(pi, 1) })}
                            title={'Remove ' + String(p.name || 'this person')}
                            style={{ marginTop: 9, fontSize: 11.5, fontWeight: 600, color: t.accent }}>
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                {/* THE TEAM IS THE SAME TEAM ON EVERY DECK, SO THE HEADSHOTS SHOULD BE TOO
                    (Jon, 2026-09-17: "take photo that I uploaded and use as standard for all
                    slides"). An upload lands in this report's content JSON like any other edit,
                    which means the next deck opens with monograms and the same faces get
                    uploaded again. This writes the cards — names, roles, blurbs, contacts and
                    photos — into the onboarding template, so every deck built afterwards starts
                    with them. It touches nothing else in the template and no existing deck. */}
                {edit && (
                  <div className="sb-noprint flex items-center" style={{ marginTop: 12, gap: 12, flexWrap: 'wrap' }}>
                    {(sec('team').people || []).length < 6 && (
                      <button
                        onClick={() => mutate(d => {
                          d.team.people = Array.isArray(d.team.people) ? d.team.people : []
                          d.team.people.push({ name: '', role: '', blurb: '', photo: null, phone: '', email: '' })
                        })}
                        style={{ fontSize: 12.5, fontWeight: 600, borderRadius: 999, padding: '7px 15px', background: t.card, border: '1px dashed ' + t.cardBorder, color: t.ink }}>
                        + Add someone
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        setTeamSaveMsg('busy')
                        try {
                          const r = await fetch('/api/settings/onboarding-team', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ people: sec('team').people || [], support: sec('team').support || null }),
                          })
                          const d = await r.json().catch(() => ({}))
                          setTeamSaveMsg((d?.ok || r.ok) ? 'ok' : (d?.error || 'Could not save.'))
                        } catch { setTeamSaveMsg('Could not reach the server.') }
                      }}
                      style={{ fontSize: 12.5, fontWeight: 600, borderRadius: 999, padding: '7px 15px', background: t.ink, color: t.bg }}>
                      {teamSaveMsg === 'busy' ? 'Saving\u2026' : 'Use this team on every deck'}
                    </button>
                    {teamSaveMsg && teamSaveMsg !== 'busy' && (
                      <span style={{ fontSize: 12, color: teamSaveMsg === 'ok' ? t.good : t.gold }}>
                        {teamSaveMsg === 'ok'
                          ? 'Saved. Every onboarding generated from now on opens with these cards and these photos.'
                          : teamSaveMsg}
                      </span>
                    )}
                  </div>
                )}
                {/* The shared inbox, as the backstop behind the four names rather than a fifth
                    face. A slide that promises "you are not handed to an inbox" cannot then put
                    the inbox in the line-up. */}
                {(sec('team').support && (sec('team').support.email || edit)) ? (
                  <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid ' + t.rule, display: 'flex', alignItems: 'baseline', gap: 18 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: t.ink, whiteSpace: 'nowrap' }}>
                      <Ed v={sec('team').support.label || ''} set={v => patch('team.support.label', v)} edit={edit} />
                    </span>
                    <a href={'mailto:' + String(sec('team').support.email || '')} className="onb-link" style={{ fontSize: 13.5, color: t.accent, whiteSpace: 'nowrap' }}>
                      <Ed v={sec('team').support.email || ''} set={v => patch('team.support.email', v)} edit={edit} />
                    </a>
                    <span style={{ fontSize: 12.5, color: t.muted, lineHeight: 1.5 }}>
                      <Ed v={houseLine(sec('team').support.note, SUPPORT_NOTE)} set={v => patch('team.support.note', v)} edit={edit} multiline />
                    </span>
                  </div>
                ) : null}
                <Foot label="Your team" />
              </div>
            </Slide>
          ) })

          // ── 4 · ABOUT STAY — the dark brand slide ──────────────────────────
          if (!hid('overview')) slides.push({ key: 'overview', ai: true, node: (
            <Slide nav="About Stay" warn={edit} bleed>
              <div style={{ position: 'absolute', inset: 0, background: t.band }}>
                <Half src={String(sec('overview').photo || pic(4))} side="right"
                  title="About Stay photo" set={u => patch('overview.photo', u)} />
                <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 452, background: 'linear-gradient(90deg, ' + t.band + ' 0%, rgba(0,0,0,0) 42%)' }} />
                <div style={{ position: 'absolute', top: 64, bottom: 44, left: 64, width: 560 }} className="flex flex-col">
                  <div className="flex-1 min-h-0 onb-scroll">
                    <Title k="overview" dark sub={false} narrow />
                    {(() => {
                      const full = houseBody(sec('overview').body, OVERVIEW_BODY_RETIRED_MARK, OVERVIEW_BODY_2)
                      const cut = full.indexOf('\n\n')
                      const lead = cut > 0 ? full.slice(0, cut) : full
                      if (edit) {
                        return (
                          // THE ONLY SLIDE THAT STILL RAN LONG IN EDIT MODE. The reader sees
                          // just the opening paragraph here; the editor sees the whole body,
                          // both paragraphs, which is 500-odd characters and 49px more than the
                          // column has. Capping the box makes the overflow scroll inside the
                          // field being typed into, instead of pushing the stats and the footer
                          // off the bottom of the slide.
                          <p style={{ marginTop: 22, fontSize: 16, lineHeight: 1.6, color: D.body, whiteSpace: 'pre-line' }}>
                            <Ed v={full} set={v => patch('overview.body', v)} edit={edit} multiline max={168} />
                          </p>
                        )
                      }
                      // BOTH PARAGRAPHS (Jon, 2026-09-24: "some of the wording is not showing"). The
                      // reader used to get only the first; the second — whole buildings, and an
                      // in-house team — is the half that sets us apart.
                      void lead
                      return <p style={{ marginTop: 14, fontSize: 14.5, lineHeight: 1.5, color: D.body, maxWidth: '56ch', whiteSpace: 'pre-line' }}>{full.replace(/\n\n+/g, '\n\n')}</p>
                    })()}
                    <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid ' + D.rule, display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '14px 34px' }}>
                      {houseRows<Any>(sec('overview').stats, COMPANY_STATS_RETIRED_MARK, COMPANY_STATS_2 as Any[]).slice(0, 4).map((f: Any, i: number, arr: Any[]) => (
                        <div key={i} style={arr.length % 2 === 1 && i === arr.length - 1 ? { gridColumn: '1 / -1' } : undefined}>
                          <p style={{ fontSize: 19, fontWeight: 600, color: D.ink, letterSpacing: '-0.015em', lineHeight: 1.22 }}>
                            <Ed v={f.v || ''} set={v => patch('overview.stats.' + i + '.v', v)} edit={edit} multiline />
                          </p>
                          <p style={{ fontSize: 12, color: D.muted, marginTop: 4 }}>
                            <Ed v={f.k || ''} set={v => patch('overview.stats.' + i + '.k', v)} edit={edit} />
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <Foot label="About Stay Hospitality" dark />
                </div>
              </div>
            </Slide>
          ) })

          // ── 4b · OUR PROPERTIES ────────────────────────────────────────────
          // Boss (2026-09-24, via Jon): new title "Our Properties"; drop the subtitle and the
          // paragraph; "just make the whole slide our properties with a pic next to each one";
          // add "apartments" to Capri; add D225 and Nomad.
          //
          // So: the headline, then a grid of buildings, each a photograph with the name and the
          // one-line place under it. Pictures come from the building's own Guesty photos
          // (lib/building-photos.ts) — a hotel we do not list starts blank, and Change uploads it.
          // Scrolls if the list outgrows the canvas, since the list is the argument.
          if (!hid('experience')) slides.push({ key: 'experience', ai: true, node: (
            <Slide nav="Our properties" warn={edit}>
              <div className="flex flex-col" style={{ height: '100%' }}>
                <Title k="experience" sub={false} />
                {/* The little intro (Jon, 2026-09-24). One line; a deck that never had one gets the house line. */}
                {(sec('experience').intro !== '' || edit) && (
                  <p style={{ marginTop: 12, fontSize: 15.5, lineHeight: 1.5, color: t.muted, maxWidth: '62ch' }}>
                    <Ed v={sec('experience').intro == null ? EXPERIENCE_INTRO : sec('experience').intro} set={v => patch('experience.intro', v)} edit={edit} multiline />
                  </p>
                )}
                <div className="flex-1 min-h-0 onb-scroll" style={{ marginTop: 18, paddingBottom: 18 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '18px 20px' }}>
                    {(sec('experience').items || []).map((f: Any, i: number) => (
                      <div key={i} style={{ minWidth: 0 }}>
                        <div style={{ position: 'relative', overflow: 'hidden', width: '100%', aspectRatio: '4 / 3', borderRadius: 10, background: t.chip, border: '1px solid ' + t.cardBorder }}>
                          {f.pic ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={String(f.pic)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : null}
                          {edit && (
                            <button onClick={() => { setPickGroup(''); setPropMsg(''); setPropPick({ i, b: String(f.b || f.k || ''), name: String(f.k || 'property'), cur: String(f.pic || '') }) }}
                              className="sb-noprint sb-pick" title="Choose this property's photo"
                              style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0, cursor: 'pointer' }}>
                              <span style={{ position: 'absolute', bottom: 8, right: 8, fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.94)', color: '#111' }}>Change</span>
                            </button>
                          )}
                        </div>
                        {/* Name only under the picture (Jon, 2026-09-24: "No descriptions actually"). */}
                        <p style={{ fontSize: 13.5, fontWeight: 600, color: t.ink, letterSpacing: '-0.01em', lineHeight: 1.3, marginTop: 9 }}>
                          <Ed v={f.k || ''} set={v => patch('experience.items.' + i + '.k', v)} edit={edit} multiline />
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                <Foot label="Our properties" />
              </div>
            </Slide>
          ) })

          // ── 4c · WHAT WE DO TO THE LISTING ─────────────────────────────────
          // Jon, 2026-09-23: "let them know that we understand each aspect of the property: the
          // listing, the amenities, the descriptions, the distribution, the marketing, improving
          // ramp." Six numbered rows, in the order the work actually happens, so the owner can
          // picture it rather than take it on trust.
          if (!hid('craft')) slides.push({ key: 'craft', ai: true, node: (
            <Slide nav="The listing" warn={edit}>
              <div className="flex flex-col" style={{ height: '100%' }}>
                <Split k="craft"
                  left={leftBody(sec('craft').body || '', v => patch('craft.body', v))}
                  right={
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '16px 26px' }}>
                      {(sec('craft').rows || []).map((f: Any, i: number) => (
                        <div key={i} style={{ borderTop: '1px solid ' + t.cardBorder, paddingTop: 10 }}>
                          <p className="flex items-baseline" style={{ gap: 8, fontSize: 14, fontWeight: 600, color: t.ink, lineHeight: 1.3 }}>
                            <span style={{ fontSize: 11.5, fontWeight: 700, color: t.accent }}>{String(i + 1).padStart(2, '0')}</span>
                            <Ed v={f.k || ''} set={v => patch('craft.rows.' + i + '.k', v)} edit={edit} multiline />
                          </p>
                          <p style={{ fontSize: 13, lineHeight: 1.55, color: t.body, marginTop: 5 }}>
                            <Ed v={f.v || ''} set={v => patch('craft.rows.' + i + '.v', v)} edit={edit} multiline />
                          </p>
                        </div>
                      ))}
                    </div>
                  } />
                <Foot label="The listing" />
              </div>
            </Slide>
          ) })

          // ── 5 · WHERE IT SELLS — the distribution wall ─────────────────────
          // The most under-sold thing we do. An owner who self-managed was on one channel; the
          // count is the argument, so the count is set at display size and the logos-as-words
          // wall does the rest. No logo files: wordmarks we do not have licences for would look
          // worse than clean type, and type is what the rest of this deck is made of.
          // A DECK GENERATED BEFORE 2026-09-18 FROZE THE RETIRED PAIR. It carries "30+" as the
          // count and a one-line subtitle, over a wall the count does not match. Same treatment as
          // the season curve: the number and the paragraph are one claim, so they are substituted
          // together or not at all, and a deck edited on this slide keeps its edit because an
          // edited one will not still read exactly "30+".
          // Each field judged on itself. The first version keyed the PARAGRAPH's staleness on the
          // COUNT, so editing the paragraph changed nothing the test could see and the edit was
          // painted over on the next render.
          const chanCountStored = String(sec('channels').count || '').trim()
          const chanCount = (!chanCountStored || CHANNEL_COUNT_RETIRED.indexOf(chanCountStored) >= 0) ? CHANNEL_COUNT : chanCountStored
          const chanBody = channelBodyStale(sec('channels').subtitle) ? CHANNEL_BODY : (sec('channels').subtitle || '')

          if (!hid('channels')) slides.push({ key: 'channels', ai: true, node: (
            <Slide nav="Where it sells" warn={edit} ground={GROUND.dark} bleed>
              {/* BIG PICTURE, NOT AN INVENTORY (Jon, 2026-09-16: "prefer not list them all,
                  more big picture"). The old version was two columns of wordmarks and a tail of
                  sixteen more names — a directory. The argument is the count and the fact that
                  it is ONE calendar; the marks are there to be recognised in a glance, not
                  read. Five of them, one ink, on the brand ground.

                  THE BIG NUMBER IS REACH, NOT CONNECTIONS (Jon, 2026-09-18). We hold nine
                  channel connections; those nine reach 200+ booking sites, because Expedia and
                  Booking are networks rather than websites. The number carries the reach and
                  the paragraph carries the mechanism, so neither one has to be rounded up. */}
              <div style={{ position: 'absolute', inset: 0, background: t.band, padding: 64 }} className="flex flex-col">
                <div className="flex-1 min-h-0 flex flex-col justify-center">
                  <div style={{ width: 30, height: 2, background: D.ink, marginBottom: 22 }} />
                  <div className="flex items-end" style={{ gap: 26 }}>
                    <span style={{ fontSize: 96, fontWeight: 600, letterSpacing: '-0.045em', color: D.ink, lineHeight: 0.86 }}>
                      <Ed v={chanCount} set={v => patch('channels.count', v)} edit={edit} />
                    </span>
                    <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', color: D.ink, lineHeight: 1.2, paddingBottom: 6, maxWidth: '16ch' }}>
                      channels.<br />One calendar.
                    </span>
                  </div>
                  <p style={{ marginTop: 26, fontSize: 16.5, lineHeight: 1.65, color: D.body, maxWidth: '58ch' }}>
                    <Ed v={chanBody} set={v => patch('channels.subtitle', v)} edit={edit} multiline />
                  </p>

                  <div style={{ marginTop: 40, paddingTop: 30, borderTop: '1px solid ' + D.rule, display: 'flex', alignItems: 'center', gap: 52, flexWrap: 'wrap' }}>
                    {CHANNEL_MARKS.map(m => (
                      <svg key={m.name} role="img" aria-label={m.name} viewBox="0 0 24 24"
                        style={{ height: 30, width: 'auto', fill: 'rgba(255,255,255,0.88)', flex: '0 0 auto' }}>
                        <title>{m.name}</title>
                        <path d={m.d} />
                      </svg>
                    ))}
                    <span style={{ fontSize: 14, color: D.muted, maxWidth: '52ch' }}>+ Vrbo, Hopper, Blueground, Whimstay, Google Vacation Rentals</span>
                  </div>
                </div>
                <Foot label="Where it sells" dark />
              </div>
            </Slide>
          ) })

          // ── 5b · HOW A STAY IS RUN — the guest journey ─────────────────────
          // Jon, 2026-09-23: "a slide about the guest experience and what we do to make sure that
          // every guest is satisfied with their stay, from welcome calls to pre-arrival
          // inspections to departure cleans, at a high level. My standard checklist using
          // Breezeway technology."
          //
          // A sequence, not a service list, because the owner's real question is what happens to
          // their unit between one guest leaving and the next arriving. The Breezeway line is the
          // footer of the slide rather than a row in it: it is the evidence under all six stages.
          if (!hid('guestcare')) slides.push({ key: 'guestcare', ai: true, node: (
            <Slide nav="The guest experience" warn={edit} ground={GROUND.tint}>
              <div className="flex flex-col" style={{ height: '100%' }}>
                <Split k="guestcare"
                  left={<>
                    {leftBody(sec('guestcare').body || '', v => patch('guestcare.body', v))}
                    <p style={{ marginTop: 14, fontSize: 12.5, lineHeight: 1.55, color: t.muted }}>
                      <Ed v={sec('guestcare').note || ''} set={v => patch('guestcare.note', v)} edit={edit} multiline />
                    </p>
                  </>}
                  right={
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '16px 26px' }}>
                      {(sec('guestcare').stages || []).map((f: Any, i: number) => (
                        <div key={i} style={{ borderTop: '1px solid ' + t.cardBorder, paddingTop: 10 }}>
                          <p className="flex items-baseline" style={{ gap: 8, fontSize: 14, fontWeight: 600, color: t.ink, lineHeight: 1.3 }}>
                            <span style={{ fontSize: 11.5, fontWeight: 700, color: t.accent }}>{String(i + 1).padStart(2, '0')}</span>
                            <Ed v={f.k || ''} set={v => patch('guestcare.stages.' + i + '.k', v)} edit={edit} multiline />
                          </p>
                          <p style={{ fontSize: 13, lineHeight: 1.5, color: t.body, marginTop: 5 }}>
                            <Ed v={f.v || ''} set={v => patch('guestcare.stages.' + i + '.v', v)} edit={edit} multiline />
                          </p>
                        </div>
                      ))}
                    </div>
                  } />
                <Foot label="The guest experience" />
              </div>
            </Slide>
          ) })

          // ── 5c · HOW YOUR RATE GETS SET — revenue management ───────────────
          // Jon, 2026-09-23: "Talk about our revenue management, partnering with Pacer."
          //
          // The levers are the slide. Every competitor says "dynamic pricing" and means they
          // switched a tool on; six named levers is the difference, and minimum stay in
          // particular is the one owners have never had explained to them.
          if (!hid('revenue')) slides.push({ key: 'revenue', ai: true, node: (
            <Slide nav="Revenue management" warn={edit}>
              <div className="flex flex-col" style={{ height: '100%' }}>
                <Split k="revenue"
                  left={<>
                    {leftBody(sec('revenue').body || '', v => patch('revenue.body', v))}
                    <p style={{ marginTop: 14, fontSize: 12.5, lineHeight: 1.55, color: t.muted }}>
                      <Ed v={sec('revenue').note || ''} set={v => patch('revenue.note', v)} edit={edit} multiline />
                    </p>
                  </>}
                  right={
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '16px 26px' }}>
                      {(sec('revenue').rows || []).map((f: Any, i: number) => (
                        <div key={i} style={{ borderTop: '1px solid ' + t.cardBorder, paddingTop: 10 }}>
                          <p style={{ fontSize: 14, fontWeight: 600, color: t.ink, lineHeight: 1.3 }}>
                            <Ed v={f.k || ''} set={v => patch('revenue.rows.' + i + '.k', v)} edit={edit} multiline />
                          </p>
                          <p style={{ fontSize: 13, lineHeight: 1.55, color: t.body, marginTop: 5 }}>
                            <Ed v={f.v || ''} set={v => patch('revenue.rows.' + i + '.v', v)} edit={edit} multiline />
                          </p>
                        </div>
                      ))}
                    </div>
                  } />
                <Foot label="Revenue management" />
              </div>
            </Slide>
          ) })

          // WHO PACER ARE, ON ITS OWN SLIDE (2026-09-24). It sat under the six levers on the revenue
          // slide, which made that slide more than twice as tall as the canvas: the whole Pacer
          // block and the closing note were below the fold. Every figure is Pacer's own, about
          // Pacer's own book, and the slide says so.
          if (!hid('revenue') && (sec('revenue').partner || []).length) slides.push({ key: 'revenue', ai: true, node: (
            <Slide nav="Pacer" warn={edit} ground={GROUND.tint}>
              <div className="flex flex-col" style={{ height: '100%' }}>
                <div className="flex-1 min-h-0 flex" style={{ gap: 44, paddingBottom: 18 }}>
                  <div className="flex flex-col min-h-0" style={{ width: 340, flexShrink: 0 }}>
                    <span style={{ position: 'relative', alignSelf: 'flex-start' }}>
                      <StackMark logo={houseLogo(sec('revenue').partnerLogo, 'pacer')} mono="P" name="Pacer" accent={t.accent} card={t.card} border={t.cardBorder} bare height={34} />
                      {edit ? (
                        <button onClick={() => { setPhotoUrl(''); setPhotoPick({ title: 'Pacer logo', cur: String(sec('revenue').partnerLogo || ''), set: (u: string) => patch('revenue.partnerLogo', u) }) }}
                          className="sb-noprint" title="Change the Pacer logo"
                          style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0, cursor: 'pointer', borderRadius: 12 }} />
                      ) : null}
                    </span>
                    <h2 style={{ marginTop: 22, fontSize: 34, lineHeight: TYPE.title.line, letterSpacing: TYPE.title.track, fontWeight: 600, color: t.ink }}>
                      <Ed v={sec('revenue').partnerHead || REVENUE_PARTNER_HEAD} set={v => patch('revenue.partnerHead', v)} edit={edit} />
                    </h2>
                    {/* Boss, 2026-09-24: the old line ("Our revenue-management partner. Every figure
                        here is Pacer's own…") read as a disclaimer, not a description. Editable now. */}
                    <p style={{ marginTop: 14, fontSize: 16.5, lineHeight: 1.55, color: t.muted }}>
                      <Ed v={sec('revenue').partnerIntro || REVENUE_PARTNER_INTRO} set={v => patch('revenue.partnerIntro', v)} edit={edit} multiline />
                    </p>
                  </div>
                  {/* Jon, 2026-09-24: what they do for us · about them · why we chose them. Three
                      groups, each a labelled block of short rows; a deck without groups shows its
                      flat rows as before. */}
                  <div className="flex-1 min-w-0 min-h-0 flex flex-col onb-scroll">
                    {Array.isArray(sec('revenue').partnerGroups) && sec('revenue').partnerGroups.length ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 2 }}>
                        {sec('revenue').partnerGroups.map((g: Any, gi: number) => (
                          <div key={gi}>
                            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: t.accent, marginBottom: 6 }}>
                              <Ed v={g.label || ''} set={v => patch('revenue.partnerGroups.' + gi + '.label', v)} edit={edit} />
                            </p>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '8px 22px' }}>
                              {(g.rows || []).map((f: Any, i: number) => (
                                <div key={i} style={{ borderTop: '1px solid ' + t.cardBorder, paddingTop: 7 }}>
                                  <p style={{ fontSize: 13, fontWeight: 600, color: t.ink, lineHeight: 1.3 }}>
                                    <Ed v={f.k || ''} set={v => patch('revenue.partnerGroups.' + gi + '.rows.' + i + '.k', v)} edit={edit} multiline />
                                  </p>
                                  <p style={{ fontSize: 12, lineHeight: 1.5, color: t.body, marginTop: 3 }}>
                                    <Ed v={f.v || ''} set={v => patch('revenue.partnerGroups.' + gi + '.rows.' + i + '.v', v)} edit={edit} multiline />
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                    <div style={{ marginTop: 'auto', marginBottom: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {(sec('revenue').partner || []).map((f: Any, i: number) => (
                        <div key={i} style={{ borderTop: '1px solid ' + t.cardBorder, paddingTop: 10 }}>
                          <p style={{ fontSize: 14, fontWeight: 600, color: t.ink, lineHeight: 1.3 }}>
                            <Ed v={f.k || ''} set={v => patch('revenue.partner.' + i + '.k', v)} edit={edit} multiline />
                          </p>
                          <p style={{ fontSize: 13, lineHeight: 1.55, color: t.body, marginTop: 4 }}>
                            <Ed v={f.v || ''} set={v => patch('revenue.partner.' + i + '.v', v)} edit={edit} multiline />
                          </p>
                        </div>
                      ))}
                    </div>
                    )}
                  </div>
                </div>
                <Foot label="Revenue management" />
              </div>
            </Slide>
          ) })

          // ── 5d · THE STACK — the software behind the operation ─────────────
          // Jon, 2026-09-23: "create and mention the different tech stacks we use from Guesty to
          // PriceLabs to Breezeway to Lighthouse … a highlight of the tech that we use, and use
          // the tech logos, in the deck."
          //
          // ON THE MARKS: the channels wall uses Simple Icons glyphs, which exist for Airbnb and
          // Expedia. None exists for Guesty, PriceLabs or Breezeway, and Lighthouse is ours. Five
          // logos lifted from five vendor press kits at five different weights is a sticker sheet,
          // not a stack — so each tool carries a monogram tile in one ink at one size, the same
          // answer the channels wall reached. Real artwork drops into this layout unchanged.
          if (!hid('stack')) slides.push({ key: 'stack', ai: true, node: (
            <Slide nav="The tech stack" warn={edit} ground={GROUND.tint}>
              <div className="flex flex-col" style={{ height: '100%' }}>
                {/* THE SLACK AND EMAIL ROWS AND THE CLOSING LINE ARE GONE (Jon, 2026-09-24: "Get rid
                    of this"). The slide is the four platforms, each shown by its own logo. */}
                <Split k="stack"
                  left={leftBody(houseLine(sec('stack').body, STACK_BODY_PAIR), v => patch('stack.body', v))}
                  right={
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {(sec('stack').tools || []).map((f: Any, i: number) => {
                        const logo = houseLogo(f.logo, f.name)
                        const wordmark = WORDMARK_LOGOS.indexOf(logo) >= 0
                        const nm = String(f.name || '').toLowerCase()
                        const line = nm === 'lighthouse' ? houseLine(f.v, LIGHTHOUSE_LINE) : nm === 'breezeway' ? houseLine(f.v, BREEZEWAY_LINE) : (f.v || '')
                        return (
                          <div key={i} className="flex" style={{ gap: 28, alignItems: 'center', padding: '14px 0', borderTop: '1px solid ' + t.cardBorder }}>
                            <span style={{ position: 'relative', flex: '0 0 180px', display: 'flex', alignItems: 'center', height: 44 }}>
                              <StackMark logo={logo} mono={f.mono} name={f.name} accent={t.accent} card={t.card} border={t.cardBorder} bare lockup={!wordmark} height={wordmark ? 34 : 32} />
                              {edit ? (
                                <button onClick={() => { setPhotoUrl(''); setPhotoPick({ title: String(f.name || 'Logo') + ' logo', cur: String(f.logo || ''), set: (u: string) => patch('stack.tools.' + i + '.logo', u) }) }}
                                  className="sb-noprint" title={'Change the ' + String(f.name || '') + ' logo'}
                                  style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0, cursor: 'pointer', borderRadius: 11 }} />
                              ) : null}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {/* The logo is the name (Jon, 2026-09-24). Only the editor shows the name field. */}
                              {edit ? <p style={{ fontSize: 12, color: t.muted }}><Ed v={f.name || ''} set={v => patch('stack.tools.' + i + '.name', v)} edit={edit} /></p> : null}
                              <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: t.muted }}>
                                <Ed v={f.role || ''} set={v => patch('stack.tools.' + i + '.role', v)} edit={edit} />
                              </p>
                              <p style={{ fontSize: 13, lineHeight: 1.5, color: t.body, marginTop: 3 }}>
                                <Ed v={line} set={v => patch('stack.tools.' + i + '.v', v)} edit={edit} multiline />
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  } />
                <Foot label="The tech stack" />
              </div>
            </Slide>
          ) })

          // ── 6 · THE LISTING — two slides per unit ──────────────────────────
          if (!hid('listings')) {
            const items: Any[] = sec('listings').items || []
            items.forEach((L: Any, li: number) => {
              const pics: string[] = (L.photos || []).slice(0, 5)
              slides.push({ key: 'listings', node: (
                <Slide nav={String(L.name || 'Unit')} warn={edit} bleed ground={GROUND.light}>
                  {/* THE GALLERY GETS THE TOP, NOT THE WHOLE SLIDE (Jon, 2026-09-16: "the
                      listing review should not fill the whole page with photo"). Full bleed was
                      striking and said nothing — it was all picture and no substance, and an
                      owner reviewing their listing needs the frames AND the facts in one look.
                      Photographs take the upper band, the lower third is clean ground carrying
                      the name, the shape of the unit, the live channels and the headline the
                      listing actually leads with. */}
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 372, display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 3, background: t.cardBorder }}>
                    {[0, 1, 2, 3, 4].map(pi => (
                      <Pick
                        key={pi}
                        title={'Frame ' + (pi + 1) + ' \u2014 ' + String(L.name || 'unit')}
                        cur={String(pics[pi] || '')}
                        set={u => patch('listings.items.' + li + '.photos.' + pi, u)}
                        style={{ width: '100%', height: '100%', gridRow: pi === 0 ? 'span 2' : undefined }}
                      />
                    ))}
                  </div>
                  <div style={{ position: 'absolute', top: 38, right: 40, zIndex: 2 }}>
                    {mark.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mark.logo} alt={mark.word} style={{ height: 16, width: 'auto', objectFit: 'contain', filter: 'invert(1) brightness(2.2)', opacity: 0.82 }} />
                    ) : null}
                  </div>

                  <div style={{ position: 'absolute', top: 372, left: 64, right: 64, bottom: 44 }} className="flex flex-col">
                    <div className="flex-1 min-h-0 flex items-start" style={{ paddingTop: 26, gap: 44 }}>
                      <div style={{ flex: '1 1 0', minWidth: 0 }}>
                        <div style={{ width: 30, height: 2, background: t.accent, marginBottom: 14 }} />
                        <p className="onb-h" style={{ fontSize: 30, color: t.ink, lineHeight: 1.18 }}>{L.name}</p>
                        {/* Jon, 2026-09-18: "the tab that says live on three channels, remove that".
                            Stripped here as well as at generation, because every deck already built
                            froze the old sub-line into its own content. The channel links sit right
                            beside this line anyway, so the count was saying what the buttons show. */}
                        <p style={{ fontSize: 13.5, color: t.muted, marginTop: 7 }}>{stripChannelCount(L.sub)}</p>
                      </div>
                      <div style={{ flex: '1 1 0', minWidth: 0 }}>
                        <p style={{ fontSize: 12, color: t.muted, marginBottom: 7 }}><Lab id="listingLeads" d="What it leads with" /></p>
                        <p style={{
                          fontSize: 16, lineHeight: 1.45, color: t.ink, fontWeight: 500,
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        } as Any}>{String(L.title || '\u2014')}</p>
                        {(L.links || []).length > 0 && (
                          <div className="flex flex-wrap" style={{ gap: 8, marginTop: 14 }}>
                            {(L.links || []).map((k: Any) => (
                              <a key={k.name} href={k.url} target="_blank" rel="noopener noreferrer"
                                style={{
                                  fontSize: 12.5, fontWeight: 500, color: t.accent, whiteSpace: 'nowrap',
                                  border: '1px solid ' + t.cardBorder, borderRadius: 999, padding: '6px 14px',
                                  textDecoration: 'none',
                                }}>{k.name} &#8599;</a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <Foot label="Your listing" />
                  </div>
                </Slide>
              ) })

              slides.push({ key: 'listings', node: (
                <Slide nav={String(L.name || 'Unit') + ' \u2014 copy'} warn={edit} ground={GROUND.light}>
                  {/* THE COPY SLIDE WAS THE PLAINEST THING IN THE DECK (Jon, 2026-09-16: "the
                      listing description slide looks so plain and formatted poorly"). It was
                      three grey labels stacked over three grey paragraphs in one column — a
                      form, not a slide. What an owner is being shown is the thing a guest reads,
                      so it is set like a listing page: the title as a headline in the display
                      face with its character budget beside it, then the two descriptions in two
                      columns so neither runs to twenty lines, each under a hairline. Still live
                      to edit; the labels stop shouting and the words do the work. */}
                  <div className="flex flex-col h-full">
                    <div className="flex items-start justify-between" style={{ gap: 28 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ width: 30, height: 2, background: t.accent, marginBottom: 14 }} />
                        <p style={{ fontSize: 12, color: t.muted }}>{L.name}</p>
                      </div>
                      {canEdit ? (
                        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button
                            onClick={() => { setOptMsg(''); setOptInstr(''); setOpt({ id: String(L.id), li, name: String(L.name || 'this unit') }) }}
                            style={{ fontSize: 12.5, fontWeight: 600, borderRadius: 999, padding: '8px 16px', marginRight: 8, background: t.card, border: '1px solid ' + t.cardBorder, color: t.ink, whiteSpace: 'nowrap' }}>
                            Optimize with AI
                          </button>
                          <button
                            onClick={async () => {
                              const id = String(L.id)
                              setCopyMsg(m => ({ ...m, [id]: 'busy' }))
                              try {
                                const r = await fetch('/api/listing-content', {
                                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    listingId: id,
                                    title: String(L.title || ''),
                                    publicDescription: { summary: String(L.summary || ''), space: String(L.space || '') },
                                  }),
                                })
                                const d = await r.json().catch(() => ({}))
                                setCopyMsg(m => ({ ...m, [id]: (d?.ok || r.ok) ? 'ok' : (d?.error || 'Could not push.') }))
                              } catch {
                                setCopyMsg(m => ({ ...m, [id]: 'Could not push \u2014 check your connection.' }))
                              }
                            }}
                            style={{ fontSize: 12.5, fontWeight: 600, borderRadius: 999, padding: '8px 16px', background: t.ink, color: t.bg, whiteSpace: 'nowrap' }}>
                            {copyMsg[String(L.id)] === 'busy' ? 'Pushing\u2026' : 'Push to Guesty'}
                          </button>
                          <p style={{ fontSize: 11.5, marginTop: 7, maxWidth: 230, color: copyMsg[String(L.id)] === 'ok' ? t.good : t.gold }}>
                            {copyMsg[String(L.id)] === 'ok'
                              ? 'Pushed. The channels pick it up on their own schedule.'
                              : (copyMsg[String(L.id)] && copyMsg[String(L.id)] !== 'busy' ? copyMsg[String(L.id)] : '')}
                          </p>
                        </div>
                      ) : (
                        <p style={{ fontSize: 12, color: t.muted, whiteSpace: 'nowrap' }}><Lab id="listingWords" d="The words a guest reads" /></p>
                      )}
                    </div>

                    {/* the headline, at headline size */}
                    <div style={{ marginTop: 18 }}>
                      <LiveText
                        v={String(L.title || '')} live={canEdit} t={t} single
                        ro="onb-title-live" cls="onb-title-live"
                        set={v => { patch('listings.items.' + li + '.title', v); answerChanged() }} />
                      <div className="flex items-center" style={{ gap: 10, marginTop: 8 }}>
                        <div style={{ flex: 1, height: 3, borderRadius: 2, background: t.rule, overflow: 'hidden' }}>
                          <div style={{
                            width: Math.min(100, Math.round((String(L.title || '').length / 50) * 100)) + '%',
                            height: '100%',
                            background: String(L.title || '').length > 50 ? t.gold : t.accent,
                          }} />
                        </div>
                        <span className="tabular-nums" style={{ fontSize: 11.5, color: String(L.title || '').length > 50 ? t.gold : t.muted, whiteSpace: 'nowrap' }}>
                          {String(L.title || '').length} / 50 characters
                        </span>
                      </div>
                    </div>

                    {/* the two descriptions, side by side so neither becomes a wall */}
                    <div className="flex-1 min-h-0" style={{ marginTop: 26, display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 46 }}>
                      {[{ f: 'summary', l: 'Summary', hint: 'The paragraph above the fold.' },
                        { f: 'space', l: 'The space', hint: 'The room-by-room walkthrough.' }].map(F => (
                        <div key={F.f} className="min-h-0 flex flex-col">
                          <div style={{ paddingBottom: 9, borderBottom: '1px solid ' + t.ink, marginBottom: 14 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: t.ink }}>{F.l}</span>
                            <span style={{ fontSize: 12, color: t.muted, marginLeft: 10 }}>{F.hint}</span>
                          </div>
                          <div className="min-h-0 onb-scroll" style={{ flex: 1 }}>
                            <LiveText
                              v={String(L[F.f] || '')} live={canEdit} t={t}
                              ro="" cls="onb-copy"
                              set={v => { patch('listings.items.' + li + '.' + F.f, v); answerChanged() }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <Foot label="Your listing" />
                  </div>
                </Slide>
              ) })
            })

            // ── AMENITIES, ONE UNIT PER SLIDE ─────────────────────────────
            // What the listing claims, and what a unit of this shape is still missing. Both
            // lists are live: tap either side to move an amenity across, then push the whole
            // set to Guesty and the channels pick it up on their own schedule. The reason a
            // suggestion exists sits under it, because "add a coffee maker" lands very
            // differently from "add a coffee maker — it is in 88% of the studios you compete
            // with". No score anywhere near it.
            // The families that actually collide in Guesty's catalogue. Matched on the name, so
            // a new variant of an existing family is covered without touching this list.
            const FAMILIES = [
              'pool', 'hot tub', 'jacuzzi', 'parking', 'garage', 'wifi', 'internet', 'kitchen',
              'gym', 'fitness', 'washer', 'dryer', 'air conditioning', 'heating', 'tv',
              'balcony', 'terrace', 'patio', 'grill', 'bbq', 'elevator', 'crib', 'workspace',
              'beach', 'waterfront', 'coffee', 'dishwasher', 'pet', 'smoking', 'sauna',
            ]
            const familyOf = (name: string): string => {
              const n = String(name || '').toLowerCase()
              for (const f of FAMILIES) if (n.indexOf(f) >= 0) return f
              return ''
            }

            const toggleAmenity = (li: number, name: string) => {
              mutate(d => {
                const list: string[] = Array.isArray(d.listings.items[li].amenities) ? d.listings.items[li].amenities : []
                const ix = list.indexOf(name)
                if (ix >= 0) list.splice(ix, 1); else list.push(name)
                list.sort((a: string, b: string) => a.localeCompare(b))
                d.listings.items[li].amenities = list
              })
              answerChanged()
            }
            const pushAmenities = async (id: string, list: string[]) => {
              setAmenityMsg(m => ({ ...m, [id]: 'busy' }))
              try {
                const r = await fetch('/api/listing-amenities', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ listingId: id, amenities: list }),
                })
                const d = await r.json()
                setAmenityMsg(m => ({ ...m, [id]: (d?.ok || r.ok) ? 'ok' : (d?.error || 'Could not push \u2014 try from the unit page.') }))
              } catch {
                setAmenityMsg(m => ({ ...m, [id]: 'Could not push \u2014 check your connection.' }))
              }
            }

            // THE PICK LIST IS THE UNION, NOT WHATEVER THE REPORT HAPPENED TO BE BORN WITH.
            // `catalog` is the portfolio's own amenity vocabulary, written into the content JSON
            // at generation time — so a deck generated before that existed carries none, and the
            // column showed the scored recommendations and stopped. Unioned with the built-in
            // vocabulary, every deck has the full list whether or not it is regenerated; a
            // regenerated one additionally gets the spellings unique to our own listings.
            const stored: string[] = Array.isArray((sec('listings') as Any).catalog) ? (sec('listings') as Any).catalog : []
            const catSeen = new Set<string>()
            const catalog: string[] = []
            for (const n of AMENITY_VOCAB.concat(stored)) {
              const v = String(n || '').trim()
              if (!v) continue
              const k = v.toLowerCase()
              if (catSeen.has(k)) continue
              catSeen.add(k); catalog.push(v)
            }
            items.forEach((L: Any, li: number) => {
              const have: string[] = Array.isArray(L.amenities) ? L.amenities : []
              const claimed = new Set(have.map(familyOf).filter(Boolean))
              const seen = new Set<string>()
              const missing: Any[] = (L.amenitySuggest || []).filter((sg: Any) => {
                if (have.indexOf(sg.name) >= 0) return false
                const fam = familyOf(sg.name)
                if (!fam) return true
                // already covered by something on the listing, or by an earlier suggestion
                if (claimed.has(fam) || seen.has(fam)) return false
                seen.add(fam)
                return true
              })
              // EVERYTHING ELSE THE OWNER CAN TICK. The recommended list is the twenty-odd
              // amenities the score actually models; the catalogue is every value in use across
              // the portfolio, so nothing is unreachable. Same family rule on both: once a pool
              // is on the listing, the other four spellings of pool leave the list.
              const inMissing = new Set(missing.map((x: Any) => String(x.name).toLowerCase()))
              const haveLower = new Set(have.map(x => x.toLowerCase()))
              const rest: string[] = (Array.isArray(catalog) ? catalog : []).filter((c: string) => {
                const lc = c.toLowerCase()
                if (haveLower.has(lc) || inMissing.has(lc)) return false
                const fam = familyOf(c)
                if (fam && claimed.has(fam)) return false
                return true
              })
              const q = amenQ.trim().toLowerCase()
              const hit = (n: string) => !q || n.toLowerCase().indexOf(q) >= 0
              const missingQ = missing.filter((x: Any) => hit(String(x.name)))
              const restQ = rest.filter(hit)
              const restGroups = groupAmenities(restQ)
              if (!have.length && !missing.length && !rest.length) return
              slides.push({ key: 'listings', node: (
                <Slide nav={String(L.name || 'Unit') + ' \u2014 amenities'} warn={edit} ground={GROUND.tint}>
                  <div className="flex flex-col h-full">
                    <div className="flex items-baseline justify-between" style={{ gap: 24 }}>
                      <div>
                        <div style={{ width: 30, height: 2, background: brass, marginBottom: 14 }} />
                        <p className="onb-h" style={{ fontSize: 30, color: t.ink, lineHeight: 1.2 }}><Lab id="listingHas" d="What the listing says it has" /></p>
                        <p style={{ fontSize: 13, color: t.muted, marginTop: 7 }}>{L.name}</p>
                      </div>
                      {canEdit && (
                        <div style={{ textAlign: 'right' }}>
                          <button onClick={() => pushAmenities(L.id, have)}
                            style={{ fontSize: 12.5, fontWeight: 600, borderRadius: 999, padding: '8px 16px', background: t.ink, color: t.bg, whiteSpace: 'nowrap' }}>
                            {amenityMsg[L.id] === 'busy' ? 'Pushing\u2026' : 'Push to Guesty'}
                          </button>
                          {amenityMsg[L.id] && amenityMsg[L.id] !== 'busy' && (
                            <p style={{ fontSize: 11.5, marginTop: 7, maxWidth: 210, color: amenityMsg[L.id] === 'ok' ? t.good : t.gold }}>
                              {amenityMsg[L.id] === 'ok' ? 'Pushed. The channels pick it up on their own schedule.' : amenityMsg[L.id]}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Both columns scroll. The grid row is pinned to minmax(0,1fr) because an
                        auto row takes its min-content height from the list inside it, which on a
                        fixed 630px canvas means the list runs off the bottom instead of
                        scrolling (Jon, 2026-09-17: "need to be able to see all selectable
                        amenities and be able to scroll down"). */}
                    <div className="flex-1 min-h-0" style={{ marginTop: 18, display: 'grid', gridTemplateColumns: '1.1fr 1fr', gridTemplateRows: 'minmax(0, 1fr)', columnGap: 36 }}>
                      {/* on the listing */}
                      <div className="flex flex-col" style={{ minHeight: 0 }}>
                        <div className="flex items-baseline justify-between" style={{ paddingBottom: 8, borderBottom: '1px solid ' + t.ink, marginBottom: 11 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: t.ink }}><Lab id="listingOn" d="On the listing" /></span>
                          <span className="tabular-nums" style={{ fontSize: 12, color: t.muted }}>{have.length}</span>
                        </div>
                        <div className="onb-scroll" style={{ flex: 1, minHeight: 0, paddingRight: 8 }}>
                          <div className="flex flex-wrap" style={{ gap: 6 }}>
                            {have.filter(hit).map((a: string) => (
                              <span key={a}
                                onClick={canEdit ? () => toggleAmenity(li, a) : undefined}
                                title={canEdit ? 'Remove from the listing' : undefined}
                                style={{
                                  fontSize: 12, borderRadius: 999, padding: '5px 11px',
                                  background: t.card, border: '1px solid ' + t.cardBorder, color: t.ink,
                                  cursor: canEdit ? 'pointer' : 'default',
                                }}>{a}</span>
                            ))}
                            {!have.length && <span style={{ fontSize: 13, color: t.muted }}>Nothing listed yet.</span>}
                          </div>
                        </div>
                      </div>

                      {/* everything they can add: the ones worth adding first, then the rest */}
                      <div className="flex flex-col" style={{ minHeight: 0 }}>
                        <div className="flex items-baseline justify-between" style={{ paddingBottom: 8, borderBottom: '1px solid ' + brass, marginBottom: 11, gap: 12 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: t.ink, whiteSpace: 'nowrap' }}><Lab id="listingAdd" d="Add to the listing" /></span>
                          {canEdit ? (
                            <input value={amenQ} onChange={e => setAmenQ(e.target.value)} placeholder={'Filter…'}
                              style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 999, border: '1px solid ' + t.cardBorder, background: t.card, color: t.ink, width: 112, outline: 'none' }} />
                          ) : (
                            <span className="tabular-nums" style={{ fontSize: 12, color: t.muted }}>{missing.length + rest.length}</span>
                          )}
                        </div>
                        <div className="onb-scroll" style={{ flex: 1, minHeight: 0, paddingRight: 8 }}>
                          {missingQ.length > 0 && (
                            <p style={{ fontSize: 10, letterSpacing: '0.11em', textTransform: 'uppercase', color: brass, fontWeight: 700, marginBottom: 5 }}><Lab id="listingWorth" d="Worth adding" /></p>
                          )}
                          {missingQ.map((sg: Any) => (
                            <div key={sg.name}
                              onClick={canEdit ? () => toggleAmenity(li, sg.name) : undefined}
                              style={{ padding: '7px 0', borderBottom: '1px solid ' + t.rule, cursor: canEdit ? 'pointer' : 'default' }}>
                              <p style={{ fontSize: 12.5, fontWeight: 600, color: t.ink }}>
                                {canEdit ? <span style={{ color: brass, marginRight: 6 }}>+</span> : null}{sg.name}
                              </p>
                              {sg.reason ? <p style={{ fontSize: 11, lineHeight: 1.4, color: t.muted, marginTop: 1 }}>{sg.reason}</p> : null}
                            </div>
                          ))}
                          {/* BY CATEGORY, NOT ONE ALPHABETICAL WALL (Jon, 2026-09-17: "that
                              right column should have a scroll through amenities organized by
                              category"). A hundred names in one run is unreadable on a call;
                              grouped, the owner can be asked "anything in the kitchen we are
                              missing?" and the list answers it. Headers stick while you scroll. */}
                          {restGroups.map(g => (
                            <div key={g.name}>
                              <p style={{
                                position: 'sticky', top: 0, zIndex: 1,
                                fontSize: 10, letterSpacing: '0.11em', textTransform: 'uppercase',
                                color: t.muted, fontWeight: 700,
                                marginTop: 14, marginBottom: 7, paddingTop: 2, paddingBottom: 4,
                                background: GROUND.tint,
                              }}>
                                {g.name} <span className="tabular-nums" style={{ fontWeight: 500 }}>{g.items.length}</span>
                              </p>
                              <div className="flex flex-wrap" style={{ gap: 6 }}>
                                {g.items.map((a: string) => (
                                  <span key={a}
                                    onClick={canEdit ? () => toggleAmenity(li, a) : undefined}
                                    title={canEdit ? 'Add to the listing' : undefined}
                                    style={{
                                      fontSize: 11.5, borderRadius: 999, padding: '4px 10px',
                                      background: t.card, border: '1px solid ' + t.cardBorder, color: t.sub,
                                      cursor: canEdit ? 'pointer' : 'default',
                                    }}>{a}</span>
                                ))}
                              </div>
                            </div>
                          ))}
                          {!missingQ.length && !restQ.length && (
                            <p style={{ fontSize: 13, color: t.good }}>{q ? 'Nothing matches that.' : 'Nothing obvious missing.'}</p>
                          )}
                        </div>
                      </div>
                    </div>
                    <Foot label="Your listing" />
                  </div>
                </Slide>
              ) })
            })

            // OFF FOR NOW (Jon, 2026-09-17: "get rid of slide 9 for now"). This was the
            // on-the-call questions page for the listing section — slide 09. Nothing is lost by
            // dropping it: every unanswered ask still collects on the closing Other notes slide,
            // which is where the follow-up list belongs anyway. Flip this to true to bring the
            // page back; the slide itself is untouched below.
            const SHOW_LISTING_QUESTIONS = false
            if (SHOW_LISTING_QUESTIONS && (sec('listings').asks || []).length) slides.push({ key: 'listings', node: (
              <Slide nav="Listing — questions" warn={edit}>
                <div className="flex flex-col h-full">
                  <Title k="listings" />
                  <div className="flex-1 min-h-0" style={{ overflowY: 'auto' }}><Asks k="listings" /></div>
                  <Foot label="Your listing" />
                </div>
              </Slide>
            ) })
          }

          // ── THE SEASON — the shape of the year, as a share and a curve ─────
          // No dollar figure anywhere (Jon: "not actual numbers"). A number we invented today
          // is the number an owner holds us to in April, and their unit has no history yet. The
          // share and the shape are true of the market and safe to put in front of them.
          // THE SHARE AND THE CURVE HAVE TO AGREE. A deck still carrying the old hand-drawn
          // 0-6 curve is also carrying the headline written beside it that day - "65% ...
          // November through April" - and the measured curve does not support either number:
          // it is 55%, and November is not a peak month. Substituting the chart but leaving the
          // sentence would hand Jon a slide that argues with itself in front of an owner, so
          // the two move together or not at all. An edited deck is not on the old scale and is
          // left alone.
          const seasonStored: Any[] = sec('season').months || []
          const seasonStale = seasonStored.length === 12 &&
            Math.max(0, ...seasonStored.map((m: Any) => Number(m.level) || 0)) <= 12
          const seasonShare = seasonStale ? SEASON_PEAK_SHARE : (sec('season').peakShare || '')
          const seasonLabel = seasonStale ? SEASON_PEAK_LABEL : houseLine(sec('season').peakLabel, SEASON_LABEL)
          // The paragraph makes the same claims in words, so it travels with them. On a stale
          // deck it still read "November through April... July and August are the floor",
          // printed under a chart banding December and dotting September.
          const seasonBodyTxt = (seasonStale || seasonBodyStale(sec('season').body)) ? SEASON_BODY : (sec('season').body || '')

          if (!hid('season')) slides.push({ key: 'season', ai: true, node: (
            <Slide nav="The season" warn={edit} ground={GROUND.dark} bleed>
              <div style={{ position: 'absolute', inset: 0, background: t.band, padding: 64 }} className="flex flex-col">
                <div className="flex-1 min-h-0 flex flex-col justify-center">
                  <div style={{ width: 30, height: 2, background: D.ink, marginBottom: 20 }} />
                  <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', columnGap: 52, alignItems: 'center' }}>
                    <div>
                      <p style={{ fontSize: 84, fontWeight: 600, letterSpacing: '-0.045em', color: D.ink, lineHeight: 0.9 }}>
                        <Ed v={seasonShare} set={v => patch('season.peakShare', v)} edit={edit} />
                      </p>
                      <p style={{ fontSize: 15.5, lineHeight: 1.5, color: D.body, marginTop: 14, maxWidth: '26ch' }}>
                        <Ed v={seasonLabel} set={v => patch('season.peakLabel', v)} edit={edit} multiline />
                      </p>
                    </div>
                    <div>
                      {/* the year, as a curve */}
                      {(() => {
                        // A CURVE, WITH THE SEASON MARKED ON IT (Jon, 2026-09-17: "round out the
                        // high months and highlight peak season months"). Twelve bars made the
                        // year read as twelve separate facts. A smoothed area says one thing:
                        // the year has a shape. Monotone cubic interpolation, so the line never
                        // overshoots above a peak or dips below a trough the way a naive spline
                        // does — an invented bump between February and March would be a claim.
                        // THE CURVE IS THE MARKET'S, NOT THIS OWNER'S, SO IT LIVES IN CODE.
                        // Decks generated before 2026-09-17 stored the old hand-drawn 0-6 scale
                        // with September at 0, which draws the line onto the axis and tells an
                        // owner their unit earns nothing in September (Jon: "the drop is way too
                        // dramatic"). Those levels are recognisable — a real index peaks at 100 —
                        // so an old deck is re-pointed at the measured shape instead of being
                        // left showing a cliff. A deck whose curve has been edited by hand keeps
                        // the edit, because an edited one will not be on the old scale.
                        const ms: Any[] = seasonStale ? (SEASON_SHAPE as Any[]) : seasonStored
                        if (ms.length < 2) return null
                        // PAD is the plot inset. At 14 the December band — the wrap-around
                        // half of peak season — ran hard into the right edge of the chart and
                        // read as a solid bar stuck to the side rather than a band around a
                        // month, and the curve's last point sat almost on the boundary. 26
                        // gives both a margin, and the band edges are clamped to the plot below.
                        const W = 620, H = 196, PAD = 26
                        const max = Math.max(1, ...ms.map((m: Any) => Number(m.level) || 0))
                        const xs = ms.map((_m: Any, i: number) => PAD + (i * (W - PAD * 2)) / (ms.length - 1))
                        const ys = ms.map((m: Any) => H - 26 - ((Number(m.level) || 0) / max) * (H - 52))

                        // monotone tangents
                        const n = ms.length
                        const dx: number[] = [], dy: number[] = [], sl: number[] = []
                        for (let i = 0; i < n - 1; i++) { dx.push(xs[i + 1] - xs[i]); dy.push(ys[i + 1] - ys[i]); sl.push(dy[i] / dx[i]) }
                        const m0: number[] = new Array(n).fill(0)
                        m0[0] = sl[0]; m0[n - 1] = sl[n - 2]
                        for (let i = 1; i < n - 1; i++) m0[i] = (sl[i - 1] * sl[i] <= 0) ? 0 : (sl[i - 1] + sl[i]) / 2
                        for (let i = 0; i < n - 1; i++) {
                          if (sl[i] === 0) { m0[i] = 0; m0[i + 1] = 0; continue }
                          const a = m0[i] / sl[i], b = m0[i + 1] / sl[i], h = Math.hypot(a, b)
                          if (h > 3) { const tt = 3 / h; m0[i] = tt * a * sl[i]; m0[i + 1] = tt * b * sl[i] }
                        }
                        let d = `M ${xs[0]} ${ys[0]}`
                        for (let i = 0; i < n - 1; i++) {
                          const h = dx[i]
                          d += ` C ${xs[i] + h / 3} ${ys[i] + (m0[i] * h) / 3}, ${xs[i + 1] - h / 3} ${ys[i + 1] - (m0[i + 1] * h) / 3}, ${xs[i + 1]} ${ys[i + 1]}`
                        }
                        const base = H - 26
                        const area = d + ` L ${xs[n - 1]} ${base} L ${xs[0]} ${base} Z`

                        // peak season wraps the year end, so it is two bands, not one
                        // WHICH MONTHS ARE PEAK IS A FLAG, NOT A THRESHOLD. This used to be
                        // `level >= max - 1`, which only worked while levels were a hand-drawn
                        // 0-6 scale: on the real index (March = 100) `max - 1` is 99 and the
                        // band collapsed onto March alone. The shape now carries `peak` per
                        // month; the old rule stays as the fallback so a deck generated before
                        // this still bands correctly off its own stored 0-6 numbers.
                        const flagged = ms.some((m: Any) => m && m.peak)
                        const peakIx = ms
                          .map((m: Any, i: number) => ({ i, lvl: Number(m.level) || 0, on: !!(m && m.peak) }))
                          .filter(o => flagged ? o.on : o.lvl >= max - 1)
                          .map(o => o.i)
                        const bands: { x: number; w: number }[] = []
                        let runStart = -1
                        for (let i = 0; i < n; i++) {
                          const on = peakIx.indexOf(i) >= 0
                          if (on && runStart < 0) runStart = i
                          if ((!on || i === n - 1) && runStart >= 0) {
                            const last = on ? i : i - 1
                            const x0 = Math.max(2, xs[runStart] - (runStart > 0 ? (xs[runStart] - xs[runStart - 1]) / 2 : PAD))
                            const x1 = Math.min(W - 2, xs[last] + (last < n - 1 ? (xs[last + 1] - xs[last]) / 2 : PAD))
                            bands.push({ x: x0, w: Math.max(0, x1 - x0) })
                            runStart = -1
                          }
                        }
                        const topI = ms.reduce((b: number, m: Any, i: number) => ((Number(m.level) || 0) > (Number(ms[b].level) || 0) ? i : b), 0)
                        const lowI = ms.reduce((b: number, m: Any, i: number) => ((Number(m.level) || 0) < (Number(ms[b].level) || 0) ? i : b), 0)

                        return (
                          <>
                            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 196, display: 'block', overflow: 'visible' }}>
                              <defs>
                                <linearGradient id="seasonFill" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.30" />
                                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0.03" />
                                </linearGradient>
                              </defs>
                              {bands.map((b, i) => (
                                <rect key={i} x={b.x} y={0} width={b.w} height={base} fill="rgba(255,255,255,0.09)" rx="4" />
                              ))}
                              <line x1={PAD} y1={base} x2={W - PAD} y2={base} stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
                              <path d={area} fill="url(#seasonFill)" />
                              <path d={d} fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                              <circle cx={xs[topI]} cy={ys[topI]} r="5" fill="#ffffff" />
                              <circle cx={xs[lowI]} cy={ys[lowI]} r="5" fill={t.accent} />
                              {ms.map((m: Any, i: number) => (
                                <text key={i} x={xs[i]} y={H - 6} textAnchor="middle"
                                  fill={i === topI || i === lowI || peakIx.indexOf(i) >= 0 ? '#ffffff' : 'rgba(255,255,255,0.5)'}
                                  style={{ fontSize: 11, fontWeight: peakIx.indexOf(i) >= 0 ? 600 : 400 }}>{m.m}</text>
                              ))}
                            </svg>
                            <div className="flex items-center" style={{ gap: 20, marginTop: 12, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 11.5, color: D.body }}>
                                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'rgba(255,255,255,0.22)', marginRight: 6 }} />Peak season
                              </span>
                              <span style={{ fontSize: 11.5, color: D.body }}>
                                <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 999, background: '#fff', marginRight: 6 }} />March peak
                              </span>
                              <span style={{ fontSize: 11.5, color: D.body }}>
                                <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 999, background: t.accent, marginRight: 6 }} />September low
                              </span>
                            </div>
                            <p style={{ fontSize: 12.5, lineHeight: 1.55, color: D.muted, marginTop: 12 }}>
                              <Ed v={sec('season').lowNote || ''} set={v => patch('season.lowNote', v)} edit={edit} multiline />
                            </p>
                          </>
                        )
                      })()}
                    </div>
                  </div>
                  <p style={{ fontSize: 14.5, lineHeight: 1.65, color: D.body, marginTop: 30, maxWidth: '78ch' }}>
                    <Ed v={seasonBodyTxt} set={v => patch('season.body', v)} edit={edit} multiline />
                  </p>
                </div>
                <Foot label="The season" dark />
              </div>
            </Slide>
          ) })

          // ── THE RAMP — why month one is bought, not earned ─────────────────
          if (!hid('ramp')) slides.push({ key: 'ramp', ai: true, node: (
            <Slide nav="Ramp" warn={edit} ground={GROUND.light}>
              <div className="flex flex-col h-full">
                <div style={{ width: 30, height: 2, background: t.accent, marginBottom: 16 }} />
                <p className="onb-h" style={{ fontSize: 34, color: t.ink, lineHeight: 1.15, maxWidth: '22ch' }}>
                  {/* The ramp slide draws its own heading rather than going through Title, so the
                      house repair has to be applied here too -- it was added to Title and silently
                      did nothing for this one slide. */}
                  <Ed v={houseLine(sec('ramp').headline, RAMP_HEADLINE)} set={v => patch('ramp.headline', v)} edit={edit} multiline />
                </p>
                <p style={{ fontSize: 15, color: t.muted, marginTop: 10, maxWidth: '62ch' }}>
                  <Ed v={houseLine(sec('ramp').subtitle, RAMP_SUBTITLE)} set={v => patch('ramp.subtitle', v)} edit={edit} multiline />
                </p>

                <div className="flex-1 min-h-0 flex flex-col justify-center">
                  {/* a rising track: placement, reviews and rate all climb together */}
                  <div style={{ position: 'relative', height: 86, marginBottom: 6 }}>
                    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, background: t.rule }} />
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{
                        position: 'absolute', bottom: 0, left: (i * 33.3) + '%', width: '31%',
                        height: 24 + i * 28, borderRadius: '6px 6px 0 0',
                        background: i === 2 ? t.accent : hexA(t.accent, i === 1 ? 0.45 : 0.2),
                      }} />
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 26 }}>
                    {houseRows<Any>(sec('ramp').bands, RAMP_BANDS_RETIRED_MARKS, RAMP_BANDS as Any[]).slice(0, 3).map((b: Any, i: number) => (
                      <div key={i} style={{ paddingTop: 14, borderTop: '1px solid ' + t.ink }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: t.ink }}>
                          <Ed v={b.k || ''} set={v => patch('ramp.bands.' + i + '.k', v)} edit={edit} />
                        </p>
                        <p style={{
                          fontSize: 12.5, lineHeight: 1.55, color: t.muted, marginTop: 7,
                          display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        } as Any}>
                          <Ed v={b.v || ''} set={v => patch('ramp.bands.' + i + '.v', v)} edit={edit} multiline />
                        </p>
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: 14, lineHeight: 1.6, color: t.body, marginTop: 24, paddingLeft: 16, borderLeft: '2px solid ' + t.accent, maxWidth: '76ch' }}>
                    <Ed v={houseLine(sec('ramp').note, RAMP_NOTE)} set={v => patch('ramp.note', v)} edit={edit} multiline />
                  </p>
                </div>
                <Foot label="Ramp" />
              </div>
            </Slide>
          ) })

          // ── HOW WE SHORTEN IT — the active half of the ramp ────────────────
          // Jon, 2026-09-23: "What steps we take to improve ramp, not just talk about ramp, but
          // how we improve ramp to drive occupancy and revenue."
          //
          // The curve slide is expectation-setting: this is normal, do not read month one as a
          // failure. Fair, and entirely passive — on its own it reads as an excuse prepared in
          // advance. This slide is the work that bends the curve, and it has to sit immediately
          // after it or the honesty of the first slide costs us the room.
          if (!hid('rampsteps')) slides.push({ key: 'rampsteps', ai: true, node: (
            <Slide nav="How we shorten it" warn={edit} ground={GROUND.tint}>
              <div className="flex flex-col" style={{ height: '100%' }}>
                <Title k="rampsteps" />
                {/* Three columns, not two (2026-09-24): six steps in two columns ran past the foot
                    and the last line of each bottom card was cut off on the slide. */}
                <div className="flex-1 min-h-0 onb-scroll" style={{ marginTop: 20 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '14px 26px' }}>
                    {(sec('rampsteps').rows || []).map((f: Any, i: number) => (
                      <div key={i} style={{ borderTop: '1px solid ' + t.cardBorder, paddingTop: 10 }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: t.ink, lineHeight: 1.3 }}>
                          <Ed v={f.k || ''} set={v => patch('rampsteps.rows.' + i + '.k', v)} edit={edit} multiline />
                        </p>
                        <p style={{ fontSize: 13, lineHeight: 1.45, color: t.body, marginTop: 4 }}>
                          <Ed v={f.v || ''} set={v => patch('rampsteps.rows.' + i + '.v', v)} edit={edit} multiline />
                        </p>
                      </div>
                    ))}
                    {/* The closing line fills the grid's last cell (2026-09-24 audit), rather than a
                        strip under a row with a hole in it. */}
                    <div style={{ borderTop: '2px solid ' + t.accent, paddingTop: 10 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.45, color: t.ink }}>
                        <Ed v={sec('rampsteps').note || ''} set={v => patch('rampsteps.note', v)} edit={edit} multiline />
                      </p>
                    </div>
                  </div>
                </div>
                <Foot label="How we shorten it" />
              </div>
            </Slide>
          ) })

          // ── HOW WE RUN IT — the software, and what it buys the owner ───────
          // Jon, 2026-09-22: "AI Slides on onbarind about how we are really using it, new
          // features, etc and how it will help us imporve."
          //
          // Every owner in this market has heard "we use AI" from four other managers, so the
          // only version of this slide worth showing names things that run today and can be
          // checked on the call — Eve answering in the crew channel in Spanish, a review becoming
          // a task on a named unit, this report being generated rather than typed. The dark ground
          // is deliberate: it is the second and last punctuation slide in the deck, and this is
          // the one place we are allowed to make a claim about ourselves.
          // THE LAYOUT (Jon, 2026-09-24: "this looks terrible"). It was one column: a two-line
          // headline, the subtitle, a 2x2 grid of pillars, the note and the on-the-call question,
          // stacked and then centred in the space left. That stack is taller than the slide, and a
          // centred column that is too tall spills out of BOTH ends: the pillars rode up over the
          // subtitle and the question sat on top of the footer. Now it is two columns that each
          // fit on their own: the argument on the left (headline, subtitle, what it buys you, the
          // question for the call) and the four things that run on the right, one under another.
          // Auto margins rather than justify-center, so a column that ever runs long is cut at the
          // bottom where the overflow warning sees it, never pushed up over the headline.
          if (!hid('ai')) slides.push({ key: 'ai', ai: true, node: (
            <Slide nav="Lighthouse" warn={edit} ground={GROUND.dark}>
              <div className="flex flex-col h-full">
                <div className="flex-1 min-h-0 flex" style={{ gap: 48, paddingBottom: 20 }}>
                  <div className="flex flex-col min-h-0" style={{ width: 372, flexShrink: 0 }}>
                    {/* The Lighthouse mark (Jon, 2026-09-24: "use this as a promotion for Lighthouse"). */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/icon-192.png" alt="Lighthouse" style={{ width: 52, height: 52, borderRadius: 13, marginBottom: 18, boxShadow: '0 6px 18px rgba(0,0,0,0.25)' }} />
                    <p className="onb-h" style={{ fontSize: 30, color: D.ink, lineHeight: 1.15 }}>
                      <Ed v={houseLine(sec('ai').headline, AI_HEADLINE)} set={v => patch('ai.headline', v)} edit={edit} multiline />
                    </p>
                    <p style={{ fontSize: 14, lineHeight: 1.5, color: D.muted, marginTop: 12 }}>
                      <Ed v={houseLine(sec('ai').subtitle, AI_SUBTITLE)} set={v => patch('ai.subtitle', v)} edit={edit} multiline />
                    </p>
                    <p style={{ fontSize: 13.5, lineHeight: 1.6, color: D.body, marginTop: 18, paddingTop: 16, borderTop: '1px solid ' + D.rule }}>
                      <Ed v={houseLine(sec('ai').note, AI_NOTE)} set={v => patch('ai.note', v)} edit={edit} multiline />
                    </p>
                    {/* WHAT IS COMING sits after what already runs, never before it, and stays empty
                        unless someone types into it: a roadmap line on an empty deck is a promise
                        nobody made. */}
                    {(String(sec('ai').next || '').trim() || edit) ? (
                      <p style={{ fontSize: 12.5, lineHeight: 1.55, color: D.body, marginTop: 14, paddingLeft: 12, borderLeft: '2px solid ' + t.accent }}>
                        <span style={{ fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: 10.5, color: t.accent, marginRight: 8 }}>Next</span>
                        <Ed v={String(sec('ai').next || '')} set={v => patch('ai.next', v)} edit={edit} multiline placeholder="What we are building now, if it is worth mentioning on this call\u2026" />
                      </p>
                    ) : null}
                    {/* The on-the-call question came off this slide (Jon, 2026-09-24). */}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col">
                    <div style={{ marginTop: 'auto', marginBottom: 'auto' }}>
                      {/* EIGHT CAPABILITIES IN TWO COLUMNS (Jon, 2026-09-24: "Lighthouse does a lot more, mention it"). */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', columnGap: 28 }}>
                      {houseRows<Any>(sec('ai').pillars, AI_PILLARS_RETIRED_MARKS, AI_PILLARS as Any[]).slice(0, 8).map((b: Any, i: number) => (
                        <div key={i} style={{ padding: '11px 0 12px', borderTop: '1px solid ' + D.rule }}>
                          <div className="flex items-baseline" style={{ gap: 8 }}>
                            <span style={{ fontSize: 11.5, color: t.accent, fontWeight: 700 }}>{'0' + (i + 1)}</span>
                            <p style={{ fontSize: 14, fontWeight: 600, color: D.ink }}>
                              <Ed v={b.k || ''} set={v => patch('ai.pillars.' + i + '.k', v)} edit={edit} />
                            </p>
                          </div>
                          <p style={{ fontSize: 12.5, lineHeight: 1.5, color: D.muted, marginTop: 4, paddingLeft: 24 }}>
                            <Ed v={b.v || ''} set={v => patch('ai.pillars.' + i + '.v', v)} edit={edit} multiline />
                          </p>
                        </div>
                      ))}
                      </div>
                    </div>
                  </div>
                </div>
                <Foot label="Lighthouse" dark />
              </div>
            </Slide>
          ) })

          // ── 6 · THE OWNER PORTAL ───────────────────────────────────────────
          if (!hid('guesty')) slides.push({ key: 'guesty', ai: true, node: (
            <Slide nav="Owner portal" warn={edit} bleed ground={GROUND.tint}>
              <div style={{ position: 'absolute', inset: 0 }}>
                <Half src={(sec('guesty').shots || [])[0] || String(sec('guesty').photo || pic(9))} side="right"
                  title="Owner portal screenshot" set={u => patch('guesty.photo', u)} />
                <div style={{ position: 'absolute', top: 64, bottom: 44, left: 64, width: 556 }} className="flex flex-col">
                  <div className="flex-1 min-h-0">
                    <Title k="guesty" sub={false} narrow />
                    <div style={{ marginTop: 26 }}>
                      {canEdit ? (
                        <input
                          value={String(sec('guesty').portalUrl || '')}
                          onChange={e => { patch('guesty.portalUrl', e.target.value); answerChanged() }}
                          placeholder="https://your-name.guestyowners.com"
                          className="onb-live"
                          style={{ width: '100%', fontSize: 24, fontWeight: 500, letterSpacing: '-0.02em', color: t.accent, background: 'transparent', border: '1px solid transparent', borderRadius: 8, padding: '4px 8px', marginLeft: -8, fontFamily: 'inherit' }}
                        />
                      ) : (
                        <a href={housePortalUrl(sec('guesty').portalUrl) || '#'} target="_blank" rel="noopener noreferrer"
                          className="onb-link" style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.02em', color: t.accent, wordBreak: 'break-word' }}>
                          {housePortalUrl(sec('guesty').portalUrl).replace(/^https?:\/\//, '') || 'Portal address to be set'}
                        </a>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 26, marginTop: 20, paddingTop: 18, borderTop: '1px solid ' + t.rule }}>
                        <div>
                          <p style={{ fontSize: 12, color: t.muted }}><Lab id="signInAs" d="You sign in as" /></p>
                          <p style={{ fontSize: 14.5, color: t.ink, marginTop: 3, wordBreak: 'break-all' }}>
                            <Ed v={String(sec('guesty').loginEmail || '')} set={v => patch('guesty.loginEmail', v)} edit={edit} placeholder="owner@email.com" />
                            {!String(sec('guesty').loginEmail || '') && !edit ? <span style={{ color: t.gold }}>set up on this call</span> : null}
                          </p>
                        </div>
                        <div>
                          <p style={{ fontSize: 12, color: t.muted }}><Lab id="password" d="Password" /></p>
                          <p style={{ fontSize: 14.5, color: t.body, marginTop: 3 }}><Lab id="passwordNote" d="Set from your invite email." /></p>
                        </div>
                      </div>
                      {/* WHAT IS IN THERE (2026-09-24 audit): the slide ended at the password line and
                          the lower half sat empty. The four things an owner opens the portal for. */}
                      <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid ' + t.rule }}>
                        <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: t.muted }}>What you will find there</p>
                        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 26px' }}>
                          {houseRows<Any>(sec('guesty').items, PORTAL_ITEMS_RETIRED_MARK, PORTAL_ITEMS as Any[]).slice(0, 4).map((f: Any, i: number) => (
                            <div key={i}>
                              <p style={{ fontSize: 13.5, fontWeight: 600, color: t.ink, lineHeight: 1.3 }}>
                                <Ed v={f.k || ''} set={v => patch('guesty.items.' + i + '.k', v)} edit={edit} multiline />
                              </p>
                              <p style={{ fontSize: 12, lineHeight: 1.5, color: t.body, marginTop: 3 }}>
                                <Ed v={f.v || ''} set={v => patch('guesty.items.' + i + '.v', v)} edit={edit} multiline />
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  <Foot label="Owner portal" />
                </div>
              </div>
            </Slide>
          ) })

          // THE DRAWN PREVIEW IS GONE (Jon, 2026-09-18: "we can get rid of the what you will see
          // when you log in"). It was a static sketch of four portal screens, built when we had
          // no better option. The interactive walkthrough below is the same idea done properly —
          // the real screens, in the real order, that an owner can actually click — so keeping
          // both meant showing a drawing of a thing immediately before showing the thing.

          // MAKING AN OWNER STAY, AS A THING YOU DO RATHER THAN READ ABOUT (Jon, 2026-09-18:
          // "show them how to actually make an owner reservation… make it real and interactive").
          // The two slides above tell an owner the portal exists and what is on it. Neither gets
          // them through the one task they will actually need on their own, in December, without
          // us. This one is clickable: pick real dates on a calendar that refuses the nights a
          // guest already has, choose whether it is friends and family, press Create reservation.
          // Every control is named as our Guesty account actually names it — see the header of
          // components/OwnerPortalDemo for the settings this was read from.
          if (!hid('guesty')) slides.push({ key: 'guesty', node: (
            <Slide nav="Make an owner stay" warn={edit} ground={GROUND.tint}>
              <div className="flex flex-col h-full">
                <div className="flex items-baseline justify-between" style={{ gap: 24 }}>
                  <div>
                    <div style={{ width: 30, height: 2, background: t.accent, marginBottom: 14 }} />
                    <p className="onb-h" style={{ fontSize: 30, color: t.ink, lineHeight: 1.2 }}>
                      Owner portal: calendar, owner stays, analytics
                    </p>
                  </div>
                </div>
                <div className="flex-1 min-h-0" style={{ marginTop: 20 }}>
                  <OwnerPortalDemo
                    unitName={String(((sec('listings').items || [])[0] || {}).name || 'Your unit')}
                    portalUrl={housePortalUrl(sec('guesty').portalUrl)}
                    ownerName={String(hero.title || sec('welcome').subtitle || '')}
                    photos={(((sec('listings').items || [])[0] || {}).photos || []).slice(0, 3)}
                  />
                </div>
                <Foot label="Owner portal" />
              </div>
            </Slide>
          ) })

          // ── 7 · STATEMENTS — the worked month, then the three rules ────────
          if (!hid('statement')) {
            // ── THE STATEMENT, ON ONE SLIDE, INTERACTIVE ──────────────────
            // Modelled on the August statement Jon supplied: the performance strip, the category
            // summary in the issued order, and the navy "Payment due to owner" row. The detail
            // used to be a second slide; now the categories are the control — tap Rental income
            // and the right-hand panel shows the two bookings that produced it, tap Management
            // fee and it shows the commission lines. That is the point of the section made
            // operable rather than asserted, and it keeps the section to one page.
            // A DECK GENERATED BEFORE THE STATEMENT WAS REMODELLED HAS NO ROWS IN IT.
            // The sample is the house standard, so it belongs in code rather than frozen into
            // each report's content JSON at generation time (lib/statement-sample.ts says why).
            // Any deck whose stored statement has no rows — every one built before the remodel,
            // which rendered as a headline over an empty table — falls back to the shared one,
            // with no regeneration. A statement that HAS been edited keeps the edit.
            const stFallback = !statementHasRows(sec('statement')) || statementIsHouseSample(sec('statement'))
            const st = stFallback ? { ...sec('statement'), ...SAMPLE_STATEMENT } : sec('statement')
            const stRes: Any[] = st.reservations || []
            const catLines = (cat: string | null) => {
              const out: Any[] = []
              for (const r of stRes) for (const ln of (r.lines || [])) {
                if (!cat || String(ln.cat || '').toLowerCase() === cat.toLowerCase()) out.push({ ...ln, guest: r.guest, stay: r.stay })
              }
              return out
            }
            const catTotal = (cat: string) => {
              let n = 0
              for (const l of catLines(cat)) {
                const v = Number(String(l.amt || '').replace(/[^0-9.]/g, '')) * (l.neg ? -1 : 1)
                if (Number.isFinite(v)) n += v
              }
              return n
            }
            const hasDetail = (cat: string) => catLines(cat).length > 0

            slides.push({ key: 'statement', node: (
              <Slide nav="Statements" warn={edit} ground={GROUND.light}>
                <div className="flex flex-col h-full">
                  <div className="flex items-baseline justify-between" style={{ gap: 24 }}>
                    <div>
                      <div style={{ width: 30, height: 2, background: t.accent, marginBottom: 12 }} />
                      <p className="onb-h" style={{ fontSize: 28, color: t.ink, lineHeight: 1.2 }}>
                        <Ed v={houseLine(sec('statement').headline, SECTION_HEAD.statement)} set={v => patch('statement.headline', v)} edit={edit} />
                      </p>
                      {/* SAID OUT LOUD, ON THE SLIDE. This is the one slide in the deck whose
                          numbers are not the owner's, and an owner reading a figure as theirs is
                          the single worst thing this document could do. */}
                      <p style={{ fontSize: 11.5, lineHeight: 1.45, color: t.muted, marginTop: 6, maxWidth: '62ch' }}>
                        <Ed v={houseLine(sec('statement').subtitle, SECTION_SUB.statement)} set={v => patch('statement.subtitle', v)} edit={edit} multiline />
                      </p>
                    </div>
                    <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: t.gold, border: '1px solid ' + t.gold, borderRadius: 999, padding: '2px 8px' }}>Sample</span>
                      <p style={{ fontSize: 12.5, fontWeight: 600, color: t.ink, marginTop: 6 }}>{st.unitLabel}</p>
                      <p style={{ fontSize: 11.5, color: t.muted, marginTop: 2 }}>{st.period}</p>
                    </div>
                  </div>

                  <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: t.cardBorder, border: '1px solid ' + t.cardBorder, borderRadius: 10, overflow: 'hidden' }}>
                    {(st.kpis || []).map((k: Any, i: number) => (
                      <div key={i} style={{ background: t.card, padding: '9px 16px' }}>
                        <p style={{ fontSize: 11, color: t.muted }}>
                          <Ed v={k.k || ''} set={v => patch('statement.kpis.' + i + '.k', v)} edit={edit} />
                        </p>
                        <p className="tabular-nums" style={{ fontSize: 18, fontWeight: 600, color: t.ink, marginTop: 1, letterSpacing: '-0.02em' }}>
                          <Ed v={k.v || ''} set={v => patch('statement.kpis.' + i + '.v', v)} edit={edit} />
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* THE GRID ROW HAS TO BE PINNED OR THE PAYOUT SITS ON THE FOOTER. An
                      implicit grid row is `auto`, which takes its height from the tallest column
                      — here nine summary rows plus the navy payout bar — and on a fixed 630px
                      canvas that runs past the bottom of the slide and prints the payout over
                      the foot label. minmax(0,1fr) binds the row to the space actually left.
                      Rows are a shade tighter for the same reason: the summary has to fit. */}
                  <div className="flex-1 min-h-0" style={{ marginTop: 13, display: 'grid', gridTemplateColumns: '1.02fr 1fr', gridTemplateRows: 'minmax(0, 1fr)', columnGap: 34 }}>
                    {/* the summary — and the control */}
                    <div className="flex flex-col" style={{ minHeight: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 12px', background: t.chip, borderRadius: '6px 6px 0 0' }}>
                        <span style={{ fontSize: 11, color: t.sub }}><Lab id="stmtCategory" d="Category" /></span>
                        <span style={{ fontSize: 11, color: t.sub }}><Lab id="stmtAmount" d="Monthly amount" /></span>
                      </div>
                      {(st.summary || []).map((ln: Any, i: number) => {
                        const name = String(ln.k || '')
                        const clickable = hasDetail(name)
                        const on = stmtCat && stmtCat.toLowerCase() === name.toLowerCase()
                        return (
                          <div key={i}
                            onClick={clickable ? () => setStmtCat(on ? null : name) : undefined}
                            style={{
                              display: 'flex', justifyContent: 'space-between', gap: 12,
                              padding: '4px 12px', borderBottom: '1px solid ' + t.rule,
                              borderTop: ln.rule ? '1px solid ' + t.ink : undefined,
                              background: on ? t.chip : 'transparent',
                              cursor: clickable ? 'pointer' : 'default',
                              boxShadow: on ? 'inset 2px 0 0 ' + t.accent : undefined,
                            }}>
                            <span style={{ fontSize: 12.5, color: ln.rule ? t.ink : t.body, fontWeight: ln.rule ? 600 : 400 }}>
                              <Ed v={name} set={v => patch('statement.summary.' + i + '.k', v)} edit={edit} />
                              {clickable ? <span style={{ color: t.accent, marginLeft: 6, fontSize: 11 }}>{on ? '\u25be' : '\u203a'}</span> : null}
                            </span>
                            <span className="tabular-nums" style={{ fontSize: 12.5, fontWeight: ln.rule ? 600 : 500, whiteSpace: 'nowrap', color: ln.neg ? t.gold : t.ink }}>
                              <Ed v={ln.v || ''} set={v => patch('statement.summary.' + i + '.v', v)} edit={edit} />
                            </span>
                          </div>
                        )
                      })}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, padding: '9px 14px', marginTop: 'auto', background: t.band, borderRadius: '0 0 6px 6px', flex: '0 0 auto' }}>
                        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)' }}>
                          <Ed v={(st.due || {}).k || ''} set={v => patch('statement.due.k', v)} edit={edit} />
                        </span>
                        <span className="tabular-nums" style={{ fontSize: 21, fontWeight: 600, color: '#fff', letterSpacing: '-0.02em' }}>
                          <Ed v={(st.due || {}).v || ''} set={v => patch('statement.due.v', v)} edit={edit} />
                        </span>
                      </div>
                    </div>

                    {/* what sits behind the category you picked */}
                    <div className="flex flex-col" style={{ minHeight: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, paddingBottom: 6, borderBottom: '1px solid ' + t.ink }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: t.ink }}>
                          {stmtCat ? stmtCat : 'Every line traces to a booking'}
                        </span>
                        {stmtCat ? (
                          <button onClick={() => setStmtCat(null)} style={{ fontSize: 11.5, color: t.accent }}>Show all</button>
                        ) : (
                          <span style={{ fontSize: 11, color: t.muted }}>tap a category</span>
                        )}
                      </div>
                      <div className="min-h-0 onb-scroll" style={{ flex: 1, paddingTop: 8 }}>
                        {stRes.map((r: Any, ri: number) => {
                          const lines = (r.lines || []).filter((ln: Any) => !stmtCat || String(ln.cat || '').toLowerCase() === stmtCat.toLowerCase())
                          if (!lines.length) return null
                          return (
                            <div key={ri} style={{ marginBottom: 10 }}>
                              <div className="flex items-baseline justify-between" style={{ gap: 10 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: t.ink }}>{r.guest}</span>
                                <span style={{ fontSize: 11, color: t.muted }}>{r.stay}</span>
                              </div>
                              {lines.map((ln: Any, li3: number) => (
                                <div key={li3} style={{ display: 'grid', gridTemplateColumns: '1fr 78px', gap: 10, padding: '4px 0', borderBottom: '1px solid ' + t.rule }}>
                                  <span style={{ fontSize: 11.5, color: t.body }}>
                                    {ln.desc}
                                    {!stmtCat ? <span style={{ color: t.muted }}>{'\u2002\u00b7\u2002' + ln.cat}</span> : null}
                                  </span>
                                  <span className="tabular-nums" style={{ fontSize: 11.5, textAlign: 'right', color: ln.neg ? t.gold : t.ink }}>{ln.amt}</span>
                                </div>
                              ))}
                            </div>
                          )
                        })}
                        {stmtCat && catLines(stmtCat).length === 0 ? (
                          <p style={{ fontSize: 12, color: t.muted, paddingTop: 6 }}>
                            A monthly charge, not tied to a booking. Your real statement itemizes it by job and date.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <Foot label="Owner statements" />
                </div>
              </Slide>
            ) })

            // $250 and a cleans rule with no owner-stay exception were still on screen after the
            // exact-match repair, because this deck carried an older wording than the one recorded
            // as retired. Judged by mark now, and replaced as a set.
            const hlRows: Any[] = statementHighlightsStale(sec('statement').highlights)
              ? (STATEMENT_HIGHLIGHTS as Any[]) : (sec('statement').highlights || [])
            if (hlRows.length) slides.push({ key: 'statement', node: (
              <Slide nav="What we charge" warn={edit} bleed>
                <div style={{ position: 'absolute', inset: 0, background: t.band, padding: 64 }} className="flex flex-col">
                  <div className="flex-1 min-h-0 flex flex-col justify-center">
                    <div style={{ width: 30, height: 2, background: D.ink, marginBottom: 20 }} />
                    <p className="onb-h" style={{ fontSize: 34, color: D.ink, maxWidth: '24ch', lineHeight: 1.2 }}>
                      Three billing rules
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 36, marginTop: 44 }}>
                      {hlRows.slice(0, 3).map((h: Any, i: number) => (
                        <div key={i} style={{ paddingTop: 18, borderTop: '1px solid ' + D.rule }}>
                          <p style={{ fontSize: 17, fontWeight: 600, color: D.ink, lineHeight: 1.3 }}>
                            <Ed v={h.k || ''} set={v => patch('statement.highlights.' + i + '.k', v)} edit={edit} multiline />
                          </p>
                          <p style={{ fontSize: 13.5, marginTop: 10, lineHeight: 1.6, color: D.muted }}>
                            <Ed v={h.v || ''} set={v => patch('statement.highlights.' + i + '.v', v)} edit={edit} multiline />
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <Foot label="Owner statements" dark />
                </div>
              </Slide>
            ) })

            // ── THE READING GUIDE. `statement.also` was authored in the template and rendered
            // NOWHERE (Jon, 2026-09-18, on the reimbursement line: "if not the owner is paying
            // the fee on the Airbnb… Guesty does not give us ability to separate so we
            // reimburse that RM"). The four rows that answer the questions an owner actually
            // asks -- why there is no cleaning line, why a reimbursement appears as income --
            // existed only in the JSON. The explanation Jon kept correcting was invisible on the
            // one slide it belonged to, which is why it kept coming back wrong.
            // DATE, NOT TEXT-MATCHING. The first attempt keyed staleness on a retired phrase and
            // missed, because these rows have been through more than one wrong version: the deck
            // on screen was still explaining a "Cleaning fee" line owners never see and calling
            // the reimbursement the OTA commission, neither of which contained the phrase. Since
            // the rows were never rendered before today, nothing predating the slide can be an
            // edit worth keeping, so the cutoff replaces them outright and nothing after it.
            // Judged on the rows themselves, not on the deck's generation date. The date test
            // was true forever for every deck built before today, so every edit to these four
            // rows was discarded on the next render no matter what was typed.
            const alsoStored: Any[] = sec('statement').also || []
            const alsoRows: Any[] = statementAlsoRowsStale(alsoStored) ? (STATEMENT_ALSO as Any[]) : alsoStored

            if (alsoRows.length) slides.push({ key: 'statement', node: (
              <Slide nav="How to read it" warn={edit} ground={GROUND.tint}>
                <div className="flex flex-col h-full">
                  <div style={{ width: 30, height: 2, background: t.accent, marginBottom: 18 }} />
                  <p className="onb-h" style={{ fontSize: 32, color: t.ink, maxWidth: '26ch', lineHeight: 1.2 }}>
                    Common statement questions
                  </p>
                  {/* Two columns, content-height rows, scrolled rather than squeezed. No
                      gridTemplateRows here on purpose: this grid WANTS two auto rows, and pinning
                      it to one is the bug that emptied the amenity column. */}
                  <div className="flex-1 min-h-0" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 44, rowGap: 24, marginTop: 30, alignContent: 'start', overflowY: 'auto' }}>
                    {alsoRows.slice(0, 6).map((a: Any, i: number) => (
                      <div key={i} style={{ paddingTop: 16, borderTop: '1px solid ' + t.rule }}>
                        <p style={{ fontSize: 16, fontWeight: 600, color: t.ink, lineHeight: 1.3 }}>
                          <Ed v={a.k || ''} set={v => patch('statement.also.' + i + '.k', v)} edit={edit} multiline />
                        </p>
                        <p style={{ fontSize: 13.5, marginTop: 9, lineHeight: 1.6, color: t.body }}>
                          <Ed v={a.v || ''} set={v => patch('statement.also.' + i + '.v', v)} edit={edit} multiline />
                        </p>
                      </div>
                    ))}
                  </div>
                  <Foot label="Owner statements" />
                </div>
              </Slide>
            ) })
          }

          // ── WHAT IS STILL OPEN. Its own slide, because it is fourteen short rows and the
          // generic RowSlide is a single scrolling column: on screen it would need scrolling and
          // in the PDF it would simply be cut. Two columns, the owner/Stay tag beside each item,
          // so the split of responsibility is the thing you see first.
          if (!hid('checklist')) {
            const clRows: Any[] = houseRows<Any>(sec('checklist').rows, CHECKLIST_RETIRED_MARK, CHECKLIST_ROWS as Any[])
            const half = Math.ceil(clRows.length / 2)
            const cols = [clRows.slice(0, half), clRows.slice(half)]
            const tagTone = (who: string) => (String(who).toLowerCase() === 'owner' ? t.accent : t.sub)
            slides.push({ key: 'checklist', ai: true, node: (
              <Slide nav="Still open" warn={edit} ground={GROUND.light}>
                <div className="flex flex-col h-full">
                  <Title k="checklist" />
                  <div className="flex-1 min-h-0" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 40, marginTop: 20, alignContent: 'start', overflowY: 'auto' }}>
                    {cols.map((col, ci) => (
                      <div key={ci}>
                        {col.map((r: Any, i: number) => (
                          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 54px', columnGap: 12, alignItems: 'baseline', padding: '8px 0', borderTop: '1px solid ' + t.rule }}>
                            <div style={{ fontSize: 13, lineHeight: 1.45, color: t.body }}>
                              <Ed v={r.item || ''} set={v => patch('checklist.rows.' + (ci * half + i) + '.item', v)} edit={edit} multiline />
                            </div>
                            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tagTone(r.who), textAlign: 'right' }}>
                              <Ed v={r.who || ''} set={v => patch('checklist.rows.' + (ci * half + i) + '.who', v)} edit={edit} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  <Foot label="Still open" />
                </div>
              </Slide>
            ) })
          }

          // ── the off-by-default sections, one slide each ────────────────────
          const RowSlide = ({ k, label, rows, kw, tone, field, asks }: { k: string; label: string; rows: Any[]; kw?: number; tone?: SlideTone; field?: string; asks?: boolean }) => (
            <Slide nav={label} warn={edit} ground={GROUND[tone || 'light']}>
              <div className="flex flex-col h-full">
                <Title k={k} />
                <div className="flex-1 min-h-0" style={{ marginTop: 22, overflowY: 'auto' }}>
                  {(rows || []).map((r: Any, i: number) => edit && field ? (
                    // EDITABLE ROWS (Jon, 2026-09-21: "make it editable, we should be able to add
                    // questions"). Both columns type in place; a row can be removed; one can be added.
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: (kw || 180) + 'px 1fr 24px', columnGap: 16, padding: '12px 0', borderTop: '1px solid ' + t.rule }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: t.sub }}>
                        <Ed v={r.k != null ? r.k : (r.who || '')} set={v => patch(k + '.' + field + '.' + i + '.' + (r.k != null || r.who == null ? 'k' : 'who'), v)} edit={edit} placeholder="Label" />
                      </div>
                      <div style={{ fontSize: 13.5, lineHeight: 1.6, color: t.body }}>
                        <Ed v={r.v != null ? r.v : (r.item || '')} set={v => patch(k + '.' + field + '.' + i + '.' + (r.v != null || r.item == null ? 'v' : 'item'), v)} edit={edit} multiline placeholder="Text" />
                      </div>
                      <button onClick={() => mutate(d => { const arr = (d[k] || {})[field]; if (Array.isArray(arr)) arr.splice(i, 1) })} title="Remove row" style={{ color: t.muted, alignSelf: 'start', marginTop: 2 }}><X size={13} /></button>
                    </div>
                  ) : (
                    // THE CHECKLIST IS SHAPED { item, who, by }, NOT { k, v }. It has always been,
                    // and this row only ever read k and v -- which did not matter while the
                    // section was hidden by default and would have rendered as a slide of empty
                    // rules the moment anyone switched it on. The owner/Stay column is the whole
                    // point of that slide, so it leads.
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: (kw || 180) + 'px 1fr', columnGap: 24, padding: '12px 0', borderTop: '1px solid ' + t.rule }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: t.sub }}>{r.k != null ? r.k : (r.who || '')}</div>
                      <div style={{ fontSize: 13.5, lineHeight: 1.6, color: t.body }}>
                        {r.v != null ? r.v : (r.item || '')}
                        {r.v == null && r.by ? <span style={{ color: t.muted }}>{' \u00b7 ' + r.by}</span> : null}
                      </div>
                    </div>
                  ))}
                  {edit && field ? (
                    <button
                      onClick={() => mutate(d => {
                        const S2 = d[k] || (d[k] = {})
                        S2[field] = Array.isArray(S2[field]) ? S2[field] : []
                        S2[field].push(k === 'checklist' ? { item: '', who: 'Owner', by: '' } : { k: '', v: '' })
                      })}
                      className="sb-noprint"
                      style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600, borderRadius: 999, padding: '7px 15px', background: t.card, border: '1px dashed ' + t.cardBorder, color: t.ink }}>
                      + Add a row
                    </button>
                  ) : null}
                  {asks === false ? null : <Asks k={k} />}
                </div>
                <Foot label={label} />
              </div>
            </Slide>
          )
          for (const x of EXTRA) {
            if (hid(x.k)) continue
            // 'ai' and 'checklist' have slides of their own above. Rendering them here as well put a
            // second, unrepaired copy of each near the end of the deck ("What we automate, and what
            // we do not" and a second "What is still open", found 2026-09-24).
            if (x.k === 'ai' || x.k === 'checklist') continue
            const S = sec(x.k)
            // MONEY AND CHECKLIST ARE HOUSE DOCTRINE, so a deck generated before the owner-stay
            // carve-out is repaired on the way to the slide rather than left promising that a
            // departure clean is never billed. Everything else passes through untouched.
            let rows: Any[] = S.rows || S.facts || S.bands || S.rules || (S.months ? [] : [])
            const field = S.rows ? 'rows' : S.facts ? 'facts' : S.bands ? 'bands' : S.rules ? 'rules' : ''
            if (x.k === 'money') rows = houseRows<Any>(rows, MONEY_RULES_RETIRED_MARK, MONEY_RULES as Any[])
            if (x.k === 'checklist') rows = houseRows<Any>(rows, CHECKLIST_RETIRED_MARK, CHECKLIST_ROWS as Any[])
            slides.push({ key: x.k, ai: true, node: (
              rows && rows.length
                // The communication slide keeps its four rows and drops the questions block
                // (Jon, 2026-09-21: "remove the bottom section, I like the top part").
                ? <RowSlide k={x.k} label={x.label} rows={rows} field={field} asks={x.k !== 'comms'} tone={EXTRA.indexOf(x) % 2 ? 'tint' : 'light'} />
                : (
                  <Slide nav={x.label} warn={edit} ground={GROUND[EXTRA.indexOf(x) % 2 ? 'tint' : 'light']}>
                    <div className="flex flex-col h-full">
                      <Title k={x.k} />
                      <div className="flex-1 min-h-0" style={{ marginTop: 20, overflowY: 'auto' }}>
                        <p style={{ fontSize: 16, lineHeight: 1.7, color: t.body, maxWidth: '52ch', whiteSpace: 'pre-line' }}>
                          <Ed v={S.body || ''} set={v => patch(x.k + '.body', v)} edit={edit} multiline />
                        </p>
                        <Asks k={x.k} />
                      </div>
                      <Foot label={x.label} />
                    </div>
                  </Slide>
                )
            ) })
          }

          // ── 8 · OTHER NOTES ───────────────────────────────────────────────
          if (!hid('notes')) slides.push({ key: 'notes', node: (
            <Slide nav="Other notes" warn={edit} ground={GROUND.tint}>
              <div className="flex flex-col h-full">
                <div style={{ display: 'grid', gridTemplateColumns: '330px 1fr', columnGap: 46 }} className="flex-1 min-h-0">
                  <div><Title k="notes" /></div>
                  <div className="min-h-0 onb-scroll">
                    {(canEdit || String(sec('notes').body || '').trim()) ? (
                      <LiveText
                        v={String(sec('notes').body || '')}
                        live={canEdit} t={t} ro="" cls="onb-copy"
                        set={v => { patch('notes.body', v); answerChanged() }}
                      />
                    ) : null}
                    {/* THE RECAP: what the presenter noted during the call, in order. Editable in
                        edit mode; read as the record by the owner. */}
                    {(((sec('notes').recap || []) as Any[]).length > 0) && (
                      <div style={{ marginTop: (canEdit || String(sec('notes').body || '').trim()) ? 22 : 0 }}>
                        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: t.accent, marginBottom: 6 }}>Recap</p>
                        {((sec('notes').recap || []) as Any[]).map((r: Any, i: number) => (
                          <div key={i} style={{ display: 'grid', gridTemplateColumns: edit ? '120px 1fr 24px' : '120px 1fr', columnGap: 18, padding: '8px 0', borderTop: '1px solid ' + t.rule }}>
                            <span style={{ fontSize: 11.5, color: t.muted }}>{r.on || ''}</span>
                            <span style={{ fontSize: 13.5, lineHeight: 1.5, color: t.ink, whiteSpace: 'pre-line' }}>
                              {edit ? <Ed v={String(r.t || '')} set={v => editRecap(i, v)} edit={edit} multiline /> : String(r.t || '')}
                            </span>
                            {edit ? <button onClick={() => removeRecap(i)} title="Remove" style={{ color: t.muted, alignSelf: 'start' }}><X size={13} /></button> : null}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Questions of the deck's own, added on this slide (Jon, 2026-09-21). */}
                    {(canEdit || ((sec('notes').asks || []) as Any[]).length > 0) && (
                      <div style={{ marginTop: 22 }}>
                        {((sec('notes').asks || []) as Any[]).map((a: Any, i: number) => (
                          <div key={a.id || i} style={{ display: 'grid', gridTemplateColumns: canEdit ? '1fr 24px' : '1fr', columnGap: 12, padding: '8px 0', borderTop: '1px solid ' + t.rule }}>
                            <div>
                              {/* Jon, 2026-09-22: "Not able to edit the questions other notes in the
                                  onbaorind deck." The question was only typeable inside Edit mode,
                                  while the answer beneath it was live for any signed-in presenter —
                                  so on the call, where the deck is NOT in edit mode, the question
                                  was frozen. Both are live for a presenter now. */}
                              <p style={{ fontSize: 14, fontWeight: 600, color: t.ink }}>
                                {canEdit
                                  ? <Ed v={String(a.q || '')} set={v => { patch('notes.asks.' + i + '.q', v); answerChanged() }} edit placeholder="Question" multiline />
                                  : houseAsk(a.q)}
                              </p>
                              {(a.hint || canEdit) ? (
                                <p style={{ fontSize: 12, color: t.muted, marginTop: 2 }}>
                                  {canEdit
                                    ? <Ed v={String(a.hint || '')} set={v => { patch('notes.asks.' + i + '.hint', v); answerChanged() }} edit placeholder="A hint, if it needs one" multiline />
                                    : String(a.hint || '')}
                                </p>
                              ) : null}
                              {canEdit ? (
                                <input value={String(a.a || '')} onChange={e => setAnswer('notes', i, e.target.value)} placeholder="answer&hellip;"
                                  className="onb-ask mt-1.5 w-full text-[13.5px] pb-1"
                                  style={{ background: 'transparent', border: 0, borderBottom: '1px ' + (String(a.a || '').trim() ? 'solid ' + t.accent : 'dashed ' + t.rule), color: t.ink, fontFamily: 'inherit' }} />
                              ) : String(a.a || '').trim() ? <p style={{ fontSize: 13.5, color: t.body, marginTop: 4 }}>{String(a.a)}</p> : null}
                            </div>
                            {canEdit ? <button onClick={() => mutate(d => { const n = d.notes || {}; if (Array.isArray(n.asks)) n.asks.splice(i, 1) })} title="Remove" style={{ color: t.muted, alignSelf: 'start' }}><X size={13} /></button> : null}
                          </div>
                        ))}
                        {canEdit ? (
                          <button
                            onClick={() => mutate(d => { const n = d.notes || (d.notes = {}); n.asks = Array.isArray(n.asks) ? n.asks : []; n.asks.push({ id: 'n' + Date.now(), q: '' }) })}
                            className="sb-noprint"
                            style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, borderRadius: 999, padding: '7px 15px', background: t.card, border: '1px dashed ' + t.cardBorder, color: t.ink }}>
                            + Add a question
                          </button>
                        ) : null}
                      </div>
                    )}
                    {totalAsks > 0 && (
                      <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid ' + t.ink }}>
                        <p style={{ fontSize: 12.5, color: open.length ? t.gold : t.good }}>{answered} of {totalAsks} answered</p>
                        {open.length === 0 ? (
                          <p style={{ fontSize: 14, marginTop: 10, color: t.good }}>Nothing open.</p>
                        ) : open.map((o, oi) => (
                          <div key={oi} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', columnGap: 18, padding: '9px 0', borderTop: '1px solid ' + t.rule }}>
                            <span style={{ fontSize: 11.5, color: t.muted }}>{o.label}</span>
                            <div style={{ minWidth: 0 }}>
                              <span style={{ fontSize: 13.5, color: t.ink, display: 'block' }}>
                                {canEdit
                                  ? <Ed v={String((sec(o.k).asks || [])[o.i]?.q || o.q)} set={v => { patch(o.k + '.asks.' + o.i + '.q', v); answerChanged() }} edit multiline />
                                  : o.q}
                              </span>
                              {canEdit ? (
                                <input
                                  value={String((sec(o.k).asks || [])[o.i]?.a || '')}
                                  onChange={e => setAnswer(o.k, o.i, e.target.value)}
                                  placeholder="answer it here&hellip;"
                                  className="onb-ask w-full text-[13px] pb-1"
                                  style={{ marginTop: 4, background: 'transparent', border: 0, borderBottom: '1px dashed ' + t.rule, color: t.ink, fontFamily: 'inherit' }}
                                />
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <Foot label="Other notes" />
              </div>
            </Slide>
          ) })

          // A SLIDE OF YOUR OWN (Jon, 2026-09-17: "be able to add a slide and build it how I
          // want"). "Add section" already existed and already wrote to content.custom — but only
          // the scrolling report layout rendered those, so in a deck the button did nothing at
          // all: press it, and the slide count stayed exactly where it was. Custom sections now
          // build a slide each, on the deck's own Slide primitive, with the same editing and the
          // same overflow warning as every other page, and they sit at the end of the order
          // where an owner-specific addition belongs.
          const customs: Any[] = Array.isArray(c.custom) ? c.custom : []
          customs.forEach((cs: Any, ci: number) => {
            slides.push({ key: 'custom', node: (
              <Slide nav={String(cs.title || 'New slide')} warn={edit} ground={GROUND.light}>
                <div className="flex flex-col h-full">
                  <div className="flex items-start justify-between" style={{ gap: 24 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ width: 30, height: 2, background: t.accent, marginBottom: 14 }} />
                      {(edit || String(cs.eyebrow || '').trim()) ? (
                        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.24em', textTransform: 'uppercase', color: t.accent, marginBottom: 10 }}>
                          <Ed v={cs.eyebrow || ''} set={v => patch('custom.' + ci + '.eyebrow', v)} edit={edit} placeholder="OVERLINE (OPTIONAL)" />
                        </p>
                      ) : null}
                      <p className="onb-h" style={{ fontSize: 34, color: t.ink, lineHeight: 1.18, maxWidth: '22ch' }}>
                        <Ed v={cs.title || ''} set={v => patch('custom.' + ci + '.title', v)} edit={edit} placeholder="Slide title" />
                      </p>
                    </div>
                    {edit && (
                      <div style={{ display: 'flex', gap: 8, whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => mutate(d => {
                            const arr = Array.isArray(d.custom) ? d.custom : []
                            if (ci > 0) { const x = arr[ci - 1]; arr[ci - 1] = arr[ci]; arr[ci] = x }
                          })}
                          title="Move this slide earlier"
                          style={{ fontSize: 12, borderRadius: 999, padding: '6px 12px', background: t.card, border: '1px solid ' + t.cardBorder, color: t.sub }}>
                          Move up
                        </button>
                        <button
                          onClick={() => mutate(d => { d.custom.splice(ci, 1) })}
                          title="Delete this slide"
                          style={{ fontSize: 12, borderRadius: 999, padding: '6px 12px', background: t.card, border: '1px solid ' + t.cardBorder, color: t.accent }}>
                          Delete slide
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-h-0" style={{ marginTop: 22, display: 'grid', gridTemplateColumns: cs.photo || edit ? '1.15fr 0.85fr' : '1fr', gridTemplateRows: 'minmax(0, 1fr)', columnGap: 40 }}>
                    <div className="min-h-0 onb-scroll" style={{ paddingRight: 8 }}>
                      <LiveText
                        v={String(cs.body || '')}
                        live={canEdit} t={t} ro="" cls="onb-copy"
                        set={v => { patch('custom.' + ci + '.body', v); answerChanged() }}
                      />
                    </div>
                    {(cs.photo || edit) ? (
                      <div className="min-h-0">
                        <Pick
                          title={'Photo \u2014 ' + String(cs.title || 'slide')}
                          cur={String(cs.photo || '')}
                          set={u => patch('custom.' + ci + '.photo', u)}
                          style={{ width: '100%', height: '100%', minHeight: 180, borderRadius: 14 }}
                        />
                      </div>
                    ) : null}
                  </div>
                  <Foot label={String(cs.title || 'Your slide')} />
                </div>
              </Slide>
            ) })
          })

          return (
            <TextScale.Provider value={textScale}>
              {slides.map((sl, i) => (
                <SectionShell
                  key={sl.key + '-' + i}
                  id={sl.key + '-' + i}
                  title={(CORE.concat(EXTRA).find(x => x.k === sl.key) || { label: sl.key }).label}
                  hidden={false}
                  edit={edit}
                  onToggle={() => toggleSection(sl.key)}
                  onAi={sl.ai ? () => openAi(sl.key) : undefined}
                >
                  {sl.node}
                </SectionShell>
              ))}

              {/* Build one from scratch. Lands at the end of the deck, editable immediately. */}
              {edit && (() => {
                const add = (kind: string, title: string, extra: Any) => mutate(d => {
                  d.custom = Array.isArray(d.custom) ? d.custom : []
                  d.custom.push({ id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind, eyebrow: '', title, body: '', ...extra })
                })
                const B = ({ on, children }: { on: () => void; children: React.ReactNode }) => (
                  <button onClick={on} style={{ fontSize: 13, fontWeight: 600, borderRadius: 999, padding: '11px 20px', background: t.ink, color: t.bg }}>{children}</button>
                )
                return (
                  <div className="sb-noprint" style={{ marginTop: 26 }}>
                    <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
                      <B on={() => add('text', 'New slide', { photo: '' })}>+ A slide</B>
                      <B on={() => add('photos', 'The property', { photos: ['', '', ''], caps: [] })}>+ Photos</B>
                      <B on={() => add('photos', 'Work completed', { photos: ['', '', ''], caps: [] })}>+ Work completed</B>
                      <B on={() => add('notes', 'Notes from this review', {})}>+ Notes page</B>
                    </div>
                    <p style={{ fontSize: 12.5, color: t.muted, marginTop: 10, maxWidth: '72ch' }}>
                      Each one lands at the end of the deck, editable straight away, and saves with this report only — never the template.
                      Photos come from the same gallery the rest of the deck draws on, or paste a URL.
                    </p>
                  </div>
                )
              })()}

              {/* Switch an off-by-default section back on for this owner. Edit mode only. */}
              {edit && (
                <div className="sb-noprint" style={{ marginTop: 26 }}>
                  <div style={{ borderRadius: 16, padding: '20px 24px', background: t.chip, border: '1px dashed ' + t.cardBorder }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: t.sub, marginBottom: 4 }}>More slides</p>
                    <p style={{ fontSize: 13, color: t.muted, maxWidth: '58ch', marginBottom: 14 }}>
                      Written and ready, off by default. Adding one changes this deck only, never the template.
                    </p>
                    <div className="flex flex-wrap" style={{ gap: 8 }}>
                      {EXTRA.map(x => {
                        const on = !hid(x.k)
                        return (
                          <button key={x.k} onClick={() => toggleSection(x.k)}
                            style={{ borderRadius: 999, padding: '6px 14px', fontSize: 12, fontWeight: 500, ...(on ? { background: t.ink, color: t.bg } : { background: t.card, border: '1px solid ' + t.cardBorder, color: t.sub }) }}>
                            {on ? '✓ ' : '+ '}{x.label}
                          </button>
                        )
                      })}
                      {CORE.filter(x => hid(x.k)).map(x => (
                        <button key={x.k} onClick={() => toggleSection(x.k)}
                          style={{ borderRadius: 999, padding: '6px 14px', fontSize: 12, fontWeight: 500, background: t.card, border: '1px solid ' + t.cardBorder, color: t.sub }}>
                          + {x.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </TextScale.Provider>
          )
        })()}

        {/* ═══════════ OWNER REVIEW — the deck ═══════════
            Jon, 2026-09-22: "look at the onboarding style format, more like a powerpoint view."
            lib/deck was written for exactly this — "the owner report moves onto it next… it
            inherits the system instead of re-deriving it by eye" — so these slides use the same
            1120x630 canvas, the same seven type sizes and the same three grounds as the onboarding
            deck rather than a second set tuned by hand.

            THE RHYTHM. light, light, tint, light, tint, dark, light, tint — never two darks, never
            more than two lights before a change. The one dark slide is the budget, because that is
            the slide an owner actually stops on. */}
        {isReviewDeck && (() => {
          // ── THE OWNER DECK, AS A DESIGN SYSTEM (Jon, 2026-09-22) ───────────────────────────
          // "I need you to be like a high-level marketing company that we hire to create this
          // owner report deck… visuals, congruency, colour palette, text size, formatting."
          //
          // FOUR RULES, AND THEY ARE WHAT MAKE IT READ AS A COMMISSIONED DOCUMENT RATHER THAN A
          // STACK OF SCREENS:
          //
          // 1. ONE ACCENT. The old deck spent ink, gold, clay and grey all claiming emphasis at
          //    once, so nothing led. Everything that is not the accent is now the theme's ink at
          //    an opacity — a tint ladder, not a second palette. Emphasis means something again
          //    because only one thing on a slide can have it.
          // 2. ONE ANATOMY. Every slide carries the same header (section left, subject right),
          //    the same 72px margins and the same footer with the page number set in the serif.
          //    That repetition is the whole trick; a reader stops noticing the frame and reads
          //    the content.
          // 3. FIGURES IN THE SERIF. Titles and every number are set in Fraunces. Setting money
          //    in a display serif is the oldest move in premium reporting and it costs nothing.
          // 4. NOTHING OVERFLOWS, NOTHING PAGINATES. The 26-unit table scrolls inside its own
          //    16:9 frame with a sticky head and a pinned total, rather than being chopped across
          //    three slides (which made the reader carry a running sum across two page-turns).
          const D = { ink: '#ffffff', body: 'rgba(255,255,255,0.86)', muted: 'rgba(255,255,255,0.56)', rule: 'rgba(255,255,255,0.22)' }
          const GROUND: Record<SlideTone, string> = { light: t.card, tint: t.chip, dark: t.band }
          const tint = (a: number) => inkA(t.ink, a)
          const usd = (n: Any) => {
            const v = Number(n)
            if (!Number.isFinite(v)) return '—'
            const a = Math.abs(v)
            if (a >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M'
            if (a >= 10_000) return '$' + Math.round(v / 1000) + 'K'
            return '$' + Math.round(v).toLocaleString()
          }
          const hid = (k: string) => isHidden(k)
          const num = (v: Any) => { const n = Number(String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : 0 }
          /** Same, but keeping the sign — a delta of "−$102" has to come back negative. */
          const snum = (v: Any) => { const raw = String(v == null ? '' : v).trim(); const n = num(raw); return /^[-−]/.test(raw) ? -n : n }
          /** Format n the way `sample` is formatted, so a derived figure sits beside a real one. */
          const like = (sample: Any, n: number): string => {
            const x = String(sample || '')
            const body = /M\b/.test(x) ? n.toFixed(2) + 'M' : /K\b/i.test(x) ? String(Math.round(n)) + 'K' : Math.round(n).toLocaleString()
            return (x.indexOf('$') >= 0 ? '$' : '') + body + (x.indexOf('%') >= 0 ? '%' : '')
          }
          const pad2 = (n: number) => (n < 10 ? '0' : '') + n

          // EVERY MONEY FIGURE ON THIS DECK IS COMPUTED, PER SLIDE (Jon, 2026-09-22: "should be
          // net and fees and we should be able to calculate by slide if needed"). The deck used to
          // print card.value verbatim, so switching the basis moved the scroll report and left the
          // deck showing last week's answer. Now the cover and the snapshot resolve through the
          // same basisStrings() the scroll view uses, against that slide's own chosen basis, and a
          // typed override still wins over both.
          // WHERE THE NUMBERS LIVE. Both default OFF, which is the de-duplication Jon asked for:
          // the snapshot is the one slide that carries the month's figures, with the second basis
          // under each of them. Either can be switched back on per report, in edit mode.
          const showCoverStats = c.showCoverStats === true
          const showVerdictNumbers = c.showVerdictNumbers === true
          const SM = snap.metrics
          /** The second line under a figure: the same metric on another basis, or nothing.
           *  Jon, 2026-09-22: "on the original owner reporting, you could do net and fees, and then
           *  a gross number below it. You could do gross only." Both controls are the report's own
           *  (basis.snapshotPrimary / basis.snapshotSecondary), so the deck and the scroll report
           *  can never disagree about which basis an owner is looking at. */
          const cardSecond = (card: Any): string => {
            if (snapSecondary === 'none' || snapSecondary === snapPrimary) return ''
            const k = String(card.key || '')
            if (!hasBasisRaw(SM) || (k !== 'revenue' && k !== 'adr' && k !== 'revpar')) return ''
            const st = basisStrings(SM, snapSecondary as Basis)
            const v = k === 'revenue' ? st.rev : k === 'adr' ? st.adr : st.revpar
            return v ? BASIS_SHORT[snapSecondary as Basis] + ' ' + v : ''
          }
          const cardValue = (card: Any, b: Basis): string => {
            const ov = typeof card.override === 'string' && card.override.trim() !== '' ? card.override : null
            if (ov) return ov
            const k = String(card.key || '')
            if (hasBasisRaw(SM) && (k === 'revenue' || k === 'adr' || k === 'revpar')) {
              const st = basisStrings(SM, b)
              return k === 'revenue' ? st.rev : k === 'adr' ? st.adr : st.revpar
            }
            if (hasBasisRaw(SM) && k === 'occupancy' && SM.occPct != null) return String(SM.occPct) + '%'
            return String(card.value || '')
          }

          // The one line of furniture on every slide: who this is for, and where you are in it.
          const periodLabel = String(hero.dateLabel || meta.period || '').trim()
          const footLeft = [String(hero.title || ''), periodLabel].filter(Boolean).join(' · ')

          /** THE FRAME. Header, margins, footer — identical on every slide, set once. */
          const Frame = ({ sec, subj, tone, n, children, nav, note }: { sec: string; subj?: string; tone: SlideTone; n: number; children: React.ReactNode; nav: string; note?: string }) => {
            const dark = tone === 'dark'
            const meta1 = { fontSize: 9.5, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase' as const, color: dark ? D.muted : tint(0.45), margin: 0 }
            return (
              <Slide nav={nav} noteKey={note} warn={edit} pad={0} ground={GROUND[tone]}>
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '40px 72px 38px' }}>
                  <div className="flex items-baseline justify-between" style={{ flex: '0 0 auto' }}>
                    <p style={meta1}>{sec}</p>
                    <p style={meta1}>{subj || ''}</p>
                  </div>
                  <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: 22, paddingBottom: 18 }}>
                    {children}
                  </div>
                  <div className="flex items-baseline justify-between" style={{ flex: '0 0 auto' }}>
                    <p style={meta1}>{footLeft}</p>
                    <p style={{ fontFamily: SERIF, fontSize: 13, color: dark ? D.muted : tint(0.45), margin: 0 }}>{pad2(n)}</p>
                  </div>
                </div>
              </Slide>
            )
          }

          /** The 26px accent rule that opens a reading slide. */
          const Tick = ({ dark }: { dark?: boolean }) => (
            <span style={{ display: 'block', width: 26, height: 2, borderRadius: 2, background: dark ? D.ink : t.accent, marginBottom: 14 }} />
          )
          const H1 = ({ children, w }: { children: React.ReactNode; w?: string }) => (
            <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 58, lineHeight: 1.03, letterSpacing: '-0.028em', color: t.ink, margin: 0, maxWidth: w || '16ch' }}>{children}</h2>
          )
          const H2 = ({ children, dark, w }: { children: React.ReactNode; dark?: boolean; w?: string }) => (
            <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 37, lineHeight: 1.16, letterSpacing: '-0.02em', color: dark ? D.ink : t.ink, margin: 0, maxWidth: w || '24ch' }}>{children}</h2>
          )
          const Lead = ({ children, dark, w }: { children: React.ReactNode; dark?: boolean; w?: string }) => (
            <p style={{ fontSize: 18, lineHeight: 1.62, color: dark ? D.body : tint(0.62), margin: 0, maxWidth: w || '64ch' }}>{children}</p>
          )
          const Lbl = ({ children, dark }: { children: React.ReactNode; dark?: boolean }) => (
            <p style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.17em', textTransform: 'uppercase', color: dark ? D.muted : tint(0.45), margin: 0, lineHeight: 1.3 }}>{children}</p>
          )
          /** A figure. Serif, tabular, and the only thing on a slide allowed to be this big. */
          const Fig = ({ children, size, dark, color }: { children: React.ReactNode; size?: number; dark?: boolean; color?: string }) => (
            <span style={{ display: 'block', fontFamily: SERIF, fontWeight: 400, fontSize: size || 34, lineHeight: 0.94, letterSpacing: '-0.025em', fontVariantNumeric: 'tabular-nums', color: color || (dark ? D.ink : t.ink) }}>{children}</span>
          )

          // Kept from the first pass: a title block driven by the section's own editable copy.
          const RTitle = ({ k, dark, narrow }: { k: string; dark?: boolean; narrow?: boolean }) => {
            const sec = (c as Any)[k] || {}
            return (
              <div>
                <Tick dark={dark} />
                <H2 dark={dark} w={narrow ? '18ch' : '26ch'}>
                  <Ed v={sec.headline || ''} set={v => patch(k + '.headline', v)} edit={edit} multiline />
                </H2>
                {(sec.subtitle || edit) ? (
                  <p style={{ marginTop: 13, fontSize: 15, lineHeight: 1.6, color: dark ? D.muted : tint(0.5), maxWidth: '62ch' }}>
                    <Ed v={sec.subtitle || ''} set={v => patch(k + '.subtitle', v)} edit={edit} multiline />
                  </p>
                ) : null}
              </div>
            )
          }

          const Stat = ({ label, value, sub, dark, big }: { label: string; value: string; sub?: string; dark?: boolean; big?: boolean }) => (
            <div>
              <Lbl dark={dark}>{label}</Lbl>
              <div style={{ marginTop: 9 }}><Fig size={big ? 56 : 34} dark={dark}>{value}</Fig></div>
              {sub ? <p style={{ fontSize: 12.5, color: dark ? D.muted : tint(0.45), margin: '9px 0 0', lineHeight: 1.45 }}>{sub}</p> : null}
            </div>
          )

          // EVERY PHOTO ON THIS DECK IS SELECTABLE (Jon, 2026-09-22: "we can use more photos, all
          // editiable and sletable"). Unset falls back to the gallery resolved from the report's
          // own listings, so a review that has never been edited still opens with photography.
          const photoAt = (k: string, i: number): string => {
            const set = (c.slidePhotos || {}) as Any
            const chosen = String(set[k] || '')
            if (chosen) return chosen
            const pics = Array.isArray(gallery) ? gallery : []
            return pics.length ? pics[i % pics.length] : ''
          }
          const RPick = ({ k, i, style, alt }: { k: string; i: number; style?: Any; alt?: string }) => {
            const cur = photoAt(k, i)
            if (!cur && !edit) return null
            return (
              <div style={{ position: 'relative', overflow: 'hidden', background: t.chip, ...(style || {}) }}>
                {cur ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cur} alt={alt || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : null}
                {edit && (
                  <button
                    onClick={() => { setPhotoUrl(''); setPhotoPick({ title: 'Photo for this slide', cur, set: u => patch('slidePhotos.' + k, u) }) }}
                    className="sb-noprint" title="Change this photo"
                    style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0, cursor: 'pointer' }}>
                    <span style={{ position: 'absolute', bottom: 9, right: 9, fontSize: 10.5, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.94)', color: '#111' }}>
                      {cur ? 'Change' : 'Add a photo'}
                    </span>
                  </button>
                )}
              </div>
            )
          }

          // A NOTE ON ANY SLIDE (Jon, 2026-09-22: "be able to add notes"). Shown to the owner when
          // it has words in it, offered as an empty line only while editing.
          const SlideNote = ({ k, dark }: { k: string; dark?: boolean }) => {
            const notes = (c.slideNotes || {}) as Any
            const v = String(notes[k] || '')
            if (!v && !edit) return null
            return (
              <div style={{ marginTop: 20, borderLeft: '2px solid ' + (dark ? D.rule : t.accent), paddingLeft: 13 }}>
                <p style={{ fontSize: 13, lineHeight: 1.5, color: dark ? D.body : tint(0.62), margin: 0 }}>
                  <Ed v={v} set={x => patch('slideNotes.' + k, x)} edit={edit} multiline placeholder="A note for the owner on this slide…" />
                </p>
              </div>
            )
          }

          const slides: { key: string; node: React.ReactNode; ai?: boolean }[] = []
          const next = () => slides.length + 1

          // ── 1 · COVER ─────────────────────────────────────────────────────
          // Full-bleed photography with a directional scrim, the wordmark small and quiet at the
          // top, the property at display size, and the month's headline figures on a rule beneath
          // it. The previous cover set the logo alone above a void with a photo butting into the
          // text, which is the single clearest tell of a generated deck.
          {
            const coverImg = String(hero.heroImage || photoAt('hero', 0) || '')
            const cards: Any[] = Array.isArray(snap.cards) ? snap.cards : []
            slides.push({ key: 'hero', node: (
              <Slide nav="Cover" warn={edit} bleed ground={GROUND.dark}>
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
                  {coverImg ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={coverImg} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : null}
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(88deg, rgba(8,18,28,0.94) 0%, rgba(8,18,28,0.80) 36%, rgba(8,18,28,0.18) 74%, rgba(8,18,28,0.44) 100%)' }} />
                  {edit && (
                    <button onClick={() => { setPhotoUrl(''); setPhotoPick({ title: 'Cover photo', cur: coverImg, set: u => patch('hero.heroImage', u) }) }}
                      className="sb-noprint" style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0, cursor: 'pointer' }}>
                      <span style={{ position: 'absolute', bottom: 14, right: 14, fontSize: 10.5, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.94)', color: '#111' }}>
                        {coverImg ? 'Change cover' : 'Add a cover photo'}
                      </span>
                    </button>
                  )}
                  <div style={{ position: 'absolute', inset: 0, padding: '44px 72px 40px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pointerEvents: 'none' }}>
                    <div className="flex items-baseline justify-between">
                      {mark.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={mark.logo} alt={mark.word} style={{ height: 26, width: 'auto', objectFit: 'contain' }} />
                      ) : (
                        <p style={{ fontFamily: SERIF, fontSize: 15, letterSpacing: '0.3em', textTransform: 'uppercase', color: '#fff', opacity: 0.92, margin: 0 }}>{mark.word}</p>
                      )}
                      <p style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', margin: 0 }}>Owner review</p>
                    </div>
                    <div style={{ pointerEvents: 'auto' }}>
                      <p style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.62)', margin: '0 0 18px' }}>
                        <Ed v={hero.dateLabel || 'OWNER REVIEW'} set={v => patch('hero.dateLabel', v)} edit={edit} />
                      </p>
                      <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 66, lineHeight: 1.02, letterSpacing: '-0.028em', color: '#fff', margin: 0, maxWidth: '13ch' }}>
                        <Ed v={hero.title || ''} set={v => patch('hero.title', v)} edit={edit} />
                      </h1>
                      {/* THE COVER NO LONGER RECITES THE SNAPSHOT (Jon, 2026-09-22: "the first
                          three slides basically show the same data"). Cover, The Month and
                          Snapshot were each printing revenue, occupancy and rate, so an owner read
                          the same four numbers three times before anything new was said. The
                          numbers live on ONE slide now; the cover carries the property, the period
                          and the month's sentence. It can be switched back on per report for a
                          deck that will only ever be seen as a single page. */}
                      {showCoverStats && cards.length ? (
                        <div className="flex" style={{ marginTop: 32, borderTop: '1px solid rgba(255,255,255,0.20)', paddingTop: 20 }}>
                          {cards.slice(0, 4).map((x: Any, i: number, arr: Any[]) => (
                            <div key={x.key || i} style={{ paddingRight: i === arr.length - 1 ? 0 : 44, marginRight: i === arr.length - 1 ? 0 : 44, borderRight: i === arr.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.14)' }}>
                              <span style={{ display: 'block', fontFamily: SERIF, fontWeight: 400, fontSize: 33, lineHeight: 1, letterSpacing: '-0.025em', fontVariantNumeric: 'tabular-nums', color: '#fff' }}>{cardValue(x, snapPrimary)}</span>
                              <span style={{ display: 'block', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.62)', marginTop: 9 }}>{String(x.label || '')}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ fontSize: 19, lineHeight: 1.55, color: 'rgba(255,255,255,0.88)', margin: '20px 0 0', maxWidth: '44ch' }}>
                          <Ed v={hero.headline || (verdict ? String(verdict.headline || '') : '')} set={v => patch('hero.headline', v)} edit={edit} multiline />
                        </p>
                      )}
                      {edit ? (
                        <button className="sb-noprint" onClick={() => patch('showCoverStats', !showCoverStats)}
                          style={{ marginTop: 16, fontSize: 11, fontWeight: 600, padding: '5px 11px', borderRadius: 999, background: 'rgba(255,255,255,0.14)', color: '#fff' }}>
                          {showCoverStats ? 'Take the numbers off the cover' : 'Put the numbers on the cover'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </Slide>
            ) })
          }

          // ── 2 · THE MONTH — the verdict, at display size ───────────────────
          if (verdict && !hid('verdict')) {
            const n = next()
            slides.push({ key: 'verdict', node: (
              <Frame note="verdict" nav="The Month" sec="Performance" subj="The month" tone="light" n={n}>
                <Tick />
                <H1 w="17ch">
                  <Ed v={verdict.headline || ''} set={x => setVerdict({ ...verdict, headline: x, edited: true })} edit={edit} multiline />
                </H1>
                <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(verdict.lines || []).slice(0, 3).map((l: Any, i: number) => (
                    <Lead key={l.key || i}>
                      <Ed v={l.text || ''} set={x => setVerdict({ ...verdict, edited: true, lines: (verdict.lines || []).map((y: Any, j: number) => (j === i ? { ...y, text: x } : y)) })} edit={edit} multiline />
                    </Lead>
                  ))}
                </div>
                {showVerdictNumbers && (verdict.numbers || []).length ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + Math.min(3, (verdict.numbers || []).length) + ', minmax(0,1fr))', borderTop: '1px solid ' + tint(0.12), marginTop: 34, paddingTop: 22 }}>
                    {(verdict.numbers || []).slice(0, 3).map((x: Any) => (
                      <div key={x.key} style={{ paddingRight: 34 }}>
                        <Fig size={40} color={/^[-−]/.test(String(x.value || '')) ? t.accent : t.ink}>{x.value}</Fig>
                        <div style={{ marginTop: 12 }}><Lbl>{x.label}</Lbl></div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {edit ? (
                  <button className="sb-noprint" onClick={() => patch('showVerdictNumbers', !showVerdictNumbers)}
                    style={{ marginTop: 18, fontSize: 11, fontWeight: 600, padding: '5px 11px', borderRadius: 999, background: tint(0.07), color: tint(0.62), alignSelf: 'flex-start' }}>
                    {showVerdictNumbers ? 'Hide the figures — the snapshot has them' : 'Show the three figures here too'}
                  </button>
                ) : null}
                <SlideNote k="verdict" />
              </Frame>
            ) })
          }

          // ── 3 · SNAPSHOT — one number leads, five step down beside it ──────
          // The old slide set four numbers at identical size under a headline that recited two of
          // them. Revenue now carries the slide and everything else sits on a hairline grid, so
          // the hierarchy itself says what the month was about.
          if (!hid('snapshot')) {
            const n = next()
            const cards: Any[] = Array.isArray(snap.cards) ? snap.cards : []
            const lead = cards.find((x: Any) => String(x.key).toLowerCase() === 'revenue') || cards[0]
            const rest = cards.filter((x: Any) => x !== lead).slice(0, 6)
            slides.push({ key: 'snapshot', ai: true, node: (
              <Frame note="snapshot" nav="Snapshot" sec="Performance" subj={BASIS_NOTE[snapPrimary]} tone="tint" n={n}>
                {edit && (
                  <div className="sb-noprint flex items-center flex-wrap" style={{ gap: 12, marginBottom: 18 }}>
                    <BasisPicker label="Big number" value={snapPrimary} onPick={(v: string) => setBasis('snapshotPrimary', v)} t={t} />
                    <BasisPicker label="Below it" value={snapSecondary} withNone onPick={(v: string) => setBasis('snapshotSecondary', v)} t={t} />
                    <span style={{ fontSize: 12, color: tint(0.45) }}>Every figure here and on the cover follows the big number.</span>
                  </div>
                )}
                {lead ? (
                  <div className="flex items-center" style={{ gap: 56 }}>
                    <div style={{ width: 352, flexShrink: 0 }}>
                      <Lbl>{String(lead.label || 'Revenue')}</Lbl>
                      <div style={{ marginTop: 16 }}><Fig size={88}>{cardValue(lead, snapPrimary)}</Fig></div>
                      {cardSecond(lead) ? (
                        <p style={{ fontSize: 15, fontWeight: 600, color: t.accent, margin: '12px 0 0', fontVariantNumeric: 'tabular-nums' }}>{cardSecond(lead)}</p>
                      ) : null}
                      {(snap.subtitle || edit) ? (
                        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: tint(0.62), margin: '16px 0 0', maxWidth: '32ch' }}>
                          <Ed v={snap.subtitle || ''} set={v => patch('snapshot.subtitle', v)} edit={edit} multiline placeholder="One line about the month\u2026" />
                        </p>
                      ) : null}
                      {/* SINCE THE LAST ONE. Only ever present when an earlier live report for
                          this scope and this month exists to be measured against — delete that
                          report and these quietly stop appearing (lib/report-delta). */}
                      {delta && delta.rows.length ? (
                        <div style={{ marginTop: 18 }}>
                          <div className="flex flex-wrap" style={{ gap: 7 }}>
                            {delta.rows.slice(0, 4).map((d: Any) => (
                              <span key={d.key} className="flex items-baseline" style={{
                                gap: 5, fontSize: 11.5, fontWeight: 600, padding: '5px 10px', borderRadius: 999,
                                fontVariantNumeric: 'tabular-nums',
                                background: d.good ? inkA(t.good, 0.12) : inkA(t.accent, 0.12),
                                color: d.good ? t.good : t.accent,
                              }}>
                                {d.delta}
                                <span style={{ fontWeight: 500, opacity: 0.75 }}>{d.label}</span>
                                {d.pct ? <span style={{ fontWeight: 500, opacity: 0.6 }}>{d.pct}</span> : null}
                              </span>
                            ))}
                          </div>
                          <p style={{ fontSize: 11.5, color: tint(0.45), margin: '9px 0 0' }}>
                            {'Since the review of ' + String(delta.since) + (delta.days ? ' · ' + delta.days + ' day' + (delta.days === 1 ? '' : 's') + ' ago' : '')}
                          </p>
                        </div>
                      ) : null}
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
                      {rest.map((card: Any, i: number) => {
                        const topRow = i < 3
                        return (
                          <div key={card.key || i} style={{
                            paddingRight: 20, paddingBottom: topRow ? 20 : 0, paddingTop: topRow ? 0 : 20,
                            borderRight: (i % 3) === 2 ? 'none' : '1px solid ' + tint(0.12),
                            borderBottom: topRow && rest.length > 3 ? '1px solid ' + tint(0.12) : 'none',
                          }}>
                            <Lbl>{String(card.label || '')}</Lbl>
                            <div style={{ marginTop: 8 }}><Fig size={33}>{cardValue(card, snapPrimary)}</Fig></div>
                            {cardSecond(card) ? (
                              <p style={{ fontSize: 11.5, fontWeight: 600, color: t.accent, margin: '7px 0 0', fontVariantNumeric: 'tabular-nums' }}>{cardSecond(card)}</p>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
                <SlideNote k="snapshot" />
              </Frame>
            ) })
          }

          // ── 4 · UNIT BY UNIT — scrolls inside its own frame ────────────────
          // Jon, 2026-09-22: "the lsiitng should be on scrollable page not 3 sperate pages" and
          // then "use scrollability on the slides instead of a giant slide". So: the 16:9 frame is
          // preserved, the head sticks, the total is pinned below the scroller where it is always
          // readable, and each row carries a bar of that unit's share of the building's month —
          // which turns a wall of digits into a picture of where the money came from.
          if (listingTable && listingTable.rows.length && !hid('listings')) {
            const n = next()
            const netBasis: Basis = (isBasis(bSection('byListing')) ? bSection('byListing') : 'netota') as Basis
            const tri = (r: Any, b: Basis) => basisTriple(r as Any, b)
            const revLabel = BASIS_SHORT[netBasis] === 'Net + fees' ? 'Net' : BASIS_SHORT[netBasis]
            const revOf = (r: Any) => tri(r, netBasis).revenue
            const top = listingTable.rows.reduce((m: number, r: Any) => Math.max(m, revOf(r)), 0) || 1
            const all = listingTable.rows.reduce((s: number, r: Any) => s + revOf(r), 0) || 1
            const size = (r: Any) => (r.bedrooms == null ? '' : Number(r.bedrooms) === 0 ? 'Studio' : Number(r.bedrooms) + ' BR')
            const cols: { key: string; label: string; w: number }[] = [
              { key: 'unit', label: 'Unit', w: 0 },
              { key: 'share', label: 'Share of month', w: 150 },
              { key: 'occ', label: 'Occ', w: 62 },
              { key: 'adr', label: 'ADR', w: 78 },
              { key: 'revpar', label: 'RevPAR', w: 82 },
              { key: 'nights', label: 'Nights', w: 66 },
              { key: 'rev', label: revLabel, w: 96 },
            ]
            const grid = cols.map(x => (x.w ? x.w + 'px' : 'minmax(0,1fr)')).join(' ')
            const cell = (r: Any, key: string): string => {
              if (key === 'rev') return usd(revOf(r))
              if (key === 'occ') return Math.round(Number(r.occPct) || 0) + '%'
              if (key === 'adr') return usd(tri(r, netBasis).adr)
              if (key === 'revpar') return usd(tri(r, netBasis).revpar)
              if (key === 'nights') return String(r.occNights ?? '')
              return ''
            }
            const best = listingTable.rows[0]
            slides.push({ key: 'listings', node: (
              <Frame note="listings" nav="By listing" sec="Portfolio" subj={BASIS_NOTE[netBasis]} tone="tint" n={n}>
                <div className="flex items-end justify-between" style={{ gap: 24, flex: '0 0 auto' }}>
                  <div style={{ minWidth: 0 }}>
                    <Tick />
                    <H2 w="20ch">
                      <Ed v={String(c.listingsTitle || ('All ' + listingTable.totals.units + ' units.'))} set={v => patch('listingsTitle', v)} edit={edit} />
                    </H2>
                  </div>
                  <div className="flex items-center" style={{ gap: 14, flexShrink: 0 }}>
                    <p style={{ fontSize: 12.5, lineHeight: 1.5, color: tint(0.45), margin: 0, maxWidth: '30ch', textAlign: 'right' }}>
                      <Ed v={String(c.listingsNote || 'Scroll the list. The bar is each unit’s share of the building’s month.')} set={v => patch('listingsNote', v)} edit={edit} multiline />
                    </p>
                    {edit && (
                      <span className="sb-noprint">
                        <BasisPicker label="Basis" value={bSection('byListing')} onPick={(v: string) => setBasis('byListing', v)} t={t} />
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, marginTop: 18 }}>
                  <div className="sb-scrollpane" style={{ height: '100%', overflowY: 'auto', overscrollBehavior: 'contain', paddingRight: 8 }}>
                    <div style={{ position: 'sticky', top: 0, zIndex: 1, background: GROUND.tint, display: 'grid', gridTemplateColumns: grid, gap: 10, paddingBottom: 9, borderBottom: '1px solid ' + t.ink }}>
                      {cols.map(x => (
                        <p key={x.key} style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', color: tint(0.45), margin: 0, textAlign: x.key === 'unit' || x.key === 'share' ? 'left' : 'right' }}>{x.label}</p>
                      ))}
                    </div>
                    {listingTable.rows.map((r: Any) => {
                      const rev = revOf(r)
                      return (
                        <div key={r.id} style={{ display: 'grid', gridTemplateColumns: grid, gap: 10, padding: '9px 0', borderBottom: '1px solid ' + tint(0.07), alignItems: 'center' }}>
                          <div style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 9 }}>
                            <span style={{ fontSize: 14, color: t.ink, fontWeight: 500, whiteSpace: 'nowrap' }}>{String(r.unit || r.name || '')}</span>
                            {size(r) ? <span style={{ fontSize: 11, color: tint(0.45) }}>{size(r)}</span> : null}
                            {r.name && r.name !== r.unit ? <span style={{ fontSize: 11, color: tint(0.35), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(r.name)}</span> : null}
                          </div>
                          <div className="flex items-center" style={{ gap: 9 }}>
                            <span style={{ position: 'relative', width: 94, height: 7, borderRadius: 9, background: tint(0.07), flexShrink: 0 }}>
                              <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 9, width: Math.max(2, (rev / top) * 100) + '%', background: r.id === best.id ? t.accent : tint(0.22) }} />
                            </span>
                            <span style={{ fontSize: 11, color: tint(0.45), fontVariantNumeric: 'tabular-nums' }}>{((rev / all) * 100).toFixed(1)}%</span>
                          </div>
                          {cols.slice(2).map(x => (
                            <p key={x.key} style={{ fontSize: 13.5, color: x.key === 'rev' ? t.ink : tint(0.62), fontWeight: x.key === 'rev' ? 500 : 400, margin: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{cell(r, x.key)}</p>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ position: 'absolute', left: 0, right: 8, bottom: 0, height: 40, pointerEvents: 'none', background: 'linear-gradient(transparent, ' + GROUND.tint + ')' }} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 10, padding: '11px 8px 0 0', borderTop: '1px solid ' + t.ink, flex: '0 0 auto' }}>
                  <p style={{ fontSize: 14, fontWeight: 500, color: t.ink, margin: 0 }}>{'All ' + listingTable.totals.units + ' units'}</p>
                  <p style={{ fontSize: 12.5, color: tint(0.45), margin: 0 }}>100%</p>
                  {cols.slice(2).map(x => (
                    <p key={x.key} style={{ fontSize: 14, fontWeight: 500, color: t.ink, margin: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{cell(listingTable.totals, x.key)}</p>
                  ))}
                </div>
              </Frame>
            ) })
          }

          // ── 5 · AGAINST THE MARKET ────────────────────────────────────────
          // A real chart: one scale, gridlines behind the marks, a direct label on every bar, and
          // a legend that says what the comp set actually is. Ours is the accent; the comp set is
          // ink at 22% — a lightness difference, the one encoding that survives every form of
          // colour blindness.
          //
          // AND THE NUMBERS ARE THE CONTROLS (Jon, 2026-09-22: "need to be able to edit our data on
          // comp set and it affect the charts"). In edit mode both figures on every row are typed
          // in place; the bars are measured from those strings at render, so a correction to the
          // comp set moves the chart as you type. Nothing is stored twice, so nothing can disagree.
          if (c.pacing && (c.pacing.rows || []).length && !hid('pacing')) {
            const n = next()
            const rows = (c.pacing.rows as Any[])
            slides.push({ key: 'pacing', ai: true, node: (
              <Frame note="pacing" nav="Pacing" sec="Performance" subj="Against the market" tone="light" n={n}>
                <RTitle k="pacing" />
                <div style={{ marginTop: 20 }}>
                  {rows.map((r: Any, i: number) => {
                    const a = num(r.ours), b = num(r.comps), top = Math.max(a, b, 1) * 1.15
                    const gap = a - b
                    const behind = gap < 0
                    const pct = b ? (gap / Math.abs(b)) * 100 : null
                    return (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '128px minmax(0,1fr)', gap: 20, alignItems: 'center', padding: '13px 0', borderTop: i ? '1px solid ' + tint(0.12) : 'none' }}>
                        <div>
                          <p style={{ fontSize: 13, fontWeight: 500, color: t.ink, margin: 0 }}>{String(r.metric || '')}</p>
                          <p style={{ fontSize: 11.5, fontWeight: 600, color: behind ? t.accent : t.good, margin: '4px 0 0', fontVariantNumeric: 'tabular-nums' }}>
                            {String(r.delta || '')}
                          </p>
                        </div>
                        <ChartTip title={String(r.metric || '')} rows={[
                          ['17 West', String(r.ours || '—')],
                          [String(c.pacingLegend || 'Comp set'), String(r.comps || '—')],
                          ['Difference', String(r.delta || '—')],
                          ['vs. market', pct == null ? '—' : (pct >= 0 ? '+' : '−') + Math.abs(pct).toFixed(1) + '%'],
                        ]}>
                          <div style={{ position: 'relative', height: 40 }}>
                            {[0, 25, 50, 75, 100].map(g => (
                              <span key={g} style={{ position: 'absolute', left: g + '%', top: -5, bottom: -5, width: 1, background: tint(0.07) }} />
                            ))}
                            <span style={{ position: 'absolute', left: 0, top: 1, height: 14, borderRadius: '0 4px 4px 0', background: t.accent, width: Math.max(1, (a / top) * 100) + '%' }} />
                            <span style={{ position: 'absolute', left: 0, top: 23, height: 14, borderRadius: '0 4px 4px 0', background: tint(0.22), width: Math.max(1, (b / top) * 100) + '%' }} />
                            {/* The two labels ARE the inputs in edit mode — type, and the bar above moves. */}
                            <span style={{ position: 'absolute', left: edit ? 'auto' : Math.max(1, (a / top) * 100) + '%', right: edit ? 0 : 'auto', top: 2, transform: edit ? 'none' : 'translateX(10px)', fontSize: 12.5, fontWeight: 600, color: t.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                              <Ed v={String(r.ours || '')} set={v => patch('pacing.rows.' + i + '.ours', v)} edit={edit} />
                            </span>
                            <span style={{ position: 'absolute', left: edit ? 'auto' : Math.max(1, (b / top) * 100) + '%', right: edit ? 0 : 'auto', top: 24, transform: edit ? 'none' : 'translateX(10px)', fontSize: 12.5, color: tint(0.45), fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                              <Ed v={String(r.comps || '')} set={v => patch('pacing.rows.' + i + '.comps', v)} edit={edit} />
                            </span>
                          </div>
                        </ChartTip>
                      </div>
                    )
                  })}
                </div>
                <div className="flex items-center justify-between" style={{ gap: 22, marginTop: 16 }}>
                  <div className="flex items-center" style={{ gap: 22 }}>
                    <span className="flex items-center" style={{ gap: 8, fontSize: 12, color: tint(0.62) }}>
                      <i style={{ width: 16, height: 8, borderRadius: '0 2px 2px 0', background: t.accent, display: 'inline-block' }} />17 West
                    </span>
                    <span className="flex items-center" style={{ gap: 8, fontSize: 12, color: tint(0.62) }}>
                      <i style={{ width: 16, height: 8, borderRadius: '0 2px 2px 0', background: tint(0.22), display: 'inline-block' }} />
                      <Ed v={String(c.pacingLegend || 'Comp set')} set={v => patch('pacingLegend', v)} edit={edit} />
                    </span>
                  </div>
                  {edit ? <span className="sb-noprint" style={{ fontSize: 11.5, color: tint(0.35) }}>Type over either figure — the bars follow.</span> : null}
                </div>
                <SlideNote k="pacing" />
              </Frame>
            ) })
          }

          // ── 6 · AGAINST BUDGET — the deck's dark slide ─────────────────────
          // Jon, 2026-09-22: "Budget should show how we are trending for the next month and be
          // able to add previous months and as many future months as we want", then "can we make
          // it a bit cleaner".
          //
          // WHAT THE CLEAN-UP CHANGED, and why each one was actually wrong:
          //  · The rail summarised September with "−$48" — a RevPAR delta, picked because the
          //    old regex matched RevPAR before revenue. A month's headline is its REVENUE.
          //  · The rows printed the actual with a delta beside it and no plan, so an owner could
          //    see we were $102 light on rate without ever learning the rate we had promised.
          //    Where plan is not stored we derive it: plan = actual − delta, formatted like the
          //    actual, which is exact arithmetic rather than an estimate.
          //  · The rail carried a label, a figure, a bar AND a status line per month — four
          //    elements competing with the four real bars below. The bar is gone; the selected
          //    month is marked by a rule, which is quieter and says the same thing.
          if (plan && (plan.months || []).length && !hid('plan')) {
            const n = next()
            const months = (plan.months as Any[])
            const ix = Math.max(0, Math.min(months.length - 1, planIx))
            const m0 = months[ix] || {}
            const rows = ((m0.rows || []) as Any[]).slice(0, 5)
            // THE PLAN SIDE. Stored when the generator had it, otherwise exact arithmetic off
            // the frozen pair: plan = actual − delta, formatted like the actual.
            const planOf = (r: Any): string => {
              if (r.plan) return String(r.plan)
              const a = snum(r.actual), d = snum(r.delta)
              if (!a || !r.delta) return ''
              return like(r.actual, a - d)
            }
            // THE LIVE SIDE (Jon, 2026-09-22: "on the budget, we want to be able to see our current
            // live gross numbers versus the actual budget numbers. It's not showing that.").
            //
            // plan.months was frozen when the report was generated, so an owner opening the link a
            // week later was reading last week's actuals against this year's budget. For the month
            // the report actually covers, the actual column now comes from the SAME live metrics
            // the snapshot renders, at the budget's own basis — gross by default, because that is
            // the basis a budget is set on — and the variance is recomputed against the stored
            // plan rather than carried over. Months either side of the report's own period keep
            // their stored figures; there is nothing live to put there.
            const planBasis: Basis = isBasis(bcfg.plan) ? (bcfg.plan as Basis) : 'gross'
            const liveOf = (metric: string): string => {
              if (!hasBasisRaw(SM)) return ''
              const m = String(metric || '')
              if (/occupancy|occ\b/i.test(m)) return SM.occPct == null ? '' : Math.round(Number(SM.occPct)) + '%'
              const st = basisStrings(SM, planBasis)
              if (/adr/i.test(m)) return st.adr
              if (/revpar/i.test(m)) return st.revpar
              if (/revenue|gross/i.test(m)) return st.rev
              return ''
            }
            const isLiveMonth = /in month|current|month to date|mtd/i.test(String(m0.status || ''))
            /** actual / plan / delta for one row, live where we have it. */
            const figures = (r: Any) => {
              const pl = planOf(r)
              const live = isLiveMonth ? liveOf(r.metric) : ''
              if (!live || !pl) return { actual: String(r.actual || ''), plan: pl, delta: String(r.delta || ''), live: false }
              const d = snum(live) - snum(pl)
              const unit = /occupancy|occ\b/i.test(String(r.metric || '')) ? ' pts' : ''
              const body = unit ? Math.abs(d).toFixed(0) + unit : like(pl, Math.abs(d)).replace('%', '')
              return { actual: live, plan: pl, delta: (d < 0 ? '−' : '+') + body, live: true }
            }
            const isNeg = (r: Any) => /^[-−]/.test(String(figures(r).delta || '')) || (r.good === false && !figures(r).live)
            const share = (r: Any) => { const f = figures(r); return num(f.actual) > 0 ? Math.abs(snum(f.delta)) / num(f.actual) : 0 }
            const span = rows.reduce((m: number, r: Any) => Math.max(m, share(r)), 0) || 1
            // A month's headline is its revenue line — never RevPAR, which reads as a tiny number
            // beside a five-figure miss and tells an owner nothing about the month.
            const headline = (m: Any) => {
              const rs = (m.rows || []) as Any[]
              return rs.find((r: Any) => /revenue|gross/i.test(String(r.metric || '')))
                || rs.find((r: Any) => /revpar/i.test(String(r.metric || '')))
                || rs[0] || {}
            }
            const addMonth = (where: 'before' | 'after') => mutate((d: Any) => {
              const list: Any[] = d.plan.months
              const src = list[Math.max(0, Math.min(list.length - 1, ix))] || {}
              list.splice(where === 'before' ? ix : ix + 1, 0, {
                label: 'New month', status: where === 'after' ? 'On the books' : 'Closed', note: '',
                rows: ((src.rows || []) as Any[]).map((r: Any) => ({ metric: r.metric, actual: '', plan: '', delta: '', good: true })),
              })
            })
            slides.push({ key: 'plan', ai: true, node: (
              <Frame note="plan" nav="Budget" sec="Performance" subj="Against budget" tone="dark" n={n}>
                <RTitle k="plan" dark />

                {/* THE RAIL — every month on the report, the selected one lit and ruled. */}
                <div className="flex items-stretch" style={{ marginTop: 20, borderBottom: '1px solid ' + D.rule }}>
                  {months.map((m: Any, j: number) => {
                    const h = headline(m)
                    const hd = j === ix ? figures(h).delta : String(h.delta || '')
                    const neg = /^[-−]/.test(String(hd || '')) || (h.good === false && j !== ix)
                    const on = j === ix
                    return (
                      <button key={j} onClick={() => setPlanIx(j)} title={String(m.label || '')}
                        style={{
                          flex: 1, minWidth: 0, textAlign: 'left', padding: '0 18px 13px 0', background: 'transparent',
                          cursor: months.length > 1 ? 'pointer' : 'default',
                          borderBottom: '2px solid ' + (on ? t.accent : 'transparent'), marginBottom: -1,
                        }}>
                        <span style={{ display: 'block', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: on ? D.ink : D.muted }}>
                          {String(m.label || '').replace(/\s+\d{4}$/, '')}
                          <span style={{ opacity: 0.6, letterSpacing: '0.1em', marginLeft: 8 }}>{String(m.status || '')}</span>
                        </span>
                        <span style={{ display: 'block', fontFamily: SERIF, fontSize: 22, letterSpacing: '-0.02em', marginTop: 8, fontVariantNumeric: 'tabular-nums', opacity: on ? 1 : 0.6, color: hd ? (neg ? t.accent : t.good) : D.muted }}>
                          {hd || '—'}
                        </span>
                      </button>
                    )
                  })}
                </div>

                {/* THE DETAIL — the selected month, line by line, from a true zero. */}
                <div style={{ marginTop: 10 }}>
                  {rows.map((r: Any, j: number) => {
                    const f = figures(r)
                    const neg = isNeg(r)
                    const mag = Math.min(0.46, (share(r) / span) * 0.44)
                    const pl = f.plan
                    return (
                      <div key={j} style={{ display: 'grid', gridTemplateColumns: '236px minmax(0,1fr) 112px', gap: 24, alignItems: 'center', padding: '12px 0', borderTop: j ? '1px solid ' + D.rule : 'none' }}>
                        <div className="flex items-baseline" style={{ gap: 10 }}>
                          <span style={{ fontSize: 13, color: D.muted, width: 84, flexShrink: 0 }}>{String(r.metric || '')}</span>
                          <span style={{ fontFamily: SERIF, fontSize: 21, letterSpacing: '-0.02em', color: D.ink, fontVariantNumeric: 'tabular-nums' }}>{f.actual || '—'}</span>
                          {pl ? <span style={{ fontSize: 11.5, color: D.muted, fontVariantNumeric: 'tabular-nums' }}>{'vs ' + pl}</span> : null}
                        </div>
                        <ChartTip dark title={String(r.metric || '')} rows={[
                          [f.live ? 'Live now' : 'Actual', f.actual || '—'],
                          ['Budget', pl || '—'],
                          ['Variance', f.delta || '—'],
                          ['vs. budget', (() => { const b = snum(pl); return b ? ((snum(f.delta) >= 0 ? '+' : '−') + Math.abs((snum(f.delta) / Math.abs(b)) * 100).toFixed(1) + '%') : '—' })()],
                        ]}>
                          <div style={{ position: 'relative', height: 24 }}>
                            <span style={{ position: 'absolute', left: '50%', top: -3, bottom: -3, width: 1, background: 'rgba(255,255,255,0.28)' }} />
                            <span style={{
                              position: 'absolute', top: 5, height: 14, background: neg ? t.accent : t.good,
                              ...(neg
                                ? { right: '50%', marginRight: 2, borderRadius: '4px 0 0 4px' }
                                : { left: '50%', marginLeft: 2, borderRadius: '0 4px 4px 0' }),
                              width: Math.max(0.015, mag) * 100 + '%',
                            }} />
                          </div>
                        </ChartTip>
                        <p style={{ fontFamily: SERIF, fontSize: 22, letterSpacing: '-0.02em', textAlign: 'right', margin: 0, fontVariantNumeric: 'tabular-nums', color: f.delta ? (neg ? t.accent : t.good) : D.muted }}>{f.delta || '—'}</p>
                      </div>
                    )
                  })}
                </div>
                {m0.note ? <p style={{ fontSize: 13.5, lineHeight: 1.6, color: D.body, margin: '16px 0 0', maxWidth: '80ch' }}>{String(m0.note)}</p> : null}
                {isLiveMonth && hasBasisRaw(SM) ? (
                  <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: D.muted, margin: '14px 0 0' }}>
                    {String(m0.label || '').replace(/\s+\d{4}$/, '') + ' is live — ' + BASIS_NOTE[planBasis].toLowerCase() + ', against the budget'}
                  </p>
                ) : null}
                {edit && (
                  <div className="sb-noprint flex items-center flex-wrap" style={{ gap: 9, marginTop: 14 }}>
                    <BasisPicker label="Budget basis" value={planBasis} onPick={(v: string) => setBasis('plan', v)} t={t} />
                    <button onClick={() => addMonth('before')} style={{ fontSize: 11.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.12)', color: D.ink }}>+ Month before</button>
                    <button onClick={() => addMonth('after')} style={{ fontSize: 11.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.12)', color: D.ink }}>+ Month after</button>
                    {months.length > 1 ? (
                      <button onClick={() => { mutate((d: Any) => { d.plan.months.splice(ix, 1) }); setPlanIx(Math.max(0, ix - 1)) }}
                        style={{ fontSize: 11.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, background: 'transparent', color: D.muted }}>Remove this month</button>
                    ) : null}
                  </div>
                )}
                <SlideNote k="plan" dark />
              </Frame>
            ) })
          }

          // ── 6b · THE OWNER STATEMENT ──────────────────────────────────────
          if (c.statement && ((c.statement.kpis || []).length || (c.statement.months || []).length) && !hid('statement')) {
            const n = next()
            slides.push({ key: 'statement', ai: true, node: (
              <Frame note="statement" nav="Owner statement" sec="Performance" subj="Your statement" tone="light" n={n}>
                <RTitle k="statement" />
                {(c.statement.kpis || []).length ? (
                  <div className="flex" style={{ gap: 44, marginTop: 26, flexWrap: 'wrap' }}>
                    {(c.statement.kpis as Any[]).slice(0, 4).map((k: Any, i: number) => (
                      <div key={i} style={{ minWidth: 160 }}>
                        <Stat label={String(k.label || '')} value={String(k.value || '')} sub={String(k.sub || '')} />
                      </div>
                    ))}
                  </div>
                ) : null}
                {(c.statement.months || []).length ? (() => {
                  const money0 = (x: Any) => { const v = Number(x); return Number.isFinite(v) ? usd(v) : '—' }
                  const rows = (c.statement.months as Any[]).slice(0, 6)
                  const cols2 = ['Month', 'Rental', 'Commission', 'Other', 'Net', 'Paid']
                  const g = 'minmax(0,1fr) 104px 114px 88px 104px 104px'
                  return (
                    <div style={{ marginTop: 24 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: g, gap: 10, paddingBottom: 8, borderBottom: '1px solid ' + t.ink }}>
                        {cols2.map((h, i) => (
                          <p key={h} style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', color: tint(0.45), margin: 0, textAlign: i === 0 ? 'left' : 'right' }}>{h}</p>
                        ))}
                      </div>
                      {rows.map((m: Any, i: number) => (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: g, gap: 10, padding: '9px 0', borderBottom: '1px solid ' + tint(0.07) }}>
                          <p style={{ fontSize: 13.5, color: t.ink, margin: 0, fontWeight: 500 }}>{String(m.label || m.month || '')}</p>
                          {['rental', 'commission', 'other', 'net', 'paid'].map(k => (
                            <p key={k} style={{ fontSize: 13.5, color: k === 'net' ? t.ink : tint(0.62), fontWeight: k === 'net' ? 500 : 400, margin: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money0(m[k])}</p>
                          ))}
                        </div>
                      ))}
                    </div>
                  )
                })() : null}
                <SlideNote k="statement" />
              </Frame>
            ) })
          }

          // ── 7 · ON THE BOOKS ──────────────────────────────────────────────
          // The column carries one number, because a slide has room for one. Rate, RevPAR, revenue
          // and what the month held last year all live in the hover card (Jon, 2026-09-22: "if i
          // hover over the charts on this slide it can show adr, rev gorss values").
          if ((ahead.months || []).length && !hid('ahead')) {
            const n = next()
            // Build the strip from the months themselves so every column keeps its own figures —
            // ahead.strip carries only a label and an occupancy, which is what the hover was
            // missing.
            // EACH COLUMN USES ITS OWN MONTH'S NUMBERS (fixed 2026-09-22).
            //
            // Jon: "it's not accurate to the month. October is November." He was reading a real
            // off-by-one. ahead.strip runs [previous month, current, +1 …] while ahead.months
            // starts at the CURRENT month and holds only three entries, and the first cut matched
            // a strip column to a month by the first three letters of its label with a POSITIONAL
            // fallback — so the closed month at the head of the strip fell through to months[0]
            // and wore the current month's rate, and every column after the third had nothing.
            // A chart that labels one month and prints another's ADR is worse than one that prints
            // nothing, and it is the kind of error an owner catches before we do.
            //
            // The generator now writes the full MetricSet onto every strip entry, so a column
            // reads its own figures and needs no lookup at all. Reports generated before that
            // still match by ISO month or exact label — never by position, and never by index.
            const ms = (ahead.months as Any[]) || []
            const stripRaw: Any[] = Array.isArray(ahead.strip) && ahead.strip.length ? (ahead.strip as Any[]) : ms
            const norm = (v: Any) => String(v || '').replace(/\s+\d{4}$/, '').trim().slice(0, 3).toLowerCase()
            const strip: Any[] = stripRaw.slice(0, 6).map((x: Any) => {
              // The month's own record, when this report predates the fuller strip.
              const m = ms.find((y: Any) => (x.iso && y.iso ? String(y.iso) === String(x.iso) : false))
                || ms.find((y: Any) => norm(y.label) === norm(x.month || x.label)) || {}
              const src = hasBasisRaw(x) ? x : (hasBasisRaw(m) ? m : null)
              const g = src ? basisStrings(src, 'gross') : null
              const av = src ? aheadValues(src, 'gross') : null
              return {
                month: norm(x.month || x.label) ? String(x.month || x.label).replace(/\s+\d{4}$/, '').slice(0, 3) : '',
                full: String(x.label || m.label || ''),
                iso: String(x.iso || m.iso || ''),
                occPct: x.occPct != null ? x.occPct : m.occPct,
                adr: (av && av.adr) || (g ? g.adr : '') || String(x.grossAdr || ''),
                revpar: (av && av.revpar) || (g ? g.revpar : '') || String(x.grossRevpar || ''),
                revenue: g ? g.rev : '',
                nights: x.occNights != null ? String(x.occNights) : (m.occNights != null ? String(m.occNights) : ''),
                res: x.reservations != null ? String(x.reservations) : (m.reservations != null ? String(m.reservations) : ''),
              }
            })
            // The report's own month is the one to mark, not whichever column happens to be first —
            // the strip opens on the month that just closed.
            const thisMonth = String(meta.period || '').trim()
            const curIx = Math.max(0, strip.findIndex((x: Any) => (
              (x.iso && String(x.iso).slice(0, 7) === String(initial.period_start || '').slice(0, 7))
              || (thisMonth && norm(x.full) === norm(thisMonth))
            )))
            slides.push({ key: 'ahead', ai: true, node: (
              <Frame note="ahead" nav="Looking ahead" sec="Ahead" subj="On the books" tone="light" n={n}>
                <RTitle k="ahead" />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + Math.max(1, strip.length) + ', minmax(0,1fr))', gap: 22, alignItems: 'end', height: 218, marginTop: 24 }}>
                  {strip.map((x: Any, i: number) => {
                    const pct = Math.max(0, Math.min(100, Number(x.occPct) || 0))
                    return (
                      <ChartTip key={i} title={x.full || x.month}
                        empty="On the books, but too far out to have a rate set yet."
                        rows={[
                        ['Occupancy on the books', Math.round(pct) + '%'],
                        ['Gross revenue', String(x.revenue || '')],
                        ['Gross ADR', String(x.adr || '')],
                        ['Gross RevPAR', String(x.revpar || '')],
                        ['Nights on the books', String(x.nights || '')],
                        ['Reservations', String(x.res || '')],
                      ]} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                        <Fig size={26}>{Math.round(pct) + '%'}</Fig>
                        <span style={{ marginTop: 9, borderRadius: '4px 4px 0 0', background: i === curIx ? t.accent : tint(0.22), height: Math.max(4, (pct / 100) * 142) }} />
                        <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: tint(0.45), marginTop: 12 }}>{String(x.month || '')}</span>
                        {/* The rate used to print here AND in the hover card. One of them had to go,
                            and the hover is the one that can hold the whole row. */}
                      </ChartTip>
                    )
                  })}
                </div>
                <SlideNote k="ahead" />
              </Frame>
            ) })
          }

          // ── 8 · GUEST VOICES — the score, then the words ───────────────────
          if (((voices.quotes || []).length || (voices.themes || []).length) && !hid('voices')) {
            const n = next()
            const avg = recs && recs.avgRating != null ? Number(recs.avgRating) : null
            const count = recs ? Number(recs.reviews || 0) : 0
            const quotes = (voices.quotes as Any[] || [])
            const hero1 = quotes[0]
            const rest = quotes.slice(1, 3)
            const CIRC = 326.7
            slides.push({ key: 'voices', ai: true, node: (
              <Frame note="voices" nav="Guest voices" sec="Guests" subj={count ? count + ' reviews' : 'What guests said'} tone="light" n={n}>
                <div className="flex items-center" style={{ gap: 54 }}>
                  {avg != null ? (
                    <div style={{ width: 240, flexShrink: 0 }}>
                      <div style={{ position: 'relative', width: 150, height: 150 }}>
                        <svg viewBox="0 0 120 120" width="150" height="150" aria-label={'Average review score ' + avg.toFixed(2) + ' of 5'}>
                          <circle cx="60" cy="60" r="52" fill="none" stroke={tint(0.10)} strokeWidth="7" />
                          <circle cx="60" cy="60" r="52" fill="none" stroke={t.accent} strokeWidth="7" strokeLinecap="round"
                            strokeDasharray={String(CIRC)} strokeDashoffset={String(CIRC * (1 - Math.max(0, Math.min(1, avg / 5))))}
                            transform="rotate(-90 60 60)" />
                        </svg>
                        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SERIF, fontSize: 44, letterSpacing: '-0.03em', color: t.ink, fontVariantNumeric: 'tabular-nums' }}>{avg.toFixed(1)}</span>
                      </div>
                      <div style={{ marginTop: 16 }}><Lbl>{'Average of ' + count + ' review' + (count === 1 ? '' : 's')}</Lbl></div>
                    </div>
                  ) : null}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {hero1 ? (
                      <>
                        <p style={{ fontFamily: SERIF, fontSize: 25, lineHeight: 1.42, letterSpacing: '-0.013em', color: t.ink, margin: 0 }}>&ldquo;{String(hero1.text || '')}&rdquo;</p>
                        <div style={{ marginTop: 14 }}><Lbl>{[hero1.guest, hero1.unit].filter(Boolean).join(' · ')}</Lbl></div>
                      </>
                    ) : null}
                    {rest.length ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 28, borderTop: '1px solid ' + tint(0.12), marginTop: 24, paddingTop: 20 }}>
                        {rest.map((q: Any, i: number) => (
                          <div key={i}>
                            <p style={{ fontSize: 14, lineHeight: 1.55, color: t.ink, margin: 0 }}>&ldquo;{String(q.text || '')}&rdquo;</p>
                            <div style={{ marginTop: 9 }}><Lbl>{[q.guest, q.unit].filter(Boolean).join(' · ')}</Lbl></div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <SlideNote k="voices" />
              </Frame>
            ) })
          }

          // ── 9 · WHAT WE ARE ACTING ON ─────────────────────────────────────
          // WHAT PRINTS WITHOUT ASKING. Jon, 2026-09-22: "you can mention real issue related to
          // building, pests are building issues, thats fine, lets not highlight any issue casued
          // by us, without my approval." Building problems and the owner's own worn furniture
          // print. Anything we caused is withheld: Jon sees it in the tray with an Include switch,
          // the owner does not see it at all until he flips one.
          //
          // THE BUG JON HIT, 2026-09-22: "When i click add clenaliness it removes itseld." The
          // slide showed the first three items that pass the filter — so on a report that already
          // had three building items, including a fourth pushed it past the slice and it vanished
          // from BOTH the tray and the slide. An item Jon has explicitly approved is now sorted to
          // the front, so clicking Include always puts it on the slide; what falls off the end is
          // an automatic item, which he can see and reorder.
          if (recs && (recs.items || []).length && !hid('recs')) {
            const approved: string[] = Array.isArray(c.recsApproved) ? c.recsApproved : []
            const shows = (r: Any) => r.cause !== 'ours' || approved.indexOf(r.key) >= 0
            const passing = (recs.items as Any[]).filter(shows)
            const shown = passing
              .slice()
              .sort((a: Any, b: Any) => (approved.indexOf(b.key) >= 0 ? 1 : 0) - (approved.indexOf(a.key) >= 0 ? 1 : 0))
              .slice(0, 3)
            const spare = passing.filter((r: Any) => shown.indexOf(r) < 0)
            const held = (recs.items as Any[]).filter((r: Any) => !shows(r))
            const toggle = (k: string) => mutate((d: Any) => {
              const list: string[] = Array.isArray(d.recsApproved) ? d.recsApproved.slice() : []
              const at = list.indexOf(k)
              if (at >= 0) list.splice(at, 1); else list.push(k)
              d.recsApproved = list
            })
            const CAUSE_TAG: Record<string, string> = { building: 'Building', asset: 'Asset · your call', ours: 'Ours to own' }
            if (shown.length || edit) {
              const n = next()
              slides.push({ key: 'recs', node: (
                <Frame note="recs" nav="What we are improving" sec="Guests"
                  subj={recs.reviews ? recs.reviews + ' reviews · 90 days' : 'What we\u2019re acting on'} tone="tint" n={n}>
                  <Tick />
                  <H2 w="26ch">
                    <Ed v={String(c.recsTitle || 'What guests raised, and what we are doing')} set={v => patch('recsTitle', v)} edit={edit} multiline />
                  </H2>
                  {shown.length ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + shown.length + ', minmax(0,1fr))', gap: 38, marginTop: 30 }}>
                      {shown.map((r: Any, i: number) => (
                        <div key={r.key} style={{ paddingTop: 16, borderTop: '2px solid ' + t.ink }}>
                          <div className="flex items-baseline justify-between" style={{ gap: 10 }}>
                            <span style={{ fontFamily: SERIF, fontSize: 15, color: t.accent }}>{pad2(i + 1)}</span>
                            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: tint(0.38) }}>
                              {CAUSE_TAG[String(r.cause)] || 'Noted'}{r.mentions > 1 ? ' · ' + r.mentions : ''}
                            </span>
                          </div>
                          <p style={{ fontSize: 17, fontWeight: 500, color: t.ink, margin: '12px 0 0', textTransform: 'capitalize' }}>{String(r.label || '')}</p>
                          <p style={{ fontSize: 14, lineHeight: 1.6, color: tint(0.62), margin: '9px 0 0' }}>
                            <Ed v={String((c.recsText || {})[r.key] || r.action || '')} set={v => patch('recsText.' + r.key, v)} edit={edit} multiline />
                          </p>
                          {edit && r.cause === 'ours' ? (
                            <button onClick={() => toggle(r.key)} className="sb-noprint"
                              style={{ marginTop: 11, fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: t.accent, color: '#fff' }}>
                              Included — take it off
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: 15, color: tint(0.45), margin: '26px 0 0', maxWidth: '58ch' }}>
                      Nothing on this report that is not ours to own. Anything guests raised about our own service is held below for you.
                    </p>
                  )}

                  {/* TEAM ONLY — never rendered for an owner, at any width. */}
                  {edit && (held.length || spare.length) ? (
                    <div className="sb-noprint" style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px dashed ' + tint(0.2) }}>
                      <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
                        <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: tint(0.45), marginRight: 4 }}>
                          {held.length ? 'Ours to own — off the owner\u2019s copy' : 'Not on this slide'}
                        </span>
                        {held.map((r: Any) => (
                          <button key={r.key} onClick={() => toggle(r.key)} title={String(r.quote || '')}
                            style={{ fontSize: 12, fontWeight: 500, padding: '5px 11px', borderRadius: 999, background: t.card, border: '1px solid ' + tint(0.15), color: tint(0.62), textTransform: 'capitalize' }}>
                            + {String(r.label)} <span style={{ color: tint(0.35) }}>{r.mentions}</span>
                          </button>
                        ))}
                        {spare.map((r: Any) => (
                          <span key={r.key} title="Passes the filter, but only three fit the slide"
                            style={{ fontSize: 12, padding: '5px 11px', borderRadius: 999, background: 'transparent', border: '1px dashed ' + tint(0.15), color: tint(0.35), textTransform: 'capitalize' }}>
                            {String(r.label)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <SlideNote k="recs" />
                </Frame>
              ) })
            }
          }

          // ── 10 · THE WORK ─────────────────────────────────────────────────
          if ((projects.weeks || []).length && !hid('projects')) {
            const groups: Any[] = []
            for (const w of (projects.weeks as Any[])) for (const g of (w.groups || [])) {
              const found = groups.find((x: Any) => x.category === g.category)
              if (found) found.items = found.items.concat(g.items || [])
              else groups.push({ category: g.category, items: (g.items || []).slice() })
            }
            if (groups.length) {
              const n = next()
              slides.push({ key: 'projects', ai: true, node: (
                <Frame note="projects" nav="The work" sec="Ahead" subj="What we did" tone="light" n={n}>
                  <RTitle k="projects" />
                  <div style={{ marginTop: 26, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: '26px 34px' }}>
                    {groups.slice(0, 6).map((g: Any, i: number) => (
                      <div key={i} style={{ paddingTop: 14, borderTop: '1px solid ' + tint(0.22) }}>
                        <Lbl>{String(g.category || '')}</Lbl>
                        <div style={{ marginTop: 10 }}>
                          {(g.items || []).slice(0, 4).map((it: string, j: number) => (
                            <p key={j} style={{ fontSize: 13, lineHeight: 1.55, color: tint(0.62), margin: '0 0 6px' }}>{String(it)}</p>
                          ))}
                          {(g.items || []).length > 4 ? <p style={{ fontSize: 12, color: tint(0.35), margin: 0 }}>+{(g.items || []).length - 4} more</p> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  <SlideNote k="projects" />
                </Frame>
              ) })
            }
          }

          // ── 11 · ANYTHING JON ADDED ───────────────────────────────────────
          // THREE KINDS OF ADDED SLIDE (Jon, 2026-09-22: "want to be able to add photos from the
          // propery, work complted, add a notes tab that we can take notes on"). All three live on
          // content.custom so they save with the report and travel on the share link:
          //   text   — a title and a paragraph, the original.
          //   photos — up to six pictures of the property or of work completed, each one picked
          //            from the same gallery the rest of the deck draws on, each with a caption.
          //   notes  — a page for whatever was said in the room. Ruled, so it reads as notes
          //            rather than as another block of report copy.
          customSecs.forEach((cs: Any, ci: number) => {
            const n = next()
            const kind = String(cs.kind || 'text')
            const at = (c.custom as Any[]).indexOf(cs)
            const tone: SlideTone = ci % 2 ? 'tint' : 'light'
            const setCs = (field: string, v: Any) => patch('custom.' + at + '.' + field, v)

            if (kind === 'photos') {
              const pics: string[] = Array.isArray(cs.photos) ? cs.photos : []
              const caps: string[] = Array.isArray(cs.caps) ? cs.caps : []
              const count = Math.max(3, Math.min(6, pics.length || 3))
              const shown = Array.from({ length: edit ? count : pics.filter(Boolean).length || count }, (_, j) => j)
              const cols = shown.length <= 2 ? shown.length : shown.length <= 4 ? 2 : 3
              slides.push({ key: 'custom', node: (
                <Frame nav={String(cs.title || 'Photos')} sec={String(cs.eyebrow || 'Property')} subj={String(cs.title || 'Photos')} tone={tone} n={n}>
                  <div className="flex items-end justify-between" style={{ gap: 24, flex: '0 0 auto' }}>
                    <div><Tick /><H2 w="22ch"><Ed v={String(cs.title || 'The property')} set={v => setCs('title', v)} edit={edit} /></H2></div>
                    {edit && pics.length < 6 ? (
                      <button className="sb-noprint" onClick={() => mutate((d: Any) => { const x = d.custom[at]; x.photos = Array.isArray(x.photos) ? x.photos : []; x.photos.push('') })}
                        style={{ fontSize: 12, fontWeight: 600, borderRadius: 999, padding: '7px 14px', background: t.ink, color: t.bg, flexShrink: 0 }}>+ Photo</button>
                    ) : null}
                  </div>
                  <div style={{ flex: '1 1 auto', minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(' + cols + ', minmax(0,1fr))', gap: 16, marginTop: 20 }}>
                    {shown.map(j => {
                      const cur = String(pics[j] || '')
                      return (
                        <div key={j} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                          <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, overflow: 'hidden', borderRadius: 10, background: tint(0.07) }}>
                            {cur ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={cur} alt={String(caps[j] || '')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : null}
                            {edit && (
                              <button className="sb-noprint" onClick={() => { setPhotoUrl(''); setPhotoPick({ title: 'Photo for this page', cur, set: u => setCs('photos.' + j, u) }) }}
                                style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0, cursor: 'pointer' }}>
                                <span style={{ position: 'absolute', bottom: 8, right: 8, fontSize: 10.5, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.94)', color: '#111' }}>
                                  {cur ? 'Change' : 'Add a photo'}
                                </span>
                              </button>
                            )}
                          </div>
                          {(caps[j] || edit) ? (
                            <p style={{ fontSize: 11.5, lineHeight: 1.45, color: tint(0.45), margin: '9px 0 0' }}>
                              <Ed v={String(caps[j] || '')} set={v => setCs('caps.' + j, v)} edit={edit} placeholder="Caption" />
                            </p>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </Frame>
              ) })
              return
            }

            if (kind === 'notes') {
              slides.push({ key: 'custom', node: (
                <Frame nav={String(cs.title || 'Notes')} sec={String(cs.eyebrow || 'Notes')} subj={String(cs.title || 'Notes')} tone={tone} n={n}>
                  <Tick />
                  <H2 w="22ch"><Ed v={String(cs.title || 'Notes from this review')} set={v => setCs('title', v)} edit={edit} /></H2>
                  <div style={{ flex: '1 1 auto', minHeight: 0, marginTop: 20, overflowY: 'auto', paddingRight: 8 }} className="sb-scrollpane">
                    <p style={{ fontSize: 16, lineHeight: 2.1, color: tint(0.72), margin: 0, maxWidth: '76ch', whiteSpace: 'pre-wrap',
                      backgroundImage: 'repeating-linear-gradient(to bottom, transparent, transparent 32px, ' + tint(0.09) + ' 32px, ' + tint(0.09) + ' 33px)',
                      backgroundPosition: '0 0.55em' }}>
                      <Ed v={String(cs.body || '')} set={v => setCs('body', v)} edit={edit} multiline placeholder="What was agreed, what was asked, what happens next…" />
                    </p>
                  </div>
                </Frame>
              ) })
              return
            }

            slides.push({ key: 'custom', node: (
              <Frame nav={String(cs.title || 'Note')} sec={String(cs.eyebrow || 'Note')} subj={String(cs.title || '')} tone={tone} n={n}>
                <Tick />
                <H2 w="22ch"><Ed v={String(cs.title || '')} set={v => setCs('title', v)} edit={edit} /></H2>
                <p style={{ fontSize: 18, lineHeight: 1.62, color: tint(0.62), margin: '20px 0 0', maxWidth: '62ch', whiteSpace: 'pre-wrap' }}>
                  <Ed v={String(cs.body || '')} set={v => setCs('body', v)} edit={edit} multiline />
                </p>
              </Frame>
            ) })
          })
          return (
            <TextScale.Provider value={textScale}>
              {slides.map((sl, i) => (
                <SectionShell key={sl.key + '-' + i} id={sl.key + '-' + i} title={sl.key}
                  hidden={false} edit={edit} onToggle={() => toggleSection(sl.key)}
                  onAi={sl.ai ? () => openAi(sl.key) : undefined}>
                  {sl.node}
                </SectionShell>
              ))}
            </TextScale.Provider>
          )
        })()}

        {!isOnboarding && !isReviewDeck && (<>
        {/* ---------- THE MONTH — the verdict page (Jon, 2026-09-22) ---------- */}
        {verdict && !isHidden('verdict') ? (
          <SectionShell id="verdict" title="The Month" hidden={isHidden('verdict')} edit={edit} onToggle={() => toggleSection('verdict')}>
            <TheMonth v={verdict} t={t} edit={edit} setVerdict={setVerdict} />
          </SectionShell>
        ) : null}
        {/* ---------- SNAPSHOT ---------- */}
        <SectionShell id="snapshot" title="Snapshot" hidden={isHidden('snapshot')} edit={edit} onToggle={() => toggleSection('snapshot')} onAi={() => openAi('snapshot')}>
          <div className="pt-16 sm:pt-24">
            <SectionPhoto src={photoFor('snapshot')} t={t} />
            <Eyebrow>SNAPSHOT</Eyebrow>
            <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
              <Ed v={snap.headline || ''} set={v => patch('snapshot.headline', v)} edit={edit} multiline />
            </h2>
            <p className="mt-2.5 text-[16px] sm:text-[17px] leading-[1.55] max-w-[64ch]" style={{ color: t.body }}>
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
            <div className="pt-16 sm:pt-24">
              <SectionPhoto src={photoFor('pacing')} t={t} />
              <Eyebrow>PACING VS. MARKET</Eyebrow>
              <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
                <Ed v={c.pacing.headline || ''} set={v => patch('pacing.headline', v)} edit={edit} multiline />
              </h2>
              <p className="mt-2.5 text-[16px] sm:text-[17px] leading-[1.55] max-w-[64ch]" style={{ color: t.body }}>
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
            <div className="pt-16 sm:pt-24">
              <SectionPhoto src={photoFor('plan')} t={t} />
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
            <div className="pt-16 sm:pt-24">
              <SectionPhoto src={photoFor('statement')} t={t} />
              <Eyebrow>OWNER STATEMENT</Eyebrow>
              <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
                <Ed v={c.statement.headline || ''} set={v => patch('statement.headline', v)} edit={edit} multiline />
              </h2>
              {(c.statement.subtitle || edit) && (
                <p className="mt-2.5 text-[16px] sm:text-[17px] leading-[1.55] max-w-[64ch]" style={{ color: t.body }}>
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
          <div className="pt-16 sm:pt-24">
            <SectionPhoto src={photoFor('ahead')} t={t} />
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Eyebrow>LOOKING AHEAD</Eyebrow>
              {edit && (ahead.months || []).some((m: Any) => hasBasisRaw(m)) && (
                <BasisPicker label="Basis" value={bSection('ahead')} onPick={(v: string) => setBasis('ahead', v)} t={t} />
              )}
            </div>
            <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
              <Ed v={ahead.headline || ''} set={v => patch('ahead.headline', v)} edit={edit} multiline />
            </h2>
            <p className="mt-2.5 text-[16px] sm:text-[17px] leading-[1.55] max-w-[64ch]" style={{ color: t.body }}>
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
          <div className="pt-16 sm:pt-24">
            <SectionPhoto src={photoFor('voices')} t={t} />
            <Eyebrow>GUEST VOICES</Eyebrow>
            <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
              <Ed v={voices.headline || ''} set={v => patch('voices.headline', v)} edit={edit} multiline />
            </h2>
            <p className="mt-2.5 text-[16px] sm:text-[17px] leading-[1.55] max-w-[64ch]" style={{ color: t.body }}>
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
          <div className="pt-16 sm:pt-24">
            <SectionPhoto src={photoFor('projects')} t={t} />
            <Eyebrow>PROJECTS</Eyebrow>
            <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
              <Ed v={projects.headline || ''} set={v => patch('projects.headline', v)} edit={edit} multiline />
            </h2>
            <p className="mt-2.5 text-[16px] sm:text-[17px] leading-[1.55] max-w-[64ch]" style={{ color: t.body }}>
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
