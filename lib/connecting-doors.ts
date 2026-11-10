// CONNECTING DOORS ON A COMBINED UNIT (Jon, 2026-11-05: "If 115/116 gets booked, before arrival we
// need an automated task that creates a Breezeway task and assigns it to the cleaner cleaning, to open
// the door between. At checkout they need to close the connecting door if someone books 115 or 116 …
// it should also add to the departure clean task title").
//
// Capri 115 and Capri 116 are two apartments with a door between them, and they are ALSO sold together
// as "Capri 115/116". When the combined listing is booked:
//   OPEN   before the guests arrive — on the last clean before the arrival (the cleaner who is in there
//          anyway), a task "Open connecting door 115/116", assigned to that clean's cleaner(s), and
//          "+ OPEN connecting door" added to that departure clean's title so it is seen on the clean.
//   CLOSE  at their checkout — the departure clean that day gets "+ CLOSE connecting door" in its title
//          and a "Close connecting door" task goes to the same cleaner(s), so 115 and 116 can be sold
//          on their own again. Skipped when the combined unit is booked again from that same day (the
//          door stays open for the next party).
// No clean on the board yet (it is created a few days out): the task is made anyway, dated the
// arrival / checkout, and a later run adds the cleaner and the title note once the clean appears.
// Never twice: a task of the same kind already at the unit in the window is the one.
// Adding another pair is one line in PAIRS.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { createBreezewayTask, updateBreezewayTask, breezewayConfigured, mapBreezewayTask, isDepartureCleanName } from './breezeway'
import { isTaskDone, isTaskGone } from './task-categories'
import { EVE_CHANNELS } from './slack-rules'
import { getSetting, setSetting } from './app-settings'

// THE CUSTOMER-CARE NOTICE GOES THROUGH THE ROOM GATE (2026-11-09). It was a direct post from a cron
// that runs until 9:38pm ET — outside the said-registry and the 8pm–7am window. It now passes
// lib/eve/room-gate (urgent: it is once per stay per door move and is never dropped for the room's
// daily cap). A notice the gate holds — the night window, quiet hours — is kept in app_settings
// `connecting_doors_held` and said on the first pass after the window opens; the door task itself is
// created at once either way, and the morning brief names the stay (doorBriefItems).
const HELD_KEY = 'connecting_doors_held'
type HeldNotice = { text: string; subject: string; at: string }
async function tellCustomerCare(text: string, subject: string): Promise<{ state: 'told' | 'held' | 'failed'; why: string }> {
  const { gatedPost } = await import('./eve/room-gate')
  const r = await gatedPost({ channel: EVE_CHANNELS.ccsJon, text, subject, by: 'cron:connecting-doors', urgent: true, summary: text.replace(/\s+/g, ' ').slice(0, 200) })
  if (r.ok) return { state: 'told', why: '' }
  if (r.held) return { state: 'held', why: r.held }
  return { state: 'failed', why: str(r.error) }
}
async function flushHeldNotices(lines: string[]): Promise<void> {
  let held: HeldNotice[] = []
  try { const v = await getSetting<HeldNotice[]>(HELD_KEY, []); held = Array.isArray(v) ? v : [] } catch { return }
  if (!held.length) return
  const { inPostWindow } = await import('./eve/room-gate')
  if (!inPostWindow()) return
  const keep: HeldNotice[] = []
  for (const h of held) {
    // Two days is the end of its usefulness: the stay has started or the door has been closed by then.
    if (!h || !h.text || Date.parse(String(h.at || '')) < Date.now() - 2 * 86400_000) continue
    const res = await tellCustomerCare(h.text, h.subject)
    if (res.state === 'told') lines.push('held notice: customer care told (' + h.subject + ')')
    else if (res.state === 'held' && /already said/.test(res.why)) continue   // the room has it
    else keep.push(h)
  }
  try { await setSetting(HELD_KEY, keep, 'connecting-doors') } catch { /* the next pass tries again; the said-registry stops a second post */ }
}

