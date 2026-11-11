'use client'
// THE MAGAZINE VERSION OF A SALES DECK (Jon, 2026-11-11). Same owner_reports row and /r/<code> link as
// the keynote deck: /r/<code>?view=magazine. "World-class design, it should feel like a premium
// magazine… who we are, our tech, how we manage and their projections… full customization… smart
// themes based on the building; link the building's website to get its theme and look."
//
// READS the deck's own content — cover photo, photo pool, overview stats, ops rows, team, terms, the
// tech stack, channels, the presenter card — plus content.cma (the building pages, lib/sales-cma) and
// content.magazine (this view's theme, photos, pages, chart, data switches and rewritten words).
//
// FOR THE TEAM (canEdit): "Edit text" makes every word editable in place; "Builder" opens Projections,
// Comparables, Pages & photos, and Style & data (themes, a theme read off the building's website,
// chart, yield, owner estimate). Save writes the touched sections back onto the deck, so the keynote
// prints the same numbers. A prospect never sees the controls.
//
// THE GRID. Letter pages, 816 × 1056 px. Margins 64 px, a running head and a folio on every inside
// page, one idea per page. Display: the theme's serif (Fraunces by default) for headlines and figures;
// Inter for reading text at 12.5/20 and for small caps labels. Hairlines, not boxes.
import React, { useEffect, useState } from 'react'
import { ProjectionTuner } from '@/components/ProjectionTuner'
import { LibraryCompPicker, attachComps } from '@/components/LibraryCompPicker'
import { MagazineFlipbook } from '@/components/MagazineFlipbook'
import { StayTimeline, YearWave, ChannelHub } from '@/components/MagazineGraphics'
import { STACK_TOOLS } from '@/lib/onboarding-copy'
import { SALES_TEAM_EXCLUDE } from '@/lib/sales-copy'
import { STAY_CONTACT } from '@/lib/need-list-contact'
import { AUDIENCES, audienceOf, type Audience } from '@/lib/sales-audience'
import {
  normalizeCma, planNumbers, range, money, compGross, pctRange, fmtDate, MONTHS, adjustLine, newId,
  type SalesCma, type PacketPlan, type PacketComp,
} from '@/lib/sales-cma'

type Any = any

// ── Themes ────────────────────────────────────────────────────────────────────────────────────────
export type MagTheme = { label: string; ink: string; body: string; muted: string; navy: string; sand: string; sandSoft: string; warm: string; rule: string; glow: string; desk: string; display?: string; displayUrl?: string
  /** Atelier-style themes: the label face, the display size factor, the page paper and the cover layout. */
  sans?: string; ds?: number; paper?: string; cover?: 'inset' | 'full' }
export const MAG_THEMES: Record<string, MagTheme> = {
  // STAY MODERN, the standard (Jon, 2026-11-11: "standard should be modern, following our look and
  // feel"). Lighthouse's own identity: Instrument Serif headlines over Geist, near-black ink, Stay's
  // bronze, a clean white page and a full-bleed photograph on the cover.
  stay: { label: 'Stay Modern', ink: '#101114', body: '#3A3B40', muted: '#727379', navy: '#14161B', sand: '#8C6D3A', sandSoft: '#F1ECE3', warm: '#F7F7F5', rule: '#E4E2DD', glow: '#D9BE8C', desk: '#E9E8E4', display: 'Instrument Serif', sans: 'Geist', ds: 1.06, paper: '#FFFFFF', cover: 'full' },
  // ATELIER, the default (Jon, 2026-11-11: "crisp… clean design… world class professional magazine").
  // Quiet luxury: warm paper, Cormorant Garamond display at generous sizes, Jost labels tracked wide,
  // warm charcoal instead of navy, a photograph inset on the cover with the title set beneath it.
  atelier: { label: 'Atelier', ink: '#1C1A17', body: '#3B3731', muted: '#7A7164', navy: '#262320', sand: '#9C8058', sandSoft: '#ECE4D6', warm: '#EFE9DE', rule: '#D9D0C1', glow: '#D8C29C', desk: '#E2DCD1', display: 'Cormorant Garamond', sans: 'Jost', ds: 1.14, paper: '#F6F2EA', cover: 'inset' },
  classic: { label: 'Classic navy', ink: '#0F1640', body: '#3A4055', muted: '#7D8296', navy: '#111A4A', sand: '#A88B5A', sandSoft: '#F2ECE1', warm: '#F9F6F0', rule: '#E2DDD2', glow: '#E8D6B0', desk: '#E6E2DA' },
  coastal: { label: 'Coastal', ink: '#0D2B33', body: '#33474C', muted: '#788B90', navy: '#0E4A57', sand: '#C07A50', sandSoft: '#F6E8DD', warm: '#F3F7F6', rule: '#D9E4E3', glow: '#F2C9A8', desk: '#DFE8E7' },
  noir: { label: 'Noir and gold', ink: '#111111', body: '#3A3A3A', muted: '#86837E', navy: '#141414', sand: '#A3854B', sandSoft: '#F1EBDF', warm: '#F7F5F0', rule: '#E2DED6', glow: '#DCC28A', desk: '#E4E1DB' },
  // A WIDE RANGE OF STYLES (Jon, 2026-11-11: "enhanced, and a wide range of colour styles"). Each is a
  // complete look: palette, a display face and a label face, the page paper and the cover layout.
  midnight: { label: 'Midnight and champagne', ink: '#0F1B2D', body: '#3A4558', muted: '#76808F', navy: '#0F1B2D', sand: '#A88A4E', sandSoft: '#F3EEE4', warm: '#F6F4EF', rule: '#E2DED5', glow: '#E3CB97', desk: '#E3E1DB', display: 'Playfair Display', sans: 'Inter', paper: '#FFFFFF', cover: 'full' },
  emerald: { label: 'Emerald', ink: '#0E241C', body: '#33463F', muted: '#6F817A', navy: '#0F4C3A', sand: '#A6844F', sandSoft: '#F1ECE1', warm: '#F4F6F3', rule: '#DCE2DE', glow: '#DCC089', desk: '#E2E7E3', display: 'Playfair Display', sans: 'Inter', paper: '#FFFFFF', cover: 'full' },
  slate: { label: 'Slate', ink: '#1B222C', body: '#3C4552', muted: '#75808D', navy: '#2A3442', sand: '#4F6F8F', sandSoft: '#E7EDF3', warm: '#F3F5F7', rule: '#DDE2E8', glow: '#A9C1D9', desk: '#E2E6EB', display: 'DM Serif Display', sans: 'Inter', paper: '#FFFFFF', cover: 'full' },
  miami: { label: 'Miami', ink: '#1C2A33', body: '#3E4C55', muted: '#748089', navy: '#155E68', sand: '#C9603F', sandSoft: '#FBEAE3', warm: '#F2F8F8', rule: '#D9E7E8', glow: '#F6B7A2', desk: '#E1ECEC', display: 'Bodoni Moda', sans: 'Jost', paper: '#FFFFFF', cover: 'full' },
  terracotta: { label: 'Terracotta', ink: '#2B1D17', body: '#4A3A32', muted: '#84746A', navy: '#5A2E1F', sand: '#A9492A', sandSoft: '#F5E6DC', warm: '#FAF3EC', rule: '#E8DCD0', glow: '#EDB592', desk: '#EDE4DA', display: 'Fraunces', sans: 'Inter', paper: '#FFFCF8', cover: 'inset' },
  sage: { label: 'Sage', ink: '#1F2A22', body: '#3E4A41', muted: '#78827A', navy: '#33473A', sand: '#6F7F52', sandSoft: '#EDF0E6', warm: '#F4F5F0', rule: '#DCE0D5', glow: '#C9D6B0', desk: '#E4E7DF', display: 'Cormorant Garamond', sans: 'Jost', ds: 1.12, paper: '#FBFBF8', cover: 'inset' },
  blush: { label: 'Blush', ink: '#2D2024', body: '#4B3E42', muted: '#87797D', navy: '#4A2F37', sand: '#A65D69', sandSoft: '#F7E9EA', warm: '#FBF5F4', rule: '#ECDFDF', glow: '#E8B9BF', desk: '#EFE6E5', display: 'Cormorant Garamond', sans: 'Jost', ds: 1.12, paper: '#FFFDFC', cover: 'inset' },
  mono: { label: 'Monochrome', ink: '#111111', body: '#383838', muted: '#737373', navy: '#111111', sand: '#5E5E5E', sandSoft: '#EFEFEF', warm: '#F5F5F5', rule: '#E2E2E2', glow: '#D4D4D4', desk: '#E6E6E6', display: 'Instrument Serif', sans: 'Inter', ds: 1.06, paper: '#FFFFFF', cover: 'full' },
  ivory: { label: 'Ivory and olive', ink: '#1F241C', body: '#43493E', muted: '#868A7D', navy: '#2F3A28', sand: '#9A7B4F', sandSoft: '#EFE9DC', warm: '#F8F5EE', rule: '#E2DDD0', glow: '#E3D3AE', desk: '#E5E1D6' },
}
const C = { ink: 'var(--mz-ink)', body: 'var(--mz-body)', muted: 'var(--mz-muted)', navy: 'var(--mz-navy)', sand: 'var(--mz-sand)', sandText: 'var(--mz-sandtext)', sandSoft: 'var(--mz-sandsoft)', warm: 'var(--mz-warm)', rule: 'var(--mz-rule)', grid: 'var(--mz-grid)', glow: 'var(--mz-glow)', desk: 'var(--mz-desk)', paper: 'var(--mz-paper)' }
const SERIF_DEFAULT = '"Newsreader", "Iowan Old Style", "Baskerville", Georgia, serif'
const SERIF = 'var(--mz-display)'
/** Google Fonts for the faces a look uses (all of them while the style picker is open, for its previews). */
const FONT_SPEC: Record<string, string> = {
  'Cormorant Garamond': 'Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400', 'Jost': 'Jost:wght@300;400;500;600',
  'Instrument Serif': 'Instrument+Serif:ital@0;1', 'Geist': 'Geist:wght@300;400;500;600', 'Playfair Display': 'Playfair+Display:ital,wght@0,400;0,500;1,400',
  'Fraunces': 'Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;1,9..144,300', 'DM Serif Display': 'DM+Serif+Display:ital@0;1',
  'Bodoni Moda': 'Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,500;1,6..96,400',
}
function fontHref(faces: (string | undefined)[]): string {
  const base = ['Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,300;1,6..72,400', 'Josefin+Sans:wght@300;400', 'Inter:wght@400;500;600;700']
  const extra = Array.from(new Set(faces.filter(Boolean) as string[])).filter(f => f !== 'Newsreader' && f !== 'Inter').map(f => FONT_SPEC[f] || encodeURIComponent(f).replace(/%20/g, '+'))
  return 'https://fonts.googleapis.com/css2?' + base.concat(extra).map(f => 'family=' + f).join('&') + '&display=swap'
}
/** Reading text stays Newsreader in every theme: a display face is too fine at 13px in print. */
const TEXT = SERIF_DEFAULT
const SANS_DEFAULT = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif'
const SANS = 'var(--mz-sans)'
const MARK = '"Josefin Sans", "Futura", "Avenir Next", system-ui, sans-serif'
/** Mix two #rrggbb colours: t=0 is a, t=1 is b. */
const mixHex = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const x = p(a), y = p(b)
  if (x.some(isNaN) || y.some(isNaN)) return a
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')
}
const themeVars = (t: MagTheme): React.CSSProperties => ({
  // Print-safe derivatives (print audit): sand text darkened toward the ink so a 10px kicker clears
  // contrast, and gridlines/rules heavy enough not to ghost on a laser printer.
  ['--mz-sandtext' as Any]: mixHex(t.sand, t.ink, 0.28), ['--mz-grid' as Any]: mixHex(t.rule, t.ink, 0.1),
  ['--mz-ink' as Any]: t.ink, ['--mz-body' as Any]: t.body, ['--mz-muted' as Any]: t.muted, ['--mz-navy' as Any]: t.navy,
  ['--mz-sand' as Any]: t.sand, ['--mz-sandsoft' as Any]: t.sandSoft, ['--mz-warm' as Any]: t.warm, ['--mz-rule' as Any]: t.rule,
  ['--mz-glow' as Any]: t.glow, ['--mz-desk' as Any]: t.desk, ['--mz-display' as Any]: t.display ? `"${t.display}", ${SERIF_DEFAULT}` : SERIF_DEFAULT,
  ['--mz-sans' as Any]: t.sans ? `"${t.sans}", ${SANS_DEFAULT}` : SANS_DEFAULT, ['--mz-ds' as Any]: String(t.ds || 1), ['--mz-paper' as Any]: t.paper || '#FFFFFF',
})
export type ChartKind = 'line' | 'bars' | 'band' | 'cumulative'
const CHARTS: [ChartKind, string][] = [['line', 'Fine line'], ['bars', 'Bars'], ['band', 'Range band'], ['cumulative', 'Running total']]
const PAGES: [string, string][] = [['about', 'Who we are'], ['team', 'The team and terms'], ['manage', 'How we manage'], ['tech', 'Our technology']]
// PHOTO LOOKS (Jon, 2026-11-11: "filters for the photo like blur, enhance, modify"). Drawn with CSS
// filters on a layer behind the page's own shading, so the words never blur with the picture. These
// change how a photo looks on the page; they do not change who owns it — that is the Rights field below.
const LOOKS: Record<string, { label: string; f: string; tint?: number }> = {
  original: { label: 'Original', f: '' },
  enhance: { label: 'Enhance', f: 'contrast(1.08) saturate(1.15) brightness(1.03)' },
  warm: { label: 'Warm', f: 'sepia(.2) saturate(1.1) contrast(1.04) brightness(1.02)' },
  muted: { label: 'Muted', f: 'saturate(.55) contrast(.95) brightness(1.05)' },
  bw: { label: 'Black & white', f: 'grayscale(1) contrast(1.12)' },
  tint: { label: 'Theme tint', f: 'grayscale(1) contrast(1.1) brightness(1.05)', tint: 42 },
}
const RIGHTS: [string, string][] = [['', 'Where is this photo from?'], ['own', 'Our own photo (Stay)'], ['building', 'Building or developer, with permission'], ['licensed', 'Licensed stock (paid)'], ['free', 'Free licence (Unsplash, Pexels)'], ['unknown', 'Not sure']]
const PHOTO_SLOTS: [string, string][] = [['cover', 'Cover'], ['contents', 'Contents'], ['about', 'Who we are'], ['manage', 'How we manage'], ['work', 'Working together opener'], ['numbers', 'The numbers opener'], ['back', 'Back cover']]

