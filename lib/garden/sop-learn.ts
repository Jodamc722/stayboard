// ADAM LEARNS THE SOPs FROM CLOUDBEDS, TWO WAYS (Jon, 2026-11-13: "learn its SOP from Cloudbeds" → both).
//
//   1. THE CLOUDBEDS WAY   how Cloudbeds itself says each front-desk job is done — check-in and
//      check-out, the full-payment rule, payments / holds / refunds, cancellations and no-shows, OTA
//      bookings, notes, housekeeping conditions, the morning run. Written here in our own words from
//      Cloudbeds' help center (read 2026-11-13; each guide names its source page), filed in Adam's
//      library as 'reference' and learned, so he can answer "how do I do X in Cloudbeds".
//   2. THE WAY OUR DESK DOES IT   read from the hotel's own Cloudbeds data over the last 60 days — the
//      desk's notes and their shorthand, statuses, balances at arrival and departure, payments, room
//      conditions, cleans, calls, verifications — and written up as a DRAFT SOP with the places
//      practice differs from the Cloudbeds way and the questions only Jon can answer. A draft is NOT
//      policy: it is filed inactive (Adam does not quote or learn it) until someone approves it.
//
// Menus change; if a step here stops matching the screen, the source page wins — re-read and edit.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { anthropicMessages, textOf } from '../anthropic-call'
import { modelPairFor } from '../ai-models'
import { saveAdamDoc } from './adam-docs'
import { readNote } from './notes-read'

const HC = 'https://myfrontdesk.cloudbeds.com/hc/en-us/articles/'
export const DRAFT_PREFIX = 'DRAFT — '

