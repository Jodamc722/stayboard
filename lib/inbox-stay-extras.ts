// WHAT THE DESK NEEDS TO DECIDE, BESIDE THE THREAD (Jon, 2026-11-12: "The reservation details should show glitches
// or claims that are assigned to that guest. Should show old and new codes, should show status of clean / inspected.
// Should give the team info if needed to make real decisions").
//
// lib/reservation-360 already carries the stay: money, notes, sentiment, this stay's glitches and claims, calls,
// reviews. This adds the three things it does not:
//   · THE UNIT — is it cleaned and inspected for this guest (the turnover before check-in), or after they leave;
//   · THE GUEST'S OTHER STAYS — glitches and claims on any earlier booking of the same guest;
//   · THE DOOR — the code for this stay, and the previous one while the keypad may still hold it. Only on request
//     (?codes=1), only for people who can reply to guests (Messages edit), and every reveal is logged.
//
// Door codes follow lib/eve/door-code exactly: most units keep a standing code on the LISTING (current + previous
// from door_code_state, and which one the keypad holds now); Salato and Botanica take the code from the
// RESERVATION — this stay's own — and never fall back to the listing (an empty field on Botanica means wiped).
import 'server-only'
import { isDepartureCleanName } from './breezeway'
import { isTaskDone } from './task-categories'
import { guestKeyOf } from './reservation-360'

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
async function soft<T>(p: PromiseLike<{ data: any; error?: any }>, fallback: T): Promise<T> {
  try { const r = await p; return (r && !r.error && r.data != null ? r.data : fallback) as T } catch { return fallback }
}
const shift = (ymd: string, d: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)

export type TaskBrief = { id: string; name: string; status: string; done: boolean; scheduled: string | null; finished: string | null; who: string[]; reportUrl: string | null }
export type StayExtras = {
  unit: {
    /** Which turnover this is about: the one that readies the unit for this guest, or the one after they leave. */
    for: 'arrival' | 'departure'
    clean: TaskBrief | null
    inspection: TaskBrief | null
    /** One phrase: "Cleaned & inspected", "Cleaned — not inspected yet", "Clean not started", "No clean found". */
    verdict: string
    tone: 'emerald' | 'amber' | 'rose' | 'slate'
  }
  otherStays: {
    glitches: { id: string; overview: string; status: string; createdAt: string; refund: number | null; unit: string; checkIn: string }[]
    claims: { id: string; stage: string; summary: string | null; sought: number | null; paid: number | null; unit: string; checkIn: string }[]
  }
  codes: null | {
    system: 'listing' | 'reservation'
    current: string | null
    previous: string | null
    /** Which code the keypad most likely holds now (listing units). */
    expect: 'new' | 'old' | 'only_one' | null
    note: string
  }
}

function brief(t: any): TaskBrief {
  return {
    id: str(t.id), name: str(t.name), status: str(t.status), done: isTaskDone(t.status, t.finished_at),
    scheduled: t.scheduled_date ? str(t.scheduled_date).slice(0, 10) : null, finished: t.finished_at || null,
    who: Array.isArray(t.assignees) ? t.assignees.map((a: any) => str(a?.name || a)).filter(Boolean) : [], reportUrl: t.report_url || null,
  }
}
const INSPECT = /inspect/i

