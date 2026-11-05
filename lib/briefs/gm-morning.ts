// GM MORNING — the owner's one email (Jon, 2026-11-05: ONE BRIEF PER ROLE, "more effective, more
// clear and useful"). It replaces two emails to the same reader: the GM Brief (7:01) and the Labor
// Scorecard (7:58). In order:
//   1. Decide today — every call only the owner can make, one line each with the action, with the
//      memory from lib/gm-decisions (a standing line shrinks to "day N"; ✓ Decided / Defer a week)
//   2. The numbers — six tiles, ONE window in the heading (last 7 days), the last 30 days (settled)
//      in small text beside each: cost per clean, HK margin, labor % of fee, occupancy, reviews,
//      billable
//   3. Labor — what moved, missing from the numbers, failing checks (lib/briefs/labor-scorecard)
//   4. Notable arrivals (3) and Blocked (the fixable ones, cap 6)
//   5. Links
// What left: "Looking ahead" (pacing, PM calendar — the boards carry them), "Guests & risk" (the
// reviews tile and the decide list carry what needs the owner), and the trend card that was built
// and thrown away every morning (its 30-day column is now the small text under each tile).
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { gather, niceDay } from '@/lib/ops-brief'
import { blockedUnits, type BlockedRun } from '@/lib/blocked-units'
import { getLaborSettings } from '@/lib/labor-settings'
import { ACCENTS, APP_URL, T, esc, masthead, headline, block, section, tileTable, footer, fit, type Line, type TileItem } from './ui'
import { buildLaborSection, type LaborSection } from './labor-scorecard'
import type { Built } from './field-run'

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').trim().split(/\s+/).length
const num = (n: any) => (n == null || !Number.isFinite(Number(n)) ? null : Number(n))
const money0 = (n: any) => (num(n) == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('en-US'))
const pct1 = (n: any) => (num(n) == null ? '—' : Number(n).toFixed(1) + '%')
const capped = <X,>(p: Promise<X>, ms: number): Promise<X | null> => Promise.race([p.catch(() => null), new Promise<null>(r => setTimeout(() => r(null), ms))])

export type GmBuilt = Built & { labor: LaborSection['status'] | 'timeout' }

