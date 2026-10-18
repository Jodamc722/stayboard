// CHECKLIST AUDIT — what a Breezeway template looks like in the field, from the field.
//
// Jon, 2026-10-18: "audit our departure clean and let's fix and make it a bit easier and tighter."
// A template can only be tightened against evidence: which lines the crew actually answers, which
// photos actually get taken, which yes/no questions ever say no, how long the task takes — and what
// guests then complain about anyway. Breezeway keeps the per-task answers behind
// GET /task/{id}/requirements (one call per task, no rollup), so this route pulls a sample of
// recently completed tasks that carry the template's name and aggregates line by line.
//
//   GET /api/breezeway/checklist-audit?name=Departure%20Clean%20Checklist&days=14&max=60
//
// Admins only (it reads task reports). Read-only. Slow by nature (N calls), capped at 80 tasks.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/access'
import { bzApi, breezewayConfigured } from '@/lib/breezeway'
import { isTaskDone, isTaskGone } from '@/lib/task-categories'
import { THEMES } from '@/lib/review-themes'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

export async function GET(req: NextRequest) {
  const gate = await requireAdmin('admin')
  if (!gate.ok) return gate.res
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured' }, { status: 503 })
  const sp = req.nextUrl.searchParams
  const name = norm(str(sp.get('name')) || 'Departure Clean Checklist')
  const days = Math.max(1, Math.min(Number(sp.get('days')) || 14, 90))
  const max = Math.max(5, Math.min(Number(sp.get('max')) || 60, 80))
  const db = supabaseAdmin()
  const since = new Date(Date.now() - days * 86400000).toISOString()

  // The sample: completed tasks carrying the template's name, newest first, spread across units.
  const { data: rows, error } = await db.from('breezeway_tasks_sync')
    .select('id, reference_property_id, name, status, finished_at, total_minutes, assignees, raw')
    .ilike('name', name + '%').not('finished_at', 'is', null).gte('finished_at', since)
    .order('finished_at', { ascending: false }).limit(400)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const done = ((rows || []) as any[]).filter(t => isTaskDone(t.status, t.finished_at) && !isTaskGone(t.status))
  // One per unit first, then fill — so one busy unit cannot be the whole sample.
  const byUnit = new Map<string, any[]>()
  for (const t of done) { const k = str(t.reference_property_id); if (!byUnit.has(k)) byUnit.set(k, []); byUnit.get(k)!.push(t) }
  const sample: any[] = []
  let round = 0
  while (sample.length < max) {
    let added = 0
    for (const list of Array.from(byUnit.values())) { if (list[round]) { sample.push(list[round]); added++; if (sample.length >= max) break } }
    if (!added) break
    round++
  }
  const lids = Array.from(new Set(sample.map(t => str(t.reference_property_id))))
  const { data: listings } = lids.length ? await db.from('guesty_listings').select('id, nickname, title, building').in('id', lids) : { data: [] as any[] }
  const unitOf: Record<string, string> = {}
  for (const l of listings || []) unitOf[str((l as any).id)] = str((l as any).nickname || (l as any).title)

  type Line = { section: string; action: string; type: string; seen: number; answered: number; yes: number; no: number; photos: number; withPhoto: number; notes: number; photoRequired: number }
  const lines = new Map<string, Line>()
  const taskRows: any[] = []
  let fetched = 0, failed = 0
  for (const t of sample) {
    const r = await bzApi('/task/' + encodeURIComponent(str(t.id)) + '/requirements')
    if (!r.ok || !Array.isArray(r.data)) { failed++; continue }
    fetched++
    let answered = 0, photos = 0
    for (const q of r.data as any[]) {
      const action = norm(Array.isArray(q.action) ? q.action.join(' ') : str(q.action))
      const key = norm(str(q.section_name)) + ' | ' + action.slice(0, 160)
      const L = lines.get(key) || { section: norm(str(q.section_name)), action, type: str(q.type_requirement), seen: 0, answered: 0, yes: 0, no: 0, photos: 0, withPhoto: 0, notes: 0, photoRequired: 0 }
      L.seen++
      if (q.photo_required) L.photoRequired++
      const resp = str(q.response).trim().toLowerCase()
      const ph = Array.isArray(q.photos) ? q.photos.length : 0
      const has = !!resp || ph > 0
      if (has) { L.answered++; answered++ }
      if (resp === 'yes' || resp === 'true') L.yes++
      if (resp === 'no' || resp === 'false') L.no++
      if (ph) { L.photos += ph; L.withPhoto++; photos += ph }
      if (str(q.note).trim()) L.notes++
      lines.set(key, L)
    }
    const people = Array.isArray(t.assignees) ? t.assignees.map((p: any) => str(p && typeof p === 'object' ? p.name : p)).filter(Boolean) : []
    taskRows.push({ id: str(t.id), unit: unitOf[str(t.reference_property_id)] || str(t.reference_property_id), finished: str(t.finished_at).slice(0, 10), minutes: t.total_minutes ?? null, by: str(t.raw?.finished_by?.name) || people.join(', '), items: (r.data as any[]).length, answered, photos })
  }
  const lineRows = Array.from(lines.values()).map(L => ({
    ...L, answeredPct: L.seen ? Math.round(100 * L.answered / L.seen) : 0, photoPct: L.seen ? Math.round(100 * L.withPhoto / L.seen) : 0,
  })).sort((a, b) => a.section.localeCompare(b.section) || b.seen - a.seen)
  const mins = taskRows.map(t => Number(t.minutes)).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  const median = mins.length ? mins[Math.floor(mins.length / 2)] : null

  // WHAT GUESTS SAY ANYWAY — low reviews in the last 90 days, by theme, with the words.
  const since90 = new Date(Date.now() - 90 * 86400000).toISOString()
  const { data: revs } = await db.from('guesty_reviews').select('id, listing_id, rating, content, channel, created_at').gte('created_at', since90).not('content', 'is', null).order('created_at', { ascending: false }).limit(1500)
  const low = ((revs || []) as any[]).filter(r => { const n = Number(r.rating); return Number.isFinite(n) && (n <= 3 || (n > 5 && n <= 6)) })
  const themeCounts: Record<string, { label: string; count: number; quotes: string[] }> = {}
  for (const r of low) {
    const text = str(r.content)
    for (const th of THEMES) {
      if (!th.re.test(text)) continue
      const slot = themeCounts[th.key] || (themeCounts[th.key] = { label: th.label, count: 0, quotes: [] })
      slot.count++
      if (slot.quotes.length < 6) { const m = text.match(new RegExp('[^.!?]*' + th.re.source + '[^.!?]*[.!?]?', 'i')); slot.quotes.push(norm(m ? m[0] : text).slice(0, 180)) }
    }
  }
  const themes = Object.values(themeCounts).sort((a, b) => b.count - a.count)

  return NextResponse.json({
    ok: true, name, days, sampled: sample.length, fetched, failed, units: byUnit.size, completedInWindow: done.length,
    minutes: { median, n: mins.length, p25: mins.length ? mins[Math.floor(mins.length * 0.25)] : null, p75: mins.length ? mins[Math.floor(mins.length * 0.75)] : null },
    lines: lineRows, tasks: taskRows,
    reviews: { lowCount: low.length, total: (revs || []).length, themes },
  })
}
