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

const V = { ink: 'var(--mz-ink)', navy: 'var(--mz-navy)', sand: 'var(--mz-sand)', glow: 'var(--mz-glow)', rule: 'var(--mz-grid)', muted: 'var(--mz-muted)', warm: 'var(--mz-warm)' }
const SERIF = 'var(--mz-display)'
const SANS = '"Inter", system-ui, sans-serif'

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
export function StayTimeline({ steps, title = 'One stay, start to finish' }: { steps: { k: string; v?: string }[]; title?: string }) {
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
            <text x={88} y={y - 2} fontFamily={SERIF} fontSize={18} style={{ fill: '#fff' }}>{s.k.length > 26 ? s.k.slice(0, 25) + '…' : s.k}</text>
            <text x={88} y={y + 16} fontFamily={SANS} fontSize={9.5} fontWeight={600} letterSpacing="1.6" style={{ fill: '#fff', opacity: 0.55 }}>{['THE NIGHT BEFORE', 'ON DEPARTURE', 'BEFORE ARRIVAL', 'AS IT HAPPENS', 'AROUND THE CLOCK', 'IN SECONDS'][i] || ''}</text>
          </g>
        )
      })}
      <text x={40} y={H - 70} fontFamily={SERIF} fontSize={13} fontStyle="italic" style={{ fill: '#fff', opacity: 0.7 }}>Our own team, on every stay.</text>
    </svg>
  )
}

/** The Miami year as a landscape: the seasonal curve, filled, with its peaks named. */
export function YearWave({ shape = SEASON, title, kicker }: { shape?: number[]; title: React.ReactNode; kicker: string }) {
  const W = 816, H = 1056, base = 820, amp = 330, x0 = 0, x1 = W
  const max = Math.max(...shape)
  const xs = (i: number) => x0 + (i + 0.5) * ((x1 - x0) / 12)
  const pts: [number, number][] = shape.map((v, i) => [xs(i), base - (v / max) * amp])
  const wave = smooth([[x0, base - (shape[0] / max) * amp * 0.9], ...pts, [x1, base - (shape[11] / max) * amp * 0.95]])
  const echo = (k: number, o: number) => smooth([[x0, base - (shape[0] / max) * amp * 0.9 * k + o], ...pts.map(([x, y]) => [x, base - (base - y) * k + o] as [number, number]), [x1, base - (shape[11] / max) * amp * 0.95 * k + o]])
  const pk = shape.indexOf(max)
  const sorted = shape.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0])
  const second = sorted.find(([, i]) => Math.abs(i - pk) > 2)?.[1] ?? 2
  const low = shape.indexOf(Math.min(...shape))
  const mark = (i: number, label: string, sub: string) => {
    const [x, y] = pts[i]
    const right = x < W / 2
    return (
      <g>
        <line x1={x} x2={x} y1={y} y2={y - 64} style={{ stroke: '#fff', opacity: 0.6 }} strokeWidth={1} />
        <circle cx={x} cy={y} r={5} style={{ fill: '#fff' }} />
        <text x={right ? x + 10 : x - 10} y={y - 64} textAnchor={right ? 'start' : 'end'} fontFamily={SERIF} fontSize={19} style={{ fill: '#fff' }}>{label}</text>
        <text x={right ? x + 10 : x - 10} y={y - 46} textAnchor={right ? 'start' : 'end'} fontFamily={SANS} fontSize={9.5} fontWeight={600} letterSpacing="1.6" style={{ fill: V.glow }}>{sub}</text>
      </g>
    )
  }
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }} aria-hidden>
        <rect width={W} height={H} style={{ fill: V.navy }} />
        {[0.55, 0.72, 0.86].map((k, i) => <path key={i} d={echo(k, -40 - i * 26)} style={{ fill: 'none', stroke: V.glow, opacity: 0.12 + i * 0.05 }} strokeWidth={1} />)}
        <path d={wave + ` L${x1},${H} L${x0},${H} Z`} style={{ fill: V.sand, opacity: 0.22 }} />
        <path d={echo(1, 26) + ` L${x1},${H} L${x0},${H} Z`} style={{ fill: V.navy, opacity: 0.55 }} />
        <path d={wave} style={{ fill: 'none', stroke: V.glow }} strokeWidth={2} />
        {MONTHS.map((m, i) => (
          <g key={m}>
            <line x1={xs(i)} x2={xs(i)} y1={base + 40} y2={base + 48} style={{ stroke: '#fff', opacity: 0.4 }} />
            <text x={xs(i)} y={base + 66} textAnchor="middle" fontFamily={SANS} fontSize={10} fontWeight={600} letterSpacing="1.4" style={{ fill: '#fff', opacity: 0.6 }}>{m.toUpperCase()}</text>
          </g>
        ))}
        {mark(pk, pk === 11 ? 'Art Basel and New Year' : 'The peak', 'THE HIGHEST MONTH')}
        {mark(second, 'Winter season', 'THE SECOND PEAK')}
        {mark(low, 'The quiet weeks', 'PRICED FOR OCCUPANCY')}
      </svg>
      <div style={{ position: 'absolute', left: 72, right: 72, top: 64 }}>
        <p className="mz-kicker mz-on-dark">{kicker}</p>
        <h2 className="mz-opener-title">{title}</h2>
        <p style={{ font: `300 18px/1.5 ${SERIF}`, color: 'rgba(255,255,255,.82)', maxWidth: '26em', margin: '20px 0 0' }}>The shape of a Miami year, from the seasonal curve behind every projection in this package.</p>
      </div>
    </div>
  )
}

/** One calendar, every platform: the listing at the centre, the channels around it. */
export function ChannelHub({ channels, count }: { channels: string[]; count: string }) {
  const list = channels.slice(0, 8)
  const W = 672, H = 210, cx = 128, cy = H / 2
  const right = 300
  const rowH = (H - 20) / Math.max(1, list.length)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={'One calendar, live on ' + count + ' platforms'}>
      {list.map((c, i) => {
        const y = 10 + rowH * i + rowH / 2
        return (
          <g key={c}>
            <path d={`M${cx + 58},${cy} C${cx + 130},${cy} ${right - 80},${y} ${right - 8},${y}`} style={{ fill: 'none', stroke: V.rule }} strokeWidth={1.25} />
            <circle cx={right - 4} cy={y} r={3} style={{ fill: V.sand }} />
            <text x={right + 8} y={y + 5} fontFamily={SERIF} fontSize={16} style={{ fill: V.ink }}>{c}</text>
          </g>
        )
      })}
      <circle cx={cx} cy={cy} r={58} style={{ fill: V.navy }} />
      <circle cx={cx} cy={cy} r={66} style={{ fill: 'none', stroke: V.navy, opacity: 0.25 }} />
      <text x={cx} y={cy - 6} textAnchor="middle" fontFamily={SERIF} fontSize={17} style={{ fill: '#fff' }}>One calendar</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontFamily={SANS} fontSize={9} fontWeight={600} letterSpacing="1.5" style={{ fill: V.glow }}>YOUR HOME</text>
      <text x={W} y={H - 10} textAnchor="end" fontFamily={SERIF} fontSize={30} fontWeight={300} style={{ fill: V.ink }}>{count}</text>
      <text x={W} y={H - 46} textAnchor="end" fontFamily={SANS} fontSize={9.5} fontWeight={600} letterSpacing="1.6" style={{ fill: V.muted }}>PLATFORMS IN ALL</text>
    </svg>
  )
}
