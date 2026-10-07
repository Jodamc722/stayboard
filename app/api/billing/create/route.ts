// ADD A TASK FROM BILLABLE HOURS (Jon, 2026-08 → 2026-10-07: "add task, date them, assign them and
// add photo directly from here, push to Breezeway and if can't, that's ok … I should still be able to
// create a task, and I should generate an owner-viewable link to the task with photos and a
// description … and I can add a value to it as well").
//
// GET                         → { units, people } for the form
// POST { action:'create', listingId, name, description, department, date, assigneeId, amount, photos }
//        Tries Breezeway first (with the assignee; photos follow as a comment, the only way its API
//        takes them). If Breezeway says no, the task is kept in Lighthouse (lib/task-extras, 'lh-' id)
//        and the reply says why — it shows on the board with a Retry. Either way the amount bills
//        through billing_adjustments and the photos ride in task_extras.
// POST { action:'push', id }  → retry a Lighthouse-only task in Breezeway; its money and photos move
// POST { action:'photos', id, photos, ownerNote? } → set a task's photos / owner-facing description
// POST { action:'share', id } → the owner link (/job/<token>), made once and reused
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createBreezewayTask, mapBreezewayTask, breezewayConfigured, breezewayPeopleLite, createBreezewayComment, completeBreezewayTask } from '@/lib/breezeway'
import { refreshFromBreezeway } from '@/lib/breezeway-refresh'
import { getSetting } from '@/lib/app-settings'
import { bustBoards } from '@/lib/bust'
import { readLocalTasks, writeLocalTasks, readExtras, writeExtras, newToken, type LocalTask } from '@/lib/task-extras'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DEPTS = ['maintenance', 'housekeeping', 'inspection', 'safety']
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
const cleanPhotos = (v: any): string[] => (Array.isArray(v) ? v : []).map((u: any) => String(u || '').trim()).filter((u: string) => /^https:\/\/\S+$/.test(u) && u.length < 600).slice(0, 12)

export async function GET() {
  const gate = await requireLevel('billing', 'view')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const [{ data: ls }, people] = await Promise.all([
    db.from('guesty_listings').select('id,nickname,title,active:raw->>active').limit(1000), // one row per listing, ~290
    breezewayConfigured() ? breezewayPeopleLite().catch(() => []) : Promise.resolve([]),
  ])
  const units = ((ls || []) as any[]).filter(l => String(l.active) !== 'false')
    .map(l => ({ id: String(l.id), name: String(l.nickname || l.title || l.id) })).sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json({ ok: true, units, people: (people as any[]).map(p => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)) })
}

