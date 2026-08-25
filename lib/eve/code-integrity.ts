// ARE THE DOOR CODES ACTUALLY RIGHT? (Jon, 2026-08-24: "So how do we ensure codes are accurate")
//
// Everything in door-code.ts protects against sending a code to the WRONG PERSON or at the wrong
// moment. None of it protects against the code itself being wrong — and a confidently-delivered
// wrong code is arguably worse than a refusal, because the tech drives there first.
//
// There is no lock integration, so nothing here can read a keypad. What it can do is stop treating
// the Guesty field as self-evidently true and start treating it as a CLAIM with evidence for and
// against. Four kinds of evidence, cheapest first:
//
//   1. SHAPE      — is this even a code? "see notes", "1234 or 5678", a phone number and a wifi
//                   password have all lived in fields like this one.
//   2. AGREEMENT  — the code usually also appears in the check-in instructions or the access text.
//                   Two places in Guesty that should say the same thing and do not is a strong,
//                   free signal, and it is the single most common way a rotated code goes stale:
//                   somebody updates one and not the other.
//   3. UNIQUENESS — the same code on six units is either a deliberate policy or a copy-paste, and
//                   copy-paste means somebody is being sent to the right door with a neighbour key.
//   4. USE        — did it actually open the door. This is the only real ground truth, and it costs
//                   one tap: the release DM asks, and the answer is recorded against the code.
//
// WHAT NEVER LEAVES THIS FILE IS THE CODE. Every finding describes the PROBLEM ("the field and the
// check-in instructions disagree", "shared with 4 other units") and never the digits. Fingerprints
// are sha256-truncated: not a security boundary — the plaintext already sits in guesty_listings.raw
// — but it keeps the code out of a second table, out of audit rows, and out of anything Eve reads.
import 'server-only'
import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { lc, DEAD_LISTING } from './ctx'

export const DOOR_CODE_FIELD = '695af1454ebbdc00137c3f41'

export function fingerprint(code: string): string {
  return createHash('sha256').update(String(code || '').replace(/\s+/g, '').toLowerCase()).digest('hex').slice(0, 16)
}

// -------------------------------------------------------------------------------------------
// 1. SHAPE
// -------------------------------------------------------------------------------------------
const POINTER = /\b(see|ask|check|refer|tbd|t\.b\.d|n\/a|none|unknown|same as|per |in the|notes?|manager|office)\b/i
const MULTI = /\b\d{4,8}\b[^\d]{1,20}\b\d{4,8}\b/
const PHONEY = /^\+?1?[\s\-.(]*\d{3}[\s\-.)]*\d{3}[\s\-.]*\d{4}$/

export type CodeShape = {
  usable: boolean
  digits: number
  length: number
  problems: string[]
}

export function inspectCode(raw: any): CodeShape {
  const v = String(raw ?? '').trim()
  const problems: string[] = []
  const digits = (v.match(/\d/g) || []).length

  if (!v) return { usable: false, digits: 0, length: 0, problems: ['the field is empty'] }
  if (POINTER.test(v)) problems.push('the field points somewhere else instead of holding a code')
  if (MULTI.test(v)) problems.push('the field contains more than one number, so nobody can tell which is the code')
  if (PHONEY.test(v.replace(/\s+/g, ' '))) problems.push('the value is shaped like a phone number')
  if (v.split(/\s+/).length > 3) problems.push('the field reads as a sentence rather than a code')
  if (digits === 0) problems.push('there are no digits in it at all')
  else if (digits < 4) problems.push(`only ${digits} digit${digits === 1 ? '' : 's'} — shorter than any keypad we use`)
  else if (digits > 10) problems.push(`${digits} digits — longer than a keypad code, so there is probably extra text in the field`)

  return { usable: problems.length === 0, digits, length: v.length, problems }
}

// -------------------------------------------------------------------------------------------
// 2. AGREEMENT — does the rest of the listing say the same code?
// -------------------------------------------------------------------------------------------
const NEAR_CODE = /(code|keypad|key pad|entry|access|lock|pin|door)\D{0,40}?(\d{4,8})/gi

/** Digit runs that are introduced as a code somewhere in free text. Bare numbers are ignored — a
 *  street number and a wifi password are not claims about the lock. */
