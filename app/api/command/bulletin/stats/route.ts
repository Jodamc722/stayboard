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

export const dynamic = 'force-dynamic'

export type Fact = { key: string; label: string; value: string; sub: string; href?: string; tone?: 'emerald' | 'amber' | 'slate' | 'sky' }

const span = (d: number) => d < 1 ? Math.round(d * 24) + 'h' : (Math.round(d * 10) / 10) + ' days'

async function build(): Promise<Fact[]> {
  const sb = supabaseAdmin()
  const today = etDay()
  const facts: Fact[] = []
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

  if (!rv.error) {
    const stars = ((rv.data || []) as any[]).map(r => ratingToStars(Number(r.rating))).filter((s): s is number => s != null)
    const five = stars.filter(s => s >= 4.8).length
    if (five) facts.push({ key: 'fiveStar', label: '5★ reviews · last 7 days', value: String(five), sub: 'of ' + stars.length + ' reviews', href: '/reviews', tone: 'emerald' })
    if (stars.length >= 5) {
      const avg = stars.reduce((a, b) => a + b, 0) / stars.length
      facts.push({ key: 'avgStars', label: 'Guest rating · last 7 days', value: (Math.round(avg * 100) / 100).toFixed(2) + '★', sub: stars.length + ' reviews, all channels on a /5 scale', href: '/reviews', tone: avg >= 4.7 ? 'emerald' : avg >= 4.4 ? 'sky' : 'amber' })
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

const cached = unstable_cache(build, ['bulletin-stats-v2'], { revalidate: 600 })

export async function GET() {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  try { return NextResponse.json({ ok: true, facts: await cached() }) }
  catch (e: any) { return NextResponse.json({ ok: false, facts: [], error: String(e?.message || e).slice(0, 200) }) }
}