export const CLOUDBEDS_GUIDES: { title: string; source: string; body: string }[] = [
  { title: 'Cloudbeds how-to: the morning run', source: HC + '40771665486363', body: `# Start of day in Cloudbeds
- Open the Dashboard, "Today" view: Arrivals, Departures, In-house and Overbookings.
- Find arrivals with no room: on the Calendar click the number above the date to open Assignments, or in the Reservations list look for "N/A" under Room Number. Assign every arrival a room before the guest is at the desk.
- With Housekeeping enabled, check Clean / Dirty on the Calendar or the Dashboard before promising a room.
- Check-in and check-out can be done in bulk: the arrow beside the button offers the current guest, everyone in the reservation, or everyone in the group.
# Fixing a folio
- Cloudbeds lets you add a payment taken earlier as a record, record a refund without sending money, adjust a charge, void a transaction, cancel a scheduled payment and add room revenue.
- Folio edits change the financial reports. Check the date and the amount before saving.` },
  { title: 'Cloudbeds how-to: check-in and check-out', source: HC + '221677468', body: `# Rules
- A guest can be checked in only when the arrival date is today or earlier; checked out only when the departure date is today or earlier.
- A reservation in "Confirmation Pending" must be confirmed before check-in.
- The guest must be assigned a room before check-in.
- For an OTA booking, a change of dates also has to be made in the OTA's extranet.
# Check in
- Calendar: click the reservation, then "Check-In Guest" (or "Check-In & Go to Reservation").
- Dashboard: Arrivals tab, the arrow icon, Check-In.
- Reservation page: set Reservation Status to In-House and confirm. Or on the Accommodations tab switch "Occupied" to YES.
# Check out
- Calendar: click the reservation, "Check-Out Guest". Dashboard: Departures tab, arrow icon, Check-Out. Reservation page: status Checked Out, confirm.
- Switching "Occupied" to NO checks out the whole reservation — read the warning.
# Leaving early
- Shorten the stay first (Calendar "Quick Edit" then "Save updates", or "Edit Reservation" on the reservation), then check out. Changing dates can change the price: check the balance before the guest leaves.
# What it does to the room
- Checking a guest in marks the room Dirty. Moving an in-house guest marks the room they left Dirty.` },
  { title: 'Cloudbeds how-to: guest owes money at check-in', source: HC + '217997598', body: `# The full-payment rule
- Setting: Account > Settings > System > Preferences, the toggle "Require the full payment amount of the reservation to be collected prior to check-in".
- When it is on, Cloudbeds blocks check-in while the reservation has a balance due and shows a warning.
- To check the guest in: add the remaining amount as a payment so the balance is zero, then check in. A payment taken outside Cloudbeds can be added as a record.
- Who can change the setting: a role with the Hotel Policies permission (Users > Roles > edit the role).` },
  { title: 'Cloudbeds how-to: payments, holds and refunds', source: HC + '360040784314', body: `# Take a payment
- Reservation > Folio > open the folio > +Add > Payment. Pick the guest, the folio and the amount (it defaults to the balance due). Payment Type: Card; choose a stored card or "+ Add new card".
- Three kinds: Online Payment charges the card now. Online Authorization holds an amount to capture later. Offline Payment only records it on the folio — the card is NOT charged.
- Online payments are always dated today.
# Hold a card (pre-authorisation)  — source ${HC}218513137
- The card must be stored on the reservation first: Credit Cards tab > +ADD (or "Add with Terminal", which only saves the card — it does not hold anything).
- Select the card > AUTHORIZE > amount > AUTHORIZE.
- A hold cannot be increased: void it and authorise again (the earlier hold is released, so make sure the card still has the funds).
- Capture can be for the held amount or less (the rest is released); more than the hold fails.
- Void releases the hold; the guest's bank can take up to 14 days to show it.
- Holds expire (with Stripe, 30 days in most regions). After expiry Cloudbeds can no longer capture or void — for a long stay, authorise closer to arrival.
- The history is on the reservation: Credit Cards tab > Logs.
# Refund  — source ${HC}219779888
- From a gateway payment in the folio, the gear icon offers refund. Online sends money back to the card; Offline only adds a folio line.
- Recording a refund: Folio > Add/Refund Payment > Refund Payment > fill type, amount, date, note > "Add Refund". It shows in red in the Credit column.
- A refund record cannot be deleted. To undo a mistaken one, add a payment.` },
  { title: 'Cloudbeds how-to: cancellations, no-shows and OTA bookings', source: HC + '219146188', body: `# Cancel a direct reservation — money first, then the status
- Settle first: charge cancellation revenue (Folio > Add Adjust/Charge > Add Room Revenue, type Cancellation) or a cancellation fee, or refund the deposit, or zero the balance (Accommodations tab > Edit Price > 0.00 for every date > Save Updates).
- Then set the status to Cancelled > Continue > "Confirm Cancellation" or one of the "Cancel and Email Guest" options.
- Cancelling never refunds by itself; posted transactions stay on the folio.
# OTA reservations  — source ${HC}216541178
- Only some channels can be cancelled from inside Cloudbeds (Airbnb, Vrbo, Hostelworld and a few others). Booking.com allows it only after the card was reported invalid. If no pop-up appears when you set Canceled, cancel in the channel's extranet.
- No-show, date changes, guest details and room type for an OTA booking are changed in the channel's extranet (or by the guest) — not in Cloudbeds.
- Setting a cancelled OTA booking back to Confirmed in Cloudbeds does not reopen it on the channel.
- A room you reassign in Cloudbeds is put back if the guest later changes the booking on the channel.
- Once a guest is in house, channel changes are not applied automatically: the property gets an email and makes the change by hand.
# Statuses
- Confirmed, Confirmation Pending, Canceled, In-house, Checked out, No Show. OTA bookings arrive Confirmed.` },
  { title: 'Cloudbeds how-to: reservation notes', source: HC + '217997148', body: `# Notes
- Add: reservation > Notes tab > type > Submit Note. From the Calendar: click the reservation, Notes tab. From the Dashboard: the note icon beside the guest's name.
- Edit: the gear beside the note > Edit Note. Archive: gear > Archive Note. Notes can be archived, never deleted.
- Guests never see notes. They export with the Notes Report.
- A note that shows on the Calendar but not on the reservation is on the guest's profile, not the reservation.
- An OTA guest's special requests are under "Show More" and cannot be edited; custom fields show there too.` },
  { title: 'Cloudbeds how-to: housekeeping and room conditions', source: HC + '216540808', body: `# What the three conditions mean
- Dirty: occupied, under maintenance, or not ready for a guest.
- Clean: vacant and cleaned, still to be inspected.
- Inspected: vacant, cleaned and checked by a supervisor — ready for the next guest. Inspected is OFF by default: Main menu > Housekeeping > Settings > "Enable Inspected Room Condition" (owners and administrators only).
# What Cloudbeds does by itself
- Around 2:00 AM every occupied room is set to Dirty as a reminder to service it. It does not mean the room is physically dirty.
- Checking a guest in sets the room Dirty. Moving an in-house guest sets the room they left Dirty.
- A room's condition does not change what can be sold: a Dirty room is still bookable unless it is Out of Service or blocked.
# Working it  — source ${HC}25695101078427
- Main Menu > Housekeeping. The three-dots button opens Housekeepers and Settings; add a housekeeper there (name > Save).
- A housekeeper is a person rooms are assigned to; it is not a login. Access comes from the user's role.
- To see conditions on the Calendar: Housekeeping > Settings > "Show accommodation condition in calendar". Dirty rooms show an asterisk.
- A room's condition can also be set from the reservation: Accommodations tab, the condition dropdown.
- The housekeeping schedule cannot be texted from Cloudbeds; it is viewed in the PMS or the mobile app, printed or exported.` },
]