const short = (b: string) => b.replace(/\s+Residences$/i, '')
const two = (n: number) => String(n).padStart(2, '0')
const priceOf = (s: string) => { const n = parseFloat(String(s || '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 1000 ? n : 0 }
const pct1 = (x: number) => (Math.round(x * 1000) / 10).toFixed(1) + '%'
const dash = (a: number, b: number) => money(a) + '–' + money(b)
const initials = (n: string) => String(n || '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
const rich = (s: string) => String(s || '').split(/(\*[^*]+\*)/g).map((x, i) => /^\*[^*]+\*$/.test(x) ? <em key={i}>{x.slice(1, -1)}</em> : <React.Fragment key={i}>{x}</React.Fragment>)
const NICK_PHOTO = '/deck-img/nick-carline.jpg'
const photoFor = (p: Any) => String(p?.photo || '').trim() || (['nick carline', 'nicholas carline'].includes(String(p?.name || '').trim().toLowerCase()) ? NICK_PHOTO : '')

function setPath(obj: Any, path: string, val: Any) {
  const ks = path.split('.')
  let o = obj
  for (let i = 0; i < ks.length - 1; i++) {
    const k = ks[i]
    if (o[k] == null || typeof o[k] !== 'object') o[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}
    o = o[k]
  }
  o[ks[ks.length - 1]] = val
}

// ── Charts ────────────────────────────────────────────────────────────────────────────────────────
const CHART_H = 210, CHART_MIN = 100
/** How far a page's words run past its sheet: into the footer, or pushing the footer off the page. */
function overOf(el: Element): number | null {
  const body = el.querySelector('.mz-body, .mz-split-body') as HTMLElement | null
  const foot = el.querySelector('.mz-foot') as HTMLElement | null
  const last = body?.lastElementChild as HTMLElement | null
  if (!body || !foot || !last) return null
  const page = el.getBoundingClientRect(), f = foot.getBoundingClientRect()
  return Math.max(last.getBoundingClientRect().bottom - f.top + 4, f.bottom + 24 - page.bottom)
}
function Chart({ months, kind, h = CHART_H }: { months: { lo: number; hi: number }[]; kind: ChartKind; h?: number }) {
  // Information-design audit (2026-11-11): one column per month, not paired bars — solid to the low
  // end, lighter from low to high, so it reads "at least X, up to Y". Four gridlines, axis labels
  // sitting on them at the left (FT style), and values only where the eye needs them: peak and trough.
  const W = 688, H = h, T = 22, B = kind === 'line' ? 44 : 24, L = 40
  const series = kind === 'cumulative'
    ? months.reduce((acc: { lo: number; hi: number }[], m, i) => { const p = acc[i - 1] || { lo: 0, hi: 0 }; acc.push({ lo: p.lo + m.lo, hi: p.hi + m.hi }); return acc }, [])
    : months
  const max = Math.max(1, ...series.map(m => m.hi))
  const raw = max / 4
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= raw) || raw
  const top = step * 4
  const ch = H - T - B, cw = (W - L) / 12
  const y = (v: number) => T + ch - (v / top) * ch
  const ticks = [1, 2, 3, 4].map(i => i * step)
  const k$ = (v: number) => '$' + (v >= 100000 ? Math.round(v / 1000) : (Math.round(v / 100) / 10).toFixed(1)) + 'K'
  const cx = (i: number) => L + i * cw + cw / 2
  let pk = 0, tr = 0
  series.forEach((m, i) => { if (m.hi > series[pk].hi) pk = i; if (m.hi < series[tr].hi) tr = i })
  const grid = (
    <g>
      {ticks.map(v => (
        <g key={v}>
          <line x1={L - 4} x2={W} y1={y(v)} y2={y(v)} style={{ stroke: C.grid }} strokeWidth={1} shapeRendering="crispEdges" />
          <text x={0} y={y(v) + 4} fontSize={10.5} style={{ fill: C.muted }} fontFamily={SANS}>{'$' + (v >= 1000 ? (v / 1000) + 'K' : v)}</text>
        </g>
      ))}
      <line x1={L - 4} x2={W} y1={y(0)} y2={y(0)} style={{ stroke: C.ink }} strokeWidth={1.25} shapeRendering="crispEdges" />
    </g>
  )
  const axis = MONTHS.map((m, i) => <text key={m} x={cx(i)} y={H - 6} textAnchor="middle" fontSize={10.5} style={{ fill: C.muted }} fontFamily={SANS} letterSpacing="0.06em">{m.toUpperCase()}</text>)
  const label = (i: number, text: string) => <text x={cx(i)} y={y(series[i].hi) - 7} textAnchor="middle" fontSize={11} fontWeight={600} style={{ fill: C.ink }} fontFamily={SANS}>{text}</text>
  if (kind === 'bars') {
    const bw = 30
    return (
      <svg className="mz-chart-svg" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Monthly gross rental income, low and high end">
        {grid}
        {months.map((m, i) => (
          <g key={i}>
            <rect x={cx(i) - bw / 2} y={y(m.lo)} width={bw} height={y(0) - y(m.lo)} style={{ fill: C.navy }} />
            <rect x={cx(i) - bw / 2} y={y(m.hi)} width={bw} height={y(m.lo) - y(m.hi)} style={{ fill: C.navy, opacity: 0.3 }} />
          </g>
        ))}
        {label(pk, k$(months[pk].lo) + '–' + k$(months[pk].hi))}
        {tr !== pk ? label(tr, k$(months[tr].lo) + '–' + k$(months[tr].hi)) : null}
        {axis}
      </svg>
    )
  }
  const line = (k: 'lo' | 'hi') => series.map((m, i) => (i ? 'L' : 'M') + cx(i) + ' ' + y(m[k])).join(' ')
  if (kind === 'line') {
    // THE FINE LINE (Atelier): the high end as one smooth ink line, the low end dotted beneath it, and
    // two notes in the margin voice: the peak month and the quiet one. No fill, no boxes.
    const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    const smooth = (k: 'lo' | 'hi') => {
      const p = series.map((m, i) => [cx(i), y(m[k])] as [number, number])
      let d = `M${p[0][0]},${p[0][1]}`
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i - 1] || p[i], b = p[i], c2 = p[i + 1], e = p[i + 2] || c2
        d += ` C${(b[0] + (c2[0] - a[0]) / 6).toFixed(1)},${(b[1] + (c2[1] - a[1]) / 6).toFixed(1)} ${(c2[0] - (e[0] - b[0]) / 6).toFixed(1)},${(c2[1] - (e[1] - b[1]) / 6).toFixed(1)} ${c2[0]},${c2[1]}`
      }
      return d
    }
    const note = (i: number, text: string, below?: boolean) => {
      const anchor = i >= 9 ? 'end' : i <= 2 ? 'start' : 'middle'
      const dx = anchor === 'end' ? -8 : anchor === 'start' ? 8 : 0
      return <text x={cx(i) + dx} y={below ? y(series[i].lo) + 20 : y(series[i].hi) - 12} textAnchor={anchor} fontSize={15} fontStyle="italic" style={{ fill: below ? C.muted : C.ink }} fontFamily={SERIF}>{text}</text>
    }
    return (
      <svg className="mz-chart-svg" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Monthly gross rental income, low and high end">
        {ticks.map(v => <g key={v}><line x1={L - 4} x2={W} y1={y(v)} y2={y(v)} style={{ stroke: C.grid, opacity: 0.55 }} strokeWidth={0.75} shapeRendering="crispEdges" /><text x={0} y={y(v) + 4} fontSize={9.5} style={{ fill: C.muted }} fontFamily={SANS} letterSpacing="0.06em">{'$' + (v >= 1000 ? (v / 1000) + 'K' : v)}</text></g>)}
        <path d={smooth('lo')} style={{ fill: 'none', stroke: C.muted }} strokeWidth={1} strokeDasharray="2 3" />
        <path d={smooth('hi')} style={{ fill: 'none', stroke: C.ink }} strokeWidth={1.3} />
        {series.map((m, i) => <circle key={i} cx={cx(i)} cy={y(m.hi)} r={i === pk || i === tr ? 3.6 : 1.7} style={{ fill: C.ink }} />)}
        {note(pk, `${MONTH[pk]}, up to ${k$(series[pk].hi)}`)}
        {tr !== pk ? note(tr, `${MONTH[tr]}, the quiet month`, true) : null}
        {MONTHS.map((m, i) => <text key={m} x={cx(i)} y={H - 6} textAnchor="middle" fontSize={9.5} style={{ fill: C.muted }} fontFamily={SANS} letterSpacing="0.2em">{m.toUpperCase()}</text>)}
      </svg>
    )
  }
  const band = series.map((m, i) => (i ? 'L' : 'M') + cx(i) + ' ' + y(m.hi)).join(' ') + ' ' + series.slice().reverse().map((m, j) => 'L' + cx(11 - j) + ' ' + y(m.lo)).join(' ') + ' Z'
  const ends = kind === 'cumulative' ? [11] : [pk, tr]
  return (
    <svg className="mz-chart-svg" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={kind === 'cumulative' ? 'Running total of gross rental income through the year' : 'Monthly gross rental income range'}>
      {grid}
      <path d={band} style={{ fill: C.navy, opacity: 0.16 }} />
      <path d={line('lo')} style={{ fill: 'none', stroke: C.navy, opacity: 0.55 }} strokeWidth={1.5} />
      <path d={line('hi')} style={{ fill: 'none', stroke: C.navy }} strokeWidth={2.25} />
      {series.map((m, i) => <circle key={i} cx={cx(i)} cy={y(m.hi)} r={ends.includes(i) ? 4 : 2.5} style={{ fill: C.navy }} />)}
      {ends.filter((v, i, a) => a.indexOf(v) === i).map(i => <g key={i}>{label(i, k$(series[i].lo) + '–' + k$(series[i].hi))}</g>)}
      {axis}
    </svg>
  )
}

// ── The magazine ──────────────────────────────────────────────────────────────────────────────────
export function SalesMagazine({ report, canEdit, onePager }: { report: Any; canEdit?: boolean; onePager?: boolean }) {
  const original: Any = report.content || {}
  const [doc, setDoc] = useState<Any>(() => structuredClone(original))
  const [touched, setTouched] = useState<string[]>([])
  const [editText, setEditText] = useState(false)
  // The page-turning digital magazine for whoever opens the link; the team builds in the scroll view.
  // ?scroll=1 opens the scroll view for anyone.
  // A phone keeps the stacked phone layout in page view too (see MagazineFlipbook); only a wider screen binds fixed pages.
  const [phone, setPhone] = useState(false)
  useEffect(() => { const on = () => setPhone(window.innerWidth < 760); on(); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on) }, [])
  const [flip, setFlip] = useState<boolean>(() => !canEdit && !(typeof window !== 'undefined' && /[?&]scroll=1/.test(window.location.search)))
  const [drawer, setDrawer] = useState<null | 'proj' | 'comps' | 'pages' | 'style'>(null)
  const [tuneId, setTuneId] = useState<string | null>(null)
  const [saving, setSaving] = useState('')
  const [brandUrl, setBrandUrl] = useState('')
  const [brandMsg, setBrandMsg] = useState('')
  // Photo search in our own library (/api/sales/photos), and which page a picked result goes to.
  const [photoQ, setPhotoQ] = useState('')
  const [photoHits, setPhotoHits] = useState<Any[] | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [pickFor, setPickFor] = useState('cover')
  const dirty = touched.length > 0
  // A PAGE THAT NO LONGER FITS (2026-11-11). Every word is editable and a page is a fixed letter
  // sheet, so a long edit would be silently clipped in print. Editors see which pages are too full.
  const [overfull, setOverfull] = useState<string[]>([])
  // FIT THE CHART TO ITS PAGE (audit 2026-11-11). A floor-plan page with a long comparable table used to
  // squeeze the chart: the browser shrank its height and, keeping the proportions, its width too, so it
  // printed narrow and off-centre. Now the chart always runs the full width and is drawn only as tall as
  // the page has room for (never under CHART_MIN). Text in the chart stays the same size.
  const [chartH, setChartH] = useState<Record<string, number>>({})
  useEffect(() => { setChartH({}); setFit({}) }, [doc])
  // EVERY PAGE FITS ITS SHEET (Jon, 2026-11-11: "make sure everything is formatted to fit"). A page whose
  // words run past its footer — longer copy, a website theme with a larger face, a longer comp table —
  // steps down until it fits: up to three steps, each setting the display type and the reading blocks a
  // little smaller and tighter. Measured in the browser after each render, so it holds for whatever the
  // deck says. Only a page that still overflows at the last step is flagged to the editor.
  const [fit, setFit] = useState<Record<string, number>>({})
  useEffect(() => {
    const id = setTimeout(() => {
      const next: Record<string, number> = {}
      document.querySelectorAll('.mz-page[data-k]').forEach(el => {
        const k = String((el as HTMLElement).dataset.k)
        // Over if the words reach the footer, or the footer itself is pushed off the sheet.
        const over = overOf(el)
        if (over == null) return
        const lvl = fit[k] || 0
        if (over > 0 && lvl < 3 && !(k.startsWith('plan-') && (chartH[k] || CHART_H) > CHART_MIN)) next[k] = lvl + 1
      })
      if (Object.keys(next).length) setFit(h => ({ ...h, ...next }))
    }, 160)
    return () => clearTimeout(id)
  })
  useEffect(() => {
    const id = setTimeout(() => {
      const next: Record<string, number> = {}
      document.querySelectorAll('.mz-page[data-k^="plan-"]').forEach(el => {
        const k = String((el as HTMLElement).dataset.k)
        const svg = el.querySelector('svg.mz-chart-svg') as SVGElement | null
        const over = overOf(el)
        if (!svg || over == null) return
        const cur = chartH[k] || CHART_H
        const unit = svg.getBoundingClientRect().width / 688
        if (over > 0 && cur > CHART_MIN && unit > 0) next[k] = Math.max(CHART_MIN, Math.floor(cur - over / unit))
      })
      if (Object.keys(next).length) setChartH(h => ({ ...h, ...next }))
    }, 120)
    return () => clearTimeout(id)
  })
  useEffect(() => {
    if (!canEdit) return
    const id = setTimeout(() => {
      const keys: string[] = []
      document.querySelectorAll('.mz-page[data-k]').forEach(el => {
        const body = el.querySelector('.mz-body, .mz-split-body') as HTMLElement | null
        const foot = el.querySelector('.mz-foot') as HTMLElement | null
        if (body && foot) {
          const last = body.lastElementChild as HTMLElement | null
          if (last && last.getBoundingClientRect().bottom > foot.getBoundingClientRect().top + 1) keys.push(String((el as HTMLElement).dataset.k))
        }
      })
      setOverfull(k => (k.join() === keys.join() ? k : keys))
    }, 400)
    return () => clearTimeout(id)
  })

  const touch = (k: string) => setTouched(t => t.includes(k) ? t : [...t, k])
  const patch = (path: string, val: Any) => {
    setDoc((d: Any) => {
      const n = structuredClone(d)
      if (path.startsWith('cma.')) n.cma = normalizeCma(n.cma)
      setPath(n, path, val)
      return n
    })
    touch(path.split('.')[0]); setSaving('')
  }
  const setCma = (next: SalesCma) => { setDoc((d: Any) => ({ ...d, cma: next })); touch('cma'); setSaving('') }
  async function save() {
    setSaving('Saving…')
    try {
      const fresh = await fetch('/api/reports?id=' + encodeURIComponent(report.id), { cache: 'no-store' }).then(r => r.json())
      const content = { ...(fresh?.report?.content || original) }
      for (const k of touched) content[k] = doc[k]
      const r = await fetch('/api/reports', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: report.id, content }) })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d?.ok) throw new Error(d?.error || 'Save failed')
      setTouched([]); setSaving('Saved')
    } catch (e: Any) { setSaving(e?.message || 'Save failed') }
  }
  function discard() { setDoc(structuredClone(original)); setTouched([]); setSaving('') }

  /** Edit in place: with Edit text on, the words become editable where they sit. */
  const E = ({ v, p, rich: isRich, ph, block }: { v: Any; p: string; rich?: boolean; ph?: string; block?: boolean }) => {
    const text = String(v ?? '')
    if (!(canEdit && editText)) return <>{isRich ? rich(text) : text}</>
    const Tag: Any = block ? 'div' : 'span'
    return (
      <Tag className="mz-ed" contentEditable suppressContentEditableWarning data-ph={ph || 'Type here'}
        onKeyDown={(e: Any) => { if (e.key === 'Enter' && !block) { e.preventDefault(); e.currentTarget.blur() } }}
        onBlur={(e: Any) => { const t = String(e.currentTarget.innerText || '').replace(/ /g, ' ').trim(); if (t !== text.trim()) patch(p, t) }}>{text}</Tag>
    )
  }

  const c: Any = doc
  const cma: SalesCma | null = normalizeCma(c.cma)
  const mag: Any = c.magazine || {}
  const copy: Any = mag.copy || {}
  const custom: MagTheme | null = mag.custom && mag.custom.navy ? mag.custom : null
  const styleKey = mag.style === 'custom' && custom ? 'custom' : MAG_THEMES[mag.style] ? mag.style : 'stay'
  const theme: MagTheme = styleKey === 'custom' && custom ? { ...MAG_THEMES.stay, ...custom } : MAG_THEMES[styleKey]
  const chart: ChartKind = (['line', 'bars', 'band', 'cumulative'] as ChartKind[]).includes(mag.chart) ? mag.chart : 'line'
  // NO UNIT PRICES (Jon, 2026-11-11: "noticed cost of units, remove that, don't need that"). The
  // starting price, and the gross yield worked from it, no longer print anywhere in the package.
  const showYield = false
  const showNet = mag.net != null ? !!mag.net : (!!cma && AUDIENCES[audienceOf(c.audience)].net)
  const channelPct = Number.isFinite(+mag.channelPct) ? +mag.channelPct : 15
  const mgmtPct = Number.isFinite(+mag.mgmtPct) ? +mag.mgmtPct : 15
  const netOf = (g: number) => Math.round(g * (1 - channelPct / 100) * (1 - mgmtPct / 100) / 100) * 100
  const hideMag: Record<string, boolean> = mag.hide || {}
  // Custom graphics in place of photographs (Jon, 2026-11-11); each can be switched back to a photo.
  const gfx = (k: 'manage' | 'numbers' | 'tech') => !((mag.graphics || {})[k] === false)

  const meta: Any = c.meta || {}
  const hero: Any = c.hero || {}
  const cardRaw: Any = (c.contact && c.contact.card) || {}
  // A presenter card saved without a phone or email still reaches someone: Nick's own details when it is him.
  const isNick = ['nick carline', 'nicholas carline'].includes(String(cardRaw.name || '').trim().toLowerCase())
  const card: Any = { ...cardRaw, photo: photoFor(cardRaw), phone: String(cardRaw.phone || '').trim() || (isNick ? STAY_CONTACT.person?.phone || '' : ''), email: String(cardRaw.email || '').trim() || (isNick ? STAY_CONTACT.person?.email || '' : ''), role: String(cardRaw.role || '').trim() || (isNick ? STAY_CONTACT.person?.role || '' : '') }
  const prospect = String(meta.prospect || '').trim()
  const building = (cma && cma.building) || String(hero.title || report.scope_label || '').trim()
  const buildingPath = cma ? 'cma.building' : 'hero.title'
  const area = (cma && cma.area) || String(meta.market || '').trim()
  const dateIso = String(report.created_at || new Date().toISOString()).slice(0, 10)
  const date = fmtDate(dateIso)
  const monthYear = new Date(dateIso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const pool: string[] = Array.from(new Set([String(hero.heroImage || '').trim(), ...((Array.isArray(c.photoPool) ? c.photoPool : []) as string[]), '/deck-img/miami-skyline.jpg'].filter(Boolean)))
  const brandImg = String(mag.brandImage || '').trim()
  const allPhotos = Array.from(new Set([...(brandImg ? [brandImg] : []), ...pool]))
  const slotIdx: Record<string, number> = { cover: 0, contents: 1, about: 2, manage: 3, work: 4, numbers: 5, back: 6 }
  const photo = (slot: string): string => String((mag.photos || {})[slot] || '').trim() || (slot === 'back' ? photo('cover') : pool[(slotIdx[slot] || 0) % pool.length])
  const brandLogo = String(mag.brandLogo || '').trim()
  const fxOf = (slot: string): Any => ({ ...((mag.photoFx && mag.photoFx.all) || {}), ...((mag.photoFx || {})[slot] || {}) })
  const lookCss = (fx: Any): string => [(LOOKS[fx.look] || LOOKS.original).f, Number(fx.blur) ? `blur(${Number(fx.blur)}px)` : ''].filter(Boolean).join(' ') || 'none'
  /** A photo layer's style: the picture with its look, under the page's own shading (see .mz-ph). */
  const ph = (slot: string, grad = '', pos = ''): React.CSSProperties => {
    const fx = fxOf(slot), look = LOOKS[fx.look] || LOOKS.original
    const blur = Number(fx.blur) || 0, zoom = (Number(fx.zoom) || 100) / 100
    const wash = look.tint ? `linear-gradient(color-mix(in srgb, var(--mz-navy) ${look.tint}%, transparent), color-mix(in srgb, var(--mz-navy) ${look.tint}%, transparent))` : ''
    const v: Any = { '--ph': `url("${photo(slot).replace(/"/g, '%22')}")`, '--pf': lookCss(fx), '--pg': [grad, wash].filter(Boolean).join(', ') || 'none', '--pi': blur ? `-${blur * 3}px` : '0', '--pt': fx.flip || zoom !== 1 ? `scale(${fx.flip ? -zoom : zoom}, ${zoom})` : 'none' }
    if (pos) v['--pp'] = pos
    return v
  }
  // Where each photo came from, kept with the photo (by its link) so it follows it to any page.
  const rightsOf = (u: string): Any => ((mag.photoRights || {})[u]) || (/guesty|cloudinary/i.test(u) ? { rights: 'own' } : {})
  const usedSlots = PHOTO_SLOTS.filter(([k]) => !(k === 'manage' && gfx('manage')) && !(k === 'numbers' && gfx('numbers')) && !(k === 'contents' && !mag.showContents)).map(([k]) => k)
  const usedPhotos = Array.from(new Set(usedSlots.map(k => photo(k)).filter(Boolean)))
  const unconfirmed = usedPhotos.filter(u => !rightsOf(u).rights || rightsOf(u).rights === 'unknown')
  const credits = Array.from(new Set(usedPhotos.map(u => String(rightsOf(u).credit || '').trim()).filter(Boolean)))

  const rows = (a: Any): { k: string; v: string; i: number }[] => (Array.isArray(a) ? a : []).map((r: Any, i: number) => ({ k: String(r?.k || ''), v: String(r?.v || ''), i })).filter(r => r.k.trim() && r.v.trim())
  // A stat's figure is whichever side carries the digits: "450+" over "Units managed", whichever way the deck stored it.
  const stats = rows(c.overview && c.overview.stats).slice(0, 4).map(s => {
    const kd = /\d/.test(s.k), vd = /\d/.test(s.v)
    return kd && !vd ? { fig: s.k, lab: s.v, figP: 'k', labP: 'v', i: s.i } : { fig: s.v, lab: s.k, figP: 'v', labP: 'k', i: s.i }
  })
  const ops = rows(c.ops && c.ops.rows).slice(0, 6)
  const terms = rows(c.terms && c.terms.rows).slice(0, 6).map(r => r.k === 'Labour' ? { ...r, k: 'Labor' } : r)
  // The sales team rule (lib/sales-copy SALES_TEAM_EXCLUDE), and the presenter always on the page.
  let team: { p: Any; i: number }[] = ((c.team && c.team.people) || []).map((p: Any, i: number) => ({ p: { ...p, photo: photoFor(p) }, i }))
    .filter((x: Any) => x.p && String(x.p.name || '').trim() && SALES_TEAM_EXCLUDE.indexOf(String(x.p.name).trim().toLowerCase()) < 0)
  if (card.name && !team.some(x => String(x.p.name).trim().toLowerCase() === String(card.name).trim().toLowerCase())) team = [...team, { p: { name: card.name, role: card.role, photo: card.photo }, i: -1 }]
  team = team.slice(0, 8)
  const tools: Any[] = ((c.stack && Array.isArray(c.stack.tools) && c.stack.tools.length ? c.stack.tools : STACK_TOOLS) as Any[]).filter((t: Any) => t && t.name)
  const toolsPath = c.stack && Array.isArray(c.stack.tools) && c.stack.tools.length ? 'stack.tools' : ''
  const channels: string[] = (c.channels && Array.isArray(c.channels.primary) && c.channels.primary.length ? c.channels.primary : ['Airbnb', 'Vrbo', 'Booking.com', 'Expedia', 'Homes & Villas by Marriott', 'Stay direct']).slice(0, 8)
  const channelCount = String((c.channels && c.channels.count) || '40+')
  const hidden: string[] = Array.isArray(c.omit) ? c.omit : []
  const on = (k: string) => hidden.indexOf(k) < 0
  const keynote = '/r/' + report.code
  const presenterFirst = String(card.name || '').split(/\s+/)[0] || ''

  const S = cma ? cma.sections : null
  const plans: PacketPlan[] = cma && S && S.plans ? cma.plans.filter(p => on('cma-plan-' + p.id)) : []
  const showPartner = !!(cma && S && S.partner && on('cma-partner'))
  const showSecond = !!(cma && S && S.second && on('cma-second'))
  const showMarket = !!(cma && S && S.market && on('cma-market'))
  const showGlance = !!(cma && S && S.glance && cma.plans.length && on('cma-glance'))
  const showPage = (k: string) => !hideMag[k]

  const aud = audienceOf(c.audience)
  const D = {
    coverDek: cma ? (aud === 'owner' ? `Your residence in ${area || 'Miami'}, and what it could earn.` : aud === 'agents' ? `Every floor plan, and what each could earn.` : `What a residence in ${area || 'Miami'} could earn.`) : String(hero.headline || 'How we manage revenue, tools and team around the success of your property.'),
    note: cma
      ? (aud === 'owner'
        ? `This is what a home at ${short(building) || 'your building'} could earn, built from comparable homes we run nearby, and how we would run it for you: the team, the standard and the technology behind it.`
        : aud === 'agents'
          ? `Every buyer asks the same first question: what will it earn? This package answers it for every floor plan${building ? ' at ' + short(building) : ''}, from one comparable set, so you can share a range with your clients before they make an offer. It also shows who we are and how we run a home.`
          : `Every buyer${building ? ' at ' + short(building) : ''} asks the same first question: what will it earn? This package answers it for every floor plan, from one comparable set, so a buyer sees a range before they make an offer. It also shows who we are, how we run a home, and the technology behind it.`)
      : 'Thank you for your time. This is how we would run your property: the revenue, the tools and the team around it, and what happens from the day you sign.',
    aboutHead: 'Stay-managed homes earn *20% more* than the market.',
    aboutDek: 'Full-service short-term rental management for owners across Miami and South Florida: one local team, pricing every night and listing everywhere guests book.',
    aboutNote: 'On average; results vary by unit, building and season.',
    teamHead: 'The team on your building, *with 24/7 guest care*',
    manageHead: 'How we run a home',
    manageDek: 'Our own team, our own standard, on every stay.',
    techHead: 'Priced every day. Listed everywhere. *Reported every month.*',
    techDek: (tools.slice(0, 5).length > 1 ? (['', '', 'Two', 'Three', 'Four', 'Five'][tools.slice(0, 5).length] + ' systems working together, so') : 'One system, so') + ' pricing, distribution, housekeeping and reporting run on data rather than guesswork.',
    workTitle: showPartner || aud === 'owner' ? AUDIENCES[aud].workTitle : 'For buyers who ask for options',
    numbersTitle: aud === 'owner' && cma ? 'What your residence *could earn.*' : plans.length > 1 ? `${['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'][plans.length] || plans.length} floor plans. *What each could earn.*` : 'What a home at ' + (short(building) || 'this building') + ' could earn',
    glanceHead: 'At a glance',
    marketHead: `${area || 'The market'}, *by the night.*`,
    glanceDek: 'Estimated gross rental revenue for a full year, once the listing is established. Each line runs from the low estimate to the high one.',
    backTitle: cma ? AUDIENCES[aud].backTitle : 'Book a call *to learn more.*',
    secondKicker: AUDIENCES[aud].secondKicker,
    secondTitle: AUDIENCES[aud].secondTitle.replace('{at}', building ? ' at *' + short(building) + '*' : ''),
    // Every label on the page is the team's to rewrite too (Jon, 2026-11-11: "everything should be editable").
    kPeople: 'The people', kTerms: 'How we work together', kListed: 'Where your home is listed', kFees: 'Referral fees, in writing',
    kHow: 'How it works', kReady: 'How we would get a unit ready', kCompsAll: 'The comparable set used across this package',
    heroLabel: 'Could earn in a year, once established', heroNote: 'Gross rental revenue, before channel fees and the management fee',
    kChart: 'Through the year', chartSource: 'Monthly pattern based on Miami market pricing data.', kComps: 'Against the comparable set',
    timelineTitle: 'One stay, start to finish', timelineNote: 'Our own team, on every stay.',
    backDek: cma ? AUDIENCES[aud].backDek.replace('{with}', presenterFirst ? ' with ' + presenterFirst : '').replace('{at}', building ? ' at ' + short(building) : '') : `A short call${presenterFirst ? ' with ' + presenterFirst : ''} to walk through the numbers, the terms and the onboarding, and answer every question before you decide.`,
  }
  const T = (k: keyof typeof D) => (copy[k] != null && String(copy[k]).trim() ? String(copy[k]) : D[k])
  const CT = ({ k, block }: { k: keyof typeof D; block?: boolean }) => <E v={T(k)} p={'magazine.copy.' + k} rich block={block} />

  // ── page plan: decide the pages first, so folios and contents are right before anything renders ──
  type Spec = { key: string; section?: string; kind: 'cover' | 'page' | 'opener' | 'back'; render: (n: number) => React.ReactNode; tone?: 'paper' | 'warm' | 'dark' }
  const specs: Spec[] = []
  const add = (s: Spec) => specs.push(s)
  const kicker = (x: React.ReactNode, dark?: boolean) => <p className={'mz-kicker' + (dark ? ' mz-on-dark' : '')}>{x}</p>

  add({ key: 'cover', kind: 'cover', render: () => null })
  // Off unless switched on (Jon, 2026-11-11: "table of contents — remove").
  if (mag.showContents) add({ key: 'contents', kind: 'page', section: 'Contents', render: () => null })
  const format: 'full' | 'brochure' | 'onepage' = onePager ? 'onepage' : (['brochure', 'onepage'].includes(mag.format) ? mag.format : 'full')
  const parts = {
    who: () => {
      if (showPage('about')) add({ key: 'about', kind: 'page', section: 'Who we are', render: () => null })
      if (showPage('team') && (team.length || terms.length)) add({ key: 'team', kind: 'page', section: 'Who we are', tone: 'warm', render: () => null })
      if (showPage('manage') && ops.length) add({ key: 'manage', kind: 'page', section: 'How we manage', render: () => null })
      if (showPage('tech') && tools.length) add({ key: 'tech', kind: 'page', section: 'Our technology', render: () => null })
    },
    work: () => {
      if (!cma || !(showPartner || showSecond)) return
      add({ key: 'op-work', kind: 'opener', section: 'Working together', render: () => null })
      if (showPartner) add({ key: 'partner', kind: 'page', section: 'Agent partner program', render: () => null })
      if (showSecond) add({ key: 'second', kind: 'page', section: aud === 'owner' ? 'Terms' : 'Owner options', render: () => null })
    },
    num: () => {
      if (!cma || !(showMarket || showGlance || plans.length)) return
      add({ key: 'op-num', kind: 'opener', section: 'The numbers', render: () => null })
      // One owner, one or two unit types: their own projection before the market around it.
      if (aud === 'owner') {
        for (const p of plans) add({ key: 'plan-' + p.id, kind: 'page', section: 'Your projection', render: () => null })
        if (showGlance && plans.length > 2) add({ key: 'glance', kind: 'page', section: 'Every floor plan', tone: 'warm', render: () => null })
        if (showMarket) add({ key: 'market', kind: 'page', section: 'The market', render: () => null })
        return
      }
      if (showMarket) add({ key: 'market', kind: 'page', section: 'The market', render: () => null })
      if (showGlance) add({ key: 'glance', kind: 'page', section: 'Every floor plan', tone: 'warm', render: () => null })
      for (const p of plans) add({ key: 'plan-' + p.id, kind: 'page', section: 'Rental comparison', render: () => null })
    },
  }
  // THE TYPE OF MAGAZINE (Jon, 2026-11-11: "have the option to change the type of magazine we want").
  //   full     — every section (the default)
  //   brochure — the short version: cover, who we are, the floor plans at a glance (or an owner's own
  //              projection), the page that audience needs most (agents: the partner program; an owner:
  //              the terms), and the close
  //   onepage  — the one-pager (see onePage)
  if (format === 'brochure' && cma) {
    if (showPage('about')) add({ key: 'about', kind: 'page', section: 'Who we are', render: () => null })
    if (aud === 'building' && showPage('manage') && ops.length) add({ key: 'manage', kind: 'page', section: 'How we manage', render: () => null })
    if (aud === 'agents' && showPartner) add({ key: 'partner', kind: 'page', section: 'Agent partner program', render: () => null })
    if (aud === 'owner' && plans.length <= 2) for (const p of plans) add({ key: 'plan-' + p.id, kind: 'page', section: 'Your projection', render: () => null })
    else if (cma.plans.length) add({ key: 'glance', kind: 'page', section: 'Every floor plan', tone: 'warm', render: () => null })
    if (aud === 'owner' && showSecond) add({ key: 'second', kind: 'page', section: 'Terms', render: () => null })
  } else for (const k of AUDIENCES[aud].order) parts[k]()
  add({ key: 'back', kind: 'back', render: () => null })
  const folioOf: Record<string, number> = {}
  specs.forEach((s, i) => { folioOf[s.key] = i + 1 })
  const firstOf = (keys: string[]) => { for (const s of specs) if (keys.includes(s.key) || keys.some(k => k.endsWith('*') && s.key.startsWith(k.slice(0, -1)))) return folioOf[s.key]; return 0 }
  const contents = [
    { n: firstOf(['about', 'team', 'manage', 'tech']), title: 'Who we are', sub: 'The company, the team, how we run a home and the technology behind it' },
    { n: firstOf(['op-work']), title: 'Working together', sub: [showPartner ? 'The agent partner program' : '', showSecond ? 'Stay as a second option' : ''].filter(Boolean).join(' and ') },
    { n: firstOf(['op-num']), title: 'The numbers', sub: [showMarket ? 'The ' + (area || 'local') + ' market and comparable set' : '', plans.length ? 'a rental comparison for ' + (plans.length === 1 ? 'one floor plan' : 'every floor plan') : ''].filter(Boolean).join(', and ') },
  ].filter(x => x.n > 0).map(x => ({ ...x, n: two(x.n) }))

  const frame = (key: string, body: React.ReactNode, o: { section?: string; tone?: string } = {}) => (
    <section key={key} data-k={key} className={'mz-page mz-' + (o.tone || 'paper')}>
      {canEdit && overfull.includes(key) ? <p className="mz-overfull">This page is too full to print. Shorten a passage or hide a section.</p> : null}
      <header className="mz-run">
        <span className="mz-run-mark">STAY</span>
        <span>{o.section}</span>
        <span>{short(building)}</span>
      </header>
      <div className="mz-body">{body}</div>
      <footer className="mz-foot">
        <span>{building}{area ? ' · ' + area : ''}</span>
        <span className="mz-folio">{two(folioOf[key])}</span>
      </footer>
    </section>
  )
  const opener = (key: string, _num: string, kick: string, titleKey: 'workTitle' | 'numbersTitle', slot: string) => (
    <section key={key} className="mz-page">
      <div className="mz-opener mz-ph" style={ph(slot, 'linear-gradient(180deg, rgba(22,19,16,.30) 0%, rgba(22,19,16,0) 28%, rgba(22,19,16,.08) 52%, rgba(22,19,16,.84) 100%)')}>
        <p className="mz-caption mz-caption-top">A Stay-managed home</p>
        <div>
          {kicker(kick, true)}
          <h2 className="mz-opener-title"><CT k={titleKey} /></h2>
        </div>
      </div>
    </section>
  )

  const compsTable = (list: PacketComp[], us?: React.ReactNode, withBasis?: boolean) => (
    <table className={'mz-table' + (list.length > 4 ? ' mz-dense' : '')}>
      <thead><tr><th>Comparable</th><th>Market</th>{withBasis ? <th>Basis</th> : null}<th className="r">Gross a year</th><th className="r">Nightly</th><th className="r">Occupancy</th></tr></thead>
      <tbody>
        {list.map(x => { const ci = cma ? cma.comps.findIndex(z => z.id === x.id) : -1; return (
          <tr key={x.id}>
            <td><b><E v={x.name} p={`cma.comps.${ci}.name`} /></b></td>
            <td><E v={x.market} p={`cma.comps.${ci}.market`} /></td>
            {withBasis ? <td><E v={x.basis} p={`cma.comps.${ci}.basis`} /></td> : null}
            <td className="r">{canEdit && editText ? <E v={compGross(x)} p={`cma.comps.${ci}.grossText`} /> : (x.grossText?.trim() ? x.grossText : dash(x.lo, x.hi))}</td>
            <td className="r">{dash(x.nightlyLo, x.nightlyHi)}</td>
            <td className="r">{pctRange(x.occLo, x.occHi).replace(' to ', '–')}</td>
          </tr>
        ) })}
        {us}
      </tbody>
    </table>
  )

  // THE ONE-PAGER (Jon, 2026-11-11: "also have a 1 pager too"). The package on one letter page, for a
  // lobby stack, an email attachment or a quick leave-behind: the building, every unit type's yearly
  // range with its month and night, three reasons, and the person to call. Same theme, audience and
  // numbers as the magazine (?view=onepage on the same link).
  const onePage = (): React.ReactNode => {
    const rows = plans.map(p => ({ p, n: planNumbers(cma!, p) }))
    const fee = terms.find(r => /fee/i.test(r.k))?.v || '15% of rental revenue'
    const points: [string, string][] = aud === 'agents'
      ? [[cma!.partner.fees.length > 1 ? cma!.partner.fees[0][0] + '–' + cma!.partner.fees[cma!.partner.fees.length - 1][0] : (cma!.partner.fees[0]?.[0] || ''), 'Referral fee per unit, by size, in writing'], ['48 hours', 'A projection for any unit you show or list'], ['40+ platforms', 'One calendar, priced every night']]
      : [[fee.replace(/ of rental revenue/i, ''), 'Of rental revenue. No setup or monthly fees'], ['40+ platforms', 'One calendar, priced every night'], ['24/7', 'A local team and 24/7 guest support on every stay']]
    return (
      <section key="onepage" className="mz-page mz-one">
        <div className="mz-one-top">
          <div className="mz-lockup"><img src="/stay-logo.png" alt="Stay Hospitality" className="mz-icover-logo" />{brandLogo ? <><i /><span className="mz-lockup-wrap"><img src={brandLogo} alt={building} className="mz-lockup-b" />{canEdit ? <button type="button" className="mz-logo-x" aria-label="Remove the building’s logo" onClick={() => setMag({ brandLogo: '' })}>×</button> : null}</span></> : null}</div>
          <span>{AUDIENCES[aud].mast} · {monthYear}</span>
        </div>
        <div className="mz-one-photo mz-ph" style={ph('cover', 'linear-gradient(180deg, rgba(22,19,16,0) 40%, rgba(22,19,16,.72) 100%)', 'center 45%')}>
          <div><p className="mz-kicker mz-on-dark">{area || 'Miami'}{' · Miami'}</p><h1>{short(building) || 'Stay Hospitality'}{/residences$/i.test(building) ? <em> Residences</em> : null}</h1></div>
        </div>
        <div className="mz-one-body">
          <p className="mz-one-dek"><CT k="coverDek" /></p>
          <table className="mz-one-table">
            <thead><tr><th>Unit type</th><th className="r">Gross a year</th><th className="r">A month</th><th className="r">A night</th>{showNet ? <th className="r">Owner keeps, est.</th> : null}</tr></thead>
            <tbody>{rows.map(({ p, n }) => (
              <tr key={p.id}><td><b>{p.name}</b><span>{p.sf}</span></td><td className="r"><b>{dash(n.lo, n.hi)}</b></td><td className="r">{dash(n.monthLo, n.monthHi)}</td><td className="r">{n.nightlyLo ? dash(n.nightlyLo, n.nightlyHi) : '—'}</td>{showNet ? <td className="r">{dash(netOf(n.lo), netOf(n.hi))}</td> : null}</tr>
            ))}</tbody>
          </table>
          <p className="mz-one-note"><CT k="heroNote" />. Estimates for an established listing; projections, not guarantees.</p>
          <div className="mz-one-points">{points.map(([b, t], i) => <div key={i}><b>{b}</b><span>{t}</span></div>)}</div>
          <div className="mz-one-foot">
            <div className="mz-one-cta"><p className="mz-kicker">Next step</p><h2><CT k="backTitle" /></h2></div>
            {card.name ? (
              <div className="mz-one-card">
                {card.photo ? <img src={card.photo} alt="" /> : <span className="mz-initials">{initials(card.name)}</span>}
                <div><b>{card.name}</b><span>{card.role}</span><span className="mz-sel">{card.phone}</span><span className="mz-sel">{card.email}</span></div>
              </div>
            ) : null}
          </div>
          <p className="mz-one-fine">{String(cma!.disclaimer || '').split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.')} Stay Hospitality · stay-hospitality.com</p>
        </div>
      </section>
    )
  }
  const render = (s: Spec): React.ReactNode => {
    switch (true) {
      case s.key === 'cover' && theme.cover === 'inset': return (
        // THE INSET COVER (Atelier): the photograph framed on paper, the name set beneath it.
        <section key="cover" className="mz-page mz-icover">
          {/* STAY, WITH THE BUILDING (Jon, 2026-11-11: "really Stay branded, with design elements of the
              property"): our mark and the building's own logo as one lockup, its colours in the theme. */}
          <div className="mz-icover-mast">
            <div className="mz-lockup">
              <img src="/stay-logo.png" alt="Stay Hospitality" className="mz-icover-logo" />
              {brandLogo ? <><i /><span className="mz-lockup-wrap"><img src={brandLogo} alt={building} className="mz-lockup-b" />{canEdit ? <button type="button" className="mz-logo-x" title="Remove the building’s logo" aria-label="Remove the building’s logo" onClick={() => setMag({ brandLogo: '' })}>×</button> : null}</span></> : null}
            </div>
            <span>{cma ? AUDIENCES[audienceOf(c.audience)].mast : 'Management Proposal'}</span>
          </div>
          <div className="mz-icover-photo mz-ph" style={ph('cover', '', 'center 45%')} />
          <div className="mz-icover-main">
            <p className="mz-icover-kick">{cma ? <E v={area} p="cma.area" ph="Area" /> : area || 'South Florida'}{' · Miami'}</p>
            <h1 className="mz-icover-title">
              {canEdit && editText ? <E v={building} p={buildingPath} ph="Building" /> : <>{short(building) || 'Stay Hospitality'}{/residences$/i.test(building) ? <em> Residences</em> : null}</>}
            </h1>
            <i className="mz-icover-rule" />
            <p className="mz-icover-dek"><CT k="coverDek" /></p>
          </div>
          <div className="mz-icover-foot">
            <span>{prospect || (canEdit && editText) || (cma && AUDIENCES[audienceOf(c.audience)].forDefault) ? <>Prepared for {prospect || (canEdit && editText) ? <E v={prospect} p="meta.prospect" ph="Who it is for" /> : AUDIENCES[audienceOf(c.audience)].forDefault}</> : 'Stay Hospitality'}</span>
            <span>{monthYear}</span>
          </div>
        </section>
      )
      case s.key === 'cover': return (
        <section key="cover" className="mz-page mz-cover mz-ph" style={ph('cover', 'linear-gradient(180deg, rgba(22,19,16,.66) 0%, rgba(22,19,16,.10) 26%, rgba(22,19,16,.04) 50%, rgba(22,19,16,.86) 100%)', 'center 40%')}>
          <div className="mz-mast">
            <div className="mz-lockup mz-lockup-dark"><img src="/stay-logo.png" alt="Stay Hospitality" className="mz-logo" />{brandLogo ? <><i /><span className="mz-lockup-wrap"><img src={brandLogo} alt={building} className="mz-lockup-b" />{canEdit ? <button type="button" className="mz-logo-x" title="Remove the building’s logo" aria-label="Remove the building’s logo" onClick={() => setMag({ brandLogo: '' })}>×</button> : null}</span></> : null}</div>
            <div className="mz-mast-r"><span>{cma ? AUDIENCES[audienceOf(c.audience)].mast : 'Management Proposal'}</span><span>{monthYear}</span></div>
          </div>
          <div className="mz-cover-main">
            {kicker(<>{cma ? <E v={area} p="cma.area" ph="Area" /> : area || 'South Florida'}{' · Miami'}</>, true)}
            <h1 className="mz-cover-title">
              {canEdit && editText ? <E v={building} p={buildingPath} ph="Building" /> : <>{short(building) || 'Stay Hospitality'}{/residences$/i.test(building) ? <em> Residences</em> : null}</>}
            </h1>
            <p className="mz-cover-dek"><CT k="coverDek" /></p>
            {prospect || (canEdit && editText) || (cma && AUDIENCES[audienceOf(c.audience)].forDefault) ? <p className="mz-cover-for">Prepared for {prospect || (canEdit && editText) ? <E v={prospect} p="meta.prospect" ph="Who it is for" /> : AUDIENCES[audienceOf(c.audience)].forDefault} · {date}</p> : null}
          </div>
        </section>
      )
      case s.key === 'contents': return frame('contents', (
        <div className="mz-contents">
          <div className="mz-contents-photo mz-ph" style={ph('contents')} />
          <div className="mz-contents-r">
            {kicker('In this package')}
            <h2 className="mz-h mz-h1">Contents</h2>
            <ol className="mz-toc">{contents.map(x => <li key={x.n}><span className="mz-toc-n">{x.n}</span><div><b>{x.title}</b><span>{x.sub}</span></div></li>)}</ol>
            <div className="mz-note">
              {kicker('A note' + (presenterFirst ? ' from ' + presenterFirst : ''))}
              <div className="mz-note-text"><CT k="note" block /></div>
              {card.name ? (
                <div className="mz-sign">
                  {card.photo ? <img src={card.photo} alt="" /> : null}
                  <div><b><E v={card.name} p="contact.card.name" /></b><span><E v={card.role} p="contact.card.role" /></span></div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ), { section: 'Contents' })
      case s.key === 'about': return (
        <section key="about" className="mz-page">
          <div className="mz-about-photo mz-ph" style={ph('about', 'linear-gradient(180deg, rgba(22,19,16,.05) 30%, rgba(22,19,16,.78) 100%)')}>
            <header className="mz-run mz-run-dark"><span className="mz-run-mark">STAY</span><span>Who we are</span><span>{short(building)}</span></header>
            <div className="mz-about-head">
              {kicker('Stay Hospitality', true)}
              <h2 className="mz-h mz-display mz-on-dark"><CT k="aboutHead" /></h2>
            </div>
          </div>
          <div className="mz-body">
            <div className="mz-about-grid">
              <p className="mz-lead"><CT k="aboutDek" block /></p>
              <p className="mz-small mz-about-note"><CT k="aboutNote" block /></p>
            </div>
            {stats.length ? (
              <div className="mz-stats" style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)` }}>
                {stats.map(st => {
                  // A list of places is not a figure (audit 2026-11-11): "Miami · Fort Lauderdale · Pompano · Palm Beach"
                  // wrapped to four lines. Print the count large and the places as the label; the text stays editable as stored.
                  const places = !(canEdit && editText) && !/\d/.test(st.fig) && st.fig.split(/\s*·\s*/).filter(Boolean).length > 1 ? st.fig.split(/\s*·\s*/).filter(Boolean) : null
                  return places
                    ? <div key={st.i}><b>{places.length}</b><span>{st.lab}: {places.join(', ')}</span></div>
                    : <div key={st.i}><b className={st.fig.length > 9 ? 'long' : ''}><E v={st.fig} p={`overview.stats.${st.i}.${st.figP}`} /></b><span><E v={st.lab} p={`overview.stats.${st.i}.${st.labP}`} /></span></div>
                })}
              </div>
            ) : null}
          </div>
          <footer className="mz-foot"><span>{building}{area ? ' · ' + area : ''}</span><span className="mz-folio">{two(folioOf.about)}</span></footer>
        </section>
      )
      case s.key === 'team': return frame('team', (
        <>
          {team.length ? (
            <>
              {kicker(<CT k="kPeople" />)}
              <h2 className="mz-h mz-h1"><CT k="teamHead" /></h2>
              <div className={'mz-team mz-team-' + Math.min(4, Math.max(3, team.length <= 3 ? 3 : 4))}>
                {team.map(({ p, i }, j) => (
                  <figure key={j}>
                    {p.photo ? <img src={p.photo} alt="" /> : <span className="mz-initials">{initials(p.name)}</span>}
                    <figcaption>
                      <b>{i >= 0 ? <E v={p.name} p={`team.people.${i}.name`} /> : p.name}</b>
                      <span>{i >= 0 ? <E v={p.role} p={`team.people.${i}.role`} /> : p.role}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </>
          ) : null}
          {terms.length ? (
            <div className="mz-terms-wrap">
              {kicker(<CT k="kTerms" />)}
              <dl className="mz-terms">{terms.map(r => <div key={r.i}><dt><E v={r.k} p={`terms.rows.${r.i}.k`} /></dt><dd><E v={r.v} p={`terms.rows.${r.i}.v`} block /></dd></div>)}</dl>
            </div>
          ) : null}
        </>
      ), { section: 'Who we are', tone: 'warm' })
      case s.key === 'manage': return (
        <section key="manage" data-k="manage" className="mz-page mz-split-page">
          {canEdit && overfull.includes('manage') ? <p className="mz-overfull">This page is too full to print. Shorten a passage or hide a section.</p> : null}
          {gfx('manage')
            ? <div className="mz-split-photo"><StayTimeline steps={ops} title={T('timelineTitle')} note={T('timelineNote')} tags={String(copy.timelineTags || '').split('|').map((x: string) => x.trim())} /></div>
            : <div className="mz-split-photo mz-ph" style={ph('manage')}><p className="mz-caption">A Stay-managed home</p></div>}
          <div className="mz-split-text">
            <header className="mz-run mz-run-tight"><span className="mz-run-mark">STAY</span><span>How we manage</span><span>{short(building)}</span></header>
            <div className="mz-split-body">
              {kicker('How we manage')}
              <h2 className="mz-h mz-h1"><CT k="manageHead" /></h2>
              <p className="mz-lead mz-lead-s"><CT k="manageDek" block /></p>
              <ol className="mz-practice">
                {ops.map((r, j) => <li key={r.i}><span>{two(j + 1)}</span><div><b><E v={r.k} p={`ops.rows.${r.i}.k`} /></b><p><E v={r.v} p={`ops.rows.${r.i}.v`} block /></p></div></li>)}
              </ol>
            </div>
            <footer className="mz-foot mz-foot-tight"><span>{building}{area ? ' · ' + area : ''}</span><span className="mz-folio">{two(folioOf.manage)}</span></footer>
          </div>
        </section>
      )
      case s.key === 'tech': return frame('tech', (
        <>
          {kicker('Our technology')}
          <h2 className="mz-h mz-h1"><CT k="techHead" /></h2>
          <p className="mz-lead"><CT k="techDek" block /></p>
          <div className="mz-tools">
            {tools.slice(0, 5).map((t: Any, i: number) => (
              <div key={i} className="mz-tool">
                <div className="mz-tool-l">
                  <b>{toolsPath ? <E v={t.name} p={`${toolsPath}.${i}.name`} /> : t.name}</b>
                  <span>{toolsPath ? <E v={t.role} p={`${toolsPath}.${i}.role`} /> : t.role}</span>
                </div>
                <p>{toolsPath ? <E v={t.v} p={`${toolsPath}.${i}.v`} block /> : t.v}</p>
              </div>
            ))}
          </div>
          <div className="mz-channels">
            {kicker(<CT k="kListed" />)}
            {gfx('tech') ? <ChannelHub channels={channels} count={channelCount} /> : <p>{channels.map((ch, i) => <React.Fragment key={i}>{i ? <i>·</i> : null}<span>{ch}</span></React.Fragment>)}<i>·</i><span className="mz-plus">{channelCount} platforms in all</span></p>}
          </div>
        </>
      ), { section: 'Our technology' })
      case s.key === 'op-work': return opener('op-work', '02', 'Working together', 'workTitle', 'work')
      case s.key === 'op-num' && gfx('numbers'): return (
        <section key="op-num" className="mz-page"><YearWave kicker="The numbers" title={<CT k="numbersTitle" />} /></section>
      )
      case s.key === 'op-num': return opener('op-num', specs.some(x => x.key === 'op-work') ? '03' : '02', 'The numbers', 'numbersTitle', 'numbers')
      case s.key === 'partner' && !!cma: return frame('partner', (
        <>
          {kicker('For sales teams and agents')}
          <h2 className="mz-h mz-h1">The agent partner program</h2>
          <div className="mz-partner">
            <div>
              <p className="mz-lead mz-lead-s"><E v={cma!.partner.lead} p="cma.partner.lead" block /></p>
              <div className="mz-cards">{cma!.partner.cards.map(([k, v], i) => <div key={i}><b><E v={k} p={`cma.partner.cards.${i}.0`} /></b><p><E v={v} p={`cma.partner.cards.${i}.1`} block /></p></div>)}</div>
            </div>
            <aside className="mz-fees">
              {kicker(<CT k="kFees" />, true)}
              {cma!.partner.fees.map(([a, w], i) => <div key={i} className="mz-fee"><b><E v={a} p={`cma.partner.fees.${i}.0`} /></b><span><E v={w} p={`cma.partner.fees.${i}.1`} /></span></div>)}
              <p><E v={cma!.partner.feeNote} p="cma.partner.feeNote" block /></p>
            </aside>
          </div>
          {kicker(<CT k="kHow" />)}
          <ol className="mz-steps mz-steps-4">{cma!.partner.steps.map(([k, v], i) => <li key={i}><span>{two(i + 1)}</span><b><E v={k} p={`cma.partner.steps.${i}.0`} /></b><p><E v={v} p={`cma.partner.steps.${i}.1`} block /></p></li>)}</ol>
        </>
      ), { section: 'Agent partner program' })
      case s.key === 'second' && !!cma: return frame('second', (
        <>
          {kicker(<CT k="secondKicker" />)}
          <h2 className="mz-h mz-h1"><CT k="secondTitle" /></h2>
          <p className="mz-lead mz-lead-xs"><E v={cma!.second.choose} p="cma.second.choose" block /></p>
          <div className="mz-qa">{cma!.second.qa.map(([q, a], i) => <div key={i}><p className="mz-q"><E v={q} p={`cma.second.qa.${i}.0`} /></p><p className="mz-a"><E v={a} p={`cma.second.qa.${i}.1`} block /></p></div>)}</div>
          {kicker(<CT k="kReady" />)}
          <ol className="mz-steps mz-steps-3">{cma!.second.steps.map(([k, v], i) => <li key={i}><span>{two(i + 1)}</span><b><E v={k.replace(/\.$/, '')} p={`cma.second.steps.${i}.0`} /></b><p><E v={v} p={`cma.second.steps.${i}.1`} block /></p></li>)}</ol>
        </>
      ), { section: 'Owner options' })
      case s.key === 'market' && !!cma: return frame('market', (
        <>
          {kicker([short(building), area].filter(Boolean).join(' · '))}
          <h2 className="mz-h mz-h1"><CT k="marketHead" /></h2>
          <p className="mz-lead mz-lead-s"><E v={cma!.market.lead} p="cma.market.lead" block /></p>
          <div className="mz-cols">{cma!.market.bullets.map(([k, v], i) => (v.trim() || (canEdit && editText)) ? <div key={i} className="mz-col-item"><b><E v={k.replace(/\.$/, '')} p={`cma.market.bullets.${i}.0`} /></b><p><E v={v} p={`cma.market.bullets.${i}.1`} block /></p></div> : null)}</div>
          {cma!.comps.length ? (() => { const bases = Array.from(new Set(cma!.comps.map(x => x.basis.trim()).filter(Boolean))); return (
            <div className="mz-comps">{kicker(<CT k="kCompsAll" />)}{compsTable(cma!.comps, null, bases.length > 1)}{bases.length === 1 ? <p className="mz-source">Every comparable: {bases[0].replace(/^./, m => m.toLowerCase())}.</p> : null}</div>
          ) })() : null}
        </>
      ), { section: 'The market' })
      case s.key === 'glance' && !!cma: {
        // Dumbbells on one continuous grid (information-design audit): each plan's year from the low
        // dot to the high dot, a $0 baseline kept honest, and the yield as one figure, not two.
        const nums = cma!.plans.map(p => ({ p, n: planNumbers(cma!, p) }))
        const maxHi = Math.max(1, ...nums.map(x => x.n.hi))
        const step = maxHi > 160000 ? 50000 : maxHi > 80000 ? 25000 : 10000
        const top = Math.ceil(maxHi * 1.04 / step) * step
        const ticks: number[] = []
        for (let v = 0; v <= top; v += step) ticks.push(v)
        const pos = (v: number) => (v / top * 100) + '%'
        return frame('glance', (
          <>
            {kicker('Every floor plan')}
            <h2 className="mz-h mz-h1"><CT k="glanceHead" /></h2>
            <p className="mz-lead mz-lead-s"><CT k="glanceDek" block /></p>
            <div className={'mz-gl' + (showYield ? ' with-yield' : '')}>
              <div className="mz-gl-head"><span>Floor plan</span><span className="mz-gl-axis">{ticks.map(v => <i key={v} style={{ left: pos(v) }}>{v === 0 ? '$0' : '$' + v / 1000 + 'K'}</i>)}</span><span className="r">Gross a year</span>{showYield ? <span className="r">Gross yield</span> : null}</div>
              <div className="mz-gl-rows">
                <div className="mz-gl-gridlayer">{ticks.map(v => <s key={v} style={{ left: pos(v) }} />)}</div>
                {nums.map(({ p, n }) => { const pr = priceOf(p.price); return (
                  <div key={p.id} className="mz-gl-row">
                    <div className="mz-gl-name"><b>{p.name}</b><span>{p.sf}</span></div>
                    <div className="mz-gl-track"><i style={{ left: pos(n.lo), width: 'calc(' + pos(n.hi - n.lo) + ')' }} /><em style={{ left: pos(n.lo) }} /><em style={{ left: pos(n.hi) }} /></div>
                    <div className="mz-gl-v"><b>{dash(n.lo, n.hi)}</b><span>{dash(n.monthLo, n.monthHi)} a month</span></div>
                    {showYield ? <div className="mz-gl-y">{pr ? (Math.round(n.lo / pr * 1000) / 10).toFixed(1) + '–' + pct1(n.hi / pr) : '—'}</div> : null}
                  </div>
                ) })}
              </div>
            </div>
            <div className="mz-read">
              <p>Figures are gross rental revenue: booking revenue before channel fees and the management fee. Every range starts from the comparable set, then adds a {cma!.uplift.lo}% (low end) to {cma!.uplift.hi}% (high end) uplift, {cma!.uplift.why}{showYield ? ' Gross yield is the year’s gross against the starting price.' : ''}</p>
            </div>
          </>
        ), { section: 'Every floor plan', tone: 'warm' })
      }
      case s.key.startsWith('plan-') && !!cma: {
        // The hierarchy the audit asked for: the year's range first and largest, then the seasonal
        // shape, then the three supporting figures; the plan's name is the label, not the headline.
        const p = cma!.plans.find(x => 'plan-' + x.id === s.key)!
        const pi = cma!.plans.findIndex(x => x.id === p.id)
        const n = planNumbers(cma!, p)
        const comps = p.compIds.map(id => cma!.comps.find(x => x.id === id)).filter(Boolean) as PacketComp[]
        const row3: [string, string, string][] = [
          ['Per month, on average', dash(n.monthLo, n.monthHi), 'averaged across the year'],
          ['Peak month', 'up to ' + money(n.peak), n.peakMonth + ', high end'],
          showNet ? ['Owner keeps, est.', dash(netOf(n.lo), netOf(n.hi)), 'a year, after fees'] : ['Nightly rate' + (p.suites > 1 ? ', per suite' : ''), dash(n.nightlyLo, n.nightlyHi), 'at ' + pctRange(p.occLo, p.occHi) + ' occupancy'],
        ]
        return frame(s.key, (
          <>
            {canEdit ? <button type="button" className="mz-adjust" onClick={() => { setTuneId(p.id); setDrawer('proj') }}>Adjust projection</button> : null}
            {kicker((short(building) ? short(building) + ' · ' : '') + 'Rental projection')}
            <h2 className="mz-h mz-plan-name"><E v={p.name} p={`cma.plans.${pi}.name`} /></h2>
            <p className="mz-plan-sub"><E v={p.sf} p={`cma.plans.${pi}.sf`} ph="Size" /><span> · </span><E v={p.rules} p={`cma.plans.${pi}.rules`} ph="Rental rules" /></p>
            <div className="mz-hero">
              <span><CT k="heroLabel" /></span>
              <b>{money(n.lo)}<i>–</i>{money(n.hi)}</b>
              <small><CT k="heroNote" /></small>
            </div>
            <dl className="mz-row3">{row3.map(([l, v, sm], i) => <div key={i}><dt>{l}</dt><dd>{v}</dd><small>{sm}</small></div>)}</dl>
            <div className="mz-chart-head">
              {kicker(chart === 'cumulative' ? 'The year, as it adds up' : <CT k="kChart" />)}
              {chart === 'line' ? <p className="mz-legend mz-legend-line"><i className="hi" /> High end <i className="lo" /> Low end</p> : <p className="mz-legend"><i className="lo" /> Low end <i className="hi" /> High end</p>}
            </div>
            <Chart months={n.months} kind={chart} h={chartH['plan-' + p.id]} />
            <p className="mz-source"><CT k="chartSource" /></p>
            <div className="mz-comps">
              {kicker(<CT k="kComps" />)}
              {compsTable(comps, (
                <tr className="mz-us"><td><b>{(short(building) ? short(building) + ' ' : '') + p.name}</b></td><td>{area ? area + ', new build' : 'New build'}</td><td className="r"><b>{dash(n.lo, n.hi)}</b></td><td className="r"><b>{dash(n.nightlyLo, n.nightlyHi)}</b></td><td className="r"><b>{pctRange(p.occLo, p.occHi).replace(' to ', '–')}</b></td></tr>
              ))}
              <p className="mz-how"><b>How we got there.</b> <E v={p.how} p={`cma.plans.${pi}.how`} block /> {n.manual ? 'The range was set by hand.' : `Ranges are then raised ${cma!.uplift.lo}% at the low end and ${cma!.uplift.hi}% at the high end, ${cma!.uplift.why}`} {adjustLine(cma!, p)}{showNet ? ` Owner estimate after ${channelPct}% channel fees and a ${mgmtPct}% management fee.` : ''}</p>
            </div>
          </>
        ), { section: 'Rental projection' })
      }
      case s.key === 'back': return (
        <section key="back" className="mz-page mz-backcover mz-ph" style={ph('back', 'linear-gradient(180deg, rgba(22,19,16,.55) 0%, rgba(22,19,16,.80) 45%, rgba(22,19,16,.95) 100%)')}>
          <div className="mz-lockup mz-lockup-dark"><img src="/stay-logo.png" alt="Stay Hospitality" className="mz-logo" />{brandLogo ? <><i /><span className="mz-lockup-wrap"><img src={brandLogo} alt={building} className="mz-lockup-b" />{canEdit ? <button type="button" className="mz-logo-x" title="Remove the building’s logo" aria-label="Remove the building’s logo" onClick={() => setMag({ brandLogo: '' })}>×</button> : null}</span></> : null}</div>
          <div className="mz-back-main">
            {kicker('Next step', true)}
            <h2 className="mz-back-title"><CT k="backTitle" /></h2>
            <p className="mz-back-dek"><CT k="backDek" block /></p>
            {card.name || (canEdit && editText) ? (
              <div className="mz-contact">
                {card.photo ? <img src={card.photo} alt="" /> : <span className="mz-initials mz-initials-l">{initials(card.name)}</span>}
                <div>
                  <b><E v={card.name} p="contact.card.name" ph="Name" /></b>
                  <span className="mz-contact-role"><E v={card.role} p="contact.card.role" ph="Title" /></span>
                  <span className="mz-sel"><E v={card.phone} p="contact.card.phone" ph="Phone" /></span>
                  <span className="mz-sel"><E v={card.email} p="contact.card.email" ph="Email" /></span>
                </div>
              </div>
            ) : null}
          </div>
          <p className="mz-fine">{cma ? <E v={cma.disclaimer} p="cma.disclaimer" block /> : 'Projections are estimates, not guarantees. Management terms are set in the written agreement.'}<br />Stay Hospitality · stay-hospitality.com{credits.length ? <><br />Photography: {credits.join(' · ')}</> : null}</p>
        </section>
      )
      default: return null
    }
  }

  // ── The builder drawer ──
  const tunePlan = cma && (cma.plans.find(x => x.id === tuneId) || cma.plans[0])
  const setPlan = (np: PacketPlan) => cma && setCma({ ...cma, plans: cma.plans.map(x => x.id === np.id ? np : x) })
  const setComp = (i: number, f: Partial<PacketComp>) => cma && setCma({ ...cma, comps: cma.comps.map((x, j) => j === i ? { ...x, ...f } : x) })
  const nIn = (v: string) => { const x = parseFloat(String(v).replace(/[$,%\s]/g, '')); return Number.isFinite(x) ? x : 0 }
  const setMag = (f: Any) => patch('magazine', { ...mag, ...f })
  async function readBrand() {
    const u = brandUrl.trim()
    if (!u) return
    setBrandMsg('Reading ' + u.replace(/^https?:\/\//, '') + '…')
    try {
      const r = await fetch('/api/sales/brand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: u }) })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d?.ok) throw new Error(d?.error || 'Could not read that website')
      setMag({ style: 'custom', custom: { ...d.theme, label: d.theme.label || 'From the building' }, brandLogo: d.logo || '', brandImage: d.image || '', brandSource: u })
      setBrandMsg('Theme built from ' + (d.theme.label || u) + (d.theme.display ? ', with ' + d.theme.display + ' for headlines' : '') + '. Save to keep it.')
    } catch (e: Any) { setBrandMsg(e?.message || 'Could not read that website') }
  }
  const color = (k: keyof MagTheme, label: string) => (
    <label key={k} className="mz-color"><input type="color" value={String((custom || theme)[k] || '#000000')} onChange={e => setMag({ style: 'custom', custom: { ...(custom || { ...theme, label: 'Custom' }), [k]: e.target.value } })} /><span>{label}</span></label>
  )
  const drawerEl = canEdit && drawer ? (
    <aside className="mz-drawer" aria-label="Builder">
      <div className="mz-drawer-head"><b>Builder</b><button type="button" onClick={() => setDrawer(null)} aria-label="Close">×</button></div>
      <div className="mz-seg">
        {([['proj', 'Projections'], ['comps', 'Comparables'], ['pages', 'Pages & photos'], ['style', 'Style & data']] as const).map(([k, l]) => <button key={k} type="button" className={drawer === k ? 'on' : ''} onClick={() => setDrawer(k)}>{l}</button>)}
      </div>

      {drawer === 'proj' && (cma && tunePlan ? (
        <>
          <div className="mz-drawer-tabs">{cma.plans.map(x => <button key={x.id} type="button" className={x.id === tunePlan.id ? 'on' : ''} onClick={() => setTuneId(x.id)}>{x.name}</button>)}</div>
          <div className="mz-drawer-all">
            <span>All floor plans</span>
            <input type="range" min={-30} max={30} step={1} value={cma.adjust || 0} onChange={e => setCma({ ...cma, adjust: Number(e.target.value) })} aria-label="Scale every floor plan" />
            <b>{(cma.adjust || 0) > 0 ? '+' : ''}{cma.adjust || 0}%</b>
          </div>
          <h3 className="mz-drawer-plan">{tunePlan.name}</h3>
          <ProjectionTuner cma={cma} plan={tunePlan} onChange={setPlan} />
          <div className="mz-form">
            <p className="mz-form-h">Built from</p>
            <label className="wide"><span>Comparable</span><select value={tunePlan.baseId} onChange={e => setPlan({ ...tunePlan, baseId: e.target.value })}>{cma.comps.map(x => <option key={x.id} value={x.id}>{x.name || 'Unnamed'}</option>)}</select></label>
            <label><span>Scale ×</span><input inputMode="decimal" defaultValue={tunePlan.scale} key={'s' + tunePlan.id} onBlur={e => setPlan({ ...tunePlan, scale: nIn(e.target.value) || 1 })} /></label>
            <label><span>Lockout less %</span><input inputMode="decimal" defaultValue={tunePlan.less} key={'l' + tunePlan.id} onBlur={e => setPlan({ ...tunePlan, less: nIn(e.target.value) })} /></label>
            <label><span>Suites</span><input inputMode="numeric" defaultValue={tunePlan.suites} key={'u' + tunePlan.id} onBlur={e => setPlan({ ...tunePlan, suites: Math.max(1, Math.round(nIn(e.target.value)) || 1) })} /></label>
            <label><span>Occupancy low %</span><input inputMode="decimal" defaultValue={tunePlan.occLo} key={'o' + tunePlan.id} onBlur={e => setPlan({ ...tunePlan, occLo: nIn(e.target.value) })} /></label>
            <label><span>Occupancy high %</span><input inputMode="decimal" defaultValue={tunePlan.occHi} key={'p' + tunePlan.id} onBlur={e => setPlan({ ...tunePlan, occHi: nIn(e.target.value) })} /></label>
            <div className="wide mz-checks"><span>Comparables on this page</span>{cma.comps.map(x => <label key={x.id}><input type="checkbox" checked={tunePlan.compIds.includes(x.id)} onChange={e => setPlan({ ...tunePlan, compIds: e.target.checked ? [...tunePlan.compIds, x.id] : tunePlan.compIds.filter(id => id !== x.id) })} /> {x.name || 'Unnamed'}</label>)}</div>
            <p className="mz-form-h">New-build uplift, every plan</p>
            <label><span>Low end %</span><input inputMode="decimal" defaultValue={cma.uplift.lo} onBlur={e => setCma({ ...cma, uplift: { ...cma.uplift, lo: nIn(e.target.value) } })} /></label>
            <label><span>High end %</span><input inputMode="decimal" defaultValue={cma.uplift.hi} onBlur={e => setCma({ ...cma, uplift: { ...cma.uplift, hi: nIn(e.target.value) } })} /></label>
          </div>
          <button type="button" className="mz-add" onClick={() => { const id = newId(); setCma({ ...cma, plans: [...cma.plans, { id, name: 'New floor plan', sf: '', price: '', rules: 'Short-term rentals allowed', compIds: cma.comps.slice(0, 2).map(x => x.id), baseId: cma.comps[0]?.id || '', scale: 1, less: 0, suites: 1, occLo: 70, occHi: 75, how: '', override: null }] }); setTuneId(id) }}>+ Add a floor plan</button>
          <button type="button" className="mz-remove" onClick={() => { setCma({ ...cma, plans: cma.plans.filter(x => x.id !== tunePlan.id) }); setTuneId(null) }}>Remove {tunePlan.name}</button>
        </>
      ) : <p className="mz-drawer-empty">This deck has no floor plans yet. Add them on the Sales tab under Floor plans &amp; comps.</p>)}

      {drawer === 'comps' && (cma ? (
        <>
          <p className="mz-form-h">From the projections library</p>
          <LibraryCompPicker compact onAdd={add => setCma(attachComps(cma, add))} />
          <p className="mz-drawer-note">Library comparables land on the floor plans with the same bedroom count; tick or untick them per floor plan under Projections.</p>
          <p className="mz-form-h">In this deck</p>
          {cma.comps.map((x, i) => (
            <div key={x.id} className="mz-form mz-comp">
              <label className="wide"><span>Comparable</span><input defaultValue={x.name} onBlur={e => setComp(i, { name: e.target.value })} /></label>
              <label><span>Market</span><input defaultValue={x.market} onBlur={e => setComp(i, { market: e.target.value })} /></label>
              <label><span>Basis</span><input defaultValue={x.basis} onBlur={e => setComp(i, { basis: e.target.value })} /></label>
              <label><span>Gross low $</span><input inputMode="decimal" defaultValue={x.lo} onBlur={e => setComp(i, { lo: nIn(e.target.value) })} /></label>
              <label><span>Gross high $</span><input inputMode="decimal" defaultValue={x.hi} onBlur={e => setComp(i, { hi: nIn(e.target.value) })} /></label>
              <label className="wide"><span>Gross shown as (optional)</span><input defaultValue={x.grossText || ''} placeholder={range(x.lo, x.hi)} onBlur={e => setComp(i, { grossText: e.target.value })} /></label>
              <label><span>Nightly low</span><input inputMode="decimal" defaultValue={x.nightlyLo} onBlur={e => setComp(i, { nightlyLo: nIn(e.target.value) })} /></label>
              <label><span>Nightly high</span><input inputMode="decimal" defaultValue={x.nightlyHi} onBlur={e => setComp(i, { nightlyHi: nIn(e.target.value) })} /></label>
              <label><span>Occupancy low %</span><input inputMode="decimal" defaultValue={x.occLo} onBlur={e => setComp(i, { occLo: nIn(e.target.value) })} /></label>
              <label><span>Occupancy high %</span><input inputMode="decimal" defaultValue={x.occHi} onBlur={e => setComp(i, { occHi: nIn(e.target.value) })} /></label>
              <button type="button" className="mz-remove wide" onClick={() => setCma({ ...cma, comps: cma.comps.filter((_, j) => j !== i), plans: cma.plans.map(p => ({ ...p, compIds: p.compIds.filter(id => id !== x.id) })) })}>Remove this comparable</button>
            </div>
          ))}
          <button type="button" className="mz-add" onClick={() => setCma({ ...cma, comps: [...cma.comps, { id: newId(), name: 'New comparable', market: '', basis: 'Stay projection, established listing', lo: 0, hi: 0, nightlyLo: 0, nightlyHi: 0, occLo: 70, occHi: 75 }] })}>+ Add a comparable</button>
          <p className="mz-drawer-note">Every range built from a comparable moves as soon as its low or high changes.</p>
        </>
      ) : <p className="mz-drawer-empty">This deck has no comparables yet.</p>)}

      {drawer === 'pages' && (
        <div>
          {cma ? (
            <>
              <p className="mz-form-h">Type of magazine</p>
              <div className="mz-aud mz-format">
                {([['full', 'Full magazine', 'Every section: who we are, how we run a home, the technology, working together, the market and one page per floor plan'], ['brochure', 'Brochure', 'About six pages: the cover, who we are, the floor plans at a glance, the page this reader needs most, and the close'], ['onepage', 'One-pager', 'Everything on one letter page: every unit type’s range, three reasons and who to call']] as const).map(([k, l, h]) => (
                  <button key={k} type="button" className={format === k ? 'on' : ''} onClick={() => { if (onePager && k !== 'onepage') { window.location.href = keynote + '?view=magazine'; return } setMag({ format: k }) }}><b>{l}</b><span>{h}</span></button>
                ))}
              </div>
              <p className="mz-form-h">Who it is for</p>
              <div className="mz-aud">
                {(Object.keys(AUDIENCES) as Audience[]).map(k => (
                  <button key={k} type="button" className={audienceOf(c.audience) === k ? 'on' : ''} title={AUDIENCES[k].hint}
                    onClick={() => { setDoc((d: Any) => { const m = normalizeCma(d.cma); return { ...d, audience: k, cma: m ? { ...m, sections: { ...m.sections, ...AUDIENCES[k].sections } } : d.cma } }); touch('audience'); touch('cma'); setSaving('') }}>
                    <b>{AUDIENCES[k].label}</b><span>{AUDIENCES[k].hint}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <p className="mz-form-h">Pages</p>
          <label className="mz-toggle"><input type="checkbox" checked={!!mag.showContents} onChange={e => setMag({ showContents: e.target.checked })} /> Contents and a note from the presenter</label>
          {PAGES.map(([k, l]) => <label key={k} className="mz-toggle"><input type="checkbox" checked={!hideMag[k]} onChange={e => setMag({ hide: { ...hideMag, [k]: !e.target.checked } })} /> {l}</label>)}
          {cma ? ([['partner', 'Agent partner program'], ['second', 'Stay as a second option'], ['market', 'Market and comparables'], ['glance', 'Floor plans at a glance'], ['plans', 'One page per floor plan']] as [keyof SalesCma['sections'], string][]).map(([k, l]) => (
            <label key={k} className="mz-toggle"><input type="checkbox" checked={!!cma.sections[k]} onChange={e => setCma({ ...cma, sections: { ...cma.sections, [k]: e.target.checked } })} /> {l}</label>
          )) : null}
          <p className="mz-form-h">Graphics</p>
          {([['manage', 'How we manage: the stay timeline'], ['numbers', 'The numbers: the Miami year'], ['tech', 'Our technology: the platform diagram']] as ['manage' | 'numbers' | 'tech', string][]).map(([k, l]) => (
            <label key={k} className="mz-toggle"><input type="checkbox" checked={gfx(k)} onChange={e => setMag({ graphics: { ...(mag.graphics || {}), [k]: e.target.checked } })} /> {l}</label>
          ))}
          {gfx('manage') ? (
            <div className="mz-form" style={{ marginTop: 8 }}>
              <label>Timeline title<input defaultValue={T('timelineTitle')} onBlur={e => setMag({ copy: { ...(mag.copy || {}), timelineTitle: e.target.value } })} /></label>
              <label>Timeline closing line<input defaultValue={T('timelineNote')} onBlur={e => setMag({ copy: { ...(mag.copy || {}), timelineNote: e.target.value } })} /></label>
              <label>Small labels under each step, separated by |<input defaultValue={String(copy.timelineTags || 'The night before | At check-out | Before arrival | As it happens | Around the clock | Resolved quickly')} onBlur={e => setMag({ copy: { ...(mag.copy || {}), timelineTags: e.target.value } })} /></label>
            </div>
          ) : null}
          <p className="mz-form-h">Photos</p>
          <div className="mz-psearch">
            <form onSubmit={async e => { e.preventDefault(); const q = photoQ.trim(); if (!q) return; setPhotoBusy(true); try { const d = await fetch('/api/sales/photos?q=' + encodeURIComponent(q)).then(r => r.json()); setPhotoHits(d?.ok ? d.hits : []) } catch { setPhotoHits([]) } setPhotoBusy(false) }}>
              <input value={photoQ} onChange={e => setPhotoQ(e.target.value)} placeholder="Search our photos: elser pool, 17 west view, brickell kitchen" />
              <button type="submit" disabled={photoBusy}>{photoBusy ? 'Searching…' : 'Search'}</button>
            </form>
            {photoHits ? (
              <>
                <div className="mz-psearch-to">
                  <span>{photoHits.length ? photoHits.length + (photoHits.length === 60 ? '+' : '') + ' photos · click one to use it on' : 'No photos match. Try fewer words, or a building and a room.'}</span>
                  {photoHits.length ? <select value={pickFor} onChange={e => setPickFor(e.target.value)}>{PHOTO_SLOTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select> : null}
                </div>
                <div className="mz-psearch-grid">
                  {photoHits.map((h: Any) => (
                    <button key={h.url} type="button" className={photo(pickFor) === h.url ? 'on' : ''} title={[h.building, h.unit, h.caption].filter(Boolean).join(' · ')}
                      onClick={() => setMag({ photos: { ...(mag.photos || {}), [pickFor]: h.url }, photoRights: { ...(mag.photoRights || {}), [h.url]: { rights: 'own', ...((mag.photoRights || {})[h.url] || {}) } } })}>
                      <i style={{ backgroundImage: `url("${h.thumb || h.url}")` }} /><span>{h.building}{h.unit ? ' · ' + h.unit : ''}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
          {unconfirmed.length ? <p className="mz-rights-warn">{unconfirmed.length === 1 ? 'One photo in this package has' : unconfirmed.length + ' photos in this package have'} no confirmed source. Confirm we have the rights before sending: a filter changes how a photo looks, not who owns it.</p> : null}
          {PHOTO_SLOTS.map(([slot, label]) => (
            <div key={slot} className="mz-slot">
              <span>{label}</span>
              <div className="mz-thumbs">
                {allPhotos.slice(0, 14).map(u => <button key={u} type="button" className={photo(slot) === u ? 'on' : ''} style={{ backgroundImage: `url(${u})` }} onClick={() => setMag({ photos: { ...(mag.photos || {}), [slot]: u } })} aria-label={'Use this photo for ' + label} />)}
              </div>
              <input placeholder="or paste an image link" defaultValue={(mag.photos || {})[slot] && !allPhotos.includes((mag.photos || {})[slot]) ? (mag.photos || {})[slot] : ''} onBlur={e => { const v = e.target.value.trim(); if (/^https?:\/\/|^\//.test(v)) setMag({ photos: { ...(mag.photos || {}), [slot]: v } }) }} />
              {(() => {
                const fx = fxOf(slot), u = photo(slot), r = rightsOf(u)
                const setFx = (f: Any) => setMag({ photoFx: { ...(mag.photoFx || {}), [slot]: { ...((mag.photoFx || {})[slot] || {}), ...f } } })
                const setR = (f: Any) => setMag({ photoRights: { ...(mag.photoRights || {}), [u]: { ...r, ...f } } })
                return (
                  <>
                    <div className="mz-looks">
                      {Object.entries(LOOKS).map(([k, l]) => (
                        <button key={k} type="button" className={(fx.look || 'original') === k ? 'on' : ''} onClick={() => setFx({ look: k })}>
                          <i style={{ backgroundImage: `url("${u}")`, filter: l.f || 'none' }}>{l.tint ? <b style={{ background: `color-mix(in srgb, var(--mz-navy) ${l.tint}%, transparent)` }} /> : null}</i>{l.label}
                        </button>
                      ))}
                    </div>
                    <div className="mz-fx">
                      <label>Blur<input type="range" min={0} max={16} value={Number(fx.blur) || 0} onChange={e => setFx({ blur: Number(e.target.value) })} /></label>
                      <label>Zoom<input type="range" min={100} max={160} value={Number(fx.zoom) || 100} onChange={e => setFx({ zoom: Number(e.target.value) })} /></label>
                      <label className="mz-toggle"><input type="checkbox" checked={!!fx.flip} onChange={e => setFx({ flip: e.target.checked })} /> Mirror</label>
                      <button type="button" onClick={() => setMag({ photoFx: { all: fxOf(slot) } })} title="Use this look, blur and zoom on every photo">Use on all photos</button>
                    </div>
                    <div className="mz-rights">
                      <select value={r.rights || ''} onChange={e => setR({ rights: e.target.value })} className={!r.rights || r.rights === 'unknown' ? 'warn' : ''}>{RIGHTS.map(([k, l]) => <option key={k} value={k} disabled={!k}>{l}</option>)}</select>
                      <input placeholder="Credit, if the licence asks for one" defaultValue={r.credit || ''} key={u} onBlur={e => { if ((e.target.value.trim()) !== (r.credit || '')) setR({ credit: e.target.value.trim() }) }} />
                    </div>
                  </>
                )
              })()}
            </div>
          ))}
        </div>
      )}

      {drawer === 'style' && (
        <div>
          <p className="mz-form-h">Theme from the building’s website</p>
          <div className="mz-brand">
            <input value={brandUrl} onChange={e => setBrandUrl(e.target.value)} placeholder={mag.brandSource || 'theriderresidences.com'} onKeyDown={e => { if (e.key === 'Enter') readBrand() }} />
            <button type="button" onClick={readBrand}>Read the site</button>
          </div>
          {brandMsg ? <p className="mz-drawer-note">{brandMsg}</p> : null}
          <p className="mz-form-h">Themes</p>
          <div className="mz-swatches">
            {[...Object.entries(MAG_THEMES), ...(custom ? [['custom', custom] as [string, MagTheme]] : [])].map(([k, t]) => (
              <button key={k} type="button" className={styleKey === k ? 'on' : ''} onClick={() => setMag({ style: k })} title={t.label + (k === 'stay' ? ' (the standard)' : '')}>
                <div className="mz-sw-page" style={{ background: t.paper || '#fff' }}>
                  <div className="mz-sw-band" style={{ background: t.navy }}><b style={{ background: t.sand }} /></div>
                  <p style={{ fontFamily: `"${t.display || 'Newsreader'}", serif`, color: t.ink }}>Aa <i style={{ color: t.sand }}>Rider</i></p>
                  <span style={{ background: t.warm, borderColor: t.rule }} />
                </div>
                <em>{t.label}{k === 'stay' ? <small> · standard</small> : null}</em>
              </button>
            ))}
          </div>
          <p className="mz-form-h">Fine-tune colours</p>
          <div className="mz-colors">{color('navy', 'Primary')}{color('sand', 'Accent')}{color('ink', 'Headlines')}{color('warm', 'Tint pages')}</div>
          {custom?.display ? <p className="mz-drawer-note">Headlines in {custom.display}, from the building’s site.</p> : null}
          {/* THE BUILDING'S LOGO (Jon, 2026-11-11: "need to be able to remove their logos"): shown beside
              Stay's on the cover and the close; remove it, or put in the right one. */}
          <p className="mz-form-h">Building logo</p>
          <div className="mz-logo-ctl">
            {brandLogo ? <span className="mz-logo-prev"><img src={brandLogo} alt="" /></span> : <span className="mz-logo-none">No building logo. Stay’s logo shows alone.</span>}
            {brandLogo ? <button type="button" onClick={() => setMag({ brandLogo: '' })}>Remove logo</button> : null}
          </div>
          <input className="mz-logo-url" placeholder={brandLogo ? 'Replace: paste a logo image link' : 'Add one: paste a logo image link'} defaultValue="" key={brandLogo}
            onKeyDown={e => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (/^https?:\/\/|^\//.test(v)) setMag({ brandLogo: v }) } }}
            onBlur={e => { const v = e.target.value.trim(); if (/^https?:\/\/|^\//.test(v)) setMag({ brandLogo: v }) }} />
          <p className="mz-form-h">Chart on each floor plan</p>
          <div className="mz-drawer-tabs">{CHARTS.map(([k, l]) => <button key={k} type="button" className={chart === k ? 'on' : ''} onClick={() => setMag({ chart: k })}>{l}</button>)}</div>
          <p className="mz-form-h">Data</p>
          <label className="mz-toggle"><input type="checkbox" checked={showNet} onChange={e => setMag({ net: e.target.checked })} /> What the owner keeps (estimate)</label>
          {showNet ? (
            <div className="mz-form">
              <label><span>Channel fees %</span><input inputMode="decimal" defaultValue={channelPct} onBlur={e => setMag({ channelPct: nIn(e.target.value) })} /></label>
              <label><span>Management fee %</span><input inputMode="decimal" defaultValue={mgmtPct} onBlur={e => setMag({ mgmtPct: nIn(e.target.value) })} /></label>
            </div>
          ) : null}
          <p className="mz-drawer-note">Every word on the pages changes with Edit text in the top bar. Put *stars* around words to set them in italic.</p>
        </div>
      )}

      <div className="mz-drawer-foot">
        <button type="button" disabled={!dirty} onClick={save}>{dirty ? 'Save to the deck' : saving || 'Saved'}</button>
        {dirty ? <button type="button" className="mz-ghost-d" onClick={discard}>Discard</button> : null}
        <p>Saving updates this magazine, the keynote slides and the link everyone already has.</p>
      </div>
    </aside>
  ) : null

  return (
    <div className={'mz-root' + (flip && !editText && format !== 'onepage' && !phone ? ' mz-flipping' : '') + (canEdit && editText ? ' mz-editing' : '') + (drawer ? ' mz-with-drawer' : '')} style={themeVars(theme)}>
      <link rel="stylesheet" href={fontHref(drawer === 'style' ? Object.values(MAG_THEMES).flatMap(x => [x.display, x.sans]).concat([theme.display, theme.sans]) : [theme.display, theme.sans])} />
      {theme.displayUrl ? <link rel="stylesheet" href={theme.displayUrl} /> : null}
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <style dangerouslySetInnerHTML={{ __html: Object.entries(fit).map(([k, l]) => {
        const f = [1, 0.93, 0.87, 0.81][l] || 1, z = [1, 0.95, 0.9, 0.85][l] || 1
        const sel = `.mz-page[data-k="${k.replace(/"/g, '')}"]`
        return `${sel}{--mz-ds:${((theme.ds || 1) * f).toFixed(3)}}${sel} .mz-body,${sel} .mz-split-body{padding-top:${Math.round(40 * f)}px}${sel} .mz-practice,${sel} .mz-how,${sel} .mz-table,${sel} .mz-qa,${sel} .mz-cards,${sel} .mz-steps,${sel} .mz-cols,${sel} .mz-tools,${sel} .mz-terms,${sel} .mz-lead,${sel} .mz-row3,${sel} .mz-partner,${sel} .mz-gl{zoom:${z}}`
      }).join('') }} />
      <nav className="mz-bar-top">
        <span className="mz-run-mark mz-on-dark">STAY</span>
        <span className="mz-switch">{format === 'onepage' ? <><a href={keynote + '?view=magazine'} onClick={e => { if (!onePager) { e.preventDefault(); setMag({ format: 'full' }) } }}>Magazine</a><b>One page</b></> : <><b>{format === 'brochure' ? 'Brochure' : 'Magazine'}</b>{cma ? <a href={keynote + '?view=onepage'}>One page</a> : null}</>}<a href={keynote}>Keynote</a></span>
        <span className="mz-bar-r">
          {canEdit ? <button type="button" className={'mz-ghost' + (editText ? ' on' : '')} onClick={() => setEditText(x => !x)}>{editText ? 'Done editing' : 'Edit text'}</button> : null}
          {canEdit ? <button type="button" className={'mz-ghost' + (drawer ? ' on' : '')} onClick={() => setDrawer(d => d ? null : 'proj')}>Builder</button> : null}
          {dirty ? <button type="button" onClick={save}>Save changes</button> : saving ? <span className="mz-saved">{saving}</span> : null}
          {format !== 'onepage' ? <button type="button" className={'mz-ghost' + (flip ? ' on' : '')} onClick={() => { setFlip(f => !f); if (!flip) setEditText(false) }}>{flip ? 'Scroll view' : 'Page view'}</button> : null}
          <button type="button" onClick={() => { if (flip) { setFlip(false); setTimeout(() => window.print(), 450) } else window.print() }}><span className="mz-wide">Print or save </span>PDF</button>
        </span>
      </nav>
      {drawerEl}
      {format === 'onepage' && cma ? onePage() : flip && !editText ? <MagazineFlipbook pages={specs.map(render)} labels={specs.map(s => s.section || '')} top={80} /> : specs.map(render)}
    </div>
  )
}

const CSS = `
/* THE TYPE SYSTEM (editorial audit, 2026-11-11). One serif with optical sizes for display, figures and
   reading text; Inter only for labels, tables and chart axes; nothing below 10px. Spacing on one scale:
   8, 12, 20, 32, 48, 72. Margins 72px; a 672px live area. */
.mz-root{background:${C.desk};min-height:100vh;padding:80px 16px 64px;font-family:${SERIF};color:${C.body};-webkit-print-color-adjust:exact;print-color-adjust:exact;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased;font-optical-sizing:auto;font-variant-numeric:lining-nums;font-feature-settings:'lnum' 1}
.mz-root svg text{font-variant-numeric:lining-nums;font-feature-settings:'lnum' 1}
.mz-root *{box-sizing:border-box}
.mz-with-drawer{padding-right:min(500px,100vw)}
.mz-bar-top{position:fixed;top:0;left:0;right:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px max(16px,env(safe-area-inset-left));background:${C.navy};color:#fff;font-family:${SANS}}
.mz-switch{display:inline-flex;background:rgba(255,255,255,.12);border-radius:999px;padding:3px}
.mz-switch b,.mz-switch a{font:600 12.5px ${SANS};padding:6px 15px;border-radius:999px;color:#fff;text-decoration:none}
.mz-switch b{background:#fff;color:${C.navy}}
.mz-bar-r{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.mz-bar-top button{font:600 12.5px ${SANS};background:#fff;color:${C.navy};border:0;border-radius:999px;padding:7px 15px;cursor:pointer}
.mz-bar-top .mz-ghost{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4)}
.mz-bar-top .mz-ghost.on{background:${C.glow};color:${C.ink};border-color:${C.glow}}
.mz-saved{font:500 12px ${SANS};color:rgba(255,255,255,.75)}

/* page */
.mz-page{position:relative;width:816px;max-width:100%;height:1056px;margin:0 auto 36px;background:${C.paper};box-shadow:0 1px 2px rgba(10,14,40,.06),0 24px 60px rgba(10,14,40,.14);display:flex;flex-direction:column;overflow:hidden}
.mz-warm{background:${C.warm}}
.mz-body{padding:40px 72px 0;flex:1;display:flex;flex-direction:column;min-height:0}
.mz-run{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:16px;margin:48px 72px 0;padding-bottom:12px;border-bottom:1px solid ${C.grid};font:500 10px ${SANS};letter-spacing:.2em;text-transform:uppercase;color:${C.muted}}
.mz-run span:last-child{text-align:right}
.mz-run-mark{font:400 13px ${MARK};letter-spacing:.44em;color:${C.ink}}
.mz-run-mark.mz-on-dark,.mz-run-dark .mz-run-mark{color:#fff}
.mz-run-dark{color:rgba(255,255,255,.82);border-color:rgba(255,255,255,.3)}
.mz-foot{display:flex;justify-content:space-between;align-items:baseline;margin:auto 72px 44px;padding-top:12px;border-top:1px solid ${C.grid};font:500 10px ${SANS};letter-spacing:.18em;text-transform:uppercase;color:${C.muted}}
.mz-folio{font:400 15px ${TEXT};letter-spacing:.04em;color:${C.ink}}

/* type */
.mz-kicker{font:600 10px ${SANS};letter-spacing:.22em;text-transform:uppercase;color:${C.sandText};margin:0 0 16px;display:flex;align-items:center;gap:12px}
.mz-kicker::before{content:"";width:28px;height:1px;background:currentColor}
.mz-kicker.mz-on-dark{color:${C.glow}}
.mz-h{font-family:${SERIF};font-weight:300;color:${C.ink};margin:0;text-wrap:balance}
.mz-h em,.mz-cover-title em,.mz-back-title em,.mz-opener-title em{font-style:italic;font-weight:300}
.mz-display{font-size:calc(60px * var(--mz-ds));line-height:1;letter-spacing:-.02em}
.mz-h1{font-size:calc(48px * var(--mz-ds));line-height:1.04;letter-spacing:-.015em}
.mz-on-dark{color:#fff}
.mz-lead{font:300 calc(20px * var(--mz-ds))/1.45 ${SERIF};color:${C.body};margin:20px 0 0;max-width:30em}
.mz-lead-s{font-size:19px}
.mz-lead-xs{font-size:16.5px;line-height:1.5;max-width:36em}
.mz-small{font:italic 400 12px/17px ${TEXT};color:${C.muted}}
.mz-caption{position:absolute;left:24px;bottom:20px;margin:0;font:italic 400 12px ${TEXT};color:rgba(255,255,255,.9);text-shadow:0 1px 8px rgba(0,0,0,.45)}
.mz-caption-top{position:static;align-self:flex-end}
.mz-body>svg,.mz-body svg[role=img]{flex:none}
.mz-source{font:italic 400 11.5px/1.5 ${TEXT};color:${C.muted};margin:8px 0 0}

/* cover */
.mz-cover{background-size:cover;background-position:center 40%;color:#fff;padding:52px 72px 60px;justify-content:space-between}
.mz-mast{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:1px solid rgba(255,255,255,.45)}
.mz-logo{width:150px;filter:brightness(0) invert(1)}
.mz-mast-r{display:flex;flex-direction:column;align-items:flex-end;gap:6px;font:500 10px ${SANS};letter-spacing:.24em;text-transform:uppercase;color:rgba(255,255,255,.92)}
.mz-brandlogo{max-width:180px;max-height:56px;object-fit:contain;filter:brightness(0) invert(1);margin-bottom:24px;display:block}
.mz-cover-title{font-family:${SERIF};font-weight:300;font-size:calc(120px * var(--mz-ds));line-height:.9;letter-spacing:-.03em;margin:4px 0 0;text-wrap:balance}
.mz-cover-title em{display:block}
/* inset cover (Atelier) */
.mz-icover{background:${C.paper};padding:56px 88px 52px;color:${C.ink}}
.mz-icover-mast{display:flex;justify-content:space-between;align-items:center}
.mz-icover-mast span{font:400 9.5px ${SANS};letter-spacing:.34em;text-transform:uppercase;color:${C.muted}}
.mz-icover-logo{width:108px;filter:brightness(0);opacity:.88}
.mz-lockup{display:flex;align-items:center;gap:18px}
/* the one-pager */
.mz-one{background:${C.paper};color:${C.ink}}
.mz-one-top{display:flex;justify-content:space-between;align-items:center;padding:36px 56px 20px}
.mz-one-top>span{font:500 9.5px ${SANS};letter-spacing:.3em;text-transform:uppercase;color:${C.muted}}
.mz-one-photo{height:250px;flex:none;margin:0 56px;display:flex;align-items:flex-end;padding:0 28px 22px;color:#fff}
.mz-one-photo h1{font:300 calc(50px * var(--mz-ds))/1 ${SERIF};margin:6px 0 0;letter-spacing:-.01em}.mz-one-photo h1 em{font-style:italic}
.mz-one-body{padding:22px 56px 0;display:flex;flex-direction:column;flex:1;min-height:0}
.mz-one-dek{font:italic 300 calc(19px * var(--mz-ds))/1.35 ${SERIF};color:${C.body};margin:0 0 16px}
.mz-one-table{width:100%;border-collapse:collapse;font:400 12px ${SANS};color:${C.body}}
.mz-one-table th{font:600 9.5px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.muted};text-align:left;padding:0 10px 7px 0;border-bottom:1.25px solid ${C.ink}}
.mz-one-table td{padding:6px 10px 6px 0;border-bottom:1px solid ${C.grid};vertical-align:middle;white-space:nowrap;font-variant-numeric:tabular-nums lining-nums}
.mz-one-table td:first-child{white-space:normal}.mz-one-table td b{font-weight:600;color:${C.ink}}
.mz-one-table td span{display:block;font-size:10.5px;color:${C.muted};margin-top:1px}
.mz-one-table .r{text-align:right}.mz-one-table th:last-child,.mz-one-table td:last-child{padding-right:0}
.mz-one-note{font:italic 400 11px/1.45 ${TEXT};color:${C.muted};margin:8px 0 0}
.mz-one-points{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:20px}
.mz-one-points>div{border-top:1px solid ${C.ink};padding-top:10px}
.mz-one-points b{display:block;font:300 calc(26px * var(--mz-ds))/1.05 ${SERIF};color:${C.ink}}
.mz-one-points span{display:block;margin-top:5px;font:400 11.5px/1.4 ${SANS};color:${C.body}}
.mz-one-foot{margin-top:auto;display:grid;grid-template-columns:1fr auto;gap:24px;align-items:end;border-top:1px solid ${C.grid};padding-top:18px}
.mz-one-cta h2{font:300 calc(30px * var(--mz-ds))/1.05 ${SERIF};margin:0;color:${C.ink}}.mz-one-cta h2 em{font-style:italic;color:${C.sandText}}
.mz-one-card{display:flex;gap:12px;align-items:center}.mz-one-card img{width:58px;height:58px;border-radius:999px;object-fit:cover;filter:grayscale(1)}
.mz-one-card div{display:flex;flex-direction:column;font:400 11.5px/1.45 ${SANS};color:${C.body}}.mz-one-card b{font:400 calc(18px * var(--mz-ds)) ${SERIF};color:${C.ink}}
.mz-one-fine{font:400 8.5px/1.45 ${SANS};color:${C.muted};margin:14px 0 30px}
.mz-lockup-wrap{position:relative;display:inline-flex}
.mz-logo-x{position:absolute;top:-10px;right:-12px;width:20px;height:20px;border-radius:999px;border:0;background:#C0392B;color:#fff;font:600 13px/20px "Inter",sans-serif;cursor:pointer;opacity:0;transition:opacity .15s}
.mz-lockup-wrap:hover .mz-logo-x{opacity:1}
@media print{.mz-logo-x{display:none}}
.mz-logo-ctl{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.mz-logo-prev{display:inline-flex;align-items:center;justify-content:center;height:44px;min-width:90px;padding:6px 10px;border:1px solid #E3DED3;border-radius:8px;background:#fff}
.mz-logo-prev img{max-height:32px;max-width:140px;object-fit:contain}
.mz-logo-none{font:400 12px "Inter",sans-serif;color:#80859A}
.mz-logo-ctl button{font:600 12px "Inter",sans-serif;border:1px solid #E3DED3;background:#fff;color:#B03A2E;border-radius:8px;padding:6px 10px;cursor:pointer}
.mz-logo-url{width:100%;font:500 12.5px "Inter",sans-serif;border:1px solid #E3DED3;border-radius:8px;padding:7px 9px;color:#0F1640;background:#fff}.mz-lockup i{width:1px;height:34px;background:${C.ink};opacity:.35}
.mz-lockup-b{max-width:130px;max-height:38px;object-fit:contain;filter:brightness(0);opacity:.82}
.mz-lockup-dark i{background:#fff}.mz-lockup-dark .mz-lockup-b{filter:brightness(0) invert(1);opacity:.9}
.mz-icover-photo{margin-top:36px;height:488px;flex:none}
.mz-icover-main{text-align:center;margin-top:40px}
.mz-icover-brand{max-width:150px;max-height:44px;object-fit:contain;filter:brightness(0);opacity:.85;display:block;margin:0 auto 18px}
.mz-icover-kick{font:400 10px ${SANS};letter-spacing:.36em;text-transform:uppercase;color:${C.muted};margin:0 0 16px}
.mz-icover-title{font:300 calc(80px * var(--mz-ds))/.92 ${SERIF};letter-spacing:-.01em;margin:0;color:${C.ink};text-wrap:balance}
.mz-icover-title em{display:block;font-style:italic;font-weight:300}
.mz-icover-rule{display:block;width:40px;height:1px;background:${C.ink};margin:26px auto 22px}
.mz-icover-dek{font:italic 300 calc(19px * var(--mz-ds))/1.4 ${SERIF};color:${C.body};margin:0 auto;max-width:26em}
.mz-icover-foot{margin-top:auto;display:flex;justify-content:space-between;font:400 9.5px ${SANS};letter-spacing:.3em;text-transform:uppercase;color:${C.muted}}
.mz-cover-dek{font:300 calc(22px * var(--mz-ds))/1.4 ${SERIF};max-width:22em;color:rgba(255,255,255,.94);margin:24px 0 0}
.mz-cover-for{font:500 10px ${SANS};letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.82);margin:32px 0 0;padding-top:16px;border-top:1px solid rgba(255,255,255,.45)}

/* contents */
.mz-contents{display:grid;grid-template-columns:300px 1fr;gap:48px;flex:1;margin:0 0 0 -72px;min-height:0}
.mz-contents-photo{background-size:cover;background-position:center;margin-top:-40px}
.mz-contents-r{display:flex;flex-direction:column;padding-bottom:32px}
.mz-toc{list-style:none;padding:0;margin:32px 0 0;border-top:1px solid ${C.ink}}
.mz-toc li{display:flex;gap:20px;align-items:baseline;padding:24px 0;border-bottom:1px solid ${C.grid}}
.mz-toc-n{font:300 calc(48px * var(--mz-ds))/1 ${SERIF};color:${C.sand};min-width:62px;letter-spacing:-.02em}
.mz-toc b{display:block;font:400 calc(24px * var(--mz-ds)) ${SERIF};color:${C.ink}}
.mz-toc li div span{display:block;font:400 14px/1.45 ${TEXT};color:${C.muted};margin-top:6px}
.mz-note{margin-top:48px}
.mz-note-text{font:italic 300 16px/1.6 ${TEXT};color:${C.body}}
.mz-sign{display:flex;gap:14px;align-items:center;margin-top:20px}
.mz-sign img{width:56px;height:56px;border-radius:999px;object-fit:cover;object-position:50% 22%;filter:grayscale(1) contrast(1.06)}
.mz-sign b{display:block;font:400 calc(18px * var(--mz-ds)) ${SERIF};color:${C.ink}}
.mz-sign span{display:block;font:600 10px ${SANS};letter-spacing:.18em;text-transform:uppercase;color:${C.muted};margin-top:4px}

/* who we are */
.mz-about-photo{height:600px;background-size:cover;background-position:center;display:flex;flex-direction:column;justify-content:space-between;flex:none}
.mz-about-head{padding:0 72px 48px}
.mz-about-head .mz-h{max-width:11em}
.mz-about-grid{display:grid;grid-template-columns:1fr 176px;gap:48px;align-items:end}
.mz-about-grid .mz-lead{margin-top:0}
.mz-about-note{margin:0}
.mz-stats{display:grid;margin-top:32px;border-top:1px solid ${C.ink}}
.mz-stats>div{padding:20px 20px 0;border-left:1px solid ${C.grid}}.mz-stats>div:first-child{border-left:0;padding-left:0}
.mz-stats b{display:block;font:300 calc(48px * var(--mz-ds))/1 ${SERIF};color:${C.ink};letter-spacing:-.02em;font-variant-numeric:lining-nums}
.mz-stats b.long{font-size:22px;line-height:1.2;letter-spacing:0}
.mz-stats span{display:block;margin-top:12px;font:600 10px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${C.muted}}

/* team */
.mz-team{display:grid;gap:32px 24px;margin-top:40px;justify-items:center;text-align:center}
.mz-team-3{grid-template-columns:repeat(3,1fr)}.mz-team-4{grid-template-columns:repeat(4,1fr)}
.mz-team figure{margin:0;display:flex;flex-direction:column;align-items:center}
/* One treatment for every portrait: the same circle, the same crop on the face, the same tone, so
   headshots shot against a restaurant, a grey wall and a white wall read as one matched set. */
.mz-team img,.mz-team .mz-initials{width:144px;height:144px;border-radius:999px;object-fit:cover;object-position:50% 22%;display:block;filter:grayscale(1) contrast(1.06) brightness(1.03);box-shadow:0 0 0 1px ${C.grid},0 0 0 7px ${C.warm},0 0 0 8px ${C.grid}}
.mz-initials{display:grid;place-items:center;background:${C.navy};color:${C.glow};font:300 calc(40px * var(--mz-ds)) ${SERIF}}
.mz-team figcaption{margin-top:20px}
.mz-team b{display:block;font:400 calc(20px * var(--mz-ds)) ${SERIF};color:${C.ink}}
.mz-team figcaption span{display:block;margin-top:6px;font:600 10px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${C.sandText}}
.mz-terms-wrap{margin-top:56px}
.mz-terms{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:0 40px;border-top:1px solid ${C.ink}}
.mz-terms>div{padding:16px 0;border-bottom:1px solid ${C.grid}}
.mz-terms dt{font:400 calc(20px * var(--mz-ds))/1.25 ${SERIF};color:${C.ink}}.mz-terms dd{margin:6px 0 0;font:400 14px/1.5 ${TEXT}}

/* how we manage */
.mz-split-page{display:grid;grid-template-columns:304px 1fr;grid-template-rows:100%;flex-direction:row}
.mz-split-photo{background-size:cover;background-position:center;position:relative}
.mz-split-text{display:flex;flex-direction:column;min-width:0}
.mz-run-tight{margin:48px 64px 0 48px}
.mz-split-body{padding:40px 64px 0 48px;display:flex;flex-direction:column}
.mz-practice{list-style:none;padding:0;margin:32px 0 0;border-top:1px solid ${C.ink}}
.mz-practice li{display:grid;grid-template-columns:44px 1fr;gap:4px;padding:18px 0;border-bottom:1px solid ${C.grid}}
.mz-practice li>span{font:300 calc(22px * var(--mz-ds)) ${SERIF};color:${C.sand}}
.mz-practice b{display:block;font:400 calc(20px * var(--mz-ds))/1.25 ${SERIF};color:${C.ink}}
.mz-practice p{font:400 14px/1.5 ${TEXT};margin:6px 0 0}
.mz-foot-tight{margin:auto 64px 44px 48px}

/* technology */
.mz-tools{margin-top:32px;border-top:1px solid ${C.ink}}
.mz-tool{display:grid;grid-template-columns:200px 1fr;gap:32px;padding:13px 0;border-bottom:1px solid ${C.grid};align-items:baseline}
.mz-tool-l b{display:block;font:400 calc(26px * var(--mz-ds)) ${SERIF};color:${C.ink};letter-spacing:-.01em}
.mz-tool-l span{display:block;margin-top:6px;font:600 10px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${C.sandText}}
.mz-tool p{font:400 14.5px/1.5 ${TEXT};margin:0}
.mz-channels{margin-top:32px}
.mz-channels>p:not(.mz-kicker){font:300 calc(22px * var(--mz-ds))/1.5 ${SERIF};color:${C.ink};margin:0}
.mz-channels i{font-style:normal;color:${C.sand};margin:0 10px}
.mz-plus{color:${C.muted}}

/* openers */
.mz-opener{flex:1;background-size:cover;background-position:center;color:#fff;padding:52px 72px 72px;display:flex;flex-direction:column;justify-content:space-between}
.mz-opener-title{font-family:${SERIF};font-weight:300;font-size:calc(64px * var(--mz-ds));line-height:1;letter-spacing:-.02em;margin:0;max-width:10em;text-wrap:balance}

/* partner */
.mz-partner{display:grid;grid-template-columns:1fr 232px;gap:40px}
.mz-cards{margin-top:32px;border-top:1px solid ${C.ink}}
.mz-cards>div{padding:12px 0;border-bottom:1px solid ${C.grid}}
.mz-cards b{font:400 calc(20px * var(--mz-ds))/1.25 ${SERIF};color:${C.ink}}.mz-cards p{font:400 14px/1.5 ${TEXT};margin:6px 0 0}
.mz-fees{background:${C.navy};color:#fff;padding:32px 28px;display:flex;flex-direction:column;align-self:start;margin-top:20px}
.mz-fees .mz-kicker{margin:0 0 8px}
.mz-fee{padding:16px 0;border-bottom:1px solid rgba(255,255,255,.2)}
.mz-fee b{display:block;font:300 calc(44px * var(--mz-ds))/1 ${SERIF};letter-spacing:-.02em}
.mz-fee>span{display:block;margin-top:8px;font:600 10px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.78)}
.mz-fees>p:not(.mz-kicker){font:italic 400 13px/1.5 ${TEXT};color:rgba(255,255,255,.85);margin:20px 0 0}
.mz-steps{list-style:none;padding:0;margin:0;display:grid;gap:24px;align-items:start}
.mz-steps-4{grid-template-columns:repeat(4,1fr)}.mz-steps-3{grid-template-columns:repeat(3,1fr)}
.mz-steps li{border-top:1px solid ${C.ink};padding-top:12px}
.mz-steps li>span{font:300 calc(24px * var(--mz-ds))/1 ${SERIF};color:${C.sand}}
.mz-steps b{display:block;font:400 calc(17px * var(--mz-ds))/1.2 ${SERIF};color:${C.ink};margin-top:6px}
.mz-steps-4 b{min-height:0}
.mz-qa>div:last-child:nth-child(odd){grid-column:1/-1}
.mz-steps p{font:400 13px/1.42 ${TEXT};margin:5px 0 0}
.mz-partner+.mz-kicker{margin-top:30px}.mz-qa+.mz-kicker{margin-top:20px}

/* second option */
.mz-qa{display:grid;grid-template-columns:1fr 1fr;gap:0 40px;margin-top:18px;border-top:1px solid ${C.ink}}
.mz-qa>div{padding:8px 0;border-bottom:1px solid ${C.grid}}
.mz-q{font:italic 400 calc(17px * var(--mz-ds)) ${SERIF};color:${C.ink};margin:0}
.mz-a{font:400 13px/1.42 ${TEXT};margin:4px 0 0}

/* market */
.mz-cols{display:grid;grid-template-columns:1fr 1fr;gap:0 40px;margin-top:24px;border-top:1px solid ${C.ink}}
.mz-col-item{padding:11px 0;border-bottom:1px solid ${C.grid}}
.mz-col-item b{font:400 calc(18px * var(--mz-ds)) ${SERIF};color:${C.ink}}.mz-col-item p{font:400 13px/1.42 ${TEXT};margin:4px 0 0}
.mz-comps{margin-top:22px}
.mz-table{width:100%;border-collapse:collapse;font:400 11px ${SANS};color:${C.body}}
.mz-table th{font:600 10px ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${C.muted};text-align:left;padding:0 14px 8px 12px;border-bottom:1.25px solid ${C.ink};vertical-align:bottom}
.mz-table td{padding:5px 12px 5px 12px;height:32px;border-bottom:1px solid ${C.grid};vertical-align:middle;line-height:1.35;font-variant-numeric:tabular-nums lining-nums;white-space:nowrap}
.mz-table td:first-child{white-space:normal;width:44%}
.mz-table th:first-child,.mz-table td:first-child{padding-left:12px}
.mz-table.mz-dense td{height:26px;padding-top:3px;padding-bottom:3px}
.mz-table td b{font-weight:600;color:${C.ink}}
.mz-table .r{text-align:right}
.mz-table th:last-child,.mz-table td:last-child{padding-right:0}
.mz-table tr.mz-us td{background:${C.sandSoft};border-top:1.25px solid ${C.ink};border-bottom:1.25px solid ${C.ink};font-weight:600;color:${C.ink}}
.mz-table tr.mz-us td:first-child{box-shadow:inset 3px 0 0 ${C.sand}}
.mz-table tr.mz-us td:last-child{padding-right:8px}

/* at a glance: dumbbells on one continuous grid */
.mz-gl{margin-top:24px}
.mz-gl-head,.mz-gl-row{display:grid;grid-template-columns:184px 1fr 156px;gap:20px;align-items:center}
.mz-gl.with-yield .mz-gl-head,.mz-gl.with-yield .mz-gl-row{grid-template-columns:184px 1fr 148px 84px}
.mz-gl-head{font:600 10px ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${C.muted};padding-bottom:10px;border-bottom:1.25px solid ${C.ink}}
.mz-gl-head .r{text-align:right}
.mz-gl-axis{position:relative;height:12px;letter-spacing:0;font-weight:500;text-transform:none}
.mz-gl-axis i{position:absolute;transform:translateX(-50%);font-style:normal;white-space:nowrap}
.mz-gl-axis i:first-child{transform:none}
.mz-gl-rows{position:relative}
.mz-gl-gridlayer{position:absolute;top:0;bottom:0;left:204px;right:0;pointer-events:none}
.mz-gl.with-yield .mz-gl-gridlayer{right:272px}
.mz-gl:not(.with-yield) .mz-gl-gridlayer{right:176px}
.mz-gl-gridlayer s{position:absolute;top:0;bottom:0;width:1px;background:${C.grid}}
.mz-gl-row{position:relative;padding:10px 0;border-bottom:1px solid ${C.grid}}
.mz-gl-name b{display:block;font:400 calc(18px * var(--mz-ds)) ${SERIF};color:${C.ink};white-space:nowrap}
.mz-gl-name span{display:block;font:400 11.5px/1.35 ${TEXT};color:${C.muted};white-space:nowrap}
.mz-gl-track{position:relative;height:24px}
.mz-gl-track i{position:absolute;top:10.5px;height:3px;background:${C.navy}}
.mz-gl-track em{position:absolute;top:7px;width:10px;height:10px;margin-left:-5px;border-radius:999px;background:${C.navy}}
.mz-gl-v{text-align:right}
.mz-gl-v b{display:block;font:400 16px ${TEXT};color:${C.ink};font-variant-numeric:tabular-nums lining-nums;white-space:nowrap}
.mz-gl-v span{display:block;font:400 12px ${TEXT};color:${C.muted};margin-top:2px;white-space:nowrap}
.mz-gl-y{text-align:right;font:400 14px ${TEXT};color:${C.ink};font-variant-numeric:tabular-nums lining-nums;white-space:nowrap}
.mz-read{margin-top:24px}
.mz-read p{font:italic 400 13px/1.55 ${TEXT};color:${C.muted};margin:0;max-width:46em}

/* floor plan */
.mz-plan-name{font-size:calc(40px * var(--mz-ds));line-height:1.05;letter-spacing:-.01em}
.mz-plan-sub{font:italic 300 calc(18px * var(--mz-ds))/1.4 ${SERIF};color:${C.muted};margin:8px 0 0;padding-bottom:18px;border-bottom:1px solid ${C.grid}}
.mz-plan-sub .mz-ed{display:inline}
.mz-facts{margin:20px 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));border-top:1px solid ${C.ink};border-bottom:1px solid ${C.grid}}
.mz-facts>div{padding:12px 16px;border-left:1px solid ${C.grid}}.mz-facts>div:first-child{border-left:0;padding-left:0}
.mz-facts dt{font:600 10px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.muted}}
.mz-facts dd{margin:6px 0 0;font:400 calc(17px * var(--mz-ds)) ${SERIF};color:${C.ink};font-variant-numeric:lining-nums}
.mz-hero{margin-top:22px}
.mz-hero span{display:block;font:600 10px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${C.sandText}}
.mz-hero b{display:block;font:300 calc(62px * var(--mz-ds))/1 ${SERIF};color:${C.ink};letter-spacing:-.025em;margin-top:12px;font-variant-numeric:lining-nums;white-space:nowrap}
.mz-hero b i{font-style:normal;margin:0 .12em;color:${C.muted}}
.mz-hero small{display:block;margin-top:10px;font:italic 400 13px ${TEXT};color:${C.muted}}
.mz-row3{margin:20px 0 0;display:grid;grid-template-columns:repeat(3,1fr);gap:0 20px}
.mz-row3>div{border-top:1px solid ${C.ink};padding-top:12px}
.mz-row3 dt{font:600 10px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.muted}}
.mz-row3 dd{margin:8px 0 0;font:400 calc(24px * var(--mz-ds)) ${SERIF};color:${C.ink};white-space:nowrap;font-variant-numeric:lining-nums;letter-spacing:-.01em}
.mz-row3 small{display:block;margin-top:4px;font:italic 400 12px ${TEXT};color:${C.muted}}
.mz-chart-head{display:flex;justify-content:space-between;align-items:baseline;margin-top:24px}
.mz-chart-head .mz-kicker{margin-bottom:12px}
.mz-legend{display:flex;align-items:center;gap:7px;font:600 10px ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${C.muted};margin:0}
.mz-legend i{display:inline-block;width:12px;height:8px;background:${C.navy}}
.mz-legend-line i{width:18px;height:0;background:none;border-top:1.3px solid ${C.ink}}.mz-legend-line i.lo{border-top:1px dotted ${C.muted}}.mz-legend-line i.hi{opacity:1}
.mz-legend i.lo{opacity:1}.mz-legend i.hi{opacity:.3;margin-left:10px}
.mz-plan-comps,.mz-comps{margin-top:28px}
.mz-how{font:italic 400 12.5px/1.5 ${TEXT};color:${C.muted};margin:12px 0 0}
.mz-how>b{font:italic 500 13px ${TEXT};color:${C.ink}}
.mz-how div.mz-ed{display:inline}

/* back cover */
.mz-backcover{background-size:cover;background-position:center;color:#fff;padding:56px 72px 0;justify-content:space-between}
.mz-back-main{display:flex;flex-direction:column;margin-top:auto;padding-bottom:48px}
.mz-back-title{font-family:${SERIF};font-weight:300;font-size:calc(72px * var(--mz-ds));line-height:1;letter-spacing:-.025em;margin:0;max-width:9em;text-wrap:balance}
.mz-back-title em{color:${C.glow}}
.mz-back-dek{font:300 calc(20px * var(--mz-ds))/1.5 ${SERIF};color:rgba(255,255,255,.92);max-width:26em;margin:24px 0 0}
.mz-contact{display:flex;gap:24px;align-items:center;margin-top:40px;padding-top:28px;border-top:1px solid rgba(255,255,255,.4)}
.mz-contact img,.mz-initials-l{width:112px;height:112px;border-radius:999px;object-fit:cover;object-position:50% 22%;flex:none;box-shadow:0 0 0 1px rgba(255,255,255,.4),0 0 0 7px rgba(255,255,255,.08)}
.mz-initials-l{display:grid;font-size:calc(30px * var(--mz-ds))}
.mz-contact b{display:block;font:400 calc(28px * var(--mz-ds)) ${SERIF}}
.mz-contact div>span{display:block;font:400 15px ${TEXT};color:rgba(255,255,255,.92);margin-top:4px}
.mz-contact .mz-contact-role{font:600 10px ${SANS};letter-spacing:.18em;text-transform:uppercase;color:${C.glow};margin:6px 0 10px}
.mz-sel{user-select:all}
.mz-fine{margin:0 -72px;padding:20px 72px 36px;background:rgba(22,19,16,.88);font:400 10.5px/1.55 ${SANS};color:rgba(255,255,255,.82)}

/* editing */
.mz-overfull{position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:6;margin:0;font:600 11.5px ${SANS};background:#B4232F;color:#fff;border-radius:999px;padding:6px 12px;white-space:nowrap}
@media print{.mz-overfull{display:none}}
.mz-ed{outline:1px dashed rgba(58,91,217,.55);outline-offset:2px;border-radius:2px;cursor:text;min-width:1ch}
div.mz-ed{display:block}
.mz-ed:hover{background:rgba(58,91,217,.07)}
.mz-ed:focus{outline:2px solid #3A5BD9;background:rgba(255,255,255,.95);color:#0F1640}
.mz-ed:empty::before{content:attr(data-ph);opacity:.45}
.mz-adjust{position:absolute;top:36px;right:64px;z-index:5;font:600 11.5px ${SANS};background:${C.navy};color:#fff;border:0;border-radius:999px;padding:7px 13px;cursor:pointer;box-shadow:0 6px 18px rgba(10,14,40,.25)}

/* drawer */
.mz-drawer{position:fixed;top:56px;right:0;bottom:0;z-index:30;width:min(480px,100vw);background:#fff;box-shadow:-18px 0 50px rgba(10,14,40,.18);padding:16px 20px 24px;overflow-y:auto;font-family:${SANS};color:#0F1640}
.mz-drawer-head{display:flex;justify-content:space-between;align-items:center}
.mz-drawer-head b{font:400 22px Newsreader, Georgia, serif}
.mz-drawer-head button{border:0;background:none;font-size:calc(24px * var(--mz-ds));line-height:1;color:#80859A;cursor:pointer}
.mz-seg{display:grid;grid-template-columns:repeat(4,1fr);background:#F1F0EC;border-radius:10px;padding:3px;margin-top:12px}
.mz-seg button{font:600 11.5px ${SANS};border:0;background:none;border-radius:8px;padding:7px 2px;color:#4b5068;cursor:pointer}
.mz-seg button.on{background:#fff;color:#0F1640;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.mz-drawer-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.mz-drawer-tabs button{font:600 11.5px ${SANS};padding:5px 10px;border-radius:999px;border:1px solid #E3DED3;background:#fff;color:#0F1640;cursor:pointer}
.mz-drawer-tabs button.on{background:#111A4A;color:#fff;border-color:#111A4A}
.mz-drawer-all{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;margin-top:14px;padding:10px 12px;background:#FAF7F1;border-radius:10px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#80859A}
.mz-drawer-all input{accent-color:#111A4A}.mz-drawer-all b{color:#0F1640;font-size:13px;letter-spacing:0}
.mz-drawer-plan{font:300 26px Newsreader, Georgia, serif;margin:18px 0 8px}
.mz-form{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px;margin-top:14px}
.mz-form label{display:flex;flex-direction:column;gap:3px;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#80859A;min-width:0}
.mz-form .wide{grid-column:1/-1}
.mz-form input,.mz-form select,.mz-slot input,.mz-brand input{width:100%;font:500 13px ${SANS};text-transform:none;letter-spacing:0;color:#0F1640;border:1px solid #E3DED3;border-radius:8px;padding:7px 9px;background:#fff;min-width:0}
.mz-form-h{grid-column:1/-1;font:700 10.5px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:#80859A;margin:18px 0 6px}
.mz-checks{display:flex;flex-wrap:wrap;gap:6px 14px}
.mz-checks>span{flex-basis:100%;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#80859A}
.mz-checks label{flex-direction:row;align-items:center;gap:5px;font-size:12px;font-weight:500;text-transform:none;letter-spacing:0;color:#0F1640}
.mz-comp{padding:12px;border:1px solid #E3DED3;border-radius:12px}
.mz-remove{display:block;font:600 11.5px ${SANS};color:#B4232F;background:none;border:0;text-align:left;padding:8px 0 0;cursor:pointer}
.mz-add{margin-top:12px;font:600 12.5px ${SANS};border:1px dashed #B59A6A;background:#FAF7F1;color:#0F1640;border-radius:10px;padding:9px;width:100%;cursor:pointer}
.mz-swatches{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.mz-sw-page{border-radius:6px;border:1px solid rgba(0,0,0,.08);overflow:hidden;width:100%;aspect-ratio:4/3;display:flex;flex-direction:column}
.mz-sw-band{height:38%;position:relative}.mz-sw-band b{position:absolute;left:8px;bottom:6px;width:16px;height:2px}
.mz-sw-page p{margin:5px 8px 0;font-size:17px;line-height:1}.mz-sw-page p i{font-style:italic}
.mz-sw-page span{margin:auto 8px 7px;height:7px;border-radius:2px;border:1px solid}
.mz-swatches em small{font-weight:400;color:#80859A;font-size:11px}
.mz-swatches button{display:flex;flex-direction:column;align-items:stretch;gap:6px;font:600 12px "Inter",sans-serif;color:#0F1640;background:#fff;border:1px solid #E3DED3;border-radius:10px;padding:7px;cursor:pointer;text-align:left}
.mz-swatches button em{font-style:normal;font-size:12px;font-weight:600}
.mz-swatches button.on{border-color:#0F1640;box-shadow:0 0 0 1px #0F1640}
.mz-swatches span{display:flex}.mz-swatches i{width:20px;height:20px;border-radius:999px;margin-right:-5px;border:2px solid #fff}
.mz-colors{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.mz-color{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:11px;color:#4b5068}
.mz-color input{width:44px;height:30px;border:1px solid #E3DED3;border-radius:8px;padding:2px;background:#fff;cursor:pointer}
.mz-brand{display:flex;gap:8px}.mz-brand button{flex:none;font:600 12.5px ${SANS};background:#111A4A;color:#fff;border:0;border-radius:8px;padding:0 14px;cursor:pointer}
.mz-slot{padding:10px 0;border-bottom:1px solid #EEE9DF}
.mz-aud{display:grid;gap:6px;margin-bottom:6px}
.mz-aud button{display:flex;flex-direction:column;gap:2px;text-align:left;border:1px solid #E3DED3;border-radius:10px;background:#fff;padding:8px 10px;cursor:pointer;color:#0F1640}
.mz-aud button b{font:600 12.5px ${SANS}}.mz-aud button span{font:400 11.5px/1.35 ${SANS};color:#5A6080}
.mz-aud button.on{border-color:#111A4A;box-shadow:inset 0 0 0 1px #111A4A;background:#F4F6FC}
.mz-psearch{margin:0 0 10px}
.mz-psearch form{display:flex;gap:6px}
.mz-psearch input{flex:1;min-width:0;font:500 13px ${SANS};color:#0F1640;border:1px solid #E3DED3;border-radius:8px;padding:7px 9px;background:#fff}
.mz-psearch form button{font:600 12px ${SANS};border:0;border-radius:8px;background:#111A4A;color:#fff;padding:0 12px;cursor:pointer}
.mz-psearch-to{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0 6px;font:500 11.5px ${SANS};color:#5A6080}
.mz-psearch-to select{font:500 12px ${SANS};border:1px solid #E3DED3;border-radius:8px;padding:4px 6px;background:#fff;color:#0F1640}
.mz-psearch-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;max-height:300px;overflow-y:auto}
.mz-psearch-grid button{display:flex;flex-direction:column;gap:2px;background:none;border:0;padding:0;cursor:pointer;text-align:left;min-width:0}
.mz-psearch-grid i{display:block;aspect-ratio:4/3;border-radius:6px;background-size:cover;background-position:center;border:2px solid transparent}
.mz-psearch-grid button.on i{border-color:#111A4A}
.mz-psearch-grid span{font:500 9.5px ${SANS};color:#5A6080;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mz-ph{position:relative;isolation:isolate;overflow:hidden;background:none}
.mz-ph::before{content:"";position:absolute;inset:var(--pi,0);background:var(--ph) var(--pp,center)/cover no-repeat;filter:var(--pf,none);transform:var(--pt,none);z-index:-2;pointer-events:none}
.mz-ph::after{content:"";position:absolute;inset:0;background:var(--pg,none);z-index:-1;pointer-events:none}
.mz-looks{display:grid;grid-template-columns:repeat(6,1fr);gap:5px;margin:8px 0 6px}
.mz-looks button{display:flex;flex-direction:column;gap:3px;align-items:center;font:500 9.5px ${SANS};color:#0F1640;background:none;border:0;padding:0;cursor:pointer;text-align:center;line-height:1.15}
.mz-looks i{position:relative;display:block;width:100%;aspect-ratio:1;border-radius:6px;background-size:cover;background-position:center;border:2px solid transparent;overflow:hidden}
.mz-looks i b{position:absolute;inset:0}
.mz-looks button.on i{border-color:#111A4A}
.mz-fx{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;font:600 11px ${SANS};color:#5A6080}
.mz-fx label{display:flex;align-items:center;gap:6px}
.mz-fx input[type=range]{width:84px;accent-color:#111A4A}
.mz-fx button{font:600 11px ${SANS};padding:4px 9px;border:1px solid #E3DED3;border-radius:999px;background:#fff;color:#0F1640;cursor:pointer}
.mz-rights{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
.mz-rights select{font:500 12px ${SANS};border:1px solid #E3DED3;border-radius:8px;padding:6px 7px;background:#fff;color:#0F1640;min-width:0}
.mz-rights select.warn{border-color:#D9A441;background:#FFF8E8}
.mz-rights-warn{font:500 12px/1.45 ${SANS};color:#7A5410;background:#FFF5DE;border:1px solid #F0D49A;border-radius:8px;padding:8px 10px;margin:0 0 6px}
.mz-slot>span{display:block;font:600 12px ${SANS};margin-bottom:6px}
.mz-thumbs{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin-bottom:6px}
.mz-thumbs button{aspect-ratio:1;background-size:cover;background-position:center;border:2px solid transparent;border-radius:6px;cursor:pointer;padding:0}
.mz-thumbs button.on{border-color:#111A4A}
.mz-toggle{display:flex;align-items:center;gap:8px;font-size:13px;margin:8px 0 0;color:#0F1640}
.mz-drawer-note,.mz-drawer-empty{font-size:12px;color:#80859A;margin:12px 0 0;line-height:1.5}
.mz-drawer-foot{margin-top:18px;padding-top:14px;border-top:1px solid #E3DED3;display:flex;flex-wrap:wrap;gap:8px;align-items:center;position:sticky;bottom:-24px;background:#fff;padding-bottom:14px}
.mz-drawer-foot button{font:600 12.5px ${SANS};background:#111A4A;color:#fff;border:0;border-radius:999px;padding:8px 16px;cursor:pointer}
.mz-drawer-foot button:disabled{opacity:.45;cursor:default}
.mz-drawer-foot .mz-ghost-d{background:#fff;color:#0F1640;border:1px solid #E3DED3}
.mz-drawer-foot p{flex-basis:100%;font-size:11px;color:#80859A;margin:2px 0 0}

@media screen and (max-width:760px){
  .mz-bar-top{padding:8px 10px;gap:6px}.mz-bar-top>.mz-run-mark{display:none}
  .mz-bar-r{flex-wrap:nowrap;gap:6px}.mz-bar-top button{padding:6px 10px;font-size:11.5px;white-space:nowrap}
  .mz-switch a,.mz-switch b{padding:5px 8px;font-size:11.5px}
  .mz-wide{display:none}
.mz-root:not(.mz-flipping) .mz-with-drawer{padding-right:16px}
.mz-root:not(.mz-flipping) .mz-page{height:auto;min-height:0;width:100%}
.mz-root:not(.mz-flipping) .mz-body{padding:24px 20px 0}.mz-root:not(.mz-flipping) .mz-run,.mz-root:not(.mz-flipping) .mz-foot{margin-left:20px;margin-right:20px}
.mz-root:not(.mz-flipping) .mz-cover,.mz-root:not(.mz-flipping) .mz-backcover,.mz-root:not(.mz-flipping) .mz-opener{min-height:86vh;padding:28px 20px}
.mz-root:not(.mz-flipping) .mz-cover-title{font-size:calc(64px * var(--mz-ds))}.mz-root:not(.mz-flipping) .mz-opener-title{font-size:calc(42px * var(--mz-ds))}.mz-root:not(.mz-flipping) .mz-hero b{font-size:calc(40px * var(--mz-ds));white-space:normal}.mz-root:not(.mz-flipping) .mz-back-title{font-size:calc(48px * var(--mz-ds))}
.mz-root:not(.mz-flipping) .mz-display{font-size:calc(40px * var(--mz-ds))}.mz-root:not(.mz-flipping) .mz-h1,.mz-root:not(.mz-flipping) .mz-plan-name{font-size:calc(34px * var(--mz-ds))}
.mz-root:not(.mz-flipping) .mz-about-photo{height:440px}.mz-root:not(.mz-flipping) .mz-about-head{padding:0 20px 28px}
.mz-root:not(.mz-flipping) .mz-split-page{display:flex;flex-direction:column}.mz-root:not(.mz-flipping) .mz-split-photo{height:280px}.mz-root:not(.mz-flipping) .mz-run-tight,.mz-root:not(.mz-flipping) .mz-split-body,.mz-root:not(.mz-flipping) .mz-foot-tight{margin-left:20px;margin-right:20px;padding-left:0;padding-right:0}
.mz-root:not(.mz-flipping) .mz-about-grid,.mz-root:not(.mz-flipping) .mz-partner,.mz-root:not(.mz-flipping) .mz-team-3,.mz-root:not(.mz-flipping) .mz-team-4,.mz-root:not(.mz-flipping) .mz-terms,.mz-root:not(.mz-flipping) .mz-qa,.mz-root:not(.mz-flipping) .mz-cols,.mz-root:not(.mz-flipping) .mz-steps-4,.mz-root:not(.mz-flipping) .mz-steps-3,.mz-root:not(.mz-flipping) .mz-contents,.mz-root:not(.mz-flipping) .mz-row3,.mz-root:not(.mz-flipping) .mz-tool{grid-template-columns:1fr}
.mz-root:not(.mz-flipping) .mz-contents{margin:0}.mz-root:not(.mz-flipping) .mz-contents-photo{margin:0}
.mz-root:not(.mz-flipping) .mz-gl-head{display:none}.mz-root:not(.mz-flipping) .mz-gl-gridlayer{display:none}.mz-root:not(.mz-flipping) .mz-gl-row,.mz-root:not(.mz-flipping) .mz-gl.with-yield .mz-gl-row{grid-template-columns:1fr;gap:6px}.mz-root:not(.mz-flipping) .mz-gl-v,.mz-root:not(.mz-flipping) .mz-gl-y{text-align:left}
.mz-root:not(.mz-flipping) .mz-contents-photo{min-height:240px}
.mz-root:not(.mz-flipping) .mz-stats,.mz-root:not(.mz-flipping) .mz-facts{grid-template-columns:1fr 1fr}
.mz-root:not(.mz-flipping) .mz-table{display:block;overflow-x:auto}
.mz-root:not(.mz-flipping) .mz-glance-head{display:none}.mz-root:not(.mz-flipping) .mz-glance-row,.mz-root:not(.mz-flipping) .mz-glance.with-yield .mz-glance-row{grid-template-columns:1fr;gap:6px}.mz-root:not(.mz-flipping) .mz-glance-v,.mz-root:not(.mz-flipping) .mz-glance-y{text-align:left}
.mz-root:not(.mz-flipping) .mz-earn-main b{font-size:calc(36px * var(--mz-ds));white-space:normal}
.mz-root:not(.mz-flipping) .mz-adjust{top:12px;right:12px}
}
@page{size:letter;margin:0}
@media print{
  .mz-root{background:#fff;padding:0!important}.mz-bar-top,.mz-adjust,.mz-drawer{display:none!important}
  .mz-ed{outline:none!important;background:none!important}
  .mz-page{margin:0;box-shadow:none;page-break-after:always;break-after:page}
  .mz-page:last-child{page-break-after:auto;break-after:auto}
}
`
