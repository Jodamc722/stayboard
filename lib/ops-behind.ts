// ARE THE DEPARTURE CLEANS RUNNING BEHIND?
//
// Jon: "a section at the top saying Task Not Started. It should send a notification to the entire
// Ops people: 'Departure cleans are running behind, we have check-ins at 4:00, same-day turns' — a
// warning so we pay attention and follow up with the team."
//
// The rule that keeps this honest is the same clock rule the day sheet uses: a clean that has not
// started is NOT late while the guest is still in the unit. It only counts once the guest has
// actually checked out (plus a 30-minute grace), and it is urgent in proportion to the next
// check-in. An alarm that fires at 9am against an 11am checkout is a false alarm, and a board that
// cries wolf at 9am is ignored by 10.
//
// One computation, two callers: the board (/api/ops-today, which already has the tasks in hand and
// must not pay for extra queries) and the 15-minute Breezeway cron (which loads its own).
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getOpsPresets, getSetting, setSetting } from './app-settings'
import { untrackedRegex } from './ops-presets'
import { isLiveStay } from './stay-status'
import { notify } from './notify'
import { postSlack } from './integrations'

export const GRACE_MIN = 30          // minutes after checkout before "not started" means anything
const DEFAULT_OUT_MIN = 11 * 60      // 11:00 AM
const DEFAULT_IN_MIN = 16 * 60       // 4:00 PM
const WORK_START_MIN = 9 * 60        // no alerts before 9am
const WORK_END_MIN = 19 * 60         // or after 7pm
const ALERT_KEY = 'ops_behind_alert_state'
const SUPERADMIN = 'jon@stay-hospitality.com'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

/** '16:00' / '4:00 PM' -> minutes past midnight. null when unparseable. */
export function minutesOfDay(v: any): number | null {
  const t = str(v).trim(); if (!t) return null
  const m = t.match(/^(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?/i)
  if (!m) return null
  let h = Number(m[1]); const mm = Number(m[2]); const ap = (m[3] || '').toLowerCase()
  if (ap.startsWith('p') && h < 12) h += 12
  if (ap.startsWith('a') && h === 12) h = 0
  return h * 60 + mm
}
/** '16:00' -> '4:00 PM'. Anything already human passes through. */
export function fmt12(v: any): string | null {
  const m = minutesOfDay(v)
  if (m == null) return str(v) || null
  const h = Math.floor(m / 60), mi = m % 60
  const ap = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return h12 + ':' + String(mi).padStart(2, '0') + ' ' + ap
}
export function nowMinutesET(): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  const h = Number(p.find(x => x.type === 'hour')?.value || 0)
  const mi = Number(p.find(x => x.type === 'minute')?.value || 0)
  return h * 60 + mi
}
function ymdET(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }

/** One departure clean that has not been started yet. */
export type BehindRow = {
  taskId: string
  unit: string
  market?: string | null        // so the board can show the band for one market at a time
  checkOutTime: string | null   // when the guest was due to leave
  arrivingAt: string | null     // when the next guest arrives TODAY, else null
  assignee: string | null
}
export type Behind = {
  notStarted: number            // past checkout + grace, nobody has started
  sameDay: number               // ...of which a guest checks in today
  earliestIn: string | null     // earliest of those check-in times
  unassigned: number            // ...of which nobody is even assigned
  waiting: number               // not started, but the guest has not left yet — NOT a problem
  units: BehindRow[]
  level: '' | 'warn' | 'urgent'
}

const EMPTY: Behind = { notStarted: 0, sameDay: 0, earliestIn: null, unassigned: 0, waiting: 0, units: [], level: '' }

/**
 * The whole judgement, in one pure function so the board and the cron can never disagree.
 * The rows passed in must already be filtered to departure cleans that are NOT done and NOT started.
 */
export function summariseBehind(rows: BehindRow[], nowMin: number): Behind {
  const late: BehindRow[] = []
  let waiting = 0
  for (const r of rows) {
    const outMin = minutesOfDay(r.checkOutTime) ?? DEFAULT_OUT_MIN
    // the guest is still in there (or only just left) — a cleaner could not have started
    if (nowMin < outMin + GRACE_MIN) { waiting++; continue }
    late.push(r)
  }
  if (!late.length) return { ...EMPTY, waiting }
  // most urgent first: an arrival today, then the earliest arrival, then nobody assigned
  const inMinOf = (r: BehindRow) => (r.arrivingAt ? (minutesOfDay(r.arrivingAt) ?? DEFAULT_IN_MIN) : 9999)
  late.sort((a, b) => inMinOf(a) - inMinOf(b) || (a.assignee ? 1 : 0) - (b.assignee ? 1 : 0) || a.unit.localeCompare(b.unit))
  const sameDayRows = late.filter(r => !!r.arrivingAt)
  const earliestIn = sameDayRows.length ? sameDayRows[0].arrivingAt : null
  return {
    notStarted: late.length,
    sameDay: sameDayRows.length,
    earliestIn,
    unassigned: late.filter(r => !r.assignee).length,
    waiting,
    // the FULL list (the UI decides how many to show) — a sliced list broke per-market filtering
    units: late,
    // a check-in today means the clean cannot slip at all — that is the urgent case
    level: sameDayRows.length ? 'urgent' : 'warn',
  }
}

