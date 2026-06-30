import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { PlanItemStatus } from '@/components/OpsPlanUI'
import { PlanItemPush } from '@/components/PlanItemPush'
import { PlanItemReschedule } from '@/components/PlanItemReschedule'
import { MapPin, CalendarDays, Crown } from 'lucide-react'

export const dynamic = 'force-dynamic'

const TEAMS = [{ k: 'ccs', l: 'CCS' }, { k: 'miami', l: 'Miami Team' }, { k: 'broward', l: 'Broward Team' }]
const PRI: Record<number, { c: string; l: string }> = {
  1: { c: 'bg-red-100 text-red-700', l: 'Urgent' },
  2: { c: 'bg-amber-100 text-amber-700', l: 'Normal' },
  3: { c: 'bg-slate-100 text-slate-600', l: 'Low' },
}
function todayET() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }
function dayLabel(d: string) {
  const today = todayET()
  const dt = new Date(d + 'T12:00:00')
  const lab = dt.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
  if (d === today) return `Today · ${lab}`
  const tmr = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  if (d === tmr) return `Tomorrow · ${lab}`
  return lab
}

export default async function PlanDetail({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: plan } = await supabase.from('ops_plans').select('*').eq('id', params.id).maybeSingle()
  if (!plan) notFound()
  const { data: items } = await supabase.from('ops_plan_items').select('*').eq('plan_id', params.id).order('priority').order('created_at')
  const list = items ?? []
  const isWeekly = plan.kind === 'weekly'

  // For weekly plans, pull any Breezeway tasks already pushed for these units so we can show status.
  const pushedMap: Record<string, any> = {}
  if (isWeekly) {
    const lids = Array.from(new Set(list.map((i: any) => i.listing_id).filter(Boolean)))
    if (lids.length) {
      try {
        const sb = supabaseAdmin()
        const { data: bt } = await sb.from('breezeway_tasks').select('listing_id, issue_title, status, scheduled_date, report_url').in('listing_id', lids as string[])
        ;(bt ?? []).forEach((t: any) => { const k = `${t.listing_id}__${t.issue_title}`; if (!pushedMap[k]) pushedMap[k] = { status: t.status, scheduledDate: t.scheduled_date, reportUrl: t.report_url } })
      } catch { /* tables may not exist yet */ }
    }
  }

  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">{isWeekly ? <><CalendarDays size={13} /> Action plan</> : <><MapPin size={13} /> Ops plan</>}</p>
        <h1 className="text-2xl font-bold text-ink tracking-tight mt-1">{plan.title || 'Plan'}</h1>
        {plan.summary && <p className="text-sm text-muted mt-1 max-w-2xl">{plan.summary}</p>}
        <p className="text-[11px] text-muted mt-1">{new Date(plan.created_at).toLocaleString()} · share this link with the team · push field work to Breezeway, supervisors close items.</p>
      </header>

      {isWeekly ? (
        <WeeklyView list={list} pushedMap={pushedMap} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          {TEAMS.map(team => {
            const tlist = list.filter((i: any) => i.team === team.k)
            return (
              <section key={team.k} className="rounded-2xl border border-line bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-line flex items-center justify-between">
                  <h2 className="font-semibold text-ink text-sm inline-flex items-center gap-1.5"><MapPin size={14} className="text-brand-600" /> {team.l}</h2>
                  <span className="text-xs font-semibold text-muted bg-app px-2 py-0.5 rounded-full">{tlist.length}</span>
                </div>
                {tlist.length === 0 ? <div className="px-4 py-8 text-center text-sm text-muted">Nothing for this team.</div> : (
                  <ul className="divide-y divide-line/70">
                    {tlist.map((i: any) => (
                      <li key={i.id} className="px-4 py-3">
                        <div className="flex items-start gap-2">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${(PRI[i.priority] || PRI[2]).c}`}>{(PRI[i.priority] || PRI[2]).l}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-ink">{i.title}</div>
                            {i.building && <div className="text-[11px] text-muted mt-0.5">{i.building}</div>}
                            {i.detail && <p className="text-xs text-muted mt-1">{i.detail}</p>}
                            <div className="mt-2"><PlanItemStatus itemId={i.id} initial={i.status} /></div>
                            {i.closed_by && <div className="text-[10px] text-emerald-700 mt-1">Closed by {String(i.closed_by).split('@')[0]}</div>}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </Shell>
  )
}

function WeeklyView({ list, pushedMap }: { list: any[]; pushedMap: Record<string, any> }) {
  // Group by scheduled day.
  const byDay = new Map<string, any[]>()
  for (const i of list) { const d = i.scheduled_date || 'unscheduled'; const a = byDay.get(d) || []; a.push(i); byDay.set(d, a) }
  const days = Array.from(byDay.keys()).sort((a, b) => (a === 'unscheduled' ? 1 : b === 'unscheduled' ? -1 : a.localeCompare(b)))

  if (list.length === 0) return <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted">No items in this plan.</div>

  return (
    <div className="space-y-5">
      {days.map(d => {
        const group = (byDay.get(d) || []).sort((a, b) => a.priority - b.priority)
        return (
          <section key={d} className="rounded-2xl border border-line bg-white overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line bg-app/40 flex items-center justify-between">
              <h2 className="font-semibold text-ink text-sm inline-flex items-center gap-1.5"><CalendarDays size={14} className="text-brand-600" /> {d === 'unscheduled' ? 'Unscheduled' : dayLabel(d)}</h2>
              <span className="text-xs font-semibold text-muted bg-white border border-line px-2 py-0.5 rounded-full">{group.length}</span>
            </div>
            <ul className="divide-y divide-line/70">
              {group.map((i: any) => (
                <li key={i.id} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${(PRI[i.priority] || PRI[2]).c}`}>{(PRI[i.priority] || PRI[2]).l}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink">{i.title}</div>
                      <div className="text-[11px] text-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        {i.market && <span>{i.market}</span>}
                        <span className="capitalize">{i.team}</span>
                      </div>
                      {i.detail && <p className="text-xs text-muted mt-1">{i.detail}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <PlanItemPush listingId={i.listing_id} issueKey={i.issue_key} issueTitle={i.title} detail={i.detail} priority={i.priority} pushed={pushedMap[`${i.listing_id}__${i.title}`] || null} />
                        <PlanItemReschedule itemId={i.id} initial={i.scheduled_date || null} />
                        <PlanItemStatus itemId={i.id} initial={i.status} />
                      </div>
                      {i.closed_by && <div className="text-[10px] text-emerald-700 mt-1">Closed by {String(i.closed_by).split('@')[0]}</div>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