/** Create in Breezeway and mirror it. Returns the new id, or the reason it could not. */
async function toBreezeway(db: any, t: { listingId: string; name: string; description: string; department: string; date: string | null; assigneeId: number | null; done?: boolean }, photos: string[]): Promise<{ id: string | null; error: string | null; completed?: boolean }> {
  if (!breezewayConfigured()) return { id: null, error: 'Breezeway is not configured' }
  try {
    const { data: prop } = await db.from('breezeway_properties').select('home_id').eq('reference_property_id', t.listingId).limit(1)
    const homeId = Number((prop || [])[0]?.home_id)
    const payload: Record<string, any> = { name: t.name, type_department: t.department }
    if (Number.isFinite(homeId)) payload.home_id = homeId
    else payload.reference_property_id = t.listingId
    if (t.date) payload.scheduled_date = t.date
    if (t.description) payload.description = t.description
    if (t.assigneeId) payload.assignments = [t.assigneeId]
    const r = await createBreezewayTask(payload)
    const id = r.ok && r.data ? String(r.data?.id || '') : ''
    if (!id) return { id: null, error: `Breezeway ${r.status}: ${String(r.text || 'no task id').slice(0, 160)}` }
    try {
      const m: any = mapBreezewayTask(r.data)
      if (m?.id) {
        const rp = Number(m.rate_paid); m.rate_paid = Number.isFinite(rp) ? rp : null
        m.home_id = Number.isFinite(homeId) ? homeId : m.home_id
        m.reference_property_id = t.listingId
        m.synced_at = new Date().toISOString()
        await db.from('breezeway_tasks_sync').upsert(m, { onConflict: 'id' })
        bustBoards()
      }
      await db.from('breezeway_billing_details').upsert({ task_id: id, bill_to: r.data?.bill_to ? String(r.data.bill_to) : null, rate_type: r.data?.rate_type ? String(r.data.rate_type) : null, costs: [], supplies: [], synced_at: new Date().toISOString() }, { onConflict: 'task_id' })
    } catch { /* mirror catches up on the next sync */ }
    // Photos: Breezeway's API takes no uploads, so they go on as a comment with the links.
    if (photos.length) { try { await createBreezewayComment(id, 'Photos from Lighthouse:\n' + photos.join('\n')) } catch { /* the photos stay in Lighthouse */ } }
    // ALREADY DONE (Jon, 2026-10-07: "it needs to be a completed task"). Work logged after the
    // fact is finished the moment it is written down; a task left open is flagged "not finished"
    // on the billing desk and its money waits behind a status nobody is going to change. Complete
    // it, then re-read the task so the mirror carries Breezeway's own status and finished time
    // rather than our guess at them.
    let completed = false
    if (t.done) {
      try {
        const c = await completeBreezewayTask(id)
        completed = !!c.ok
        await refreshFromBreezeway(db, id)
      } catch { /* it stays open; the desk can finish it in Breezeway */ }
    }
    return { id, error: null, completed }
  } catch (e: any) { return { id: null, error: String(e?.message || e).slice(0, 200) } }
}

