import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { GeneratePlanButton } from '@/components/OpsPlanUI'
import { ClipboardList, ArrowUpRight } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function PlansPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: plans } = await supabase
    .from('ops_plans')
    .select('id,title,summary,status,created_at,created_by,source')
    .order('created_at', { ascending: false })
    .limit(40)

  return (
    <Shell>
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><ClipboardList size={13} /> Operations</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Ops Plans</h1>
          <p className="text-sm text-muted mt-1">Generate a plan from live data, dispatch by team, and track it to done.</p>
        </div>
        <GeneratePlanButton />
      </header>

      {(plans ?? []).length === 0 ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted">
          No plans yet. Click &ldquo;Generate ops plan&rdquo; to create one. If it errors, the ops_plans tables still need to be created in Supabase.
        </div>
      ) : (
        <ul className="grid gap-3">
          {(plans ?? []).map((p: any) => (
            <li key={p.id}>
              <Link href={`/plan/${p.id}`} className="group flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 hover:border-brand-300 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ink text-sm truncate">{p.title || 'Ops plan'}</div>
                  <div className="text-xs text-muted truncate mt-0.5">{p.summary || ''}</div>
                  <div className="text-[11px] text-muted mt-1">{new Date(p.created_at).toLocaleString()} - {p.source === 'morning-auto' ? 'auto' : 'manual'}{p.created_by ? ` - ${p.created_by.split('@')[0]}` : ''}</div>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${p.status === 'closed' ? 'bg-ink text-white' : p.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : 'bg-app text-muted'}`}>{p.status}</span>
                <ArrowUpRight size={15} className="text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}
