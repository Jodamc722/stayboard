// LABOR SCORECARD — the Daily Labor email, rebuilt short (Jon, 2026-10-01). Four numbers against
// their goals, what moved this week, who is unmatched, whether the numbers can be trusted. The
// three-tier matrix and the methodology live on the Labor board behind the link; the email is the
// scorecard, not the ledger. Same engine (lib/labor-econ), same windows (yesterday · 7 · 30).
import 'server-only'
import { ACCENTS, APP_URL, T, esc, masthead, headline, section, block, tiles, footer, fit, type Line } from './ui'

export type Tier = {
  cleans: number; cleansHk: number; cleansOthers: number
  hkHours: number; hkPay: number; cpc: number | null; hpc: number | null; cpcOwn: number | null
  hkFees: number; byMk: Record<string, number | null>
  sup: { n: number; names: string[]; hours: number; pay: number; cleans: number; fees: number; bill: number; rev: number }
  mt: { n: number; names: string[]; hours: number; pay: number; fees: number; bill: number; rev: number; billed: number; noCharge: number }
  ccsPay: number; allRev: number; allPay: number; profit: number; marginPct: number | null
  midStayNoCharge?: number
}
export type ScorecardInput = {
  today: string; yd: string; d7: string; d30: string; niceDay: (ymd: string) => string
  TY: Tier; T7: Tier; T30: Tier
  laborGoalPct: number                       // labor_settings pct_good (≤ this is good)
  chargeRate: number                         // $/h the owner is charged for maintenance
  onShift: number; scheduledH: number; standardH: number; overStd: string[]; openShifts: number; cleansDueToday: number | null
  clock: { worked: number; scheduled: number; headcount: number; late: { name: string; minutesLate: number }[]; over: { name: string; overByHours: number }[]; noShows: { name: string }[]; openCards: number } | null
  checks: { key: string; ok: boolean; level: 'red' | 'amber'; what: string; fix: string }[]
  noPay: { name: string; cleans: number }[]; outliers: { name: string; impliedRate: number }[]
  unmatched: string[]                        // cleaned with no Homebase timecard (7d)
  seventeenWest?: number | null              // wages 17WEST covers in the 30d window
}

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const rate = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n)) ? '—' : '$' + Number(n).toFixed(2))
const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n)) ? '—' : Math.round(Number(n)) + '%')
const first = (n: string) => String(n || '').trim().split(/\s+/)[0]
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').trim().split(/\s+/).length

