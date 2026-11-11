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
export type MagTheme = { label: string; ink: string; body: string; muted: string; navy: string; sand: string; sandSoft: string; warm: string; rule: string; glow: string; desk: string; display?: string; displayUrl?: string }
export const MAG_THEMES: Record<string, MagTheme> = {
  classic: { label: 'Classic navy', ink: '#0F1640', body: '#3A4055', muted: '#7D8296', navy: '#111A4A', sand: '#A88B5A', sandSoft: '#F2ECE1', warm: '#F9F6F0', rule: '#E2DDD2', glow: '#E8D6B0', desk: '#E6E2DA' },
  coastal: { label: 'Coastal', ink: '#0D2B33', body: '#33474C', muted: '#788B90', navy: '#0E4A57', sand: '#C07A50', sandSoft: '#F6E8DD', warm: '#F3F7F6', rule: '#D9E4E3', glow: '#F2C9A8', desk: '#DFE8E7' },
  noir: { label: 'Noir and gold', ink: '#111111', body: '#3A3A3A', muted: '#86837E', navy: '#141414', sand: '#A3854B', sandSoft: '#F1EBDF', warm: '#F7F5F0', rule: '#E2DED6', glow: '#DCC28A', desk: '#E4E1DB' },
  ivory: { label: 'Ivory and olive', ink: '#1F241C', body: '#43493E', muted: '#868A7D', navy: '#2F3A28', sand: '#9A7B4F', sandSoft: '#EFE9DC', warm: '#F8F5EE', rule: '#E2DDD0', glow: '#E3D3AE', desk: '#E5E1D6' },
}
const C = { ink: 'var(--mz-ink)', body: 'var(--mz-body)', muted: 'var(--mz-muted)', navy: 'var(--mz-navy)', sand: 'var(--mz-sand)', sandText: 'var(--mz-sandtext)', sandSoft: 'var(--mz-sandsoft)', warm: 'var(--mz-warm)', rule: 'var(--mz-rule)', grid: 'var(--mz-grid)', glow: 'var(--mz-glow)', desk: 'var(--mz-desk)', paper: '#FFFFFF' }
const SERIF_DEFAULT = '"Newsreader", "Iowan Old Style", "Baskerville", Georgia, serif'
const SERIF = 'var(--mz-display)'
const SANS = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif'
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
})
export type ChartKind = 'bars' | 'band' | 'cumulative'
const CHARTS: [ChartKind, string][] = [['bars', 'Bars'], ['band', 'Range band'], ['cumulative', 'Running total']]
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
const CHART_H = 190, CHART_MIN = 120
function Chart({ months, kind, h = CHART_H }: { months: { lo: number; hi: number }[]; kind: ChartKind; h?: number }) {
  // Information-design audit (2026-11-11): one column per month, not paired bars — solid to the low
  // end, lighter from low to high, so it reads "at least X, up to Y". Four gridlines, axis labels
  // sitting on them at the left (FT style), and values only where the eye needs them: peak and trough.
  const W = 688, H = h, T = 22, B = 24, L = 40
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
export function SalesMagazine({ report, canEdit }: { report: Any; canEdit?: boolean }) {
  const original: Any = report.content || {}
  const [doc, setDoc] = useState<Any>(() => structuredClone(original))
  const [touched, setTouched] = useState<string[]>([])
  const [editText, setEditText] = useState(false)
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
  useEffect(() => { setChartH({}) }, [doc])
  useEffect(() => {
    const id = setTimeout(() => {
      const next: Record<string, number> = {}
      document.querySelectorAll('.mz-page[data-k^="plan-"]').forEach(el => {
        const k = String((el as HTMLElement).dataset.k)
        const body = el.querySelector('.mz-body') as HTMLElement | null, foot = el.querySelector('.mz-foot') as HTMLElement | null
        const svg = el.querySelector('svg.mz-chart-svg') as SVGElement | null
        const last = body?.lastElementChild as HTMLElement | null
        if (!body || !foot || !svg || !last) return
        const over = last.getBoundingClientRect().bottom - foot.getBoundingClientRect().top + 6
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
  const styleKey = mag.style === 'custom' && custom ? 'custom' : MAG_THEMES[mag.style] ? mag.style : 'classic'
  const theme: MagTheme = styleKey === 'custom' && custom ? custom : MAG_THEMES[styleKey]
  const chart: ChartKind = (['bars', 'band', 'cumulative'] as ChartKind[]).includes(mag.chart) ? mag.chart : 'bars'
  // NO UNIT PRICES (Jon, 2026-11-11: "noticed cost of units, remove that, don't need that"). The
  // starting price, and the gross yield worked from it, no longer print anywhere in the package.
  const showYield = false
  const showNet = !!mag.net
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
    coverDek: cma ? (aud === 'owner' ? `Your residence in ${area || 'Miami'}, and what it can return.` : aud === 'agents' ? `Every floor plan, and what it can return.` : `A residence in ${area || 'Miami'}, and what it can return.`) : String(hero.headline || 'How we manage revenue, tools and team around the success of your property.'),
    note: cma
      ? (aud === 'owner'
        ? `This is what a home at ${short(building) || 'your building'} could earn, built from comparable homes we run nearby, and how we would run it for you: the team, the standard and the technology behind it.`
        : aud === 'agents'
          ? `Every buyer asks the same first question: what will it earn? This package answers it for every floor plan${building ? ' at ' + short(building) : ''}, from one comparable set, so you can share a range with your clients before they make an offer. It also shows who we are and how we run a home.`
          : `Every buyer${building ? ' at ' + short(building) : ''} asks the same first question: what will it earn? This package answers it for every floor plan, from one comparable set, so a buyer sees a range before they make an offer. It also shows who we are, how we run a home, and the technology behind it.`)
      : 'Thank you for your time. This is how we would run your property: the revenue, the tools and the team around it, and what happens from the day you sign.',
    aboutHead: 'Stay-managed homes earn *20% more* than the market.',
    aboutDek: 'Full-service short-term rental management for owners across Miami and South Florida. One local team, priced every night, listed everywhere guests book.',
    aboutNote: 'On average; results vary by unit, building and season.',
    teamHead: 'The team on your building, *with 24/7 guest care*',
    manageHead: 'How we run a home',
    manageDek: 'Our own team, our own standard, on every stay.',
    techHead: 'Priced every day. Listed everywhere. *Reported every month.*',
    techDek: (tools.slice(0, 5).length > 1 ? (['', '', 'Two', 'Three', 'Four', 'Five'][tools.slice(0, 5).length] + ' systems working together, so') : 'One system, so') + ' pricing, distribution, housekeeping and reporting run on data rather than guesswork.',
    workTitle: showPartner ? (aud === 'agents' ? 'For agents, and the buyers they bring' : 'For the sales team, and the buyers they bring') : aud === 'owner' ? 'If you are weighing your options' : 'For buyers who ask for options',
    numbersTitle: plans.length > 1 ? `${['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'][plans.length] || plans.length} floor plans. *One question, answered.*` : 'What a home at ' + (short(building) || 'this building') + ' could earn',
    glanceHead: 'At a glance',
    marketHead: `${area || 'The market'}, *by the night.*`,
    glanceDek: 'Estimated gross rental revenue in a full year, once the listing is established. Each line runs from the low end of the year to the high end.',
    backTitle: 'Book a call *to learn more.*',
    backDek: cma ? `A short call${presenterFirst ? ' with ' + presenterFirst : ''} to walk through these projections, the terms, and how we would run a home${building ? ' at ' + short(building) : ''}.` : `A short call${presenterFirst ? ' with ' + presenterFirst : ''} to walk through the numbers, the terms and the onboarding, and answer every question before you decide.`,
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
  if (showPage('about')) add({ key: 'about', kind: 'page', section: 'Who we are', render: () => null })
  if (showPage('team') && (team.length || terms.length)) add({ key: 'team', kind: 'page', section: 'Who we are', tone: 'warm', render: () => null })
  if (showPage('manage') && ops.length) add({ key: 'manage', kind: 'page', section: 'How we manage', render: () => null })
  if (showPage('tech') && tools.length) add({ key: 'tech', kind: 'page', section: 'Our technology', render: () => null })
  if (cma && (showPartner || showSecond)) {
    add({ key: 'op-work', kind: 'opener', section: 'Working together', render: () => null })
    if (showPartner) add({ key: 'partner', kind: 'page', section: 'Agent partner program', render: () => null })
    if (showSecond) add({ key: 'second', kind: 'page', section: 'Owner options', render: () => null })
  }
  if (cma && (showMarket || showGlance || plans.length)) {
    add({ key: 'op-num', kind: 'opener', section: 'The numbers', render: () => null })
    if (showMarket) add({ key: 'market', kind: 'page', section: 'The market', render: () => null })
    if (showGlance) add({ key: 'glance', kind: 'page', section: 'Every floor plan', tone: 'warm', render: () => null })
    for (const p of plans) add({ key: 'plan-' + p.id, kind: 'page', section: 'Rental comparison', render: () => null })
  }
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
      <div className="mz-opener mz-ph" style={ph(slot, 'linear-gradient(180deg, rgba(6,10,30,.30) 0%, rgba(6,10,30,0) 28%, rgba(6,10,30,.08) 52%, rgba(6,10,30,.84) 100%)')}>
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

  const render = (s: Spec): React.ReactNode => {
    switch (true) {
      case s.key === 'cover': return (
        <section key="cover" className="mz-page mz-cover mz-ph" style={ph('cover', 'linear-gradient(180deg, rgba(6,10,30,.66) 0%, rgba(6,10,30,.10) 26%, rgba(6,10,30,.04) 50%, rgba(6,10,30,.86) 100%)', 'center 40%')}>
          <div className="mz-mast">
            <img src="/stay-logo.png" alt="Stay Hospitality" className="mz-logo" />
            <div className="mz-mast-r"><span>{cma ? AUDIENCES[audienceOf(c.audience)].mast : 'Management Proposal'}</span><span>{monthYear}</span></div>
          </div>
          <div className="mz-cover-main">
            {brandLogo ? <img src={brandLogo} alt="" className="mz-brandlogo" /> : null}
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
          <div className="mz-about-photo mz-ph" style={ph('about', 'linear-gradient(180deg, rgba(6,10,30,.05) 30%, rgba(6,10,30,.78) 100%)')}>
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
              {kicker('The people')}
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
              {kicker('How we work together')}
              <dl className="mz-terms">{terms.map(r => <div key={r.i}><dt><E v={r.k} p={`terms.rows.${r.i}.k`} /></dt><dd><E v={r.v} p={`terms.rows.${r.i}.v`} block /></dd></div>)}</dl>
            </div>
          ) : null}
        </>
      ), { section: 'Who we are', tone: 'warm' })
      case s.key === 'manage': return (
        <section key="manage" data-k="manage" className="mz-page mz-split-page">
          {canEdit && overfull.includes('manage') ? <p className="mz-overfull">This page is too full to print. Shorten a passage or hide a section.</p> : null}
          {gfx('manage')
            ? <div className="mz-split-photo"><StayTimeline steps={ops} /></div>
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
            {kicker('Where your home is listed')}
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
              {kicker('Referral fees, in writing', true)}
              {cma!.partner.fees.map(([a, w], i) => <div key={i} className="mz-fee"><b><E v={a} p={`cma.partner.fees.${i}.0`} /></b><span><E v={w} p={`cma.partner.fees.${i}.1`} /></span></div>)}
              <p><E v={cma!.partner.feeNote} p="cma.partner.feeNote" block /></p>
            </aside>
          </div>
          {kicker('How it works')}
          <ol className="mz-steps mz-steps-4">{cma!.partner.steps.map(([k, v], i) => <li key={i}><span>{two(i + 1)}</span><b><E v={k} p={`cma.partner.steps.${i}.0`} /></b><p><E v={v} p={`cma.partner.steps.${i}.1`} block /></p></li>)}</ol>
        </>
      ), { section: 'Agent partner program' })
      case s.key === 'second' && !!cma: return frame('second', (
        <>
          {kicker('For buyers who ask for options')}
          <h2 className="mz-h mz-h1">{building ? <>Stay as a second option at <em>{short(building)}</em></> : 'Stay as a second option'}</h2>
          <p className="mz-lead mz-lead-xs"><E v={cma!.second.choose} p="cma.second.choose" block /></p>
          <div className="mz-qa">{cma!.second.qa.map(([q, a], i) => <div key={i}><p className="mz-q"><E v={q} p={`cma.second.qa.${i}.0`} /></p><p className="mz-a"><E v={a} p={`cma.second.qa.${i}.1`} block /></p></div>)}</div>
          {kicker('How we would get a unit ready')}
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
            <div className="mz-comps">{kicker('The comparable set used across this package')}{compsTable(cma!.comps, null, bases.length > 1)}{bases.length === 1 ? <p className="mz-source">Every comparable: {bases[0].replace(/^./, m => m.toLowerCase())}.</p> : null}</div>
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
          ['Per month, on average', dash(n.monthLo, n.monthHi), 'the year divided by twelve'],
          ['Peak month', 'up to ' + money(n.peak), n.peakMonth + ', high end'],
          showNet ? ['Owner keeps, est.', dash(netOf(n.lo), netOf(n.hi)), 'a year, after fees'] : ['Nightly rate' + (p.suites > 1 ? ', per suite' : ''), dash(n.nightlyLo, n.nightlyHi), 'at ' + pctRange(p.occLo, p.occHi) + ' occupancy'],
        ]
        return frame(s.key, (
          <>
            {canEdit ? <button type="button" className="mz-adjust" onClick={() => { setTuneId(p.id); setDrawer('proj') }}>Adjust projection</button> : null}
            {kicker((short(building) ? short(building) + ' · ' : '') + 'Rental projection')}
            <h2 className="mz-h mz-plan-name"><E v={p.name} p={`cma.plans.${pi}.name`} /></h2>
            <dl className="mz-facts">
              <div><dt>Interior</dt><dd><E v={p.sf} p={`cma.plans.${pi}.sf`} /></dd></div>
              <div><dt>Rental rules</dt><dd><E v={p.rules} p={`cma.plans.${pi}.rules`} /></dd></div>
            </dl>
            <div className="mz-hero">
              <span>Could earn in a year, once established</span>
              <b>{money(n.lo)}<i>–</i>{money(n.hi)}</b>
              <small>Gross rental revenue, before channel fees and the management fee</small>
            </div>
            <dl className="mz-row3">{row3.map(([l, v, sm], i) => <div key={i}><dt>{l}</dt><dd>{v}</dd><small>{sm}</small></div>)}</dl>
            <div className="mz-chart-head">
              {kicker(chart === 'cumulative' ? 'The year, as it adds up' : 'Through the year')}
              <p className="mz-legend"><i className="lo" /> Low end <i className="hi" /> High end</p>
            </div>
            <Chart months={n.months} kind={chart} h={chartH['plan-' + p.id]} />
            <p className="mz-source">Seasonal shape from Miami market pricing data.</p>
            <div className="mz-comps">
              {kicker('Against the comparable set')}
              {compsTable(comps, (
                <tr className="mz-us"><td><b>{(short(building) ? short(building) + ' ' : '') + p.name}</b></td><td>{area ? area + ', new build' : 'New build'}</td><td className="r"><b>{dash(n.lo, n.hi)}</b></td><td className="r"><b>{dash(n.nightlyLo, n.nightlyHi)}</b></td><td className="r"><b>{pctRange(p.occLo, p.occHi).replace(' to ', '–')}</b></td></tr>
              ))}
              <p className="mz-how"><b>How we got there.</b> <E v={p.how} p={`cma.plans.${pi}.how`} block /> {n.manual ? 'The range was set by hand.' : `Ranges are then raised ${cma!.uplift.lo}% at the low end and ${cma!.uplift.hi}% at the high end, ${cma!.uplift.why}`} {adjustLine(cma!, p)}{showNet ? ` Owner estimate after ${channelPct}% channel fees and a ${mgmtPct}% management fee.` : ''}</p>
            </div>
          </>
        ), { section: 'Rental projection' })
      }
      case s.key === 'back': return (
        <section key="back" className="mz-page mz-backcover mz-ph" style={ph('back', 'linear-gradient(180deg, rgba(6,10,30,.55) 0%, rgba(6,10,30,.80) 45%, rgba(6,10,30,.95) 100%)')}>
          <img src="/stay-logo.png" alt="Stay Hospitality" className="mz-logo" />
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
          <button type="button" className="mz-add" onClick={() => setCma({ ...cma, comps: [...cma.comps, { id: newId(), name: 'New comparable', market: '', basis: 'Stay projection, fully ramped', lo: 0, hi: 0, nightlyLo: 0, nightlyHi: 0, occLo: 70, occHi: 75 }] })}>+ Add a comparable</button>
          <p className="mz-drawer-note">Every range built from a comparable moves as soon as its low or high changes.</p>
        </>
      ) : <p className="mz-drawer-empty">This deck has no comparables yet.</p>)}

      {drawer === 'pages' && (
        <div>
          {cma ? (
            <>
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
              <button key={k} type="button" className={styleKey === k ? 'on' : ''} onClick={() => setMag({ style: k })}>
                <span><i style={{ background: t.navy }} /><i style={{ background: t.sand }} /><i style={{ background: t.warm, border: '1px solid ' + t.rule }} /></span>
                <em style={{ fontFamily: t.display ? `"${t.display}", serif` : 'Newsreader, serif' }}>{t.label}</em>
              </button>
            ))}
          </div>
          <p className="mz-form-h">Fine-tune colours</p>
          <div className="mz-colors">{color('navy', 'Primary')}{color('sand', 'Accent')}{color('ink', 'Headlines')}{color('warm', 'Tint pages')}</div>
          {custom?.display ? <p className="mz-drawer-note">Headlines in {custom.display}, from the building’s site.</p> : null}
          {brandLogo ? <label className="mz-toggle"><input type="checkbox" checked onChange={() => setMag({ brandLogo: '' })} /> The building’s logo on the cover</label> : null}
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
    <div className={'mz-root' + (canEdit && editText ? ' mz-editing' : '') + (drawer ? ' mz-with-drawer' : '')} style={themeVars(theme)}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,300;1,6..72,400&family=Josefin+Sans:wght@300;400&family=Inter:wght@400;500;600;700&display=swap" />
      {theme.displayUrl ? <link rel="stylesheet" href={theme.displayUrl} /> : null}
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <nav className="mz-bar-top">
        <span className="mz-run-mark mz-on-dark">STAY</span>
        <span className="mz-switch"><b>Magazine</b><a href={keynote}>Keynote</a></span>
        <span className="mz-bar-r">
          {canEdit ? <button type="button" className={'mz-ghost' + (editText ? ' on' : '')} onClick={() => setEditText(x => !x)}>{editText ? 'Done editing' : 'Edit text'}</button> : null}
          {canEdit ? <button type="button" className={'mz-ghost' + (drawer ? ' on' : '')} onClick={() => setDrawer(d => d ? null : 'proj')}>Builder</button> : null}
          {dirty ? <button type="button" onClick={save}>Save changes</button> : saving ? <span className="mz-saved">{saving}</span> : null}
          <button type="button" onClick={() => window.print()}>Print or save PDF</button>
        </span>
      </nav>
      {drawerEl}
      {specs.map(render)}
    </div>
  )
}

const CSS = `
/* THE TYPE SYSTEM (editorial audit, 2026-11-11). One serif with optical sizes for display, figures and
   reading text; Inter only for labels, tables and chart axes; nothing below 10px. Spacing on one scale:
   8, 12, 20, 32, 48, 72. Margins 72px; a 672px live area. */
.mz-root{background:${C.desk};min-height:100vh;padding:80px 16px 64px;font-family:${SERIF};color:${C.body};-webkit-print-color-adjust:exact;print-color-adjust:exact;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased;font-optical-sizing:auto}
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
.mz-folio{font:400 15px ${SERIF};letter-spacing:.04em;color:${C.ink}}

/* type */
.mz-kicker{font:600 10px ${SANS};letter-spacing:.22em;text-transform:uppercase;color:${C.sandText};margin:0 0 16px;display:flex;align-items:center;gap:12px}
.mz-kicker::before{content:"";width:28px;height:1px;background:currentColor}
.mz-kicker.mz-on-dark{color:${C.glow}}
.mz-h{font-family:${SERIF};font-weight:300;color:${C.ink};margin:0;text-wrap:balance}
.mz-h em,.mz-cover-title em,.mz-back-title em,.mz-opener-title em{font-style:italic;font-weight:300}
.mz-display{font-size:60px;line-height:1;letter-spacing:-.02em}
.mz-h1{font-size:48px;line-height:1.04;letter-spacing:-.015em}
.mz-on-dark{color:#fff}
.mz-lead{font:300 20px/1.45 ${SERIF};color:${C.body};margin:20px 0 0;max-width:30em}
.mz-lead-s{font-size:19px}
.mz-lead-xs{font-size:16.5px;line-height:1.5;max-width:36em}
.mz-small{font:italic 400 12px/17px ${SERIF};color:${C.muted}}
.mz-caption{position:absolute;left:24px;bottom:20px;margin:0;font:italic 400 12px ${SERIF};color:rgba(255,255,255,.9);text-shadow:0 1px 8px rgba(0,0,0,.45)}
.mz-caption-top{position:static;align-self:flex-end}
.mz-body>svg,.mz-body svg[role=img]{flex:none}
.mz-source{font:italic 400 11.5px/1.5 ${SERIF};color:${C.muted};margin:8px 0 0}

/* cover */
.mz-cover{background-size:cover;background-position:center 40%;color:#fff;padding:52px 72px 60px;justify-content:space-between}
.mz-mast{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:1px solid rgba(255,255,255,.45)}
.mz-logo{width:150px;filter:brightness(0) invert(1)}
.mz-mast-r{display:flex;flex-direction:column;align-items:flex-end;gap:6px;font:500 10px ${SANS};letter-spacing:.24em;text-transform:uppercase;color:rgba(255,255,255,.92)}
.mz-brandlogo{max-width:180px;max-height:56px;object-fit:contain;filter:brightness(0) invert(1);margin-bottom:24px;display:block}
.mz-cover-title{font-family:${SERIF};font-weight:300;font-size:120px;line-height:.9;letter-spacing:-.03em;margin:4px 0 0;text-wrap:balance}
.mz-cover-title em{display:block}
.mz-cover-dek{font:300 22px/1.4 ${SERIF};max-width:22em;color:rgba(255,255,255,.94);margin:24px 0 0}
.mz-cover-for{font:500 10px ${SANS};letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.82);margin:32px 0 0;padding-top:16px;border-top:1px solid rgba(255,255,255,.45)}

/* contents */
.mz-contents{display:grid;grid-template-columns:300px 1fr;gap:48px;flex:1;margin:0 0 0 -72px;min-height:0}
.mz-contents-photo{background-size:cover;background-position:center;margin-top:-40px}
.mz-contents-r{display:flex;flex-direction:column;padding-bottom:32px}
.mz-toc{list-style:none;padding:0;margin:32px 0 0;border-top:1px solid ${C.ink}}
.mz-toc li{display:flex;gap:20px;align-items:baseline;padding:24px 0;border-bottom:1px solid ${C.grid}}
.mz-toc-n{font:300 48px/1 ${SERIF};color:${C.sand};min-width:62px;letter-spacing:-.02em}
.mz-toc b{display:block;font:400 24px ${SERIF};color:${C.ink}}
.mz-toc li div span{display:block;font:400 14px/1.45 ${SERIF};color:${C.muted};margin-top:6px}
.mz-note{margin-top:48px}
.mz-note-text{font:italic 300 16px/1.6 ${SERIF};color:${C.body}}
.mz-sign{display:flex;gap:14px;align-items:center;margin-top:20px}
.mz-sign img{width:56px;height:56px;border-radius:999px;object-fit:cover;object-position:50% 22%;filter:grayscale(1) contrast(1.06)}
.mz-sign b{display:block;font:400 18px ${SERIF};color:${C.ink}}
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
.mz-stats b{display:block;font:300 48px/1 ${SERIF};color:${C.ink};letter-spacing:-.02em;font-variant-numeric:lining-nums}
.mz-stats b.long{font-size:22px;line-height:1.2;letter-spacing:0}
.mz-stats span{display:block;margin-top:12px;font:600 10px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${C.muted}}

/* team */
.mz-team{display:grid;gap:32px 24px;margin-top:40px;justify-items:center;text-align:center}
.mz-team-3{grid-template-columns:repeat(3,1fr)}.mz-team-4{grid-template-columns:repeat(4,1fr)}
.mz-team figure{margin:0;display:flex;flex-direction:column;align-items:center}
/* One treatment for every portrait: the same circle, the same crop on the face, the same tone, so
   headshots shot against a restaurant, a grey wall and a white wall read as one matched set. */
.mz-team img,.mz-team .mz-initials{width:144px;height:144px;border-radius:999px;object-fit:cover;object-position:50% 22%;display:block;filter:grayscale(1) contrast(1.06) brightness(1.03);box-shadow:0 0 0 1px ${C.grid},0 0 0 7px ${C.warm},0 0 0 8px ${C.grid}}
.mz-initials{display:grid;place-items:center;background:${C.navy};color:${C.glow};font:300 40px ${SERIF}}
.mz-team figcaption{margin-top:20px}
.mz-team b{display:block;font:400 20px ${SERIF};color:${C.ink}}
.mz-team figcaption span{display:block;margin-top:6px;font:600 10px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${C.sandText}}
.mz-terms-wrap{margin-top:56px}
.mz-terms{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:0 40px;border-top:1px solid ${C.ink}}
.mz-terms>div{padding:16px 0;border-bottom:1px solid ${C.grid}}
.mz-terms dt{font:400 20px/1.25 ${SERIF};color:${C.ink}}.mz-terms dd{margin:6px 0 0;font:400 14px/1.5 ${SERIF}}

/* how we manage */
.mz-split-page{display:grid;grid-template-columns:304px 1fr;flex-direction:row}
.mz-split-photo{background-size:cover;background-position:center;position:relative}
.mz-split-text{display:flex;flex-direction:column;min-width:0}
.mz-run-tight{margin:48px 64px 0 48px}
.mz-split-body{padding:40px 64px 0 48px;display:flex;flex-direction:column}
.mz-practice{list-style:none;padding:0;margin:32px 0 0;border-top:1px solid ${C.ink}}
.mz-practice li{display:grid;grid-template-columns:44px 1fr;gap:4px;padding:18px 0;border-bottom:1px solid ${C.grid}}
.mz-practice li>span{font:300 22px ${SERIF};color:${C.sand}}
.mz-practice b{display:block;font:400 20px/1.25 ${SERIF};color:${C.ink}}
.mz-practice p{font:400 14px/1.5 ${SERIF};margin:6px 0 0}
.mz-foot-tight{margin:auto 64px 44px 48px}

/* technology */
.mz-tools{margin-top:32px;border-top:1px solid ${C.ink}}
.mz-tool{display:grid;grid-template-columns:200px 1fr;gap:32px;padding:18px 0;border-bottom:1px solid ${C.grid};align-items:baseline}
.mz-tool-l b{display:block;font:400 26px ${SERIF};color:${C.ink};letter-spacing:-.01em}
.mz-tool-l span{display:block;margin-top:6px;font:600 10px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${C.sandText}}
.mz-tool p{font:400 14.5px/1.5 ${SERIF};margin:0}
.mz-channels{margin-top:32px}
.mz-channels>p:not(.mz-kicker){font:300 22px/1.5 ${SERIF};color:${C.ink};margin:0}
.mz-channels i{font-style:normal;color:${C.sand};margin:0 10px}
.mz-plus{color:${C.muted}}

/* openers */
.mz-opener{flex:1;background-size:cover;background-position:center;color:#fff;padding:52px 72px 72px;display:flex;flex-direction:column;justify-content:space-between}
.mz-opener-title{font-family:${SERIF};font-weight:300;font-size:64px;line-height:1;letter-spacing:-.02em;margin:0;max-width:10em;text-wrap:balance}

/* partner */
.mz-partner{display:grid;grid-template-columns:1fr 232px;gap:40px}
.mz-cards{margin-top:32px;border-top:1px solid ${C.ink}}
.mz-cards>div{padding:16px 0;border-bottom:1px solid ${C.grid}}
.mz-cards b{font:400 20px/1.25 ${SERIF};color:${C.ink}}.mz-cards p{font:400 14px/1.5 ${SERIF};margin:6px 0 0}
.mz-fees{background:${C.navy};color:#fff;padding:32px 28px;display:flex;flex-direction:column;align-self:start;margin-top:20px}
.mz-fees .mz-kicker{margin:0 0 8px}
.mz-fee{padding:16px 0;border-bottom:1px solid rgba(255,255,255,.2)}
.mz-fee b{display:block;font:300 44px/1 ${SERIF};letter-spacing:-.02em}
.mz-fee>span{display:block;margin-top:8px;font:600 10px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.78)}
.mz-fees>p:not(.mz-kicker){font:italic 400 13px/1.5 ${SERIF};color:rgba(255,255,255,.85);margin:20px 0 0}
.mz-steps{list-style:none;padding:0;margin:0;display:grid;gap:24px;align-items:start}
.mz-steps-4{grid-template-columns:repeat(4,1fr)}.mz-steps-3{grid-template-columns:repeat(3,1fr)}
.mz-steps li{border-top:1px solid ${C.ink};padding-top:12px}
.mz-steps li>span{font:300 30px ${SERIF};color:${C.sand}}
.mz-steps b{display:block;font:400 18px/1.25 ${SERIF};color:${C.ink};margin-top:8px}
.mz-steps-4 b{min-height:46px}
.mz-qa>div:last-child:nth-child(odd){grid-column:1/-1}
.mz-steps p{font:400 13.5px/1.45 ${SERIF};margin:6px 0 0}
.mz-partner+.mz-kicker{margin-top:48px}.mz-qa+.mz-kicker{margin-top:24px}

/* second option */
.mz-qa{display:grid;grid-template-columns:1fr 1fr;gap:0 40px;margin-top:24px;border-top:1px solid ${C.ink}}
.mz-qa>div{padding:10px 0;border-bottom:1px solid ${C.grid}}
.mz-q{font:italic 400 17px ${SERIF};color:${C.ink};margin:0}
.mz-a{font:400 13px/1.42 ${SERIF};margin:4px 0 0}

/* market */
.mz-cols{display:grid;grid-template-columns:1fr 1fr;gap:0 40px;margin-top:24px;border-top:1px solid ${C.ink}}
.mz-col-item{padding:11px 0;border-bottom:1px solid ${C.grid}}
.mz-col-item b{font:400 18px ${SERIF};color:${C.ink}}.mz-col-item p{font:400 13px/1.42 ${SERIF};margin:4px 0 0}
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
.mz-gl-name b{display:block;font:400 18px ${SERIF};color:${C.ink};white-space:nowrap}
.mz-gl-name span{display:block;font:400 11.5px/1.35 ${SERIF};color:${C.muted};white-space:nowrap}
.mz-gl-track{position:relative;height:24px}
.mz-gl-track i{position:absolute;top:10.5px;height:3px;background:${C.navy}}
.mz-gl-track em{position:absolute;top:7px;width:10px;height:10px;margin-left:-5px;border-radius:999px;background:${C.navy}}
.mz-gl-v{text-align:right}
.mz-gl-v b{display:block;font:400 16px ${SERIF};color:${C.ink};font-variant-numeric:tabular-nums lining-nums;white-space:nowrap}
.mz-gl-v span{display:block;font:400 12px ${SERIF};color:${C.muted};margin-top:2px;white-space:nowrap}
.mz-gl-y{text-align:right;font:400 14px ${SERIF};color:${C.ink};font-variant-numeric:tabular-nums lining-nums;white-space:nowrap}
.mz-read{margin-top:24px}
.mz-read p{font:italic 400 13px/1.55 ${SERIF};color:${C.muted};margin:0;max-width:46em}

/* floor plan */
.mz-plan-name{font-size:40px;line-height:1.05;letter-spacing:-.01em}
.mz-facts{margin:20px 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));border-top:1px solid ${C.ink};border-bottom:1px solid ${C.grid}}
.mz-facts>div{padding:12px 16px;border-left:1px solid ${C.grid}}.mz-facts>div:first-child{border-left:0;padding-left:0}
.mz-facts dt{font:600 10px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.muted}}
.mz-facts dd{margin:6px 0 0;font:400 17px ${SERIF};color:${C.ink};font-variant-numeric:lining-nums}
.mz-hero{margin-top:22px}
.mz-hero span{display:block;font:600 10px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${C.sandText}}
.mz-hero b{display:block;font:300 62px/1 ${SERIF};color:${C.ink};letter-spacing:-.025em;margin-top:12px;font-variant-numeric:lining-nums;white-space:nowrap}
.mz-hero b i{font-style:normal;margin:0 .12em;color:${C.muted}}
.mz-hero small{display:block;margin-top:10px;font:italic 400 13px ${SERIF};color:${C.muted}}
.mz-row3{margin:20px 0 0;display:grid;grid-template-columns:repeat(3,1fr);gap:0 20px}
.mz-row3>div{border-top:1px solid ${C.ink};padding-top:12px}
.mz-row3 dt{font:600 10px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.muted}}
.mz-row3 dd{margin:8px 0 0;font:400 24px ${SERIF};color:${C.ink};white-space:nowrap;font-variant-numeric:lining-nums;letter-spacing:-.01em}
.mz-row3 small{display:block;margin-top:4px;font:italic 400 12px ${SERIF};color:${C.muted}}
.mz-chart-head{display:flex;justify-content:space-between;align-items:baseline;margin-top:24px}
.mz-chart-head .mz-kicker{margin-bottom:12px}
.mz-legend{display:flex;align-items:center;gap:7px;font:600 10px ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${C.muted};margin:0}
.mz-legend i{display:inline-block;width:12px;height:8px;background:${C.navy}}
.mz-legend i.lo{opacity:1}.mz-legend i.hi{opacity:.3;margin-left:10px}
.mz-plan-comps,.mz-comps{margin-top:28px}
.mz-how{font:italic 400 12.5px/1.5 ${SERIF};color:${C.muted};margin:12px 0 0}
.mz-how>b{font:italic 500 13px ${SERIF};color:${C.ink}}
.mz-how div.mz-ed{display:inline}

/* back cover */
.mz-backcover{background-size:cover;background-position:center;color:#fff;padding:56px 72px 0;justify-content:space-between}
.mz-back-main{display:flex;flex-direction:column;margin-top:auto;padding-bottom:48px}
.mz-back-title{font-family:${SERIF};font-weight:300;font-size:72px;line-height:1;letter-spacing:-.025em;margin:0;max-width:9em;text-wrap:balance}
.mz-back-title em{color:${C.glow}}
.mz-back-dek{font:300 20px/1.5 ${SERIF};color:rgba(255,255,255,.92);max-width:26em;margin:24px 0 0}
.mz-contact{display:flex;gap:24px;align-items:center;margin-top:40px;padding-top:28px;border-top:1px solid rgba(255,255,255,.4)}
.mz-contact img,.mz-initials-l{width:112px;height:112px;border-radius:999px;object-fit:cover;object-position:50% 22%;flex:none;box-shadow:0 0 0 1px rgba(255,255,255,.4),0 0 0 7px rgba(255,255,255,.08)}
.mz-initials-l{display:grid;font-size:30px}
.mz-contact b{display:block;font:400 28px ${SERIF}}
.mz-contact div>span{display:block;font:400 15px ${SERIF};color:rgba(255,255,255,.92);margin-top:4px}
.mz-contact .mz-contact-role{font:600 10px ${SANS};letter-spacing:.18em;text-transform:uppercase;color:${C.glow};margin:6px 0 10px}
.mz-sel{user-select:all}
.mz-fine{margin:0 -72px;padding:20px 72px 36px;background:rgba(6,10,30,.88);font:400 10.5px/1.55 ${SANS};color:rgba(255,255,255,.82)}

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
.mz-drawer-head button{border:0;background:none;font-size:24px;line-height:1;color:#80859A;cursor:pointer}
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
.mz-swatches{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.mz-swatches button{display:flex;align-items:center;gap:12px;font:600 12.5px ${SANS};color:#0F1640;background:#fff;border:1px solid #E3DED3;border-radius:10px;padding:10px 12px;cursor:pointer;text-align:left}
.mz-swatches button em{font-style:normal;font-size:15px;font-weight:400}
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
  .mz-with-drawer{padding-right:16px}
  .mz-page{height:auto;min-height:0;width:100%}
  .mz-body{padding:24px 20px 0}.mz-run,.mz-foot{margin-left:20px;margin-right:20px}
  .mz-cover,.mz-backcover,.mz-opener{min-height:86vh;padding:28px 20px}
  .mz-cover-title{font-size:64px}.mz-opener-title{font-size:42px}.mz-hero b{font-size:40px;white-space:normal}.mz-back-title{font-size:48px}
  .mz-display{font-size:40px}.mz-h1,.mz-plan-name{font-size:34px}
  .mz-about-photo{height:440px}.mz-about-head{padding:0 20px 28px}
  .mz-split-page{display:flex;flex-direction:column}.mz-split-photo{height:280px}.mz-run-tight,.mz-split-body,.mz-foot-tight{margin-left:20px;margin-right:20px;padding-left:0;padding-right:0}
  .mz-about-grid,.mz-partner,.mz-team-3,.mz-team-4,.mz-terms,.mz-qa,.mz-cols,.mz-steps-4,.mz-steps-3,.mz-contents,.mz-row3,.mz-tool{grid-template-columns:1fr}
  .mz-contents{margin:0}.mz-contents-photo{margin:0}
  .mz-gl-head{display:none}.mz-gl-gridlayer{display:none}.mz-gl-row,.mz-gl.with-yield .mz-gl-row{grid-template-columns:1fr;gap:6px}.mz-gl-v,.mz-gl-y{text-align:left}
  .mz-contents-photo{min-height:240px}
  .mz-stats,.mz-facts{grid-template-columns:1fr 1fr}
  .mz-table{display:block;overflow-x:auto}
  .mz-glance-head{display:none}.mz-glance-row,.mz-glance.with-yield .mz-glance-row{grid-template-columns:1fr;gap:6px}.mz-glance-v,.mz-glance-y{text-align:left}
  .mz-earn-main b{font-size:36px;white-space:normal}
  .mz-adjust{top:12px;right:12px}
}
@page{size:letter;margin:0}
@media print{
  .mz-root{background:#fff;padding:0!important}.mz-bar-top,.mz-adjust,.mz-drawer{display:none!important}
  .mz-ed{outline:none!important;background:none!important}
  .mz-page{margin:0;box-shadow:none;page-break-after:always;break-after:page}
  .mz-page:last-child{page-break-after:auto;break-after:auto}
}
`
