// GARDEN HOTEL TRIGGERS — "when X happens, do Y", as rows a person can edit, over an event inbox
// the sync and the desks write to.
//
// Jon, 2026-09-28: "the garden will do… triggers." Every trigger is: an EVENT (from garden_events),
// CONDITIONS on the subject (a reservation, a review, a room), an ACTION with params. The engine
// runs after every sync and on demand, consumes unprocessed events once, and logs each firing —
// fired / skipped (conditions) / failed — so the Settings → Triggers page can show what happened.
//
// EVENTS (emitted by sync.ts and the desks):
//   reservation_created · reservation_changed · reservation_cancelled · checked_in · checked_out
//   arrival_tomorrow · departure_today · room_dirty · review_received · call_missed · task_done
// ACTIONS:
//   queue_call {kind, hoursFromNow?}   create_task {kind, note, priority?, when: 'today'|'checkout'}
//   slack_post {channel?, text}        adam_note {content, kind?}   mark_verification {kind, status}
//   draft_review_reply {}
// The text params take {{guest}}, {{room}}, {{check_in}}, {{check_out}}, {{nights}}, {{source}},
// {{rating}}, {{body}}.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { getHotel } from './settings'
import { adamRemember } from './adam'
import { etTime } from './call-desk'

export type GardenEvent = 'reservation_created' | 'reservation_changed' | 'reservation_cancelled' | 'checked_in' | 'checked_out' | 'arrival_tomorrow' | 'departure_today' | 'room_dirty' | 'review_received' | 'call_missed' | 'task_done'
export const EVENTS: { key: GardenEvent; label: string }[] = [
  { key: 'reservation_created', label: 'A booking is made' }, { key: 'reservation_changed', label: 'A booking changes' }, { key: 'reservation_cancelled', label: 'A booking is cancelled' },
  { key: 'checked_in', label: 'A guest checks in' }, { key: 'checked_out', label: 'A guest checks out' }, { key: 'arrival_tomorrow', label: 'A guest arrives tomorrow' }, { key: 'departure_today', label: 'A guest leaves today' },
  { key: 'room_dirty', label: 'A room turns dirty' }, { key: 'review_received', label: 'A review comes in' }, { key: 'call_missed', label: 'A call is missed' }, { key: 'task_done', label: 'A task is finished' },
]
export const ACTIONS: { key: string; label: string; params: string }[] = [
  { key: 'queue_call', label: 'Put a call on the desk', params: 'kind: welcome | pre_arrival | verification | post_stay | review_ask · hoursFromNow' },
  { key: 'create_task', label: 'Create a task', params: 'kind: clean | stayover | inspection | deep_clean | maintenance · note · priority · when: today | checkout' },
  { key: 'slack_post', label: 'Post to Slack', params: 'channel (optional) · text with {{guest}} {{room}} {{check_in}}' },
  { key: 'adam_note', label: 'Tell Adam something', params: 'content · kind' },
  { key: 'mark_verification', label: 'Set a verification', params: 'kind: id | card | deposit · status: pending | waived' },
  { key: 'draft_review_reply', label: 'Draft a review reply', params: '(none)' },
]

export async function emitGardenEvent(event: GardenEvent, subjectId: string | null, payload: any = {}): Promise<void> {
  try { await supabaseAdmin().from('garden_events').insert({ event, subject_id: subjectId, payload: payload || {} }) } catch { /* the inbox never blocks the sync */ }
}

/** The triggers that ship. Seeded once (by name) when the table is empty; all editable after. */
export const DEFAULT_TRIGGERS = [
  { name: 'Welcome call before every arrival', event: 'reservation_created', conditions: {}, action: 'queue_call', params: { kind: 'welcome' }, sort: 10 },
  { name: 'ID and card on every OTA booking', event: 'reservation_created', conditions: { source_not: ['direct', 'website'] }, action: 'mark_verification', params: { kind: 'id', status: 'pending' }, sort: 20 },
  { name: 'Cancellation to the desk channel', event: 'reservation_cancelled', conditions: {}, action: 'slack_post', params: { text: 'Cancelled: {{guest}} · {{room}} · {{check_in}} → {{check_out}} ({{source}})' }, sort: 30 },
  { name: 'Inspect after a long stay', event: 'checked_out', conditions: { nights_min: 7 }, action: 'create_task', params: { kind: 'inspection', note: 'After a {{nights}}-night stay', when: 'today' }, sort: 40 },
  { name: 'Draft a reply to every review', event: 'review_received', conditions: {}, action: 'draft_review_reply', params: {}, sort: 50 },
  { name: 'Low review → tell Adam and the desk', event: 'review_received', conditions: { rating_max: 3 }, action: 'slack_post', params: { text: 'Low review ({{rating}}★) from {{guest}}: {{body}}' }, sort: 60 },
  { name: 'Missed call → call back', event: 'call_missed', conditions: {}, action: 'queue_call', params: { kind: 'pre_arrival', hoursFromNow: 1 }, sort: 70 },
]
export async function seedTriggers(by: string): Promise<number> {
  const db = supabaseAdmin()
  const { count } = await db.from('garden_triggers').select('id', { count: 'exact', head: true })
  if (count) return 0
  const { error } = await db.from('garden_triggers').insert(DEFAULT_TRIGGERS.map(t => ({ ...t, created_by: by })))
  return error ? 0 : DEFAULT_TRIGGERS.length
}

