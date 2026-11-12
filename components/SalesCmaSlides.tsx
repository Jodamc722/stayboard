// THE BUILDING PAGES OF A SALES DECK, AS KEYNOTE SLIDES (Jon, 2026-11-11: "the same engine that builds
// our current sales decks, revamped: one magazine version and the other a keynote version… a package
// building and realtor groups can share, leave at the building, or send to one owner").
//
// ReportView pushes these into the sales deck just before the close, so they ride on everything the
// deck already does: the /r/<code> link, Present mode, PDF and PowerPoint, slide hiding and order.
// The words and numbers come from content.cma (lib/sales-cma) and are edited on the Sales tab; the
// math is planNumbers, the same function the magazine prints from.
import React from 'react'
import { createPortal } from 'react-dom'
import { ProjectionTuner } from '@/components/ProjectionTuner'
import { YearChart, StayTimelineWide, YearWaveWide, mzVars } from '@/components/MagazineGraphics'
import {
  planNumbers, upliftLine, adjustLine, range, money, kMoney, compGross, pctRange, MONTHS,
  type SalesCma, type PacketPlan,
} from '@/lib/sales-cma'

type Any = any
type SlideFn = (p: { nav?: string; children: React.ReactNode; pad?: number; bleed?: boolean; warn?: boolean; ground?: string }) => React.ReactElement
export type CmaSlide = { key: string; node: React.ReactNode }

