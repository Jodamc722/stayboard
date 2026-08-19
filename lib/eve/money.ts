// MONEY domain — real revenue maths, owner statements, billing, direct bookings, pacing.
//
// Every tool here is marked money:true, which means its output passes through redactMoney() for
// anyone without the `money` permission. Occupancy, ADR and RevPAR deliberately survive redaction
// (they are ratios, not amounts) — that is the same posture the rest of the app takes.
//
// The old `revenue` tool this replaces summed money_total over reservations, which is wrong in three
// ways: it ignored the check-in/check-out proration, it ignored cleaning attribution, and it counted
// cancelled stays only by a loose regex. buildKpi() is the number the boards actually show.
import 'server-only'
import { buildKpi } from '@/lib/kpi'
import { ownerMonths, rollup, statementDetail, coverageFor, MONTH_LABEL } from '@/lib/owner-statements'
import { billingMonth, monthRange } from '@/lib/billing'
import { buildAudit, auditMonths } from '@/lib/owner-audit'
import { monthsAhead } from '@/lib/owner-report'
import { paceStatus, paceThresholds } from '@/lib/pacing'
import { bucketFor, familyFor, otaGroupFor, stateFor, isWon, accomOf, etDay } from '@/lib/marketing'
import type { EveTool, EveDomain } from './types'
import { obj, S } from './types'
import { clampLimit, clampDays, shiftDay, lc, has, safe, round2, num, DEAD_LISTING } from './ctx'

function monthKey(v: any, fallback: string): string {
  const s = String(v || '').trim()
  return /^\d{4}-\d{2}$/.test(s) ? s : fallback
}
function thisMonth(today: string): string { return today.slice(0, 7) }

