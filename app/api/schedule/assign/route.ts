// Push staged cleaner assignments to Breezeway. Body { items: [{ listingId, date, assigneeIds:[], description? }] }.
// For each item we resolve the auto-created DEPARTURE clean (reference_property_id = Guesty listing id,
// scheduled_date = checkout date), set its assignment AND write the door code + notes into the task
// description so the cleaner sees them. Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { breezewayConfigured, listPropertyHousekeeping, pickDepartureClean, updateBreezewayTask, retrieveBreezewayTask } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured.' }, { status: 503 })

  const body = await req.json().catch(() => ({} as any))
  const items = Array.isArray(body?.items) ? body.items.slice(0, 80) : []
  if (!items.length) return NextResponse.json({ error: 'No assignments to push.' }, { status: 400 })

  const results: { listingId: string; date: string; ok: boolean; taskId?: string; error?: string }[] = []
  for (const it of items) {
    const listingId = String(it?.listingId || '').trim()
    const date = String(it?.date || '').slice(0, 10)
    const assigneeIds = (Array.isArray(it?.assigneeIds) ? it.assigneeIds : []).map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n))
    const description = typeof it?.description === 'string' ? it.description.slice(0, 1500) : ''
    if (!listingId || !date) { results.push({ listingId, date, ok: false, error: 'missing listingId/date' }); continue }
    try {
      const tasks = await listPropertyHousekeeping(listingId, date, date)
      const clean = pickDepartureClean(tasks, date)
      if (!clean || !clean.id) { results.push({ listingId, date, ok: false, error: 'No departure clean found in Breezeway for that date yet.' }); continue }
      // assignments REPLACES the task's assignees (override, not append). name is sent because the
      // Breezeway update treats it as required; re-pushing a different cleaner swaps the assignment.
      const payload: Record<string, any> = { assignments: assigneeIds }
      payload.name = clean.name || 'Clean'
      if (description) payload.description = description
      const r = await updateBreezewayTask(clean.id, payload)
      if (!r.ok) { results.push({ listingId, date, ok: false, taskId: clean.id, error: `Breezeway ${r.status}: ${r.text.slice(0, 140)}` }); continue }
      let descriptionSaved: boolean | null = null
      if (description) { try { const chk = await retrieveBreezewayTask(clean.id); const live = String(chk?.data?.description || ''); descriptionSaved = live.includes(description.slice(0, 24)) } catch { descriptionSaved = null } }
      results.push({ listingId, date, ok: true, taskId: clean.id, descriptionSaved })
    } catch (e: any) {
      results.push({ listingId, date, ok: false, error: String(e?.message || e).slice(0, 140) })
    }
  }
  const pushed = results.filter(r => r.ok).length
  return NextResponse.json({ ok: true, pushed, failed: results.length - pushed, results })
}
