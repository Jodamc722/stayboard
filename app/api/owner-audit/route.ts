// OWNER STATEMENT AUDIT API.
//
// GET  ?month=YYYY-MM  — the full audit for one statement month (defaults to the newest month
//                        that has generated statements), plus the month picker feed.
// POST                 — save review state on one item: status, note, or an appended comment.
//                        Also: action='signoff' (per-statement sign-off, gated on every row
//                        being completed), action='stamp' (write the audit note onto the
//                        reservation's Guesty "Reservation Notes" field), action='rules'
//                        (edit the flag thresholds — signed-in users only).
//
// AUTH: a signed-in Lighthouse user OR the owner-audit share cookie (its own password,
// share_settings id=4 — see lib/shareAuth). The share link is a WORKING link by design: a VA or
// accountant marks rows, comments, and signs off without an app login. They still can't touch
// anything else in the app — this route only reads the mirror and writes owner_audit_reviews
// (plus, for 'stamp', one appended line on the booking's notes field, same as Claims).
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { OA_COOKIE, auditCookieValid } from '@/lib/shareAuth'
import { appendReservationNote } from '@/lib/claim-note'
import { pullReservationsByIds } from '@/lib/guesty'
import { syncOwners, syncOwnerStatements, syncLedgerMonth } from '@/lib/guesty-owner-sync'
import { MONTH_LABEL } from '@/lib/owner-statements'
import { auditMonths, buildAudit, defaultAuditMonth, saveAuditRules, AuditStatus, WRITABLE_STATUSES, SIGNOFF_KEY, PREP_PREFIX, PREP_OWNER } from '@/lib/owner-audit'

export const dynamic = 'force-dynamic'
// 300s: the 'sync' action sweeps a whole month of statement line items out of Guesty.
export const maxDuration = 300

async function whoAmI(): Promise<{ ok: boolean; internal: boolean; email: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) return { ok: true, internal: true, email: String(user.email || '') }
  const shared = await auditCookieValid(cookies().get(OA_COOKIE)?.value)
  return { ok: shared, internal: false, email: '' }
}