export function renderLaborScorecard(x: ScorecardInput): { subject: string; html: string; words: number } {
  const A = ACCENTS.labor
  const { TY, T7, T30 } = x
  const hkMargin = (t: Tier) => (t.hkFees > 0 ? ((t.hkFees - t.hkPay) / t.hkFees) * 100 : null)
  const laborPct = (t: Tier) => (t.hkFees > 0 ? (t.hkPay / t.hkFees) * 100 : null)
  const loaded = (t: Tier) => (t.cleans > 0 ? t.allPay / t.cleans : null)
  const feePerTurn = T30.cleans > 0 ? T30.hkFees / T30.cleans : null

  // ---- headline: yesterday in one sentence, today in one ----------------------------------------
  const head = `<b>Yesterday:</b> ${TY.cleans} turn${TY.cleans === 1 ? '' : 's'} at <b>${rate(TY.cpc)}</b> of housekeeper pay each · all crews <b style="${TY.profit < 0 ? T.red : T.green}">${money(TY.profit)}</b> profit${TY.marginPct != null ? ` (${pct(TY.marginPct)})` : ''} on ${money(TY.allRev)} earned.<br>` +
    `<b>Today:</b> ${x.onShift} on shift · ${x.scheduledH}h scheduled${x.overStd.length ? ` · <span style="${T.amber}">${x.overStd.length} over 8h</span>` : ''}${x.openShifts ? ` · <span style="${T.red}">${x.openShifts} open shift${x.openShifts === 1 ? '' : 's'}</span>` : ''}${x.cleansDueToday != null ? ` · ${x.cleansDueToday} cleans due` : ''}.`

  // ---- four numbers, 30-day, each with its goal ---------------------------------------------------
  const lp30 = laborPct(T30), hm30 = hkMargin(T30), ld30 = loaded(T30)
  const tileRow = tiles([
    { label: 'Cost per turn · 30d', value: rate(T30.cpc), note: feePerTurn ? `fee ${rate(feePerTurn)} · HK wages only` : 'HK wages only', tone: T30.cpc != null && feePerTurn != null && T30.cpc > feePerTurn * 0.45 ? 'amber' : 'none' },
    { label: 'HK margin · 30d', value: pct(hm30), note: `${money(T30.hkFees - T30.hkPay)} on ${T30.cleans} turns`, tone: hm30 != null && hm30 < 55 ? 'amber' : 'green' },
    { label: 'Labor % of fees', value: pct(lp30), note: `goal ≤ ${x.laborGoalPct}%`, tone: lp30 != null ? (lp30 <= x.laborGoalPct ? 'green' : lp30 <= x.laborGoalPct + 8 ? 'amber' : 'red') : 'none' },
    { label: 'Loaded cost / turn', value: rate(ld30), note: 'all payroll ÷ every turn', tone: 'none' },
  ])

  // ---- what moved: this week against the settled 30 ----------------------------------------------
  const moved: Line[] = []
  const delta = (a: number | null, b: number | null) => (a != null && b != null ? a - b : null)
  const dCpc = delta(T7.cpc, T30.cpc)
  if (dCpc != null) moved.push({ tone: dCpc <= 0 ? 'green' : dCpc > 3 ? 'red' : 'amber', html: `<b>Cost per turn ${rate(T7.cpc)}</b> this week — ${Math.abs(dCpc) < 0.5 ? 'flat on' : dCpc < 0 ? `<b>${rate(Math.abs(dCpc))} better</b> than` : `<b>${rate(dCpc)} worse</b> than`} the 30-day ${rate(T30.cpc)}${T7.hpc ? ` · ${Number(T7.hpc).toFixed(1)}h per turn` : ''}` })
  const mk = ['miami', 'broward'].filter(k => T30.byMk[k] != null)
  if (mk.length) moved.push({ tone: 'none', html: `<b>By market</b> — ${mk.map(k => `${k === 'miami' ? 'Miami' : 'Broward'} ${rate(T30.byMk[k])}`).join(' · ')} per turn (30d)${mk.length === 2 && T30.byMk.miami != null && T30.byMk.broward != null && Math.abs(T30.byMk.miami - T30.byMk.broward) > 8 ? ` · <span style="${T.amber}">${rate(Math.abs(T30.byMk.miami - T30.byMk.broward))} apart — scheduling, not wages</span>` : ''}` })
  const supPct = T30.sup.hours > 0 && x.chargeRate > 0 ? Math.round(((T30.sup.bill / x.chargeRate) / T30.sup.hours) * 100) : null
  if (T30.sup.n) moved.push({ tone: 'none', html: `<b>Supervisors</b> cost ${money(T30.sup.pay)} in 30d and covered ${T30.sup.cleans} turn${T30.sup.cleans === 1 ? '' : 's'}${supPct != null ? ` · ${supPct}% of their hours billed` : ''} — <span style="${T.muted}">overhead the cleans carry</span>` })
  const mtNet = T30.mt.rev - T30.mt.pay
  moved.push({ tone: mtNet < 0 ? 'amber' : 'green', html: `<b>Maintenance</b> billed ${money(T30.mt.bill)} against ${money(T30.mt.pay)} of wages in 30d → <b style="${mtNet < 0 ? T.red : T.green}">${mtNet < 0 ? '−' : ''}${money(Math.abs(mtNet))}</b>`, sub: T30.mt.noCharge ? `<b>${T30.mt.noCharge} tasks closed with no charge</b> in 30d (${T7.mt.noCharge} this week). Each one bills $0 — this is the lever.` : undefined })
  if (TY.midStayNoCharge || T7.midStayNoCharge) moved.push({ tone: 'amber', html: `<b>${T7.midStayNoCharge || 0} mid-stay clean${(T7.midStayNoCharge || 0) === 1 ? '' : 's'} with no charge entered</b> this week — revenue cleans that invoiced nothing` })

  // ---- people: who the numbers cannot see --------------------------------------------------------
  const people: Line[] = []
  if (x.noPay.length) people.push({ tone: 'red', html: `<b>${x.noPay.map(p => esc(p.name)).join(', ')}</b> — ${x.noPay.reduce((a, p) => a + p.cleans, 0)} clean${x.noPay.reduce((a, p) => a + p.cleans, 0) === 1 ? '' : 's'} with <b>$0 of payroll</b>`, sub: 'No wage on the Homebase profile, so every cost-per-turn above reads low. Homebase → the person → wage (or reassign the clean).' })
  if (x.unmatched.length) people.push({ tone: 'amber', html: `<b>${x.unmatched.length} cleaned with no Homebase timecard</b> (7d) — ${x.unmatched.slice(0, 4).map(esc).join(', ')}${x.unmatched.length > 4 ? ` +${x.unmatched.length - 4}` : ''}`, sub: 'Vendor crews are expected here; a Stay cleaner on this line is a name mismatch to fix.' })
  if (x.outliers.length) people.push({ tone: 'amber', html: `<b>${x.outliers.map(o => esc(o.name)).join(', ')}</b> paid far under the median (${x.outliers.slice(0, 3).map(o => rate(o.impliedRate)).join(', ')}/h)`, sub: 'Check the Homebase wage before trusting their cost per turn.' })
  if (x.clock) {
    const c = x.clock
    const bits: string[] = []
    if (c.noShows.length) bits.push(`<span style="${T.red}">${c.noShows.length} never clocked in</span> (${c.noShows.slice(0, 3).map(n => esc(first(n.name))).join(', ')})`)
    if (c.late.length) bits.push(`${c.late.length} late (${c.late.slice(0, 3).map(l => esc(first(l.name)) + ' +' + l.minutesLate + 'm').join(', ')})`)
    if (c.over.length) bits.push(`${c.over.length} past schedule (${c.over.slice(0, 3).map(l => esc(first(l.name)) + ' +' + l.overByHours + 'h').join(', ')})`)
    if (c.openCards) bits.push(`${c.openCards} timecard${c.openCards === 1 ? '' : 's'} left open`)
    people.push({ tone: bits.length ? 'amber' : 'green', html: `<b>Yesterday's clock</b> — ${c.worked}h worked by ${c.headcount} (${c.scheduled}h scheduled)${bits.length ? ' · ' + bits.join(' · ') : ` · <span style="${T.green}">no flags</span>`}` })
  }

  // ---- can the numbers be trusted? -------------------------------------------------------------
  const failing = x.checks.filter(c => !c.ok)
  const trust = failing.length
    ? section('Is this accurate?', failing.slice(0, 3).map(c => ({ tone: c.level, html: `<b>${esc(c.what)}</b>`, sub: esc(c.fix) })), { cap: 3, accent: A, note: `${x.checks.length - failing.length} of ${x.checks.length} checks pass · 30-day basis, audited nightly` })
    : block('Is this accurate?', `<p style="margin:6px 0 0;font-size:13px"><span style="${T.green}">✓ All ${x.checks.length} checks pass</span> <span style="${T.muted}">— every Homebase week answered, every clean has a wage behind it, fees match cleans.</span>${x.seventeenWest ? `<br><span style="${T.muted};font-size:12px">17WEST covers ${money(x.seventeenWest)} of wages this window — payroll above is Stay's share.</span>` : ''}</p>`, A)

  const parts = [
    { html: masthead(A, 'Labor Scorecard', 'Owner & operations manager · punches, never the schedule', x.niceDay(x.today)) },
    { html: headline(A, head, [{ label: 'Labor board — the full three tiers', href: `${APP_URL}/labor` }, { label: 'Weekly Planner', href: `${APP_URL}/team` }]) },
    { html: tileRow },
    { html: section('What moved — this week vs the settled 30', moved, { cap: 5, accent: A }) },
    { html: people.length ? section('People the numbers cannot see', people, { cap: 4, accent: A }) : '', optional: true },
    { html: trust, optional: true },
    { html: footer(`Labor Scorecard · 7:58 every morning · cleaning and maintenance revenue only — room revenue lives in the revenue app.`) },
  ]
  const { html } = fit(parts, 60_000)
  const subject = `Labor Scorecard · ${rate(T30.cpc)} per turn · ${pct(lp30)} labor${lp30 != null && lp30 > x.laborGoalPct ? ' (over goal)' : ''}${T30.mt.noCharge ? ` · ${T30.mt.noCharge} no-charge closes` : ''} · ${x.niceDay(x.today)}`
  return { subject, html, words: words(html) }
}
