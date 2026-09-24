// WHO IS COMING TO OUR BUILDINGS, ACROSS EVERY BOARD.
//
// Jon, 2026-09-15: "What I wanted is for our team to just be able to know if a vendor was called.
// That way, if Carla is not working or Roberto is not working, the next person in charge can see
// upcoming vendor visits."
//
// That is the whole brief, and it rules out the obvious place to put this. A strip on the vendor
// board only helps somebody who already knows to open the vendor board — which the person covering
// for Karla, on Karla's day off, precisely does not. So this reads EVERY board the viewer can see
// and the Command Center shows it next to their tasks, on the page they open anyway.
//
// Recurring work needs nothing special here: a repeating job books a real next visit with a real
// date when the last one is completed, so pest control turns up in this list like anything else.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel, isSuperadmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { todayISO, visitState, needsTelling, estLabel } from '@/lib/projects-shared'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = await requireLevel('projects', 'view')
  if (!g.ok) return g.res
  const email = String(g.access.email || '').toLowerCase()
  const today = todayISO()
  const days = Math.min(60, Math.max(1, Number(req.nextUrl.searchParams.get('days') || 14)))

  try {
    const sb = supabaseAdmin()

    // Same privacy rule as everywhere else in Projects: membership, or superadmin. A vendor visit
    // on a board you are not on is not yours to see, even though it is at one of our buildings.
    let visible: Set<string> | null = null
    if (!isSuperadmin(email)) {
      const { data } = await sb.from('project_members').select('project_id').eq('email', email).limit(2000)
      visible = new Set(((data || []) as any[]).map(m => String(m.project_id)))
      if (!visible.size) return NextResponse.json({ ok: true, today, visits: [] })
    }

    // A month back so a visit nobody closed stays visible — "they never turned up and nobody
    // noticed" is the failure this is for, and it does not announce itself.
    const from = new Date(Date.parse(today + 'T12:00:00Z') - 30 * 86400000).toISOString().slice(0, 10)
    const to = new Date(Date.parse(today + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10)
    const { data: rows, error } = await sb.from('project_steps')
      .select('id,project_id,title,status,visit_on,visit_window,est_minutes,vendor_name,vendor_key,team_notified_for,assignee')
      .not('visit_on', 'is', null).gte('visit_on', from).lte('visit_on', to).neq('status', 'done')
      .order('visit_on').limit(400)
    // Before migration 088 the columns are not there. No vendor visits is the honest answer then,
    // not a broken Command Center.
    if (error) return NextResponse.json({ ok: true, today, visits: [], note: 'needs-088' })

    const kept = ((rows || []) as any[]).filter(r => !visible || visible.has(String(r.project_id)))
    if (!kept.length) return NextResponse.json({ ok: true, today, visits: [] })

    const pids = Array.from(new Set(kept.map(r => String(r.project_id))))
    const [{ data: projs }, { data: links }] = await Promise.all([
      sb.from('projects').select('id,title,kind,archived').in('id', pids),
      sb.from('project_links').select('task_id,kind,label').in('task_id', kept.map(r => String(r.id))).in('kind', ['listing', 'building']),
    ])
    const pmap: Record<string, any> = {}
    for (const p of ((projs || []) as any[])) pmap[String(p.id)] = p
    const where: Record<string, string> = {}
    for (const l of ((links || []) as any[])) {
      const k = String(l.task_id)
      if (!where[k] || l.kind === 'listing') where[k] = String(l.label || '')
    }

    const visits = kept
      // A personal board is its owner's alone; a 1:1 is two people's. Neither is an ops signal.
      .filter(r => { const p = pmap[String(r.project_id)]; return p && !p.archived && p.kind !== 'personal' && p.kind !== 'one_on_one' })
      .map(r => {
        const state = visitState(r.visit_on, String(r.status), today)
        return {
          id: String(r.id), projectId: String(r.project_id), project: String(pmap[String(r.project_id)]?.title || 'Project'),
          title: String(r.title || ''), vendor: r.vendor_name || null, vendorKey: r.vendor_key || null,
          visit_on: String(r.visit_on).slice(0, 10), window: r.visit_window || null,
          est: estLabel(r.est_minutes), where: where[String(r.id)] || null,
          owner: r.assignee || null,
          // The two facts a covering manager needs: when, and whether anybody has been told.
          when: state?.label || '', tone: state?.tone || 'later',
          announced: !needsTelling({ visit_on: r.visit_on, team_notified_for: r.team_notified_for, status: String(r.status) }),
        }
      })

    return NextResponse.json({ ok: true, today, visits })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
