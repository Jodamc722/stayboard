// THE GUEST-MOVE WATCH (Jon, 2026-10-07: "we had moved a guest from one unit to the other. We have
// an incoming guest coming in, and it seems like nobody knows what's going on except for Roberto …
// build an agent that's looking at this, looking at messages, looking at blocked units where it
// says 'moved a guest', and just making sure there are no conflicts").
//
// Guesty overwrites a reservation's unit in place — there is no history of a move to read — so the
// watch looks for what a move BREAKS, plus the places a move gets written down:
//   1. DOUBLE BOOKED   two live reservations on one unit whose nights overlap
//   2. GUEST IN A BLOCK a live reservation on a unit that is blocked for those nights (the old unit
//                      blocked after the move, while the reservation still sits on it — or the new
//                      unit was blocked and nobody lifted it)
//   3. NOTICE WRONG    a front-desk arrival notice that went out for a different unit than the one
//                      the reservation is on now (the building expects the guest in the old unit)
//   4. MOVE MENTIONED  a block note, or something we wrote to a guest, saying a guest was moved /
//                      relocated / switched units, for a stay that is in-house or arriving within
//                      3 days — a heads-up so the whole team knows, not only the person who did it
// Each finding becomes a HANDOFF ALERT (lib/handoff-store raiseEveAlert): a banner on every
// Lighthouse page until confirmed, and a post in #vr-customercareteam tagging Roberto, Karla and
// Silvia. One alert per finding — the same conflict found on the next run does not post again.
// Window: stays that are in-house or arrive in the next 14 days.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { isLiveStay } from './stay-status'

export type MoveFinding = { kind: 'double' | 'blocked' | 'notice' | 'mention'; dedupe: string; title: string; body: string; unit: string; severity: 'info' | 'warn' | 'urgent' }

const MOVE_WORDS = /\b(mov(e|ed|ing)|relocat(e|ed|ing|ion)|transferr?(ed|ing)?|switch(ed|ing)? (the )?(unit|apartment|apt|room)s?|swapp?(ed|ing)? (unit|apartment|apt|room)s?|new unit|different unit|upgrad(e|ed) (you|them|the guest) to)\b/i
// In a guest thread, only lines that say WE moved them somewhere — not "we're moving to Miami".
const MOVED_GUEST = /\b(moved|relocat(ed|ing)|transferr?ed|switch(ed|ing)|upgrad(ed|ing))\b[^.!?\n]{0,60}\b(you|your (stay|reservation|booking)|the guest|them|her|him)\b[^.!?\n]{0,40}\b(to|into)\b|\b(your|the) new (unit|apartment|apt|room)\b|\b(we('ve| have)?|i('ve| have)?) (moved|relocated|switched|transferred)\b/i

const ymd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const nice = (s: string) => { try { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(s + 'T12:00:00Z')) } catch { return s } }
const stay = (r: any) => `${r.guest_name || 'Guest'} (${nice(String(r.check_in).slice(0, 10))}–${nice(String(r.check_out).slice(0, 10))}${r.confirmation_code ? ', ' + r.confirmation_code : ''})`
const clip = (s: any, n: number) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }

export async function findMoveConflicts(): Promise<{ findings: MoveFinding[]; checked: { reservations: number; blocks: number; notices: number; messages: number }; errors: string[] }> {
  const db = supabaseAdmin()
  const today = ymd(new Date())
  const horizon = addDays(today, 14)
  const errors: string[] = []
  const findings: MoveFinding[] = []

  // In-house or arriving in the window. check_out > today keeps the in-house; check_in ≤ horizon.
  const { data: resRows, error: resErr } = await db.from('guesty_reservations')
    .select('id,listing_id,listing_name,guest_name,check_in,check_out,status,confirmation_code,conversation_id')
    .gt('check_out', today).lte('check_in', horizon).limit(3000)
  if (resErr) errors.push('reservations: ' + resErr.message)
  const res = ((resRows || []) as any[]).filter(r => isLiveStay(r.status) && r.listing_id && r.check_in && r.check_out)
  const byListing: Record<string, any[]> = {}
  for (const r of res) (byListing[String(r.listing_id)] ||= []).push(r)
  const unitName = (r: any) => String(r.listing_name || 'Unit')

  // ── 1. DOUBLE BOOKED ──
  for (const [lid, rs] of Object.entries(byListing)) {
    const s = rs.slice().sort((a, b) => String(a.check_in).localeCompare(String(b.check_in)))
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
      const a = s[i], b = s[j]
      if (String(b.check_in) >= String(a.check_out)) break   // sorted: nothing later overlaps a
      findings.push({
        kind: 'double', severity: 'urgent', unit: unitName(a),
        dedupe: 'move:double:' + [a.id, b.id].sort().join('+'),
        title: `Double booked: ${unitName(a)}`,
        body: `Two live reservations overlap on ${unitName(a)}: ${stay(a)} and ${stay(b)}. If one of them was moved to another unit, the move did not reach Guesty — move it there before the arrival.`,
      })
      void lid
    }
  }

  // ── 2. GUEST IN A BLOCKED UNIT, and 4a. block notes that mention a move ──
  let blocks = 0
  try {
    const { blockedUnits } = await import('./blocked-units')
    const rep = await blockedUnits(15)
    blocks = rep.runs.length
    for (const b of rep.runs) {
      const from = String(b.from), to = String(b.to)
      const clash = (byListing[String(b.listingId)] || []).filter(r => String(r.check_in) <= to && String(r.check_out) > from)
      for (const r of clash) {
        findings.push({
          kind: 'blocked', severity: 'urgent', unit: b.unit,
          dedupe: 'move:blocked:' + r.id + ':' + b.listingId + ':' + from,
          title: `Guest booked into a blocked unit: ${b.unit}`,
          body: `${stay(r)} is on ${b.unit}, but the unit is blocked ${nice(from)}–${nice(to)}${b.guestyLabel ? ' (' + b.guestyLabel + ')' : ''}${b.note ? ': “' + clip(b.note, 160) + '”' : ''}. Either the guest was moved and the reservation still sits on this unit, or the block needs lifting.`,
        })
      }
      if (b.note && MOVE_WORDS.test(b.note) && !clash.length && from <= addDays(today, 3)) {
        findings.push({
          kind: 'mention', severity: 'warn', unit: b.unit,
          dedupe: 'move:blocknote:' + b.listingId + ':' + from,
          title: `Guest move noted on ${b.unit}`,
          body: `${b.unit} is blocked ${nice(from)}–${nice(to)} with the note “${clip(b.note, 200)}”${b.createdBy ? ' (' + b.createdBy + ')' : ''}. Make sure the new unit is cleaned and inspected, the door code and arrival notice point at it, and the guest has the right instructions.`,
        })
      }
    }
  } catch (e: any) { errors.push('blocks: ' + String(e?.message || e).slice(0, 120)) }

  // ── 3. FRONT-DESK NOTICE FOR THE WRONG UNIT ──
  let notices = 0
  try {
    const codes = res.map(r => r.confirmation_code).filter(Boolean)
    if (codes.length) {
      const { data: nrows } = await db.from('reservation_notices').select('confirmation_code,listing_id,unit_no,arrival_date,sent_at').in('confirmation_code', codes.slice(0, 900))
      const byCode: Record<string, any> = {}
      for (const r of res) if (r.confirmation_code) byCode[String(r.confirmation_code)] = r
      for (const n of (nrows || []) as any[]) {
        notices++
        const r = byCode[String(n.confirmation_code)]
        if (!r || !n.listing_id || String(n.listing_id) === String(r.listing_id)) continue
        findings.push({
          kind: 'notice', severity: 'urgent', unit: unitName(r),
          dedupe: 'move:notice:' + r.id + ':' + r.listing_id,
          title: `Arrival notice is for the old unit: ${r.guest_name || 'guest'}`,
          body: `The front-desk notice for ${stay(r)} ${n.sent_at ? 'went out' : 'was drafted'} for unit ${n.unit_no || 'another unit'}, but the reservation is now on ${unitName(r)}. Send the building a corrected notice for the new unit.`,
        })
      }
    }
  } catch (e: any) { errors.push('notices: ' + String(e?.message || e).slice(0, 120)) }

  // ── 4b. A MOVE MENTIONED TO A GUEST (what we wrote in the last 72 hours) ──
  let messages = 0
  try {
    const soon = res.filter(r => String(r.check_in) <= addDays(today, 3))
    const convIds = soon.map(r => r.conversation_id).filter(Boolean)
    if (convIds.length) {
      const since = new Date(Date.now() - 72 * 3600_000).toISOString()
      const { data: msgs } = await db.from('guesty_messages').select('conversation_id,sender,body,sent_at').in('conversation_id', convIds.slice(0, 900)).gte('sent_at', since).limit(4000)
      const byConv: Record<string, any> = {}
      for (const r of soon) if (r.conversation_id) byConv[String(r.conversation_id)] = r
      const seen = new Set<string>()
      for (const m of (msgs || []) as any[]) {
        messages++
        if (/guest|inbound/i.test(String(m.sender || ''))) continue   // what WE said
        const body = String(m.body || '')
        const hit = body.match(MOVED_GUEST)
        if (!hit) continue
        const r = byConv[String(m.conversation_id)]
        if (!r || seen.has(r.id)) continue
        seen.add(r.id)
        const at = Math.max(0, hit.index || 0)
        findings.push({
          kind: 'mention', severity: 'warn', unit: unitName(r),
          dedupe: 'move:msg:' + r.id,
          title: `Guest moved: ${r.guest_name || 'guest'} → ${unitName(r)}`,
          body: `We told ${stay(r)}: “${clip(body.slice(Math.max(0, at - 60), at + 160), 220)}”. The reservation is on ${unitName(r)} now. Everyone on shift should know: the clean and inspection for this unit, the door code, and the front-desk notice must all point at it.`,
        })
      }
    }
  } catch (e: any) { errors.push('messages: ' + String(e?.message || e).slice(0, 120)) }

  return { findings, checked: { reservations: res.length, blocks, notices, messages }, errors }
}

/** Find and raise. Returns how many new alerts went out (the rest were already open). */
export async function runMoveWatch(): Promise<{ found: number; raised: number; errors: string[]; checked: any; findings: MoveFinding[] }> {
  const r = await findMoveConflicts()
  const { raiseEveAlert } = await import('./handoff-store')
  let raised = 0
  for (const f of r.findings.slice(0, 12)) {
    try { if (await raiseEveAlert({ title: f.title, body: f.body, unit: f.unit, dedupe: f.dedupe, severity: f.severity })) raised++ } catch (e: any) { r.errors.push('raise: ' + String(e?.message || e).slice(0, 80)) }
  }
  return { found: r.findings.length, raised, errors: r.errors, checked: r.checked, findings: r.findings }
}