export const MONEY_TOOLS: EveTool[] = [
  {
    name: 'kpi',
    description: 'THE revenue and performance numbers, computed exactly the way the app boards compute them: occupancy %, ADR, RevPAR, total revenue, channel mix, and the cleaning economics (fee per turn, cost per turn, margin) — each compared against the SAME-LENGTH window immediately before it, so you always have a change figure. Params: days (1-365, default 30) or from/to, plus optional market or building. Use this for ANY revenue/occupancy/ADR question. Revenue is prorated per night and cleaning is attributed to the checkout date, so these numbers reconcile with /revenue.',
    input_schema: obj({ days: S.num, from: S.str, to: S.str, market: S.str, building: S.str }),
    money: true,
    run: async (input, ctx) => {
      const sp = new URLSearchParams()
      if (input?.from) sp.set('from', String(input.from))
      if (input?.to) sp.set('to', String(input.to))
      if (input?.days) sp.set('days', String(clampDays(input.days, 30, 365)))
      if (input?.market) sp.set('market', String(input.market))
      if (input?.building) sp.set('building', String(input.building))
      const k: any = await safe(buildKpi(sp, ctx.access), null as any)
      if (!k) return { error: 'KPI build failed.' }
      return k
    },
  },

  {
    name: 'owner_month',
    description: 'Owner earnings by month, straight from the Guesty ledger: rental income, our commission, other charges, NET to the owner, what was actually PAID, and whether the two TIE to the statement. Filter by month(s) (YYYY-MM), owner name, or building. Orphan owner-months (real earnings with no statement generated) are INCLUDED and flagged, because those are the ones that go missing. Note: due_to_owner is a settlement balance, NOT earnings — quote net.',
    input_schema: obj({ month: S.str, months: { type: 'array', items: S.str }, owner: S.str, building: S.str, limit: S.num }),
    money: true,
    run: async (input, ctx) => {
      const months: string[] = Array.isArray(input?.months) && input.months.length
        ? input.months.map((m: any) => monthKey(m, thisMonth(ctx.today)))
        : [monthKey(input?.month, shiftDay(ctx.today, -30).slice(0, 7))]
      const listingIds = input?.building ? ctx.idsForBuilding(String(input.building)) : undefined
      const rows: any[] = await safe(ownerMonths({ months, listingIds }) as any, [] as any)
      let list = rows
      if (input?.owner) list = list.filter((r: any) => has(r.ownerName, input.owner))
      const roll: any = rollup(list as any)
      const cov: any = await safe(coverageFor(months) as any, { ready: true, missing: [] } as any)
      return {
        months: months.map(m => ({ month: m, label: MONTH_LABEL(m) })),
        coverage: cov,
        totals: roll.totals,
        owner_months: list.slice(0, clampLimit(input?.limit, 40, 100)).map((r: any) => ({
          owner: r.ownerName, month: r.month, rental: r.rental, commission: r.commission,
          other: r.other, net: r.net, paid: r.paid, ties: r.ties, has_statement: r.hasStatement,
        })),
        note: cov && cov.ready === false ? `Ledger months not fully synced: ${(cov.missing || []).join(', ')} — these figures are incomplete.` : undefined,
      }
    },
  },

  {
    name: 'owner_audit_flags',
    description: 'The owner-statement audit for a month: every reservation and line item that looks wrong, with a flag type (low_rate, commission_off, negative, orphan_reimb, refund, zero_rev, passthru, no_reservation, off_booking, empty_statement, owner_stay) and a severity (high|review|info). Use for "is anything wrong with last month\'s statements" or to explain a specific owner\'s variance. Month is YYYY-MM.',
    input_schema: obj({ month: S.str, severity: S.str, flag: S.str, owner: S.str, limit: S.num }),
    money: true,
    run: async (input, ctx) => {
      const picks: any[] = await safe(auditMonths(12) as any, [] as any)
      const fallback = picks.length ? String(picks[0].month || picks[0]) : shiftDay(ctx.today, -30).slice(0, 7)
      const month = monthKey(input?.month, fallback)
      const a: any = await safe(buildAudit(month) as any, null as any)
      if (!a) return { error: `Could not build the audit for ${month}.` }
      let items = (a.items || []).filter((it: any) => Array.isArray(it.flags) && it.flags.length)
      if (input?.owner) items = items.filter((it: any) => has(it.ownerName, input.owner))
      if (input?.flag) items = items.filter((it: any) => it.flags.some((f: any) => lc(f.type) === lc(input.flag)))
      if (input?.severity) items = items.filter((it: any) => it.flags.some((f: any) => lc(f.severity) === lc(input.severity)))
      const byFlag: Record<string, number> = {}
      for (const it of items) for (const f of it.flags) byFlag[f.type] = (byFlag[f.type] || 0) + 1
      return {
        month, label: a.label, totals: a.totals, coverage: a.coverage, by_flag: byFlag,
        flagged: items.slice(0, clampLimit(input?.limit, 30, 80)).map((it: any) => ({
          owner: it.ownerName, unit: it.unitName || it.listingName, guest: it.guestName,
          confirmation: it.key, nights: it.monthNights, rate: it.avgRate ?? it.rate,
          benchmark: it.benchRate, benchmark_label: it.benchLabel,
          stay_tag: it.stayTag, status: it.status,
          flags: it.flags.map((f: any) => ({ type: f.type, severity: f.severity, detail: f.detail, amount: f.amount })),
        })),
      }
    },
  },

  {
    name: 'billing_month',
    description: 'Billable Breezeway work for a month, grouped BY STATEMENT OWNER: what we can bill, labor vs materials, in-house vs vendor crew, and how many tasks are still missing their billing detail. Month is YYYY-MM. Remember the billing model: the team enters a flat dollar amount on the Breezeway task and that amount IS the price of the job — it is not derived from clocked hours.',
    input_schema: obj({ month: S.str, owner: S.str, limit: S.num }),
    money: true,
    run: async (input, ctx) => {
      const month = monthKey(input?.month, thisMonth(ctx.today))
      const r: any = await safe(billingMonth(month) as any, null as any)
      if (!r) return { error: `Could not build billing for ${month}.` }
      let owners = r.owners || []
      if (input?.owner) owners = owners.filter((o: any) => has(o.ownerName, input.owner))
      const range = monthRange(month)
      return {
        month, range, missing_detail: r.missingDetail,
        task_count: (r.tasks || []).length,
        owners: owners.slice(0, clampLimit(input?.limit, 30, 60)).map((o: any) => ({
          owner: o.ownerName, units: o.units, tasks: o.tasks, billed: o.billed,
          labor: o.labor, labor_inhouse: o.laborInhouse, labor_vendor: o.laborVendor,
          items: o.items, actual_minutes: o.actualMinutes,
        })),
        note: r.missingDetail ? `${r.missingDetail} tasks have no billing detail pulled yet — their amounts read as 0 until someone hits "Pull details" for the month.` : undefined,
      }
    },
  },

  {
    name: 'direct_bookings',
    description: 'Direct vs OTA booking mix, keyed on when the booking was CREATED (not when the stay happens) in Eastern time. Returns counts and accommodation value by family (direct / manual / owner / OTA), the OTA breakdown by group, and the month-by-month timeline. Use for "how are direct bookings trending".',
    input_schema: obj({ from: S.str, to: S.str, months: S.num }),
    money: true,
    run: async (input, ctx) => {
      const months = clampDays(input?.months, 6, 24)
      const from = String(input?.from || '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(input.from) : shiftDay(ctx.today, -months * 30)
      const to = String(input?.to || '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(input.to) : ctx.today
      // Rule 1: the SIX money scalars, never raw->money (that object carries payments + invoiceItems
      // + bundledFees and is what made Postgres cancel this query on statement timeout).
      const COLS = 'id,listing_id,status,source,created_at,check_in,nights,money_total,m_accom_adj:raw->money->>fareAccommodationAdjusted,m_accom:raw->money->>fareAccommodation'
      const rows: any[] = []
      let truncated = false
      for (let page = 0; page < 12; page++) {
        const { data, error } = await ctx.db.from('guesty_reservations').select(COLS)
          .gte('created_at', from + 'T00:00:00Z').lte('created_at', to + 'T23:59:59Z')
          .order('created_at').range(page * 1000, page * 1000 + 999)
        if (error) break
        rows.push(...(data || []))
        if ((data || []).length < 1000) break
        if (page === 11) truncated = true
      }
      const byFamily: Record<string, { bookings: number; won: number; value: number }> = {}
      const byOta: Record<string, number> = {}
      const byMonth: Record<string, { direct: number; ota: number; other: number }> = {}
      for (const r of rows) {
        const bucket = bucketFor(r.source)
        const fam = familyFor(bucket)
        const st = stateFor(r.status)
        const val = accomOf({ fareAccommodationAdjusted: r.m_accom_adj, fareAccommodation: r.m_accom }) || num(r.money_total)
        if (!byFamily[fam]) byFamily[fam] = { bookings: 0, won: 0, value: 0 }
        byFamily[fam].bookings++
        if (isWon(st)) { byFamily[fam].won++; byFamily[fam].value += val }
        if (fam === 'ota') byOta[otaGroupFor(r.source)] = (byOta[otaGroupFor(r.source)] || 0) + 1
        const mk = etDay(r.created_at).slice(0, 7)
        if (!byMonth[mk]) byMonth[mk] = { direct: 0, ota: 0, other: 0 }
        if (fam === 'direct') byMonth[mk].direct++
        else if (fam === 'ota') byMonth[mk].ota++
        else byMonth[mk].other++
      }
      const timeline = Object.keys(byMonth).sort().map(m => ({ month: m, ...byMonth[m] }))
      const familyRows = Object.keys(byFamily).map(k => ({ family: k, ...byFamily[k], value: Math.round(byFamily[k].value) }))
      return {
        window: { from, to, basis: 'booking created_at, America/New_York' },
        bookings_scanned: rows.length, truncated,
        by_family: familyRows, ota_breakdown: byOta, timeline,
        note: truncated ? 'Hit the paging ceiling — narrow the window for exact figures.' : undefined,
      }
    },
  },

  {
    name: 'pacing',
    description: 'On-the-books pacing: occupancy already sold for this month and the months ahead, with a tier verdict (EXCEPTIONAL / PACING WELL / BUILDING / EARLY / IN MONTH) that accounts for how far out the month is — 30% occupancy three months out is healthy, the same number next month is not. Optional building. NEVER quote the raw threshold numbers to an owner.',
    input_schema: obj({ building: S.str, months: S.num }),
    money: true,
    run: async (input, ctx) => {
      const count = Math.min(Math.max(Number(input?.months) || 4, 2), 8)
      const ids = input?.building ? ctx.idsForBuilding(String(input.building)) : Object.keys(ctx.listingMeta).filter(id => !DEAD_LISTING.test(ctx.listingMeta[id].status))
      if (!ids.length) return { error: 'No listings matched that building.' }
      const rows: any[] = await safe(monthsAhead(ids, ctx.today, ids.length, count) as any, [] as any)
      const out = rows.map((r: any, i: number) => {
        const inMonth = i === 1
        const monthsOut = Math.max(0, i - 1)
        return {
          month: r.iso, label: r.label,
          occupancy_pct: r.m?.occupancyPct ?? null,
          adr: r.m?.adr ?? null, revpar: r.m?.revpar ?? null,
          reservations: r.m?.reservations ?? null,
          verdict: i === 0 ? 'CLOSED' : paceStatus(r.m?.occupancyPct, inMonth, Math.max(1, monthsOut)),
        }
      })
      return {
        scope: input?.building ? String(input.building) : 'whole portfolio', units: ids.length,
        months: out,
        thresholds_internal_only: { one_month_out: paceThresholds(1), two: paceThresholds(2), three_plus: paceThresholds(3) },
        note: 'Thresholds are INTERNAL. Never put a threshold number, or words like soft/slow/weak/shoulder season, in anything an owner will read.',
      }
    },
  },
]

export const MONEY_DOMAIN: EveDomain = {
  key: 'money',
  label: 'Money',
  blurb: 'Occupancy/ADR/RevPAR the way the boards compute them, owner statements and their audit flags, billable hours, direct-booking mix and forward pacing.',
  tools: MONEY_TOOLS,
}

export { statementDetail, round2 }