export async function GET(req: NextRequest) {
  const who = await whoAmI()
  if (!who.ok) return NextResponse.json({ ok: false, needsPassword: true, error: 'unauthorized' }, { status: 401 })

  try {
    const months = await auditMonths()
    const wanted = new URL(req.url).searchParams.get('month') || ''
    const month = /^\d{4}-\d{2}$/.test(wanted) ? wanted : defaultAuditMonth(months)
    if (!month) return NextResponse.json({ ok: true, internal: who.internal, months, data: null })
    const data = await buildAudit(month)
    return NextResponse.json({ ok: true, internal: who.internal, months, data })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

// 'clear' is the engine's own word for "nothing found here" — it is computed per row and must
// never arrive from a click, or approving a row would be indistinguishable from never looking.
const STATUSES: AuditStatus[] = WRITABLE_STATUSES

export async function POST(req: NextRequest) {
  const who = await whoAmI()
  if (!who.ok) return NextResponse.json({ ok: false, needsPassword: true, error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')

  // ── RULES — the flag thresholds. Signed-in users only: the share link can work the
  // audit, but it doesn't get to decide what the audit checks.
  if (action === 'rules') {
    if (!who.internal) return NextResponse.json({ ok: false, error: 'Rules can only be changed by a signed-in user.' }, { status: 403 })
    try {
      const rules = await saveAuditRules(body.rules || {}, who.email)
      return NextResponse.json({ ok: true, rules })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
    }
  }

  // ── SYNC — pull this month's statements and line items fresh from Guesty, on demand.
  // The hourly cron keeps the mirror current on its own; this is the button for when someone
  // has just generated or re-recognized statements in Guesty and wants them on the board NOW,
  // without waiting up to an hour. Signed-in users only (it spends Guesty API budget), and one
  // month at a time so it finishes inside the function's time budget.
  if (action === 'sync') {
    if (!who.internal) return NextResponse.json({ ok: false, error: 'Only a signed-in user can refresh statements from Guesty.' }, { status: 403 })
    const m = String(body.month || '')
    if (!/^\d{4}-\d{2}$/.test(m)) return NextResponse.json({ ok: false, error: 'month required' }, { status: 400 })
    try {
      await syncOwners()
      await syncOwnerStatements()
      // Leave headroom under maxDuration so a slow sweep returns a real answer instead of a
      // gateway timeout; the month is marked pending and the cron finishes it either way.
      const r = await syncLedgerMonth(m, Date.now() + 200_000)
      return NextResponse.json({ ok: true, month: m, rows: (r as any)?.rows ?? null, status: (r as any)?.status ?? null })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 502 })
    }
  }

  // ── PREP RE-CHECK — pull the given reservations fresh from Guesty so folio edits (fee
  // breakouts done on the reservation) map back into the app immediately, instead of
  // waiting for the incremental sync to notice them.
  if (action === 'prep-recheck') {
    const ids = Array.isArray(body.reservationIds) ? body.reservationIds.map((x: any) => String(x || '')).filter(Boolean).slice(0, 120) : []
    if (!ids.length) return NextResponse.json({ ok: false, error: 'reservationIds required' }, { status: 400 })
    try {
      const pulled = await pullReservationsByIds(ids)
      return NextResponse.json({ ok: true, pulled })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 502 })
    }
  }

  const month = String(body.month || '')
  const ownerId = String(body.ownerId || '')

  // ── SIGN-OFF — the per-statement signature. Server-side gate: rebuild the month and
  // refuse unless every row on this statement is completed, so a signature can never be
  // stale the moment it is written.
  if (action === 'signoff') {
    if (!/^\d{4}-\d{2}$/.test(month) || !ownerId) {
      return NextResponse.json({ ok: false, error: 'month and ownerId are required' }, { status: 400 })
    }
    const on = body.on !== false
    const author = who.internal ? who.email : ('link · ' + String(body.author || 'reviewer').trim().slice(0, 60))
    const db = supabaseAdmin()
    try {
      if (on) {
        const audit = await buildAudit(month)
        const owner = audit.owners.find(o => o.ownerId === ownerId)
        if (!owner) return NextResponse.json({ ok: false, error: 'owner not on this month' }, { status: 400 })
        if (owner.open > 0) {
          return NextResponse.json({ ok: false, error: owner.open + ' row' + (owner.open === 1 ? ' is' : 's are') + ' still open on this statement — complete them before signing off.' }, { status: 409 })
        }
      }
      const now = new Date().toISOString()
      const { error } = await db.from('owner_audit_reviews').upsert({
        month, owner_id: ownerId, item_key: SIGNOFF_KEY,
        status: on ? 'done' : 'review', note: '', comments: [],
        updated_by: author, updated_at: now,
      }, { onConflict: 'month,owner_id,item_key' })
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true, signOff: on ? { by: author, at: now } : null })
    } catch (e: any) {
      const msg = String(e?.message || e)
      const hint = /owner_audit_reviews/.test(msg) && /does not exist|schema cache/.test(msg)
        ? ' — run migration 024_owner_audit.sql in Supabase first.' : ''
      return NextResponse.json({ ok: false, error: msg.slice(0, 300) + hint }, { status: 500 })
    }
  }

  const itemKey = String(body.itemKey || '').slice(0, 160)
  if (!/^\d{4}-\d{2}$/.test(month) || !ownerId || !itemKey) {
    return NextResponse.json({ ok: false, error: 'month, ownerId and itemKey are required' }, { status: 400 })
  }

  // ── NOTE — a free-form note on ANY audited thing: statement (__statement__), prep row
  // (prep:<code>), resolution (resl:<id>) or reservation. Only the note changes; whatever
  // status/sign-off/comments the row already carries is preserved.
  if (action === 'note') {
    const noteText = String(body.note ?? '').slice(0, 2000)
    const author = who.internal ? who.email : ('link · ' + String(body.author || 'reviewer').trim().slice(0, 60))
    const db = supabaseAdmin()
    try {
      const { data: existing, error: readErr } = await db.from('owner_audit_reviews')
        .select('status, comments')
        .eq('month', month).eq('owner_id', ownerId).eq('item_key', itemKey)
        .maybeSingle()
      if (readErr) throw new Error(readErr.message)
      const { error } = await db.from('owner_audit_reviews').upsert({
        month, owner_id: ownerId, item_key: itemKey,
        status: existing?.status || 'review',
        note: noteText,
        comments: Array.isArray(existing?.comments) ? existing!.comments : [],
        updated_by: author, updated_at: new Date().toISOString(),
      }, { onConflict: 'month,owner_id,item_key' })
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true, note: noteText })
    } catch (e: any) {
      const msg = String(e?.message || e)
      const hint = /owner_audit_reviews/.test(msg) && /does not exist|schema cache/.test(msg)
        ? ' — run migration 024_owner_audit.sql in Supabase first.' : ''
      return NextResponse.json({ ok: false, error: msg.slice(0, 300) + hint }, { status: 500 })
    }
  }

  // ── PREP — the Expedia fee breakout TRACKER. The split itself is entered on the
  // reservation in Guesty; this just records "broken out, by whom, when" for the month's
  // prep worklist (item_key 'prep:<code>', stored under owner '-' so the mark survives
  // owner attribution changing when statements generate).
  if (action === 'prep') {
    if (!itemKey.startsWith(PREP_PREFIX)) return NextResponse.json({ ok: false, error: 'prep itemKey must start with prep:' }, { status: 400 })
    const author = who.internal ? who.email : ('link · ' + String(body.author || 'reviewer').trim().slice(0, 60))
    const db = supabaseAdmin()
    const now = new Date().toISOString()
    const on = body.on !== false
    try {
      const { error } = await db.from('owner_audit_reviews').upsert({
        month, owner_id: PREP_OWNER, item_key: itemKey,
        status: on ? 'done' : 'review', note: '', comments: [],
        updated_by: author, updated_at: now,
      }, { onConflict: 'month,owner_id,item_key' })
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true, saved: on ? { by: author, at: now } : null })
    } catch (e: any) {
      const msg = String(e?.message || e)
      const hint = /owner_audit_reviews/.test(msg) && /does not exist|schema cache/.test(msg)
        ? ' — run migration 024_owner_audit.sql in Supabase first.' : ''
      return NextResponse.json({ ok: false, error: msg.slice(0, 300) + hint }, { status: 500 })
    }
  }

  if (itemKey === SIGNOFF_KEY || itemKey.startsWith(PREP_PREFIX)) {
    return NextResponse.json({ ok: false, error: 'reserved key' }, { status: 400 })
  }

  // ── STAMP — write the audit note onto the reservation in Guesty, so the finding lives
  // on the booking (same field and same safe-merge writer as the Claims board).
  if (action === 'stamp') {
    const reservationId = String(body.reservationId || '')
    const noteText = String(body.note || '').trim().slice(0, 500)
    if (!reservationId || !noteText) {
      return NextResponse.json({ ok: false, error: 'reservationId and a note are required' }, { status: 400 })
    }
    const author = who.internal ? who.email : ('link · ' + String(body.author || 'reviewer').trim().slice(0, 60))
    const day = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
    const line = 'AUDIT ' + MONTH_LABEL(month) + ': ' + noteText + ' — ' + author + ', ' + day
    const w = await appendReservationNote(supabaseAdmin(), reservationId, line)
    if (!w.ok) return NextResponse.json({ ok: false, error: w.error || 'Guesty refused the write' }, { status: 502 })
    return NextResponse.json({ ok: true, line })
  }

  const status = body.status !== undefined ? String(body.status) : undefined
  if (status !== undefined && !STATUSES.includes(status as AuditStatus)) {
    return NextResponse.json({ ok: false, error: 'bad status' }, { status: 400 })
  }
  const note = body.note !== undefined ? String(body.note).slice(0, 2000) : undefined
  const commentBody = body.comment ? String(body.comment.body || '').trim().slice(0, 1000) : ''
  const commentAuthor = who.internal
    ? who.email
    : ('link · ' + String(body.comment?.author || body.author || 'reviewer').trim().slice(0, 60))
  if (body.comment && !commentBody) return NextResponse.json({ ok: false, error: 'empty comment' }, { status: 400 })

  const by = who.internal ? who.email : commentAuthor
  const db = supabaseAdmin()

  try {
    const { data: existing, error: readErr } = await db.from('owner_audit_reviews')
      .select('status, note, comments')
      .eq('month', month).eq('owner_id', ownerId).eq('item_key', itemKey)
      .maybeSingle()
    if (readErr) throw new Error(readErr.message)

    const comments: any[] = Array.isArray(existing?.comments) ? existing!.comments.slice() : []
    if (commentBody) comments.push({ author: commentAuthor, body: commentBody, at: new Date().toISOString() })
    if (comments.length > 100) comments.splice(0, comments.length - 100)

    const row = {
      month, owner_id: ownerId, item_key: itemKey,
      status: status !== undefined ? status : (existing?.status || 'review'),
      note: note !== undefined ? note : (existing?.note || ''),
      comments,
      updated_by: by,
      updated_at: new Date().toISOString(),
    }
    const { error } = await db.from('owner_audit_reviews')
      .upsert(row, { onConflict: 'month,owner_id,item_key' })
    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true, status: row.status, note: row.note, comments, updatedBy: by, updatedAt: row.updated_at })
  } catch (e: any) {
    const msg = String(e?.message || e)
    // The one honest special case: migration not run yet.
    const hint = /owner_audit_reviews/.test(msg) && /does not exist|schema cache/.test(msg)
      ? ' — run migration 024_owner_audit.sql in Supabase first.' : ''
    return NextResponse.json({ ok: false, error: msg.slice(0, 300) + hint }, { status: 500 })
  }
}
