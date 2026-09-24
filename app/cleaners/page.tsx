// Cleaner performance board - computed from the live Breezeway task mirror (webhooks keep it
// current). Rolling 90 days: cleans, pace, same-day completion per cleaner; top hubs; units with
// recurring maintenance. Feeds the QC ladder (95%+ spot-check / 85-94% inspect / <85% retrain).
import { Shell } from '@/components/Shell'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isDepartureCleanName } from '@/lib/breezeway'
import { unstable_cache } from 'next/cache'
import { LeanHead, Pill, Tag, LeanList, LeanRow, LeanSection, LeanEmpty } from '@/components/lean'

export const dynamic = 'force-dynamic'

const getData = unstable_cache(async () => {
  const db = supabaseAdmin()
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  // PostgREST caps a single read at 1000 rows - page through the mirror so nothing is undercounted.
  let tasks: any[] = []
  for (let i = 0; i < 20; i++) {
    const { data: page } = await db.from('breezeway_tasks_sync').select('type_department,name,assignees,total_minutes,finished_at,scheduled_date,reference_property_id').gte('scheduled_date', since).order('scheduled_date').range(i * 1000, i * 1000 + 999)
    tasks = tasks.concat(page || [])
    if (!page || page.length < 1000) break
  }
  const { data: props } = await db.from('breezeway_properties').select('reference_property_id,name')
  const nameOf: Record<string, string> = {}
  for (const p of (props || [])) if ((p as any).reference_property_id) nameOf[String((p as any).reference_property_id)] = String((p as any).name || '')
  const hubOf = (ref: string) => (nameOf[ref] || 'Other').split(' ')[0] || 'Other'
  // Departure cleans ONLY, via the one shared rule (lib/breezeway). The old /depart|clean|turn/
  // loose match counted oven cleans, refresh cleans and common-area work as turnovers, inflating
  // every KPI on this page — the exact bug fixed board-wide on 2026-08-04.
  const cleans = (tasks || []).filter((t: any) => t.type_department === 'housekeeping' && isDepartureCleanName(t.name))
  type Agg = { cleans: number; done: number; sameDay: number; minutes: number; minutesN: number; days: Set<string>; hubs: Record<string, number> }
  const by: Record<string, Agg> = {}
  for (const t of cleans as any[]) {
    const ppl = Array.isArray(t.assignees) ? t.assignees : []
    const d10 = String(t.scheduled_date || '').slice(0, 10)
    for (const a of ppl) {
      const n = String(a?.name || '').trim()
      if (!n) continue
      const c = (by[n] ||= { cleans: 0, done: 0, sameDay: 0, minutes: 0, minutesN: 0, days: new Set(), hubs: {} })
      c.cleans++
      if (d10) c.days.add(d10)
      if (t.finished_at) { c.done++; if (String(t.finished_at).slice(0, 10) === d10) c.sameDay++ }
      const m = Number(t.total_minutes)
      if (Number.isFinite(m) && m > 5 && m < 600) { c.minutes += m; c.minutesN++ }
      const h = hubOf(String(t.reference_property_id || ''))
      c.hubs[h] = (c.hubs[h] || 0) + 1
    }
  }
  const cleaners = Object.entries(by).map(([name, c]) => ({
    name,
    cleans: c.cleans,
    perDay: c.days.size ? Number((c.cleans / c.days.size).toFixed(1)) : 0,
    avgMin: c.minutesN ? Math.round(c.minutes / c.minutesN) : null,
    sameDayPct: c.done ? Math.round(100 * c.sameDay / c.done) : null,
    topHubs: Object.entries(c.hubs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h, n]) => h + ' ' + n).join(', '),
  })).filter(x => x.cleans >= 10).sort((a, b) => b.cleans - a.cleans)
  const maint = (tasks || []).filter((t: any) => t.type_department === 'maintenance')
  const mBy: Record<string, { n: number; open: number }> = {}
  for (const t of maint as any[]) {
    const ref = String(t.reference_property_id || '')
    if (!ref) continue
    const e = (mBy[ref] ||= { n: 0, open: 0 })
    e.n++
    if (!t.finished_at) e.open++
  }
  const issues = Object.entries(mBy).map(([ref, v]) => ({ unit: nameOf[ref] || ref, n: v.n, open: v.open })).sort((a, b) => b.n - a.n).slice(0, 12)
  const doneAll = (cleans as any[]).filter(t => t.finished_at)
  const sameDayAll = doneAll.filter(t => String(t.finished_at).slice(0, 10) === String(t.scheduled_date || '').slice(0, 10))
  const mins = (cleans as any[]).map(t => Number(t.total_minutes)).filter(m => Number.isFinite(m) && m > 5 && m < 600)
  const totals = {
    cleans: cleans.length,
    cleaners: cleaners.length,
    sameDayPct: doneAll.length ? Math.round(100 * sameDayAll.length / doneAll.length) : 0,
    avgMin: mins.length ? Math.round(mins.reduce((s, m) => s + m, 0) / mins.length) : 0,
  }
  return { cleaners, issues, totals, since }
}, ['cleaner-kpis-v1'], { tags: ['cleaner-kpis'], revalidate: 600 })

