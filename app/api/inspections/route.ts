// INSPECTIONS — the coordinator's own record of what a unit looked like, and who cleaned it.
// Deliberately NOT a Breezeway task: most of what he sees is a coaching note, not a work order.
// A task is one click away from the row if something needs fixing.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting, setSetting } from '@/lib/app-settings'

// An inspection that turns into a Breezeway task should SHOW that it did, otherwise the same note
// gets raised twice. The link lives in app_settings rather than a new column so this needed no
// migration: { inspectionId: { taskId, at } }.
const LINK_KEY = 'inspection_tasks'
type LinkMap = Record<string, { taskId: string; at: string }>

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(s: string, n: number) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }

export async function GET(req: NextRequest) {
  const g = await requireLevel('inspections', 'view')
  if (!g.ok) return g.res
  const sp = req.nextUrl.searchParams
  const days = Math.min(Math.max(Number(sp.get('days') || 30), 1), 730)
  const q = str(sp.get('q')).trim().toLowerCase()
  const cleaner = str(sp.get('cleaner')).trim()
  const db = supabaseAdmin()
  const from = addDays(ymd(new Date()), -days)
  try {
    let query = db.from('unit_inspections').select('*').gte('inspected_on', from)
      .order('inspected_on', { ascending: false }).order('created_at', { ascending: false }).limit(1000)
    if (cleaner) query = query.eq('cleaner', cleaner)
    const { data, error } = await query
    // The table only exists after migration 014 — say so plainly instead of throwing a 500.
    if (error) return NextResponse.json({ ok: false, needsMigration: /relation|does not exist/i.test(error.message), error: error.message }, { status: 200 })
    let rows = (data || []) as any[]
    if (q) rows = rows.filter(r => (str(r.unit) + ' ' + str(r.cleaner) + ' ' + str(r.notes) + ' ' + str(r.inspector)).toLowerCase().includes(q))
    const unit = str(sp.get('unit')).trim().toLowerCase()
    if (unit) rows = rows.filter(r => str(r.unit).toLowerCase() === unit)
    const links = await getSetting<LinkMap>(LINK_KEY, {})
    rows = rows.map(r => ({ ...r, taskId: (links[String(r.id)] || {}).taskId || null, actionedAt: (links[String(r.id)] || {}).at || null }))
    // Who gets talked about most, and how they score — the training view.
    const byCleaner: Record<string, { name: string; n: number; sum: number; rated: number; followUps: number }> = {}
    for (const r of rows) {
      const name = str(r.cleaner).trim(); if (!name) continue
      const e = byCleaner[name] = byCleaner[name] || { name, n: 0, sum: 0, rated: 0, followUps: 0 }
      e.n++
      if (r.rating != null) { e.sum += Number(r.rating); e.rated++ }
      if (r.follow_up) e.followUps++
    }
    return NextResponse.json({
      ok: true, days, rows,
      cleaners: Object.values(byCleaner)
        .map(e => ({ name: e.name, inspections: e.n, avg: e.rated ? Math.round((e.sum / e.rated) * 10) / 10 : null, followUps: e.followUps }))
        .sort((a, b) => (a.avg ?? 9) - (b.avg ?? 9) || b.inspections - a.inspections),
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('inspections', 'edit')
  if (!g.ok) return g.res
  const access = g.access
  const b = await req.json().catch(() => ({}))
  const unit = str(b.unit).trim()
  const notes = str(b.notes).trim()
  if (!unit) return NextResponse.json({ ok: false, error: 'Which unit?' }, { status: 400 })
  if (!notes) return NextResponse.json({ ok: false, error: 'Write what you found.' }, { status: 400 })
  const rating = b.rating == null || b.rating === '' ? null : Math.max(1, Math.min(5, Number(b.rating)))
  const db = supabaseAdmin()
  const row = {
    listing_id: str(b.listingId) || null,
    unit,
    inspected_on: /^\d{4}-\d{2}-\d{2}$/.test(str(b.date)) ? str(b.date) : ymd(new Date()),
    inspector: str(b.inspector) || str((access.profile || {}).name) || str(access.email) || null,
    cleaner: str(b.cleaner).trim() || null,
    rating: Number.isFinite(rating as any) ? rating : null,
    notes: notes.slice(0, 4000),
    follow_up: !!b.followUp,
    created_by: str(access.email) || null,
  }
  const { data, error } = await db.from('unit_inspections').insert(row).select('*').maybeSingle()
  if (error) return NextResponse.json({ ok: false, needsMigration: /relation|does not exist/i.test(error.message), error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, row: data })
}

// Record that a task was raised off the back of an inspection.
export async function PATCH(req: NextRequest) {
  const g = await requireLevel('inspections', 'edit')
  if (!g.ok) return g.res
  const access = g.access
  const b = await req.json().catch(() => ({}))
  const id = str(b.id), taskId = str(b.taskId)
  if (!id || !taskId) return NextResponse.json({ ok: false, error: 'id and taskId required' }, { status: 400 })
  const links = await getSetting<LinkMap>(LINK_KEY, {})
  links[id] = { taskId, at: new Date().toISOString() }
  const r = await setSetting(LINK_KEY, links, str(access.email) || 'app')
  return NextResponse.json({ ok: !!r.ok, error: r.error })
}

export async function DELETE(req: NextRequest) {
  const g = await requireLevel('inspections', 'full')
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({}))
  // Deletes are password-gated everywhere else in this app; inspections are no different.
  const { adminPasswordOk } = await import('@/lib/shareAuth')
  const gate = await adminPasswordOk(str(b.password))
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.reason || 'Wrong admin password' }, { status: 403 })
  const id = str(b.id)
  if (!id) return NextResponse.json({ ok: false, error: 'no id' }, { status: 400 })
  const { error } = await supabaseAdmin().from('unit_inspections').delete().eq('id', id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
