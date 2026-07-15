// Push staged cleaner assignments to Breezeway. Body { items: [{ listingId, date, assigneeIds:[], description? }] }.
// For each item we resolve the auto-created DEPARTURE clean (reference_property_id = Guesty listing id,
// scheduled_date = checkout date), set its assignment AND write the door code + notes into the task
// description so the cleaner sees them. Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { breezewayConfigured, listPropertyHousekeeping, pickDepartureClean, updateBreezewayTask, retrieveBreezewayTask, mapBreezewayTask } from '@/lib/breezeway'
import { supabaseAdmin } from '@/lib/supabase-admin'

// STAY INTEL: recent negative guest feedback + derived things-to-check, appended to the Breezeway
// task description on Push so the cleaner sees it. Recomputed each push (delimited) = idempotent.
const INTEL_LOW = 3
const INTEL_DAYS = 180
const INTEL_CHECK_MAP: { keys: string[]; item: string }[] = [
  { keys: ['clean', 'dirty', 'dust', 'hair', 'stain', 'sticky', 'grime'], item: 'Deep-clean: floors, surfaces, bathroom, kitchen, linens' },
  { keys: ['ac ', 'a/c', 'air condition', 'too hot', 'too cold', 'temperature', 'thermostat'], item: 'Verify A/C cools; check filter and thermostat' },
  { keys: ['smell', 'odor', 'odour', 'musty', 'mold', 'mildew'], item: 'Check odors: trash, drains, fridge, HVAC, damp areas' },
  { keys: ['noise', 'loud', 'noisy'], item: 'Check noise: appliances, HVAC, doors' },
  { keys: ['broke', 'broken', 'leak', 'repair', 'maintenance', 'not work', 'malfunction'], item: 'Maintenance sweep: plumbing, fixtures, electronics, locks' },
  { keys: ['towel', 'sheet', 'linen', 'amenit', 'soap', 'shampoo', 'coffee', 'supplies', 'restock'], item: 'Restock: linens, towels, toiletries, coffee, paper goods' },
  { keys: ['wifi', 'wi-fi', 'internet', 'tv ', 'remote', 'streaming'], item: 'Test Wi-Fi and TV / streaming logins' },
  { keys: ['key', 'lock', 'code', 'access', 'door', 'fob', 'entry'], item: 'Verify entry: door code, lock, fob, building access' },
  { keys: ['bug', 'pest', 'roach', 'ant ', 'insect'], item: 'Pest check: kitchen, bathroom, baseboards' },
  { keys: ['parking', 'garage'], item: 'Confirm parking / garage access instructions' },
]
function _intelDaysAgo(n: number): string { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString() }
async function buildIntelBlock(listingId: string): Promise<string | null> {
  try {
    const db = supabaseAdmin()
    const { data: reviews } = await db.from('guesty_reviews').select('rating,content,created_at').eq('listing_id', listingId).order('created_at', { ascending: false }).limit(40)
    const revs = (reviews || []) as any[]
    const since = _intelDaysAgo(INTEL_DAYS)
    const low = revs.filter((r) => Number(r.rating) > 0 && Number(r.rating) <= INTEL_LOW && String(r.created_at || '') >= since)
    if (!low.length) return null
    const worst = low[0]
    const blob = low.map((r) => String(r.content || '')).join(' ').toLowerCase()
    const checks: string[] = []
    for (const m of INTEL_CHECK_MAP) if (m.keys.some((k) => blob.includes(k))) checks.push(m.item)
    if (!checks.length) checks.push('Walk every room: cleanliness, damage, missing items')
    const excerpt = String(worst.content || '').replace(/\s+/g, ' ').trim().slice(0, 220)
    const when = String(worst.created_at || '').slice(0, 10)
    const lines = ['--- STAY INTEL (recent guest feedback) ---', 'Flag: ' + (worst.rating || '?') + '-star' + (when ? ' on ' + when : '') + (excerpt ? ' - "' + excerpt + '"' : ''), 'Check this turn:']
    for (const c of checks.slice(0, 4)) lines.push('- ' + c)
    lines.push('--- end intel ---')
    return lines.join('\n')
  } catch (e) { console.error('assign: buildIntelBlock failed', e); return null }
}

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
    const description = typeof it?.description === 'string' ? it.description.slice(0, 1000) : ''
    const sdt = it?.sameDayTurn === true
    const knownTaskId = String(it?.taskId || '').trim()
    if (!listingId || !date) { results.push({ listingId, date, ok: false, error: 'missing listingId/date' }); continue }
    try {
      // Resolve the task: trust a known taskId first (a MOVED clean lives on another date and
      // never resolves by property+date), else look up the departure clean for the date.
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
      if (!clean || !clean.id) { results.push({ listingId, date, ok: false, error: 'No departure clean found in Breezeway for that date yet.' }); continue }
      // assignments REPLACES the task's assignees (override, not append). name is sent because the
      // Breezeway update treats it as required; re-pushing a different cleaner swaps the assignment.
      let intelBlock: string | null = null
      try { intelBlock = await buildIntelBlock(listingId) } catch (e) { console.error('assign: intel failed', e) }
      const composed = [description, intelBlock].filter(Boolean).join('\n\n').slice(0, 1800)
      const payload: Record<string, any> = { assignments: assigneeIds }
      const baseName = clean.name || 'Clean'; payload.name = (sdt && !baseName.includes('SAME-DAY TURN')) ? (baseName + '  ⚠ SAME-DAY TURN') : baseName
      if (composed) payload.description = composed
      const r = await updateBreezewayTask(clean.id, payload)
      if (!r.ok) { results.push({ listingId, date, ok: false, taskId: clean.id, error: `Breezeway ${r.status}: ${r.text.slice(0, 140)}` }); continue }
            try {
        const _fresh = await retrieveBreezewayTask(clean.id)
        const _ft: any = _fresh && (_fresh as any).data
        if (_ft && _ft.id) {
          const _mapped: any = mapBreezewayTask(_ft)
          const _rp = parseFloat(String(_mapped.rate_paid ?? '').replace(/[^0-9.]/g, ''))
          await supabaseAdmin().from('breezeway_tasks_sync').upsert({ ..._mapped, rate_paid: Number.isFinite(_rp) ? _rp : null, reference_property_id: _mapped.reference_property_id || listingId, synced_at: new Date().toISOString() }, { onConflict: 'id' })
        }
      } catch (e) { console.error('assign: mirror upsert failed', e) }
      try { await supabaseAdmin().from('schedule_staged').delete().eq('listing_id', listingId).eq('date', date) } catch (e) { console.error('assign: staged clear failed', e) }
      let descriptionSaved: boolean | null = null
      if (composed) { try { const chk = await retrieveBreezewayTask(clean.id); const live = String(chk?.data?.description || ''); descriptionSaved = live.includes(composed.slice(0, 24)) } catch { descriptionSaved = null } }
      results.push({ listingId, date, ok: true, taskId: clean.id, descriptionSaved } as any)
    } catch (e: any) {
      results.push({ listingId, date, ok: false, error: String(e?.message || e).slice(0, 140) })
    }
  }
  const pushed = results.filter(r => r.ok).length
  // Bust the schedule cache so the next load reflects the fresh assignment right away.
  if (pushed > 0) { try { revalidateTag('schedule') } catch (e) { console.error('assign: revalidateTag failed', e) } }
  return NextResponse.json({ ok: true, pushed, failed: results.length - pushed, results })
}
