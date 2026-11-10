// UPKEEP DECISIONS — health, repeat failures, where the upkeep money goes, repair vs replace, and the
// owner / vendor 360s, read from the nightly business brain (2026-11-10).
//
// Jon's goal: Eve "should be better than anybody on the team when it comes to the knowledge base" and
// help with "property upkeep decisions". Each tool here answers one question a manager asks before
// spending on a unit:
//   unit_health      which apartments are in trouble today, and what moved their score
//   repeat_failures  where the same system broke again, with the event timeline
//   upkeep_rank      which apartments cost the most to keep up for what they earn, ranked by a STATED
//                    composite, with reasons
//   upkeep_advise    repair, replace or watch — the evidence on one unit / system, the rule that fired,
//                    and what is not known. ADVICE ONLY: it never creates a task or spends anything.
//   owner_360        one owner's months, units and unit health (no margin or labour in v1 — said plainly)
//   vendor_360       one vendor's months of vendor-tagged work, or an honest "not enough yet"
//
// MONEY. Every upkeep amount on record is what was BILLED TO THE OWNER (Breezeway cost + supply lines,
// work-order amounts) — not what the work cost us. Every figure says so. Amounts are nulled here for
// anyone without money, and the tools are money:true so the registry redacts as well.
//
// FAIL OPEN: a missing / empty / stale brain table answers { stale: true, note } (lib/eve/brain-data.ts).
import 'server-only'
import type { DueCalendar } from '@/lib/pm-calendar'
import { getVendors } from '@/lib/staffing'
import type { EveTool } from './types'
import { obj, S } from './types'
import type { EveCtx } from './ctx'
import { lc, num, round2, shiftDay, clampDays, clampLimit, pageRows } from './ctx'
import {
  BRAIN_SOURCE, BRAIN_NIGHTS_BASIS, BILLED_NOTE, str, guarded, brainFresh, freshAll, staleOut, brainMeta, brainDims,
  resolveBrainScope, readUnitDays, readEvents, readHealthLatest, newAcc, addDayRow, nightsOf, perfOf, physName,
  buildingLabel, daysBetween, systemKey, SYSTEMS, type Acc, type Dims, type Scope,
} from './brain-data'
import { etDay } from '@/lib/brain/shared'
import { reviewStats, type ReviewStats } from './reviews'
import { dueCalendarCached } from './reach'

const LIVE_UPKEEP = 'Use unit_360 / building_360 (they fall back to the live readers), upkeep_due and glitches instead, and say the nightly numbers were not available.'
const hideMoney = (ctx: EveCtx, v: number | null | undefined): number | null => (ctx.canMoney && v != null && Number.isFinite(v) ? v : null)
const physOfScope = (d: Dims, s: Scope): string[] | null => {
  if (s.physId) return [s.physId]
  if (!s.listingIds) return null
  const set: Record<string, true> = {}
  for (const id of s.listingIds) { const u = d.byListing[id]; set[u ? u.physical_unit_id : id] = true }
  return Object.keys(set)
}
const SYSTEM_WORDS: Record<string, string> = { hvac: 'A/C (HVAC)', plumbing: 'plumbing', appliance: 'appliances', lock_access: 'locks / access', electrical: 'electrical', pest: 'pest', wifi_tv: 'Wi-Fi / TV', furniture: 'furniture', cleaning: 'cleaning', other: 'other' }
const sysWord = (s: any): string => SYSTEM_WORDS[str(s)] || str(s) || 'other'
async function trySect<T>(fn: () => Promise<T>): Promise<{ ok: true; v: T } | { ok: false; why: string }> {
  try { return { ok: true, v: await fn() } } catch (e: any) { return { ok: false, why: str(e?.message || e).slice(0, 140) } }
}