export function codesInText(text: any): string[] {
  const s = String(text || '')
  if (!s) return []
  const out = new Set<string>()
  let m: RegExpExecArray | null
  NEAR_CODE.lastIndex = 0
  while ((m = NEAR_CODE.exec(s)) !== null) out.add(m[2])
  return Array.from(out)
}

export type CodeConflict = { where: string; agrees: boolean }

/** Compare the custom field against every place in the listing that also claims to state a code. */
export function crossCheck(raw: any, code: string): { checked: number; conflicts: CodeConflict[] } {
  const mine = (String(code || '').match(/\d{4,10}/) || [''])[0]
  const sources: [string, any][] = [
    ['check-in instructions', raw?.checkInInstructions],
    ['the access section', raw?.publicDescription?.access],
    ['the house rules', raw?.publicDescription?.houseRules],
    ['the listing notes', raw?.publicDescription?.notes],
  ]
  const conflicts: CodeConflict[] = []
  let checked = 0
  for (const [where, text] of sources) {
    const found = codesInText(text)
    if (!found.length) continue
    checked++
    if (mine && !found.includes(mine)) conflicts.push({ where, agrees: false })
  }
  return { checked, conflicts }
}

// -------------------------------------------------------------------------------------------
// 3 + 4. STATE: drift over time, and whether it has ever actually opened a door
// -------------------------------------------------------------------------------------------
export type CodeState = {
  listing_id: string
  code_fp: string
  digits: number | null
  changed_at: string
  last_verified_at: string | null
  last_verified_by: string | null
  last_failed_at: string | null
  last_failed_by: string | null
  fail_count: number
}

export type Confidence = {
  level: 'verified' | 'unverified' | 'reported_wrong' | 'unknown'
  label: string
  /** True when somebody said this exact code did not work and nobody has changed it since. */
  suspect: boolean
  problems: string[]
  sharedWith: number
  conflicts: string[]
  transition?: Transition | null
}

/**
 * Everything we know about whether THIS code is right, for one unit, at request time. Returns no
 * digits — only a verdict and its reasons.
 */
export async function codeConfidence(listingId: string, code: string, raw: any): Promise<Confidence> {
  const db = supabaseAdmin()
  const fp = fingerprint(code)
  const shape = inspectCode(code)
  const cross = crossCheck(raw, code)

  let level: Confidence['level'] = 'unknown'
  let label = 'This code has never been confirmed working by anyone.'
  let suspect = false
  try {
    const { data } = await db.from('door_code_state').select('*').eq('listing_id', String(listingId)).maybeSingle()
    const st: any = data
    if (st && st.code_fp === fp) {
      const changed = Date.parse(st.changed_at || '') || 0
      const ok = Date.parse(st.last_verified_at || '') || 0
      const bad = Date.parse(st.last_failed_at || '') || 0
      if (bad > ok && bad > changed) {
        level = 'reported_wrong'; suspect = true
        label = `${st.last_failed_by || 'Someone'} reported this exact code did NOT work on ${String(st.last_failed_at).slice(0, 10)}, and it has not been changed since.`
      } else if (ok > changed) {
        const days = Math.round((Date.now() - ok) / 86400000)
        level = 'verified'
        label = `Confirmed working ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}${st.last_verified_by ? ` by ${st.last_verified_by}` : ''}.`
      } else {
        level = 'unverified'
        label = `Unchanged since ${String(st.changed_at).slice(0, 10)}, but nobody has confirmed it opens the door.`
      }
    }
  } catch { /* no state table yet — stays 'unknown', which is the honest answer */ }

  let sharedWith = 0
  try {
    const { data } = await db.from('door_code_state').select('listing_id').eq('code_fp', fp).limit(50)
    sharedWith = Math.max(0, (data || []).length - 1)
  } catch { /* ignore */ }

  return {
    level, label, suspect,
    problems: shape.problems,
    sharedWith,
    conflicts: cross.conflicts.map(c => c.where),
  }
}