/** File the Cloudbeds guides in Adam's library and have him learn them. Re-running replaces them by title. */
export async function learnCloudbedsGuides(by: string | null): Promise<{ filed: number; learned: number; errors: string[] }> {
  let filed = 0, learned = 0; const errors: string[] = []
  for (const g of CLOUDBEDS_GUIDES) {
    try {
      const r = await saveAdamDoc({ title: g.title, category: 'reference', source: g.source, body: `${g.body}\n\nSource: Cloudbeds help center, ${g.source} (read 2026-11-13). This is how Cloudbeds works, not the hotel's own policy — where the hotel's handbook says otherwise, the handbook wins.`, by })
      filed++; learned += r.learned.length
    } catch (e: any) { errors.push(`${g.title}: ${String(e?.message || e).slice(0, 120)}`) }
  }
  return { filed, learned, errors }
}

const scrub = (t: string) => String(t || '').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/\+?\d[\d\s().-]{7,}\d/g, '[number]').slice(0, 400)
const pct = (a: number, b: number) => b ? Math.round((a / b) * 100) : 0
const safe = async <T,>(q: PromiseLike<{ data: T | null }>): Promise<T | null> => { try { return (await q).data } catch { return null } }

/** What the last `days` of the hotel's own data says about how the desk works — numbers and note samples, no guest contact details. */
export async function deskEvidence(days = 60) {
  const db = supabaseAdmin()
  const since = new Date(Date.now() - days * 86400000).toISOString(), sinceDay = since.slice(0, 10), today = new Date().toISOString().slice(0, 10)
  const [res, notes, tasks, pays, calls, vers, queue, rooms] = await Promise.all([
    safe<any[]>(db.from('garden_reservations').select('id,status,check_in,check_out,nights,source,total,balance,room_ids,booked_at').gte('check_out', sinceDay).lte('check_in', today).limit(5000)),
    safe<any[]>(db.from('garden_messages').select('thread_id,body,author,sent_at').like('thread_id', 'note:%').gte('sent_at', since).order('sent_at', { ascending: false }).limit(1500)),
    safe<any[]>(db.from('garden_tasks').select('date,kind,status,assigned_to,started_at,finished_at,source').gte('date', sinceDay).limit(8000)),
    safe<any[]>(db.from('garden_payments').select('reservation_id,kind,method,amount,paid_at').gte('paid_at', since).limit(5000)),
    safe<any[]>(db.from('garden_calls').select('kind,outcome,called_at').gte('called_at', since).limit(3000)),
    safe<any[]>(db.from('garden_verifications').select('kind,status').limit(5000)),
    safe<any[]>(db.from('garden_call_queue').select('kind,status').gte('created_at', since).limit(5000)),
    safe<any[]>(db.from('garden_rooms').select('hk_status,occupied,housekeeper,dnd,refused_service')),
  ])
  const R = res || [], N = notes || [], T = tasks || [], P = pays || [], C = calls || [], V = vers || [], Q = queue || [], RM = rooms || []
  const count = (a: any[], f: (x: any) => string) => { const o: Record<string, number> = {}; for (const x of a) { const k = f(x) || '—'; o[k] = (o[k] || 0) + 1 } return o }
  // Notes: tags, who writes them, and a sample of the wording.
  const tagN: Record<string, number> = {}, writers: Record<string, number> = {}
  const noted = new Set<string>()
  for (const n of N) { noted.add(String(n.thread_id).slice(5)); const rd = readNote(n.body); for (const t of rd.tags) tagN[t.label.replace(/^\d+ /, 'N ')] = (tagN[t.label.replace(/^\d+ /, 'N ')] || 0) + 1; for (const i of rd.initials) writers[i] = (writers[i] || 0) + 1 }
  const past = R.filter(r => r.check_out < today && !['canceled', 'no_show'].includes(r.status))
  const payBy: Record<string, { first: string; n: number }> = {}
  for (const p of P) if (p.reservation_id && p.paid_at && p.kind !== 'refund') { const b = payBy[p.reservation_id] = payBy[p.reservation_id] || { first: p.paid_at, n: 0 }; b.n++; if (p.paid_at < b.first) b.first = p.paid_at }
  let before = 0, onDay = 0, after = 0
  for (const r of R) { const b = payBy[r.id]; if (!b || !r.check_in) continue; const d = b.first.slice(0, 10); if (d < r.check_in) before++; else if (d === r.check_in) onDay++; else after++ }
  const done = T.filter(t => t.status === 'done' && t.started_at && t.finished_at)
  const mins = (k: string) => { const a = done.filter(t => t.kind === k).map(t => (Date.parse(t.finished_at) - Date.parse(t.started_at)) / 60000).filter(m => m > 2 && m < 240).sort((x, y) => x - y); return a.length ? { n: a.length, median: Math.round(a[Math.floor(a.length / 2)]) } : null }
  const hourET = (iso: string) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(new Date(iso)))
  const finHours = count(T.filter(t => t.kind === 'clean' && t.finished_at), t => String(hourET(t.finished_at)).padStart(2, '0') + 'h')
  return {
    window: `${sinceDay} → ${today}`,
    reservations: { total: R.length, byStatus: count(R, r => r.status), bySource: count(R, r => r.source || 'Direct'), unassignedArrivalsNext: R.filter(r => r.check_in >= today && !(r.room_ids || []).length).length,
      stayedButNeverCheckedOutInCloudbeds: past.filter(r => r.status !== 'checked_out').length, pastStays: past.length,
      leftWithBalance: past.filter(r => Number(r.balance) > 0).length, leftWithBalanceTotal: Math.round(past.filter(r => Number(r.balance) > 0).reduce((a, r) => a + Number(r.balance), 0)),
      inHouseNowStillConfirmed: R.filter(r => r.check_in < today && r.check_out > today && ['confirmed', 'not_confirmed'].includes(r.status)).length },
    notes: { count: N.length, reservationsWithANote: noted.size, shareOfReservationsWithANote: pct(noted.size, R.length), tags: tagN, writtenBy: writers, samples: N.slice(0, 120).map(n => scrub(n.body)) },
    payments: { count: P.length, byKind: count(P, p => p.kind), byMethod: count(P, p => String(p.method || '').slice(0, 30)), firstPayment: { beforeArrivalDay: before, onArrivalDay: onDay, afterArrivalDay: after } },
    housekeeping: { tasksByKindAndStatus: count(T, t => `${t.kind}:${t.status}`), startedAndFinishedInLighthouse: done.length, minutesPerCheckoutClean: mins('clean'), minutesPerStayover: mins('stayover'), checkoutCleansFinishedByHourET: finHours, unassignedTasks: T.filter(t => !t.assigned_to).length, tasks: T.length,
      roomsNow: { byCondition: count(RM, r => r.hk_status || 'unknown'), inspectedInUse: RM.some(r => r.hk_status === 'inspected'), withHousekeeper: RM.filter(r => r.housekeeper).length, dnd: RM.filter(r => r.dnd).length, refused: RM.filter(r => r.refused_service).length, rooms: RM.length } },
    calls: { byKindAndOutcome: count(C, c => `${c.kind}:${c.outcome}`), queueByKindAndStatus: count(Q, q => `${q.kind}:${q.status}`) },
    verifications: count(V, v => `${v.kind}:${v.status}`),
  }
}