type Pair = { label: string; door: string; parentListing: string; childListings: string[] }
export const PAIRS: Pair[] = [
  { label: 'Capri 115/116', door: '115/116', parentListing: '6a6a7b1ba37391009d95dbf3', childListings: ['691cdc5a52a1de00127605b5', '691cdc609824e3001b5dead2'] },
]
const LOOKAHEAD_DAYS = 4
const OPEN_T = (door: string) => 'Open connecting door ' + door
const CLOSE_T = (door: string) => 'Close connecting door ' + door
const NOTE = { open: (door: string) => ' + OPEN connecting door ' + door, close: (door: string) => ' + CLOSE connecting door ' + door }

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const shift = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const nice = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const LIVE = (s: any) => /confirm|checked.?in/i.test(str(s))
const ids = (as: any): number[] => (Array.isArray(as) ? as : []).map((a: any) => Number(a?.id)).filter((n: number) => Number.isFinite(n))

export type DoorJob = {
  pair: string; kind: 'open' | 'close'; guest: string; date: string; at: string; reservationDates: string
  clean: { id: string; name: string; date: string; assignees: number[] } | null
  existing: { id: string; assignees: number[]; date: string } | null
  homeId: number | null; action: string
}

export async function planDoors(today = ymdET(new Date())): Promise<DoorJob[]> {
  const db = supabaseAdmin()
  const jobs: DoorJob[] = []
  for (const pair of PAIRS) {
    const all = [pair.parentListing, ...pair.childListings]
    const [{ data: props }, { data: res }] = await Promise.all([
      db.from('breezeway_properties').select('home_id,name,reference_property_id').in('reference_property_id', all),
      db.from('guesty_reservations').select('id,guest_name,check_in,check_out,status').eq('listing_id', pair.parentListing)
        .gte('check_out', today).lte('check_in', shift(today, LOOKAHEAD_DAYS + 30)).limit(200),
    ])
    const homes = ((props || []) as any[]).map(p => Number(p.home_id)).filter(Number.isFinite)
    const parentHome = ((props || []) as any[]).find(p => str(p.reference_property_id) === pair.parentListing)
    const homeId = parentHome ? Number(parentHome.home_id) : (homes[0] ?? null)
    if (!homes.length) continue
    const { data: tks } = await db.from('breezeway_tasks_sync').select('id,name,home_id,status,finished_at,scheduled_date,assignees,type_department')
      .in('home_id', homes).gte('scheduled_date', shift(today, -10)).lte('scheduled_date', shift(today, LOOKAHEAD_DAYS + 2)).limit(1000)
    const tasks = ((tks || []) as any[]).filter(t => !isTaskGone(t.status))
    const cleans = tasks.filter(t => isDepartureCleanName(t.name))
    const live = ((res || []) as any[]).filter(r => LIVE(r.status))
    for (const r of live) {
      const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
      const dates = nice(ci) + ' – ' + nice(co)
      // OPEN: arrivals in the window. The last clean on or before arrival (not before today).
      if (ci >= today && ci <= shift(today, LOOKAHEAD_DAYS)) {
        const c = cleans.filter(t => str(t.scheduled_date) <= ci && str(t.scheduled_date) >= shift(ci, -7) && !isTaskDone(t.status, t.finished_at))
          .sort((a, b) => str(b.scheduled_date).localeCompare(str(a.scheduled_date)))[0] || null
        const ex = tasks.find(t => str(t.name).indexOf(OPEN_T(pair.door)) === 0 && str(t.scheduled_date) >= shift(ci, -7) && str(t.scheduled_date) <= ci) || null
        jobs.push({
          pair: pair.label, kind: 'open', guest: str(r.guest_name), date: c ? str(c.scheduled_date) : ci, at: ci, reservationDates: dates,
          clean: c ? { id: str(c.id), name: str(c.name), date: str(c.scheduled_date), assignees: ids(c.assignees) } : null,
          existing: ex ? { id: str(ex.id), assignees: ids(ex.assignees), date: str(ex.scheduled_date) } : null,
          homeId, action: '',
        })
      }
      // CLOSE: checkouts in the window — unless the combined unit is booked again from that day.
      if (co >= today && co <= shift(today, LOOKAHEAD_DAYS)) {
        const again = live.some(x => x !== r && str(x.check_in).slice(0, 10) === co)
        if (again) { jobs.push({ pair: pair.label, kind: 'close', guest: str(r.guest_name), date: co, at: co, reservationDates: dates, clean: null, existing: null, homeId, action: 'skip — 115/116 booked again from ' + nice(co) + ', door stays open' }); continue }
        const c = cleans.filter(t => str(t.scheduled_date) === co).sort((a, b) => (Number(str(b.home_id) === str(homeId)) - Number(str(a.home_id) === str(homeId))))[0] || null
        const ex = tasks.find(t => str(t.name).indexOf(CLOSE_T(pair.door)) === 0 && str(t.scheduled_date) === co) || null
        jobs.push({
          pair: pair.label, kind: 'close', guest: str(r.guest_name), date: co, at: co, reservationDates: dates,
          clean: c ? { id: str(c.id), name: str(c.name), date: str(c.scheduled_date), assignees: ids(c.assignees) } : null,
          existing: ex ? { id: str(ex.id), assignees: ids(ex.assignees), date: str(ex.scheduled_date) } : null,
          homeId, action: '',
        })
      }
    }
  }
  return jobs
}

