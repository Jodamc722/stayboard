// CLEANLINESS FROM AUDITS -> OPS. Every 'clean' finding a walk produced that is not finished yet,
// grouped by unit, with its live Breezeway status attached.
//
// Fix and replace findings already had somewhere to land (the field worklist, the order desk).
// Cleanliness did not: a stain flagged on a walk sat in the audit and nobody on the floor saw it.
// This is the feed behind the Today-in-Ops panel, so housekeeping work found on a walk shows up on
// the same board the team already works from.
//
// Dispatching is NOT done here — the panel posts the chosen item ids to /api/audit/task, which is
// the one place Breezeway tasks are created (single standardized brief, no second code path).
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Row = { id: string; room: string | null; title: string | null; note: string | null; severity: string | null; status: string; photo_url: string | null; report_url: string | null; breezeway_task_id: string | null; created_at: string; taskStatus: string | null }

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = supabaseAdmin()

  const { data: items, error } = await db.from('audit_items')
    .select('id,listing_id,room,title,note,severity,status,photo_url,report_url,breezeway_task_id,created_at')
    .eq('kind', 'clean').in('status', ['open', 'task_created'])
    .order('created_at', { ascending: false }).limit(600)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = items || []
  if (!rows.length) return NextResponse.json({ ok: true, units: [], open: 0, dispatched: 0 })

  // Live Breezeway status from the mirror, so a task the team already finished drops off the board
  // instead of nagging. Mirror is optional — without it everything just reads as dispatched.
  const tmap: Record<string, string> = {}
  try {
    const ids = rows.map((x: any) => x.breezeway_task_id).filter(Boolean)
    if (ids.length) {
      const { data: tasks } = await db.from('breezeway_tasks_sync').select('id,status,started_at,finished_at').in('id', ids)
      for (const t of tasks || []) tmap[String(t.id)] = t.finished_at ? 'completed' : (t.started_at ? 'in_progress' : String(t.status || 'created'))
    }
  } catch { /* mirror optional */ }

  const lids = Array.from(new Set(rows.map((x: any) => String(x.listing_id || '')).filter(Boolean)))
  const lm: Record<string, { name: string; building: string }> = {}
  try {
    const { data: ls } = await db.from('guesty_listings').select('id,nickname,title,building').in('id', lids.slice(0, 400))
    for (const l of ls || []) lm[String(l.id)] = { name: l.nickname || l.title || 'Unit', building: l.building || '' }
  } catch { /* names are cosmetic */ }

  const groups: Record<string, { listingId: string; unit: string; building: string; items: Row[] }> = {}
  let open = 0
  let dispatched = 0
  for (const x of rows as any[]) {
    const taskStatus = x.breezeway_task_id ? (tmap[String(x.breezeway_task_id)] || 'created') : null
    if (taskStatus === 'completed') continue          // done in the field — nothing left to show
    const lid = String(x.listing_id || '')
    const meta = lm[lid]
    if (!groups[lid]) groups[lid] = { listingId: lid, unit: meta ? meta.name : (lid.indexOf(':') >= 0 ? lid.split(':').slice(1).join(':') : lid), building: meta ? meta.building : '', items: [] }
    groups[lid].items.push({ id: x.id, room: x.room, title: x.title, note: x.note, severity: x.severity, status: x.status, photo_url: x.photo_url, report_url: x.report_url, breezeway_task_id: x.breezeway_task_id, created_at: x.created_at, taskStatus })
    if (x.breezeway_task_id) dispatched++; else open++
  }
  // Units with undispatched work first, then by how much is outstanding — the board should lead
  // with what nobody has picked up.
  const units = Object.keys(groups).map(k => groups[k]).sort((a, b) => {
    const an = a.items.filter(i => !i.breezeway_task_id).length
    const bn = b.items.filter(i => !i.breezeway_task_id).length
    if (an !== bn) return bn - an
    return b.items.length - a.items.length
  })
  return NextResponse.json({ ok: true, units, open, dispatched })
}
