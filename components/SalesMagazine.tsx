'use client'
// THE MAGAZINE VERSION OF A SALES DECK (Jon, 2026-11-11: "a printable view / magazine and a keynote
// slide version… a package building and realtor groups can share, leave at the building, or send to
// one owner… beautiful, magazine-level detail and sophistication… a projection builder where you can
// scale the projections on the page and adjust the months… multiple styles, graphs, data… the
// comparables should also be editable — everything should be editable").
//
// The same owner_reports row and the same /r/<code> link as the keynote deck: /r/<code>?view=magazine.
// It reads the deck's own content — cover photo, photo pool, who we are, how we run a home, team,
// terms, presenter card — plus content.cma (the building pages, lib/sales-cma) and content.magazine
// (this view's style, chart, data switches and any words rewritten here).
//
// FOR THE TEAM (canEdit): "Edit text" turns every word on every page into an edit-in-place field;
// "Builder" opens a drawer with three tabs — Projections (scale, months, what each plan is built
// from), Comparables (every figure), Style & data (theme, chart, sections, yield, owner estimate).
// Everything re-renders live; Save writes the touched sections back onto the deck, so the keynote
// slides print the same numbers. A prospect never sees any of it.
//
// THE DESIGN. An editorial book, not a slide printout: a full-bleed cover with a masthead and what is
// inside; a contents page with a note from the presenter; photographic section openers with a large
// folio numeral; Fraunces for headlines and figures, Josefin Sans caps for the furniture, Inter for
// reading text; hairline rules, drop caps, a pull quote, an interview-style Q&A. Three themes.
import React, { useState } from 'react'
import { ProjectionTuner } from '@/components/ProjectionTuner'
import {
  normalizeCma, planNumbers, range, money, compGross, pctRange, fmtDate, MONTHS, adjustLine, newId,
  type SalesCma, type PacketPlan, type PacketComp,
} from '@/lib/sales-cma'

type Any = any

// ── Themes ────────────────────────────────────────────────────────────────────────────────────────
type Theme = { label: string; ink: string; body: string; muted: string; navy: string; sand: string; sandSoft: string; warm: string; rule: string; glow: string; desk: string }
export const MAG_THEMES: Record<string, Theme> = {
  classic: { label: 'Classic navy', ink: '#0F1640', body: '#373D52', muted: '#80859A', navy: '#111A4A', sand: '#B59A6A', sandSoft: '#F1EADD', warm: '#FAF7F1', rule: '#E3DED3', glow: '#E6D3AE', desk: '#E8E4DC' },
  coastal: { label: 'Coastal', ink: '#0D2B33', body: '#33474C', muted: '#7B8E93', navy: '#0E4A57', sand: '#C9835A', sandSoft: '#F5E6DA', warm: '#F3F7F6', rule: '#D9E4E3', glow: '#F2C9A8', desk: '#E1E9E8' },
  noir: { label: 'Noir and gold', ink: '#111111', body: '#3A3A3A', muted: '#8A8783', navy: '#151515', sand: '#A8874A', sandSoft: '#F1EBDF', warm: '#F7F5F0', rule: '#E2DED6', glow: '#D9BF85', desk: '#E4E1DB' },
}
const C = { ink: 'var(--mz-ink)', body: 'var(--mz-body)', muted: 'var(--mz-muted)', navy: 'var(--mz-navy)', sand: 'var(--mz-sand)', sandSoft: 'var(--mz-sandsoft)', warm: 'var(--mz-warm)', rule: 'var(--mz-rule)', glow: 'var(--mz-glow)', desk: 'var(--mz-desk)', paper: '#FFFFFF' }
const themeVars = (k: string): React.CSSProperties => {
  const t = MAG_THEMES[k] || MAG_THEMES.classic
  return { ['--mz-ink' as Any]: t.ink, ['--mz-body' as Any]: t.body, ['--mz-muted' as Any]: t.muted, ['--mz-navy' as Any]: t.navy, ['--mz-sand' as Any]: t.sand, ['--mz-sandsoft' as Any]: t.sandSoft, ['--mz-warm' as Any]: t.warm, ['--mz-rule' as Any]: t.rule, ['--mz-glow' as Any]: t.glow, ['--mz-desk' as Any]: t.desk }
}
export type ChartKind = 'bars' | 'band' | 'cumulative'
const CHARTS: [ChartKind, string][] = [['bars', 'Bars, low and high'], ['band', 'Range band'], ['cumulative', 'Running total']]

