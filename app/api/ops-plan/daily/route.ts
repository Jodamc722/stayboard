// Daily Ops Plan. For TODAY / TOMORROW / next day (by check-out = turnover), lists the units
// turning over and generates internal operational-improvement TASKS for each (from guest
// feedback, recurring issues, a turnover audit, and a preventative-maintenance check). Units
// are ranked LUX FIRST, then weakest health. Field tasks carry a Breezeway department so they
// can be pushed + tracked from the board; desk tasks (guest feedback / listing) are not pushable.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { computeListingHealth, type HealthReview } from '@/lib/health-score'
import { rollupBuilding } from '@/lib/optimize-score'
import { marketOf, isLux } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DEAD = ['inactive', 'disabled', 'archived', 'deleted']
function et(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(n: number) { return et(new Date(Date.now() + n * 86400000)) }

// Which Breezeway department owns a task category (null = desk task, not pushable to the field).
const DEPT: Record<string, string | null> = {
  Cleanliness: 'housekeeping', Maintenance: 'maintenance', Access: 'maintenance',
  Inspection: 'inspection', PM: 'maintenance', 'Guest experience': 'inspection',
  'Guest feedback': null, Listing: null, Ops: 'inspection',
}

// Map a health issue to an operational task category + how it reads on the board. `key` is kept
// so the push flow can route/department it; department is derived from the category.
function taskFor(key: string, title: string, action: string, severity: string): { key: string; category: string; title: string; detail: string; severity: string } {
  const k = String(key || '').toLowerCase()
  if (k === 'clean') return { key: k, category: 'Cleanliness', title: 'Deep clean + QC inspection', detail: action, severity }
  if (k === 'ac') return { key: k, category: 'Maintenance', title: 'HVAC / climate check', detail: action, severity }
  if (k === 'maint') return { key: k, category: 'Maintenance', title: 'Maintenance fix', detail: action, severity }
  if (k === 'checkin') return { key: k, category: 'Access', title: 'Verify check-in / door codes', detail: action, severity }
  if (k === 'noise') return { key: k, category: 'Guest experience', title: 'Noise mitigation + expectations', detail: action, severity }
  if (k === 'rating' || k === 'resp' || k === 'volume') return { key: k, category: 'Guest feedback', title, detail: action, severity }
  if (k === 'setup') return { key: k, category: 'Listing', title: 'Optimize listing setup', detail: action, severity }
  if (k === 'ops') return { key: k, category: 'Ops', title, detail: action, severity }
  return { key: k || 'feedback', category: 'Guest feedback', title, detail: action, severity }
}
const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = supabaseAdmin()
  const days = [addDays(0), addDays(1), addDays(2)]

  // Reviews + listings + open work (for health) and the 3 days of checkouts.
  const fetchAllReviews = async () => {
    let all: any[] = []
    for (let from = 0; from < 12000; from += 1000) {
      const { data } = await sb.from('guesty_reviews').select('listing_id, rating, content, has_reply, created_at, channel').eq('excluded_from_score', false).range(from, from + 999)
      if (!data || data.length === 0) break
      all = all.concat(data); if (data.length < 1000) break
    }
    return all
  }
  const [revRows, { data: listings }, { data: work }, { data: resv }] = await Promise.all([
    fetchAllReviews(),
    sb.from('guesty_listings').select('id, title, nickname, building, unit, status, bedrooms, bathrooms, max_occupancy, amenities, pictures, address_city, raw').limit(2000),
    sb.from('field_requests').select('building, priority, status').in('status', ['open', 'in_progress']).limit(2000),
    sb.from('guesty_reservations').select('listing_id, listing_name, guest_name, nights, money_total, check_out, status').in('check_out', days).limit(2000),
  ])
  const resvError = (resv as any) === null

  const openByBuilding: Record<string, number> = {}
  ;(work ?? []).forEach((w: any) => { const b = rollupBuilding(w.building); if (!b || b === 'Unassigned') return; const wt = String(w.priority).toLowerCase() === 'high' || w.priority === 1 ? 2 : 1; openByBuilding[b] = (openByBuilding[b] || 0) + wt })

  const byListing = new Map<string, HealthReview[]>()
  ;(revRows ?? []).forEach((r: any) => { if (!r.listing_id) return; const a = byListing.get(r.listing_id) || []; a.push({ rating: r.rating != null && r.rating !== '' ? Number(r.rating) : null, channel: r.channel, content: r.content, created_at: r.created_at, hasReply: !!r.has_reply }); byListing.set(r.listing_id, a) })

  const lmeta = new Map<string, any>()
  for (const l of (listings ?? [])) lmeta.set(String((l as any).id), l)

  // Cache computed health per listing.
  const healthCache = new Map<string, any>()
  const healthOf = (lid: string) => {
    if (healthCache.has(lid)) return healthCache.get(lid)
    const l = lmeta.get(lid); if (!l) return null
    const building = rollupBuilding(l.building)
    const h = computeListingHealth(l, byListing.get(lid) || [], { openWork: openByBuilding[building] || 0 })
    healthCache.set(lid, h); return h
  }

  const cleanResv = (resv ?? []).filter((r: any) => r.listing_id && !/cancel|declin/i.test(String(r.status || '')))

  // Already-pushed tasks (for status pills) keyed by `${listing_id}__${title}`.
  const listingIds = Array.from(new Set(cleanResv.map((r: any) => String(r.listing_id))))
  const pushMap = new Map<string, any>()
  if (listingIds.length) {
    const { data: pushed } = await sb.from('breezeway_tasks')
      .select('listing_id, issue_title, status, scheduled_date, report_url, action_taken_at, breezeway_task_id, department')
      .in('listing_id', listingIds).order('created_at', { ascending: false }).limit(4000)
    ;(pushed ?? []).forEach((p: any) => {
      const key = `${p.listing_id}__${p.issue_title}`
      if (!pushMap.has(key)) pushMap.set(key, { status: p.status, scheduledDate: p.scheduled_date, reportUrl: p.report_url, actionTakenAt: p.action_taken_at, taskId: p.breezeway_task_id, department: p.department })
    })
  }

  const result = days.map((date, i) => {
    const dayResv = cleanResv.filter((r: any) => String(r.check_out).slice(0, 10) === date)
    // Dedupe by listing (one card per unit even if multiple reservations).
    const seen = new Set<string>()
    const units: any[] = []
    for (const r of dayResv) {
      const lid = String(r.listing_id); if (seen.has(lid)) continue; seen.add(lid)
      const l = lmeta.get(lid); if (!l) continue
      const status = String(l.status || '').toLowerCase()
      const building = rollupBuilding(l.building)
      if (DEAD.includes(status) || building.toLowerCase() === 'waves') continue
      const nm = l.title || l.nickname || lid
      const lux = isLux(l.building || building, nm)
      const market = marketOf(l.building || building, l.address_city, nm)
      const h = healthOf(lid)

      let tasks: any[] = []
      // 1) Operational-improvement tasks from guest feedback / health issues.
      ;(h?.issues || []).forEach((is: any) => { const t = taskFor(is.key, is.title, is.action, is.severity); tasks.push({ ...t }) })
      // 2) Standard turnover audit + preventative maintenance (the "last audit / last PM" cadence).
      tasks.push({ key: 'audit', category: 'Inspection', title: 'Turnover inspection & audit', detail: 'Walk the unit on checkout: cleanliness, damage, amenities, restock, photos vs. reality.', severity: 'medium' })
      tasks.push({ key: 'pm', category: 'PM', title: 'Preventative maintenance check', detail: 'Quick PM pass: HVAC filter, smoke/CO detectors, leaks, lightbulbs, batteries, hardware.', severity: 'low' })

      tasks.sort((a, b) => (SEV_RANK[a.severity] ?? 2) - (SEV_RANK[b.severity] ?? 2))
      // Attach department (pushable?) + any existing push status.
      tasks = tasks.map(t => {
        const department = DEPT[t.category] ?? null
        const push = pushMap.get(`${lid}__${t.title}`) || null
        return { ...t, department, pushable: !!department, push }
      })
      units.push({
        listingId: lid, listing: nm, building: building !== 'Unassigned' ? building : null,
        market, tier: lux ? 'Lux' : 'Other', lux,
        score: h?.score ?? null, band: h?.band ?? 'neutral', topIssue: h?.review?.topIssue || null,
        guest: r.guest_name || null, nights: Number(r.nights) || null,
        taskCount: tasks.length, tasks,
      })
    }
    // Rank units: LUX first, then weakest health (lowest score) first.
    units.sort((a, b) => (a.lux === b.lux ? 0 : a.lux ? -1 : 1) || ((a.score ?? 101) - (b.score ?? 101)))
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : 'Next day'
    return { date, label, unitCount: units.length, taskCount: units.reduce((s, u) => s + u.taskCount, 0), units }
  })

  // Robustness: a 235-unit portfolio never has zero checkouts across three straight days, so an
  // all-zero result means the reservations read came back empty (transient DB hiccup / mid-sync).
  // Return a soft error instead of ok:true so the client cache won't store a misleading empty board.
  const totalUnits = result.reduce((s, d) => s + d.unitCount, 0)
  if (resvError || totalUnits === 0) {
    return NextResponse.json({ ok: false, error: 'Could not load checkouts right now (data may be syncing). Hit refresh to retry.' })
  }

  return NextResponse.json({ ok: true, generatedAt: new Date().toISOString(), days: result })
}
