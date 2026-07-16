// TODAY IN OPS — live operational picture, organised BY UNIT (a unit can have a strip, a
// departure clean, an inspection and maintenance all on the same day).
// The clock that matters: DEPARTURE CLEANS must be finished by 4pm, because that's when the
// next guest can check in. Strips / PM / inspections don't carry that deadline.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf, MARKETS } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const DEADLINE_MIN = 16 * 60      // 4:00pm ET — next guest can check in
const AT_RISK_MIN = 2 * 60        // flag when under 2h left and not started
// Botanica is cleaned by a vendor who does NOT close the task in Breezeway, so its cleans sit at
// 'not started' forever. Tracking them against 4pm produced 11 false 'at risk' alerts out of 17.
// They still show on the board, but they carry no deadline and no status alarm.
const UNTRACKED_RE = /botanica/i

function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function etMinutes(d: Date) {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  const p = s.split(':')
  return (Number(p[0]) % 24) * 60 + Number(p[1])
}
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function deptOf(v: any): string { const s = str(v).toLowerCase(); if (/housekeep|clean/.test(s)) return 'housekeeping'; if (/maint/.test(s)) return 'maintenance'; if (/inspect/.test(s)) return 'inspection'; return s || 'other' }
// Task TYPE comes from the Breezeway task name — 'Departure Clean Checklist' and
// 'Strip & Walkthrough' are both housekeeping but are completely different jobs.
function typeOf(name: any, dept: string): string {
  const s = str(name).toLowerCase()
  if (/strip|walkthrough/.test(s)) return 'strip'
  if (/departure clean|turnover clean/.test(s)) return 'departure_clean'
  if (/deep clean/.test(s)) return 'deep_clean'
  if (/pool|pest/.test(s)) return 'pool_pest'
  if (/field reported/.test(s)) return 'field'
  if (/preventative|preventive|\bpm\b/.test(s)) return 'pm'
  if (/audit/.test(s)) return 'audit'
  if (/unit check|inspect/.test(s)) return 'inspection'
  if (dept === 'maintenance') return 'maintenance'
  if (dept === 'inspection') return 'inspection'
  return 'other'
}
const isDone = (s: string) => /complete|finish/.test(s)
const isRunning = (s: string) => /progress|started/.test(s)

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const db = supabaseAdmin()
    const now = new Date()
    const today = ymd(now)
    const nowMin = etMinutes(now)
    const minsLeft = DEADLINE_MIN - nowMin
    const [lRes, tRes, qRes, rRes] = await Promise.all([
      db.from('guesty_listings').select('id,nickname,title,building,address_city'),
      db.from('breezeway_tasks_sync').select('id,reference_property_id,name,status,scheduled_date,assignees,started_at,finished_at,total_minutes,report_url,type_department').eq('scheduled_date', today).limit(2000),
      db.from('qc_tasks').select('listing_id,status,issue_type,report_url').neq('status', 'closed').limit(300),
      db.from('guesty_reservations').select('listing_id,check_in,check_out,status,guest_name').or('check_out.eq.' + today + ',check_in.eq.' + today).limit(1000),
    ])
    const lmap: Record<string, { name: string; market: string }> = {}
    for (const l of (lRes.data || []) as any[]) {
      const name = l.nickname || l.title || 'Unit'
      lmap[String(l.id)] = { name, market: marketOf(l.building, l.address_city, name) }
    }
    // same-day turns + who is leaving, for unit context
    const outToday: Record<string, string> = {}
    const inToday: Record<string, boolean> = {}
    for (const r of (rRes.data || []) as any[]) {
      if (!/confirm|checked/i.test(str(r.status))) continue
      const id = String(r.listing_id)
      if (str(r.check_out).slice(0, 10) === today) outToday[id] = r.guest_name || 'Guest'
      if (str(r.check_in).slice(0, 10) === today) inToday[id] = true
    }
    const qcByListing: Record<string, any[]> = {}
    for (const q of (qRes.data || []) as any[]) {
      const id = String(q.listing_id)
      if (!qcByListing[id]) qcByListing[id] = []
      qcByListing[id].push({ issue: q.issue_type || 'Issue', status: str(q.status), reportUrl: q.report_url || null })
    }
    const tasks = ((tRes.data || []) as any[]).map(t => {
      const lid = String(t.reference_property_id)
      const li = lmap[lid]
      const dept = deptOf(t.type_department)
      const type = typeOf(t.name, dept)
      const status = str(t.status).toLowerCase()
      const done = isDone(status)
      const running = isRunning(status)
      const ppl = Array.isArray(t.assignees) ? t.assignees : []
      // the 4pm clock applies to DEPARTURE CLEANS only, and only where Breezeway completion is real
      const untracked = UNTRACKED_RE.test(li ? li.name : '')
      const clocked = type === 'departure_clean' && !untracked
      const finishedMin = t.finished_at ? etMinutes(new Date(t.finished_at)) : null
      const late = clocked && !done && minsLeft < 0
      const atRisk = clocked && !done && !late && minsLeft <= AT_RISK_MIN && !running
      const missed = clocked && done && finishedMin != null && finishedMin > DEADLINE_MIN
      return {
        id: String(t.id), listingId: lid,
        unit: li ? li.name : 'Unknown unit', market: li ? li.market : 'Other',
        dept, type, name: t.name || 'Task', status,
        assignees: ppl.map((p: any) => p && p.name).filter(Boolean),
        startedAt: t.started_at || null, finishedAt: t.finished_at || null,
        minutes: t.total_minutes ?? null, reportUrl: t.report_url || null,
        done, running, clocked, late, atRisk, missed, untracked,
      }
    })
    // group BY UNIT — one card per unit with everything on it today
    const unitMap: Record<string, any> = {}
    for (const t of tasks) {
      if (!unitMap[t.listingId]) {
        unitMap[t.listingId] = {
          listingId: t.listingId, unit: t.unit, market: t.market,
          guestOut: outToday[t.listingId] || null,
          sameDayTurn: !!(outToday[t.listingId] && inToday[t.listingId]),
          qc: qcByListing[t.listingId] || [], tasks: [],
        }
      }
      unitMap[t.listingId].tasks.push(t)
    }
    const ORDER: Record<string, number> = { departure_clean: 0, strip: 1, deep_clean: 2, inspection: 3, audit: 4, pm: 5, field: 6, pool_pest: 7, maintenance: 8, other: 9 }
    const units = Object.keys(unitMap).map(k => {
      const u = unitMap[k]
      u.tasks.sort((a: any, b: any) => (ORDER[a.type] ?? 9) - (ORDER[b.type] ?? 9))
      u.late = u.tasks.some((t: any) => t.late)
      u.atRisk = u.tasks.some((t: any) => t.atRisk)
      u.unassigned = u.tasks.some((t: any) => t.assignees.length === 0 && !t.done)
      u.untracked = u.tasks.some((t: any) => t.untracked)
      u.allDone = u.tasks.every((t: any) => t.done)
      u.openTasks = u.tasks.filter((t: any) => !t.done).length
      return u
    })
    // most urgent first: late > at risk > same-day turn > unassigned > open QC > has work left
    // lower = more urgent; finished units sink to the bottom
    const rank = (u: any) => -(u.late ? 100 : 0) - (u.atRisk ? 50 : 0) - (u.sameDayTurn ? 20 : 0) - (u.unassigned ? 10 : 0) - (u.qc.length ? 5 : 0) + (u.allDone ? 1000 : 0)
    units.sort((a, b) => rank(a) - rank(b) || a.unit.localeCompare(b.unit))
    const cleans = tasks.filter(t => t.clocked)
    const deadline = {
      dueBy: '4:00 PM', minsLeft, passed: minsLeft < 0,
      cleans: cleans.length,
      done: cleans.filter(t => t.done).length,
      running: cleans.filter(t => t.running && !t.done).length,
      remaining: cleans.filter(t => !t.done).length,
      late: cleans.filter(t => t.late).length,
      atRisk: cleans.filter(t => t.atRisk).length,
      missed: cleans.filter(t => t.missed).length,
      untracked: tasks.filter(t => t.type === 'departure_clean' && t.untracked).length,
    }
    const byMarket = MARKETS.map(m => {
      const mt = tasks.filter(t => t.market === m)
      const mc = mt.filter(t => t.clocked)
      return {
        market: m, total: mt.length, cleans: mc.length,
        cleansDone: mc.filter(t => t.done).length,
        late: mc.filter(t => t.late).length, atRisk: mc.filter(t => t.atRisk).length,
        strips: mt.filter(t => t.type === 'strip').length,
        maintenance: mt.filter(t => t.dept === 'maintenance').length,
        inspection: mt.filter(t => t.dept === 'inspection').length,
        unassigned: mt.filter(t => t.assignees.length === 0 && !t.done).length,
      }
    })
    const totals = {
      tasks: tasks.length, units: units.length,
      strips: tasks.filter(t => t.type === 'strip').length,
      maintenance: tasks.filter(t => t.dept === 'maintenance').length,
      inspection: tasks.filter(t => t.dept === 'inspection').length,
      unassigned: tasks.filter(t => t.assignees.length === 0 && !t.done).length,
      openQc: (qRes.data || []).length,
    }
    return NextResponse.json({ ok: true, today, nowMin, deadline, totals, byMarket, units })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