const DISPLAY = '"Josefin Sans", "Futura", "Avenir Next", system-ui, sans-serif'
const SERIF = '"Fraunces", "Iowan Old Style", "Baskerville", Georgia, serif'
const SANS = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif'
const short = (b: string) => b.replace(/\s+Residences$/i, '')
const two = (n: number) => String(n).padStart(2, '0')
const priceOf = (s: string) => { const n = parseFloat(String(s || '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 1000 ? n : 0 }
const dash = (a: number, b: number) => money(a) + '–' + money(b)
const pct1 = (x: number) => (Math.round(x * 1000) / 10).toFixed(1) + '%'
/** *words* in a stored line print in italic. */
const rich = (s: string) => String(s || '').split(/(\*[^*]+\*)/g).map((x, i) => /^\*[^*]+\*$/.test(x) ? <em key={i}>{x.slice(1, -1)}</em> : <React.Fragment key={i}>{x}</React.Fragment>)

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
  const W = 700, H = 300, L = 50, R = 12, T = 24, B = 26
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
      <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} style={{ stroke: v === 0 ? C.ink : C.rule }} strokeWidth={v === 0 ? 1 : 0.7} />
      <text x={L - 8} y={y(v) + 3.5} textAnchor="end" fontSize={9.5} style={{ fill: C.muted }} fontFamily={SANS}>{v === 0 ? '0' : '$' + v / 1000 + 'K'}</text>
    </g>
  ))
  const axis = MONTHS.map((m, i) => <text key={m} x={cx(i)} y={H - 8} textAnchor="middle" fontSize={10} style={{ fill: C.muted }} fontFamily={SANS} letterSpacing="0.06em">{m.toUpperCase()}</text>)
  if (kind === 'bars') {
    const bw = Math.min(15, cw * 0.28)
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Monthly gross rental income, low and high end">
        {grid}
        {months.map((m, i) => (
          <g key={i}>
            <rect x={cx(i) - bw - 1.5} y={y(m.lo)} width={bw} height={y(0) - y(m.lo)} style={{ fill: C.sand }} rx={1.5} />
            <rect x={cx(i) + 1.5} y={y(m.hi)} width={bw} height={y(0) - y(m.hi)} style={{ fill: C.navy }} rx={1.5} />
            <text x={cx(i) + 1.5 + bw / 2} y={y(m.hi) - 6} textAnchor="middle" fontSize={9.5} fontWeight={600} style={{ fill: C.ink }} fontFamily={SANS}>{k$(m.hi)}</text>
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
      <path d={band} style={{ fill: C.sand, opacity: 0.28 }} />
      <path d={line('lo')} style={{ fill: 'none', stroke: C.sand }} strokeWidth={1.6} />
      <path d={line('hi')} style={{ fill: 'none', stroke: C.navy }} strokeWidth={2.2} />
      {series.map((m, i) => (
        <g key={i}>
          <circle cx={cx(i)} cy={y(m.hi)} r={3.2} style={{ fill: C.navy }} />
          {(kind === 'band' || i === 11 || i % 3 === 2) ? <text x={cx(i)} y={y(m.hi) - 9} textAnchor="middle" fontSize={9.5} fontWeight={600} style={{ fill: C.ink }} fontFamily={SANS}>{k$(m.hi)}</text> : null}
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
  const [drawer, setDrawer] = useState<null | 'proj' | 'comps' | 'style'>(null)
  const [tuneId, setTuneId] = useState<string | null>(null)
  const [saving, setSaving] = useState('')
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
      const base = fresh?.report?.content || original
      const content = { ...base }
      for (const k of touched) content[k] = doc[k]
      const r = await fetch('/api/reports', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: report.id, content }) })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d?.ok) throw new Error(d?.error || 'Save failed')
      setTouched([]); setSaving('Saved')
    } catch (e: Any) { setSaving(e?.message || 'Save failed') }
  }
  function discard() { setDoc(structuredClone(original)); setTouched([]); setSaving('') }

  /** Edit in place. Text mode on: the words become editable where they sit; Enter or leaving saves the field. */
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
  const style = MAG_THEMES[mag.style] ? mag.style : 'classic'
  const chart: ChartKind = (['bars', 'band', 'cumulative'] as ChartKind[]).includes(mag.chart) ? mag.chart : 'bars'
  const showYield = mag.yield !== false
  const showNet = !!mag.net
  const channelPct = Number.isFinite(+mag.channelPct) ? +mag.channelPct : 15
  const mgmtPct = Number.isFinite(+mag.mgmtPct) ? +mag.mgmtPct : 15
  const netOf = (g: number) => Math.round(g * (1 - channelPct / 100) * (1 - mgmtPct / 100) / 100) * 100

  const meta: Any = c.meta || {}
  const hero: Any = c.hero || {}
  const card: Any = (c.contact && c.contact.card) || {}
  const prospect = String(meta.prospect || '').trim()
  const building = (cma && cma.building) || String(hero.title || report.scope_label || '').trim()
  const buildingPath = cma ? 'cma.building' : 'hero.title'
  const area = (cma && cma.area) || String(meta.market || '').trim()
  const dateIso = String(report.created_at || new Date().toISOString()).slice(0, 10)
  const date = fmtDate(dateIso)
  const monthYear = new Date(dateIso + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const photos: string[] = Array.from(new Set([String(hero.heroImage || '').trim(), ...((Array.isArray(c.photoPool) ? c.photoPool : []) as string[]), '/deck-img/miami-skyline.jpg'].filter(Boolean)))
  const pic = (i: number) => photos[i % photos.length]
  const rows = (a: Any): { k: string; v: string; i: number }[] => (Array.isArray(a) ? a : []).map((r: Any, i: number) => ({ k: String(r?.k || ''), v: String(r?.v || ''), i })).filter(r => r.k.trim() || r.v.trim())
  const stats = rows(c.overview && c.overview.stats).slice(0, 4)
  const ops = rows(c.ops && c.ops.rows).slice(0, 6)
  const terms = rows(c.terms && c.terms.rows).slice(0, 6)
  const team: { p: Any; i: number }[] = ((c.team && c.team.people) || []).map((p: Any, i: number) => ({ p, i })).filter((x: Any) => x.p && String(x.p.name || '').trim()).slice(0, 8)
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

  // Words this view writes itself; each one can be rewritten here (content.magazine.copy).
  const D = {
    coverDek: cma ? 'What every floor plan could earn, how we work with your sales team, and why owners choose Stay.' : String(hero.headline || 'How we manage revenue, tools and team around the success of your property.'),
    note: cma
      ? `${building ? short(building) + ' is' : 'This building is'} one of the most interesting openings in ${area || 'Miami'}, and the buyers who choose it will ask the same question first: what will it earn? This package answers it for every floor plan, from the same comparable set, so a buyer sees a range before they make an offer. It also sets out how we work with your sales team, and what we would do for an owner who chooses us.`
      : 'Thank you for your time. This is how we would run your property: the revenue, the tools and the team around it, and what happens from the day you sign.',
    aboutHead: 'Stay-managed homes earn *20% more* than the market.',
    aboutDek: 'Full-service short-term rental management for owners across Miami and South Florida. On average; results vary by unit, building and season.',
    teamHead: 'The team on your building',
    pull: '“We earn your business every month. No setup fees, no monthly fees, and a 90-day exit.”',
    workTitle: showPartner ? 'For the sales team, and the buyers they bring' : 'For buyers who ask for options',
    numbersTitle: 'What a home at ' + (short(building) || 'this building') + ' could earn',
    glanceDek: 'Estimated gross rental revenue once fully ramped. Each bar is the annual range, from the low end to the high end.',
    backTitle: cma ? 'Send us any floor plan. *We will send the numbers in 48 hours.*' : 'Let’s talk about *your property.*',
    backDek: cma ? 'A unit-level projection a buyer can hold before they make an offer, built from the same comparable set as this package.' : 'We will walk through the numbers, the terms and the onboarding, and answer every question before you decide.',
  }
  const T = (k: keyof typeof D) => (copy[k] != null && String(copy[k]).trim() ? String(copy[k]) : D[k])
  const CT = ({ k, block }: { k: keyof typeof D; block?: boolean }) => <E v={T(k)} p={'magazine.copy.' + k} rich block={block} />

  // ── page furniture (plain functions, not components, so editing never remounts a page) ─────────
  let folio = 1
  const next = () => ++folio
  const page = (key: string, n: number, body: React.ReactNode, o: { section?: string; tone?: 'paper' | 'warm' } = {}) => (
    <section key={key} className={'mz-page mz-' + (o.tone || 'paper')}>
      <header className="mz-run">
        <span className="mz-run-mark">STAY</span>
        <span className="mz-run-mid">{o.section}</span>
        <span>{short(building)}</span>
      </header>
      <div className="mz-body">{body}</div>
      <footer className="mz-foot">
        <span>{building}{area ? ' · ' + area : ''}</span>
        <span className="mz-folio">{two(n)}</span>
      </footer>
    </section>
  )
  const opener = (key: string, n: number, num: string, kicker: string, titleKey: 'workTitle' | 'numbersTitle', img: string) => {
    void n
    return (
      <section key={key} className="mz-page">
        <div className="mz-opener" style={{ backgroundImage: `linear-gradient(180deg, rgba(8,12,36,.25) 0%, rgba(8,12,36,0) 30%, rgba(8,12,36,.1) 55%, rgba(8,12,36,.86) 100%), url(${img})` }}>
          <span className="mz-opener-num">{num}</span>
          <div>
            <p className="mz-kicker mz-on-dark">{kicker}</p>
            <h2 className="mz-opener-title"><CT k={titleKey} /></h2>
          </div>
        </div>
      </section>
    )
  }
  const kicker = (x: React.ReactNode, dark?: boolean) => <p className={'mz-kicker' + (dark ? ' mz-on-dark' : '')}>{x}</p>
  const head = (x: React.ReactNode, size: 'xl' | 'l' | 'm' = 'l') => <h2 className={'mz-head mz-head-' + size}>{x}</h2>

  // Contents, counted the way the pages are made below.
  const contents: { n: string; title: string; sub: string }[] = []
  {
    let n = 3
    contents.push({ n: two(n), title: 'Who we are', sub: 'Stay Hospitality, how we run a home, and the people on it' })
    n += 1 + (team.length || terms.length ? 1 : 0)
    if (showPartner || showSecond) {
      contents.push({ n: two(n), title: 'Working together', sub: [showPartner ? 'The agent partner program' : '', showSecond ? 'Stay as a second option' : ''].filter(Boolean).join(' and ') })
      n += 1 + (showPartner ? 1 : 0) + (showSecond ? 1 : 0)
    }
    if (showMarket || showGlance || plans.length) {
      contents.push({ n: two(n), title: 'The numbers', sub: [showMarket ? 'The ' + (area || 'local') + ' market and comparable set' : '', plans.length ? 'a rental comparison for ' + (plans.length === 1 ? 'one floor plan' : 'every floor plan') : ''].filter(Boolean).join(', and ') })
    }
  }

  const pages: React.ReactNode[] = []

  // ── Cover ──
  pages.push(
    <section key="cover" className="mz-page mz-cover" style={{ backgroundImage: `linear-gradient(180deg, rgba(8,12,36,.62) 0%, rgba(8,12,36,.08) 30%, rgba(8,12,36,.05) 52%, rgba(8,12,36,.88) 100%), url(${pic(0)})` }}>
      <div className="mz-mast">
        <img src="/stay-logo.png" alt="Stay Hospitality" className="mz-logo" />
        <div className="mz-mast-r">
          <span>{cma ? 'The Building Package' : 'Management Proposal'}</span>
          <span>{monthYear}</span>
        </div>
      </div>
      <div className="mz-cover-main">
        <p className="mz-kicker mz-on-dark">{cma ? <E v={area} p="cma.area" ph="Area" /> : area || 'South Florida'}{' · Miami'}</p>
        <h1 className="mz-cover-title">
          {canEdit && editText ? <E v={building} p={buildingPath} ph="Building" /> : <>{short(building) || 'Stay Hospitality'}{/residences$/i.test(building) ? <em> Residences</em> : null}</>}
        </h1>
        <p className="mz-cover-dek"><CT k="coverDek" /></p>
        <div className="mz-cover-inside">
          {contents.map(x => <div key={x.n}><b>{x.n}</b><span>{x.title}</span></div>)}
        </div>
        {prospect || (canEdit && editText) ? <p className="mz-cover-for">Prepared for <E v={prospect} p="meta.prospect" ph="Who it is for" /> · {date}</p> : null}
      </div>
    </section>,
  )

  // ── Contents ──
  pages.push(page('contents', next(), (
    <div className="mz-contents">
      <div className="mz-contents-photo" style={{ backgroundImage: `url(${pic(1)})` }} />
      <div className="mz-contents-r">
        {kicker('In this package')}
        {head('Contents')}
        <ol className="mz-toc">
          {contents.map(x => <li key={x.n}><span className="mz-toc-n">{x.n}</span><div><b>{x.title}</b><span>{x.sub}</span></div></li>)}
        </ol>
        <div className="mz-note">
          {kicker('A note' + (presenterFirst ? ' from ' + presenterFirst : ''))}
          <p><CT k="note" block /></p>
          {card.name ? <p className="mz-sign"><E v={card.name} p="contact.card.name" /><span><E v={card.role} p="contact.card.role" /></span></p> : null}
        </div>
      </div>
    </div>
  ), { section: 'Contents' }))

  // ── Who we are ──
  pages.push(page('about', next(), (
    <>
      {kicker('Stay Hospitality')}
      {head(<CT k="aboutHead" />, 'xl')}
      <p className="mz-dek"><CT k="aboutDek" block /></p>
      {stats.length ? <div className="mz-stats">{stats.map(s => <div key={s.i}><b><E v={s.k} p={`overview.stats.${s.i}.k`} /></b><span><E v={s.v} p={`overview.stats.${s.i}.v`} /></span></div>)}</div> : null}
      {ops.length ? (
        <>
          {kicker('How we run a home')}
          <div className="mz-points">{ops.map((r, j) => <div key={r.i}><span className="mz-pt-n">{two(j + 1)}</span><b><E v={r.k} p={`ops.rows.${r.i}.k`} /></b><p><E v={r.v} p={`ops.rows.${r.i}.v`} block /></p></div>)}</div>
        </>
      ) : null}
    </>
  ), { section: 'Who we are' }))
  if (team.length || terms.length) pages.push(page('team', next(), (
    <>
      {team.length ? (
        <>
          {kicker('The people')}
          {head(<CT k="teamHead" />, 'm')}
          <div className={'mz-team' + (team.some(x => String(x.p.photo || '').trim()) ? '' : ' mz-team-list')}>
            {team.map(({ p, i }) => (
              <figure key={i}>
                {p.photo ? <img src={p.photo} alt="" /> : <span className="mz-initials">{String(p.name).split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2)}</span>}
                <figcaption><b><E v={p.name} p={`team.people.${i}.name`} /></b><span><E v={p.role} p={`team.people.${i}.role`} /></span></figcaption>
              </figure>
            ))}
          </div>
        </>
      ) : null}
      <blockquote className="mz-pull"><CT k="pull" block /></blockquote>
      {terms.length ? (
        <>
          {kicker('How we work together')}
          <dl className="mz-terms">{terms.map(r => <div key={r.i}><dt><E v={r.k} p={`terms.rows.${r.i}.k`} /></dt><dd><E v={r.v} p={`terms.rows.${r.i}.v`} block /></dd></div>)}</dl>
        </>
      ) : null}
    </>
  ), { section: 'Who we are', tone: 'warm' }))

  // ── Working together ──
  if (cma && (showPartner || showSecond)) {
    pages.push(opener('op-work', next(), '02', 'Working together', 'workTitle', pic(2)))
    if (showPartner) pages.push(page('partner', next(), (
      <>
        <div className="mz-split">
          <div>
            {kicker('For sales teams and agents')}
            {head('The agent partner program')}
            <p className="mz-drop">{canEdit && editText ? <E v={cma.partner.lead} p="cma.partner.lead" block /> : <><span>{cma.partner.lead.slice(0, 1)}</span>{cma.partner.lead.slice(1)}</>}</p>
            <div className="mz-cards">{cma.partner.cards.map(([k, v], i) => <div key={i}><b><E v={k} p={`cma.partner.cards.${i}.0`} /></b><p><E v={v} p={`cma.partner.cards.${i}.1`} block /></p></div>)}</div>
          </div>
          <aside className="mz-fees">
            {kicker('Referral fees, in writing', true)}
            {cma.partner.fees.map(([a, w], i) => <div key={i} className="mz-fee"><b><E v={a} p={`cma.partner.fees.${i}.0`} /></b><span><E v={w} p={`cma.partner.fees.${i}.1`} /></span></div>)}
            <p><E v={cma.partner.feeNote} p="cma.partner.feeNote" block /></p>
          </aside>
        </div>
        {kicker('How it works')}
        <ol className="mz-steps mz-steps-4">{cma.partner.steps.map(([k, v], i) => <li key={i}><span>{two(i + 1)}</span><b><E v={k} p={`cma.partner.steps.${i}.0`} /></b><p><E v={v} p={`cma.partner.steps.${i}.1`} block /></p></li>)}</ol>
        {cma.partner.here.length ? (
          <div className="mz-here">
            {kicker(building ? 'At ' + short(building) : 'For your buyers')}
            <ul>{cma.partner.here.map((x, i) => <li key={i}><E v={x} p={`cma.partner.here.${i}`} block /></li>)}</ul>
          </div>
        ) : null}
      </>
    ), { section: 'Agent partner program' }))
    if (showSecond) pages.push(page('second', next(), (
      <>
        {kicker('For buyers who ask for options')}
        {head(building ? <>Stay as a second option at <em>{short(building)}</em></> : 'Stay as a second option')}
        <p className="mz-dek"><E v={cma.second.lead} p="cma.second.lead" block /></p>
        <p className="mz-text"><E v={cma.second.choose} p="cma.second.choose" block /></p>
        <div className="mz-qa">
          {cma.second.qa.map(([q, a], i) => <div key={i}><p className="mz-q"><E v={q} p={`cma.second.qa.${i}.0`} /></p><p className="mz-a"><E v={a} p={`cma.second.qa.${i}.1`} block /></p></div>)}
        </div>
        {kicker('How we would get a unit ready')}
        <ol className="mz-steps mz-steps-3">{cma.second.steps.map(([k, v], i) => <li key={i}><span>{two(i + 1)}</span><b><E v={k} p={`cma.second.steps.${i}.0`} /></b><p><E v={v} p={`cma.second.steps.${i}.1`} block /></p></li>)}</ol>
      </>
    ), { section: 'Owner options' }))
  }

  // ── The numbers ──
  if (cma && (showMarket || showGlance || plans.length)) {
    pages.push(opener('op-num', next(), showPartner || showSecond ? '03' : '02', 'The numbers', 'numbersTitle', pic(3)))
    const compsTable = (list: PacketComp[], us?: React.ReactNode, withBasis?: boolean) => (
      <table className="mz-table">
        <thead><tr><th>Comparable</th><th>Market</th>{withBasis ? <th>Basis</th> : null}<th className="r">Gross per year</th><th className="r">Nightly</th><th className="r">Occupancy</th></tr></thead>
        <tbody>
          {list.map(x => { const ci = cma.comps.findIndex(z => z.id === x.id); return (
            <tr key={x.id}>
              <td><b><E v={x.name} p={`cma.comps.${ci}.name`} /></b></td>
              <td><E v={x.market} p={`cma.comps.${ci}.market`} /></td>
              {withBasis ? <td><E v={x.basis} p={`cma.comps.${ci}.basis`} /></td> : null}
              <td className="r">{canEdit && editText ? <E v={compGross(x)} p={`cma.comps.${ci}.grossText`} /> : compGross(x)}</td>
              <td className="r">{money(x.nightlyLo)}–{money(x.nightlyHi)}</td>
              <td className="r">{pctRange(x.occLo, x.occHi)}</td>
            </tr>
          ) })}
          {us}
        </tbody>
      </table>
    )
    if (showMarket) pages.push(page('market', next(), (
      <>
        {kicker([short(building), area].filter(Boolean).join(' · '))}
        {head(<>The {area || 'local'} rental market</>)}
        <p className="mz-dek"><E v={cma.market.lead} p="cma.market.lead" block /></p>
        <div className="mz-cols">{cma.market.bullets.map(([k, v], i) => (v.trim() || (canEdit && editText)) ? <div key={i} className="mz-col-item"><b><E v={k.replace(/\.$/, '')} p={`cma.market.bullets.${i}.0`} /></b><p><E v={v} p={`cma.market.bullets.${i}.1`} block /></p></div> : null)}</div>
        {cma.comps.length ? (<>{kicker('The comparable set used across this package')}{compsTable(cma.comps, null, true)}</>) : null}
      </>
    ), { section: 'Market overview' }))
    if (showGlance) {
      const nums = cma.plans.map(p => ({ p, n: planNumbers(cma, p) }))
      const step = 25000
      const top = Math.ceil(Math.max(1, ...nums.map(x => x.n.hi)) / step) * step
      const ticks: number[] = []
      for (let v = 0; v <= top; v += step) ticks.push(v)
      pages.push(page('glance', next(), (
        <>
          {kicker('Every floor plan')}
          {head('At a glance')}
          <p className="mz-dek"><CT k="glanceDek" block /></p>
          <div className="mz-glance">
            <div className="mz-glance-axis"><span />{ticks.map(v => <i key={v} style={{ left: (v / top * 100) + '%' }}>{v === 0 ? '0' : '$' + v / 1000 + 'K'}</i>)}</div>
            {nums.map(({ p, n }) => { const pr = priceOf(p.price); return (
              <div key={p.id} className="mz-glance-row">
                <div className="mz-glance-name"><b>{p.name}</b><span>{p.sf}{p.price ? ' · from ' + p.price : ''}</span></div>
                <div className="mz-glance-track">
                  {ticks.map(v => <s key={v} style={{ left: (v / top * 100) + '%' }} />)}
                  <i style={{ left: (n.lo / top * 100) + '%', width: Math.max(1.5, (n.hi - n.lo) / top * 100) + '%' }} />
                </div>
                <div className="mz-glance-v"><b>{range(n.lo, n.hi)}</b><span>{range(n.monthLo, n.monthHi)} a month{showYield && pr ? ' · ' + pct1(n.lo / pr) + '–' + pct1(n.hi / pr) + ' gross yield' : ''}</span></div>
              </div>
            ) })}
          </div>
          <div className="mz-read">
            {kicker('How to read this')}
            <p>Figures are <b>gross rental revenue</b>: booking revenue before channel fees and the management fee. Monthly figures are the annual range divided by twelve; real months swing with the season, as each floor-plan page shows. Every range starts from the comparable set, then adds a {cma.uplift.lo}% (low end) to {cma.uplift.hi}% (high end) uplift, {cma.uplift.why}{showYield ? ' Gross yield is the annual range against the starting price.' : ''}</p>
          </div>
        </>
      ), { section: 'Market overview', tone: 'warm' }))
    }
    for (const p of plans) {
      const pi = cma.plans.findIndex(x => x.id === p.id)
      const n = planNumbers(cma, p)
      const pr = priceOf(p.price)
      const comps = p.compIds.map(id => cma.comps.find(x => x.id === id)).filter(Boolean) as PacketComp[]
      const cells: [string, string, string, boolean?][] = [
        ['Could earn, per year', range(n.lo, n.hi), 'Gross rental revenue, fully ramped', true],
        ['Per month, on average', dash(n.monthLo, n.monthHi), ''],
        ['Peak month', 'up to ' + money(n.peak), n.peakMonth + ', high end'],
        showNet ? ['Owner keeps, est.', dash(netOf(n.lo), netOf(n.hi)), 'a year, after fees'] : ['Nightly' + (p.suites > 1 ? ', per suite' : ''), money(n.nightlyLo) + '–' + money(n.nightlyHi), 'at ' + pctRange(p.occLo, p.occHi) + ' occupancy'],
      ]
      pages.push(page('plan-' + p.id, next(), (
        <>
          {canEdit ? <button type="button" className="mz-adjust" onClick={() => { setTuneId(p.id); setDrawer('proj') }}>Adjust projection</button> : null}
          <div className="mz-plan-top">
            <div>
              {kicker((short(building) ? short(building) + ' · ' : '') + 'Rental comparison')}
              {head(<E v={p.name} p={`cma.plans.${pi}.name`} />, 'xl')}
            </div>
            <dl className="mz-plan-facts">
              <div><dt>Interior</dt><dd><E v={p.sf} p={`cma.plans.${pi}.sf`} /></dd></div>
              <div><dt>From</dt><dd><E v={p.price || (canEdit && editText ? '' : '—')} p={`cma.plans.${pi}.price`} ph="Price" /></dd></div>
              {showYield && pr ? <div><dt>Gross yield</dt><dd>{pct1(n.lo / pr)}–{pct1(n.hi / pr)}</dd></div> : null}
              <div><dt>Rentals</dt><dd><E v={p.rules.replace(/^Short-term rentals allowed$/, 'Short-term allowed')} p={`cma.plans.${pi}.rules`} /></dd></div>
            </dl>
          </div>
          <div className="mz-hero-num">
            {cells.map(([l, v, s, main], i) => <div key={i} className={main ? 'mz-hero-main' : ''}><span>{l}</span><b>{v}</b>{s ? <small>{s}</small> : null}</div>)}
          </div>
          {kicker(chart === 'cumulative' ? 'The year, as it adds up' : 'Through the year')}
          <Chart months={n.months} kind={chart} />
          <p className="mz-legend"><i style={{ background: C.sand }} /> Low end <i style={{ background: C.navy }} /> High end <span>Seasonal shape from Miami market pricing data</span></p>
          {kicker('Against the comparable set')}
          {compsTable(comps, (
            <tr className="mz-us"><td><b>{(short(building) ? short(building) + ' ' : '') + p.name}</b></td><td>{area ? area + ', new build' : 'New build'}</td><td className="r"><b>{range(n.lo, n.hi)}</b></td><td className="r"><b>{money(n.nightlyLo)}–{money(n.nightlyHi)}</b></td><td className="r"><b>{pctRange(p.occLo, p.occHi)}</b></td></tr>
          ))}
          <p className="mz-how"><b>How we got there.</b> <E v={p.how} p={`cma.plans.${pi}.how`} block /> {n.manual ? 'The range was set by hand.' : `Ranges are then raised ${cma.uplift.lo}% at the low end and ${cma.uplift.hi}% at the high end, ${cma.uplift.why}`} {adjustLine(cma, p)}{showNet ? ` Owner estimate after ${channelPct}% channel fees and Stay’s ${mgmtPct}% management fee; cleaning and taxes are paid by guests.` : ''}</p>
        </>
      ), { section: 'Rental comparison' }))
    }
  }

  // ── Back cover ──
  pages.push(
    <section key="back" className="mz-page mz-backcover" style={{ backgroundImage: `linear-gradient(180deg, rgba(8,12,36,.55) 0%, rgba(8,12,36,.78) 45%, rgba(8,12,36,.95) 100%), url(${pic(4)})` }}>
      <img src="/stay-logo.png" alt="Stay Hospitality" className="mz-logo" />
      <div className="mz-back-main">
        {kicker(cma ? 'Next step' : 'Let’s talk', true)}
        <h2 className="mz-back-title"><CT k="backTitle" /></h2>
        <p className="mz-back-dek"><CT k="backDek" block /></p>
        {card.name || (canEdit && editText) ? (
          <div className="mz-contact">
            {card.photo ? <img src={card.photo} alt="" /> : <span className="mz-initials mz-initials-l">{String(card.name || '').split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2)}</span>}
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
    </section>,
  )

  // ── The builder drawer ──
  const tunePlan = cma && (cma.plans.find(x => x.id === tuneId) || cma.plans[0])
  const setPlan = (np: PacketPlan) => cma && setCma({ ...cma, plans: cma.plans.map(x => x.id === np.id ? np : x) })
  const setComp = (i: number, f: Partial<PacketComp>) => cma && setCma({ ...cma, comps: cma.comps.map((x, j) => j === i ? { ...x, ...f } : x) })
  const nIn = (v: string) => { const x = parseFloat(String(v).replace(/[$,%\s]/g, '')); return Number.isFinite(x) ? x : 0 }
  const setMag = (f: Any) => patch('magazine', { ...mag, ...f })
  const drawerEl = canEdit && drawer ? (
    <aside className="mz-drawer" aria-label="Builder">
      <div className="mz-drawer-head">
        <b>Builder</b>
        <button type="button" onClick={() => setDrawer(null)} aria-label="Close">×</button>
      </div>
      <div className="mz-seg">
        {([['proj', 'Projections'], ['comps', 'Comparables'], ['style', 'Style & data']] as const).map(([k, l]) => <button key={k} type="button" className={drawer === k ? 'on' : ''} onClick={() => setDrawer(k)}>{l}</button>)}
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
            <p className="mz-form-h">New-build uplift (every plan)</p>
            <label><span>Low end %</span><input inputMode="decimal" defaultValue={cma.uplift.lo} onBlur={e => setCma({ ...cma, uplift: { ...cma.uplift, lo: nIn(e.target.value) } })} /></label>
            <label><span>High end %</span><input inputMode="decimal" defaultValue={cma.uplift.hi} onBlur={e => setCma({ ...cma, uplift: { ...cma.uplift, hi: nIn(e.target.value) } })} /></label>
          </div>
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
          <p className="mz-drawer-note">Ranges built from a comparable move as soon as its low or high changes.</p>
        </>
      ) : <p className="mz-drawer-empty">This deck has no comparables yet.</p>)}

      {drawer === 'style' && (
        <div className="mz-style">
          <p className="mz-form-h">Style</p>
          <div className="mz-swatches">
            {Object.entries(MAG_THEMES).map(([k, t]) => (
              <button key={k} type="button" className={style === k ? 'on' : ''} onClick={() => setMag({ style: k })}>
                <span><i style={{ background: t.navy }} /><i style={{ background: t.sand }} /><i style={{ background: t.warm, border: '1px solid ' + t.rule }} /></span>{t.label}
              </button>
            ))}
          </div>
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
          {cma ? (
            <>
              <p className="mz-form-h">Sections</p>
              {([['partner', 'Agent partner program'], ['second', 'Stay as a second option'], ['market', 'Market and comparables'], ['glance', 'Floor plans at a glance'], ['plans', 'One page per floor plan']] as [keyof SalesCma['sections'], string][]).map(([k, l]) => (
                <label key={k} className="mz-toggle"><input type="checkbox" checked={!!cma.sections[k]} onChange={e => setCma({ ...cma, sections: { ...cma.sections, [k]: e.target.checked } })} /> {l}</label>
              ))}
            </>
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
    <div className={'mz-root' + (canEdit && editText ? ' mz-editing' : '') + (drawer ? ' mz-with-drawer' : '')} style={themeVars(style)}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;1,9..144,300;1,9..144,400&family=Josefin+Sans:wght@300;400;600&family=Inter:wght@400;500;600;700&display=swap" />
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
      {pages}
    </div>
  )
}

const CSS = `
.mz-root{background:${C.desk};min-height:100vh;padding:76px 16px 56px;font-family:${SANS};color:${C.body};-webkit-print-color-adjust:exact;print-color-adjust:exact;font-feature-settings:"kern","liga"}
.mz-root *{box-sizing:border-box}
.mz-with-drawer{padding-right:min(476px,100vw)}
.mz-bar-top{position:fixed;top:0;left:0;right:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px max(16px,env(safe-area-inset-left));background:${C.navy};color:#fff}
.mz-switch{display:inline-flex;background:rgba(255,255,255,.12);border-radius:999px;padding:3px}
.mz-switch b,.mz-switch a{font:600 12.5px ${SANS};padding:6px 15px;border-radius:999px;color:#fff;text-decoration:none}
.mz-switch b{background:#fff;color:${C.navy}}
.mz-bar-r{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.mz-bar-top button{font:600 12.5px ${SANS};background:#fff;color:${C.navy};border:0;border-radius:999px;padding:7px 15px;cursor:pointer}
.mz-bar-top .mz-ghost{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4)}
.mz-bar-top .mz-ghost.on{background:${C.glow};color:${C.ink};border-color:${C.glow}}
.mz-saved{font:500 12px ${SANS};color:rgba(255,255,255,.75)}

.mz-page{position:relative;width:8.5in;max-width:100%;height:11in;margin:0 auto 32px;background:${C.paper};box-shadow:0 1px 2px rgba(15,22,64,.06),0 18px 50px rgba(15,22,64,.16);display:flex;flex-direction:column;overflow:hidden}
.mz-warm{background:${C.warm}}
.mz-body{padding:.32in .8in .1in;flex:1;display:flex;flex-direction:column;min-height:0}
.mz-run{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;margin:.46in .8in 0;padding-bottom:9px;border-bottom:.6px solid ${C.rule};font:400 8.5px ${DISPLAY};letter-spacing:.26em;text-transform:uppercase;color:${C.muted}}
.mz-run span:last-child{text-align:right}
.mz-run-mark{font:400 12px ${DISPLAY};letter-spacing:.42em;color:${C.ink}}
.mz-run-mark.mz-on-dark{color:#fff}
.mz-foot{display:flex;justify-content:space-between;align-items:baseline;margin:0 .8in .42in;padding-top:9px;border-top:.6px solid ${C.rule};font:400 8.5px ${DISPLAY};letter-spacing:.22em;text-transform:uppercase;color:${C.muted}}
.mz-folio{font:400 15px ${SERIF};letter-spacing:0;color:${C.ink}}

.mz-kicker{font:600 9px ${DISPLAY};letter-spacing:.3em;text-transform:uppercase;color:${C.sand};margin:20px 0 9px;display:flex;align-items:center;gap:10px}
.mz-kicker::before{content:"";width:22px;height:1px;background:currentColor;opacity:.8}
.mz-kicker.mz-on-dark{color:${C.glow}}
.mz-head{font-family:${SERIF};font-weight:300;color:${C.ink};letter-spacing:-.018em;margin:0;text-wrap:balance;font-variation-settings:"opsz" 144}
.mz-head em,.mz-cover-title em,.mz-back-title em,.mz-opener-title em{font-style:italic;font-weight:300}
.mz-head-xl{font-size:46px;line-height:1.02}
.mz-head-l{font-size:36px;line-height:1.06}
.mz-head-m{font-size:28px;line-height:1.1}
.mz-on-dark{color:#fff}
.mz-dek{font:300 15.5px/1.5 ${SERIF};color:${C.body};max-width:58ch;margin:12px 0 0}
.mz-text{font-size:10.5px;line-height:1.7;margin:12px 0 0;max-width:72ch}
.mz-drop{font-size:11px;line-height:1.7;margin:14px 0 0}
.mz-drop>span:first-child{float:left;font:300 54px/0.82 ${SERIF};color:${C.ink};margin:6px 8px 0 0}

.mz-cover{background-size:cover;background-position:center 40%;color:#fff;padding:.55in .7in .6in;justify-content:space-between}
.mz-mast{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:.6px solid rgba(255,255,255,.4)}
.mz-logo{width:1.45in;filter:brightness(0) invert(1)}
.mz-mast-r{display:flex;flex-direction:column;align-items:flex-end;gap:4px;font:400 9.5px ${DISPLAY};letter-spacing:.3em;text-transform:uppercase;color:rgba(255,255,255,.88)}
.mz-cover-title{font-family:${SERIF};font-weight:300;font-size:86px;line-height:.92;letter-spacing:-.03em;margin:6px 0 0;font-variation-settings:"opsz" 144;text-wrap:balance}
.mz-cover-title em{display:block}
.mz-cover-dek{font:300 17px/1.45 ${SERIF};max-width:40ch;color:rgba(255,255,255,.92);margin:16px 0 0}
.mz-cover-inside{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:28px;padding-top:14px;border-top:.6px solid rgba(255,255,255,.4)}
.mz-cover-inside div{display:flex;gap:10px;align-items:baseline}
.mz-cover-inside b{font:300 22px ${SERIF};color:${C.glow}}
.mz-cover-inside span{font:400 9.5px ${DISPLAY};letter-spacing:.22em;text-transform:uppercase;color:#fff}
.mz-cover-for{font:400 9px ${DISPLAY};letter-spacing:.24em;text-transform:uppercase;color:rgba(255,255,255,.72);margin:18px 0 0}

.mz-contents{display:grid;grid-template-columns:2.6in 1fr;gap:.45in;flex:1;margin-top:.2in}
.mz-contents-photo{background-size:cover;background-position:center;border-radius:2px;min-height:100%}
.mz-contents-r{display:flex;flex-direction:column}
.mz-toc{list-style:none;padding:0;margin:16px 0 0;border-top:.6px solid ${C.rule}}
.mz-toc li{display:flex;gap:16px;align-items:baseline;padding:13px 0;border-bottom:.6px solid ${C.rule}}
.mz-toc-n{font:300 30px ${SERIF};color:${C.sand};min-width:40px}
.mz-toc b{display:block;font:400 17px ${SERIF};color:${C.ink}}
.mz-toc li span:not(.mz-toc-n){font-size:10px;color:${C.muted};line-height:1.5}
.mz-note{margin-top:auto;padding-top:20px}
.mz-note>p{font:300 italic 13px/1.65 ${SERIF};color:${C.body};margin:0}
.mz-note .mz-sign{font:400 normal 15px ${SERIF};color:${C.ink};margin-top:14px}
.mz-sign span{display:block;font:400 8.5px ${DISPLAY};letter-spacing:.24em;text-transform:uppercase;color:${C.muted};margin-top:4px}

.mz-stats{display:grid;grid-template-columns:repeat(4,1fr);margin:26px 0 6px;border-top:1px solid ${C.ink};border-bottom:.6px solid ${C.rule}}
.mz-stats div{padding:16px 12px 14px;border-left:.6px solid ${C.rule}}.mz-stats div:first-child{border-left:0;padding-left:0}
.mz-stats b{display:block;font:300 34px/1 ${SERIF};color:${C.ink};letter-spacing:-.02em}
.mz-stats span{display:block;margin-top:8px;font:400 8.5px ${DISPLAY};letter-spacing:.22em;text-transform:uppercase;color:${C.muted}}
.mz-points{display:grid;grid-template-columns:1fr 1fr;gap:16px 34px}
.mz-points>div{position:relative;padding-left:34px}
.mz-pt-n{position:absolute;left:0;top:-1px;font:300 17px ${SERIF};color:${C.sand}}
.mz-points b{font:400 15px ${SERIF};color:${C.ink}}
.mz-points p{font-size:10.3px;line-height:1.65;margin:5px 0 0}
.mz-team{display:grid;grid-template-columns:repeat(4,1fr);gap:22px 18px;margin-top:20px}
.mz-team figure{margin:0;display:flex;flex-direction:column;gap:10px}
.mz-team img,.mz-team .mz-initials{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:2px}
.mz-team-list{grid-template-columns:repeat(3,1fr);gap:14px 18px}
.mz-team-list figure{flex-direction:row;align-items:center;gap:12px}
.mz-team-list .mz-initials{width:46px;height:46px;aspect-ratio:auto;border-radius:999px;font-size:16px;flex:none}
.mz-initials{display:grid;place-items:center;background:${C.navy};color:${C.glow};font:300 34px ${SERIF}}
.mz-team b{display:block;font:400 14px ${SERIF};color:${C.ink}}
.mz-team figcaption span{font:400 8.5px ${DISPLAY};letter-spacing:.2em;text-transform:uppercase;color:${C.muted}}
.mz-pull{margin:26px 0 4px;padding:18px 0;border-top:1px solid ${C.ink};border-bottom:.6px solid ${C.rule};font:300 italic 22px/1.35 ${SERIF};color:${C.ink};text-wrap:balance}
.mz-terms{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:0 30px}
.mz-terms>div{padding:9px 0;border-top:.6px solid ${C.rule}}
.mz-terms dt{font:400 13px ${SERIF};color:${C.ink}}.mz-terms dd{margin:3px 0 0;font-size:10.2px;line-height:1.55}

.mz-opener{flex:1;background-size:cover;background-position:center;color:#fff;padding:.7in .8in .8in;display:flex;flex-direction:column;justify-content:space-between}
.mz-opener-num{font:200 150px/1 ${SERIF};color:rgba(255,255,255,.92);letter-spacing:-.04em}
.mz-opener-title{font-family:${SERIF};font-weight:300;font-size:52px;line-height:1.02;letter-spacing:-.025em;margin:0;max-width:12ch;text-wrap:balance}

.mz-split{display:grid;grid-template-columns:1fr 2.35in;gap:.35in}
.mz-cards{display:grid;gap:0;margin-top:16px;border-top:.6px solid ${C.rule}}
.mz-cards>div{padding:11px 0;border-bottom:.6px solid ${C.rule}}
.mz-cards b{font:400 14.5px ${SERIF};color:${C.ink}}.mz-cards p{font-size:10.2px;line-height:1.6;margin:4px 0 0}
.mz-fees{background:${C.navy};color:#fff;padding:22px 22px 20px;display:flex;flex-direction:column;align-self:start;margin-top:20px}
.mz-fees .mz-kicker{margin-top:0}
.mz-fee{padding:12px 0;border-bottom:.6px solid rgba(255,255,255,.18)}
.mz-fee b{display:block;font:300 38px/1 ${SERIF};letter-spacing:-.02em}
.mz-fee>span{font:400 8.5px ${DISPLAY};letter-spacing:.22em;text-transform:uppercase;color:rgba(255,255,255,.72)}
.mz-fees>p{font-size:9.8px;line-height:1.55;color:rgba(255,255,255,.78);margin:14px 0 0}
.mz-steps{list-style:none;padding:0;margin:4px 0 0;display:grid;gap:18px}
.mz-steps-4{grid-template-columns:repeat(4,1fr)}.mz-steps-3{grid-template-columns:repeat(3,1fr)}
.mz-steps li{border-top:1px solid ${C.ink};padding-top:10px}
.mz-steps li>span{font:300 24px ${SERIF};color:${C.sand}}
.mz-steps b{display:block;font:400 13.5px ${SERIF};color:${C.ink};margin-top:4px}
.mz-steps p{font-size:9.8px;line-height:1.55;margin:4px 0 0}
.mz-here{margin-top:auto;background:${C.sandSoft};padding:4px 18px 14px}
.mz-here ul{margin:0;padding-left:16px;display:grid;gap:4px}.mz-here li{font-size:10.2px;line-height:1.55}

.mz-qa{display:grid;grid-template-columns:1fr 1fr;gap:0 30px;margin-top:16px;border-top:1px solid ${C.ink}}
.mz-qa>div{padding:10px 0;border-bottom:.6px solid ${C.rule}}
.mz-q{font:400 italic 14px ${SERIF};color:${C.ink};margin:0}
.mz-a{font-size:10px;line-height:1.6;margin:4px 0 0}

.mz-cols{column-count:2;column-gap:30px;margin-top:16px}
.mz-col-item{break-inside:avoid;padding:10px 0;border-top:.6px solid ${C.rule}}
.mz-col-item b{font:400 14.5px ${SERIF};color:${C.ink}}.mz-col-item p{font-size:10.2px;line-height:1.62;margin:4px 0 0}
.mz-table{width:100%;border-collapse:collapse;font-size:9.6px;margin-top:2px}
.mz-table th{font:400 8px ${DISPLAY};letter-spacing:.2em;text-transform:uppercase;color:${C.muted};text-align:left;padding:0 10px 8px 0;border-bottom:1px solid ${C.ink}}
.mz-table td{padding:8px 10px 8px 0;border-bottom:.6px solid ${C.rule};vertical-align:top;line-height:1.45;font-variant-numeric:tabular-nums lining-nums}
.mz-table td b{font-weight:600;color:${C.ink}}
.mz-table .r{text-align:right}
.mz-table th:last-child,.mz-table td:last-child{padding-right:0}
.mz-table tr.mz-us td{background:${C.sandSoft};border-bottom:1px solid ${C.ink}}
.mz-table tr.mz-us td:first-child{padding-left:8px}

.mz-glance{margin-top:22px}
.mz-glance-axis{position:relative;height:16px;margin-left:2.05in;margin-right:1.75in;font:400 8px ${SANS};color:${C.muted}}
.mz-glance-axis i{position:absolute;transform:translateX(-50%);font-style:normal}
.mz-glance-row{display:grid;grid-template-columns:2.05in 1fr 1.75in;align-items:center;padding:9px 0;border-bottom:.6px solid ${C.rule}}
.mz-glance-name b{display:block;font:400 14px ${SERIF};color:${C.ink}}
.mz-glance-name span{font-size:8.8px;color:${C.muted}}
.mz-glance-track{position:relative;height:22px}
.mz-glance-track s{position:absolute;top:0;bottom:0;width:.6px;background:${C.rule}}
.mz-glance-track i{position:absolute;top:7px;height:8px;background:${C.navy};border-radius:99px}
.mz-glance-v{text-align:right}
.mz-glance-v b{display:block;font:400 12.5px ${SERIF};color:${C.ink};font-variant-numeric:tabular-nums lining-nums}
.mz-glance-v span{font-size:8.4px;color:${C.muted}}
.mz-read{margin-top:auto;padding-bottom:4px}
.mz-read p{font-size:10px;line-height:1.65;margin:0;max-width:80ch}

.mz-plan-top{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;padding-bottom:12px;border-bottom:1px solid ${C.ink}}
.mz-plan-facts{margin:0;display:flex;gap:16px;flex-wrap:wrap;justify-content:flex-end}
.mz-plan-top>div:first-child{min-width:0;flex:1}
.mz-plan-facts dt{white-space:nowrap;font:400 7.5px ${DISPLAY};letter-spacing:.24em;text-transform:uppercase;color:${C.muted}}
.mz-plan-facts dd{margin:3px 0 0;font:400 12.5px ${SERIF};color:${C.ink};white-space:nowrap}
.mz-hero-num{display:grid;grid-template-columns:1.55fr 1fr 1fr 1.1fr;margin-top:14px;border-bottom:.6px solid ${C.rule}}
.mz-hero-num>div{padding:12px 14px 14px;border-left:.6px solid ${C.rule}}
.mz-hero-num>div:first-child{border-left:0;padding-left:0}
.mz-hero-num span{display:block;font:400 7.8px ${DISPLAY};letter-spacing:.22em;text-transform:uppercase;color:${C.muted}}
.mz-hero-num b{display:block;font:300 17.5px/1.15 ${SERIF};color:${C.ink};margin-top:6px;font-variant-numeric:lining-nums;white-space:nowrap}
.mz-hero-num .mz-hero-main b{font-size:30px;letter-spacing:-.02em}
.mz-hero-num small{display:block;font-size:8.6px;color:${C.muted};margin-top:4px}
.mz-legend{display:flex;align-items:center;gap:6px;font:400 8px ${DISPLAY};letter-spacing:.18em;text-transform:uppercase;color:${C.muted};margin:2px 0 0}
.mz-legend i{display:inline-block;width:8px;height:8px;border-radius:1px}.mz-legend span{margin-left:auto}
.mz-how{font-size:9.4px;line-height:1.6;color:${C.muted};margin:10px 0 0}
.mz-how>b{font:400 italic 11px ${SERIF};color:${C.ink}}

.mz-backcover{background-size:cover;background-position:center;color:#fff;padding:.6in .8in .55in;justify-content:space-between}
.mz-back-main{display:flex;flex-direction:column}
.mz-back-title{font-family:${SERIF};font-weight:300;font-size:46px;line-height:1.04;letter-spacing:-.025em;margin:0;max-width:15ch;text-wrap:balance}
.mz-back-title em{color:${C.glow}}
.mz-back-dek{font:300 15px/1.55 ${SERIF};color:rgba(255,255,255,.86);max-width:46ch;margin:16px 0 0}
.mz-contact{display:flex;gap:18px;align-items:center;margin-top:30px;padding-top:20px;border-top:.6px solid rgba(255,255,255,.35)}
.mz-contact .mz-initials-l{display:grid}
.mz-contact img,.mz-initials-l{width:78px;height:78px;border-radius:999px;object-fit:cover;font-size:26px;flex:none}
.mz-contact b{display:block;font:400 22px ${SERIF}}
.mz-contact div>span{display:block;font-size:11.5px;color:rgba(255,255,255,.86);margin-top:3px}
.mz-contact .mz-contact-role{font:400 8.5px ${DISPLAY};letter-spacing:.24em;text-transform:uppercase;color:${C.glow};margin:4px 0 8px}
.mz-sel{user-select:all}
.mz-fine{font-size:8px;line-height:1.6;color:rgba(255,255,255,.58);max-width:80ch;margin:0}

/* editing */
.mz-ed{outline:1px dashed rgba(58,91,217,.55);outline-offset:2px;border-radius:2px;cursor:text;min-width:1ch;display:inline}
div.mz-ed{display:inline}
.mz-ed:hover{background:rgba(58,91,217,.07)}
.mz-ed:focus{outline:2px solid #3A5BD9;background:rgba(255,255,255,.92);color:#0F1640}
.mz-ed:empty::before{content:attr(data-ph);opacity:.45}
.mz-adjust{position:absolute;top:.5in;right:.8in;z-index:5;font:600 11px ${SANS};background:${C.navy};color:#fff;border:0;border-radius:999px;padding:6px 12px;cursor:pointer;box-shadow:0 4px 14px rgba(17,26,74,.25)}

/* drawer */
.mz-drawer{position:fixed;top:56px;right:0;bottom:0;z-index:30;width:min(460px,100vw);background:#fff;box-shadow:-18px 0 50px rgba(15,22,64,.18);padding:16px 20px 24px;overflow-y:auto;font-family:${SANS};color:#0F1640}
.mz-drawer-head{display:flex;justify-content:space-between;align-items:center}
.mz-drawer-head b{font:400 22px ${SERIF}}
.mz-drawer-head button{border:0;background:none;font-size:24px;line-height:1;color:#80859A;cursor:pointer}
.mz-seg{display:grid;grid-template-columns:repeat(3,1fr);background:#F1F0EC;border-radius:10px;padding:3px;margin-top:12px}
.mz-seg button{font:600 12px ${SANS};border:0;background:none;border-radius:8px;padding:7px 4px;color:#4b5068;cursor:pointer}
.mz-seg button.on{background:#fff;color:#0F1640;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.mz-drawer-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.mz-drawer-tabs button{font:600 11.5px ${SANS};padding:5px 10px;border-radius:999px;border:1px solid #E3DED3;background:#fff;color:#0F1640;cursor:pointer}
.mz-drawer-tabs button.on{background:#111A4A;color:#fff;border-color:#111A4A}
.mz-drawer-all{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;margin-top:14px;padding:10px 12px;background:#FAF7F1;border-radius:10px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#80859A}
.mz-drawer-all input{accent-color:#111A4A}.mz-drawer-all b{color:#0F1640;font-size:13px;letter-spacing:0}
.mz-drawer-plan{font:300 26px ${SERIF};margin:18px 0 8px}
.mz-form{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px;margin-top:14px}
.mz-form label{display:flex;flex-direction:column;gap:3px;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#80859A}
.mz-form .wide{grid-column:1/-1}
.mz-form input,.mz-form select{width:100%;font:500 13px ${SANS};text-transform:none;letter-spacing:0;color:#0F1640;border:1px solid #E3DED3;border-radius:8px;padding:6px 8px;background:#fff;min-width:0}
.mz-form-h{grid-column:1/-1;font:700 10.5px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:#80859A;margin:16px 0 2px}
.mz-checks{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;text-transform:none;letter-spacing:0;color:#0F1640}
.mz-checks>span{flex-basis:100%;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#80859A}
.mz-checks label{flex-direction:row;align-items:center;gap:5px;font-size:12px;font-weight:500;text-transform:none;letter-spacing:0;color:#0F1640}
.mz-comp{padding:12px;border:1px solid #E3DED3;border-radius:12px}
.mz-remove{font:600 11.5px ${SANS};color:#B4232F;background:none;border:0;text-align:left;padding:2px 0;cursor:pointer}
.mz-add{margin-top:12px;font:600 12.5px ${SANS};border:1px dashed #B59A6A;background:#FAF7F1;color:#0F1640;border-radius:10px;padding:9px;width:100%;cursor:pointer}
.mz-swatches{display:grid;gap:8px;margin-top:6px}
.mz-swatches button{display:flex;align-items:center;gap:12px;font:600 12.5px ${SANS};color:#0F1640;background:#fff;border:1px solid #E3DED3;border-radius:10px;padding:9px 12px;cursor:pointer;text-align:left}
.mz-swatches button.on{border-color:#0F1640;box-shadow:0 0 0 1px #0F1640}
.mz-swatches span{display:flex}.mz-swatches i{width:20px;height:20px;border-radius:999px;margin-right:-5px;border:2px solid #fff}
.mz-toggle{display:flex;align-items:center;gap:8px;font-size:13px;margin:8px 0 0;color:#0F1640}
.mz-drawer-note,.mz-drawer-empty{font-size:12px;color:#80859A;margin:14px 0 0;line-height:1.5}
.mz-drawer-foot{margin-top:18px;padding-top:14px;border-top:1px solid #E3DED3;display:flex;flex-wrap:wrap;gap:8px;align-items:center;position:sticky;bottom:-24px;background:#fff;padding-bottom:14px}
.mz-drawer-foot button{font:600 12.5px ${SANS};background:#111A4A;color:#fff;border:0;border-radius:999px;padding:8px 16px;cursor:pointer}
.mz-drawer-foot button:disabled{opacity:.45;cursor:default}
.mz-drawer-foot .mz-ghost-d{background:#fff;color:#0F1640;border:1px solid #E3DED3}
.mz-drawer-foot p{flex-basis:100%;font-size:11px;color:#80859A;margin:2px 0 0}

@media screen and (max-width:700px){
  .mz-with-drawer{padding-right:16px}
  .mz-page{height:auto;min-height:0;width:100%}
  .mz-body{padding-left:18px;padding-right:18px}.mz-run,.mz-foot{margin-left:18px;margin-right:18px}
  .mz-cover,.mz-backcover,.mz-opener{min-height:86vh;padding:26px 18px}
  .mz-cover-title{font-size:54px}.mz-opener-num{font-size:96px}.mz-opener-title{font-size:38px}
  .mz-head-xl{font-size:36px}.mz-head-l{font-size:30px}
  .mz-points,.mz-split,.mz-team,.mz-terms,.mz-qa,.mz-steps-4,.mz-steps-3,.mz-contents,.mz-cover-inside{grid-template-columns:1fr}
  .mz-contents-photo{min-height:220px}
  .mz-stats,.mz-hero-num{grid-template-columns:1fr 1fr}.mz-cols{column-count:1}
  .mz-table{display:block;overflow-x:auto}
  .mz-plan-top{flex-direction:column;align-items:flex-start}.mz-plan-facts{flex-wrap:wrap}
  .mz-glance-axis{display:none}.mz-glance-row{grid-template-columns:1fr;gap:6px}.mz-glance-v{text-align:left}
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