/** Record a real-world outcome. This is the only ground truth in the whole file. */
export async function recordVerification(input: {
  listingId: string; codeFp: string; worked: boolean; by: string
  actionId?: string | null; note?: string | null
  which?: 'new' | 'old' | 'neither'
  /** "The old code worked" says nothing bad about the new one — log it, do not condemn it. */
  skipStateUpdate?: boolean
}): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  try {
    await db.from('door_code_verifications').insert({
      listing_id: input.listingId, code_fp: input.codeFp, worked: input.worked,
      reported_by: input.by, action_id: input.actionId || null, note: input.note || null,
      which: input.which || (input.worked ? 'new' : 'neither'),
    })
    if (input.skipStateUpdate) return { ok: true }
    const { data } = await db.from('door_code_state').select('*').eq('listing_id', input.listingId).maybeSingle()
    const st: any = data
    // Only move the verdict when the report is about the code we currently hold. A "did not work"
    // about a code that has since been rotated is history, not a live problem.
    if (st && st.code_fp === input.codeFp) {
      await db.from('door_code_state').update(input.worked
        ? { last_verified_at: now, last_verified_by: input.by, fail_count: 0 }
        : { last_failed_at: now, last_failed_by: input.by, fail_count: (st.fail_count || 0) + 1 }
      ).eq('listing_id', input.listingId)
    }
    return { ok: true }
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 200) } }
}


// -------------------------------------------------------------------------------------------
// THE TRANSITION WINDOW — old code until housekeeping changes the lock, new code after.
//
// Jon: "we create a new code and the old code should also show, because the codes are changed
// physically after the clean is done by HK" / "need old code to get in and post code after clean".
//
// Guesty is not the lock. The new code is entered at turnover; the keypad still holds the old one
// until a cleaner physically changes it at the end of the clean. In between, the code in Guesty is
// WRONG and the one nobody is looking at is RIGHT — and that gap is exactly when a tech gets sent,
// because the unit is empty.
//
// Whether housekeeping has been in is not a guess. It is a FINISHED cleaning task in Breezeway
// dated after the code changed. So we can say which code to try first and why, and show both.
// -------------------------------------------------------------------------------------------
export type Transition = {
  /** Which code we expect the keypad to hold right now. */
  expect: 'new' | 'old' | 'only_one'
  reason: string
  hasPrevious: boolean
  changedAt: string | null
  cleanFinishedAt: string | null
  cleanPendingToday: string | null
}

const CLEAN_RE = /clean|turnover|housekeep|hk\b/i

export async function transitionFor(listingId: string, today: string): Promise<Transition> {
  const db = supabaseAdmin()
  const none: Transition = { expect: 'only_one', reason: 'No recent code change on file, so what is in Guesty is all there is.', hasPrevious: false, changedAt: null, cleanFinishedAt: null, cleanPendingToday: null }
  let st: any = null
  try {
    const { data } = await db.from('door_code_state').select('*').eq('listing_id', String(listingId)).maybeSingle()
    st = data
  } catch { return none }
  if (!st || !st.previous_code) return { ...none, changedAt: st?.changed_at || null }

  const changedAt = String(st.changed_at || '')
  // A human confirming the NEW code opened the door beats any inference we could make.
  if (st.last_verified_at && Date.parse(st.last_verified_at) > Date.parse(changedAt)) {
    return {
      expect: 'new', hasPrevious: true, changedAt, cleanFinishedAt: null, cleanPendingToday: null,
      reason: `Somebody confirmed the new code opened the door on ${String(st.last_verified_at).slice(0, 10)}, so the lock has been changed.`,
    }
  }

  let finished: string | null = null
  let pendingToday: string | null = null
  try {
    const { data } = await db.from('breezeway_tasks_sync')
      .select('name,type_department,status,scheduled_date,finished_at')
      .eq('reference_property_id', String(listingId))
      .gte('scheduled_date', String(changedAt).slice(0, 10))
      .order('scheduled_date', { ascending: false }).limit(40)
    for (const t of (data || [])) {
      const row: any = t
      if (!CLEAN_RE.test(String(row.type_department || '') + ' ' + String(row.name || ''))) continue
      if (row.finished_at && Date.parse(row.finished_at) >= Date.parse(changedAt)) {
        if (!finished || Date.parse(row.finished_at) > Date.parse(finished)) finished = String(row.finished_at)
      } else if (String(row.scheduled_date).slice(0, 10) === today && !/cancel|delete/i.test(lc(row.status))) {
        pendingToday = String(row.name || 'the clean')
      }
    }
  } catch { /* fall through to the cautious answer */ }

  if (finished) {
    return {
      expect: 'new', hasPrevious: true, changedAt, cleanFinishedAt: finished, cleanPendingToday: pendingToday,
      reason: `Housekeeping finished a clean on ${String(finished).slice(0, 10)}, after the code changed — so the lock should now hold the NEW code. The old one is here in case it does not.`,
    }
  }
  return {
    expect: 'old', hasPrevious: true, changedAt, cleanFinishedAt: null, cleanPendingToday: pendingToday,
    reason: pendingToday
      ? `The code was changed in Guesty on ${changedAt.slice(0, 10)}, but the clean (${pendingToday}) is not finished yet — housekeeping changes the lock at the END of the clean, so the keypad almost certainly still has the OLD code.`
      : `The code was changed in Guesty on ${changedAt.slice(0, 10)} and no clean has been finished since. Housekeeping changes the lock during the clean, so the keypad probably still has the OLD code.`,
  }
}