async function billIt(db: any, id: string, amount: number, by: string | null) {
  const def = await getSetting<{ rate: number }>('billing_default_rate', { rate: 40 })
  const chargeRate = Number(def?.rate) > 0 ? Number(def.rate) : 40
  return db.from('billing_adjustments').upsert({
    task_id: id, excluded: false, note: 'Added from Billable Hours',
    override_amount: Math.round(amount * 100) / 100, billed_hours: Math.round((amount / chargeRate) * 100) / 100,
    extra_items: [], item_overrides: {}, updated_by: by, updated_at: new Date().toISOString(),
  }, { onConflict: 'task_id' })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('billing', 'edit')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const by = gate.access.email || null
  const body = await req.json().catch(() => ({} as any))
  const action = String(body?.action || 'create')

  if (action === 'share') {
    const id = String(body?.id || ''); if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    const ex = await readExtras()
    const cur = ex[id] || { photos: [] }
    if (!cur.token) { cur.token = newToken(); ex[id] = cur; const s = await writeExtras(ex, by); if (!s.ok) return NextResponse.json({ ok: false, error: s.error }, { status: 500 }) }
    return NextResponse.json({ ok: true, url: APP_URL + '/job/' + cur.token, token: cur.token })
  }

  if (action === 'photos') {
    const id = String(body?.id || ''); if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    const ex = await readExtras()
    const cur = ex[id] || { photos: [] }
    const before = new Set(cur.photos || [])
    cur.photos = cleanPhotos(body?.photos)
    if (body?.ownerNote !== undefined) cur.ownerNote = String(body.ownerNote || '').slice(0, 2000) || null
    ex[id] = cur
    const s = await writeExtras(ex, by)
    if (!s.ok) return NextResponse.json({ ok: false, error: s.error }, { status: 500 })
    // New photos on a Breezeway task go to it as a comment too.
    const added = cur.photos.filter(u => !before.has(u))
    if (added.length && !id.startsWith('lh-') && breezewayConfigured()) { try { await createBreezewayComment(id, 'Photos from Lighthouse:\n' + added.join('\n')) } catch { /* fine */ } }
    return NextResponse.json({ ok: true, photos: cur.photos, ownerNote: cur.ownerNote ?? null })
  }

  if (action === 'push') {
    const id = String(body?.id || '')
    const local = await readLocalTasks()
    const t = local.find(x => x.id === id)
    if (!t) return NextResponse.json({ ok: false, error: 'That task is already in Breezeway (or gone).' }, { status: 404 })
    const ex = await readExtras()
    const r = await toBreezeway(db, { ...t, done: t.done !== false }, ex[id]?.photos || [])
    if (!r.id) {
      t.pushError = r.error; await writeLocalTasks(local, by)
      return NextResponse.json({ ok: false, error: 'Breezeway still says no — ' + r.error })
    }
    // Move what Lighthouse held for it onto the Breezeway id: the money, the photos, the link.
    try {
      const { data: adj } = await db.from('billing_adjustments').select('*').eq('task_id', id).limit(1)
      if (adj && adj[0]) { await db.from('billing_adjustments').upsert({ ...(adj[0] as any), task_id: r.id }, { onConflict: 'task_id' }); await db.from('billing_adjustments').delete().eq('task_id', id) }
    } catch { /* the amount can be re-entered */ }
    if (ex[id]) { ex[r.id] = ex[id]; delete ex[id]; await writeExtras(ex, by) }
    await writeLocalTasks(local.filter(x => x.id !== id), by)
    return NextResponse.json({ ok: true, id: r.id })
  }

  // ── create ──
  const listingId = String(body?.listingId || '').trim()
  const name = String(body?.name || '').trim().slice(0, 200)
  const department = DEPTS.includes(String(body?.department || '')) ? String(body.department) : 'maintenance'
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.date || '')) ? String(body.date) : null
  const amount = Number(body?.amount)
  const description = typeof body?.description === 'string' ? body.description.slice(0, 4000) : ''
  const assigneeId = Number(body?.assigneeId) || null
  const assigneeName = String(body?.assigneeName || '').slice(0, 80) || null
  const photos = cleanPhotos(body?.photos)
  // Default TRUE: this box exists to write down work that has already happened and bill it.
  const done = body?.done === undefined ? true : body.done !== false
  if (!listingId || !name) return NextResponse.json({ ok: false, error: 'Unit and title are required.' }, { status: 400 })

  const draft = { listingId, name, description, department, date, assigneeId, done }
  const bz = await toBreezeway(db, draft, photos)
  let id = bz.id
  if (!id) {
    // Breezeway would not take it — keep it in Lighthouse.
    const { data: l } = await db.from('guesty_listings').select('nickname,title').eq('id', listingId).limit(1)
    const unit = l && l[0] ? String((l[0] as any).nickname || (l[0] as any).title || '') : null
    const local = await readLocalTasks()
    const t: LocalTask = { id: 'lh-' + randomUUID().slice(0, 12), listingId, unit, name, description, department, date: date || new Date().toISOString().slice(0, 10), assigneeId, assigneeName, createdBy: by || 'someone', createdAt: new Date().toISOString(), pushError: bz.error, done, finishedAt: done ? ((date || new Date().toISOString().slice(0, 10)) + 'T12:00:00Z') : null }
    local.push(t)
    const s = await writeLocalTasks(local, by)
    if (!s.ok) return NextResponse.json({ ok: false, error: 'Could not save the task: ' + s.error }, { status: 500 })
    id = t.id
  }
  const warnings: string[] = []
  if (Number.isFinite(amount) && amount > 0) { const { error } = await billIt(db, id, amount, by); if (error) warnings.push('the amount did not save: ' + error.message) }
  // Photos and a share link from the start, so the owner link is ready to send.
  const ex = await readExtras()
  ex[id] = { ...(ex[id] || { photos: [] }), photos, token: ex[id]?.token || newToken() }
  await writeExtras(ex, by)
  return NextResponse.json({
    ok: true, id, inBreezeway: !!bz.id, breezewayError: bz.id ? null : bz.error,
    done, completedInBreezeway: !!bz.completed,
    ownerUrl: APP_URL + '/job/' + ex[id].token,
    warning: warnings.join('; ') || undefined,
  })
}
