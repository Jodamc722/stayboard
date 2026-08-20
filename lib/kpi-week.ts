// WEEKLY KPI REVIEW — one card for the daily labor brief (Jon, 2026-08-20: "Need a weekly kpi
// review in the brief. The KPI weeks are Sunday - Saturday. This can be included in the labor
// brief").
//
// Numbers come from lib/kpi's buildKpi — the exact engine behind the home KPI board — so the
// email and the board can never disagree about the same week. Three looks, one table:
//   • LAST WEEK: the most recent completed Sunday→Saturday block.
//   • THE WEEK BEFORE: buildKpi's own prior-window comparison (same length, immediately prior,
//     which for a Sun–Sat week is exactly the previous Sun–Sat week).
//   • THIS WEEK SO FAR: Sunday through yesterday, so the review is never a week stale. Shown
//     without a change column — a partial week against a full one is not a comparison.
//
// ADDITIVE BY CONTRACT. This card must never cost Jon the labor email: every failure path
// returns '' and the brief renders without it.
import 'server-only'
import { buildKpi } from '@/lib/kpi'
import type { Access } from '@/lib/access'

const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5)
// Day-of-week of a Date, measured in ET (0 = Sunday). Convert to the ET calendar date first —
// asking the Date directly answers in UTC and shifts the week boundary by an evening.
const dowET = (d: Date) => new Date(dISO(d) + 'T12:00:00Z').getUTCDay()

const money = (n: number | null | undefined) =>
  n == null ? '&mdash;' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US')
const pctTxt = (n: number | null | undefined) => (n == null ? '&mdash;' : Math.round(n * 10) / 10 + '%')
const intTxt = (n: number | null | undefined) => (n == null ? '&mdash;' : String(Math.round(n)))

const td = 'padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:left'
const th = 'padding:6px 8px;border-bottom:2px solid #111827;font-size:11px;text-transform:uppercase;letter-spacing:.04em;text-align:left;color:#6b7280'
const cardStyle = 'background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin:12px 0'

const niceDay = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ })

/** Colored change cell. goodWhenUp=false flips the tone (fewer glitches is the good direction). */
function chg(now: number | null | undefined, prev: number | null | undefined,
  fmt: (n: any) => string, goodWhenUp = true): string {
  if (now == null || prev == null) return '<span style="color:#9ca3af">&mdash;</span>'
  const d = Math.round((now - prev) * 10) / 10
  if (d === 0) return '<span style="color:#6b7280">even</span>'
  const good = goodWhenUp ? d > 0 : d < 0
  const color = good ? '#047857' : '#dc2626'
  return '<span style="color:' + color + ';font-weight:600">' + (d > 0 ? '+' : '&minus;') + fmt(Math.abs(d)) + '</span>'
}

// buildKpi only reads canSeeMoney(access) — email + features. The labor brief already prints
// payroll and margins in the open to its configured recipients, so the weekly review is
// money-visible too. Everything else on Access is unused by the KPI engine.
const MONEY_VISIBLE = { email: null, features: { money: true } } as unknown as Access

