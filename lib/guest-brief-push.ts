// PUTTING THE GUEST IN FRONT OF THE FIELD TEAM (Jon, 2026-10-14: "we should be pushing guest
// profiles to the breezeway descriptions etc and should allow team to know who is arriving").
//
// WHERE IT GOES, AND WHY ONLY THERE. Jon picked two targets: the arrival prep and inspection tasks,
// and the departure clean that turns the unit over for this guest. That is the smallest set where
// knowing changes what somebody does — the cleaner who knows a toddler is coming leaves the rail
// up, the inspector who knows it is an anniversary checks the balcony furniture. A brief on every
// maintenance ticket during the stay would be read once and ignored thereafter, which is worse than
// no brief, because it looks like the team was told.
//
// WHY A DELIMITED BLOCK AND NOT A COMMENT. A comment is safer but scrolls away; the description is
// what somebody reads standing in the doorway. So the brief is written between markers, and a
// re-push REPLACES its own block instead of stacking a fourth copy under the checklist. Everything
// outside the markers — the template's own instructions — is never touched.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { retrieveBreezewayTask, updateBreezewayTask, isPrepTaskName, isDepartureCleanName, breezewayConfigured } from './breezeway'
import { shortBrief, worthPushing, guestKey, type Understanding } from './guest-profile'
import { profileFor, understandingFor } from './guest-store'

const START = '--- GUEST BRIEF (Lighthouse) ---'
const END = '--- END GUEST BRIEF ---'

// How far back from the arrival date we look for the clean that turns the unit over for them. A
// same-day turn puts it on the arrival date; a three-day gap puts it on the previous checkout.
const LOOKBACK_DAYS = 3

const d = (iso: string, days: number) => {
  const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}
const digestOf = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0 }
  return String(h)
}

/** Replace our own block, leave everything else exactly as it was. */
export function stampBrief(existing: string | null | undefined, brief: string): string {
  const cur = String(existing || '')
  const block = `${START}\n${brief}\n${END}`
  const i = cur.indexOf(START), j = cur.indexOf(END)
  if (i >= 0 && j > i) return (cur.slice(0, i) + block + cur.slice(j + END.length)).trim()
  return cur.trim() ? `${cur.trim()}\n\n${block}` : block
}

/** The tasks that should carry this stay's brief: the turnover clean, plus prep and inspections. */
export async function targetTasks(listingId: string, checkIn: string): Promise<{ id: string; name: string | null }[]> {
  const db = supabaseAdmin()
  const { data: prop } = await db.from('breezeway_properties').select('home_id').eq('reference_property_id', listingId).maybeSingle()
  if (!prop?.home_id) return []
  const { data: tasks } = await db.from('breezeway_tasks_sync')
    .select('id,name,scheduled_date,status')
    .eq('home_id', prop.home_id)
    .gte('scheduled_date', d(checkIn, -LOOKBACK_DAYS))
    .lte('scheduled_date', checkIn)
    .limit(60)
  const rows = (tasks || []).filter(t => !/complete|finish|closed|cancel/i.test(String(t.status || '')))

  const out: { id: string; name: string | null }[] = []
  // The turnover clean: the LATEST departure clean in the window is the one that hands the unit to
  // this guest. An earlier one in the same window belongs to somebody else's stay.
  const cleans = rows.filter(t => isDepartureCleanName(t.name))
    .sort((a, b) => String(b.scheduled_date || '').localeCompare(String(a.scheduled_date || '')))
  if (cleans[0]) out.push({ id: String(cleans[0].id), name: cleans[0].name })
  for (const t of rows) if (isPrepTaskName(t.name)) out.push({ id: String(t.id), name: t.name })
  return out.slice(0, 5)
}

export type PushReport = { looked: number; pushed: number; skipped: number; errors: string[] }

/**
 * Push the brief for every arrival in the next `days`. Idempotent by digest: an unchanged brief is
 * not re-sent, so this can run every hour without touching Breezeway at all on a quiet day.
 */
export async function pushGuestBriefs(opts: { days?: number; deadline?: number; reservationId?: string } = {}): Promise<PushReport> {
  const rep: PushReport = { looked: 0, pushed: 0, skipped: 0, errors: [] }
  if (!breezewayConfigured()) { rep.errors.push('Breezeway not configured'); return rep }
  const db = supabaseAdmin()
  const over = () => opts.deadline ? Date.now() > opts.deadline : false

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  let q = db.from('guesty_reservations')
    .select('id,guest_id,guest_name,guest_phone,listing_id,check_in,status')
    .not('status', 'in', '(inquiry,canceled,cancelled,declined,expired,denied,unavailable)')
  q = opts.reservationId
    ? q.eq('id', opts.reservationId)
    : q.gte('check_in', today).lte('check_in', d(today, opts.days ?? 7)).limit(200)
  const { data: arrivals } = await q
  if (!arrivals?.length) return rep

  for (const r of arrivals) {
    if (over()) break
    rep.looked++
    try {
      if (!r.listing_id || !r.check_in) { rep.skipped++; continue }
      const key = guestKey(r)
      if (!key) { rep.skipped++; continue }

      // This stay's own log first, the person's profile behind it: what they told us THIS time
      // outranks what we remember, and the profile fills the gaps.
      const [own, prof] = await Promise.all([understandingFor(String(r.id)), profileFor(key)])
      const u: Understanding = { ...(prof?.data || {}), ...(own?.data || {}) }
      const stays = prof?.stays || 0
      // A returning guest is worth telling the team about even when we learned nothing else.
      if (!worthPushing(u) && stays < 2) { rep.skipped++; continue }

      const brief = shortBrief({ name: r.guest_name, u, stays, checkIn: r.check_in })
      const dig = digestOf(brief)
      const targets = await targetTasks(String(r.listing_id), String(r.check_in))
      if (!targets.length) { rep.skipped++; continue }

      const { data: done } = await db.from('guest_brief_pushes').select('bz_task_id,digest').eq('reservation_id', String(r.id))
      const already = new Map((done || []).map((x: any) => [String(x.bz_task_id), String(x.digest || '')]))

      for (const t of targets) {
        if (over()) break
        if (already.get(t.id) === dig) continue           // unchanged — nothing to say twice
        const cur = await retrieveBreezewayTask(t.id)
        if (!cur.ok) { rep.errors.push(`read task ${t.id}: ${cur.status}`); continue }
        const description = stampBrief(String(cur.data?.description ?? cur.data?.details ?? ''), brief)
        const up = await updateBreezewayTask(t.id, { description })
        if (!up.ok) { rep.errors.push(`task ${t.id}: ${up.status} ${String(up.text || '').slice(0, 80)}`); continue }
        await db.from('guest_brief_pushes').upsert({
          reservation_id: String(r.id), bz_task_id: t.id, digest: dig, pushed_at: new Date().toISOString(),
        }, { onConflict: 'reservation_id,bz_task_id' })
        rep.pushed++
      }
    } catch (e: any) {
      rep.errors.push(`res ${r.id}: ${String(e?.message || e).slice(0, 120)}`)
    }
  }
  return rep
}
