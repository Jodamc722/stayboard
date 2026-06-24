import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { PlanItemStatus } from '@/components/OpsPlanUI'
import { MapPin } from 'lucide-react'

export const dynamic = 'force-dynamic'

const TEAMS = [{ k: 'ccs', l: 'CCS' }, { k: 'miami', l: 'Miami Team' }, { k: 'broward', l: 'Broward Team' }]
const PRI: Record<number, { c: string; l: string }> = {
  1: { c: 'bg-red-100 text-red-700', l: 'Urgent' },
  2: { c: 'bg-amber-100 text-amber-700', l: 'Normal' },
  3: { c: 'bg-slate-100 text-slate-600', l: 'Low' },
}

export default async function PlanDetail({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: plan } = await supabase.from('ops_plans').select('*').eq('id', params.id).maybeSingle()
  if (!plan) notFound()
  const { data: items } = await supabase.from('ops_plan_items').select('*').eq('plan_id', params.id).order('priority').order('created_at')
  const byTeam = (t: string) => (items ?? []).filter((i: any) => i.team === t)

  return (
    <Shell>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-ink tracking-tight">{plan.title || 'Ops plan'}</h1>
        {plan.summary && <p className="text-sm text-muted mt-1 max-w-2xl">{plan.summary}</p>}
        <p className="text-[11px] text-muted mt-1">{new Date(plan.created_at).toLocaleString()} - share this page link with the team - supervisors close items.</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        {TEAMS.map(team => {
          const list = byTeam(team.k)
          return (
            <section key={team.k} className="rounded-2xl border border-line bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-line flex items-center justify-between">
                <h2 className="font-semibold text-ink text-sm inline-flex items-center gap-1.5"><MapPin size={14} className="text-brand-600" /> {team.l}</h2>
                <span className="text-xs font-semibold text-muted bg-app px-2 py-0.5 rounded-full">{list.length}</span>
              </div>
              {list.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted">Nothing for this team.</div>
              ) : (
                <ul className="divide-y divide-line/70">
                  {list.map((i: any) => (
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
    </Shell>
  )
}