// Wrapped in <Shell> 2026-08-20 — the cleaner KPI board had no navigation on it.
// LEAN PASS (2026-09-22): one-line header with the four totals as pills, one row per cleaner with
// the QC tier as a tag (the ladder is in the tag's hover), and the maintenance units as rows.
const QC_HELP = 'QC ladder by same-day completion: 95%+ spot-check · 85–94% inspect · under 85% retrain'

export default async function CleanersPage() {
  const { cleaners, issues, totals, since } = await getData()
  return (
    <Shell>
      <LeanHead title="Cleaners">
        <Pill title={'Departure cleans, rolling 90 days from live Breezeway tasks (since ' + since + '). Multi-assigned cleans count for every person on the task.'}>{totals.cleans} cleans</Pill>
        <Pill title="Cleaners with 10+ departure cleans in the window">{totals.cleaners} cleaners</Pill>
        <Pill title="Average clock time per departure clean">{totals.avgMin}m / clean</Pill>
        <Pill tone={totals.sameDayPct >= 95 ? 'emerald' : totals.sameDayPct >= 85 ? 'amber' : 'rose'} title={'Finished the same day they were scheduled. ' + QC_HELP}>{totals.sameDayPct}% same-day</Pill>
      </LeanHead>
      <LeanSection title="Cleaners · 90 days" n={cleaners.length}>
        {!cleaners.length ? <LeanEmpty>No cleaner with 10+ cleans in the last 90 days.</LeanEmpty> : (
          <LeanList>
            {cleaners.map(c => {
              const tier = c.sameDayPct == null ? null
                : c.sameDayPct >= 95 ? { l: 'Spot-check', t: 'emerald' as const }
                  : c.sameDayPct >= 85 ? { l: 'Inspect', t: 'amber' as const }
                    : { l: 'Retrain', t: 'rose' as const }
              return (
                <LeanRow key={c.name} name={<a href={'/cleaners/' + encodeURIComponent(c.name)} className="hover:underline decoration-dotted underline-offset-2" title={'Every task assigned to ' + c.name}>{c.name}</a>}
                  meta={c.cleans + ' cleans · ' + c.perDay + '/day · ' + (c.avgMin != null ? c.avgMin + 'm avg' : 'no time')}
                  tags={<>
                    {c.sameDayPct != null ? <Tag tone={tier ? tier.t : 'slate'} title="Same-day finish rate">{c.sameDayPct}% same-day</Tag> : null}
                    {tier ? <Tag tone={tier.t} title={QC_HELP}>{tier.l}</Tag> : null}
                    {c.topHubs ? <Tag title="Top hubs by cleans">{c.topHubs}</Tag> : null}
                  </>} />
              )
            })}
          </LeanList>
        )}
      </LeanSection>
      <LeanSection title="Most maintenance · 90 days" n={issues.length}>
        {!issues.length ? <LeanEmpty>No maintenance tasks in the last 90 days.</LeanEmpty> : (
          <LeanList>
            {issues.map(i => (
              <LeanRow key={i.unit} name={i.unit} meta={i.n + ' tasks'}
                tags={i.open ? <Tag tone="amber" title="Maintenance tasks not finished yet">{i.open} open</Tag> : null} />
            ))}
          </LeanList>
        )}
      </LeanSection>
    </Shell>
  )
}
