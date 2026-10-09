// THE BOARD'S "DID YOU KNOW" FACTS (Jon, 2026-10-06: "make it show cool stats, eve thoughts, avg
// glitch closing time, welcome call completion last 3 days or 7 days, it can be random"). The page
// shuffles these with the money tiles it already reads from /api/command/scoreboard (billable,
// recovered — redacted there for people without the money switch) and one of Eve's open thoughts.
//
// Every fact is computed from the same sources the desks use, and says its window:
//   welcome calls  lib/call-desk welcomeRate over the last 3 and 7 SETTLED days (today isn't a verdict)
//   glitches       average and median logged→closed over the last 30 days, observed closed_at only
//                  (the 085 backfill is estimated), plus how many closed in the last 7 days
//   reviews        5★ count and the average (normalised to /5) over the last 7 days
// Under five data points a fact says the count, never a rate or an average off one row.
import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { requireVrUser } from '@/lib/vr-gate'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { welcomeRate, addDays } from '@/lib/call-desk'
import { ratingToStars } from '@/lib/optimize-score'
import { etDay } from '@/lib/bulletin'
import { kindOfTask } from '@/lib/labor-econ'
import { pageRows } from '@/lib/db-page'
import { buildKpiFor } from '@/lib/kpi'
import { canSeeMoney } from '@/lib/access'

export const dynamic = 'force-dynamic'

// `kpi`: a business number — it always shows, good day or bad (Jon, 2026-10-09: "it should give a
// better indication of what's happening in ops, overall KPIs"). Facts without it are about the team
// and keep the 10-06 rule: an amber one stays off the board.
export type Fact = { key: string; label: string; value: string; sub: string; href?: string; tone?: 'emerald' | 'amber' | 'slate' | 'sky'; kpi?: boolean }

const span = (d: number) => d < 1 ? Math.round(d * 24) + 'h' : (Math.round(d * 10) / 10) + ' days'