export async function runDoors(opts: { dryRun?: boolean } = {}) {
  const jobs = await planDoors()
  const lines: string[] = []
  let created = 0, updated = 0, titled = 0
  if (!breezewayConfigured()) return { ok: false, error: 'Breezeway is not configured', jobs, lines, created, updated, titled }
  if (!opts.dryRun) { try { await flushHeldNotices(lines) } catch { /* the next pass tries again */ } }
  const db = supabaseAdmin()
  const mirror = async (r: any, homeId: number | null) => {
    try { const m: any = r?.data ? mapBreezewayTask(r.data) : null; if (!m?.id) return; if (homeId != null && !m.home_id) m.home_id = homeId; m.synced_at = new Date().toISOString(); const rp = Number(m.rate_paid); m.rate_paid = Number.isFinite(rp) ? rp : null; await db.from('breezeway_tasks_sync').upsert(m, { onConflict: 'id' }) } catch { /* next sync */ }
  }
  for (const j of jobs) {
    const door = PAIRS.find(p => p.label === j.pair)!.door
    const tag = j.pair + ' · ' + j.kind + ' · ' + j.guest + ' (' + j.reservationDates + ')'
    if (j.action.startsWith('skip')) { lines.push(tag + ': ' + j.action); continue }
    if (j.homeId == null) { lines.push(tag + ': no Breezeway property'); continue }
    // 1) The departure clean's title carries the note.
    if (j.clean && j.clean.name.toLowerCase().indexOf('connecting door') < 0) {
      const name = j.clean.name + NOTE[j.kind](door)
      if (opts.dryRun) lines.push(tag + ': would rename clean ' + j.clean.id + ' → "' + name + '"')
      else { const r = await updateBreezewayTask(j.clean.id, { name }); if (r.ok) { titled++; lines.push(tag + ': clean ' + j.clean.id + ' titled'); await mirror(r, null) } else lines.push(tag + ': rename said ' + r.status) }
    }
    // 2) The door task, with the clean's cleaner(s).
    const who = j.clean ? j.clean.assignees : []
    const date = j.clean ? j.clean.date : j.date
    if (j.existing) {
      const add = who.filter(id => j.existing!.assignees.indexOf(id) < 0)
      const move = j.existing.date !== date
      if (!add.length && !move) { lines.push(tag + ': task ' + j.existing.id + ' already set'); continue }
      if (opts.dryRun) { lines.push(tag + ': would update ' + j.existing.id + (add.length ? ' +' + add.length + ' cleaner(s)' : '') + (move ? ' → ' + date : '')); continue }
      const body: any = {}
      if (add.length) body.assignments = j.existing.assignees.concat(add)
      if (move) body.scheduled_date = date
      const r = await updateBreezewayTask(j.existing.id, body)
      if (r.ok) { updated++; lines.push(tag + ': updated ' + j.existing.id); await mirror(r, j.homeId) } else lines.push(tag + ': update said ' + r.status)
      continue
    }
    const title = (j.kind === 'open' ? OPEN_T(door) : CLOSE_T(door)) + ' — ' + (j.kind === 'open' ? 'guests arrive ' : 'after checkout ') + nice(j.at)
    const desc = j.kind === 'open'
      ? 'Capri 115/116 is booked as ONE unit (' + j.reservationDates + ', ' + j.guest + '). The door is LOCKED and CLOSED by default. During the clean before arrival, UNLOCK and OPEN the connecting door between 115 and 116, and leave it open for this stay only. Photo of the open door.\n\nAbrir la puerta que conecta 115 y 116 durante la limpieza antes de la llegada. Foto de la puerta abierta.'
      : 'The combined 115/116 stay ends today (' + j.reservationDates + '). During the departure clean, CLOSE and LOCK the connecting door between 115 and 116 so each can be rented on its own. Photo of the locked door.\n\nCerrar con llave la puerta que conecta 115 y 116 durante la limpieza de salida. Foto de la puerta cerrada.'
    if (opts.dryRun) { lines.push(tag + ': would create "' + title + '" on ' + date + ' for ' + (who.length ? who.length + ' cleaner(s)' : 'nobody yet — added when the clean is assigned')); continue }
    const r = await createBreezewayTask({ home_id: j.homeId, name: title, type_department: 'housekeeping', scheduled_date: date, description: desc, ...(who.length ? { assignments: who } : {}), allowDuplicate: true })
    if (r.ok && r.data?.id) {
      created++; lines.push(tag + ': created ' + str(r.data.id) + ' on ' + date); await mirror(r, j.homeId)
      // CUSTOMER CARE HEARS IT (Jon, 2026-11-05: "Slack messages in customer care — default should be
      // locked and closed, only opened if 115/116 is booked"). One post when each door task is made,
      // which is once per stay per door move, so a walk-in reaches the room the hour it lands.
      const names = (r.data?.assignments || r.data?.assignees || []).map((a: any) => str(a?.name || a?.assignee_name || '').split(' ')[0]).filter(Boolean)
      const who = names.length ? names.join(', ') : 'the cleaner on that clean (not assigned yet)'
      const text = j.kind === 'open'
        ? `🚪 *${j.pair} booked as ONE unit* — ${j.guest || 'guest'}, ${j.reservationDates}. The connecting door between ${door.replace('/', ' and ')} stays *LOCKED and CLOSED by default*; it is *opened for this stay only*, during the clean on ${nice(date)} — ${who}.`
        : `🚪 *${j.pair} one-unit stay ends ${nice(j.at)}* (${j.guest || 'guest'}). Back to default: the connecting door between ${door.replace('/', ' and ')} is *LOCKED and CLOSED* during the departure clean — ${who} — so ${door.split('/')[0]} and ${door.split('/')[1]} can be rented on their own.`
      try {
        const subject = 'door:' + j.pair + ':' + j.kind + ':' + j.at
        const res = await tellCustomerCare(text, subject)
        if (res.state === 'held' && /already said/.test(res.why)) lines.push(tag + ': customer care already told')
        else if (res.state === 'held') {
          const v = await getSetting<HeldNotice[]>(HELD_KEY, [])
          const held = (Array.isArray(v) ? v : []).filter(h => h && h.subject !== subject)
          held.push({ text, subject, at: new Date().toISOString() })
          await setSetting(HELD_KEY, held.slice(-20), 'connecting-doors')
          lines.push(tag + ': customer care notice held — goes out when the 7am–8pm ET window opens')
        } else lines.push(tag + ': customer care ' + (res.state === 'told' ? 'told' : 'post failed (' + res.why + ')'))
      } catch { lines.push(tag + ': customer care post failed') }
    } else lines.push(tag + ': create said ' + r.status + ' ' + str(r.text).slice(0, 120))
  }
  return { ok: true, jobs, lines, created, updated, titled }
}

