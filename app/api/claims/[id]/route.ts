// ONE CLAIM — read it, move it, close it.
//   GET    -> the claim + its items
//   PATCH  -> edit fields and/or move stage. Stage moves that matter to the outside world
//             (submitted / decided / paid / closed) write a stamped note onto the reservation.
//   DELETE -> soft delete
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { notify } from '@/lib/notify'
import { appendReservationNote } from '@/lib/claim-note'
import { canDelete, trashRecord } from '@/lib/trash'
import { claimNoteLine, claimTitle, deadlineFor, gatesFor, itemsTotal, num, todayET, type Claim, type ClaimItem } from '@/lib/claims'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymd(v: any): string | null { const s = str(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null }

const STAGES = ['draft', 'review', 'ready', 'submitted', 'decided', 'settle', 'closed']
const OUTCOMES = ['won', 'partial', 'denied', 'withdrawn', 'duplicate']
const WAITING = ['channel', 'guest', 'escalated']

// Plain text fields the client may set directly.
const TEXT_FIELDS = ['property', 'unit_no', 'guest_name', 'channel', 'confirmation_code', 'summary', 'notes', 'channel_case_id', 'breezeway_url', 'assignee_email']
const DATE_FIELDS = ['check_in', 'check_out', 'discovered_on', 'submitted_on', 'decided_on', 'paid_on', 'deadline_on']
const BOOL_FIELDS = ['guest_called', 'police_report', 'payment_verified', 'owner_adjusted']
const MONEY_FIELDS = ['amount_sought', 'amount_paid']

async function load(db: any, id: string): Promise<{ claim: any; items: ClaimItem[] } | null> {
  const { data: claim } = await db.from('claims').select('*').eq('id', id).is('deleted_at', null).maybeSingle()
  if (!claim) return null
  const { data: items } = await db.from('claim_items').select('*').eq('claim_id', id).order('position', { ascending: true })
  return { claim, items: (items || []) as ClaimItem[] }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = supabaseAdmin()
  const found = await load(db, params.id)
  if (!found) return NextResponse.json({ ok: false, error: 'Claim not found.' }, { status: 404 })
  return NextResponse.json({ ok: true, today: todayET(), claim: { ...found.claim, items: found.items } })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const me = str(user.email).toLowerCase()
  const db = supabaseAdmin()
  try {
    const found = await load(db, params.id)
    if (!found) return NextResponse.json({ ok: false, error: 'Claim not found.' }, { status: 404 })
    const before = found.claim as Claim
    const items = found.items
    const b = await req.json().catch(() => ({} as any))

    const patch: Record<string, any> = { updated_at: new Date().toISOString() }
    for (const f of TEXT_FIELDS) if (f in b) patch[f] = str((b as any)[f]).trim() || null
    for (const f of DATE_FIELDS) if (f in b) patch[f] = ymd((b as any)[f])
    for (const f of BOOL_FIELDS) if (f in b) patch[f] = (b as any)[f] === true
    for (const f of MONEY_FIELDS) if (f in b) patch[f] = num((b as any)[f])
    if ('outcome' in b) patch.outcome = OUTCOMES.includes(str(b.outcome)) ? str(b.outcome) : null
    if ('waiting_on' in b) patch.waiting_on = WAITING.includes(str(b.waiting_on)) ? str(b.waiting_on) : null

    // Checkout moved (an extension, a corrected date) -> the filing deadline moves with it. Never
    // leave a stale deadline on the board: the whole point of the countdown is that it is true.
    if ('check_out' in b && patch.check_out && !('deadline_on' in b)) patch.deadline_on = deadlineFor(patch.check_out)

    // ── stage move ───────────────────────────────────────────────────────
    const nextStage = STAGES.includes(str(b.stage)) ? str(b.stage) : null
    const moved = nextStage && nextStage !== before.stage ? nextStage : null
    if (moved) {
      // The gates are a real gate, not a nag. A claim cannot be filed with a missing photo or a
      // placeholder cost — that is exactly the claim the channel denies. `force` exists because Jon
      // sometimes knows something the checklist does not, and it is recorded when he uses it.
      if ((moved === 'ready' || moved === 'submitted') && b.force !== true) {
        const merged: Claim = { ...before, ...patch } as Claim
        const failing = gatesFor(merged, items).filter(g => !g.ok)
        if (failing.length) {
          return NextResponse.json({ ok: false, error: 'Not ready to file.', gates: failing }, { status: 409 })
        }
      }
      patch.stage = moved
      if (moved === 'submitted' && !patch.submitted_on && !before.submitted_on) patch.submitted_on = todayET()
      if (moved === 'submitted' && !('waiting_on' in b)) patch.waiting_on = 'channel'
      if (moved === 'decided' && !patch.decided_on && !before.decided_on) patch.decided_on = todayET()
      if (moved === 'decided') patch.waiting_on = null
      if (moved === 'settle' && !patch.paid_on && !before.paid_on && (num(patch.amount_paid ?? before.amount_paid) || 0) > 0) patch.paid_on = todayET()
    }

    // The total defaults to the sum of the items, so nobody files a number that does not add up.
    if (!('amount_sought' in b) && (patch.stage === 'ready' || patch.stage === 'submitted') && before.amount_sought == null) {
      patch.amount_sought = itemsTotal(items)
    }

    const hist = Array.isArray((before as any).history) ? (before as any).history.slice(-99) : []
    if (moved) hist.push({ at: new Date().toISOString(), by: me, action: 'stage', from: before.stage, to: moved, forced: b.force === true })
    else hist.push({ at: new Date().toISOString(), by: me, action: 'edit' })
    patch.history = hist

    const { error } = await db.from('claims').update(patch).eq('id', params.id)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    const after: Claim = { ...before, ...patch } as Claim

    // ── the note on the reservation ──────────────────────────────────────
    // Only real, outward-facing events. Editing a typo does not deserve a line on the booking.
    let noteEvent: 'submitted' | 'decided' | 'paid' | 'closed' | null = null
    if (moved === 'submitted') noteEvent = 'submitted'
    else if (moved === 'decided') noteEvent = 'decided'
    else if (moved === 'closed') noteEvent = 'closed'
    if (!moved && b.payment_verified === true && before.payment_verified !== true) noteEvent = 'paid'
    let note: { ok: boolean; error?: string } | null = null
    if (noteEvent && b.skipNote !== true) {
      note = await appendReservationNote(db, str(after.reservation_id), claimNoteLine(after, noteEvent, items))
      try {
        await db.from('claims').update({
          note_synced_at: note.ok ? new Date().toISOString() : null,
          note_sync_error: note.ok ? null : str(note.error).slice(0, 300),
        }).eq('id', params.id)
      } catch { /* the note result is reported to the caller either way */ }
    }

    // Somebody has to look at it next. Tell them.
    try {
      if (moved === 'review') {
        const { data: admins } = await db.from('app_users').select('email').eq('role', 'admin').eq('status', 'active')
        const to = ((admins || []) as any[]).map(a => str(a.email).toLowerCase()).filter(Boolean)
        if (to.length) await notify(to, { kind: 'claim', title: 'Claim needs review: ' + claimTitle(after), body: 'Deadline ' + str(after.deadline_on), link: '/claims/' + params.id, actor: me })
      } else if (moved === 'ready' || moved === 'settle') {
        const owner = str(after.assignee_email).toLowerCase()
        if (owner) await notify([owner], { kind: 'claim', title: (moved === 'ready' ? 'Approved to file: ' : 'Money and owner: ') + claimTitle(after), link: '/claims/' + params.id, actor: me })
      }
    } catch { /* notifications never block the move */ }

    const fresh = await load(db, params.id)
    return NextResponse.json({ ok: true, claim: fresh ? { ...fresh.claim, items: fresh.items } : null, note })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

// Delete the claim AND its items — photographed into the graveyard first, so Recently deleted can
// put the whole thing back. Attachments stay in the bucket, so a restored claim still has its
// photos and receipts.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const who = await canDelete()
  if (!who.ok) return NextResponse.json({ ok: false, error: who.reason }, { status: 403 })
  const db = supabaseAdmin()
  const r = await trashRecord(db, 'claim', params.id, who.email)
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true, trashId: r.trashId, label: r.label })
}
