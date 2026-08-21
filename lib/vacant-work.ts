// WHAT TO DO WITH AN EMPTY UNIT.
//
// Jon, 2026-08-21: "add to briefs based on vacant units, PM audit suggestions based on Vacant
// units, Inspections, etc". A vacant unit is the only window in which the real work can happen —
// a full property audit, a deep clean, the maintenance job nobody can do around a guest, a reshoot
// of a thin photo set. The brief already listed how MANY units were empty; it never said what to
// put in them, so the window closed unused and the same work stayed overdue.
//
// The cadence rules are NOT invented here. The audit interval is the operator's `auditDueDays`
// (/users → Ops presets), the same one /api/ops-today/audits-due counts against, and "an audit is
// a Breezeway task with 'audit' in its name" is that route's rule too. One definition, two callers.
//
// Nothing here creates a task. It ranks what is worth doing and says why, and a human decides.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOpsPresets } from '@/lib/app-settings'

const DONE = /complete|finish|close|approv/i
const GONE = /delete|cancel/i
const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const dOf = (v: any) => str(v).slice(0, 10)
function daysBetween(a: string, b: string): number {
  const x = Date.parse(a + 'T12:00:00Z'), y = Date.parse(b + 'T12:00:00Z')
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 86400000) : 0
}

/** A unit that is empty tonight, as the daysheet describes it. */
export type VacantUnit = {
  listingId: string
  unit: string
  market?: string | null
  bedrooms?: number | null
  /** Nights until the next guest. null = nothing booked at all — the widest window there is. */
  daysUntilArrival?: number | null
  nextArrival?: string | null
  idleDays?: number | null
  vendor?: any
}

export type Suggestion = {
  key: 'maintenance' | 'glitch' | 'audit' | 'inspection' | 'deepclean' | 'photos'
  label: string
  why: string
  /** 1 = do it in this window whatever else happens. 4 = worth it if there is time. */
  priority: 1 | 2 | 3 | 4
  /** Minimum clear days this job realistically needs. A one-night gap is not an audit window. */
  needsDays: number
}

export type VacantWork = VacantUnit & {
  /** How many clear days the window actually is. Infinity-ish (999) when nothing is booked. */
  windowDays: number
  suggestions: Suggestion[]
  /** The single best use of this window — what the brief prints. */
  top: Suggestion | null
}

const PRIORITY_ORDER: Suggestion['key'][] = ['maintenance', 'glitch', 'audit', 'inspection', 'deepclean', 'photos']

/**
 * Rank what each empty unit should be used for. Suggestions that cannot fit the window are dropped
 * rather than printed and ignored — a brief that suggests a full audit in a same-day turn teaches
 * people to skim past it.
 */