/** Write the draft "how our desk works" SOP from the evidence, set against the Cloudbeds way. Filed inactive until approved. */
export async function observeDeskSop(by: string | null): Promise<{ ok: boolean; id?: string; title?: string; error?: string }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, error: 'No AI key is set, so the draft cannot be written.' }
  const ev = await deskEvidence(60)
  if (!ev.reservations.total) return { ok: false, error: 'No reservations mirrored from Cloudbeds in the last 60 days — sync Cloudbeds first.' }
  const { model, fallback } = await modelPairFor('adam-study')
  const official = CLOUDBEDS_GUIDES.map(g => `## ${g.title}\n${g.body}`).join('\n\n')
  const r = await anthropicMessages(key, {
    model, max_tokens: 6000,
    system: `You are writing the Garden Hotel's front desk and housekeeping SOP from evidence, for the general manager to correct and approve. You are given (1) numbers and note samples from the hotel's own Cloudbeds data, and (2) how Cloudbeds itself says each job is done.
Write plain markdown with exactly these sections:
# How the desk works today (observed)
  Sub-sections: Before arrival · Check-in · Payments and balances · Notes and shorthand · During the stay · Check-out · Housekeeping · Calls and verification. In each, state what the data shows the team actually does, as numbered steps where the pattern is clear, each with the number that supports it in brackets. Decode the desk's shorthand from the note samples.
# Where practice differs from the Cloudbeds way
  One bullet per gap: what Cloudbeds expects, what the data shows, why it matters (money, a guest, or a wrong report), and the fix.
# Questions for Jon
  The decisions the data cannot answer (at most 10), each answerable in one line.
Rules: only claim what the evidence supports; when a number is too small to trust, say so; never invent a policy, a price or a time; no guest names; keep it under 1,100 words; write for a front desk agent, short sentences.`,
    messages: [{ role: 'user', content: `EVIDENCE (the hotel's Cloudbeds data, ${ev.window}):\n${JSON.stringify(ev).slice(0, 60000)}\n\nTHE CLOUDBEDS WAY:\n${official.slice(0, 20000)}` }],
  }, fallback, 'adam-study')
  if (!r.ok) return { ok: false, error: 'The draft could not be written just now — try again.' }
  const text = textOf(r.data).trim()
  if (text.length < 200) return { ok: false, error: 'The draft came back empty — try again.' }
  const title = `${DRAFT_PREFIX}How the desk works (observed ${new Date().toISOString().slice(0, 10)})`
  const body = `> DRAFT — written from the hotel's Cloudbeds data (${ev.window}). Not policy until approved. Edit anything that is wrong before approving.\n\n${text}`
  const saved = await saveAdamDoc({ title, category: 'sop', source: 'observed from Cloudbeds', body, learn: false, by })
  await supabaseAdmin().from('garden_agent_docs').update({ active: false }).eq('id', saved.id)
  return { ok: true, id: saved.id, title }
}

