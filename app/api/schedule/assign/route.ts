// Push staged cleaner assignments to Breezeway. Body { items: [{ listingId, date, assigneeIds:[], description? }] }.
// For each item we resolve the auto-created DEPARTURE clean (reference_property_id = Guesty listing id,
// scheduled_date = checkout date), set its assignment AND write the door code + notes into the task
// description so the cleaner sees them. Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { breezewayConfigured, listPropertyHousekeeping, pickDepartureClean, updateBreezewayTask, retrieveBreezewayTask, mapBreezewayTask } from '@/lib/breezeway'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loadIntel, renderIntel, INTEL_STRIP_RE, type IntelCtx } from '@/lib/listingIntel'

// STAY INTEL now lives in lib/listingIntel.ts and is written FOR THE CLEANER: the deadline, how
// long the stay that just ended was, what guests keep saying about this unit, and what the last
// inspection found. It used to be a generic "recent guest feedback" paragraph built from a review
// query fired once per unit inside the push loop — a 40-unit push meant 40 queries. The context is
// now loaded once for the whole push and rendered per task.

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
  // ONE context load for the whole push. Best-effort: if it fails, the push still happens, just
  // without the intel block — an assignment that reaches the cleaner beats a perfect note that does not.
  let intelCtx: IntelCtx | null = null
  try {
    const pushIds = items.map((it: any) => String(it?.listingId || '').trim()).filter(Boolean)
    const pushDate = String((items[0] && items[0].date) || '').slice(0, 10)
    intelCtx = await loadIntel(pushIds, pushDate)
  } catch (e) { console.error('assign: loadIntel failed', e) }
  // Our block is wrapped in [STAY SCHEDULE]...[/STAY SCHEDULE]; everything outside it (manual NOTEs,
  // Breezeway edits) is PRESERVED across pushes. Re-push replaces only our block = idempotent.
  async function handleItem(it: any) {
    const listingId = String(it?.listingId || '').trim()
    const date = String(it?.date || '').slice(0, 10)
    const assigneeIds = (Array.isArray(it?.assigneeIds) ? it.assigneeIds : []).map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n))
    const description = typeof it?.description === 'string' ? it.description.slice(0, 1000) : ''
    const sdt = it?.sameDayTurn === true
    const knownTaskId = String(it?.taskId || '').trim()
    if (!listingId || !date) { results.push({ listingId, date, ok: false, error: 'missing listingId/date' }); return }
    try {
      let clean: any = null
      if (knownTaskId) {
        const cur = await retrieveBreezewayTask(knownTaskId)
        const ct: any = cur && (cur as any).data
        if (ct && ct.id) clean = ct
      }
      if (!clean) {
        const tasks = await listPropertyHousekeeping(listingId, date, date)
        clean = pickDepartureClean(tasks, date)
      }
      if (!clean || !clean.id) { results.push({ listingId, date, ok: false, error: 'No departure clean found in Breezeway for that date yet.' }); return }
      let intelBlock: string | null = null
      // Rendered against THIS row's date — one push can span several days, and the deadline line is
      // the whole point of the block.
      try { if (intelCtx) intelBlock = renderIntel({ ...intelCtx, date }, listingId, 'clean') } catch (e) { console.error('assign: intel failed', e) }
      const composed = [description, intelBlock].filter(Boolean).join('\n\n').slice(0, 2200)
      const currentDesc = String((clean.description ?? clean.raw?.description) || '')
      const foreign = currentDesc.replace(/\[STAY SCHEDULE\][\s\S]*?\[\/STAY SCHEDULE\]/g, '').replace(INTEL_STRIP_RE, '').trim()
      const envelope = '[STAY SCHEDULE]\n' + composed + '\n[/STAY SCHEDULE]'
      const finalDesc = ((foreign ? foreign + '\n\n' : '') + envelope).slice(0, 3500)
      const payload: Record<string, any> = { assignments: assigneeIds }
      const baseName = String(clean.name || 'Clean').replace(/\s*⚠ SAME-DAY TURN\s*$/, '').trimEnd()
      payload.name = sdt ? (baseName + '  ⚠ SAME-DAY TURN') : baseName
      if (composed) payload.description = finalDesc
      const r = await updateBreezewayTask(clean.id, payload)
      if (!r.ok) { results.push({ listingId, date, ok: false, taskId: clean.id, error: 'Breezeway ' + r.status + ': ' + r.text.slice(0, 140) }); return }
      let descriptionSaved: boolean | null = null
      try {
        const _fresh = await retrieveBreezewayTask(clean.id)
        const _ft: any = _fresh && (_fresh as any).data
        if (_ft && _ft.id) {
          if (composed) descriptionSaved = String(_ft.description || '').includes(composed.slice(0, 24))
          const _mapped: any = mapBreezewayTask(_ft)
          const _rp = parseFloat(String(_mapped.rate_paid ?? '').replace(/[^0-9.]/g, ''))
          await supabaseAdmin().from('breezeway_tasks_sync').upsert({ ..._mapped, rate_paid: Number.isFinite(_rp) ? _rp : null, reference_property_id: _mapped.reference_property_id || listingId, synced_at: new Date().toISOString() }, { onConflict: 'id' })
        }
      } catch (e) { console.error('assign: mirror upsert failed', e) }
      try { await supabaseAdmin().from('schedule_staged').delete().eq('listing_id', listingId).eq('date', date) } catch (e) { console.error('assign: staged clear failed', e) }
      results.push({ listingId, date, ok: true, taskId: clean.id, descriptionSaved } as any)
    } catch (e: any) {
      results.push({ listingId, date, ok: false, error: String(e?.message || e).slice(0, 140) })
    }
  }
  const CONC = 6
  for (let i = 0; i < items.length; i += CONC) { await Promise.all(items.slice(i, i + CONC).map(handleItem)) }
  const pushed = results.filter(r => r.ok).length
  // Bust the schedule cache so the next load reflects the fresh assignment right away.
  if (pushed > 0) { try { revalidateTag('schedule') } catch (e) { console.error('assign: revalidateTag failed', e) } }
  return NextResponse.json({ ok: true, pushed, failed: results.length - pushed, results })
}