export async function weeklyKpiCard(): Promise<string> {
  try {
    const now = new Date()
    const dow = dowET(now)                       // 0 = Sunday, in ET
    const thisSun = dISO(addDays(now, -dow))     // the Sunday this week started on
    const lastSat = dISO(addDays(now, -dow - 1))
    const lastSun = dISO(addDays(now, -dow - 7))
    const yesterday = dISO(addDays(now, -1))

    // Sunday morning the current week has zero completed days — skip the WTD column's fetch.
    const wantWtd = dow > 0
    const [L, W] = await Promise.all([
      buildKpi(new URLSearchParams({ from: lastSun, to: lastSat }), MONEY_VISIBLE),
      wantWtd
        ? buildKpi(new URLSearchParams({ from: thisSun, to: yesterday }), MONEY_VISIBLE)
        : Promise.resolve(null),
    ])
    if (!L || !L.ok) return ''

    const R = L.revenue, C = L.cleaning, K = L.work, G = L.glitches, S = L.sentiment, Wl = L.welcome
    const w = (pick: (p: any) => any): string => {
      if (!W || !W.ok) return '<span style="color:#9ca3af">&mdash;</span>'
      const v = pick(W)
      return v == null ? '<span style="color:#9ca3af">&mdash;</span>' : String(v)
    }

    const row = (label: string, sub: string, prevV: string, nowV: string, change: string, wtdV: string) =>
      '<tr><td style="' + td + '">' + label +
      (sub ? '<br><span style="color:#9ca3af;font-size:11px">' + sub + '</span>' : '') + '</td>' +
      '<td style="' + td + ';text-align:right;color:#6b7280">' + prevV + '</td>' +
      '<td style="' + td + ';text-align:right"><b>' + nowV + '</b></td>' +
      '<td style="' + td + ';text-align:right">' + change + '</td>' +
      '<td style="' + td + ';text-align:right;color:#374151">' + wtdV + '</td></tr>'

    const rows =
      row('Occupancy', L.window.days + ' nights available per unit',
        pctTxt(R.occupancyPrev), pctTxt(R.occupancy),
        chg(R.occupancy, R.occupancyPrev, (n: any) => n + ' pts'),
        w(p => pctTxt(p.revenue.occupancy))) +
      row('ADR', 'room + cleaning per occupied night',
        money(R.adrPrev), money(R.adr), chg(R.adr, R.adrPrev, money),
        w(p => money(p.revenue.adr))) +
      row('RevPAR', 'revenue per available night',
        money(R.revparPrev), money(R.revpar), chg(R.revpar, R.revparPrev, money),
        w(p => money(p.revenue.revpar))) +
      row('Total revenue', 'room + cleaning, net of channel',
        money(R.totalPrev), money(R.total), chg(R.total, R.totalPrev, money),
        w(p => money(p.revenue.total))) +
      row('Cleaning revenue', C.turns + ' checkout cleans' + (C.feePerTurn != null ? ' &middot; ' + money(C.feePerTurn) + ' / turn' : ''),
        money(C.revenuePrev), money(C.revenue), chg(C.revenue, C.revenuePrev, money),
        w(p => money(p.cleaning.revenue))) +
      row('Checkout cleans', '',
        intTxt(C.turnsPrev), intTxt(C.turns), chg(C.turns, C.turnsPrev, intTxt),
        w(p => intTxt(p.cleaning.turns))) +
      row('Tasks completed', (K.onTimeRate != null ? pctTxt(K.onTimeRate) + ' finished on the scheduled day' : ''),
        intTxt(K.completedPrev), intTxt(K.completed), chg(K.completed, K.completedPrev, intTxt),
        w(p => intTxt(p.work.completed))) +
      row('Glitches opened', (G.cost != null && G.cost > 0 ? money(G.cost) + ' in refunds + recovery' : ''),
        intTxt(G.openedPrev), intTxt(G.opened), chg(G.opened, G.openedPrev, intTxt, false),
        w(p => intTxt(p.glitches.opened))) +
      row('Guest sentiment', S.scanned + ' conversations scanned',
        pctTxt(S.happyPctPrev), pctTxt(S.happyPct),
        chg(S.happyPct, S.happyPctPrev, (n: any) => n + ' pts'),
        w(p => pctTxt(p.sentiment.happyPct))) +
      row('Welcome calls', Wl.done + ' of ' + Wl.arrivals + ' arrivals called',
        pctTxt(Wl.pctPrev), pctTxt(Wl.pct),
        chg(Wl.pct, Wl.pctPrev, (n: any) => n + ' pts'),
        w(p => pctTxt(p.welcome.pct)))

    return '<div style="' + cardStyle + '">' +
      '<p style="margin:0 0 8px;font-size:13px;font-weight:700">Weekly KPI review ' +
      '<span style="color:#9ca3af;font-weight:400;font-size:12px">KPI weeks run Sunday&ndash;Saturday &middot; same numbers as the KPI board</span></p>' +
      '<table width="100%" cellspacing="0" cellpadding="0">' +
      '<tr><th style="' + th + '">KPI</th>' +
      '<th style="' + th + ';text-align:right">Wk before<br>' + niceDay(dISO(addDays(new Date(lastSun + 'T12:00:00'), -7))) + '&ndash;' + niceDay(dISO(addDays(new Date(lastSun + 'T12:00:00'), -1))) + '</th>' +
      '<th style="' + th + ';text-align:right">Last wk<br>' + niceDay(lastSun) + '&ndash;' + niceDay(lastSat) + '</th>' +
      '<th style="' + th + ';text-align:right">Change</th>' +
      '<th style="' + th + ';text-align:right">This wk<br>' + (wantWtd ? niceDay(thisSun) + '&ndash;' + niceDay(yesterday) : 'just started') + '</th></tr>' +
      rows + '</table>' +
      '<p style="margin:8px 0 0;font-size:11px;color:#9ca3af">This week runs Sunday through yesterday and has no change column &mdash; a partial week against a full one is not a comparison. Full detail on the <a href="https://lighthouse-stay.vercel.app/" style="color:#2563eb">KPI board</a>.</p>' +
      '</div>'
  } catch {
    return ''  // additive: a KPI hiccup never costs the labor email
  }
}
