// TODAY IN OPS — the live operational picture for the field coordinator: every Breezeway task
// scheduled today (cleans, maintenance, inspections) with who's on it and where it stands,
// plus open QC issues. Read-only: eyes and ears first.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf, MARKETS } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function deptOf(v: any): string { const s = str(v).toLowerCase(); if (/housekeep|clean/.test(s)) return 'housekeeping'; if (/maint/.test(s)) return 'maintenance'; if (/inspect/.test(s)) return 'inspection'; return s || 'other' }

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const db = supabaseAdmin()
    const today = ymd(new Date())
    const [lRes, tRes, qRes] = await Promise.all([
      db.from('guesty_listings').select('id,nickname,title,building,address_city'),
      db.from('breezeway_tasks_sync').select('id,reference_property_id,name,status,scheduled_date,assignees,started_at,finished_at,total_minutes,report_url,type_department').eq('scheduled_date', today).limit(2000),
      db.from('qc_tasks').select('listing_id,status,issue_type,department,report_url,created_at').neq('status', 'closed').limit(300),
    ])
    const lmap: Record<string, { name: string; market: string }> = {}
    for (const l of (lRes.data || []) as any[]) {
      const name = l.nickname || l.title || 'Unit'
      lmap[String(l.id)] = { name, market: marketOf(l.building, l.address_city, name) }
    }
    const tasks = ((tRes.data || []) as any[]).map(t => {
      const li = lmap[String(t.reference_property_id)]
      const ppl = Array.isArray(t.assignees) ? t.assignees : []
      return {
        id: String(t.id),
        unit: li ? li.name : 'Unknown unit',
        market: li ? li.market : 'Other',
        dept: deptOf(t.type_department),
        name: t.name || 'Task',
        status: str(t.status).toLowerCase(),
        assignees: ppl.map((p: any) => p && p.name).filter(Boolean),
        startedAt: t.started_at || null,
        finishedAt: t.finished_at || null,
        minutes: t.total_minutes ?? null,
        reportUrl: t.report_url || null,
      }
    })
    const done = (s: string) => /complete|finish/.test(s)
    const running = (s: string) => /progress|started/.test(s)
    const byMarket = MARKETS.map(m => {
      const mt = tasks.filter(t => t.market === m)
      const cleans = mt.filter(t => t.dept === 'housekeeping')
      return {
        market: m,
        total: mt.length,
        cleans: cleans.length,
        cleansDone: cleans.filter(t => done(t.status)).length,
        cleansRunning: cleans.filter(t => running(t.status)).length,
        maintenance: mt.filter(t => t.dept === 'maintenance').length,
        inspection: mt.filter(t => t.dept === 'inspection').length,
        unassigned: mt.filter(t => t.assignees.length === 0 && !done(t.status)).length,
      }
    })
    const qc = ((qRes.data || []) as any[]).map(q => {
      const li = lmap[String(q.listing_id)]
      return {
        unit: li ? li.name : 'Unit', market: li ? li.market : 'Other',
        issue: q.issue_type || 'Issue', dept: q.department || null,
        status: str(q.status), reportUrl: q.report_url || null, createdAt: q.created_at || null,
      }
    })
    const totals = {
      tasks: tasks.length,
      cleans: tasks.filter(t => t.dept === 'housekeeping').length,
      cleansDone: tasks.filter(t => t.dept === 'housekeeping' && done(t.status)).length,
      maintenance: tasks.filter(t => t.dept === 'maintenance').length,
      inspection: tasks.filter(t => t.dept === 'inspection').length,
      unassigned: tasks.filter(t => t.assignees.length === 0 && !done(t.status)).length,
      openQc: qc.length,
    }
    return NextResponse.json({ ok: true, today, totals, byMarket, tasks, qc })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
