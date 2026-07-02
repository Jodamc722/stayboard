// Cleaner performance board - computed from the live Breezeway task mirror (webhooks keep it
// current). Rolling 90 days: cleans, pace, same-day completion per cleaner; top hubs; units with
// recurring maintenance. Feeds the QC ladder (95%+ spot-check / 85-94% inspect / <85% retrain).
import { supabaseAdmin } from '@/lib/supabase-admin'
import { unstable_cache } from 'next/cache'
import { Sparkles, Users, Timer, CheckCheck, Wrench } from 'lucide-react'

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
  const cleans = (tasks || []).filter((t: any) => t.type_department === 'housekeeping' && /depart|clean|turn/i.test(String(t.name || '')))
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

export default async function CleanersPage() {
  const { cleaners, issues, totals, since } = await getData()
  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-brand-600 inline-flex items-center gap-1.5"><Sparkles size={13} /> Performance</div>
        <h1 className="text-3xl font-extrabold text-ink mt-1">Cleaner KPIs</h1>
        <p className="text-sm text-muted mt-1">Rolling 90 days from live Breezeway tasks (since {since}). Multi-assigned cleans count for every person on the task.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-line bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-muted font-semibold inline-flex items-center gap-1"><CheckCheck size={12} /> Cleans (90d)</div><div className="text-2xl font-extrabold text-ink mt-0.5">{totals.cleans}</div></div>
        <div className="rounded-2xl border border-line bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-muted font-semibold inline-flex items-center gap-1"><Users size={12} /> Active cleaners</div><div className="text-2xl font-extrabold text-ink mt-0.5">{totals.cleaners}</div></div>
        <div className="rounded-2xl border border-line bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-muted font-semibold inline-flex items-center gap-1"><Timer size={12} /> Avg time / clean</div><div className="text-2xl font-extrabold text-ink mt-0.5">{totals.avgMin}m</div></div>
        <div className="rounded-2xl border border-line bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-muted font-semibold inline-flex items-center gap-1"><CheckCheck size={12} /> Same-day finish</div><div className="text-2xl font-extrabold text-ink mt-0.5">{totals.sameDayPct}%</div></div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="bg-app/60 text-muted text-[10px] uppercase tracking-wider text-left">
              <th className="px-3 py-2.5 font-semibold">Cleaner</th>
              <th className="px-3 py-2.5 font-semibold text-right">Cleans</th>
              <th className="px-3 py-2.5 font-semibold text-right">Per day</th>
              <th className="px-3 py-2.5 font-semibold text-right">Avg time</th>
              <th className="px-3 py-2.5 font-semibold text-right">Same-day</th>
              <th className="px-3 py-2.5 font-semibold">Hubs</th>
            </tr>
          </thead>
          <tbody>
            {cleaners.map(c => (
              <tr key={c.name} className="border-t border-line">
                <td className="px-3 py-2 font-semibold text-ink">{c.name}</td>
                <td className="px-3 py-2 text-right text-ink">{c.cleans}</td>
                <td className="px-3 py-2 text-right text-muted">{c.perDay}</td>
                <td className="px-3 py-2 text-right text-muted">{c.avgMin != null ? c.avgMin + 'm' : String.fromCharCode(8212)}</td>
                <td className="px-3 py-2 text-right">{c.sameDayPct != null ? <span className={c.sameDayPct >= 95 ? 'text-emerald-700 font-semibold' : c.sameDayPct >= 85 ? 'text-amber-700 font-semibold' : 'text-rose-700 font-semibold'}>{c.sameDayPct}%</span> : <span className="text-muted">{String.fromCharCode(8212)}</span>}</td>
                <td className="px-3 py-2 text-muted">{c.topHubs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-2xl border border-line bg-white p-4">
        <div className="text-sm font-bold text-ink inline-flex items-center gap-1.5 mb-2"><Wrench size={14} className="text-amber-600" /> Units with the most maintenance (90d)</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {issues.map(i => (
            <div key={i.unit} className="rounded-xl border border-line px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-ink truncate">{i.unit}</span>
              <span className="text-[12px] text-muted shrink-0">{i.n} tasks{i.open ? ' - ' + i.open + ' open' : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