// ───────────────────────────────────────────────────────────── unit_health
const UNIT_HEALTH: EveTool = {
  name: 'unit_health',
  money: true,
  description: 'TODAY\'S UPKEEP-AWARE HEALTH RANKING — one score 0–100 per apartment (a whole-and-parts set is one), built nightly: reviews on the live listing, guest issues per 100 occupied nights, systems that failed again within 90 days, overdue preventative work, the latest inspection. Band: healthy 85+ · watch 70–84 · risk 50–69 · critical <50 · unrated. Worst first, each with what took points off in plain words. Params: scope / building / unit / owner / market (optional), band (optional), limit (default 20), formula (true to include the exact formula). This is NOT property_health (that is the listing / OTA-ranking score).',
  input_schema: obj({ scope: S.str, building: S.str, unit: S.str, id: S.str, owner: S.str, market: S.str, band: S.str, limit: S.num, formula: S.bool }),
  run: async (input, ctx) => {
    const fresh = await freshAll(ctx, ['unit_health_daily', 'dim_unit'])
    if (!fresh.ok) return staleOut(fresh.note, LIVE_UPKEEP)
    const d = await brainDims(ctx)
    const sr = await resolveBrainScope(ctx, d, input)
    if (!sr.ok) return sr.out
    const phys = physOfScope(d, sr.scope)
    const h = await readHealthLatest(ctx, phys)
    const byBand: Record<string, number> = {}
    for (const r of h.rows) byBand[str(r.band) || 'unrated'] = (byBand[str(r.band) || 'unrated'] || 0) + 1
    const band = lc(input?.band).trim()
    let rows = h.rows.slice()
    if (band) rows = rows.filter(r => lc(r.band) === band)
    rows.sort((a, b) => (a.score == null ? 999 : num(a.score)) - (b.score == null ? 999 : num(b.score)))
    const lim = clampLimit(input?.limit, 20, 60)
    const partial = h.rows.filter(r => r.partial === true).length
    return {
      day: h.day, scope: sr.scope.label,
      apartments: h.rows.length, by_band: byBand,
      units: rows.slice(0, lim).map(r => ({
        unit: str(r.nickname) || physName(ctx, d, str(r.physical_unit_id)), building: buildingLabel(d, r.building_id),
        score: r.score, band: r.band,
        what_took_points_off: (Array.isArray(r.drivers) ? r.drivers : []).map((x: any) => `−${Math.abs(round2(num(x?.points)))} ${str(x?.key)}: ${str(x?.why)}`),
        repeat_systems: Array.isArray(r.repeat_systems) && r.repeat_systems.length ? r.repeat_systems.map(sysWord) : undefined,
        review_avg: r.review_avg_live, reviews: r.review_n, guest_issues_per_100_nights: r.glitches_per_100_nights, occupied_nights_90d: r.occupied_nights_90d,
        pm_overdue: r.pm_overdue_count || undefined, last_inspection_pass_pct: r.last_inspection_pass == null ? null : Math.round(num(r.last_inspection_pass) * 100),
        net_revenue_90d: hideMoney(ctx, r.net_revenue_90d == null ? null : Math.round(num(r.net_revenue_90d))),
        upkeep_billed_amount_90d: hideMoney(ctx, r.upkeep_billed_90d == null ? null : Math.round(num(r.upkeep_billed_90d))),
        upkeep_and_refunds_pct_of_revenue: r.upkeep_cost_pct_rev,
      })),
      count: Math.min(rows.length, lim), total_rows: rows.length, truncated: rows.length > lim || h.truncated,
      formula: input?.formula ? (h.rows[0]?.formula || 'not stored on the rows') : undefined,
      note: [
        'Worst first. Upkeep money is ' + BILLED_NOTE + ' and is shown, not scored.',
        input?.formula ? '' : 'Pass formula: true for the exact formula.',
        partial ? `${partial} row(s) were built from a short read upstream (partial).` : '',
        rows.length > lim ? `Listing ${lim} of ${rows.length}.` : '',
      ].filter(Boolean).join(' '),
      _meta: brainMeta({ source: 'unit_health_daily (' + BRAIN_SOURCE + ')', window: `as of ${h.day || '—'} (90-day inputs)`, n: h.rows.length, truncated: rows.length > lim || h.truncated, basis: 'upkeep-aware health score', as_of: fresh.as_of }),
    }
  },
}

// ───────────────────────────────────────────────────────────── repeat_failures
const REPEAT_FAILURES: EveTool = {
  name: 'repeat_failures',
  money: true,
  description: 'WHERE THE SAME THING BROKE AGAIN — apartments where one system (hvac, plumbing, appliance, lock_access, electrical, pest, wifi_tv, furniture) failed two or more times in the window (default 180 days), worst first, each with the event timeline: opened, closed, what it was, how it was resolved (when recorded), days since the previous one, and what was billed to the owner. Params: scope / building / unit / owner / market (optional), days, system (optional). Routine PM, filters and deep cleans are not failures and are not counted.',
  input_schema: obj({ scope: S.str, building: S.str, unit: S.str, id: S.str, owner: S.str, market: S.str, days: S.num, system: S.str, limit: S.num }),
  run: async (input, ctx) => {
    const fresh = await freshAll(ctx, ['fact_maintenance_event', 'dim_unit'])
    if (!fresh.ok) return staleOut(fresh.note, LIVE_UPKEEP)
    const days = clampDays(input?.days, 180, 400)
    const since = shiftDay(ctx.today, -days)
    const sys = input?.system ? systemKey(input.system) : null
    if (input?.system && !sys) return { error: `Unknown system "${input.system}".`, systems: SYSTEMS }
    const d = await brainDims(ctx)
    const sr = await resolveBrainScope(ctx, d, input)
    if (!sr.ok) return sr.out
    const ev = await readEvents(ctx, { sinceDay: since, listingIds: sr.scope.physId ? null : sr.scope.listingIds, physId: sr.scope.physId || null, system: sys })
    const groups: Record<string, any[]> = {}
    for (const e of ev.rows) {
      const s = str(e.system) || 'other'
      if (s === 'other' && sys !== 'other') continue
      const pid = str(e.physical_unit_id) || str(e.listing_id)
      if (!pid) continue
      ;(groups[pid + '|' + s] = groups[pid + '|' + s] || []).push(e)
    }
    const list = Object.keys(groups).filter(k => groups[k].length >= 2).map(k => {
      const evs = groups[k].slice().sort((a, b) => str(a.opened_at).localeCompare(str(b.opened_at)))
      const pid = k.slice(0, k.lastIndexOf('|'))
      const timeline = evs.map((e, i) => {
        const prev = i ? evs[i - 1] : null
        const prevFix = prev ? etDay(prev.closed_at || prev.opened_at) : ''
        return {
          opened: etDay(e.opened_at), closed: e.closed_at ? etDay(e.closed_at) : (e.is_open ? 'still open' : null),
          what: str(e.title).replace(/\s+/g, ' ').slice(0, 90), source: e.source,
          resolution: e.resolution || 'not recorded', part: e.part || undefined,
          days_after_previous_fix: prev && prevFix ? daysBetween(prevFix, etDay(e.opened_at)) : null,
          billed_to_owner_amount: hideMoney(ctx, e.billed_owner == null ? null : round2(num(e.billed_owner))),
        }
      })
      const gaps = timeline.map(t => t.days_after_previous_fix).filter((x): x is number => x != null)
      const billed = evs.reduce((s, e) => s + num(e.billed_owner), 0)
      return {
        unit: physName(ctx, d, pid), building: buildingLabel(d, evs[0].building_id || d.byListing[str(evs[0].listing_id)]?.building_id),
        system: sysWord(evs[0].system), failures: evs.length, still_open: evs.filter(e => e.is_open === true).length,
        first: timeline[0].opened, last: timeline[timeline.length - 1].opened,
        shortest_days_between: gaps.length ? Math.min(...gaps) : null,
        billed_to_owner_amount: hideMoney(ctx, round2(billed)),
        refunds_amount: hideMoney(ctx, round2(evs.reduce((s, e) => s + num(e.refund), 0))),
        timeline: timeline.slice(-8),
        earlier_events_not_listed: timeline.length > 8 ? timeline.length - 8 : undefined,
      }
    }).sort((a, b) => (b.failures - a.failures) || b.last.localeCompare(a.last))
    const lim = clampLimit(input?.limit, 15, 40)
    return {
      scope: sr.scope.label, window: `${since} → ${ctx.today} (${days} days, opened date)`, system: sys ? sysWord(sys) : 'every system but "other"',
      apartments_with_repeats: list.length,
      repeats: list.slice(0, lim),
      count: Math.min(list.length, lim), total_rows: list.length, truncated: list.length > lim || ev.truncated,
      note: [
        `Amounts are ${BILLED_NOTE}. "resolution" is recorded only when someone picked it at close.`,
        ev.truncated ? 'The event read stopped early — counts are floors.' : '',
        list.length > lim ? `Listing ${lim} of ${list.length}.` : '',
        'For what to do about one of them, upkeep_advise.',
      ].filter(Boolean).join(' '),
      _meta: brainMeta({ source: 'fact_maintenance_event (' + BRAIN_SOURCE + ')', window: `${since} → ${ctx.today}`, n: ev.rows.length, truncated: list.length > lim || ev.truncated, basis: BILLED_NOTE, as_of: fresh.as_of }),
    }
  },
}

