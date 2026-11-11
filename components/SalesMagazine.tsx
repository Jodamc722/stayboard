'use client'
// THE MAGAZINE VERSION OF A SALES DECK (Jon, 2026-11-11: "a printable view / magazine and a keynote
// slide version… a package building and realtor groups can share, leave at the building, or send to
// one owner").
//
// The same owner_reports row and the same /r/<code> link as the keynote deck: /r/<code>?view=magazine.
// It reads the deck's own content — the cover, who we are, how we run a unit, the team, the terms and
// the presenter card, all as edited in the deck — plus content.cma, the building pages from the Rider
// packet (lib/sales-cma). Letter pages, each one a printed page: Print / Save as PDF gives the leave-
// behind for a building's sales office, and the link is the same thing on a phone.
import React from 'react'
import {
  normalizeCma, planNumbers, upliftLine, range, money, compGross, pctRange, fmtDate,
  type SalesCma,
} from '@/lib/sales-cma'
import { MonthBars } from '@/components/SalesCmaSlides'

type Any = any
const C = {
  ink: '#121A3D', body: '#3B4257', muted: '#7A8095', navy: '#121A4F', blue: '#3A5BD9', blueSoft: '#E8EDFB',
  cream: '#F6F2EA', rule: '#E4E1D8', paper: '#FFFFFF', desk: '#E9E6DF',
}
const DISPLAY = '"Josefin Sans", "Futura", "Avenir Next", system-ui, sans-serif'
const SERIF = '"Fraunces", "Iowan Old Style", Georgia, serif'
const SANS = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif'
const kv = (a: Any): { k: string; v: string }[] => (Array.isArray(a) ? a : []).filter((r: Any) => r && (String(r.k || '').trim() || String(r.v || '').trim())).map((r: Any) => ({ k: String(r.k || ''), v: String(r.v || '') }))