// ---- Conditions ----------------------------------------------------------------------------------
function passes(cond: any, subject: any): { ok: boolean; why?: string } {
  const c = cond && typeof cond === 'object' ? cond : {}
  const src = String(subject?.source || '').toLowerCase()
  const inList = (list: any, v: string) => Array.isArray(list) && list.some((x: any) => v.includes(String(x).toLowerCase()))
  if (Array.isArray(c.source_in) && c.source_in.length && !inList(c.source_in, src)) return { ok: false, why: `source ${src || 'direct'} not in list` }
  if (Array.isArray(c.source_not) && c.source_not.length && inList(c.source_not, src || 'direct')) return { ok: false, why: `source ${src || 'direct'} excluded` }
  if (c.nights_min != null && (Number(subject?.nights) || 0) < Number(c.nights_min)) return { ok: false, why: `nights ${subject?.nights} < ${c.nights_min}` }
  if (c.nights_max != null && (Number(subject?.nights) || 0) > Number(c.nights_max)) return { ok: false, why: `nights ${subject?.nights} > ${c.nights_max}` }
  if (c.balance_gt != null && (Number(subject?.balance) || 0) <= Number(c.balance_gt)) return { ok: false, why: 'balance not above limit' }
  if (Array.isArray(c.room_type_in) && c.room_type_in.length && !inList(c.room_type_in, String(subject?.room_type || subject?.room_types || '').toLowerCase())) return { ok: false, why: 'room type not in list' }
  if (c.rating_max != null && subject?.rating != null && Number(subject.rating) > Number(c.rating_max)) return { ok: false, why: `rating ${subject.rating} > ${c.rating_max}` }
  if (c.rating_min != null && subject?.rating != null && Number(subject.rating) < Number(c.rating_min)) return { ok: false, why: `rating ${subject.rating} < ${c.rating_min}` }
  if (Array.isArray(c.kind_in) && c.kind_in.length && !inList(c.kind_in, String(subject?.kind || '').toLowerCase())) return { ok: false, why: 'kind not in list' }
  return { ok: true }
}

const fill = (tpl: string, s: any) => String(tpl || '').replace(/\{\{(\w+)\}\}/g, (_, k) => {
  const v = k === 'room' ? (Array.isArray(s?.room_names) ? s.room_names.join(', ') : s?.room_name) : k === 'guest' ? s?.guest_name : s?.[k]
  return v == null ? '' : String(v)
})

// ---- Actions ---------------------------------------------------------------------------------------
async function perform(action: string, params: any, subject: any, ev: any, by: string): Promise<{ ok: boolean; detail?: any; error?: string }> {
  const db = supabaseAdmin()
  const p = params && typeof params === 'object' ? params : {}
  const resId = subject?.reservation_id || (ev.event.startsWith('reservation') || ['checked_in', 'checked_out', 'arrival_tomorrow', 'departure_today'].includes(ev.event) ? ev.subject_id : null)
  if (action === 'queue_call') {
    if (!resId) return { ok: false, error: 'no reservation' }
    const kind = ['welcome', 'pre_arrival', 'verification', 'post_stay', 'review_ask'].includes(p.kind) ? p.kind : 'pre_arrival'
    const h = await getHotel()
    const res = subject?.check_in ? subject : (await db.from('garden_reservations').select('check_in,check_out').eq('id', resId).maybeSingle()).data
    const due = p.hoursFromNow != null ? new Date(Date.now() + Number(p.hoursFromNow) * 3600000).toISOString()
      : kind === 'welcome' && res?.check_in ? etTime(new Date(Date.parse(res.check_in + 'T12:00:00Z') - h.welcomeCall.daysBefore * 86400000).toISOString().slice(0, 10), `${String(h.welcomeCall.fromHour).padStart(2, '0')}:00`) : new Date().toISOString()
    const window_end = res?.check_in && (kind === 'welcome' || kind === 'pre_arrival' || kind === 'verification') ? etTime(res.check_in, h.checkInTime) : null
    const { error } = await db.from('garden_call_queue').upsert({ reservation_id: resId, kind, due_at: due, window_end }, { onConflict: 'reservation_id,kind', ignoreDuplicates: true })
    return error ? { ok: false, error: error.message } : { ok: true, detail: { kind, due } }
  }
  if (action === 'create_task') {
    const kind = ['clean', 'stayover', 'inspection', 'deep_clean', 'maintenance'].includes(p.kind) ? p.kind : 'inspection'
    const date = p.when === 'checkout' && subject?.check_out ? subject.check_out : new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    const roomId = subject?.room_ids?.[0] || subject?.room_id || null
    const roomName = subject?.room_names?.[0] || subject?.room_name || subject?.name || null
    const { error } = await db.from('garden_tasks').insert({ room_id: roomId, room_name: roomName, date, kind, note: fill(p.note || '', subject) || null, priority: p.priority || null, reservation_id: resId, source: 'auto', created_by: `trigger:${by}` })
    return error ? { ok: false, error: error.message } : { ok: true, detail: { kind, date, roomName } }
  }
  if (action === 'slack_post') {
    const { postToChannel } = await import('../slack')
    const h = await getHotel()
    const channel = p.channel || h.slackChannel
    if (!channel) return { ok: false, error: 'no Slack channel set (Garden settings → Hotel)' }
    const r = await postToChannel(channel, `🏨 ${fill(p.text || ev.event, subject)}`)
    return r.ok ? { ok: true, detail: { channel } } : { ok: false, error: r.error || 'slack failed' }
  }
  if (action === 'adam_note') {
    const id = await adamRemember({ content: fill(p.content || '', subject), kind: p.kind || 'fact', subject: subject?.guest_name || subject?.room_name || 'hotel', source: 'sync', by: `trigger:${by}` })
    return id ? { ok: true } : { ok: false, error: 'nothing to remember' }
  }
  if (action === 'mark_verification') {
    if (!resId) return { ok: false, error: 'no reservation' }
    const kind = ['id', 'card', 'deposit', 'agreement', 'age'].includes(p.kind) ? p.kind : 'id'
    const status = ['pending', 'waived'].includes(p.status) ? p.status : 'pending'
    const { error } = await db.from('garden_verifications').upsert({ reservation_id: resId, kind, status }, { onConflict: 'reservation_id,kind', ignoreDuplicates: true })
    return error ? { ok: false, error: error.message } : { ok: true, detail: { kind, status } }
  }
  if (action === 'draft_review_reply') {
    const { draftReviewReply } = await import('./reviews')
    const r = await draftReviewReply(String(ev.subject_id || ''), 'trigger')
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }
  return { ok: false, error: `unknown action ${action}` }
}