/** Approve a draft (optionally with the edited text): it becomes a live SOP and Adam learns it. */
export async function approveDraft(id: string, body: string | null, by: string | null): Promise<{ ok: boolean; title?: string; learned?: number; error?: string }> {
  const db = supabaseAdmin()
  const { data: d } = await db.from('garden_agent_docs').select('id,title,body,category').eq('id', id).maybeSingle()
  if (!d) return { ok: false, error: 'Draft not found.' }
  const title = String((d as any).title).replace(DRAFT_PREFIX, '').replace(/\s*\(observed [\d-]+\)/, '') + ` (approved ${new Date().toISOString().slice(0, 10)})`
  const text = (body && body.trim().length > 40 ? body : String((d as any).body)).replace(/^> DRAFT[^\n]*\n+/, '')
  await db.from('garden_agent_docs').update({ active: false, title: String((d as any).title) + ' · superseded' }).eq('id', id)
  const saved = await saveAdamDoc({ title, category: 'sop', source: `approved by ${by || 'the hotel'}`, body: text, by })
  return { ok: true, title, learned: saved.learned.length }
}

export async function draftDocs() {
  const { data } = await supabaseAdmin().from('garden_agent_docs').select('id,title,body,words,added_by,updated_at').eq('active', false).like('title', `${DRAFT_PREFIX}%`).not('title', 'like', '%superseded').order('updated_at', { ascending: false }).limit(5)
  return data || []
}