/** Read both codes. ONLY ever called server-side at release, after a human has approved. */
export async function bothCodes(listingId: string, currentCode: string): Promise<{ current: string; previous: string | null }> {
  const db = supabaseAdmin()
  try {
    const { data } = await db.from('door_code_state').select('previous_code,current_code,code_fp').eq('listing_id', String(listingId)).maybeSingle()
    const st: any = data
    if (!st) return { current: currentCode, previous: null }
    // If the field has moved since the state row was last written, the row has not caught up yet:
    // what it still calls CURRENT is in fact the previous code, and that is the one the keypad
    // holds. Handing back a stale "previous" instead would send somebody to the door with a code
    // that was replaced two turnovers ago.
    if (st.code_fp !== fingerprint(currentCode)) return { current: currentCode, previous: st.current_code || st.previous_code || null }
    return { current: currentCode, previous: st.previous_code || null }
  } catch { return { current: currentCode, previous: null } }
}

/**
 * Keep one unit's state current at request time rather than waiting for the hourly audit. The FIRST
 * observer of a change is the one that gets to record what the code used to be, so this has to run
 * before anybody is told which code to type.
 */
export async function refreshOne(listingId: string, code: string, digits: number): Promise<void> {
  const db = supabaseAdmin()
  const fp = fingerprint(code)
  const now = new Date().toISOString()
  try {
    const { data } = await db.from('door_code_state').select('*').eq('listing_id', String(listingId)).maybeSingle()
    const st: any = data
    if (!st) {
      await db.from('door_code_state').insert({ listing_id: String(listingId), code_fp: fp, digits, current_code: code, changed_at: now, last_checked_at: now })
      return
    }
    if (st.code_fp === fp) {
      await db.from('door_code_state').update({ last_checked_at: now, current_code: code }).eq('listing_id', String(listingId))
      return
    }
    // It moved. Remember what it was — that value is what the keypad still holds until HK gets in.
    await db.from('door_code_state').update({
      code_fp: fp, digits, current_code: code, changed_at: now, last_checked_at: now,
      previous_code: st.current_code || null,
      previous_fp: st.code_fp,
      previous_seen_at: st.changed_at || now,
      last_verified_at: null, last_verified_by: null, last_failed_at: null, last_failed_by: null, fail_count: 0,
    }).eq('listing_id', String(listingId))
  } catch { /* state is an optimisation, never a gate */ }
}

// -------------------------------------------------------------------------------------------
// THE PORTFOLIO PASS — refresh drift state and report everything that looks wrong.
// -------------------------------------------------------------------------------------------
function codeOf(raw: any): string | null {
  const cf = Array.isArray(raw?.customFields) ? raw.customFields : []
  for (const c of cf) {
    const id = String(c?.fieldId?._id || c?.fieldId?.id || c?.fieldId || '')
    const nm = lc(c?.fieldId?.name || c?.name || c?.fieldName)
    if (id === DOOR_CODE_FIELD || /door\s*code|entry\s*code|access\s*code|keypad/.test(nm)) {
      const v = typeof c?.value === 'string' ? c.value.trim() : (c?.value != null ? String(c.value).trim() : '')
      if (v) return v
    }
  }
  return null
}

export type CodeAudit = {
  id: string; area: 'listings'; severity: 'critical' | 'warn' | 'info'
  title: string; detail: string; fix: string; count: number; evidence?: any
}

