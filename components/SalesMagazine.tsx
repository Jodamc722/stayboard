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
import React, { useState } from 'react'
import { ProjectionTuner } from '@/components/ProjectionTuner'
import { STACK_TOOLS } from '@/lib/onboarding-copy'
import { SALES_TEAM_EXCLUDE } from '@/lib/sales-copy'
import { STAY_CONTACT } from '@/lib/need-list-contact'
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
const C = { ink: 'var(--mz-ink)', body: 'var(--mz-body)', muted: 'var(--mz-muted)', navy: 'var(--mz-navy)', sand: 'var(--mz-sand)', sandSoft: 'var(--mz-sandsoft)', warm: 'var(--mz-warm)', rule: 'var(--mz-rule)', glow: 'var(--mz-glow)', desk: 'var(--mz-desk)', paper: '#FFFFFF' }
const SERIF_DEFAULT = '"Fraunces", "Iowan Old Style", "Baskerville", Georgia, serif'
const SERIF = 'var(--mz-display)'
const SANS = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif'
const MARK = '"Josefin Sans", "Futura", "Avenir Next", system-ui, sans-serif'
const themeVars = (t: MagTheme): React.CSSProperties => ({
  ['--mz-ink' as Any]: t.ink, ['--mz-body' as Any]: t.body, ['--mz-muted' as Any]: t.muted, ['--mz-navy' as Any]: t.navy,
  ['--mz-sand' as Any]: t.sand, ['--mz-sandsoft' as Any]: t.sandSoft, ['--mz-warm' as Any]: t.warm, ['--mz-rule' as Any]: t.rule,
  ['--mz-glow' as Any]: t.glow, ['--mz-desk' as Any]: t.desk, ['--mz-display' as Any]: t.display ? `"${t.display}", ${SERIF_DEFAULT}` : SERIF_DEFAULT,
})
export type ChartKind = 'bars' | 'band' | 'cumulative'
const CHARTS: [ChartKind, string][] = [['bars', 'Bars'], ['band', 'Range band'], ['cumulative', 'Running total']]
const PAGES: [string, string][] = [['about', 'Who we are'], ['team', 'The team and terms'], ['manage', 'How we manage'], ['tech', 'Our technology']]
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
function Chart({ months, kind }: { months: { lo: number; hi: number }[]; kind: ChartKind }) {
  const W = 688, H = 250, L = 46, R = 8, T = 26, B = 28
  const series = kind === 'cumulative'
    ? months.reduce((acc: { lo: number; hi: number }[], m, i) => { const p = acc[i - 1] || { lo: 0, hi: 0 }; acc.push({ lo: p.lo + m.lo, hi: p.hi + m.hi }); return acc }, [])
    : months
  const max = Math.max(1, ...series.map(m => m.hi))
  const step = max > 80000 ? 25000 : max > 40000 ? 10000 : max > 16000 ? 5000 : max > 8000 ? 2500 : 1000
  const top = Math.ceil(max / step) * step
  const ch = H - T - B, cw = (W - L - R) / 12
  const y = (v: number) => T + ch - (v / top) * ch
  const ticks: number[] = []
  for (let v = 0; v <= top; v += step) ticks.push(v)
  const k$ = (v: number) => '$' + (v >= 100000 ? Math.round(v / 1000) : (v / 1000).toFixed(1)) + 'K'
  const cx = (i: number) => L + i * cw + cw / 2
  const grid = ticks.map(v => (
    <g key={v}>
      <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} style={{ stroke: v === 0 ? C.ink : C.rule }} strokeWidth={v === 0 ? 1 : 0.75} />
      <text x={L - 10} y={y(v) + 3.5} textAnchor="end" fontSize={10} style={{ fill: C.muted }} fontFamily={SANS}>{v === 0 ? '0' : '$' + v / 1000 + 'K'}</text>
    </g>
  ))
  const axis = MONTHS.map((m, i) => <text key={m} x={cx(i)} y={H - 8} textAnchor="middle" fontSize={10} style={{ fill: C.muted }} fontFamily={SANS} letterSpacing="0.08em">{m.toUpperCase()}</text>)
  if (kind === 'bars') {
    const bw = Math.min(14, cw * 0.27)
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Monthly gross rental income, low and high end">
        {grid}
        {months.map((m, i) => (
          <g key={i}>
            <rect x={cx(i) - bw - 1.5} y={y(m.lo)} width={bw} height={y(0) - y(m.lo)} style={{ fill: C.sand }} />
            <rect x={cx(i) + 1.5} y={y(m.hi)} width={bw} height={y(0) - y(m.hi)} style={{ fill: C.navy }} />
            <text x={cx(i) + 1.5 + bw / 2} y={y(m.hi) - 7} textAnchor="middle" fontSize={9.5} fontWeight={600} style={{ fill: C.ink }} fontFamily={SANS}>{k$(m.hi)}</text>
          </g>
        ))}
        {axis}
      </svg>
    )
  }
  const line = (k: 'lo' | 'hi') => series.map((m, i) => (i ? 'L' : 'M') + cx(i) + ' ' + y(m[k])).join(' ')
  const band = series.map((m, i) => (i ? 'L' : 'M') + cx(i) + ' ' + y(m.hi)).join(' ') + ' ' + series.slice().reverse().map((m, j) => 'L' + cx(11 - j) + ' ' + y(m.lo)).join(' ') + ' Z'
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={kind === 'cumulative' ? 'Running total of gross rental income through the year' : 'Monthly gross rental income range'}>
      {grid}
      <path d={band} style={{ fill: C.sand, opacity: 0.24 }} />
      <path d={line('lo')} style={{ fill: 'none', stroke: C.sand }} strokeWidth={1.6} />
      <path d={line('hi')} style={{ fill: 'none', stroke: C.navy }} strokeWidth={2.2} />
      {series.map((m, i) => (
        <g key={i}>
          <circle cx={cx(i)} cy={y(m.hi)} r={3.2} style={{ fill: C.navy }} />
          {(kind === 'band' || i === 11 || i % 3 === 2) ? <text x={cx(i)} y={y(m.hi) - 10} textAnchor="middle" fontSize={9.5} fontWeight={600} style={{ fill: C.ink }} fontFamily={SANS}>{k$(m.hi)}</text> : null}
        </g>
      ))}
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
  const dirty = touched.length > 0

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
  const showYield = mag.yield !== false
  const showNet = !!mag.net
  const channelPct = Number.isFinite(+mag.channelPct) ? +mag.channelPct : 15
  const mgmtPct = Number.isFinite(+mag.mgmtPct) ? +mag.mgmtPct : 15
  const netOf = (g: number) => Math.round(g * (1 - channelPct / 100) * (1 - mgmtPct / 100) / 100) * 100
  const hideMag: Record<string, boolean> = mag.hide || {}

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
  const photo = (slot: string) => String((mag.photos || {})[slot] || '').trim() || pool[(slotIdx[slot] || 0) % pool.length]
  const brandLogo = String(mag.brandLogo || '').trim()

  const rows = (a: Any): { k: string; v: string; i: number }[] => (Array.isArray(a) ? a : []).map((r: Any, i: number) => ({ k: String(r?.k || ''), v: String(r?.v || ''), i })).filter(r => r.k.trim() && r.v.trim())
  // A stat's figure is whichever side carries the digits: "450+" over "Units managed", whichever way the deck stored it.
  const stats = rows(c.overview && c.overview.stats).slice(0, 4).map(s => {
    const kd = /\d/.test(s.k), vd = /\d/.test(s.v)
    return kd && !vd ? { fig: s.k, lab: s.v, figP: 'k', labP: 'v', i: s.i } : { fig: s.v, lab: s.k, figP: 'v', labP: 'k', i: s.i }
  })
  const ops = rows(c.ops && c.ops.rows).slice(0, 6)
  const terms = rows(c.terms && c.terms.rows).slice(0, 6)
  // The sales team rule (lib/sales-copy SALES_TEAM_EXCLUDE), and the presenter always on the page.
  let team: { p: Any; i: number }[] = ((c.team && c.team.people) || []).map((p: Any, i: number) => ({ p: { ...p, photo: photoFor(p) }, i }))
    .filter((x: Any) => x.p && String(x.p.name || '').trim() && SALES_TEAM_EXCLUDE.indexOf(String(x.p.name).trim().toLowerCase()) < 0)
  if (card.name && !team.some(x => String(x.p.name).trim().toLowerCase() === String(card.name).trim().toLowerCase())) team = [...team, { p: { name: card.name, role: card.role, photo: card.photo }, i: -1 }]
  team = team.slice(0, 8)
  const tools: Any[] = ((c.stack && Array.isArray(c.stack.tools) && c.stack.tools.length ? c.stack.tools : STACK_TOOLS) as Any[]).filter((t: Any) => t && t.name)
  const toolsPath = c.stack && Array.isArray(c.stack.tools) && c.stack.tools.length ? 'stack.tools' : ''
  const channels: string[] = (c.channels && Array.isArray(c.channels.primary) && c.channels.primary.length ? c.channels.primary : ['Airbnb', 'Vrbo', 'Booking.com', 'Expedia', 'Homes & Villas by Marriott', 'Stay direct']).slice(0, 8)
  const channelCount = String((c.channels && c.channels.count) || '30+')
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

  const D = {
    coverDek: cma ? 'What every floor plan could earn, how we run a home, and why owners choose Stay.' : String(hero.headline || 'How we manage revenue, tools and team around the success of your property.'),
    note: cma
      ? `${building ? short(building) + ' is' : 'This building is'} one of the most anticipated openings in ${area || 'Miami'}, and every buyer will ask the same first question: what will it earn? This package answers it for every floor plan, from one comparable set, so a buyer sees a range before they make an offer. It also shows who we are, how we run a home, and the technology behind it.`
      : 'Thank you for your time. This is how we would run your property: the revenue, the tools and the team around it, and what happens from the day you sign.',
    aboutHead: 'Stay-managed homes earn *20% more* than the market.',
    aboutDek: 'Full-service short-term rental management for owners across Miami and South Florida. One local team, priced every night, listed everywhere guests book.',
    aboutNote: 'On average; results vary by unit, building and season.',
    teamHead: 'The people on your building',
    manageHead: 'How we run a home',
    manageDek: 'Our own team, our own standard, on every stay.',
    techHead: 'The technology behind *every booking*',
    techDek: 'Five systems working together, so pricing, distribution, housekeeping and reporting run on data rather than guesswork.',
    workTitle: showPartner ? 'For the sales team, and the buyers they bring' : 'For buyers who ask for options',
    numbersTitle: 'What a home at ' + (short(building) || 'this building') + ' could earn',
    glanceDek: 'Estimated gross rental revenue once fully ramped. Each bar runs from the low end to the high end of the year.',
    backTitle: cma ? 'Send us any floor plan. *We will send the numbers in 48 hours.*' : 'Let’s talk about *your property.*',
    backDek: cma ? 'A unit-level projection a buyer can hold before they make an offer, built from the same comparable set as this package.' : 'We will walk through the numbers, the terms and the onboarding, and answer every question before you decide.',
  }
  const T = (k: keyof typeof D) => (copy[k] != null && String(copy[k]).trim() ? String(copy[k]) : D[k])
  const CT = ({ k, block }: { k: keyof typeof D; block?: boolean }) => <E v={T(k)} p={'magazine.copy.' + k} rich block={block} />

  // ── page plan: decide the pages first, so folios and contents are right before anything renders ──
  type Spec = { key: string; section?: string; kind: 'cover' | 'page' | 'opener' | 'back'; render: (n: number) => React.ReactNode; tone?: 'paper' | 'warm' | 'dark' }
  const specs: Spec[] = []
  const add = (s: Spec) => specs.push(s)
  const kicker = (x: React.ReactNode, dark?: boolean) => <p className={'mz-kicker' + (dark ? ' mz-on-dark' : '')}>{x}</p>

  add({ key: 'cover', kind: 'cover', render: () => null })
  add({ key: 'contents', kind: 'page', section: 'Contents', render: () => null })
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
    <section key={key} className={'mz-page mz-' + (o.tone || 'paper')}>
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
  const opener = (key: string, num: string, kick: string, titleKey: 'workTitle' | 'numbersTitle', img: string) => (
    <section key={key} className="mz-page">
      <div className="mz-opener" style={{ backgroundImage: `linear-gradient(180deg, rgba(6,10,30,.30) 0%, rgba(6,10,30,0) 28%, rgba(6,10,30,.08) 52%, rgba(6,10,30,.84) 100%), url(${img})` }}>
        <span className="mz-opener-num">{num}</span>
        <div>
          {kicker(kick, true)}
          <h2 className="mz-opener-title"><CT k={titleKey} /></h2>
        </div>
      </div>
    </section>
  )

  const compsTable = (list: PacketComp[], us?: React.ReactNode, withBasis?: boolean) => (
    <table className="mz-table">
      <thead><tr><th>Comparable</th><th>Market</th>{withBasis ? <th>Basis</th> : null}<th className="r">Gross a year</th><th className="r">Nightly</th><th className="r">Occupancy</th></tr></thead>
      <tbody>
        {list.map(x => { const ci = cma ? cma.comps.findIndex(z => z.id === x.id) : -1; return (
          <tr key={x.id}>
            <td><b><E v={x.name} p={`cma.comps.${ci}.name`} /></b></td>
            <td><E v={x.market} p={`cma.comps.${ci}.market`} /></td>
            {withBasis ? <td><E v={x.basis} p={`cma.comps.${ci}.basis`} /></td> : null}
            <td className="r">{canEdit && editText ? <E v={compGross(x)} p={`cma.comps.${ci}.grossText`} /> : compGross(x)}</td>
            <td className="r">{dash(x.nightlyLo, x.nightlyHi)}</td>
            <td className="r">{pctRange(x.occLo, x.occHi)}</td>
          </tr>
        ) })}
        {us}
      </tbody>
    </table>
  )

  const render = (s: Spec): React.ReactNode => {
    switch (true) {
      case s.key === 'cover': return (
        <section key="cover" className="mz-page mz-cover" style={{ backgroundImage: `linear-gradient(180deg, rgba(6,10,30,.66) 0%, rgba(6,10,30,.10) 26%, rgba(6,10,30,.04) 50%, rgba(6,10,30,.86) 100%), url(${photo('cover')})` }}>
          <div className="mz-mast">
            <img src="/stay-logo.png" alt="Stay Hospitality" className="mz-logo" />
            <div className="mz-mast-r"><span>{cma ? 'The Building Package' : 'Management Proposal'}</span><span>{monthYear}</span></div>
          </div>
          <div className="mz-cover-main">
            {brandLogo ? <img src={brandLogo} alt="" className="mz-brandlogo" /> : null}
            {kicker(<>{cma ? <E v={area} p="cma.area" ph="Area" /> : area || 'South Florida'}{' · Miami'}</>, true)}
            <h1 className="mz-cover-title">
              {canEdit && editText ? <E v={building} p={buildingPath} ph="Building" /> : <>{short(building) || 'Stay Hospitality'}{/residences$/i.test(building) ? <em> Residences</em> : null}</>}
            </h1>
            <p className="mz-cover-dek"><CT k="coverDek" /></p>
            <div className="mz-cover-inside">{contents.map(x => <div key={x.n}><b>{x.n}</b><span>{x.title}</span></div>)}</div>
            {prospect || (canEdit && editText) ? <p className="mz-cover-for">Prepared for <E v={prospect} p="meta.prospect" ph="Who it is for" /> · {date}</p> : null}
          </div>
        </section>
      )
      case s.key === 'contents': return frame('contents', (
        <div className="mz-contents">
          <div className="mz-contents-photo" style={{ backgroundImage: `url(${photo('contents')})` }} />
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
          <div className="mz-about-photo" style={{ backgroundImage: `linear-gradient(180deg, rgba(6,10,30,.05) 30%, rgba(6,10,30,.78) 100%), url(${photo('about')})` }}>
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
                {stats.map(st => <div key={st.i}><b className={st.fig.length > 9 ? 'long' : ''}><E v={st.fig} p={`overview.stats.${st.i}.${st.figP}`} /></b><span><E v={st.lab} p={`overview.stats.${st.i}.${st.labP}`} /></span></div>)}
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
        <section key="manage" className="mz-page mz-split-page">
          <div className="mz-split-photo" style={{ backgroundImage: `url(${photo('manage')})` }} />
          <div className="mz-split-text">
            <header className="mz-run mz-run-tight"><span className="mz-run-mark">STAY</span><span>How we manage</span></header>
            <div className="mz-split-body">
              {kicker('How we manage')}
              <h2 className="mz-h mz-h1"><CT k="manageHead" /></h2>
              <p className="mz-lead mz-lead-s"><CT k="manageDek" block /></p>
              <ol className="mz-practice">
                {ops.map((r, j) => <li key={r.i}><span>{two(j + 1)}</span><div><b><E v={r.k} p={`ops.rows.${r.i}.k`} /></b><p><E v={r.v} p={`ops.rows.${r.i}.v`} block /></p></div></li>)}
              </ol>
            </div>
            <footer className="mz-foot mz-foot-tight"><span>{short(building)}</span><span className="mz-folio">{two(folioOf.manage)}</span></footer>
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
                  {t.logo ? <img src={t.logo} alt="" onError={(e: Any) => { e.currentTarget.style.display = 'none' }} /> : null}
                  <b>{toolsPath ? <E v={t.name} p={`${toolsPath}.${i}.name`} /> : t.name}</b>
                  <span>{toolsPath ? <E v={t.role} p={`${toolsPath}.${i}.role`} /> : t.role}</span>
                </div>
                <p>{toolsPath ? <E v={t.v} p={`${toolsPath}.${i}.v`} block /> : t.v}</p>
              </div>
            ))}
          </div>
          <div className="mz-channels">
            {kicker('Where your home is listed')}
            <p>{channels.map((ch, i) => <React.Fragment key={i}>{i ? <i>·</i> : null}<span>{ch}</span></React.Fragment>)}<i>·</i><span className="mz-plus">{channelCount} platforms in all</span></p>
          </div>
        </>
      ), { section: 'Our technology' })
      case s.key === 'op-work': return opener('op-work', two(folioOf['op-work']), 'Working together', 'workTitle', photo('work'))
      case s.key === 'op-num': return opener('op-num', two(folioOf['op-num']), 'The numbers', 'numbersTitle', photo('numbers'))
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
          <p className="mz-lead mz-lead-s"><E v={cma!.second.choose} p="cma.second.choose" block /></p>
          <div className="mz-qa">{cma!.second.qa.map(([q, a], i) => <div key={i}><p className="mz-q"><E v={q} p={`cma.second.qa.${i}.0`} /></p><p className="mz-a"><E v={a} p={`cma.second.qa.${i}.1`} block /></p></div>)}</div>
          {kicker('How we would get a unit ready')}
          <ol className="mz-steps mz-steps-3">{cma!.second.steps.map(([k, v], i) => <li key={i}><span>{two(i + 1)}</span><b><E v={k.replace(/\.$/, '')} p={`cma.second.steps.${i}.0`} /></b><p><E v={v} p={`cma.second.steps.${i}.1`} block /></p></li>)}</ol>
        </>
      ), { section: 'Owner options' })
      case s.key === 'market' && !!cma: return frame('market', (
        <>
          {kicker([short(building), area].filter(Boolean).join(' · '))}
          <h2 className="mz-h mz-h1">The {area || 'local'} rental market</h2>
          <p className="mz-lead mz-lead-s"><E v={cma!.market.lead} p="cma.market.lead" block /></p>
          <div className="mz-cols">{cma!.market.bullets.map(([k, v], i) => (v.trim() || (canEdit && editText)) ? <div key={i} className="mz-col-item"><b><E v={k.replace(/\.$/, '')} p={`cma.market.bullets.${i}.0`} /></b><p><E v={v} p={`cma.market.bullets.${i}.1`} block /></p></div> : null)}</div>
          {cma!.comps.length ? <div className="mz-push">{kicker('The comparable set used across this package')}{compsTable(cma!.comps, null, true)}</div> : null}
        </>
      ), { section: 'The market' })
      case s.key === 'glance' && !!cma: {
        const nums = cma!.plans.map(p => ({ p, n: planNumbers(cma!, p) }))
        const step = 25000
        const top = Math.ceil(Math.max(1, ...nums.map(x => x.n.hi)) / step) * step
        const ticks: number[] = []
        for (let v = 0; v <= top; v += step) ticks.push(v)
        return frame('glance', (
          <>
            {kicker('Every floor plan')}
            <h2 className="mz-h mz-h1">At a glance</h2>
            <p className="mz-lead mz-lead-s"><CT k="glanceDek" block /></p>
            <div className={'mz-glance' + (showYield ? ' with-yield' : '')}>
              <div className="mz-glance-head"><span>Floor plan</span><span className="mz-glance-axis">{ticks.map(v => <i key={v} style={{ left: (v / top * 100) + '%' }}>{v === 0 ? '0' : '$' + v / 1000 + 'K'}</i>)}</span><span className="r">A year</span>{showYield ? <span className="r">Yield</span> : null}</div>
              {nums.map(({ p, n }) => { const pr = priceOf(p.price); return (
                <div key={p.id} className="mz-glance-row">
                  <div className="mz-glance-name"><b>{p.name}</b><span>{p.sf}{p.price ? ' · from ' + p.price : ''}</span></div>
                  <div className="mz-glance-track">{ticks.map(v => <s key={v} style={{ left: (v / top * 100) + '%' }} />)}<i style={{ left: (n.lo / top * 100) + '%', width: Math.max(1.5, (n.hi - n.lo) / top * 100) + '%' }} /></div>
                  <div className="mz-glance-v"><b>{dash(n.lo, n.hi)}</b><span>{dash(n.monthLo, n.monthHi)} a month</span></div>
                  {showYield ? <div className="mz-glance-y">{pr ? <>{pct1(n.lo / pr)}<br />{pct1(n.hi / pr)}</> : '—'}</div> : null}
                </div>
              ) })}
            </div>
            <div className="mz-read">
              {kicker('How to read this')}
              <p>Figures are <b>gross rental revenue</b>: booking revenue before channel fees and the management fee. Every range starts from the comparable set, then adds a {cma!.uplift.lo}% (low end) to {cma!.uplift.hi}% (high end) uplift, {cma!.uplift.why}{showYield ? ' Yield is the year’s gross against the starting price.' : ''}</p>
            </div>
          </>
        ), { section: 'Every floor plan', tone: 'warm' })
      }
      case s.key.startsWith('plan-') && !!cma: {
        const p = cma!.plans.find(x => 'plan-' + x.id === s.key)!
        const pi = cma!.plans.findIndex(x => x.id === p.id)
        const n = planNumbers(cma!, p)
        const pr = priceOf(p.price)
        const comps = p.compIds.map(id => cma!.comps.find(x => x.id === id)).filter(Boolean) as PacketComp[]
        const side: [string, string, string][] = [
          ['Per month, on average', dash(n.monthLo, n.monthHi), ''],
          ['Peak month', 'up to ' + money(n.peak), n.peakMonth + ', high end'],
          showNet ? ['Owner keeps, est.', dash(netOf(n.lo), netOf(n.hi)), 'a year, after fees'] : ['Nightly rate' + (p.suites > 1 ? ', per suite' : ''), dash(n.nightlyLo, n.nightlyHi), 'at ' + pctRange(p.occLo, p.occHi) + ' occupancy'],
        ]
        return frame(s.key, (
          <>
            {canEdit ? <button type="button" className="mz-adjust" onClick={() => { setTuneId(p.id); setDrawer('proj') }}>Adjust projection</button> : null}
            {kicker((short(building) ? short(building) + ' · ' : '') + 'Rental comparison')}
            <h2 className="mz-h mz-h1 mz-plan-name"><E v={p.name} p={`cma.plans.${pi}.name`} /></h2>
            <dl className="mz-facts">
              <div><dt>Interior</dt><dd><E v={p.sf} p={`cma.plans.${pi}.sf`} /></dd></div>
              <div><dt>Starting price</dt><dd><E v={p.price || (canEdit && editText ? '' : '—')} p={`cma.plans.${pi}.price`} ph="Price" /></dd></div>
              {showYield && pr ? <div><dt>Gross yield</dt><dd>{pct1(n.lo / pr)} to {pct1(n.hi / pr)}</dd></div> : null}
              <div><dt>Rental rules</dt><dd><E v={p.rules} p={`cma.plans.${pi}.rules`} /></dd></div>
            </dl>
            <div className="mz-earn">
              <div className="mz-earn-main">
                <span>Could earn, per year</span>
                <b>{money(n.lo)}<i> to </i>{money(n.hi)}</b>
                <small>Gross rental revenue, once fully ramped</small>
              </div>
              <dl className="mz-earn-side">{side.map(([l, v, sm], i) => <div key={i}><dt>{l}{sm ? <small>{sm}</small> : null}</dt><dd>{v}</dd></div>)}</dl>
            </div>
            {kicker(chart === 'cumulative' ? 'The year, as it adds up' : 'Through the year')}
            <Chart months={n.months} kind={chart} />
            <p className="mz-legend"><i style={{ background: C.sand }} /> Low end <i style={{ background: C.navy }} /> High end <span>Seasonal shape from Miami market pricing data</span></p>
            <div className="mz-push">
              {kicker('Against the comparable set')}
              {compsTable(comps, (
                <tr className="mz-us"><td><b>{(short(building) ? short(building) + ' ' : '') + p.name}</b></td><td>{area ? area + ', new build' : 'New build'}</td><td className="r"><b>{dash(n.lo, n.hi)}</b></td><td className="r"><b>{dash(n.nightlyLo, n.nightlyHi)}</b></td><td className="r"><b>{pctRange(p.occLo, p.occHi)}</b></td></tr>
              ))}
              <p className="mz-how"><b>How we got there.</b> <E v={p.how} p={`cma.plans.${pi}.how`} block /> {n.manual ? 'The range was set by hand.' : `Ranges are then raised ${cma!.uplift.lo}% at the low end and ${cma!.uplift.hi}% at the high end, ${cma!.uplift.why}`} {adjustLine(cma!, p)}{showNet ? ` Owner estimate after ${channelPct}% channel fees and a ${mgmtPct}% management fee.` : ''}</p>
            </div>
          </>
        ), { section: 'Rental comparison' })
      }
      case s.key === 'back': return (
        <section key="back" className="mz-page mz-backcover" style={{ backgroundImage: `linear-gradient(180deg, rgba(6,10,30,.55) 0%, rgba(6,10,30,.80) 45%, rgba(6,10,30,.95) 100%), url(${photo('back')})` }}>
          <img src="/stay-logo.png" alt="Stay Hospitality" className="mz-logo" />
          <div className="mz-back-main">
            {kicker(cma ? 'Next step' : 'Let’s talk', true)}
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
          <p className="mz-fine">{cma ? <E v={cma.disclaimer} p="cma.disclaimer" block /> : 'Projections are estimates, not guarantees. Management terms are set in the written agreement.'}<br />Stay Hospitality · stay-hospitality.com</p>
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
          <p className="mz-form-h">Pages</p>
          {PAGES.map(([k, l]) => <label key={k} className="mz-toggle"><input type="checkbox" checked={!hideMag[k]} onChange={e => setMag({ hide: { ...hideMag, [k]: !e.target.checked } })} /> {l}</label>)}
          {cma ? ([['partner', 'Agent partner program'], ['second', 'Stay as a second option'], ['market', 'Market and comparables'], ['glance', 'Floor plans at a glance'], ['plans', 'One page per floor plan']] as [keyof SalesCma['sections'], string][]).map(([k, l]) => (
            <label key={k} className="mz-toggle"><input type="checkbox" checked={!!cma.sections[k]} onChange={e => setCma({ ...cma, sections: { ...cma.sections, [k]: e.target.checked } })} /> {l}</label>
          )) : null}
          <p className="mz-form-h">Photos</p>
          {PHOTO_SLOTS.map(([slot, label]) => (
            <div key={slot} className="mz-slot">
              <span>{label}</span>
              <div className="mz-thumbs">
                {allPhotos.slice(0, 14).map(u => <button key={u} type="button" className={photo(slot) === u ? 'on' : ''} style={{ backgroundImage: `url(${u})` }} onClick={() => setMag({ photos: { ...(mag.photos || {}), [slot]: u } })} aria-label={'Use this photo for ' + label} />)}
              </div>
              <input placeholder="or paste an image link" defaultValue={(mag.photos || {})[slot] && !allPhotos.includes((mag.photos || {})[slot]) ? (mag.photos || {})[slot] : ''} onBlur={e => { const v = e.target.value.trim(); if (/^https?:\/\/|^\//.test(v)) setMag({ photos: { ...(mag.photos || {}), [slot]: v } }) }} />
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
                <em style={{ fontFamily: t.display ? `"${t.display}", serif` : 'Fraunces, serif' }}>{t.label}</em>
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
          <label className="mz-toggle"><input type="checkbox" checked={showYield} onChange={e => setMag({ yield: e.target.checked })} /> Gross yield on the starting price</label>
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
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;1,9..144,300;1,9..144,400&family=Josefin+Sans:wght@300;400&family=Inter:wght@400;500;600;700&display=swap" />
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
.mz-root{background:${C.desk};min-height:100vh;padding:80px 16px 64px;font-family:${SANS};color:${C.body};-webkit-print-color-adjust:exact;print-color-adjust:exact;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}
.mz-root *{box-sizing:border-box}
.mz-with-drawer{padding-right:min(500px,100vw)}
.mz-bar-top{position:fixed;top:0;left:0;right:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px max(16px,env(safe-area-inset-left));background:${C.navy};color:#fff}
.mz-switch{display:inline-flex;background:rgba(255,255,255,.12);border-radius:999px;padding:3px}
.mz-switch b,.mz-switch a{font:600 12.5px ${SANS};padding:6px 15px;border-radius:999px;color:#fff;text-decoration:none}
.mz-switch b{background:#fff;color:${C.navy}}
.mz-bar-r{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.mz-bar-top button{font:600 12.5px ${SANS};background:#fff;color:${C.navy};border:0;border-radius:999px;padding:7px 15px;cursor:pointer}
.mz-bar-top .mz-ghost{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4)}
.mz-bar-top .mz-ghost.on{background:${C.glow};color:${C.ink};border-color:${C.glow}}
.mz-saved{font:500 12px ${SANS};color:rgba(255,255,255,.75)}

/* page and grid */
.mz-page{position:relative;width:816px;max-width:100%;height:1056px;margin:0 auto 36px;background:${C.paper};box-shadow:0 1px 2px rgba(10,14,40,.06),0 24px 60px rgba(10,14,40,.14);display:flex;flex-direction:column;overflow:hidden}
.mz-warm{background:${C.warm}}
.mz-body{padding:30px 64px 0;flex:1;display:flex;flex-direction:column;min-height:0}
.mz-run{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:16px;margin:40px 64px 0;padding-bottom:12px;border-bottom:1px solid ${C.rule};font:500 9.5px ${SANS};letter-spacing:.2em;text-transform:uppercase;color:${C.muted}}
.mz-run span:last-child{text-align:right}
.mz-run-mark{font:400 13px ${MARK};letter-spacing:.44em;color:${C.ink}}
.mz-run-mark.mz-on-dark,.mz-run-dark .mz-run-mark{color:#fff}
.mz-run-dark{color:rgba(255,255,255,.75);border-color:rgba(255,255,255,.28)}
.mz-foot{display:flex;justify-content:space-between;align-items:baseline;margin:0 64px 34px;padding-top:12px;border-top:1px solid ${C.rule};font:500 9.5px ${SANS};letter-spacing:.18em;text-transform:uppercase;color:${C.muted}}
.mz-folio{font:400 17px ${SERIF};letter-spacing:0;color:${C.ink}}

/* type */
.mz-kicker{font:600 10.5px ${SANS};letter-spacing:.2em;text-transform:uppercase;color:${C.sand};margin:0 0 14px;display:flex;align-items:center;gap:12px}
.mz-kicker::before{content:"";width:28px;height:1px;background:currentColor}
.mz-kicker.mz-on-dark{color:${C.glow}}
.mz-h{font-family:${SERIF};font-weight:300;color:${C.ink};margin:0;text-wrap:balance;font-optical-sizing:auto}
.mz-h em,.mz-cover-title em,.mz-back-title em,.mz-opener-title em{font-style:italic;font-weight:300}
.mz-display{font-size:56px;line-height:1.02;letter-spacing:-.012em}
.mz-h1{font-size:44px;line-height:1.06;letter-spacing:-.01em}
.mz-on-dark{color:#fff}
.mz-lead{font:300 19px/1.5 ${SERIF};color:${C.body};margin:20px 0 0;max-width:34em}
.mz-lead-s{font-size:17px;margin-top:16px}
.mz-small{font-size:11px;line-height:1.55;color:${C.muted}}
.mz-push{margin-top:auto;padding-bottom:22px}

/* cover */
.mz-cover{background-size:cover;background-position:center 40%;color:#fff;padding:52px 64px 56px;justify-content:space-between}
.mz-mast{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:1px solid rgba(255,255,255,.4)}
.mz-logo{width:150px;filter:brightness(0) invert(1)}
.mz-mast-r{display:flex;flex-direction:column;align-items:flex-end;gap:6px;font:500 10px ${SANS};letter-spacing:.24em;text-transform:uppercase;color:rgba(255,255,255,.9)}
.mz-brandlogo{max-width:180px;max-height:56px;object-fit:contain;filter:brightness(0) invert(1);margin-bottom:22px;display:block}
.mz-cover-title{font-family:${SERIF};font-weight:300;font-size:96px;line-height:.92;letter-spacing:-.025em;margin:4px 0 0;text-wrap:balance}
.mz-cover-title em{display:block}
.mz-cover-dek{font:300 19px/1.45 ${SERIF};max-width:30em;color:rgba(255,255,255,.92);margin:20px 0 0}
.mz-cover-inside{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:34px;padding-top:16px;border-top:1px solid rgba(255,255,255,.4)}
.mz-cover-inside div{display:flex;gap:12px;align-items:baseline}
.mz-cover-inside b{font:300 26px ${SERIF};color:${C.glow}}
.mz-cover-inside span{font:500 10.5px ${SANS};letter-spacing:.18em;text-transform:uppercase;color:#fff}
.mz-cover-for{font:500 10px ${SANS};letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.75);margin:22px 0 0}

/* contents */
.mz-contents{display:grid;grid-template-columns:250px 1fr;gap:44px;flex:1;margin:10px 0 30px}
.mz-contents-photo{background-size:cover;background-position:center}
.mz-contents-r{display:flex;flex-direction:column}
.mz-toc{list-style:none;padding:0;margin:26px 0 0;border-top:1px solid ${C.ink}}
.mz-toc li{display:flex;gap:20px;align-items:baseline;padding:18px 0;border-bottom:1px solid ${C.rule}}
.mz-toc-n{font:300 34px ${SERIF};color:${C.sand};min-width:46px}
.mz-toc b{display:block;font:400 21px ${SERIF};color:${C.ink}}
.mz-toc li div span{display:block;font-size:12px;line-height:1.5;color:${C.muted};margin-top:4px}
.mz-note{margin-top:auto}
.mz-note-text{font:300 italic 15px/1.65 ${SERIF};color:${C.body}}
.mz-sign{display:flex;gap:14px;align-items:center;margin-top:18px}
.mz-sign img{width:52px;height:52px;border-radius:999px;object-fit:cover}
.mz-sign b{display:block;font:400 17px ${SERIF};color:${C.ink}}
.mz-sign span{display:block;font:600 9.5px ${SANS};letter-spacing:.18em;text-transform:uppercase;color:${C.muted};margin-top:4px}

/* who we are */
.mz-about-photo{height:520px;background-size:cover;background-position:center;display:flex;flex-direction:column;justify-content:space-between}
.mz-about-head{padding:0 64px 40px}
.mz-about-head .mz-h{max-width:12em}
.mz-about-grid{display:grid;grid-template-columns:1fr 180px;gap:40px;align-items:end}
.mz-about-grid .mz-lead{margin-top:6px}
.mz-about-note{margin:0;padding-bottom:4px}
.mz-stats{display:grid;margin-top:36px;border-top:1px solid ${C.ink}}
.mz-stats>div{padding:20px 18px 0;border-left:1px solid ${C.rule}}.mz-stats>div:first-child{border-left:0;padding-left:0}
.mz-stats b{display:block;font:300 46px/1 ${SERIF};color:${C.ink};letter-spacing:-.015em;font-variant-numeric:lining-nums}
.mz-stats b.long{font-size:22px;line-height:1.2}
.mz-stats span{display:block;margin-top:12px;font:600 10px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${C.muted}}

/* team */
.mz-team{display:grid;gap:26px 22px;margin-top:30px}
.mz-team-3{grid-template-columns:repeat(3,1fr)}.mz-team-4{grid-template-columns:repeat(4,1fr)}
.mz-team figure{margin:0}
.mz-team img,.mz-team .mz-initials{width:100%;aspect-ratio:4/5;object-fit:cover;display:block}
.mz-initials{display:grid;place-items:center;background:${C.navy};color:${C.glow};font:300 38px ${SERIF}}
.mz-team figcaption{margin-top:12px}
.mz-team b{display:block;font:400 17px ${SERIF};color:${C.ink}}
.mz-team figcaption span{display:block;margin-top:4px;font:600 9.5px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${C.muted}}
.mz-terms-wrap{margin-top:auto;padding-bottom:26px}
.mz-terms{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:0 36px;border-top:1px solid ${C.ink}}
.mz-terms>div{padding:14px 0;border-bottom:1px solid ${C.rule}}
.mz-terms dt{font:400 16px ${SERIF};color:${C.ink}}.mz-terms dd{margin:5px 0 0;font-size:12px;line-height:1.6}

/* how we manage */
.mz-split-page{display:grid;grid-template-columns:300px 1fr;flex-direction:row}
.mz-split-photo{background-size:cover;background-position:center}
.mz-split-text{display:flex;flex-direction:column;min-width:0}
.mz-run-tight{grid-template-columns:auto 1fr;margin:40px 56px 0 48px}
.mz-split-body{padding:30px 56px 0 48px;flex:1;display:flex;flex-direction:column}
.mz-practice{list-style:none;padding:0;margin:28px 0 0;border-top:1px solid ${C.ink}}
.mz-practice li{display:grid;grid-template-columns:40px 1fr;gap:6px;padding:16px 0;border-bottom:1px solid ${C.rule}}
.mz-practice li>span{font:300 20px ${SERIF};color:${C.sand}}
.mz-practice b{display:block;font:400 17px ${SERIF};color:${C.ink}}
.mz-practice p{font-size:12px;line-height:1.6;margin:5px 0 0}
.mz-foot-tight{margin:0 56px 34px 48px}

/* technology */
.mz-tools{margin-top:30px;border-top:1px solid ${C.ink}}
.mz-tool{display:grid;grid-template-columns:200px 1fr;gap:28px;padding:18px 0;border-bottom:1px solid ${C.rule};align-items:start}
.mz-tool-l img{display:block;height:20px;max-width:120px;object-fit:contain;object-position:left;margin-bottom:8px}
.mz-tool-l b{display:block;font:400 22px ${SERIF};color:${C.ink}}
.mz-tool-l span{display:block;margin-top:4px;font:600 9.5px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${C.sand}}
.mz-tool p{font-size:12.5px;line-height:1.65;margin:2px 0 0}
.mz-channels{margin-top:auto;padding-bottom:26px}
.mz-channels p{font:300 19px/1.6 ${SERIF};color:${C.ink};margin:0}
.mz-channels i{font-style:normal;color:${C.sand};margin:0 10px}
.mz-plus{color:${C.muted}}

/* openers */
.mz-opener{flex:1;background-size:cover;background-position:center;color:#fff;padding:52px 64px 64px;display:flex;flex-direction:column;justify-content:space-between}
.mz-opener-num{font:200 160px/1 ${SERIF};color:rgba(255,255,255,.94);letter-spacing:-.03em}
.mz-opener-title{font-family:${SERIF};font-weight:300;font-size:58px;line-height:1.02;letter-spacing:-.018em;margin:0;max-width:11em;text-wrap:balance}

/* partner */
.mz-partner{display:grid;grid-template-columns:1fr 230px;gap:36px;margin-bottom:30px}
.mz-cards{margin-top:22px;border-top:1px solid ${C.ink}}
.mz-cards>div{padding:14px 0;border-bottom:1px solid ${C.rule}}
.mz-cards b{font:400 17px ${SERIF};color:${C.ink}}.mz-cards p{font-size:12px;line-height:1.6;margin:5px 0 0}
.mz-fees{background:${C.navy};color:#fff;padding:26px 24px;display:flex;flex-direction:column;align-self:start;margin-top:16px}
.mz-fee{padding:14px 0;border-bottom:1px solid rgba(255,255,255,.18)}
.mz-fee b{display:block;font:300 40px/1 ${SERIF};letter-spacing:-.015em}
.mz-fee>span{display:block;margin-top:6px;font:600 9.5px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.72)}
.mz-fees>p{font-size:11.5px;line-height:1.55;color:rgba(255,255,255,.8);margin:16px 0 0}
.mz-steps{list-style:none;padding:0;margin:0;display:grid;gap:22px}
.mz-steps-4{grid-template-columns:repeat(4,1fr)}.mz-steps-3{grid-template-columns:repeat(3,1fr)}
.mz-steps li{border-top:1px solid ${C.ink};padding-top:12px}
.mz-steps li>span{font:300 28px ${SERIF};color:${C.sand}}
.mz-steps b{display:block;font:400 16px ${SERIF};color:${C.ink};margin-top:6px}
.mz-steps p{font-size:11.5px;line-height:1.55;margin:6px 0 0}

/* second option */
.mz-qa{display:grid;grid-template-columns:1fr 1fr;gap:0 34px;margin:26px 0 30px;border-top:1px solid ${C.ink}}
.mz-qa>div{padding:13px 0;border-bottom:1px solid ${C.rule}}
.mz-q{font:400 italic 16px ${SERIF};color:${C.ink};margin:0}
.mz-a{font-size:11.5px;line-height:1.6;margin:5px 0 0}

/* market */
.mz-cols{display:grid;grid-template-columns:1fr 1fr;gap:0 34px;margin-top:24px;border-top:1px solid ${C.ink}}
.mz-col-item{padding:13px 0;border-bottom:1px solid ${C.rule}}
.mz-col-item b{font:400 16px ${SERIF};color:${C.ink}}.mz-col-item p{font-size:11.5px;line-height:1.6;margin:5px 0 0}
.mz-table{width:100%;border-collapse:collapse;font-size:11px}
.mz-table th{font:600 9px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.muted};text-align:left;padding:0 12px 9px 0;border-bottom:1px solid ${C.ink}}
.mz-table td{padding:10px 12px 10px 0;border-bottom:1px solid ${C.rule};vertical-align:top;line-height:1.45;font-variant-numeric:tabular-nums lining-nums}
.mz-table td b{font-weight:600;color:${C.ink}}
.mz-table .r{text-align:right;white-space:nowrap}
.mz-table th:last-child,.mz-table td:last-child{padding-right:0}
.mz-table tr.mz-us td{background:${C.sandSoft};border-bottom:1px solid ${C.ink}}
.mz-table tr.mz-us td:first-child{padding-left:10px}

/* at a glance */
.mz-glance{margin-top:30px}
.mz-glance-head,.mz-glance-row{display:grid;grid-template-columns:170px 1fr 150px;gap:18px;align-items:center}
.mz-glance.with-yield .mz-glance-head,.mz-glance.with-yield .mz-glance-row{grid-template-columns:170px 1fr 150px 56px}
.mz-glance-head{font:600 9px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.muted};padding-bottom:9px;border-bottom:1px solid ${C.ink}}
.mz-glance-head .r{text-align:right}
.mz-glance-axis{position:relative;height:12px;font-weight:500;letter-spacing:0}
.mz-glance-axis i{position:absolute;transform:translateX(-50%);font-style:normal}
.mz-glance-row{padding:12px 0;border-bottom:1px solid ${C.rule}}
.mz-glance-name b{display:block;font:400 17px ${SERIF};color:${C.ink}}
.mz-glance-name span{display:block;font-size:10.5px;color:${C.muted};margin-top:3px}
.mz-glance-track{position:relative;height:24px}
.mz-glance-track s{position:absolute;top:0;bottom:0;width:1px;background:${C.rule}}
.mz-glance-track i{position:absolute;top:8px;height:8px;background:${C.navy};border-radius:99px}
.mz-glance-v{text-align:right}
.mz-glance-v b{display:block;font:400 15px ${SERIF};color:${C.ink};font-variant-numeric:tabular-nums lining-nums;white-space:nowrap}
.mz-glance-v span{display:block;font-size:10.5px;color:${C.muted};margin-top:3px;white-space:nowrap}
.mz-glance-y{text-align:right;font:400 12px/1.35 ${SERIF};color:${C.ink};font-variant-numeric:tabular-nums lining-nums}
.mz-read{margin-top:auto;padding-bottom:26px}
.mz-read p{font-size:11.5px;line-height:1.65;margin:0;max-width:62em}

/* floor plan */
.mz-plan-name{font-size:52px}
.mz-facts{margin:22px 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));border-top:1px solid ${C.ink};border-bottom:1px solid ${C.rule}}
.mz-facts>div{padding:12px 16px;border-left:1px solid ${C.rule}}.mz-facts>div:first-child{border-left:0;padding-left:0}
.mz-facts dt{font:600 9px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${C.muted}}
.mz-facts dd{margin:5px 0 0;font:400 16px ${SERIF};color:${C.ink};font-variant-numeric:lining-nums}
.mz-earn{display:grid;grid-template-columns:1fr 290px;gap:36px;margin:26px 0 28px;align-items:end}
.mz-earn-main span{display:block;font:600 10px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${C.sand}}
.mz-earn-main b{display:block;font:300 50px/1 ${SERIF};color:${C.ink};letter-spacing:-.02em;margin-top:10px;font-variant-numeric:lining-nums;white-space:nowrap}
.mz-earn-main b i{font-style:italic;font-size:30px;color:${C.muted};letter-spacing:0}
.mz-earn-main small{display:block;margin-top:10px;font-size:11.5px;color:${C.muted}}
.mz-earn-side{margin:0;border-top:1px solid ${C.ink}}
.mz-earn-side>div{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:10px 0;border-bottom:1px solid ${C.rule}}
.mz-earn-side dt{font:600 9.5px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.muted}}
.mz-earn-side dt small{display:block;font:400 10.5px ${SANS};letter-spacing:0;text-transform:none;margin-top:3px}
.mz-earn-side dd{margin:0;font:400 18px ${SERIF};color:${C.ink};white-space:nowrap;font-variant-numeric:lining-nums}
.mz-legend{display:flex;align-items:center;gap:7px;font:600 9px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.muted};margin:4px 0 0}
.mz-legend i{display:inline-block;width:9px;height:9px}.mz-legend span{margin-left:auto}
.mz-how{font-size:11px;line-height:1.6;color:${C.muted};margin:14px 0 0}
.mz-how>b{font:400 italic 13px ${SERIF};color:${C.ink}}

/* back cover */
.mz-backcover{background-size:cover;background-position:center;color:#fff;padding:56px 64px 52px;justify-content:space-between}
.mz-back-main{display:flex;flex-direction:column}
.mz-back-title{font-family:${SERIF};font-weight:300;font-size:54px;line-height:1.04;letter-spacing:-.02em;margin:0;max-width:13em;text-wrap:balance}
.mz-back-title em{color:${C.glow}}
.mz-back-dek{font:300 18px/1.55 ${SERIF};color:rgba(255,255,255,.88);max-width:30em;margin:20px 0 0}
.mz-contact{display:flex;gap:22px;align-items:center;margin-top:38px;padding-top:26px;border-top:1px solid rgba(255,255,255,.35)}
.mz-contact img,.mz-initials-l{width:96px;height:96px;border-radius:999px;object-fit:cover;flex:none}
.mz-initials-l{display:grid;font-size:30px}
.mz-contact b{display:block;font:400 26px ${SERIF}}
.mz-contact div>span{display:block;font-size:13px;color:rgba(255,255,255,.88);margin-top:4px}
.mz-contact .mz-contact-role{font:600 10px ${SANS};letter-spacing:.18em;text-transform:uppercase;color:${C.glow};margin:6px 0 10px}
.mz-sel{user-select:all}
.mz-fine{font-size:9.5px;line-height:1.6;color:rgba(255,255,255,.6);max-width:62em;margin:0}

/* editing */
.mz-ed{outline:1px dashed rgba(58,91,217,.55);outline-offset:2px;border-radius:2px;cursor:text;min-width:1ch}
div.mz-ed{display:block}
.mz-ed:hover{background:rgba(58,91,217,.07)}
.mz-ed:focus{outline:2px solid #3A5BD9;background:rgba(255,255,255,.95);color:#0F1640}
.mz-ed:empty::before{content:attr(data-ph);opacity:.45}
.mz-adjust{position:absolute;top:36px;right:64px;z-index:5;font:600 11.5px ${SANS};background:${C.navy};color:#fff;border:0;border-radius:999px;padding:7px 13px;cursor:pointer;box-shadow:0 6px 18px rgba(10,14,40,.25)}

/* drawer */
.mz-drawer{position:fixed;top:56px;right:0;bottom:0;z-index:30;width:min(480px,100vw);background:#fff;box-shadow:-18px 0 50px rgba(10,14,40,.18);padding:16px 20px 24px;overflow-y:auto;font-family:${SANS};color:#0F1640}
.mz-drawer-head{display:flex;justify-content:space-between;align-items:center}
.mz-drawer-head b{font:400 22px Fraunces, Georgia, serif}
.mz-drawer-head button{border:0;background:none;font-size:24px;line-height:1;color:#80859A;cursor:pointer}
.mz-seg{display:grid;grid-template-columns:repeat(4,1fr);background:#F1F0EC;border-radius:10px;padding:3px;margin-top:12px}
.mz-seg button{font:600 11.5px ${SANS};border:0;background:none;border-radius:8px;padding:7px 2px;color:#4b5068;cursor:pointer}
.mz-seg button.on{background:#fff;color:#0F1640;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.mz-drawer-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.mz-drawer-tabs button{font:600 11.5px ${SANS};padding:5px 10px;border-radius:999px;border:1px solid #E3DED3;background:#fff;color:#0F1640;cursor:pointer}
.mz-drawer-tabs button.on{background:#111A4A;color:#fff;border-color:#111A4A}
.mz-drawer-all{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;margin-top:14px;padding:10px 12px;background:#FAF7F1;border-radius:10px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#80859A}
.mz-drawer-all input{accent-color:#111A4A}.mz-drawer-all b{color:#0F1640;font-size:13px;letter-spacing:0}
.mz-drawer-plan{font:300 26px Fraunces, Georgia, serif;margin:18px 0 8px}
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
  .mz-cover-title{font-size:58px}.mz-opener-num{font-size:100px}.mz-opener-title{font-size:40px}
  .mz-display{font-size:40px}.mz-h1,.mz-plan-name{font-size:34px}
  .mz-about-photo{height:440px}.mz-about-head{padding:0 20px 28px}
  .mz-split-page{display:flex;flex-direction:column}.mz-split-photo{height:280px}.mz-run-tight,.mz-split-body,.mz-foot-tight{margin-left:20px;margin-right:20px;padding-left:0;padding-right:0}
  .mz-about-grid,.mz-partner,.mz-team-3,.mz-team-4,.mz-terms,.mz-qa,.mz-cols,.mz-steps-4,.mz-steps-3,.mz-contents,.mz-cover-inside,.mz-earn,.mz-tool{grid-template-columns:1fr}
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