/** Monthly bars, low and high, for one floor plan. Pure SVG so it prints and exports. */
export function MonthBars({ months, lo, hi, ink, muted, w = 560, h = 190 }: { months: { lo: number; hi: number }[]; lo: string; hi: string; ink: string; muted: string; w?: number; h?: number }) {
  const max = Math.max(1, ...months.map(m => m.hi))
  const top = 22, bottom = 22, ch = h - top - bottom
  const gw = w / 12, bw = Math.min(16, gw * 0.3)
  return (
    <svg viewBox={`-4 0 ${w + 22} ${h}`} width="100%" role="img" aria-label="Monthly rental income, low and high end">
      {months.map((m, i) => {
        const x = i * gw + gw / 2
        const hl = (m.lo / max) * ch, hh = (m.hi / max) * ch
        return (
          <g key={i}>
            <rect x={x - bw - 1.5} y={top + ch - hl} width={bw} height={hl} rx={2.5} fill={lo} />
            <rect x={x + 1.5} y={top + ch - hh} width={bw} height={hh} rx={2.5} fill={hi} />
            <text x={x + bw / 2 + 1.5} y={top + ch - hh - 6} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={ink}>{kMoney(m.hi)}</text>
            <text x={x} y={h - 5} textAnchor="middle" fontSize={11} fill={muted}>{MONTHS[i]}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** ed: the deck's own edit-in-place field, so every word on these slides edits like the rest of the deck.
 *  onTune: opens the projection builder for a floor plan. Both come from ReportView; absent = read-only. */
export type CmaDeps = { Slide: SlideFn; t: Any; edit: boolean; prospect: string; serif: string;
  /** The magazine's story for the keynote (Jon, 2026-11-12): how a stay runs, the opener photo, who it is for. */
  ops?: { k: string; v: string }[]; tags?: string[]; photo?: string; audience?: 'owner' | 'agents' | 'building'; workTitle?: string; numbersTitle?: string; ed?: (v: string, path: string, multiline?: boolean) => React.ReactNode; onTune?: (planId: string) => void; tunerFor?: (planId: string) => React.ReactNode }
export function cmaSlides(cma: SalesCma, d: CmaDeps): CmaSlide[] {
  const { Slide, t, edit, serif } = d
  const T = (v: string, path: string, ml?: boolean): React.ReactNode => (d.ed && edit ? d.ed(v, path, ml) : v)
  const out: CmaSlide[] = []
  const S = cma.sections
  const emph = (x: string) => x.split(/(\*[^*]+\*)/).map((seg, i) => seg.startsWith('*') && seg.endsWith('*') ? <em key={i} style={{ fontStyle: 'italic' }}>{seg.slice(1, -1)}</em> : seg)
  const where = [cma.building, cma.area].filter(Boolean).join(' · ')
  const eyebrow = (x: string, dark?: boolean) => (
    <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: dark ? 'rgba(255,255,255,0.6)' : t.accent, margin: 0 }}>{x}</p>
  )
  const title = (x: React.ReactNode, dark?: boolean, size = 38) => (
    <h2 style={{ fontFamily: serif, fontWeight: 400, fontSize: size, lineHeight: 1.08, letterSpacing: '-0.015em', color: dark ? '#fff' : t.ink, margin: '10px 0 0', textWrap: 'balance' as Any }}>{typeof x === 'string' ? emph(x) : x}</h2>
  )
  const note = edit ? (
    <p className="sb-noprint" style={{ position: 'absolute', right: 18, bottom: 12, fontSize: 11, color: t.muted, background: t.chip, padding: '3px 8px', borderRadius: 6 }}>Words edit here; projections and comps in the Magazine builder or on the Sales tab</p>
  ) : null
  const cell: React.CSSProperties = { padding: '9px 10px', borderTop: '1px solid ' + t.rule, fontSize: 13, color: t.body, verticalAlign: 'top' }
  const th: React.CSSProperties = { padding: '0 10px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: t.muted, textAlign: 'left' }

  const vars = mzVars(t, serif)
  const aud = d.audience || 'building'

  // ── How a stay runs: the magazine's timeline, across a dark slide ───────────────────────────────
  const ops = (d.ops || []).filter(o => o.k.trim()).slice(0, 6)
  if (ops.length >= 3) out.push({ key: 'cma-run', node: (
    <Slide nav="How we run a home" pad={52} warn={edit} ground={t.band}>
      <div style={{ ...vars, position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
        {eyebrow('How we run a home', true)}
        {title('One stay, *start to finish.*', true, 44)}
        <p style={{ fontFamily: serif, fontSize: 17, fontStyle: 'italic', color: 'rgba(255,255,255,.72)', margin: '10px 0 0' }}>Our own team, our own standard, on every stay.</p>
        <div style={{ marginTop: 'auto', marginBottom: 'auto', paddingTop: 30 }}><StayTimelineWide steps={ops} tags={d.tags} /></div>
      </div>
    </Slide>
  ) })

  // ── Working together: a full-bleed photo opener, like the magazine's ───────────────────────────
  if ((S.partner || S.second) && d.photo) out.push({ key: 'cma-work', node: (
    <Slide nav="Working together" bleed warn={edit} ground={t.band}>
      <div style={{ position: 'relative', width: '100%', height: '100%', backgroundImage: `url("${d.photo}")`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(10,11,14,0) 35%, rgba(10,11,14,.78) 100%)' }} />
        <div style={{ position: 'absolute', left: 64, right: 64, bottom: 56 }}>
          {eyebrow('Working together', true)}
          {title(d.workTitle || 'For the sales team, and the buyers they bring', true, 50)}
        </div>
      </div>
    </Slide>
  ) })

  // ── The numbers: the Miami year as a landscape ──────────────────────────────────────────────────
  if (S.plans || S.glance || S.market) out.push({ key: 'cma-num', node: (
    <Slide nav="The numbers" bleed warn={edit} ground={t.band}>
      <div style={{ ...vars, position: 'relative', width: '100%', height: '100%' }}>
        <YearWaveWide />
        <div style={{ position: 'absolute', left: 64, top: 64, width: 330 }}>
          {eyebrow('The numbers', true)}
          {title(d.numbersTitle || (cma.plans.length > 1 ? cma.plans.length + ' floor plans. *What each could earn.*' : 'What it *could earn.*'), true, 46)}
          <p style={{ fontFamily: serif, fontSize: 17, lineHeight: 1.45, color: 'rgba(255,255,255,.8)', margin: '18px 0 0' }}>How demand moves through a Miami year: the same seasonal pattern behind every projection here.</p>
        </div>
      </div>
    </Slide>
  ) })

  // ── Agent partner program ─────────────────────────────────────────────────────────────────────
  if (S.partner) {
    const P = cma.partner
    out.push({ key: 'cma-partner', node: (
      <Slide nav="Partner program" pad={48} warn={edit}>
        <div style={{ position: 'relative', height: '100%', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 36 }}>
          <div style={{ minWidth: 0 }}>
            {eyebrow('For sales teams and agents')}
            {title('Agent partner program')}
            <p style={{ fontSize: 15, lineHeight: 1.55, color: t.body, margin: '14px 0 0', maxWidth: '58ch' }}>{T(P.lead, 'cma.partner.lead', true)}</p>
            <div style={{ display: 'grid', gap: 12, marginTop: 22 }}>
              {P.cards.map(([k, v], i) => (
                <div key={i} style={{ background: t.chip, borderRadius: 14, padding: '14px 18px' }}>
                  <p style={{ fontSize: 15, fontWeight: 600, color: t.ink, margin: 0 }}>{T(k, `cma.partner.cards.${i}.0`)}</p>
                  <p style={{ fontSize: 13, lineHeight: 1.5, color: t.body, margin: '4px 0 0' }}>{T(v, `cma.partner.cards.${i}.1`, true)}</p>
                </div>
              ))}
            </div>
          </div>
          <div style={{ background: t.band, color: '#fff', borderRadius: 18, padding: '28px 26px', display: 'flex', flexDirection: 'column' }}>
            {eyebrow('Referral fees, in writing', true)}
            <div style={{ display: 'grid', gap: 14, marginTop: 22 }}>
              {P.fees.map(([amt, what], i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 12, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.14)' }}>
                  <span style={{ fontFamily: serif, fontSize: 40, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{T(amt, `cma.partner.fees.${i}.0`)}</span>
                  <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.78)' }}>{T(what, `cma.partner.fees.${i}.1`)}</span>
                </div>
              ))}
            </div>
            <p style={{ marginTop: 'auto', fontSize: 13, lineHeight: 1.5, color: 'rgba(255,255,255,0.8)' }}>{T(P.feeNote, 'cma.partner.feeNote', true)}</p>
          </div>
          {note}
        </div>
      </Slide>
    ) })
    out.push({ key: 'cma-partner-steps', node: (
      <Slide nav="How it works" pad={48} warn={edit}>
        <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
          {eyebrow('How it works')}
          {title('From your listing to your referral fee')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 30 }}>
            {P.steps.map(([k, v], i) => (
              <div key={i} style={{ borderTop: '3px solid ' + t.accent, paddingTop: 16 }}>
                <span style={{ fontFamily: serif, fontSize: 34, color: t.accent, lineHeight: 1 }}>{i + 1}</span>
                <p style={{ fontSize: 16, fontWeight: 600, color: t.ink, margin: '12px 0 0' }}>{T(k, `cma.partner.steps.${i}.0`)}</p>
                <p style={{ fontSize: 13, lineHeight: 1.5, color: t.body, margin: '6px 0 0' }}>{T(v, `cma.partner.steps.${i}.1`, true)}</p>
              </div>
            ))}
          </div>
          {P.here.length ? (
            <div style={{ marginTop: 'auto', background: t.chip, borderRadius: 14, padding: '16px 20px' }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: t.muted, margin: 0 }}>{cma.building ? 'At ' + cma.building : 'For your buyers'}</p>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}>
                {P.here.map((x, i) => <li key={i} style={{ fontSize: 13.5, color: t.body, lineHeight: 1.45 }}>{T(x, `cma.partner.here.${i}`, true)}</li>)}
              </ul>
            </div>
          ) : null}
          {note}
        </div>
      </Slide>
    ) })
  }

  // ── Stay as a second option ───────────────────────────────────────────────────────────────────
  if (S.second) {
    const Q = cma.second
    out.push({ key: 'cma-second', node: (
      <Slide nav="Second option" pad={48} warn={edit}>
        <div style={{ position: 'relative', height: '100%', display: 'grid', gridTemplateColumns: '330px minmax(0,1fr)', gap: 36 }}>
          <div>
            {eyebrow('For buyers who ask for options')}
            {title(cma.building ? 'Stay as a second option at ' + cma.building.replace(/ Residences$/, '') : 'Stay as a second option', false, 34)}
            <p style={{ fontSize: 14, lineHeight: 1.55, color: t.body, margin: '14px 0 0' }}>{T(Q.choose, 'cma.second.choose', true)}</p>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', alignSelf: 'start' }}>
            <tbody>
              {Q.qa.map(([q, a], i) => (
                <tr key={i}>
                  <td style={{ ...cell, width: 170, fontWeight: 600, color: t.ink, fontSize: 13.5 }}>{T(q, `cma.second.qa.${i}.0`)}</td>
                  <td style={{ ...cell, fontSize: 13 }}>{T(a, `cma.second.qa.${i}.1`, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {note}
        </div>
      </Slide>
    ) })
    out.push({ key: 'cma-second-steps', node: (
      <Slide nav="Getting a unit ready" pad={48} warn={edit} ground={t.band}>
        <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
          {eyebrow('How we would get a unit ready', true)}
          {title('Contract to opening day', true)}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + Math.max(1, Q.steps.length) + ', 1fr)', gap: 20, marginTop: 30 }}>
            {Q.steps.map(([k, v], i) => (
              <div key={i} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: '20px 22px' }}>
                <span style={{ fontFamily: serif, fontSize: 30, color: '#fff', lineHeight: 1 }}>{i + 1}</span>
                <p style={{ fontSize: 17, fontWeight: 600, color: '#fff', margin: '12px 0 0' }}>{T(k, `cma.second.steps.${i}.0`)}</p>
                <p style={{ fontSize: 13.5, lineHeight: 1.5, color: 'rgba(255,255,255,0.78)', margin: '6px 0 0' }}>{T(v, `cma.second.steps.${i}.1`, true)}</p>
              </div>
            ))}
          </div>
          {Q.ask.length ? (
            <div style={{ marginTop: 'auto' }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', margin: 0 }}>What we would ask of the sales team</p>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}>
                {Q.ask.map((x, i) => <li key={i} style={{ fontSize: 14, color: 'rgba(255,255,255,0.86)', lineHeight: 1.45 }}>{T(x, `cma.second.ask.${i}`, true)}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      </Slide>
    ) })
  }

  // ── Market and the comparable set ─────────────────────────────────────────────────────────────
  if (S.market) {
    const bullets = cma.market.bullets.map(([k, v], oi) => [k, v, oi] as [string, string, number]).filter(([, v]) => v.trim() || edit)
    if (bullets.length || edit) out.push({ key: 'cma-market', node: (
      <Slide nav="The market" pad={48} warn={edit}>
        <div style={{ position: 'relative', height: '100%' }}>
          {eyebrow(where || 'The market')}
          {title((cma.area || 'The') + ' rental market')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + (bullets.length > 4 ? 3 : 2) + ', 1fr)', gap: '18px 26px', marginTop: 26 }}>
            {bullets.map(([k, v, oi], i) => (
              <div key={i} style={{ borderTop: '1px solid ' + t.rule, paddingTop: 12 }}>
                <p style={{ fontSize: 15, fontWeight: 600, color: t.ink, margin: 0 }}>{T(k.replace(/\.$/, ''), `cma.market.bullets.${oi}.0`)}</p>
                <p style={{ fontSize: 12.5, lineHeight: 1.5, color: t.body, margin: '5px 0 0' }}>{T(v, `cma.market.bullets.${oi}.1`, true)}</p>
              </div>
            ))}
          </div>
          {note}
        </div>
      </Slide>
    ) })
    if (cma.comps.length) out.push({ key: 'cma-comps', node: (
      <Slide nav="Comparable set" pad={48} warn={edit}>
        <div style={{ position: 'relative', height: '100%' }}>
          {eyebrow('The evidence')}
          {title('The comparable set')}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 24 }}>
            <thead><tr><th style={th}>Comparable</th><th style={th}>Market</th><th style={th}>Basis</th><th style={th}>Gross per year</th><th style={th}>Nightly</th><th style={th}>Occupancy</th></tr></thead>
            <tbody>
              {cma.comps.map((c, ci) => (
                <tr key={c.id}>
                  <td style={{ ...cell, fontWeight: 600, color: t.ink }}>{T(c.name, `cma.comps.${ci}.name`)}</td>
                  <td style={cell}>{T(c.market, `cma.comps.${ci}.market`)}</td>
                  <td style={cell}>{T(c.basis, `cma.comps.${ci}.basis`)}</td>
                  <td style={{ ...cell, fontVariantNumeric: 'tabular-nums' }}>{compGross(c)}</td>
                  <td style={{ ...cell, fontVariantNumeric: 'tabular-nums' }}>{money(c.nightlyLo)} to {money(c.nightlyHi)}</td>
                  <td style={cell}>{pctRange(c.occLo, c.occHi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {note}
        </div>
      </Slide>
    ) })
  }

  // ── Every floor plan at a glance ──────────────────────────────────────────────────────────────
  if (S.glance && cma.plans.length) {
    const nums = cma.plans.map(p => ({ p, n: planNumbers(cma, p) }))
    const max = Math.max(1, ...nums.map(x => x.n.hi)) * 1.04
    out.push({ key: 'cma-glance', node: (
      <Slide nav="Floor plans at a glance" pad={48} warn={edit}>
        <div style={{ position: 'relative', height: '100%' }}>
          {eyebrow(where || 'Floor plans')}
          {title('Every floor plan, *at a glance*', false, 36)}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 18 }}>
            <thead><tr><th style={th}>Floor plan</th><th style={{ ...th, width: '34%' }}>Gross per year</th><th style={{ ...th, textAlign: 'right' }}>Per year</th><th style={{ ...th, textAlign: 'right' }}>Per month</th></tr></thead>
            <tbody>
              {nums.map(({ p, n }) => (
                <tr key={p.id}>
                  <td style={{ ...cell, padding: '6px 10px' }}><span style={{ fontWeight: 600, color: t.ink }}>{p.name}</span> <span style={{ fontSize: 11, color: t.muted }}>{p.sf}</span></td>
                  <td style={{ ...cell, padding: '6px 10px' }}>
                    <div style={{ position: 'relative', height: 12 }}>
                      <div style={{ position: 'absolute', left: 0, right: 0, top: 5.5, height: 1, background: t.rule }} />
                      <div style={{ position: 'absolute', left: (n.lo / max * 100) + '%', width: Math.max(1, (n.hi - n.lo) / max * 100) + '%', top: 5, height: 2, background: t.ink }} />
                      <div style={{ position: 'absolute', left: `calc(${n.lo / max * 100}% - 4px)`, top: 2, width: 8, height: 8, borderRadius: 99, background: t.ink }} />
                      <div style={{ position: 'absolute', left: `calc(${n.hi / max * 100}% - 4px)`, top: 2, width: 8, height: 8, borderRadius: 99, background: t.ink }} />
                    </div>
                  </td>
                  <td style={{ ...cell, padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: t.ink, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{range(n.lo, n.hi)}</td>
                  <td style={{ ...cell, padding: '6px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{range(n.monthLo, n.monthHi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 11, color: t.muted, margin: '10px 0 0', maxWidth: '110ch' }}>Gross rental revenue once the listing is established, before channel fees and the management fee. {upliftLine(cma)}</p>
          {note}
        </div>
      </Slide>
    ) })
  }

  // ── One rental comparison per floor plan ──────────────────────────────────────────────────────
  if (S.plans) for (const p of cma.plans) out.push({ key: 'cma-plan-' + p.id, node: planSlide(cma, p, d, { eyebrow, title, cell, th, note, where }) })
  return out
}

function planSlide(cma: SalesCma, p: PacketPlan, d: CmaDeps, h: Any) {
  // THE PLAN SLIDE, IN THE MAGAZINE'S LOOK (Jon, 2026-11-12): one big figure in the display face,
  // three quiet figures under a hairline, the fine-line year, and the comparable set it rests on.
  const { Slide, t, edit, serif } = d
  const pi = cma.plans.findIndex(x => x.id === p.id)
  const T = (v: string, path: string, ml?: boolean): React.ReactNode => (d.ed && edit ? d.ed(v, path, ml) : v)
  const n = planNumbers(cma, p)
  const comps = p.compIds.map(id => cma.comps.find(c => c.id === id)).filter(Boolean) as SalesCma['comps']
  const dash = (a: number, b: number) => a === b ? money(a) : money(a) + ' – ' + money(b)
  const lab: React.CSSProperties = { fontSize: 9.5, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: t.muted, margin: 0 }
  const fig = (label: string, value: string, sub: string) => (
    <div style={{ minWidth: 0 }}>
      <p style={lab}>{label}</p>
      <p style={{ fontFamily: serif, fontSize: 19, lineHeight: 1.1, color: t.ink, margin: '6px 0 0', fontVariantNumeric: 'lining-nums tabular-nums', whiteSpace: 'nowrap' }}>{value}</p>
      <p style={{ fontSize: 10.5, fontStyle: 'italic', fontFamily: serif, color: t.muted, margin: '3px 0 0' }}>{sub}</p>
    </div>
  )
  const td: React.CSSProperties = { padding: '6px 8px', borderTop: '1px solid ' + t.rule, fontSize: 11.5, color: t.body, verticalAlign: 'top', fontVariantNumeric: 'tabular-nums' }
  const us: React.CSSProperties = { ...td, color: t.ink, fontWeight: 700, background: t.chip, borderTop: '1px solid ' + t.ink }
  return (
    <Slide nav={p.name} pad={48} warn={edit}>
      <div style={{ ...mzVars(t, serif), position: 'relative', height: '100%', display: 'grid', gridTemplateColumns: '420px minmax(0,1fr)', gap: 40 }}>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {h.eyebrow((h.where ? h.where + ' · ' : '') + 'Rental projection')}
          {h.title(T(p.name, `cma.plans.${pi}.name`) as Any, false, 46)}
          <p style={{ fontFamily: serif, fontStyle: 'italic', fontSize: 14, color: t.muted, margin: '8px 0 0' }}>{[p.sf, p.rules].filter(Boolean).join(' · ')}</p>
          <div style={{ marginTop: 'auto' }}>
            <p style={lab}>Could earn in a year, once established</p>
            <p style={{ fontFamily: serif, fontSize: 42, lineHeight: 1.02, letterSpacing: '-0.01em', color: t.ink, margin: '10px 0 0', fontVariantNumeric: 'lining-nums', whiteSpace: 'nowrap' }}>{dash(n.lo, n.hi)}</p>
            <p style={{ fontFamily: serif, fontStyle: 'italic', fontSize: 12.5, color: t.muted, margin: '6px 0 0' }}>Gross rental revenue, before channel fees and the management fee</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr 0.9fr', gap: 14, marginTop: 22, paddingTop: 16, borderTop: '1px solid ' + t.ink }}>
              {fig('Per month', kMoney(n.monthLo) + '–' + kMoney(n.monthHi).replace('$', ''), 'on average')}
              {fig('Peak month', 'up to ' + kMoney(n.peak), n.peakMonth + ', high end')}
              {fig('Nightly', money(n.nightlyLo) + '–' + money(n.nightlyHi).slice(1), pctRange(p.occLo, p.occHi) + ' occupancy')}
            </div>
          </div>
        </div>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <p style={lab}>Through the year</p>
            <p style={{ ...lab, letterSpacing: '0.12em' }}><span style={{ color: t.ink }}>—</span> High end &nbsp; <span>┄</span> Low end</p>
          </div>
          <div style={{ marginTop: 8 }}><YearChart months={n.months} kind="line" h={290} /></div>
          {comps.length ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 'auto' }}>
              <thead><tr><th style={h.th}>Against the comparable set</th><th style={h.th}>Gross a year</th><th style={h.th}>Nightly</th><th style={h.th}>Occ.</th></tr></thead>
              <tbody>
                {comps.slice(0, 4).map(c => (
                  <tr key={c.id}>
                    <td style={td}>{c.name}<span style={{ color: t.muted }}>{c.market ? ' · ' + c.market : ''}</span></td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{compGross(c)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{money(c.nightlyLo)}–{money(c.nightlyHi).slice(1)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{pctRange(c.occLo, c.occHi)}</td>
                  </tr>
                ))}
                <tr>
                  <td style={us}>{(cma.building ? cma.building.replace(/ Residences$/, '') + ' ' : '') + p.name}</td>
                  <td style={{ ...us, whiteSpace: 'nowrap' }}>{range(n.lo, n.hi).replace(' to ', '–')}</td>
                  <td style={{ ...us, whiteSpace: 'nowrap' }}>{money(n.nightlyLo)}–{money(n.nightlyHi).slice(1)}{p.suites > 1 ? ' /suite' : ''}</td>
                  <td style={{ ...us, whiteSpace: 'nowrap' }}>{pctRange(p.occLo, p.occHi)}</td>
                </tr>
              </tbody>
            </table>
          ) : <div style={{ marginTop: 'auto' }} />}
          <p style={{ fontFamily: serif, fontStyle: 'italic', fontSize: 11, lineHeight: 1.45, color: t.muted, margin: '8px 0 0' }}><b style={{ fontStyle: 'normal', color: t.body }}>How we got there.</b> {T(p.how, `cma.plans.${pi}.how`, true)} {n.manual ? 'Range set by hand.' : upliftLine(cma)} {adjustLine(cma, p)}</p>
        </div>
        {edit && d.tunerFor ? d.tunerFor(p.id) : null}
        {edit && d.onTune ? <button type="button" className="sb-noprint" onClick={() => d.onTune!(p.id)} style={{ position: 'absolute', top: 0, right: 0, fontSize: 12, fontWeight: 600, background: t.band, color: '#fff', border: 0, borderRadius: 999, padding: '6px 12px', cursor: 'pointer' }}>Adjust projection</button> : null}
        {h.note}
      </div>
    </Slide>
  )
}

/** The projection builder over the keynote: a panel on the right, outside the scaled slide (a portal). */
export function CmaTuneModal({ cma, planId, onChange, onClose }: { cma: SalesCma; planId: string; onChange: (p: PacketPlan) => void; onClose: () => void }) {
  const plan = cma.plans.find(x => x.id === planId)
  if (!plan || typeof document === 'undefined') return null
  return createPortal(
    <div className="sb-noprint" style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,14,40,.28)' }} onClick={onClose}>
      <aside onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(480px,100vw)', background: '#fff', boxShadow: '-18px 0 50px rgba(10,14,40,.2)', padding: '18px 20px 24px', overflowY: 'auto', fontFamily: 'Inter, system-ui, sans-serif', color: '#0F1640' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b style={{ fontFamily: 'Newsreader, Georgia, serif', fontWeight: 400, fontSize: 24 }}>Projection builder</b>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: 0, background: 'none', fontSize: 24, color: '#80859A', cursor: 'pointer' }}>×</button>
        </div>
        <h3 style={{ fontFamily: 'Newsreader, Georgia, serif', fontWeight: 300, fontSize: 28, margin: '14px 0 10px' }}>{plan.name}</h3>
        <ProjectionTuner cma={cma} plan={plan} onChange={onChange} />
        <p style={{ fontSize: 12, color: '#80859A', marginTop: 16 }}>Changes save with the deck, and the magazine shows the same numbers.</p>
      </aside>
    </div>,
    document.body,
  )
}