const pctChg = (now: number, prev: number) => prev ? Math.round(((now - prev) / prev) * 1000) / 10 : null
const arrow = (c: number | null, unit = '%') => c == null ? '' : (c >= 0 ? '▲ ' : '▼ ') + Math.abs(c) + unit + ' vs prior week'
const md = (ymd: string) => new Date(ymd.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

// ── OPS & KPIs (2026-10-09) — the Home board's own numbers (lib/kpi buildKpiFor), so the board and
// Home can never disagree: tonight, today's turnover, the last 7 settled days, the week ahead.
async function opsFacts(money: boolean): Promise<Fact[]> {
  const today = etDay()
  const yday = addDays(today, -1)
  const k: any = await buildKpiFor(new URLSearchParams({ from: addDays(yday, -6), to: yday }), money)
  const out: Fact[] = []
  const t = k?.today || {}, rv = k?.revenue || {}, wk = k?.work || {}, se = k?.sentiment || {}
  if (t.units) out.push({ key: 'occTonight', kpi: true, label: 'Occupancy tonight', value: Math.round(t.occupancy) + '%', sub: t.inHouse + ' stays in house · ' + t.units + ' units', href: '/', tone: t.occupancy >= 75 ? 'emerald' : t.occupancy >= 55 ? 'sky' : 'amber' })
  // Today's cleans straight from the Breezeway mirror — the KPI window above ends yesterday.
  let cs = 0, cd = 0
  try {
    const { data } = await supabaseAdmin().from('breezeway_tasks_sync').select('name,type_department,status,finished_at').eq('scheduled_date', today).limit(2000)
    for (const x of (data || []) as any[]) if (kindOfTask(x) === 'clean') { cs++; if (x.finished_at || /finish|complete|approved|closed/i.test(String(x.status || ''))) cd++ }
  } catch { /* the guest counts still show */ }
  if (cs || t.departures) out.push({ key: 'turnToday', kpi: true, label: 'Today’s turnover', value: cd + ' / ' + cs + ' cleans', sub: (t.departures || 0) + ' out · ' + (t.arrivals || 0) + ' in · ' + (t.sameDayTurns || 0) + ' same-day turns', href: '/schedule', tone: 'sky' })
  if (rv.available) out.push({ key: 'occ7', kpi: true, label: 'Occupancy · last 7 days', value: rv.occupancy + '%', sub: arrow(rv.occupancyPrev != null ? Math.round((rv.occupancy - rv.occupancyPrev) * 10) / 10 : null, ' pts') || rv.nights + ' nights sold', href: '/revenue', tone: rv.occupancy >= 70 ? 'emerald' : rv.occupancy >= 55 ? 'sky' : 'amber' })
  if (money && rv.adr) out.push({ key: 'adr7', kpi: true, label: 'ADR · RevPAR · last 7 days', value: '$' + Math.round(rv.adr) + ' · $' + Math.round(rv.revpar), sub: arrow(pctChg(rv.adr, rv.adrPrev)) ? 'ADR ' + arrow(pctChg(rv.adr, rv.adrPrev)) : 'room revenue per night sold · per night available', href: '/revenue', tone: 'slate' })
  if (t.arrivals7) out.push({ key: 'arr7', kpi: true, label: 'Arrivals · next 7 days', value: String(t.arrivals7), sub: money && t.booked7 ? '$' + Math.round(t.booked7).toLocaleString('en-US') + ' booked' : 'stays starting this week', href: '/reservations', tone: 'sky' })
  if (wk.scheduled) out.push({ key: 'onTime7', kpi: true, label: 'Tasks on time · last 7 days', value: Math.round(wk.onTimeRate) + '%', sub: (wk.completed || 0) + ' of ' + wk.scheduled + ' done · ' + Math.round(wk.completionRate) + '% completion', href: '/maintenance', tone: wk.onTimeRate >= 95 ? 'emerald' : wk.onTimeRate >= 85 ? 'sky' : 'amber' })
  if (se.scanned) out.push({ key: 'mood7', kpi: true, label: 'Guest mood · last 7 days', value: Math.round(se.happyPct) + '% happy', sub: (se.unhappy || 0) + ' unhappy threads · ' + se.scanned + ' read', href: '/sentiment', tone: se.happyPct >= 95 ? 'emerald' : se.happyPct >= 90 ? 'sky' : 'amber' })
  if (t.openGlitches != null) out.push({ key: 'glitchOpen', kpi: true, label: 'Guest issues open now', value: String(t.openGlitches), sub: (k?.glitches?.closed || 0) + ' closed in the last 7 days', href: '/glitches', tone: t.openGlitches <= 10 ? 'emerald' : t.openGlitches <= 25 ? 'sky' : 'amber' })
  return out
}

async function build(money = false): Promise<Fact[]> {
  const sb = supabaseAdmin()
  const today = etDay()
  const facts: Fact[] = await opsFacts(money).catch(() => [])
  const [w3, w7, gl, rv] = await Promise.all([
    welcomeRate(sb, addDays(today, -3), addDays(today, -1)).catch(() => null),
    welcomeRate(sb, addDays(today, -7), addDays(today, -1)).catch(() => null),
    sb.from('glitches').select('created_at,closed_at,closed_at_estimated').gte('closed_at', new Date(Date.now() - 30 * 86400000).toISOString()).limit(2000),
    sb.from('guesty_reviews').select('rating').eq('excluded_from_score', false).is('removed_at', null).gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()).limit(2000),
  ])
  const wTone = (r: number | null) => r == null ? 'slate' : r >= 90 ? 'emerald' : r >= 75 ? 'sky' : 'amber'
  if (w3 && w3.n) facts.push({ key: 'welcome3', label: 'Welcome calls · last 3 days', value: w3.rate != null ? w3.rate + '%' : w3.text, sub: w3.completed + ' completed of ' + w3.n + ' due', href: '/welcome-calls', tone: wTone(w3.rate) as any })
  if (w7 && w7.n) facts.push({ key: 'welcome7', label: 'Welcome calls · last 7 days', value: w7.rate != null ? w7.rate + '%' : w7.text, sub: w7.completed + ' completed of ' + w7.n + ' due', href: '/welcome-calls', tone: wTone(w7.rate) as any })

  if (!gl.error) {
    const rows = (gl.data || []) as any[]
    const spans = rows.filter(g => g.created_at && g.closed_at && !g.closed_at_estimated)
      .map(g => (Date.parse(g.closed_at) - Date.parse(g.created_at)) / 86400000).filter(d => Number.isFinite(d) && d >= 0).sort((a, b) => a - b)
    if (spans.length >= 5) {
      const avg = spans.reduce((a, b) => a + b, 0) / spans.length
      const med = spans.length % 2 ? spans[(spans.length - 1) / 2] : (spans[spans.length / 2 - 1] + spans[spans.length / 2]) / 2
      facts.push({ key: 'glitchClose', label: 'Avg glitch close time · 30 days', value: span(avg), sub: 'median ' + span(med) + ' · ' + spans.length + ' closed', href: '/glitches', tone: avg <= 2 ? 'emerald' : avg <= 5 ? 'sky' : 'amber' })
    }
    const wk = rows.filter(g => g.closed_at && Date.parse(g.closed_at) >= Date.now() - 7 * 86400000).length
    if (wk) facts.push({ key: 'glitchWeek', label: 'Glitches closed · last 7 days', value: String(wk), sub: 'guest issues resolved', href: '/glitches', tone: 'emerald' })
  }

  // ── REVIEWS (2026-10-09: "more up-to-date review scores, average review scores for the last 7 days").
  // The 7-day average always shows, next to the 30-day one, so a quiet week of five 5★ reviews never
  // reads as the whole story. And when a channel goes SILENT — Guesty stops delivering its reviews,
  // as Airbnb did Oct 4 and in August — the board says so instead of averaging what did arrive.
  if (!rv.error) {
    const stars = ((rv.data || []) as any[]).map(r => ratingToStars(Number(r.rating))).filter((s): s is number => s != null)
    const { data: r30 } = await sb.from('guesty_reviews').select('rating').eq('excluded_from_score', false).is('removed_at', null).gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()).limit(5000)
    const s30 = ((r30 || []) as any[]).map(r => ratingToStars(Number(r.rating))).filter((s): s is number => s != null)
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
    const tone = (v: number) => v >= 4.7 ? 'emerald' : v >= 4.4 ? 'sky' : 'amber'
    const silent: string[] = []
    for (const [ch, days] of [['Airbnb', 3], ['Vrbo', 14]] as [string, number][]) {
      const { data: nd } = await sb.from('guesty_reviews').select('created_at').ilike('channel', ch + '%').order('created_at', { ascending: false }).limit(1)
      const newest = nd && nd[0] ? String((nd[0] as any).created_at) : ''
      if (newest && Date.now() - Date.parse(newest) > days * 86400000) silent.push(ch + ' since ' + md(newest))
    }
    const sil = silent.length ? ' · no ' + silent.join(', no ') + ' (Guesty isn’t sending them)' : ''
    if (stars.length) facts.push({ key: 'avgStars', kpi: true, label: 'Guest rating · last 7 days', value: avg(stars).toFixed(2) + '★', sub: stars.length + ' review' + (stars.length === 1 ? '' : 's') + (s30.length ? ' · 30 days ' + avg(s30).toFixed(2) + '★' : '') + sil, href: '/reviews', tone: silent.length ? 'amber' : tone(avg(stars)) as any })
    if (s30.length >= 5) {
      const five = s30.filter(s => s >= 4.8).length
      facts.push({ key: 'avg30', kpi: true, label: 'Guest rating · last 30 days', value: avg(s30).toFixed(2) + '★', sub: s30.length + ' reviews · ' + Math.round(100 * five / s30.length) + '% five-star', href: '/reviews', tone: tone(avg(s30)) as any })
    }
  }
  // ── THE TEAM (Jon, 2026-10-06: "share stats of the team on the board"). Breezeway tasks finished in
  // the last 7 days, by kind (lib/labor-econ kindOfTask — the Labor board's own rule for what a
  // departure clean is). Vendor-run buildings never close tasks, so this is the in-house team.
  try {
    const since = new Date(Date.now() - 7 * 86400000).toISOString()
    const { rows } = await pageRows<any>((a, b) => sb.from('breezeway_tasks_sync').select('id,name,type_department,assignees,finished_at')
      .gte('finished_at', since).order('id').range(a, b), 6)
    const by: Record<string, Record<string, number>> = { clean: {}, inspection: {}, maintenance: {} }
    const total: Record<string, number> = { clean: 0, inspection: 0, maintenance: 0 }
    for (const t of rows) {
      const k = kindOfTask(t)
      if (!(k in by)) continue
      total[k]++
      for (const p of (Array.isArray(t.assignees) ? t.assignees : [])) { const n = String(p?.name || '').trim(); if (n) by[k][n] = (by[k][n] || 0) + 1 }
    }
    const top = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1])
    const first = (n: string) => n.split(/\s+/)[0]
    if (total.clean) {
      const t = top(by.clean)
      facts.push({ key: 'teamCleans', label: 'Cleans turned · last 7 days', value: String(total.clean), sub: t.length + ' cleaner' + (t.length === 1 ? '' : 's') + ' on the board', href: '/labor', tone: 'emerald' })
      if (t.length >= 2) facts.push({ key: 'topCleaners', label: 'Most cleans this week', value: first(t[0][0]), sub: t.slice(0, 3).map(([n, c]) => first(n) + ' ' + c).join(' · '), href: '/labor', tone: 'slate' })
    }
    if (total.inspection) {
      const t = top(by.inspection)
      facts.push({ key: 'teamInsp', label: 'Inspections · last 7 days', value: String(total.inspection), sub: t.slice(0, 3).map(([n, c]) => first(n) + ' ' + c).join(' · ') || 'done', href: '/maintenance', tone: 'sky' })
    }
    if (total.maintenance) {
      const t = top(by.maintenance)
      facts.push({ key: 'teamMaint', label: 'Maintenance closed · last 7 days', value: String(total.maintenance), sub: t.slice(0, 3).map(([n, c]) => first(n) + ' ' + c).join(' · ') || 'done', href: '/maintenance', tone: 'sky' })
    }
  } catch { /* the team facts are a bonus; the rest still show */ }
  return facts
}

// Five minutes, one copy per money state (dollars only for people with the money switch).
const cached = unstable_cache(async (money: boolean) => ({ facts: await build(money), asOf: new Date().toISOString() }), ['bulletin-stats-v4'], { revalidate: 300 })

export async function GET() {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  try { const c = await cached(canSeeMoney(gate.access as any)); return NextResponse.json({ ok: true, facts: c.facts, asOf: c.asOf }) }
  catch (e: any) { return NextResponse.json({ ok: false, facts: [], error: String(e?.message || e).slice(0, 200) }) }
}