/** Jon's own words, filled in with today's numbers. */
export function behindMessage(b: Behind): { title: string; body: string } {
  const bits: string[] = [b.notStarted + ' not started']
  if (b.sameDay) bits.push(b.sameDay + ' with a check-in today' + (b.earliestIn ? ' (earliest ' + b.earliestIn + ')' : ''))
  if (b.unassigned) bits.push(b.unassigned + ' with nobody assigned')
  const names = b.units.slice(0, 6).map(u => u.unit).join(', ')
  return {
    title: 'Departure cleans are running behind — ' + bits.join(', '),
    body: 'The guests have already checked out of these units and nobody has started: ' + names +
      (b.units.length > 6 ? ' and ' + (b.notStarted - 6) + ' more' : '') +
      '. Assign them and get someone moving — open Today in Ops.',
  }
}

/** Load today's picture from scratch (for the cron, which has nothing in hand). */
export async function loadBehind(): Promise<Behind & { date: string; nowMin: number }> {
  const db = supabaseAdmin()
  const today = ymdET(new Date())
  const nowMin = nowMinutesET()
  const presets = await getOpsPresets()
  const UNTRACKED_RE = untrackedRegex(presets.vendorBuildings)
  const [lRes, tRes, rRes] = await Promise.all([
    db.from('guesty_listings').select('id,nickname,title,checkIn:raw->>defaultCheckInTime,checkOut:raw->>defaultCheckOutTime'),
    db.from('breezeway_tasks_sync').select('id,reference_property_id,name,status,assignees,started_at,finished_at').eq('scheduled_date', today).limit(2000),
    db.from('guesty_reservations').select('listing_id,check_in,status').eq('check_in', today).limit(1000),
  ])
  const lmap: Record<string, { name: string; checkIn: string | null; checkOut: string | null }> = {}
  for (const l of ((lRes.data || []) as any[])) {
    lmap[String(l.id)] = { name: l.nickname || l.title || 'Unit', checkIn: fmt12(l.checkIn), checkOut: fmt12(l.checkOut) }
  }
  const arriving: Record<string, boolean> = {}
  for (const r of ((rRes.data || []) as any[])) if (isLiveStay(r.status)) arriving[String(r.listing_id)] = true
  const rows: BehindRow[] = []
  for (const t of ((tRes.data || []) as any[])) {
    const status = str(t.status).toLowerCase()
    if (/delete|cancel/.test(status)) continue
    const name = str(t.name).toLowerCase()
    // the departure clean only — a strip or a walkthrough is a different job with no 4pm deadline
    if (/strip|walk-?through|inspect|unit check/.test(name)) continue
    if (!/departure clean|turnover clean/.test(name)) continue
    if (/complete|finish|close|approv/.test(status) || t.finished_at) continue
    if (/progress|started/.test(status) || t.started_at) continue
    const li = lmap[String(t.reference_property_id)]
    const unit = li ? li.name : 'Unknown unit'
    // vendor-cleaned buildings never close a task in Breezeway, so they always read "not started"
    if (UNTRACKED_RE.test(unit)) continue
    const ppl = Array.isArray(t.assignees) ? t.assignees : []
    rows.push({
      taskId: String(t.id), unit,
      checkOutTime: li ? li.checkOut : null,
      arrivingAt: arriving[String(t.reference_property_id)] ? ((li && li.checkIn) || '4:00 PM') : null,
      assignee: (ppl[0] && ppl[0].name) || null,
    })
  }
  return { ...summariseBehind(rows, nowMin), date: today, nowMin }
}

/** Everyone who runs the day: the ops workspace, plus GM/admin. */
async function opsRecipients(): Promise<string[]> {
  const db = supabaseAdmin()
  const out = new Set<string>([SUPERADMIN])
  try {
    // select('*') so a missing optional column (pre-migration) cannot null the whole read
    const { data } = await db.from('app_users').select('*').limit(300)
    for (const u of ((data || []) as any[])) {
      if (str(u.status) && str(u.status) !== 'active') continue
      const ws = str(u.workspace).toLowerCase()
      const isAdmin = str(u.role) === 'admin'
      if (isAdmin || ws === 'ops' || ws === 'gm' || ws === 'admin' || !ws) out.add(str(u.email).toLowerCase())
    }
  } catch { /* fail-open: at least the owner hears about it */ }
  return Array.from(out).filter(Boolean)
}


/**
 * Tell the ops team, AT MOST ONCE PER CONDITION PER DAY. A repeated nag trains people to ignore it,
 * which is exactly how the exceptions sheet lost its audience before the clock fix. 'warn' escalates
 * to 'urgent' once a same-day arrival is involved (that IS new information); it never goes back.
 */
export async function runBehindAlert(): Promise<any> {
  const nowMin = nowMinutesET()
  if (nowMin < WORK_START_MIN || nowMin > WORK_END_MIN) return { skipped: 'outside working hours' }
  const b = await loadBehind()
  if (!b.level) return { skipped: 'nothing behind', waiting: b.waiting }
  const state = await getSetting<{ date: string; sent: string[] }>(ALERT_KEY, { date: '', sent: [] })
  const sent: string[] = (state && state.date === b.date && Array.isArray(state.sent)) ? state.sent : []
  // urgent covers warn — once the urgent one is out, a plain warn adds nothing
  if (sent.indexOf(b.level) >= 0 || sent.indexOf('urgent') >= 0) return { skipped: 'already sent today', level: b.level, notStarted: b.notStarted }
  const msg = behindMessage(b)
  const to = await opsRecipients()
  const res = await notify(to, { kind: 'ops_alert', title: msg.title, body: msg.body, link: '/plan' })
  const slack = await postSlack('⚠️ *' + msg.title + '*\n' + msg.body)
  try { await setSetting(ALERT_KEY, { date: b.date, sent: sent.concat([b.level]) }, 'ops-behind') } catch {}
  return { alerted: true, level: b.level, notStarted: b.notStarted, sameDay: b.sameDay, unassigned: b.unassigned, recipients: to.length, sent: res.sent, slack }
}