// ───────────────────────────────────────────────────────────── upkeep_rank
type RankRow = {
  pid: string; acc: Acc; events: number; repeats: number; bySystem: Record<string, { n: number; repeats: number }>; billedEvents: number
  reviewAvg: number | null; reviews: number; priorAvg: number | null; overdue: number | null; maxLate: number; health: number | null; band: string | null
}
const pctRank = (vals: number[], x: number): number => { if (!vals.length) return 0; let le = 0; for (const v of vals) if (v <= x) le++; return le / vals.length }

const UPKEEP_RANK: EveTool = {
  name: 'upkeep_rank',
  money: true,
  description: 'WHICH APARTMENTS COST THE MOST TO KEEP UP FOR WHAT THEY EARN — per apartment over the window (default 180 days): net revenue, occupied nights, upkeep billed to the owner (total, per occupied night, % of net), maintenance events and repeat failures by system, guest issues per 100 nights, review average and its trend (current listing), overdue preventative work, today\'s health score — ranked by a stated composite, top 15 with the reasons. Params: building, owner or market (or scope); days; limit. Billed upkeep is billed to owner, not true cost. For one apartment\'s repair-vs-replace call, upkeep_advise.',
  input_schema: obj({ scope: S.str, building: S.str, owner: S.str, market: S.str, days: S.num, limit: S.num }),
  run: async (input, ctx) => {
    const fresh = await freshAll(ctx, ['fact_unit_day', 'fact_maintenance_event', 'dim_unit'])
    if (!fresh.ok) return staleOut(fresh.note, LIVE_UPKEEP)
    const days = clampDays(input?.days, 180, 400)
    const to = shiftDay(ctx.today, -1)
    const from = shiftDay(to, -(days - 1))
    const d = await brainDims(ctx)
    const sr = await resolveBrainScope(ctx, d, input)
    if (!sr.ok) return sr.out
    const scope = sr.scope
    if (scope.listingIds && !scope.listingIds.length) return { scope: scope.label, note: 'No units in that scope.', units: [], total_rows: 0, truncated: false }
    const reviewIds = scope.listingIds
    const healthFresh = await brainFresh(ctx, 'unit_health_daily')
    const [udS, evS, hS, r1S, r2S, calS] = await Promise.all([
      trySect(() => readUnitDays(ctx, from, to, scope.listingIds)),
      trySect(() => readEvents(ctx, { sinceDay: from, untilDay: to, listingIds: scope.listingIds })),
      trySect(async () => (healthFresh.ok ? readHealthLatest(ctx, physOfScope(d, scope)) : null)),
      trySect(() => reviewStats(ctx, { ids: reviewIds, days })),
      trySect(() => reviewStats(ctx, { ids: reviewIds, days: days * 2 })),
      trySect((): Promise<DueCalendar> => dueCalendarCached(ctx.today)),
    ])
    if (!udS.ok) return { error: 'The nightly unit-day facts could not be read: ' + udS.why }
    const rows: Record<string, RankRow> = {}
    const live = (pid: string) => (d.byPhys[pid] || []).some(u => u.status !== 'inactive') || (!d.byPhys[pid] && !!ctx.listingMeta[pid])
    const slot = (pid: string): RankRow => (rows[pid] = rows[pid] || { pid, acc: newAcc(), events: 0, repeats: 0, bySystem: {}, billedEvents: 0, reviewAvg: null, reviews: 0, priorAvg: null, overdue: null, maxLate: 0, health: null, band: null })
    const pidOf = (lid: any, pid?: any): string => str(pid) || (d.byListing[str(lid)] ? d.byListing[str(lid)].physical_unit_id : str(lid))
    for (const r of udS.v.rows) { const pid = pidOf(r.listing_id, r.physical_unit_id); if (live(pid)) addDayRow(slot(pid).acc, r, pid) }
    if (evS.ok) for (const e of evS.v.rows) {
      const pid = pidOf(e.listing_id, e.physical_unit_id)
      if (!pid || !rows[pid]) continue
      const x = rows[pid]
      x.events++; if (e.is_repeat === true) x.repeats++
      x.billedEvents += num(e.billed_owner)
      const s = str(e.system) || 'other'
      const b = (x.bySystem[s] = x.bySystem[s] || { n: 0, repeats: 0 })
      b.n++; if (e.is_repeat === true) b.repeats++
    }
    // Reviews: the window, and the window before it (derived from twice the window), weighted per apartment.
    const revBy = (st: ReviewStats | null): Record<string, { sum: number; n: number }> => {
      const o: Record<string, { sum: number; n: number }> = {}
      if (!st) return o
      for (const u of st.units) {
        if (u.avg == null || !u.reviews) continue
        const pid = pidOf(u.listing_id)
        const a = (o[pid] = o[pid] || { sum: 0, n: 0 })
        a.sum += u.avg * u.reviews; a.n += u.reviews
      }
      return o
    }
    const rv1 = revBy(r1S.ok ? r1S.v : null), rv2 = revBy(r2S.ok ? r2S.v : null)
    for (const pid of Object.keys(rows)) {
      const a = rv1[pid], b = rv2[pid]
      if (a && a.n) { rows[pid].reviewAvg = round2(a.sum / a.n); rows[pid].reviews = a.n }
      if (b && b.n - (a ? a.n : 0) >= 2) rows[pid].priorAvg = round2((b.sum - (a ? a.sum : 0)) / (b.n - (a ? a.n : 0)))
    }
    if (calS.ok) {
      for (const pid of Object.keys(rows)) rows[pid].overdue = 0
      for (const bl of calS.v.buildings) for (const it of bl.items) {
        if (it.band !== 'late') continue
        const pid = pidOf(it.listingId)
        if (!rows[pid]) continue
        rows[pid].overdue = (rows[pid].overdue || 0) + 1
        if (it.daysOver > rows[pid].maxLate) rows[pid].maxLate = it.daysOver
      }
    }
    if (hS.ok && hS.v) for (const h of hS.v.rows) { const x = rows[str(h.physical_unit_id)]; if (x) { x.health = h.score == null ? null : num(h.score); x.band = h.band ? str(h.band) : null } }

    const list = Object.keys(rows).map(k => rows[k])
    const nightsOfRow = (x: RankRow) => nightsOf(x.acc).occupied
    const costPerNight = (x: RankRow): number => { const n = nightsOfRow(x); return n > 0 ? x.acc.billed / n : (x.acc.billed > 0 ? Infinity : 0) }
    const glitchRate = (x: RankRow): number => { const n = nightsOfRow(x); return n >= 10 ? (x.acc.glitches / n) * 100 : x.acc.glitches * 5 }
    const healthGap = (x: RankRow): number => (x.health == null ? 0 : 100 - x.health)
    const cpn = list.map(costPerNight), rep = list.map(x => x.repeats), gr = list.map(glitchRate), hg = list.map(healthGap), od = list.map(x => x.overdue || 0)
    const money = ctx.canMoney
    const W = money ? { cost: 35, repeats: 20, issues: 20, health: 15, overdue: 10 } : { cost: 0, repeats: 30, issues: 30, health: 25, overdue: 15 }
    const composite = (x: RankRow): number => Math.round(
      W.cost * (costPerNight(x) > 0 ? pctRank(cpn, costPerNight(x)) : 0)
      + W.repeats * (x.repeats > 0 ? pctRank(rep, x.repeats) : 0)
      + W.issues * (glitchRate(x) > 0 ? pctRank(gr, glitchRate(x)) : 0)
      + W.health * (healthGap(x) > 0 ? pctRank(hg, healthGap(x)) : 0)
      + W.overdue * ((x.overdue || 0) > 0 ? pctRank(od, x.overdue || 0) : 0))
    const ranked = list.map(x => ({ x, c: composite(x) })).sort((a, b) => b.c - a.c)
    const lim = clampLimit(input?.limit, 15, 30)
    const units = ranked.slice(0, lim).map(({ x, c }) => {
      const p = perfOf(x.acc)
      const cn = costPerNight(x)
      const reasons: string[] = []
      if (money && cn > 0 && pctRank(cpn, cn) >= 0.75) reasons.push(Number.isFinite(cn) ? `top quarter for upkeep billed per occupied night ($${round2(cn)})` : 'upkeep billed with no occupied nights')
      if (x.repeats > 0) reasons.push(`${x.repeats} repeat failure${x.repeats === 1 ? '' : 's'} (${Object.keys(x.bySystem).filter(s => x.bySystem[s].repeats > 0).map(sysWord).join(', ')})`)
      if (glitchRate(x) > 0 && pctRank(gr, glitchRate(x)) >= 0.75) reasons.push(`${x.acc.glitches} guest issue${x.acc.glitches === 1 ? '' : 's'} on ${p.nights_booked} occupied nights`)
      if (x.health != null && x.health < 70) reasons.push(`health ${x.health} (${x.band})`)
      if ((x.overdue || 0) > 0) reasons.push(`${x.overdue} preventative job${x.overdue === 1 ? '' : 's'} overdue, worst ${x.maxLate} days`)
      if (x.reviewAvg != null && x.priorAvg != null && x.reviews >= 3 && x.reviewAvg <= x.priorAvg - 0.2) reasons.push(`reviews down: ${x.priorAvg} → ${x.reviewAvg}`)
      return {
        unit: physName(ctx, d, x.pid), building: buildingLabel(d, d.byPhys[x.pid]?.[0]?.building_id),
        composite: c, why: reasons.length ? reasons : ['no single driver stands out; ranked on the combination'],
        net_revenue: hideMoney(ctx, p.net_revenue), occupied_nights: p.nights_booked,
        upkeep_billed_amount: hideMoney(ctx, Math.round(x.acc.billed)),
        upkeep_cost_billed_per_occupied_night: hideMoney(ctx, Number.isFinite(cn) ? round2(cn) : null),
        upkeep_billed_pct_of_net: money && p.net_revenue > 0 ? Math.round((x.acc.billed / p.net_revenue) * 1000) / 10 : null,
        maintenance_events: x.events, repeat_failures: x.repeats,
        by_system: Object.keys(x.bySystem).sort((a, b) => x.bySystem[b].n - x.bySystem[a].n).slice(0, 4).map(s => `${sysWord(s)} ${x.bySystem[s].n}${x.bySystem[s].repeats ? ` (${x.bySystem[s].repeats} repeat)` : ''}`),
        guest_issues_per_100_nights: p.nights_booked >= 10 ? round2((x.acc.glitches / p.nights_booked) * 100) : null,
        guest_issues: x.acc.glitches,
        review_avg: x.reviewAvg, reviews: x.reviews, review_avg_window_before: x.priorAvg,
        review_trend: x.reviewAvg != null && x.priorAvg != null ? (x.reviewAvg - x.priorAvg >= 0.2 ? 'up' : x.reviewAvg - x.priorAvg <= -0.2 ? 'down' : 'flat') : null,
        pm_overdue: x.overdue, health: x.health, band: x.band,
      }
    })
    const gaps = [
      evS.ok ? '' : 'maintenance events could not be read (' + evS.why + ')',
      r1S.ok ? '' : 'reviews could not be read',
      calS.ok ? '' : 'the upkeep ledger could not be built, so overdue PM is unknown',
      healthFresh.ok ? (hS.ok ? '' : 'health could not be read') : 'health scores are stale and left out',
    ].filter(Boolean)
    const truncated = udS.v.truncated || (evS.ok && evS.v.truncated) || ranked.length > lim
    return {
      scope: scope.label, window: `${from} → ${to} (${days} nights)`,
      composite_formula: money
        ? 'composite 0–100 = 35 × billed upkeep per occupied night + 20 × repeat failures + 20 × guest issues per 100 nights + 15 × (100 − health) + 10 × overdue PM jobs, each as a percentile among the apartments compared (0 when the apartment has none). Higher = more upkeep pressure.'
        : 'composite 0–100 = 30 × repeat failures + 30 × guest issues per 100 nights + 25 × (100 − health) + 15 × overdue PM jobs, each as a percentile among the apartments compared. (Billed upkeep is left out because dollar amounts are hidden for this user.)',
      units, apartments_compared: list.length, count: units.length, total_rows: ranked.length, truncated,
      unavailable: gaps.length ? gaps : undefined,
      basis: `${BRAIN_NIGHTS_BASIS} Upkeep = Breezeway maintenance tasks finished in the window — ${BILLED_NOTE}. Reviews: current channel listing only; the trend compares this window with the one before.`,
      note: 'A rank, not a verdict: a unit can carry upkeep because it is busy or newly onboarded. For repair vs replace on one, upkeep_advise.' + (truncated ? ' Partial — say so.' : ''),
      _meta: brainMeta({ source: 'fact_unit_day + fact_maintenance_event + unit_health_daily (' + BRAIN_SOURCE + ') + guesty_reviews + the upkeep ledger', window: `${from} → ${to}`, n: list.length, truncated, basis: BILLED_NOTE, as_of: fresh.as_of }),
    }
  },
}

