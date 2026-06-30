// Push staged cleaner assignments to Breezeway. Body { items: [{ listingId, date, assigneeIds:[] }] }.
// For each item we resolve the auto-created DEPARTURE clean (reference_property_id = Guesty
// listing id, scheduled_date = checkout date) and set its assignments. Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { breezewayConfigured, listPropertyHousekeeping, pickDepartureClean, updateBreezewayTask } from '@/lib/breezeway'

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

  const results: { listingId: string; date: string; ok: boolean; taskId?: string; assignee?: string; error?: string }[] = []
  for (const it of items) {
    const listingId = String(it?.listingId || '').trim()
    const date = String(it?.date || '').slice(0, 10)
    const assigneeIds = (Array.isArray(it?.assigneeIds) ? it.assigneeIds : []).map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n))
    if (!listingId || !date) { results.push({ listingId, date, ok: false, error: 'missing listingId/date' }); continue }
    try {
      const tasks = await listPropertyHousekeeping(listingId, date, date)
      const clean = pickDepartureClean(tasks, date)
      if (!clean || !clean.id) { results.push({ listingId, date, ok: false, error: 'No departure clean found in Breezeway for that date yet.' }); continue }
      const r = await updateBreezewayTask(clean.id, { assignments: assigneeIds })
      if (!r.ok) { results.push({ listingId, date, ok: false, taskId: clean.id, error: `Breezeway ${r.status}: ${r.text.slice(0, 140)}` }); continue }
      results.push({ listingId, date, ok: true, taskId: clean.id })
    } catch (e: any) {
      results.push({ listingId, date, ok: false, error: String(e?.message || e).slice(0, 140) })
    }
  }
  const pushed = results.filter(r => r.ok).length
  return NextResponse.json({ ok: true, pushed, failed: results.length - pushed, results })
}