export async function loadStayExtras(db: any, reservationId: string, opts: { codes?: boolean } = {}): Promise<StayExtras | null> {
  const r: any = await soft(db.from('guesty_reservations').select('id,listing_id,check_in,check_out,status,guest_email,guest_id,guest_name,custom_fields').eq('id', reservationId).maybeSingle(), null)
  if (!r) return null
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
  const listingId = str(r.listing_id)
  const leaving = !!co && co <= today
  const gKey = guestKeyOf(r.guest_email, r.guest_id, r.guest_name)

  const [tasks, history] = await Promise.all([
    // The turnover that matters: before arrival (up to 10 days ahead of check-in), or after departure once they have left.
    listingId && ci ? soft<any[]>(db.from('breezeway_tasks_sync').select('id,name,status,type_department,scheduled_date,finished_at,assignees,report_url')
      .eq('reference_property_id', listingId)
      .gte('scheduled_date', leaving ? co : shift(ci, -10)).lte('scheduled_date', leaving ? shift(co, 3) : ci)
      .order('scheduled_date', { ascending: false }).limit(40), []) : Promise.resolve([] as any[]),
    (async () => {
      const cols = 'id,listing_id,check_in'
      if (gKey.startsWith('e:')) return soft<any[]>(db.from('guesty_reservations').select(cols).ilike('guest_email', gKey.slice(2)).limit(60), [])
      if (gKey.startsWith('g:')) return soft<any[]>(db.from('guesty_reservations').select(cols).eq('guest_id', gKey.slice(2)).limit(60), [])
      return r.guest_name ? soft<any[]>(db.from('guesty_reservations').select(cols).ilike('guest_name', str(r.guest_name)).limit(60), []) : Promise.resolve([] as any[])
    })(),
  ])

  // ---- The unit.
  const live = tasks.filter(t => !/cancel|delet/i.test(str(t.status)))
  const cleanT = live.find(t => isDepartureCleanName(t.name)) || live.find(t => /housekeep/i.test(str(t.type_department)) && /clean/i.test(str(t.name)) && !INSPECT.test(str(t.name))) || null
  const inspT = live.find(t => INSPECT.test(str(t.name)) || INSPECT.test(str(t.type_department))) || null
  const clean = cleanT ? brief(cleanT) : null
  const inspection = inspT ? brief(inspT) : null
  let verdict = '', tone: StayExtras['unit']['tone'] = 'slate'
  if (!clean) { verdict = leaving ? 'No departure clean found' : 'No clean found before arrival'; tone = leaving ? 'slate' : 'rose' }
  else if (clean.done && inspection?.done) { verdict = 'Cleaned & inspected'; tone = 'emerald' }
  else if (clean.done) { verdict = inspection ? 'Cleaned — inspection not done' : 'Cleaned — no inspection'; tone = inspection ? 'amber' : 'emerald' }
  else if (/progress|start/i.test(clean.status)) { verdict = 'Cleaning now'; tone = 'amber' }
  else { verdict = 'Clean not started'; tone = !leaving && ci <= shift(today, 1) ? 'rose' : 'amber' }

  // ---- The guest's other stays.
  const others = history.filter(h => str(h.id) && str(h.id) !== reservationId)
  const ids = others.map(h => str(h.id)).slice(0, 60)
  const byId: Record<string, any> = {}
  for (const h of others) byId[str(h.id)] = h
  const [g2, c2] = ids.length ? await Promise.all([
    soft<any[]>(db.from('glitches').select('id,overview,status,created_at,refund_approved,reservation_id').in('reservation_id', ids).order('created_at', { ascending: false }).limit(20), []),
    soft<any[]>(db.from('claims').select('id,stage,summary,amount_sought,amount_paid,reservation_id').in('reservation_id', ids).is('deleted_at', null).order('created_at', { ascending: false }).limit(10), []),
  ]) : [[], []] as [any[], any[]]
  const listingIds = Array.from(new Set(g2.concat(c2).map(x => str(byId[str(x.reservation_id)]?.listing_id)).filter(Boolean)))
  const names: Record<string, string> = {}
  if (listingIds.length) for (const l of await soft<any[]>(db.from('guesty_listings').select('id,nickname,title').in('id', listingIds), [])) names[str(l.id)] = str(l.nickname || l.title)
  const where = (resId: any) => { const h = byId[str(resId)]; return { unit: h ? (names[str(h.listing_id)] || '') : '', checkIn: h ? str(h.check_in).slice(0, 10) : '' } }

  // ---- The door (on request only).
  let codes: StayExtras['codes'] = null
  if (opts.codes && listingId) {
    try {
      const dc = await import('./eve/door-code')
      const ci2 = await import('./eve/code-integrity')
      const l: any = await soft(db.from('guesty_listings').select('id,nickname,title,building,address_full,raw').eq('id', listingId).maybeSingle(), null)
      if (dc.onReservationSystem(l?.nickname || l?.title, l?.building, l?.address_full)) {
        let code = dc.cfById({ customFields: r.custom_fields }, dc.RES_CODE_FIELD)
        if (!code) { const one: any = await soft(db.from('guesty_reservations').select('raw').eq('id', reservationId).maybeSingle(), null); code = dc.cfById(one?.raw, dc.RES_CODE_FIELD) }
        codes = { system: 'reservation', current: code || null, previous: null, expect: null,
          note: code ? 'This building takes the code from the booking — this guest’s own code. The last guest’s code is revoked, not lagging.'
            : 'No code on this booking. On Botanica an empty field means the codes were WIPED — nothing works at that door until a new one is set. Never send the building’s standing code.' }
      } else {
        const current = dc.doorCodeOf(l?.raw)
        if (!current) codes = { system: 'listing', current: null, previous: null, expect: null, note: 'No door code on this listing in Guesty.' }
        else {
          const pair = await ci2.bothCodes(listingId, current)
          const tr = await ci2.transitionFor(listingId, today).catch(() => null)
          codes = { system: 'listing', current: pair.current, previous: pair.previous, expect: tr ? tr.expect : null, note: tr ? tr.reason : '' }
        }
      }
    } catch (e: any) { codes = { system: 'listing', current: null, previous: null, expect: null, note: 'Could not read the code: ' + str(e?.message || e).slice(0, 120) } }
  }

  return {
    unit: { for: leaving ? 'departure' : 'arrival', clean, inspection, verdict, tone },
    otherStays: {
      glitches: g2.map(g => ({ id: str(g.id), overview: str(g.overview), status: str(g.status), createdAt: str(g.created_at), refund: g.refund_approved == null ? null : Number(g.refund_approved), ...where(g.reservation_id) })),
      claims: c2.map(c => ({ id: str(c.id), stage: str(c.stage), summary: c.summary || null, sought: c.amount_sought == null ? null : Number(c.amount_sought), paid: c.amount_paid == null ? null : Number(c.amount_paid), ...where(c.reservation_id) })),
    },
    codes,
  }
}