export async function vacantWork(vacants: VacantUnit[], today: string): Promise<VacantWork[]> {
  if (!vacants.length) return []
  const ids = vacants.map(v => String(v.listingId)).filter(Boolean)
  const idSet = new Set(ids)
  const db = supabaseAdmin()
  const presets = await getOpsPresets()
  const auditDueDays = Math.max(30, Number((presets as any)?.timing?.auditDueDays) || 365)

  const [tasksRes, reqRes, glitchRes, listRes] = await Promise.all([
    // Audit / inspection / deep-clean history, by the same name rule the audits-due route uses.
    db.from('breezeway_tasks_sync')
      .select('reference_property_id,name,status,finished_at,scheduled_date')
      .in('reference_property_id', ids).limit(5000),
    db.from('field_requests').select('id,listing_id,status,priority,title')
      .in('status', ['open', 'in_progress']).limit(2000),
    db.from('glitches').select('id,listing_id,status,overview')
      .not('status', 'in', '("done","resolved","closed")').limit(2000),
    // Photo strength — a wide-open window is the moment to reshoot a thin set. photo_score is what
    // the listing photo AI wrote; a null means it has never even been looked at.
    db.from('guesty_listings').select('id,pictures,photo_score').in('id', ids).limit(1000),
  ])

  const lastAudit: Record<string, string> = {}
  const openAudit = new Set<string>()
  const lastInspection: Record<string, string> = {}
  const openInspection = new Set<string>()
  const lastDeep: Record<string, string> = {}
  for (const t of (tasksRes.data || []) as any[]) {
    const id = String(t.reference_property_id); if (!idSet.has(id)) continue
    const st = str(t.status); if (GONE.test(st)) continue
    const nm = str(t.name).toLowerCase()
    const when = dOf(t.finished_at || t.scheduled_date)
    const finished = DONE.test(st) || !!t.finished_at
    const put = (map: Record<string, string>) => { if (when && (!map[id] || when > map[id])) map[id] = when }
    if (/audit/.test(nm)) { if (finished) put(lastAudit); else openAudit.add(id) }
    else if (/inspect|walk[- ]?through|unit check/.test(nm)) { if (finished) put(lastInspection); else openInspection.add(id) }
    else if (/deep clean|deep-clean|detail clean/.test(nm)) { if (finished) put(lastDeep) }
  }

  const openReq: Record<string, { n: number; urgent: number; first: string }> = {}
  for (const r of (reqRes.data || []) as any[]) {
    const id = String(r.listing_id); if (!idSet.has(id)) continue
    const e = openReq[id] || (openReq[id] = { n: 0, urgent: 0, first: str(r.title) })
    e.n++
    if (/urgent|high/i.test(str(r.priority))) e.urgent++
    if (!e.first) e.first = str(r.title)
  }
  const openGlitch: Record<string, { n: number; first: string }> = {}
  for (const g of (glitchRes.data || []) as any[]) {
    const id = String(g.listing_id); if (!idSet.has(id)) continue
    const e = openGlitch[id] || (openGlitch[id] = { n: 0, first: str(g.overview) })
    e.n++
    if (!e.first) e.first = str(g.overview)
  }
  const photo: Record<string, { count: number; score: number | null }> = {}
  for (const l of (listRes.data || []) as any[]) {
    const ps = l.photo_score && typeof l.photo_score === 'object' ? Number((l.photo_score as any).score) : NaN
    photo[String(l.id)] = {
      count: Array.isArray(l.pictures) ? l.pictures.length : 0,
      score: Number.isFinite(ps) ? ps : null,
    }
  }

  const out: VacantWork[] = vacants.map(v => {
    const id = String(v.listingId)
    // No future booking is the widest window there is; treat it as effectively open-ended so it
    // outranks a three-day gap for the jobs that need real time.
    const windowDays = v.daysUntilArrival == null ? 999 : Math.max(0, Number(v.daysUntilArrival) || 0)
    const s: Suggestion[] = []

    const req = openReq[id]
    if (req) {
      s.push({
        key: 'maintenance', priority: 1, needsDays: 1,
        label: `${req.n} open maintenance ${req.n === 1 ? 'request' : 'requests'}`,
        why: req.urgent ? `${req.urgent} marked urgent — ${req.first || 'no title'}` : (req.first || 'nobody can do this around a guest'),
      })
    }
    const gl = openGlitch[id]
    if (gl) {
      s.push({
        key: 'glitch', priority: 1, needsDays: 1,
        label: `${gl.n} open guest ${gl.n === 1 ? 'issue' : 'issues'}`,
        why: gl.first ? gl.first.slice(0, 90) : 'still open against this unit',
      })
    }

    if (!openAudit.has(id)) {
      const la = lastAudit[id] || null
      const age = la ? daysBetween(la, today) : null
      if (!la) s.push({ key: 'audit', priority: 2, needsDays: 2, label: 'Property audit — never done', why: 'no completed audit on record for this unit' })
      else if (age != null && age > auditDueDays) s.push({ key: 'audit', priority: 2, needsDays: 2, label: 'Property audit overdue', why: `last one ${age} days ago, cadence is ${auditDueDays}` })
    }

    if (!openInspection.has(id)) {
      const li = lastInspection[id] || null
      const age = li ? daysBetween(li, today) : null
      // A unit nobody has walked in two months, sitting empty, is worth twenty minutes.
      if (!li) s.push({ key: 'inspection', priority: 3, needsDays: 1, label: 'Never inspected', why: 'no inspection or walkthrough on record' })
      else if (age != null && age >= 60) s.push({ key: 'inspection', priority: 3, needsDays: 1, label: 'Inspection is stale', why: `last walked ${age} days ago` })
    }

    // A long empty stretch is the only time a deep clean does not cost a booking.
    const ld = lastDeep[id] || null
    const ldAge = ld ? daysBetween(ld, today) : null
    if (windowDays >= 3 && (!ld || (ldAge != null && ldAge >= 120))) {
      s.push({
        key: 'deepclean', priority: 3, needsDays: 3,
        label: 'Deep clean while it is empty',
        why: ld ? `last deep clean ${ldAge} days ago` : 'no deep clean on record',
      })
    }

    const ph = photo[id]
    if (ph && (ph.count < 15 || (ph.score != null && ph.score < 65))) {
      s.push({
        key: 'photos', priority: 4, needsDays: 1,
        label: ph.count < 15 ? `Reshoot — only ${ph.count} photos` : `Reshoot — photo quality ${ph.score}/100`,
        why: 'staged and empty is the only time to shoot it properly',
      })
    }

    // Drop anything that cannot fit, then rank: urgency first, then the job that needs the window most.
    const fits = s.filter(x => windowDays >= x.needsDays)
    fits.sort((a, b) => a.priority - b.priority || PRIORITY_ORDER.indexOf(a.key) - PRIORITY_ORDER.indexOf(b.key))
    return { ...v, windowDays, suggestions: fits, top: fits[0] || null }
  })

  // Units with something worth doing first; within that, the widest window, then the longest idle.
  return out.sort((a, b) =>
    (a.top ? 0 : 1) - (b.top ? 0 : 1) ||
    (a.top && b.top ? a.top.priority - b.top.priority : 0) ||
    b.windowDays - a.windowDays ||
    (b.idleDays || 0) - (a.idleDays || 0))
}

/** One-line summary for a brief header. */
export function vacantWorkSummary(rows: VacantWork[]): string {
  const withWork = rows.filter(r => r.top)
  if (!rows.length) return 'nothing empty tonight'
  if (!withWork.length) return `${rows.length} empty, nothing outstanding on any of them`
  const urgent = withWork.filter(r => r.top!.priority === 1).length
  const open = rows.filter(r => r.daysUntilArrival == null).length
  return `${rows.length} empty · ${withWork.length} with work worth slotting in`
    + (urgent ? ` · ${urgent} with something open right now` : '')
    + (open ? ` · ${open} with no future booking at all` : '')
}
