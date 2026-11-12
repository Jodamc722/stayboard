'use client'
// CUSTOM GRAPHICS FOR THE SALES MAGAZINE (Jon, 2026-11-11: "can we build some custom graphics to
// enhance, not just use our images"). Drawn, not photographed, so they print crisp at any size, take
// the theme's colours (CSS variables from components/SalesMagazine), and are built from our own data:
//
//   StayTimeline — one stay, start to finish, from the ops rows the deck already carries.
//   YearWave     — the Miami year as a landscape, from the same seasonal curve the projections use,
//                  with the Art Basel and New Year's peak marked.
//   ChannelHub   — one calendar fanning out to the platforms the deck lists.
import React from 'react'
import { SEASON, MONTHS } from '@/lib/sales-cma'
import qrcode from 'qrcode-generator'

const V = { ink: 'var(--mz-ink)', navy: 'var(--mz-navy)', sand: 'var(--mz-sand)', glow: 'var(--mz-glow)', rule: 'var(--mz-grid)', muted: 'var(--mz-muted)', warm: 'var(--mz-warm)' }
const SERIF = 'var(--mz-display)'
const SANS = 'var(--mz-sans, "Inter", system-ui, sans-serif)'

/** A smooth path through points (Catmull-Rom to cubic Bézier). */
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return ''
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`
  }
  return d
}

/** One stay, start to finish: a vertical line of moments on the brand colour. */
export function StayTimeline({ steps, title = 'One stay, start to finish', note = 'Our own team, on every stay.', tags }: { steps: { k: string; v?: string }[]; title?: string; note?: string; tags?: string[] }) {
  const TAGS = ['THE NIGHT BEFORE', 'AT CHECK-OUT', 'BEFORE ARRIVAL', 'AS IT HAPPENS', 'AROUND THE CLOCK', 'RESOLVED QUICKLY'].map((d, i) => (tags && tags[i] ? tags[i].toUpperCase() : d))
  const list = steps.slice(0, 6)
  const W = 304, H = 1056, top = 250, bottom = 150
  const gap = (H - top - bottom) / Math.max(1, list.length - 1)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-label={title} style={{ display: 'block' }}>
      <rect width={W} height={H} style={{ fill: V.navy }} />
      {/* fine contour lines: a quiet texture, like an architect's elevation */}
      {Array.from({ length: 14 }).map((_, i) => (
        <path key={i} d={smooth(Array.from({ length: 7 }).map((__, j) => [j * (W / 6), 90 + i * 70 + Math.sin(j * 1.1 + i * 0.7) * 16] as [number, number]))} style={{ fill: 'none', stroke: '#fff', opacity: 0.045 }} strokeWidth={1} />
      ))}
      <text x={40} y={110} fontFamily={SANS} fontSize={10} fontWeight={600} letterSpacing="2.2" style={{ fill: V.glow }}>HOW A STAY RUNS</text>
      <text x={40} y={152} fontFamily={SERIF} fontSize={30} fontWeight={300} style={{ fill: '#fff' }}>{title.split(',')[0]}{title.includes(',') ? ',' : ''}</text>
      {title.includes(',') ? <text x={40} y={188} fontFamily={SERIF} fontSize={30} fontWeight={300} fontStyle="italic" style={{ fill: V.glow }}>{title.split(',').slice(1).join(',').trim()}</text> : null}
      <line x1={58} x2={58} y1={top} y2={top + gap * (list.length - 1)} style={{ stroke: V.glow, opacity: 0.55 }} strokeWidth={1.25} />
      {list.map((s, i) => {
        const y = top + gap * i
        return (
          <g key={i}>
            <circle cx={58} cy={y} r={15} style={{ fill: V.navy, stroke: V.glow }} strokeWidth={1.25} />
            <text x={58} y={y + 4.5} textAnchor="middle" fontFamily={SERIF} fontSize={13} style={{ fill: V.glow }}>{String(i + 1).padStart(2, '0')}</text>
            {(() => { const w = s.k.split(' '); const lines: string[] = ['']; for (const x of w) { if ((lines[lines.length - 1] + ' ' + x).trim().length > 20) lines.push(x); else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + x).trim() } return lines.slice(0, 2).map((l, j) => <text key={j} x={88} y={y - 2 + j * 21 - (lines.length > 1 ? 10 : 0)} fontFamily={SERIF} fontSize={18} style={{ fill: '#fff' }}>{l}</text>) })()}
            <text x={88} y={y + 18 + (s.k.length > 20 ? 11 : 0)} fontFamily={SANS} fontSize={9.5} fontWeight={600} letterSpacing="1.6" style={{ fill: '#fff', opacity: 0.55 }}>{TAGS[i] || ''}</text>
          </g>
        )
      })}
      <text x={40} y={H - 70} fontFamily={SERIF} fontSize={13} fontStyle="italic" style={{ fill: '#fff', opacity: 0.7 }}>{note}</text>
    </svg>
  )
}

/** The Miami year as a landscape: the seasonal curve, filled, with its peaks named. */
export function YearWave({ shape = SEASON, title, kicker }: { shape?: number[]; title: React.ReactNode; kicker: string }) {
  const W = 816, H = 1056, base = 820, amp = 330, x0 = 0, x1 = W
  const max = Math.max(...shape)
  const xs = (i: number) => 40 + (i + 0.5) * ((W - 80) / 12)
  const pts: [number, number][] = shape.map((v, i) => [xs(i), base - (v / max) * amp])
  const wave = smooth([[x0, base - (shape[0] / max) * amp * 0.9], ...pts, [x1, base - (shape[11] / max) * amp * 0.95]])
  const echo = (k: number, o: number) => smooth([[x0, base - (shape[0] / max) * amp * 0.9 * k + o], ...pts.map(([x, y]) => [x, base - (base - y) * k + o] as [number, number]), [x1, base - (shape[11] / max) * amp * 0.95 * k + o]])
  const pk = shape.indexOf(max)
  const sorted = shape.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0])
  const second = sorted.find(([, i]) => Math.abs(i - pk) > 2)?.[1] ?? 2
  const low = shape.indexOf(Math.min(...shape))
  const mark = (i: number, label: string, sub: string, below?: boolean) => {
    const [x, y] = pts[i]
    const right = x < W / 2
    const ty = below ? y + 70 : y - 64
    return (
      <g>
        <line x1={x} x2={x} y1={y} y2={below ? y + 52 : y - 64} style={{ stroke: '#fff', opacity: 0.6 }} strokeWidth={1} />
        <circle cx={x} cy={y} r={5} style={{ fill: '#fff' }} />
        <text x={right ? x + 10 : x - 10} y={ty} textAnchor={right ? 'start' : 'end'} fontFamily={SERIF} fontSize={19} style={{ fill: '#fff' }}>{label}</text>
        <text x={right ? x + 10 : x - 10} y={ty + 18} textAnchor={right ? 'start' : 'end'} fontFamily={SANS} fontSize={9.5} fontWeight={600} letterSpacing="1.6" style={{ fill: V.glow }}>{sub}</text>
      </g>
    )
  }
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }} aria-hidden>
        <rect width={W} height={H} style={{ fill: V.navy }} />
        {[0.55, 0.72, 0.86].map((k, i) => <path key={i} d={echo(k, -40 - i * 26)} style={{ fill: 'none', stroke: V.glow, opacity: 0.12 + i * 0.05 }} strokeWidth={1} />)}
        <path d={wave + ` L${x1},${H} L${x0},${H} Z`} style={{ fill: '#fff', opacity: 0.06 }} />
        <path d={wave} style={{ fill: 'none', stroke: V.glow }} strokeWidth={2} />
        {MONTHS.map((m, i) => (
          <g key={m}>
            <line x1={xs(i)} x2={xs(i)} y1={base + 40} y2={base + 48} style={{ stroke: '#fff', opacity: 0.4 }} />
            <text x={xs(i)} y={base + 66} textAnchor="middle" fontFamily={SANS} fontSize={10} fontWeight={600} letterSpacing="1.4" style={{ fill: '#fff', opacity: 0.6 }}>{m.toUpperCase()}</text>
          </g>
        ))}
        {mark(pk, pk === 11 ? 'Art Basel and New Year' : 'The peak', 'THE HIGHEST MONTH')}
        {mark(second, 'Winter season', 'THE SECOND PEAK')}
        {mark(low, 'The quiet weeks', 'PRICED FOR OCCUPANCY', true)}
      </svg>
      <div style={{ position: 'absolute', left: 72, right: 72, top: 64 }}>
        <p className="mz-kicker mz-on-dark">{kicker}</p>
        <h2 className="mz-opener-title" style={{ color: '#fff' }}>{title}</h2>
        <p style={{ font: `300 18px/1.5 ${SERIF}`, color: 'rgba(255,255,255,.82)', maxWidth: '26em', margin: '20px 0 0' }}>How demand moves through a Miami year: the same seasonal pattern behind every projection here.</p>
      </div>
    </div>
  )
}

/** One calendar, every platform: the home at the centre, the channels in two columns around it. */
export function ChannelHub({ channels, count }: { channels: string[]; count: string }) {
  const list = channels.slice(0, 8)
  const W = 672, H = 132, cx = 70, cy = H / 2, r = 58
  const cols = [236, 456], rows = Math.ceil(list.length / 2)
  const rowH = (H - 12) / Math.max(1, rows)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={'One calendar, live on ' + count + ' platforms'}>
      {list.map((c, i) => {
        const col = i < rows ? 0 : 1, row = col ? i - rows : i
        const x = cols[col], y = 6 + rowH * row + rowH / 2
        return (
          <g key={c}>
            <path d={`M${cx + r},${cy} C${cx + r + 60},${cy} ${x - 70},${y} ${x - 8},${y}`} style={{ fill: 'none', stroke: V.rule }} strokeWidth={1.1} />
            <circle cx={x - 4} cy={y} r={3} style={{ fill: V.sand }} />
            <text x={x + 8} y={y + 5} fontFamily={SERIF} fontSize={16} style={{ fill: V.ink }}>{c}</text>
          </g>
        )
      })}
      <circle cx={cx} cy={cy} r={r} style={{ fill: V.navy }} />
      <text x={cx} y={cy - 8} textAnchor="middle" fontFamily={SERIF} fontSize={15} style={{ fill: '#fff' }}>One calendar</text>
      <text x={cx} y={cy + 16} textAnchor="middle" fontFamily={SERIF} fontSize={20} style={{ fill: V.glow }}>{count}</text>
      <text x={cx} y={cy + 30} textAnchor="middle" fontFamily={SANS} fontSize={8} fontWeight={600} letterSpacing="1.4" style={{ fill: '#fff', opacity: 0.7 }}>PLATFORMS</text>
    </svg>
  )
}

// ── The year, month by month (moved here from SalesMagazine so the keynote draws the same chart) ──
export type ChartKind = 'line' | 'bars' | 'band' | 'cumulative'
const CC = { ink: 'var(--mz-ink)', muted: 'var(--mz-muted)', navy: 'var(--mz-navy)', grid: 'var(--mz-grid)' }
/** Monthly gross rental income, low and high end; the magazine's chart styles. */
export function YearChart({ months, kind, h = 210, w = 688 }: { months: { lo: number; hi: number }[]; kind: ChartKind; h?: number; w?: number }) {
  // Information-design audit (2026-11-11): one column per month, not paired bars — solid to the low
  // end, lighter from low to high, so it reads "at least X, up to Y". Four gridlines, axis labels
  // sitting on them at the left (FT style), and values only where the eye needs them: peak and trough.
  const W = w, H = h, T = 22, B = kind === 'line' ? 44 : 24, L = 40
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
          <line x1={L - 4} x2={W} y1={y(v)} y2={y(v)} style={{ stroke: CC.grid }} strokeWidth={1} shapeRendering="crispEdges" />
          <text x={0} y={y(v) + 4} fontSize={10.5} style={{ fill: CC.muted }} fontFamily={SANS}>{'$' + (v >= 1000 ? (v / 1000) + 'K' : v)}</text>
        </g>
      ))}
      <line x1={L - 4} x2={W} y1={y(0)} y2={y(0)} style={{ stroke: CC.ink }} strokeWidth={1.25} shapeRendering="crispEdges" />
    </g>
  )
  const axis = MONTHS.map((m, i) => <text key={m} x={cx(i)} y={H - 6} textAnchor="middle" fontSize={10.5} style={{ fill: CC.muted }} fontFamily={SANS} letterSpacing="0.06em">{m.toUpperCase()}</text>)
  const label = (i: number, text: string) => <text x={cx(i)} y={y(series[i].hi) - 7} textAnchor="middle" fontSize={11} fontWeight={600} style={{ fill: CC.ink }} fontFamily={SANS}>{text}</text>
  if (kind === 'bars') {
    const bw = 30
    return (
      <svg className="mz-chart-svg" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Monthly gross rental income, low and high end">
        {grid}
        {months.map((m, i) => (
          <g key={i}>
            <rect x={cx(i) - bw / 2} y={y(m.lo)} width={bw} height={y(0) - y(m.lo)} style={{ fill: CC.navy }} />
            <rect x={cx(i) - bw / 2} y={y(m.hi)} width={bw} height={y(m.lo) - y(m.hi)} style={{ fill: CC.navy, opacity: 0.3 }} />
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
      return <text x={cx(i) + dx} y={below ? y(series[i].lo) + 20 : y(series[i].hi) - 12} textAnchor={anchor} fontSize={15} fontStyle="italic" style={{ fill: below ? CC.muted : CC.ink }} fontFamily={SERIF}>{text}</text>
    }
    return (
      <svg className="mz-chart-svg" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Monthly gross rental income, low and high end">
        {ticks.map(v => <g key={v}><line x1={L - 4} x2={W} y1={y(v)} y2={y(v)} style={{ stroke: CC.grid, opacity: 0.55 }} strokeWidth={0.75} shapeRendering="crispEdges" /><text x={0} y={y(v) + 4} fontSize={9.5} style={{ fill: CC.muted }} fontFamily={SANS} letterSpacing="0.06em">{'$' + (v >= 1000 ? (v / 1000) + 'K' : v)}</text></g>)}
        <path d={smooth('lo')} style={{ fill: 'none', stroke: CC.muted }} strokeWidth={1} strokeDasharray="2 3" />
        <path d={smooth('hi')} style={{ fill: 'none', stroke: CC.ink }} strokeWidth={1.3} />
        {series.map((m, i) => <circle key={i} cx={cx(i)} cy={y(m.hi)} r={i === pk || i === tr ? 3.6 : 1.7} style={{ fill: CC.ink }} />)}
        {note(pk, `${MONTH[pk]}, up to ${k$(series[pk].hi)}`)}
        {tr !== pk ? note(tr, `${MONTH[tr]}, the quiet month`, true) : null}
        {MONTHS.map((m, i) => <text key={m} x={cx(i)} y={H - 6} textAnchor="middle" fontSize={9.5} style={{ fill: CC.muted }} fontFamily={SANS} letterSpacing="0.2em">{m.toUpperCase()}</text>)}
      </svg>
    )
  }
  const band = series.map((m, i) => (i ? 'L' : 'M') + cx(i) + ' ' + y(m.hi)).join(' ') + ' ' + series.slice().reverse().map((m, j) => 'L' + cx(11 - j) + ' ' + y(m.lo)).join(' ') + ' Z'
  const ends = kind === 'cumulative' ? [11] : [pk, tr]
  return (
    <svg className="mz-chart-svg" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={kind === 'cumulative' ? 'Running total of gross rental income through the year' : 'Monthly gross rental income range'}>
      {grid}
      <path d={band} style={{ fill: CC.navy, opacity: 0.16 }} />
      <path d={line('lo')} style={{ fill: 'none', stroke: CC.navy, opacity: 0.55 }} strokeWidth={1.5} />
      <path d={line('hi')} style={{ fill: 'none', stroke: CC.navy }} strokeWidth={2.25} />
      {series.map((m, i) => <circle key={i} cx={cx(i)} cy={y(m.hi)} r={ends.includes(i) ? 4 : 2.5} style={{ fill: CC.navy }} />)}
      {ends.filter((v, i, a) => a.indexOf(v) === i).map(i => <g key={i}>{label(i, k$(series[i].lo) + '–' + k$(series[i].hi))}</g>)}
      {axis}
    </svg>
  )
}


// ── THE SAME GRAPHICS, DRAWN FOR A 16:9 SLIDE (Jon, 2026-11-12: "the keynote should flow similar
// graphics and look but designed for presentations"). The keynote wraps them in mzVars() so the
// magazine's CSS variables resolve to the deck's own theme.

/** The magazine's CSS variables, from a keynote theme. */
export function mzVars(t: any, display: string): React.CSSProperties {
  return {
    ['--mz-ink' as any]: t.ink, ['--mz-body' as any]: t.body, ['--mz-muted' as any]: t.muted,
    ['--mz-navy' as any]: t.band, ['--mz-sand' as any]: t.accent, ['--mz-glow' as any]: t.accent,
    ['--mz-grid' as any]: t.rule, ['--mz-rule' as any]: t.rule, ['--mz-warm' as any]: t.chip,
    ['--mz-display' as any]: display, ['--mz-sans' as any]: '"Inter", system-ui, sans-serif',
  }
}

/** One stay, start to finish, across the slide: six moments on one line, each with its tag. */
export function StayTimelineWide({ steps, tags }: { steps: { k: string; v?: string }[]; tags?: string[] }) {
  const TAGS = ['THE NIGHT BEFORE', 'AT CHECK-OUT', 'BEFORE ARRIVAL', 'AS IT HAPPENS', 'AROUND THE CLOCK', 'RESOLVED QUICKLY'].map((d, i) => (tags && tags[i] ? tags[i].toUpperCase() : d))
  const list = steps.slice(0, 6)
  const n = Math.max(1, list.length)
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', left: `${50 / n}%`, right: `${50 / n}%`, top: 17, height: 1, background: V.glow, opacity: 0.55 }} />
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 18, position: 'relative' }}>
        {list.map((s, i) => (
          <div key={i} style={{ textAlign: 'center', minWidth: 0 }}>
            <div style={{ width: 34, height: 34, margin: '0 auto', borderRadius: 99, border: '1.25px solid', borderColor: V.glow, background: V.navy, color: V.glow, fontFamily: SERIF, fontSize: 14, lineHeight: '32px', fontVariantNumeric: 'lining-nums' }}>{String(i + 1).padStart(2, '0')}</div>
            <p style={{ fontFamily: SANS, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.16em', color: '#fff', opacity: 0.55, margin: '16px 0 0' }}>{TAGS[i] || ''}</p>
            <p style={{ fontFamily: SERIF, fontSize: 21, lineHeight: 1.15, color: '#fff', margin: '8px 0 0', textWrap: 'balance' as any }}>{s.k}</p>
            {s.v ? <p style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.5, color: 'rgba(255,255,255,.66)', margin: '10px 0 0' }}>{s.v.length > 150 ? s.v.slice(0, 147).replace(/\s+\S*$/, '') + '…' : s.v}</p> : null}
          </div>
        ))}
      </div>
    </div>
  )
}

/** The Miami year as a landscape, 16:9: the seasonal curve with its peaks named. Fills its box. */
export function YearWaveWide({ shape = SEASON }: { shape?: number[] }) {
  const W = 1120, H = 630, base = 520, amp = 230
  const max = Math.max(...shape)
  const xs = (i: number) => 380 + (i + 0.5) * ((W - 420) / 12)
  const pts: [number, number][] = shape.map((v, i) => [xs(i), base - (v / max) * amp])
  const wave = smooth([[0, base - (shape[0] / max) * amp * 0.55], [300, base - (shape[0] / max) * amp * 0.8], ...pts, [W, base - (shape[11] / max) * amp * 0.95]])
  const pk = shape.indexOf(max)
  const sorted = shape.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0])
  const second = sorted.find(([, i]) => Math.abs(i - pk) > 2)?.[1] ?? 2
  const low = shape.indexOf(Math.min(...shape))
  const mark = (i: number, label: string, sub: string, below?: boolean) => {
    const [x, y] = pts[i]
    const right = x < W - 200
    const ty = below ? y + 64 : y - 58
    return (
      <g>
        <line x1={x} x2={x} y1={y} y2={below ? y + 46 : y - 58} style={{ stroke: '#fff', opacity: 0.6 }} strokeWidth={1} />
        <circle cx={x} cy={y} r={4.5} style={{ fill: '#fff' }} />
        <text x={right ? x + 10 : x - 10} y={ty} textAnchor={right ? 'start' : 'end'} fontFamily={SERIF} fontSize={18} style={{ fill: '#fff' }}>{label}</text>
        <text x={right ? x + 10 : x - 10} y={ty + 17} textAnchor={right ? 'start' : 'end'} fontFamily={SANS} fontSize={9} fontWeight={600} letterSpacing="1.6" style={{ fill: V.glow }}>{sub}</text>
      </g>
    )
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }} aria-hidden>
      <rect width={W} height={H} style={{ fill: V.navy }} />
      {[0.55, 0.72, 0.86].map((k, i) => <path key={i} d={smooth([[0, base - (shape[0] / max) * amp * 0.55 * k - 30 - i * 22], ...pts.map(([x, y]) => [x, base - (base - y) * k - 30 - i * 22] as [number, number]), [W, base - (shape[11] / max) * amp * 0.95 * k - 30 - i * 22]])} style={{ fill: 'none', stroke: V.glow, opacity: 0.12 + i * 0.05 }} strokeWidth={1} />)}
      <path d={wave + ` L${W},${H} L0,${H} Z`} style={{ fill: '#fff', opacity: 0.06 }} />
      <path d={wave} style={{ fill: 'none', stroke: V.glow }} strokeWidth={2} />
      {MONTHS.map((m, i) => <text key={m} x={xs(i)} y={base + 70} textAnchor="middle" fontFamily={SANS} fontSize={9.5} fontWeight={600} letterSpacing="1.4" style={{ fill: '#fff', opacity: 0.6 }}>{m.toUpperCase()}</text>)}
      {mark(pk, pk === 11 ? 'Art Basel and New Year' : 'The peak', 'THE HIGHEST MONTH')}
      {mark(second, 'Winter season', 'THE SECOND PEAK')}
      {mark(low, 'The quiet weeks', 'PRICED FOR OCCUPANCY', true)}
    </svg>
  )
}

/** A QR code as crisp SVG (Jon, 2026-11-12: "add a QR code to the print-out, to the digital version").
 *  Drawn as one path, so it prints sharp at any size; error level M survives a fold or a smudge. */
export function QrCode({ text, size = 96, fg = '#101114', bg = '#fff', label }: { text: string; size?: number; fg?: string; bg?: string; label?: string }) {
  const qr = React.useMemo(() => { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q }, [text])
  const n = qr.getModuleCount(), m = 2   // a two-module quiet zone; the tile around it adds the rest
  let d = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m},${r + m}h1v1h-1z`
  return (
    <svg viewBox={`0 0 ${n + m * 2} ${n + m * 2}`} width={size} height={size} role="img" aria-label={label || 'QR code: ' + text} shapeRendering="crispEdges" style={{ display: 'block' }}>
      <rect width={n + m * 2} height={n + m * 2} fill={bg} />
      <path d={d} fill={fg} />
    </svg>
  )
}