export async function auditCodes(): Promise<CodeAudit[]> {
  const db = supabaseAdmin()
  const out: CodeAudit[] = []
  const { data } = await db.from('guesty_listings').select('id,nickname,title,status,raw').order('id').limit(500)
  const live = (data || []).filter((l: any) => !DEAD_LISTING.test(lc(l.status)))
  if (live.length < 5) return out
  const now = new Date().toISOString()

  const malformed: string[] = []
  const conflicting: { unit: string; where: string[] }[] = []
  const byFp: Record<string, string[]> = {}
  const stateRows: any[] = []

  for (const l of live) {
    const unit = l.nickname || l.title || String(l.id)
    const code = codeOf(l.raw)
    if (!code) continue                       // "no code at all" is already its own audit
    const fp = fingerprint(code)
    const shape = inspectCode(code)
    const cross = crossCheck(l.raw, code)

    if (!shape.usable) malformed.push(`${unit} (${shape.problems[0]})`)
    if (cross.conflicts.length) conflicting.push({ unit, where: cross.conflicts.map(c => c.where) })
    ;(byFp[fp] ||= []).push(unit)
    stateRows.push({ listing_id: String(l.id), code_fp: fp, digits: shape.digits, current_code: code, last_checked_at: now })
  }

  // Drift: a changed code is an UNVERIFIED code again. Whatever we knew about the old one tells us
  // nothing about the new one, and quietly carrying the old confirmation forward would be a lie.
  const { data: prior } = await db.from('door_code_state').select('listing_id,code_fp,current_code').limit(1000)
  const priorById: Record<string, any> = {}
  for (const r of (prior || [])) priorById[String((r as any).listing_id)] = r

  let changed = 0
  const upserts = stateRows.map(r => {
    const was = priorById[r.listing_id]
    const moved = was && was.code_fp !== r.code_fp
    if (moved) changed++
    if (!was) return { ...r, changed_at: now }
    // On drift the OLD value becomes previous_code — that is the code still on the keypad until
    // housekeeping physically changes it at the end of the clean.
    return moved
      ? { ...r, changed_at: now, previous_code: was.current_code || null, previous_fp: was.code_fp, previous_seen_at: now,
          last_verified_at: null, last_verified_by: null, last_failed_at: null, last_failed_by: null, fail_count: 0 }
      : r
  })
  for (let i = 0; i < upserts.length; i += 100) {
    await db.from('door_code_state').upsert(upserts.slice(i, i + 100), { onConflict: 'listing_id' })
  }

  if (malformed.length) {
    out.push({
      id: 'code_malformed', area: 'listings', severity: 'warn', count: malformed.length,
      title: `${malformed.length} door-code field${malformed.length === 1 ? ' holds' : 's hold'} something that is not a usable code`,
      detail: `${malformed.slice(0, 8).join('; ')}${malformed.length > 8 ? '; and more' : ''}. Anyone sent one of these arrives at a keypad with nothing to type.`,
      fix: 'Put a single keypad code in the field and move any explanation into the check-in instructions.',
      evidence: { units: malformed.slice(0, 25) },
    })
  }

  if (conflicting.length) {
    out.push({
      id: 'code_conflict', area: 'listings', severity: 'critical', count: conflicting.length,
      title: `${conflicting.length} unit${conflicting.length === 1 ? '' : 's'} state two different door codes in two places`,
      detail: `The custom field disagrees with what the listing text says: ${conflicting.slice(0, 6).map(c => `${c.unit} (vs ${c.where.join(' and ')})`).join('; ')}${conflicting.length > 6 ? '; and more' : ''}. `
        + 'This is what a half-finished rotation looks like — somebody changed the lock and updated one place. One of the two is wrong and we cannot tell which from here.',
      fix: 'For each unit, confirm the code at the door, then make the field and the listing text match.',
      evidence: { units: conflicting.slice(0, 25) },
    })
  }

  const shared = Object.keys(byFp).filter(k => byFp[k].length > 1).map(k => byFp[k])
  const bigShared = shared.filter(g => g.length >= 3)
  if (bigShared.length) {
    out.push({
      id: 'code_shared', area: 'listings', severity: 'warn', count: bigShared.reduce((a, g) => a + g.length, 0),
      title: `${bigShared.length} door code${bigShared.length === 1 ? ' is' : 's are'} shared across 3 or more units`,
      detail: bigShared.slice(0, 4).map(g => `${g.length} units: ${g.slice(0, 5).join(', ')}${g.length > 5 ? '…' : ''}`).join(' · ')
        + '. If that is deliberate, fine. If it is copy-paste, somebody has been given a key to a neighbour.',
      fix: 'Confirm each group is intentional. Where it is not, rotate and record the new code.',
      evidence: { groups: bigShared.slice(0, 10) },
    })
  }

  // Never confirmed by a human. This is the honest headline number for "are our codes accurate":
  // not how many look right, but how many anybody has actually opened a door with.
  const { data: st } = await db.from('door_code_state').select('listing_id,last_verified_at,changed_at,last_failed_at').limit(1000)
  const rows = st || []
  const neverOk = rows.filter((r: any) => !r.last_verified_at || Date.parse(r.last_verified_at) < Date.parse(r.changed_at || ''))
  if (neverOk.length) {
    out.push({
      id: 'code_unverified', area: 'listings', severity: neverOk.length > rows.length * 0.5 ? 'warn' : 'info', count: neverOk.length,
      title: `${neverOk.length} of ${rows.length} door codes have never been confirmed to open the door`,
      detail: 'Nobody has reported back after using them, so "accurate" is an assumption rather than a fact. Each release now asks the person whether it worked; this number falls on its own as codes get used.',
      fix: 'Nothing to do directly — but if it is not falling, people are ignoring the confirm prompt and that is worth knowing.',
      evidence: { unverified: neverOk.length, total: rows.length },
    })
  }

  const broken = rows.filter((r: any) => r.last_failed_at && Date.parse(r.last_failed_at) > Date.parse(r.last_verified_at || '1970-01-01')
    && Date.parse(r.last_failed_at) > Date.parse(r.changed_at || '1970-01-01'))
  if (broken.length) {
    out.push({
      id: 'code_reported_wrong', area: 'listings', severity: 'critical', count: broken.length,
      title: `${broken.length} door code${broken.length === 1 ? ' was' : 's were'} reported not working and nobody has fixed them`,
      detail: 'Somebody stood at the door, typed it, and it failed — and the field still holds the same value. The next person sent there will fail too.',
      fix: 'Get the real code from the lock and update Guesty. This is the most actionable line on this screen.',
      evidence: { listingIds: broken.slice(0, 25).map((r: any) => r.listing_id) },
    })
  }

  // Somebody stood at the door and the OLD code let them in. That is not a code problem, it is a
  // turnover problem: the new code was entered in Guesty and nobody changed the lock. It is the one
  // finding here that comes from a person rather than an inference, so it carries the most weight.
  try {
    const since = new Date(Date.now() - 14 * 86400000).toISOString()
    const { data: v } = await db.from('door_code_verifications').select('listing_id,created_at,which')
      .eq('which', 'old').gte('created_at', since).order('created_at', { ascending: false }).limit(200)
    const units = Array.from(new Set((v || []).map((r: any) => String(r.listing_id))))
    if (units.length) {
      const names = units.map(id => {
        const l: any = live.find((x: any) => String(x.id) === id)
        return l ? (l.nickname || l.title || id) : id
      })
      out.push({
        id: 'code_lock_not_changed', area: 'listings', severity: 'warn', count: units.length,
        title: `${units.length} lock${units.length === 1 ? ' still has' : 's still have'} the OLD code after a turnover`,
        detail: `Somebody reported in the last two weeks that the previous code is what opened the door: ${names.slice(0, 8).join(', ')}${names.length > 8 ? '; and more' : ''}. `
          + 'Guesty was updated and the keypad was not — which means the code we would hand a guest at check-in does not work.',
        fix: 'Have housekeeping change these locks to match Guesty, and check whether the code step is being skipped at the end of the clean.',
        evidence: { listingIds: units.slice(0, 25) },
      })
    }
  } catch { /* the table may not exist yet */ }

  if (changed) {
    out.push({
      id: 'code_recently_changed', area: 'listings', severity: 'info', count: changed,
      title: `${changed} door code${changed === 1 ? '' : 's'} changed since the last scan`,
      detail: 'Their confirmation history was cleared, because what we knew about the old code says nothing about the new one.',
      fix: 'No action needed. They will re-confirm the next time somebody uses them.',
      evidence: { changed },
    })
  }

  return out
}