// ───────────────────────────────────────────────────────────── upkeep_advise
const RULES = {
  replace: '3+ failures of the same system in 180 days, or 2 within 30 days of a fix → replace / escalate to the owner',
  spend: 'billed spend on that system > 25% of the apartment\'s 90-day net revenue → escalate to the owner',
  repair: 'otherwise → repair and watch',
}

const UPKEEP_ADVISE: EveTool = {
  name: 'upkeep_advise',
  money: true,
  description: 'REPAIR, REPLACE OR WATCH — the evidence for one apartment (and one system, or its most-failing systems): that system\'s event history (dates, what was done, days between failures), what was billed to the owner for it (billed, not true cost), guest impact (guest issues, refunds), what the apartment earns, and a recommendation with the rule that produced it: 3+ failures of the same system in 180 days, or 2 within 30 days of a fix → replace / escalate to owner; billed spend on the system > 25% of 90-day net revenue → escalate; otherwise repair and watch. Also what is NOT known (true cost, asset age). Params: unit (name) or id, building (optional, to narrow), system (optional: hvac, plumbing, appliance, lock_access, electrical, pest, wifi_tv, furniture). Advice only — it never creates a task or spends.',
  input_schema: obj({ unit: S.str, id: S.str, building: S.str, system: S.str }),
  run: async (input, ctx) => {
    if (!input?.unit && !input?.id) return { error: 'Which unit? Give the unit as building AND number.' }
    const fresh = await freshAll(ctx, ['fact_maintenance_event', 'fact_unit_day', 'dim_unit'])
    if (!fresh.ok) return staleOut(fresh.note, 'Use unit_360 (it falls back to the live readers) and glitches for this unit, and say the nightly history was not available.')
    const sys = input?.system ? systemKey(input.system) : null
    if (input?.system && !sys) return { error: `Unknown system "${input.system}".`, systems: SYSTEMS }
    const d = await brainDims(ctx)
    const sr = await resolveBrainScope(ctx, d, { unit: input?.unit, id: input?.id, building: input?.building })
    if (!sr.ok) return sr.out
    const scope = sr.scope
    const pid = scope.physId || ''
    const since365 = shiftDay(ctx.today, -365)
    const d180 = shiftDay(ctx.today, -180), d90 = shiftDay(ctx.today, -90)
    const [ev, ud] = await Promise.all([
      readEvents(ctx, { sinceDay: since365, physId: pid, system: sys }),
      readUnitDays(ctx, shiftDay(ctx.today, -90), shiftDay(ctx.today, -1), scope.listingIds),
    ])
    const acc = newAcc()
    for (const r of ud.rows) addDayRow(acc, r, pid)
    const p = perfOf(acc)
    const bySys: Record<string, any[]> = {}
    for (const e of ev.rows) { const s = str(e.system) || 'other'; (bySys[s] = bySys[s] || []).push(e) }
    let systems = sys ? [sys] : Object.keys(bySys).filter(s => s !== 'other').sort((a, b) => bySys[b].length - bySys[a].length).slice(0, 3)
    if (!sys && !systems.length && bySys.other) systems = ['other']
    const severity = (r: string) => (r === 'REPLACE / ESCALATE TO OWNER' ? 3 : r === 'ESCALATE TO OWNER' ? 2 : r === 'REPAIR AND WATCH' ? 1 : 0)
    const advice = systems.map(s => {
      const evs = (bySys[s] || []).slice().sort((a, b) => str(a.opened_at).localeCompare(str(b.opened_at)))
      const in180 = evs.filter(e => etDay(e.opened_at) >= d180)
      const history = evs.map((e, i) => {
        const prev = i ? evs[i - 1] : null
        const fix = prev ? etDay(prev.closed_at || prev.opened_at) : ''
        return {
          opened: etDay(e.opened_at), closed: e.closed_at ? etDay(e.closed_at) : (e.is_open ? 'still open' : null),
          what: str(e.title).replace(/\s+/g, ' ').slice(0, 90), done: e.resolution || 'not recorded', part: e.part || undefined,
          days_after_previous_fix: prev && fix ? daysBetween(fix, etDay(e.opened_at)) : null,
          guest_issue: e.source === 'glitch' || e.guest_impacting === true,
          billed_to_owner_amount: hideMoney(ctx, e.billed_owner == null ? null : round2(num(e.billed_owner))),
        }
      })
      const quick = history.filter(h => h.opened >= d180 && h.days_after_previous_fix != null && h.days_after_previous_fix >= 0 && h.days_after_previous_fix <= 30)
      const spend90 = evs.filter(e => etDay(e.opened_at) >= d90).reduce((t, e) => t + num(e.billed_owner), 0)
      const spendPct = p.net_revenue > 0 ? (spend90 / p.net_revenue) * 100 : (spend90 > 0 ? Infinity : 0)
      let rec = 'WATCH', rule = 'no failure of this system on record in the last 365 days — nothing to decide yet'
      if (in180.length >= 3) { rec = 'REPLACE / ESCALATE TO OWNER'; rule = `${RULES.replace} — fired: ${in180.length} failures in 180 days` }
      else if (quick.length >= 1) { rec = 'REPLACE / ESCALATE TO OWNER'; rule = `${RULES.replace} — fired: failed again ${quick[0].days_after_previous_fix} days after a fix (${quick[0].opened})` }
      else if (spendPct > 25) { rec = 'ESCALATE TO OWNER'; rule = `${RULES.spend} — fired: ${Number.isFinite(spendPct) ? Math.round(spendPct) + '%' : 'spend with no net revenue'}` }
      else if (evs.length) { rec = 'REPAIR AND WATCH'; rule = `${RULES.repair} — ${in180.length} failure(s) in 180 days, none within 30 days of a fix, billed spend ${Math.round(spendPct)}% of 90-day net` }
      return {
        system: sysWord(s), recommendation: rec, rule_that_fired: rule,
        failures_365d: evs.length, failures_180d: in180.length, repeat_within_30_days_of_a_fix: quick.length,
        guest_issues_180d: in180.filter(e => e.source === 'glitch' || e.guest_impacting === true).length,
        refunds_amount_365d: hideMoney(ctx, round2(evs.reduce((t, e) => t + num(e.refund), 0))),
        billed_to_owner_amount_90d: hideMoney(ctx, round2(spend90)),
        billed_to_owner_amount_365d: hideMoney(ctx, round2(evs.reduce((t, e) => t + num(e.billed_owner), 0))),
        billed_spend_pct_of_90d_net: Number.isFinite(spendPct) ? Math.round(spendPct * 10) / 10 : null,
        history: history.slice(-10),
        earlier_events_not_listed: history.length > 10 ? history.length - 10 : undefined,
      }
    }).sort((a, b) => severity(b.recommendation) - severity(a.recommendation))
    const du = d.byListing[(scope.listingIds || [])[0] || '']
    return {
      unit: scope.label, building: buildingLabel(d, du ? du.building_id : null), rolled_together: scope.rolled,
      equipment_on_record: du && du.ac_type && du.ac_type !== 'unknown' ? { ac_type: du.ac_type } : undefined,
      overall: advice.length ? advice[0].recommendation : 'WATCH',
      advice: advice.length ? advice : [{ recommendation: 'WATCH', rule_that_fired: `no ${sys ? sysWord(sys) : 'system'} failure on record for this apartment in the last 365 days` }],
      what_it_earns_90d: { net_revenue: hideMoney(ctx, p.net_revenue), occupied_nights: p.nights_booked, adr: hideMoney(ctx, p.adr), occupancy_pct: p.occupancy_pct, owner_nights: p.owner_nights },
      guest_impact_90d: { guest_issues: acc.glitches, refunds_amount: hideMoney(ctx, round2(acc.refunds)) },
      rules: [RULES.replace, RULES.spend, RULES.repair],
      not_known: [
        'true cost — only what was billed to the owner is on record (labour, parts and vendor cost are not captured)',
        'asset age, model, warranty and install date — not tracked anywhere yet',
        'whether a "fix" was a full repair — resolution is recorded only when someone picks it at close',
        'blocked nights — the Guesty calendar is not stored, so lost nights read as vacant',
      ],
      how_to_say_it: 'State the recommendation, the rule that fired and the evidence; every amount is billed to owner, not true cost. This is advice only — nothing was created or spent.',
      note: ev.truncated || ud.truncated ? 'A read stopped early — counts are floors.' : undefined,
      _meta: brainMeta({ source: 'fact_maintenance_event + fact_unit_day (' + BRAIN_SOURCE + ')', window: `events ${since365} → ${ctx.today}; earnings last 90 nights`, n: ev.rows.length, truncated: ev.truncated || ud.truncated, basis: BILLED_NOTE, as_of: fresh.as_of }),
    }
  },
}