async function subjectFor(ev: any): Promise<any> {
  const db = supabaseAdmin()
  const id = String(ev.subject_id || '')
  if (!id) return ev.payload || {}
  if (ev.event === 'review_received') return (await db.from('garden_reviews').select('*').eq('id', id).maybeSingle()).data || ev.payload || {}
  if (ev.event === 'room_dirty') return (await db.from('garden_rooms').select('*').eq('id', id).maybeSingle()).data || ev.payload || {}
  if (ev.event === 'task_done') return (await db.from('garden_tasks').select('*').eq('id', id).maybeSingle()).data || ev.payload || {}
  if (ev.event === 'call_missed') return { ...(ev.payload || {}), reservation_id: ev.payload?.reservation_id || null }
  return (await db.from('garden_reservations').select('*').eq('id', id).maybeSingle()).data || ev.payload || {}
}

/** Consume the inbox once. Safe to call often; each event is processed exactly once. */
export async function runTriggers(opts: { limit?: number; by?: string } = {}): Promise<{ events: number; fired: number; skipped: number; failed: number }> {
  const db = supabaseAdmin()
  const by = opts.by || 'cron'
  const out = { events: 0, fired: 0, skipped: 0, failed: 0 }
  const { data: evs } = await db.from('garden_events').select('*').eq('processed', false).order('at').limit(opts.limit || 200)
  const events = (evs || []) as any[]
  if (!events.length) return out
  const { data: trs } = await db.from('garden_triggers').select('*').eq('enabled', true).order('sort')
  const triggers = (trs || []) as any[]
  for (const ev of events) {
    out.events++
    const mine = triggers.filter(t => t.event === ev.event)
    if (mine.length) {
      const subject = await subjectFor(ev)
      for (const t of mine) {
        const c = passes(t.conditions, subject)
        if (!c.ok) { out.skipped++; await db.from('garden_trigger_log').insert({ trigger_id: t.id, trigger_name: t.name, event: ev.event, subject_id: ev.subject_id, result: 'skipped', detail: { why: c.why } }); continue }
        const r: { ok: boolean; detail?: any; error?: string } = await perform(t.action, t.params, subject, ev, by).catch((e: any) => ({ ok: false, error: String(e?.message || e) }))
        if (r.ok) { out.fired++; await db.from('garden_triggers').update({ fired_count: (Number(t.fired_count) || 0) + 1, last_fired_at: new Date().toISOString() }).eq('id', t.id); t.fired_count = (Number(t.fired_count) || 0) + 1 }
        else out.failed++
        await db.from('garden_trigger_log').insert({ trigger_id: t.id, trigger_name: t.name, event: ev.event, subject_id: ev.subject_id, result: r.ok ? 'fired' : 'failed', detail: r.ok ? (r.detail || null) : { error: r.error } })
      }
    }
    await db.from('garden_events').update({ processed: true }).eq('id', ev.id)
  }
  return out
}