export function SalesMagazine({ report }: { report: Any }) {
  const c: Any = report.content || {}
  const cma: SalesCma | null = normalizeCma(c.cma)
  const meta: Any = c.meta || {}
  const hero: Any = c.hero || {}
  const card: Any = (c.contact && c.contact.card) || {}
  const prospect = String(meta.prospect || '').trim()
  const building = (cma && cma.building) || String(hero.title || report.scope_label || '').trim()
  const area = (cma && cma.area) || String(meta.market || '').trim()
  const date = fmtDate(String(report.created_at || new Date().toISOString()).slice(0, 10))
  const photo = String(hero.heroImage || '').trim() || '/deck-img/miami-skyline.jpg'
  const stats = kv(c.overview && c.overview.stats)
  const ops = kv(c.ops && c.ops.rows).slice(0, 6)
  const terms = kv(c.terms && c.terms.rows).slice(0, 6)
  const team: Any[] = ((c.team && c.team.people) || []).filter((p: Any) => p && String(p.name || '').trim()).slice(0, 6)
  const hidden: string[] = Array.isArray(c.omit) ? c.omit : []
  const on = (k: string) => hidden.indexOf(k) < 0
  const where = [building, area].filter(Boolean).join('  |  ')
  const keynote = '/r/' + report.code

  let pageNo = 0
  const Page = ({ children, section, dark }: { children: React.ReactNode; section?: string; dark?: boolean }) => {
    pageNo += 1
    const n = pageNo
    return (
      <section className={'mz-page' + (dark ? ' mz-dark' : '')}>
        {section ? (
          <header className="mz-run">
            <span className="mz-mark">STAY</span>
            <span>{section}</span>
            <span>{building}</span>
          </header>
        ) : null}
        <div className="mz-body">{children}</div>
        {section ? (
          <footer className="mz-foot">
            <span>{card.name ? <>{card.name} · {card.phone}{card.email ? ' · ' + card.email : ''}</> : 'stay-hospitality.com'}</span>
            <span>{String(n).padStart(2, '0')}</span>
          </footer>
        ) : null}
      </section>
    )
  }
  const Eyebrow = ({ children }: { children: React.ReactNode }) => <p className="mz-eyebrow">{children}</p>
  const H = ({ children, small }: { children: React.ReactNode; small?: boolean }) => <h2 className={'mz-h' + (small ? ' mz-h-sm' : '')}>{children}</h2>

  const pages: React.ReactNode[] = []

  // ── Cover ──
  pages.push(
    <section key="cover" className="mz-page mz-cover" style={{ backgroundImage: `linear-gradient(180deg, rgba(10,14,40,0.55) 0%, rgba(10,14,40,0.05) 38%, rgba(10,14,40,0.15) 62%, rgba(10,14,40,0.82) 100%), url(${photo})` }}>
      <div className="mz-cover-top">
        <img src="/stay-logo.png" alt="Stay Hospitality" className="mz-logo" />
        <div className="mz-cover-for">
          {prospect ? <b>Prepared for {prospect}</b> : null}
          <span>{date}</span>
        </div>
      </div>
      <div className="mz-cover-bottom">
        <p className="mz-cover-eyebrow">{area ? area.toUpperCase() + '  ·  ' : ''}{cma ? 'Rental comparisons and partner packet' : 'Management proposal'}</p>
        <h1 className="mz-cover-title">{building || 'Stay Hospitality'}</h1>
        <p className="mz-cover-sub">{cma ? 'What each floor plan could earn, how we work with your sales team, and why owners choose Stay.' : String(hero.headline || '')}</p>
      </div>
    </section>,
  )

  // ── Who we are ──
  pages.push(
    <Page key="about" section="Who we are">
      <Eyebrow>Stay Hospitality</Eyebrow>
      <H>Full-service short-term rental management across Miami and South Florida</H>
      {stats.length ? (
        <div className="mz-stats">{stats.slice(0, 4).map((s, i) => <div key={i}><b>{s.k}</b><span>{s.v}</span></div>)}</div>
      ) : null}
      <div className="mz-callout"><b>Stay-managed units earn 20%+ above the market, on average.</b><span>Results vary by unit, building and season.</span></div>
      {ops.length ? (
        <>
          <Eyebrow>How we run your unit</Eyebrow>
          <div className="mz-grid2">{ops.map((r, i) => <div key={i} className="mz-point"><b>{r.k}</b><p>{r.v}</p></div>)}</div>
        </>
      ) : null}
    </Page>,
  )

  if (team.length || terms.length) pages.push(
    <Page key="team" section="Who you work with">
      {team.length ? (
        <>
          <Eyebrow>The team</Eyebrow>
          <H small>The people on your building</H>
          <div className="mz-team">
            {team.map((p: Any, i: number) => (
              <div key={i} className="mz-person">
                {p.photo ? <img src={p.photo} alt="" /> : <span className="mz-initials">{String(p.name).split(/\s+/).map((w: string) => w[0]).join('').slice(0, 3)}</span>}
                <div><b>{p.name}</b><span>{p.role}</span></div>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {terms.length ? (
        <>
          <Eyebrow>How we work together</Eyebrow>
          <table className="mz-qa"><tbody>{terms.map((r, i) => <tr key={i}><th>{r.k}</th><td>{r.v}</td></tr>)}</tbody></table>
        </>
      ) : null}
    </Page>,
  )

  if (cma) {
    const S = cma.sections
    if (S.partner && on('cma-partner')) pages.push(
      <Page key="partner" section="Partner program">
        <Eyebrow>For sales teams and agents</Eyebrow>
        <H>Agent partner program</H>
        <p className="mz-lead">{cma.partner.lead}</p>
        <div className="mz-split">
          <div className="mz-cards">{cma.partner.cards.map(([k, v], i) => <div key={i} className="mz-card"><b>{k}</b><p>{v}</p></div>)}</div>
          <div className="mz-fees">
            <p className="mz-eyebrow mz-on-dark">Referral fees, in writing</p>
            {cma.partner.fees.map(([a, w], i) => <div key={i}><b>{a}</b><span>{w}</span></div>)}
            <p className="mz-fee-note">{cma.partner.feeNote}</p>
          </div>
        </div>
        <Eyebrow>How it works</Eyebrow>
        <ol className="mz-steps">{cma.partner.steps.map(([k, v], i) => <li key={i}><b>{k}</b> {v}</li>)}</ol>
        {cma.partner.here.length ? <><Eyebrow>{building ? 'At ' + building : 'For your buyers'}</Eyebrow><ul className="mz-list">{cma.partner.here.map((x, i) => <li key={i}>{x}</li>)}</ul></> : null}
      </Page>,
    )
    if (S.second && on('cma-second')) pages.push(
      <Page key="second" section="Owner options">
        <Eyebrow>For buyers who ask for options</Eyebrow>
        <H>{building ? 'Stay as a second option at ' + building.replace(/ Residences$/, '') : 'Stay as a second option'}</H>
        <p className="mz-lead">{cma.second.lead}</p>
        <p className="mz-p">{cma.second.choose}</p>
        <Eyebrow>Questions buyers ask when they compare managers</Eyebrow>
        <table className="mz-qa"><tbody>{cma.second.qa.map(([q, a], i) => <tr key={i}><th>{q}</th><td>{a}</td></tr>)}</tbody></table>
        <Eyebrow>How we would get a unit ready</Eyebrow>
        <ol className="mz-steps">{cma.second.steps.map(([k, v], i) => <li key={i}><b>{k}</b> {v}</li>)}</ol>
      </Page>,
    )
    if (S.market && on('cma-market')) pages.push(
      <Page key="market" section="Market overview">
        <Eyebrow>{where}</Eyebrow>
        <H>{(area || 'The') + ' rental market and comparable set'}</H>
        <p className="mz-lead">{cma.market.lead}</p>
        <div className="mz-grid2">{cma.market.bullets.filter(([, v]) => v.trim()).map(([k, v], i) => <div key={i} className="mz-point"><b>{k.replace(/\.$/, '')}</b><p>{v}</p></div>)}</div>
        {cma.comps.length ? (
          <>
            <Eyebrow>Comparable set used across this packet</Eyebrow>
            <table className="mz-table">
              <thead><tr><th>Comparable</th><th>Market</th><th>Basis</th><th>Gross per year</th><th>Nightly</th><th>Occupancy</th></tr></thead>
              <tbody>{cma.comps.map(x => <tr key={x.id}><td><b>{x.name}</b></td><td>{x.market}</td><td>{x.basis}</td><td>{compGross(x)}</td><td>{money(x.nightlyLo)} to {money(x.nightlyHi)}</td><td>{pctRange(x.occLo, x.occHi)}</td></tr>)}</tbody>
            </table>
          </>
        ) : null}
      </Page>,
    )
    if (S.glance && cma.plans.length && on('cma-glance')) {
      const nums = cma.plans.map(p => ({ p, n: planNumbers(cma, p) }))
      const max = Math.max(1, ...nums.map(x => x.n.hi)) * 1.04
      pages.push(
        <Page key="glance" section="Market overview">
          <Eyebrow>{where}</Eyebrow>
          <H>All floor plans at a glance</H>
          <p className="mz-lead">Estimated gross rental revenue once fully ramped, by floor plan. Bars show the annual range.</p>
          <table className="mz-table mz-glance">
            <thead><tr><th>Floor plan</th><th style={{ width: '32%' }}>Gross range per year</th><th className="r">Per year</th><th className="r">Per month</th></tr></thead>
            <tbody>{nums.map(({ p, n }) => (
              <tr key={p.id}>
                <td><b>{p.name}</b><small>{p.sf}{p.price ? ' | from ' + p.price : ''}</small></td>
                <td><div className="mz-bar"><i style={{ left: (n.lo / max * 100) + '%', width: Math.max(2, (n.hi - n.lo) / max * 100) + '%' }} /></div></td>
                <td className="r"><b>{range(n.lo, n.hi)}</b></td>
                <td className="r"><b>{range(n.monthLo, n.monthHi)}</b></td>
              </tr>
            ))}</tbody>
          </table>
          <Eyebrow>How to read this</Eyebrow>
          <ul className="mz-list">
            <li>Figures are <b>gross rental revenue</b>: booking revenue before channel and management fees. Monthly figures are the annual range divided by 12; real months swing with the season, as each floor-plan page shows.</li>
            <li>Every range starts from comparable units, then adds a {cma.uplift.lo}% (low end) to {cma.uplift.hi}% (high end) uplift, {cma.uplift.why}</li>
          </ul>
        </Page>,
      )
    }
    if (S.plans) for (const p of cma.plans) {
      if (!on('cma-plan-' + p.id)) continue
      const n = planNumbers(cma, p)
      const comps = p.compIds.map(id => cma.comps.find(x => x.id === id)).filter(Boolean) as SalesCma['comps']
      pages.push(
        <Page key={'plan-' + p.id} section="Rental CMA">
          <Eyebrow>{where}</Eyebrow>
          <H>{p.name}: rental comparison</H>
          <p className="mz-lead">What comparable furnished units nearby are projected to earn, and where this floor plan{building ? ' at ' + building.replace(/ Residences$/, '') : ''} should land.</p>
          <div className="mz-facts">
            <div><span>Interior size</span><b>{p.sf}</b></div>
            <div><span>Starting price</span><b>{p.price ? p.price + '+' : '—'}</b></div>
            <div><span>Rental rules</span><b>{p.rules}</b></div>
          </div>
          <div className="mz-earn">
            <div><span>Per year</span><b>{range(n.lo, n.hi)}</b><small>Gross rental revenue</small></div>
            <div className="mz-earn-dark"><span>Per month, on average</span><b>{range(n.monthLo, n.monthHi)}</b><small>Gross rental revenue</small></div>
            <div><span>Peak month</span><b>up to {money(n.peak)}</b><small>{n.peakMonth}, high end</small></div>
          </div>
          <Eyebrow>Monthly rental income through the year</Eyebrow>
          <MonthBars months={n.months} lo="#7D97EC" hi={C.navy} ink={C.ink} muted={C.muted} w={680} h={190} />
          <p className="mz-legend"><i style={{ background: '#7D97EC' }} /> Low end <i style={{ background: C.navy }} /> High end <span>Seasonal shape from Miami market pricing data</span></p>
          <Eyebrow>Comparable set</Eyebrow>
          <table className="mz-table">
            <thead><tr><th>Comparable</th><th>Market</th><th>Gross per year</th><th>Nightly</th><th>Occupancy</th></tr></thead>
            <tbody>
              {comps.map(x => <tr key={x.id}><td><b>{x.name}</b></td><td>{x.market}</td><td>{compGross(x)}</td><td>{money(x.nightlyLo)} to {money(x.nightlyHi)}</td><td>{pctRange(x.occLo, x.occHi)}</td></tr>)}
              <tr className="mz-us"><td><b>{(building ? building.replace(/ Residences$/, '') + ' ' : '') + p.name}</b></td><td>{area ? area + ', new build' : 'New build'}</td><td><b>{range(n.lo, n.hi)}</b></td><td><b>{money(n.nightlyLo)} to {money(n.nightlyHi)}</b>{p.suites > 1 ? ' per suite' : ''}</td><td><b>{pctRange(p.occLo, p.occHi)}</b></td></tr>
            </tbody>
          </table>
          <p className="mz-how"><b>How we got there:</b> {p.how} {n.manual ? 'Range set by hand.' : upliftLine(cma)}</p>
        </Page>,
      )
    }
  }

  // ── Back cover ──
  pages.push(
    <Page key="back" dark>
      <div className="mz-back">
        <img src="/stay-logo.png" alt="Stay Hospitality" className="mz-logo" />
        <h2 className="mz-back-h">{cma ? 'Send us any floor plan' : 'Let’s talk about your property'}</h2>
        <p className="mz-back-p">{cma ? 'Send us any floor plan a buyer is considering and we will turn a unit-level projection around within 48 hours, so the buyer sees the rental numbers before they make an offer.' : 'We will walk through the numbers, the terms and the onboarding, and answer every question before you decide.'}</p>
        {card.name ? (
          <div className="mz-card-person">
            {card.photo ? <img src={card.photo} alt="" /> : null}
            <div>
              <b>{card.name}</b>
              <span>{card.role}</span>
              <span className="mz-sel">{card.phone}</span>
              <span className="mz-sel">{card.email}</span>
            </div>
          </div>
        ) : null}
        <p className="mz-fine">{cma ? cma.disclaimer : 'Projections are estimates, not guarantees. Management terms are set in the written agreement.'}</p>
      </div>
    </Page>,
  )

  return (
    <div className="mz-root">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@300;400;600&display=swap" />
      <nav className="mz-bar-top">
        <span className="mz-mark">STAY</span>
        <span className="mz-switch"><b>Magazine</b><a href={keynote}>Keynote</a></span>
        <button type="button" onClick={() => window.print()}>Print or save PDF</button>
      </nav>
      {pages}
    </div>
  )
}

const CSS = `
.mz-root{background:${C.desk};min-height:100vh;padding:72px 16px 48px;font-family:${SANS};color:${C.body};-webkit-print-color-adjust:exact;print-color-adjust:exact}
.mz-bar-top{position:fixed;top:0;left:0;right:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px max(16px,env(safe-area-inset-left));background:rgba(18,26,79,.94);color:#fff;backdrop-filter:blur(8px)}
.mz-bar-top .mz-mark{color:#fff}
.mz-switch{display:inline-flex;background:rgba(255,255,255,.12);border-radius:999px;padding:3px}
.mz-switch b,.mz-switch a{font:600 12.5px ${SANS};padding:6px 14px;border-radius:999px;color:#fff;text-decoration:none}
.mz-switch b{background:#fff;color:${C.navy}}
.mz-bar-top button{font:600 12.5px ${SANS};background:#fff;color:${C.navy};border:0;border-radius:999px;padding:7px 14px;cursor:pointer}
.mz-mark{font-family:${DISPLAY};font-weight:400;letter-spacing:.32em;font-size:13px;color:${C.navy}}
.mz-page{position:relative;width:8.5in;max-width:100%;min-height:11in;margin:0 auto 28px;background:${C.paper};box-shadow:0 12px 40px rgba(18,26,61,.14);display:flex;flex-direction:column;overflow:hidden}
.mz-body{padding:.35in .7in .2in;flex:1;display:flex;flex-direction:column}
.mz-run{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:.42in .7in 0;font:600 9.5px ${SANS};letter-spacing:.2em;text-transform:uppercase;color:${C.muted}}
.mz-foot{display:flex;justify-content:space-between;gap:12px;padding:0 .7in .4in;font:500 10px ${SANS};color:${C.muted};border-top:0}
.mz-foot span:last-child{font-family:${DISPLAY};letter-spacing:.2em}
.mz-eyebrow{font:700 10.5px ${SANS};letter-spacing:.2em;text-transform:uppercase;color:${C.blue};margin:22px 0 8px}
.mz-eyebrow.mz-on-dark{color:rgba(255,255,255,.6);margin-top:0}
.mz-h{font-family:${DISPLAY};font-weight:300;text-transform:uppercase;letter-spacing:.04em;font-size:34px;line-height:1.08;color:${C.ink};margin:0 0 4px;text-wrap:balance}
.mz-h-sm{font-size:26px}
.mz-lead{font-size:15px;line-height:1.55;color:${C.muted};margin:10px 0 4px;max-width:62ch}
.mz-p{font-size:12.5px;line-height:1.6;margin:8px 0 0}
.mz-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin:22px 0 14px;border-top:1px solid ${C.rule};border-bottom:1px solid ${C.rule}}
.mz-stats div{padding:14px 10px;text-align:center;border-left:1px solid ${C.rule}}.mz-stats div:first-child{border-left:0}
.mz-stats b{display:block;font-family:${SERIF};font-weight:400;font-size:28px;color:${C.ink}}
.mz-stats span{font:600 9.5px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${C.muted}}
.mz-callout{background:${C.navy};color:#fff;border-radius:14px;padding:16px 20px;display:flex;flex-direction:column;gap:3px}
.mz-callout b{font-size:16px}.mz-callout span{font-size:11px;color:rgba(255,255,255,.7)}
.mz-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px 26px}
.mz-point{border-top:1px solid ${C.rule};padding-top:9px}
.mz-point b{font-size:13.5px;color:${C.ink}}.mz-point p{font-size:11.5px;line-height:1.55;margin:4px 0 0}
.mz-team{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:14px}
.mz-person{display:flex;gap:10px;align-items:center;background:${C.cream};border-radius:12px;padding:10px 12px}
.mz-person img,.mz-initials{width:44px;height:44px;border-radius:999px;object-fit:cover;flex:none}
.mz-initials{display:grid;place-items:center;background:${C.navy};color:#fff;font:600 13px ${SANS}}
.mz-person b{display:block;font-size:12.5px;color:${C.ink}}.mz-person span{font-size:11px;color:${C.muted}}
.mz-qa{width:100%;border-collapse:collapse}
.mz-qa th{width:32%;text-align:left;vertical-align:top;font-size:12px;color:${C.ink};padding:9px 10px 9px 0;border-top:1px solid ${C.rule}}
.mz-qa td{font-size:12px;line-height:1.5;padding:9px 0;border-top:1px solid ${C.rule}}
.mz-split{display:grid;grid-template-columns:1fr 2.55in;gap:16px;margin-top:16px}
.mz-cards{display:grid;gap:10px}
.mz-card{background:${C.cream};border-radius:12px;padding:12px 16px}.mz-card b{font-size:13.5px;color:${C.ink}}.mz-card p{font-size:11.5px;line-height:1.5;margin:4px 0 0}
.mz-fees{background:${C.navy};color:#fff;border-radius:14px;padding:18px 20px;display:flex;flex-direction:column;gap:8px}
.mz-fees div{display:flex;align-items:baseline;gap:8px;border-bottom:1px solid rgba(255,255,255,.14);padding-bottom:8px}
.mz-fees div b{font-family:${SERIF};font-weight:400;font-size:28px}.mz-fees div span{font-size:12px;color:rgba(255,255,255,.78)}
.mz-fee-note{font-size:11px;line-height:1.5;color:rgba(255,255,255,.8);margin:auto 0 0}
.mz-steps{list-style:none;counter-reset:s;padding:0;margin:4px 0 0;display:grid;gap:8px}
.mz-steps li{counter-increment:s;position:relative;padding-left:34px;font-size:12.5px;line-height:1.5}
.mz-steps li::before{content:counter(s);position:absolute;left:0;top:-1px;width:22px;height:22px;border-radius:999px;background:${C.blue};color:#fff;font:700 11px/22px ${SANS};text-align:center}
.mz-steps b{color:${C.ink}}
.mz-list{margin:2px 0 0;padding-left:18px;display:grid;gap:5px}.mz-list li{font-size:12px;line-height:1.5}
.mz-table{width:100%;border-collapse:collapse;font-size:11px}
.mz-table th{font:700 9px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.muted};text-align:left;padding:0 8px 7px 0;border-bottom:1.5px solid ${C.ink}}
.mz-table td{padding:8px 8px 8px 0;border-bottom:1px solid ${C.rule};vertical-align:top;line-height:1.4}
.mz-table td b{color:${C.ink}}
.mz-table .r{text-align:right}
.mz-table small{display:block;font-size:10px;color:${C.muted};margin-top:2px}
.mz-table tr.mz-us td{background:${C.blueSoft}}
.mz-glance td{vertical-align:middle}
.mz-bar{position:relative;height:9px;background:#EEF0F6;border-radius:99px}.mz-bar i{position:absolute;top:0;bottom:0;background:${C.blue};border-radius:99px}
.mz-facts{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}
.mz-facts div{background:${C.cream};border-radius:12px;padding:10px 14px}
.mz-facts span,.mz-earn span{display:block;font:700 9px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${C.blue}}
.mz-facts b{font-size:16px;color:${C.ink}}
.mz-earn{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}
.mz-earn div{border:1.5px solid ${C.navy};border-radius:12px;padding:12px 14px}
.mz-earn b{display:block;font-family:${SERIF};font-weight:400;font-size:21px;color:${C.ink};margin-top:4px;white-space:nowrap}
.mz-earn small{font-size:10.5px;color:${C.muted}}
.mz-earn .mz-earn-dark{background:${C.navy}}.mz-earn .mz-earn-dark b{color:#fff}.mz-earn .mz-earn-dark span,.mz-earn .mz-earn-dark small{color:rgba(255,255,255,.72)}
.mz-legend{display:flex;align-items:center;gap:6px;font-size:10px;color:${C.muted};margin:0}
.mz-legend i{display:inline-block;width:9px;height:9px;border-radius:2px}.mz-legend span{margin-left:10px}
.mz-how{font-size:10.5px;line-height:1.5;color:${C.muted};margin:10px 0 0}.mz-how b{color:${C.body}}
.mz-cover{background-size:cover;background-position:center 35%;color:#fff;justify-content:space-between;padding:.6in .7in}
.mz-cover-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.mz-logo{width:1.55in;filter:brightness(0) invert(1)}
.mz-cover-for{text-align:right;display:flex;flex-direction:column;gap:3px;font-size:12px;color:rgba(255,255,255,.85)}.mz-cover-for b{color:#fff;font-size:13px}
.mz-cover-eyebrow{font:600 11px ${SANS};letter-spacing:.24em;text-transform:uppercase;color:rgba(255,255,255,.8);margin:0}
.mz-cover-title{font-family:${DISPLAY};font-weight:300;text-transform:uppercase;letter-spacing:.05em;font-size:62px;line-height:1;margin:14px 0 0;text-wrap:balance}
.mz-cover-sub{font-size:16px;line-height:1.5;max-width:44ch;color:rgba(255,255,255,.88);margin:16px 0 0}
.mz-dark{background:${C.navy};color:#fff}
.mz-back{flex:1;display:flex;flex-direction:column;justify-content:center;gap:18px;padding:.4in 0}
.mz-back-h{font-family:${DISPLAY};font-weight:300;text-transform:uppercase;letter-spacing:.05em;font-size:44px;line-height:1.05;margin:24px 0 0}
.mz-back-p{font-size:15px;line-height:1.6;color:rgba(255,255,255,.82);max-width:50ch;margin:0}
.mz-card-person{display:flex;gap:16px;align-items:center;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:18px 20px;max-width:4.6in}
.mz-card-person img{width:72px;height:72px;border-radius:999px;object-fit:cover}
.mz-card-person b{display:block;font-size:18px}.mz-card-person span{display:block;font-size:12.5px;color:rgba(255,255,255,.78);margin-top:2px}
.mz-sel{user-select:all}
.mz-fine{font-size:9.5px;line-height:1.5;color:rgba(255,255,255,.55);margin-top:auto;max-width:70ch}
@media screen and (max-width:700px){
  .mz-page{min-height:0;width:100%}.mz-body,.mz-run,.mz-foot{padding-left:18px;padding-right:18px}
  .mz-cover{min-height:88vh;padding:28px 18px}.mz-cover-title{font-size:40px}
  .mz-grid2,.mz-split,.mz-team,.mz-facts,.mz-earn{grid-template-columns:1fr}.mz-stats{grid-template-columns:1fr 1fr}
  .mz-table{display:block;overflow-x:auto}
}
@page{size:letter;margin:0}
@media print{
  .mz-root{background:#fff;padding:0}.mz-bar-top{display:none}
  .mz-page{width:8.5in;height:11in;min-height:11in;margin:0;box-shadow:none;page-break-after:always;break-after:page}
  .mz-page:last-child{page-break-after:auto;break-after:auto}
}
`