// ───────────────────────────────────────────────────────────── owner_360
function recentMonths(today: string, n: number): string[] {
  const out: string[] = []
  let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7))
  for (let i = 0; i < Math.max(1, n); i++) {
    out.push(y + '-' + (m < 10 ? '0' + m : String(m)))
    m -= 1
    if (m < 1) { m = 12; y -= 1 }
  }
  return out
}

const OWNER_360: EveTool = {
  name: 'owner_360',
  money: true,
  description: 'EVERYTHING ABOUT ONE OWNER — their units (building, status, today\'s health), and month by month (default 6, up to 13): available / occupied / owner nights, occupancy, net and gross accommodation, cleaning revenue, RevPAR, the management fee where the Revenue App carries it, upkeep billed to their units (billed, not true cost), refunds, guest issues, maintenance events and repeats, review average — with totals. Margin and labour cost are NOT in v1 and are not implied. Param: owner (name; use resolve if unsure), months.',
  input_schema: obj({ owner: S.str, months: S.num }, ['owner']),
  run: async (input, ctx) => {
    if (guarded(ctx)) return { error: 'Owners are not read out in this room.' }
    const fresh = await freshAll(ctx, ['owner_month', 'dim_unit'])
    if (!fresh.ok) return staleOut(fresh.note, 'Use owner_month / billing_month (money drawer) for this owner, and say the nightly roll-up was not available.')
    const d = await brainDims(ctx)
    const sr = await resolveBrainScope(ctx, d, { owner: input?.owner })
    if (!sr.ok) return sr.out
    const oid = sr.scope.ownerId || ''
    const n = Math.min(Math.max(Math.round(Number(input?.months) || 6), 1), 13)
    const months = recentMonths(ctx.today, n)
    const { data, error } = await ctx.db.from('owner_month').select('month,units,available_nights,occupied_nights,owner_nights,occupancy,net_accom,gross_accom,cleaning_rev,revpar,mgmt_fee,billed_owner,refunds,glitches,repeat_events,maint_events,review_avg,review_n,partial').eq('owner_id', oid).in('month', months).order('month', { ascending: false })
    if (error) return { error: 'owner_month could not be read: ' + str(error.message).slice(0, 140) }
    const rows: any[] = (data as any[]) || []
    const units = d.units.filter(u => u.owner_id === oid)
    const phys = Array.from(new Set(units.map(u => u.physical_unit_id)))
    const hFresh = await brainFresh(ctx, 'unit_health_daily')
    const hS = hFresh.ok ? await trySect(() => readHealthLatest(ctx, phys)) : null
    const health: Record<string, any> = {}
    if (hS && hS.ok) for (const h of hS.v.rows) health[str(h.physical_unit_id)] = h
    const sum = (k: string) => rows.reduce((s, r) => s + num(r[k]), 0)
    const avail = sum('available_nights'), occ = sum('occupied_nights'), own = sum('owner_nights'), net = sum('net_accom')
    const m = (v: any) => hideMoney(ctx, v == null ? null : round2(num(v)))
    const fees = rows.filter(r => r.mgmt_fee != null)
    return {
      owner: sr.scope.label, months_asked: months.length, months_on_record: rows.length,
      units: phys.map(pid => {
        const h = health[pid]
        const list = d.byPhys[pid] || []
        return { unit: physName(ctx, d, pid), building: buildingLabel(d, list[0]?.building_id), status: list.some(u => u.status !== 'inactive') ? 'active' : 'inactive', listings: list.length > 1 ? list.length : undefined, health: h ? h.score : null, band: h ? h.band : null, top_driver: h && Array.isArray(h.drivers) && h.drivers[0] ? str(h.drivers[0].why) : undefined }
      }),
      by_month: rows.map(r => ({
        month: r.month, units: r.units, available_nights: r.available_nights, occupied_nights: r.occupied_nights, owner_nights: r.owner_nights, occupancy_pct: r.occupancy,
        net_accom: m(r.net_accom), gross_accom: m(r.gross_accom), cleaning_revenue: m(r.cleaning_rev), revpar: m(r.revpar), mgmt_fee: m(r.mgmt_fee),
        upkeep_billed_amount: m(r.billed_owner), refunds: m(r.refunds), guest_issues: r.glitches, maintenance_events: r.maint_events, repeat_failures: r.repeat_events,
        review_avg: r.review_avg, reviews: r.review_n,
      })),
      overall: rows.length ? {
        available_nights: avail, occupied_nights: occ, owner_nights: own, occupancy_pct: avail - own > 0 ? Math.round((occ / (avail - own)) * 1000) / 10 : null,
        net_accom: m(net), revpar: m(avail > 0 ? net / avail : null), upkeep_billed_amount: m(sum('billed_owner')), refunds: m(sum('refunds')),
        mgmt_fee: fees.length ? m(fees.reduce((s, r) => s + num(r.mgmt_fee), 0)) : null, mgmt_months_on_record: fees.length,
        guest_issues: sum('glitches'), maintenance_events: sum('maint_events'), repeat_failures: sum('repeat_events'),
      } : undefined,
      not_in_v1: 'Margin, labour cost on their units, claims recovered and statement lines are not in the roll-up yet, so there is no margin or profit figure — do not imply one.',
      note: [
        rows.length ? '' : 'No owner_month rows for these months — the roll-up may not reach back that far yet.',
        rows.length < months.length ? `Only ${rows.length} of ${months.length} months are on record.` : '',
        `Upkeep is ${BILLED_NOTE}. Nights are listing-nights; the current month is month-to-date. A unit's owner is today's owner for its whole history.`,
        hFresh.ok ? '' : 'Health scores are stale and left out.',
      ].filter(Boolean).join(' '),
      _meta: brainMeta({ source: 'owner_month + dim_unit + unit_health_daily (' + BRAIN_SOURCE + ')', window: `${months[months.length - 1]} → ${months[0]}`, n: rows.length, truncated: rows.length < months.length, basis: 'net accommodation; partial roll-up (no margin)', as_of: fresh.as_of }),
    }
  },
}