export async function buildGmMorning(): Promise<GmBuilt> {
  const A = ACCENTS.gm
  const db = supabaseAdmin()
  const d = await gather('GM')
  const today = d.today
  const { buildKpiFor } = await import('@/lib/kpi')
  const { buildStaffingForecast } = await import('@/lib/forecast/staffing')

  // Everything at once, each capped — the labor engine is the slow one (Homebase, three windows),
  // and one slow source never holds the whole morning: past its cap the block says so.
  const [labor, k7, k30, blockedRep, staff, bands] = await Promise.all([
    capped(buildLaborSection(), 150_000),
    capped(buildKpiFor(new URLSearchParams({ days: '7' }), true), 60_000),
    capped(buildKpiFor(new URLSearchParams({ days: '30' }), true), 60_000),
    capped(blockedUnits(30), 60_000),
    capped(buildStaffingForecast({ days: 7 }), 60_000),
    getLaborSettings('default').catch(() => ({ pct_good: 30, pct_bad: 40 } as any)),
  ])
  const pctGood = Number((bands as any)?.pct_good) || 30, pctBad = Number((bands as any)?.pct_bad) || 40
  const blocked: BlockedRun[] = blockedRep?.runs || []
  const blockedFailed = !blockedRep
  const rev7: any = (k7 as any)?.revenue || {}, rev30: any = (k30 as any)?.revenue || {}
  const tod: any = (k30 as any)?.today || {}

  // The engine's 7- and 30-day windows come from the labor block — one engine run for the brief.
  // Partial payroll withholds the money tiles exactly as the block withholds its lines.
  const ec7 = labor?.ec7 || null, ec30 = labor?.ec30 || null
  const full = labor?.status === 'ok'
  const H7: any = full ? ec7?.kpi?.housekeeping || null : null
  const H30: any = full ? ec30?.kpi?.housekeeping || null : null
  const E7: any = full ? ec7?.kpi || null : null

  // ── 1. DECIDE TODAY ──────────────────────────────────────────────────────────────────────────
  type Decision = { key: string; tone: 'red' | 'amber'; what: string; num: string; act: string; short: string }
  const decisions: Decision[] = []
  const liveBlocked = blocked.filter(b => b.live)
  const nights30 = blocked.reduce((a, b) => a + b.nights, 0)
  const adr = Number(rev30.adr)
  const blockedAtStake = Number.isFinite(adr) && adr > 0 ? Math.round(nights30 * adr) : null
  if (blocked.length) {
    const openEnded = blocked.filter(b => b.openEnded).length
    decisions.push({ key: 'blocked', tone: 'red',
      what: `<b>${blocked.length} blocked unit${blocked.length === 1 ? '' : 's'}</b> — ${liveBlocked.length} down now, ${nights30} nights off in 30 days${openEnded ? `, ${openEnded} with no end date` : ''}`,
      num: blockedAtStake != null ? `≈${money0(blockedAtStake)}` : `${nights30} nights`,
      act: 'release what is finished, chase what is not (list below)',
      short: `${blocked.length} blocked units · ${liveBlocked.length} down now` })
  }
  if (E7 && E7.maintenance?.tasksNoCharge > 0) {
    const n = E7.maintenance.tasksNoCharge
    decisions.push({ key: 'nocharge', tone: 'amber',
      what: `<b>${n} maintenance task${n === 1 ? '' : 's'} closed with no charge</b> · last 7 days`,
      num: 'bills $0', act: 'have the cost typed in Breezeway',
      short: `${n} maintenance tasks closed with no charge` })
  }
  let claimsOpen = 0, claimsValue = 0, claimsWaiting = 0
  try {
    const { data } = await db.from('claims').select('stage,amount_requested,waiting_on').is('deleted_at', null).limit(500)
    for (const c of ((data || []) as any[])) {
      if (str(c.stage) === 'closed') continue
      claimsOpen++; claimsValue += Number(c.amount_requested) || 0
      if (c.waiting_on) claimsWaiting++
    }
  } catch { /* claims table optional — the brief still sends */ }
  if (claimsOpen) {
    decisions.push({ key: 'claims', tone: 'amber',
      what: `<b>${claimsOpen} claim${claimsOpen === 1 ? '' : 's'} open</b>${claimsWaiting ? ` · ${claimsWaiting} waiting on a channel` : ''}`,
      num: money0(claimsValue), act: 'move each before its deadline on the Claims board',
      short: `${claimsOpen} claims open · ${money0(claimsValue)}` })
  }
  if ((tod.overdueWork || 0) > 0) {
    decisions.push({ key: 'overdue', tone: 'red',
      what: `<b>${tod.overdueWork} work order${tod.overdueWork === 1 ? '' : 's'} overdue</b> · ${tod.openWork || 0} open in total`,
      num: String(tod.overdueWork), act: 'Ops morning carries the list — push the oldest',
      short: `${tod.overdueWork} work orders overdue` })
  }
  // A SHORT DAY INSIDE THREE DAYS is still fixable — a shift added, the on-call called in.
  const soonShort = staff ? staff.short.filter((x: any) => x.lead <= 3) : []
  if (soonShort.length) {
    const gap = soonShort.reduce((a: number, x: any) => a + Math.max(0, x.needed - x.rostered), 0)
    decisions.push({ key: 'short', tone: 'amber',
      what: `<b>${soonShort.length} short day${soonShort.length === 1 ? '' : 's'} in the next 3</b> — ${esc(soonShort.slice(0, 2).map((x: any) => `${x.label} ${x.market}: needs ${x.needed}, ${x.rostered} rostered`).join('; '))}${soonShort.length > 2 ? ` +${soonShort.length - 2}` : ''}`,
      num: `${gap} short`, act: 'add a shift or call the on-call (Weekly Planner)',
      short: `${soonShort.length} short days in the next 3 · ${gap} short` })
  }
  // ASKED, NOBODY ANSWERED (Eve audit 2026-10-10): what Eve asked and nobody answered in a week.
  try {
    const { data: ex } = await db.from('eve_actions').select('payload,decided_at,created_at').eq('kind', 'ask').eq('status', 'expired')
      .gte('created_at', new Date(Date.now() - 10 * 86400000).toISOString()).order('created_at', { ascending: false }).limit(60)
    const rows = ((ex || []) as any[]).filter(r => r.payload?.type === 'action' && Date.parse(String(r.decided_at || r.created_at)) >= Date.now() - 7 * 86400000)
    if (rows.length >= 3) {
      decisions.push({ key: 'unanswered', tone: 'amber',
        what: `<b>${rows.length} of Eve's asks expired unanswered</b> · last 7 days — e.g. ${rows.slice(0, 2).map(r => esc(str(r.payload?.summary).replace(/\s+/g, ' ').slice(0, 60))).join('; ')}`,
        num: String(rows.length), act: 'Lighthouse → Eve → Agent mode',
        short: `${rows.length} Eve asks expired unanswered` })
    }
  } catch { /* the brief still sends */ }

  // THE MEMORY (Eve audit 2026-10-10, lib/gm-decisions): the first morning a line is spelled out;
  // from the second it is "day N"; ✓ Decided / Defer hide it until the number behind it moves.
  const { loadDecisions, saveDecisions, noteSeen, isHidden } = await import('@/lib/gm-decisions')
  const dmap = await loadDecisions().catch(() => ({} as any))
  const taps = (key: string) => `<a href="${APP_URL}/api/brief/decision?key=${key}&do=decided" style="color:#4338ca;text-decoration:none">✓ Decided</a> · <a href="${APP_URL}/api/brief/decision?key=${key}&do=defer&days=7" style="color:#6b7280;text-decoration:none">Defer a week</a>`
  const decideLines: Line[] = []
  const hidden: string[] = []
  for (const dc of decisions) {
    const e = noteSeen(dmap, dc.key, dc.num, today)
    if (isHidden(e, today)) { hidden.push(dc.short + (e.state === 'deferred' ? ` (until ${e.until})` : ' (decided)')); continue }
    const label = e.days <= 1 ? dc.what : `${esc(dc.short)} <span style="${T.faint}">· day ${e.days}</span>`
    decideLines.push({ tone: dc.tone, html: `${label} <b style="float:right">${dc.num}</b><br><span style="${T.muted};font-size:12px">→ ${dc.act}</span> <span style="font-size:11.5px">· ${taps(dc.key)}</span>` })
  }
  try { await saveDecisions(dmap, 'gm-brief') } catch { /* the brief still sends */ }
  const decideHtml = decideLines.length
    ? section('Decide today', decideLines, { cap: 8, accent: A, note: hidden.length ? `Off the list: ${esc(hidden.join(' · '))}` : undefined })
    : block('Decide today', `<p style="margin:6px 0 0;font-size:13px"><span style="${T.green}">Nothing needs you.</span> <span style="${T.muted}">No blocked revenue, no unpriced work, no claims waiting, nothing overdue.</span>${hidden.length ? `<br><span style="font-size:11.5px;${T.faint}">Off the list: ${esc(hidden.join(' · '))}</span>` : ''}</p>`, A)

  // ── 2. THE NUMBERS — last 7 days, the last 30 (settled) beside each ───────────────────────────
  const withheld = labor?.status === 'partial' ? 'payroll partial' : labor ? (labor.status === 'failed' ? 'engine down' : '') : 'engine timed out'
  const thirty = (v: string) => `30d ${v}`
  const occ7 = num(rev7.occupancy), occ30 = num(rev30.occupancy)
  const rv7 = num((d as any).rep7?.avg), rv30 = num(d.rep.avg)
  const bill7 = ec7 ? num(ec7.billableRevenue) : null, bill30 = ec30 ? num(ec30.billableRevenue) : null
  const tilesA: TileItem[] = [
    { label: 'Cost per clean', value: H7 && H7.costPerClean != null ? money0(H7.costPerClean) : '—',
      tone: !H7 || H7.costPerClean == null ? 'none' : (H7.revPerClean != null && H7.costPerClean > H7.revPerClean) ? 'red' : 'green',
      note: H7 ? [H30 && H30.costPerClean != null ? thirty(money0(H30.costPerClean)) : '', H7.revPerClean != null ? 'fee ' + money0(H7.revPerClean) : ''].filter(Boolean).join(' · ') : withheld },
    { label: 'HK margin', value: H7 && H7.marginPct != null ? pct1(H7.marginPct) : '—',
      tone: !H7 || H7.marginPct == null ? 'none' : H7.marginPct >= 30 ? 'green' : H7.marginPct >= 10 ? 'amber' : 'red',
      note: H7 ? (H30 && H30.marginPct != null ? thirty(pct1(H30.marginPct)) : `${H7.cleans} turns`) : withheld },
    { label: 'Labor % of fee', value: H7 && H7.laborPct != null ? pct1(H7.laborPct) : '—',
      tone: !H7 || H7.laborPct == null ? 'none' : H7.laborPct <= pctGood ? 'green' : H7.laborPct <= pctBad ? 'amber' : 'red',
      note: H7 ? `${H30 && H30.laborPct != null ? thirty(pct1(H30.laborPct)) + ' · ' : ''}goal ≤ ${pctGood}%` : withheld },
  ]
  const tilesB: TileItem[] = [
    { label: 'Occupancy', value: occ7 != null ? pct1(occ7) : '—',
      tone: occ7 == null ? 'none' : occ7 >= 75 ? 'green' : occ7 >= 60 ? 'amber' : 'red',
      note: occ30 != null ? thirty(pct1(occ30)) : undefined },
    { label: 'Reviews', value: rv7 != null ? rv7.toFixed(2) : '—',
      tone: rv7 == null ? 'none' : rv7 >= 4.6 ? 'green' : rv7 >= 4.3 ? 'amber' : 'red',
      note: [(d as any).rep7?.n ? `${(d as any).rep7.n} reviews` : 'none this week', rv30 != null ? thirty(rv30.toFixed(2)) : ''].filter(Boolean).join(' · ') },
    { label: 'Billable', value: bill7 != null ? money0(bill7) : '—',
      note: bill30 != null ? thirty(money0(bill30)) : (ec7 ? undefined : 'engine unavailable') },
  ]
  const numbersHtml = block('The numbers · last 7 days', tileTable(tilesA) + tileTable(tilesB) +
    `<p style="margin:4px 0 0;font-size:11px;${T.faint}">Small print under each number: the last 30 days (settled). Same engine as the Labor board.</p>`, A)

  // ── 3. LABOR ────────────────────────────────────────────────────────────────────────────────
  const laborHtml = labor ? labor.html
    : block('Labor · last 7 days vs last 30 days (settled)', `<p style="margin:6px 0 0;font-size:13px"><span style="${T.amber}">The labor engine did not answer in time this morning.</span> <span style="${T.muted}">The 7:58 labor check emails any failing checks; the <a href="${APP_URL}/labor" style="color:${A.ink}">Labor board</a> has the live picture.</span></p>`, A)

  // ── 4. NOTABLE ARRIVALS and BLOCKED ──────────────────────────────────────────────────────────
  const arrLines: Line[] = (d.bigArrivals || []).slice(0, 3).map((b: any) => ({ tone: 'none' as const,
    html: `<b>${esc(b.unit)}</b> · ${esc(b.guest)} · ${b.today ? '<b>lands today</b>' : esc(b.when)}${b.nights ? ` · ${b.nights} nights` : ''} <b style="float:right">${money0(b.total)}</b>` }))
  // STANDING BLOCKS ARE NOT A DECISION (Jon, 2026-10-01): owner use, a building manager, a
  // do-not-sell, an offboarding never change morning to morning; they are counted, not listed.
  const STANDING = /do not sell|owner|building manager|offboard|long[- ]term|tenant|request|renovat|lease|personal use|staff/i
  const whyOf = (r: BlockedRun) => str(r.note || r.guestyLabel || r.reason)
  const fixable = blocked.filter(r => !STANDING.test(whyOf(r)))
  const ordered = fixable.filter(r => r.live).concat(fixable.filter(r => !r.live))
  const dNice = (x: string) => new Date(x + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const blockedLines: Line[] = ordered.map(r => ({ tone: r.live ? 'red' as const : 'amber' as const,
    html: `<b>${esc(r.unit)}</b> <span style="${T.muted}">· ${esc(r.market)}</span> — ${esc(r.guestyLabel || r.reason)} · ${r.live ? 'down now' : 'from ' + dNice(r.from)}${r.openEnded ? ' · no end date' : r.blockEnd ? ' · until ' + dNice(r.blockEnd) : ''} · ${r.nights}n`,
    sub: r.note ? esc(r.note.replace(/\s+/g, ' ').trim().slice(0, 120)) : undefined }))
  const blockedNote = `${blocked.length} blocked · ${liveBlocked.length} down now · ${nights30} nights off in 30 days · ${blocked.length - fixable.length} standing blocks (owner use, do-not-sell, offboarding) not chased here.`
  const blockedHtml = isHidden(dmap['blocked'], today) ? ''
    : blockedFailed ? block('Blocked units', `<p style="margin:6px 0 0;font-size:13px"><span style="${T.red}">Guesty did not answer this morning.</span> <span style="${T.muted}">This is not an all-clear — check the <a href="${APP_URL}/blocked" style="color:${A.ink}">blocked board</a>.</span></p>`, A)
    : blockedLines.length ? section('Blocked — the ones work can reopen', blockedLines, { cap: 6, accent: A, more: `on the <a href="${APP_URL}/blocked" style="color:${A.ink}">board</a>`, note: blockedNote })
    : block('Blocked units', `<p style="margin:6px 0 0;font-size:13px"><span style="${T.green}">Nothing is waiting on a repair.</span> <span style="${T.muted}">${esc(blockedNote)}</span></p>`, A)

  // ── assemble ────────────────────────────────────────────────────────────────────────────────
  const n = decideLines.length
  const occToday = num(tod.occupancy)
  const head = `<b>${n ? `${n} to decide` : 'Nothing to decide'}</b>${blockedAtStake && !isHidden(dmap['blocked'], today) ? ` — the big one is ≈${money0(blockedAtStake)} of blocked nights` : ''}. ` +
    `${occToday != null ? pct1(occToday) + ' occupied tonight · ' : ''}${tod.arrivals || 0} in / ${tod.departures || 0} out${tod.sameDayTurns ? ` · <span style="${T.red}">${tod.sameDayTurns} same-day turns</span>` : ''}.`
  const parts = [
    { html: masthead(A, 'GM morning', `Owner · whole portfolio · ${d.activeCount} active units`, niceDay(today)) },
    { html: headline(A, head) },
    { html: decideHtml },
    { html: numbersHtml },
    { html: laborHtml },
    { html: arrLines.length ? section('Notable arrivals', arrLines, { cap: 3, accent: A, more: `on the <a href="${APP_URL}/day" style="color:${A.ink}">boards</a>` }) : '', optional: true },
    { html: blockedHtml, optional: true },
    { html: footer(`<a href="${APP_URL}/command" style="color:#6b7280">Today board</a> · <a href="${APP_URL}/labor" style="color:#6b7280">Labor board</a> · <a href="${APP_URL}/blocked" style="color:#6b7280">Blocked</a> · <a href="${APP_URL}/claims" style="color:#6b7280">Claims</a><br>GM morning · 7:01 every morning · the day itself is in Ops morning · every figure is the shared engine's.`) },
  ]
  const { html } = fit(parts, 80_000)
  const subject = `GM morning · ${niceDay(today)} · ${n} to decide`
  return {
    subject, html, words: words(html),
    counts: { decide: n, hidden: hidden.length, blocked: blocked.length, laborOk: labor?.status === 'ok' ? 1 : 0 },
    labor: labor ? labor.status : 'timeout',
  }
}