// IN THE MORNING BRIEF (Jon, 2026-11-05: "this needs to be in the brief — reason is for walk-ins").
// A same-day booking of 115/116 can land after the morning clean was planned, so the brief names every
// combined stay arriving or leaving today or tomorrow, flags a walk-in, and says whether the door task
// is on the board and who holds it.
export type DoorBriefItem = { pair: string; door: string; kind: 'open' | 'close'; date: string; when: 'today' | 'tomorrow'; guest: string; walkIn: boolean; task: { id: string; who: string[] } | null; skip?: string }
export async function doorBriefItems(today = ymdET(new Date())): Promise<DoorBriefItem[]> {
  const db = supabaseAdmin()
  const tomorrow = shift(today, 1)
  const out: DoorBriefItem[] = []
  for (const pair of PAIRS) {
    const all = [pair.parentListing, ...pair.childListings]
    const [{ data: res }, { data: props }] = await Promise.all([
      db.from('guesty_reservations').select('guest_name,check_in,check_out,status,created_at').eq('listing_id', pair.parentListing)
        .gte('check_out', today).lte('check_in', tomorrow).limit(50),
      db.from('breezeway_properties').select('home_id').in('reference_property_id', all),
    ])
    const homes = ((props || []) as any[]).map(p => Number(p.home_id)).filter(Number.isFinite)
    const { data: tks } = homes.length ? await db.from('breezeway_tasks_sync').select('id,name,status,scheduled_date,assignees')
      .in('home_id', homes).gte('scheduled_date', shift(today, -7)).lte('scheduled_date', tomorrow).limit(300) : { data: [] as any[] }
    const live = ((res || []) as any[]).filter(r => LIVE(r.status))
    const taskFor = (kind: 'open' | 'close', from: string, to: string) => {
      const t = ((tks || []) as any[]).find(x => str(x.name).indexOf(kind === 'open' ? OPEN_T(pair.door) : CLOSE_T(pair.door)) === 0 && !isTaskGone(x.status) && str(x.scheduled_date) >= from && str(x.scheduled_date) <= to)
      return t ? { id: str(t.id), who: (Array.isArray(t.assignees) ? t.assignees : []).map((a: any) => str(a?.name).trim()).filter(Boolean) } : null
    }
    for (const r of live) {
      const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
      const walkIn = !!r.created_at && ymdET(new Date(r.created_at)) === today
      if (ci === today || ci === tomorrow) out.push({ pair: pair.label, door: pair.door, kind: 'open', date: ci, when: ci === today ? 'today' : 'tomorrow', guest: str(r.guest_name), walkIn, task: taskFor('open', shift(ci, -7), ci) })
      if (co === today || co === tomorrow) {
        const again = live.some(x => x !== r && str(x.check_in).slice(0, 10) === co)
        out.push({ pair: pair.label, door: pair.door, kind: 'close', date: co, when: co === today ? 'today' : 'tomorrow', guest: str(r.guest_name), walkIn: false, task: again ? null : taskFor('close', co, co), ...(again ? { skip: 'booked again as one unit from ' + nice(co) + ' — the door stays open' } : {}) })
      }
    }
  }
  return out
}