// ───────────────────────────────────────────────────────────── vendor_360
const NOT_ENOUGH_VENDOR = 'Not enough vendor-tagged work yet: only guest issues closed with a vendor picked carry a vendor so far, so the vendor roll-up is empty or thin. Use vendor_work for this vendor\'s open and finished work, guest issues and invoices.'

const VENDOR_360: EveTool = {
  name: 'vendor_360',
  money: true,
  description: 'ONE VENDOR, MONTH BY MONTH, FROM THE BUSINESS BRAIN — jobs, jobs closed, median hours to close, repeat visits (the same system failing again where they worked), what was billed and their project invoices, plus their latest vendor-tagged events. Says plainly when there is not enough vendor-tagged work yet (then use vendor_work). Param: vendor (name or key), months (default 6).',
  input_schema: obj({ vendor: S.str, months: S.num }, ['vendor']),
  run: async (input, ctx) => {
    if (guarded(ctx)) return { error: 'Vendor records are not read out in this room.' }
    const f = await brainFresh(ctx, 'vendor_month')
    if (!f.ok) return f.reason === 'empty' ? { stale: true, not_enough_data: true, note: NOT_ENOUGH_VENDOR } : staleOut(f.note, 'Use vendor_work for this vendor.')
    const vendors = await getVendors(true)
    const t = lc(input?.vendor).trim()
    if (!t) return { error: 'Which vendor?' }
    const exact = vendors.filter(v => lc(v.key) === t || lc(v.label) === t)
    const loose = exact.length ? exact : vendors.filter(v => lc(v.label).includes(t) || lc(v.key).includes(t.replace(/\s+/g, '-')))
    if (loose.length > 1) return { ambiguous: true, question: `Which one? "${input.vendor}" fits ${loose.length} vendors.`, candidates: loose.slice(0, 10).map(v => ({ key: v.key, name: v.label })) }
    const key = loose.length ? loose[0].key : t.replace(/\s+/g, '-')
    const label = loose.length ? loose[0].label : str(input.vendor)
    const n = Math.min(Math.max(Math.round(Number(input?.months) || 6), 1), 13)
    const months = recentMonths(ctx.today, n)
    const [mS, eS] = await Promise.all([
      trySect(async () => {
        const { data, error } = await ctx.db.from('vendor_month').select('month,jobs,jobs_closed,median_hours_to_close,repeat_visits,billed_owner,invoices_total,invoices_n,partial').eq('vendor_key', key).in('month', months).order('month', { ascending: false })
        if (error) throw error
        return (data as any[]) || []
      }),
      trySect(() => pageRows<any>((x, y) => ctx.db.from('fact_maintenance_event').select('event_id,listing_id,physical_unit_id,system,title,opened_at,closed_at,hours_to_close,is_repeat,billed_owner').eq('vendor_key', key).gte('opened_at', shiftDay(ctx.today, -180) + 'T00:00:00Z').order('opened_at', { ascending: false }).order('event_id').range(x, y), 2)),
    ])
    const rows = mS.ok ? mS.v : []
    if (!rows.length) return { vendor: label, key, found_in_saved_vendors: loose.length > 0, not_enough_data: true, note: NOT_ENOUGH_VENDOR, _meta: brainMeta({ source: 'vendor_month (' + BRAIN_SOURCE + ')', window: `${months[months.length - 1]} → ${months[0]}`, n: 0, as_of: f.as_of }) }
    const d = await brainDims(ctx)
    const ev = eS.ok ? eS.v.rows : []
    return {
      vendor: label, key,
      by_month: rows.map(r => ({ month: r.month, jobs: r.jobs, jobs_closed: r.jobs_closed, median_hours_to_close: r.median_hours_to_close, repeat_visits: r.repeat_visits, billed_to_owner_amount: hideMoney(ctx, r.billed_owner == null ? null : round2(num(r.billed_owner))), invoices_amount: hideMoney(ctx, r.invoices_total == null ? null : round2(num(r.invoices_total))), invoices: r.invoices_n })),
      latest_events: ev.slice(0, 12).map(e => ({ unit: physName(ctx, d, str(e.physical_unit_id) || str(e.listing_id)), system: sysWord(e.system), what: str(e.title).slice(0, 80), opened: etDay(e.opened_at), closed: e.closed_at ? etDay(e.closed_at) : 'open', repeat: e.is_repeat === true || undefined })),
      events_180d: ev.length, events_truncated: eS.ok ? eS.v.truncated : undefined,
      note: `Thin by design in v1: only work that carries a vendor (guest issues with a vendor picked), not Breezeway tasks assigned to their crew or cleaning invoices. Amounts billed are ${BILLED_NOTE}. For open work and the full invoice picture, vendor_work.`,
      _meta: brainMeta({ source: 'vendor_month + fact_maintenance_event (' + BRAIN_SOURCE + ')', window: `${months[months.length - 1]} → ${months[0]}`, n: rows.length, truncated: rows.length < months.length, basis: BILLED_NOTE, as_of: f.as_of }),
    }
  },
}

export const BRAIN_OPS_TOOLS: EveTool[] = [UNIT_HEALTH, REPEAT_FAILURES, UPKEEP_RANK, UPKEEP_ADVISE, VENDOR_360]
export const BRAIN_OWNER_TOOLS: EveTool[] = [OWNER_360]
