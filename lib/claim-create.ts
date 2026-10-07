// OPEN A CLAIM FROM A RESERVATION — the one way a claim row is born, shared by New claim on the
// board (app/api/claims POST) and Autofill from an HK damage report (lib/hk-damage). Everything
// identifying the claim is read from the booking, never typed: typed confirmation codes are how
// claims end up filed against the wrong stay.
import 'server-only'
import { deadlineFor, dueDateFor, policyFor, todayET, type ChannelPolicy } from './claims'
import { getSetting } from './app-settings'

const str = (v: any): string => typeof v === 'string' ? v : (v == null ? '' : String(v))

/** Guesty's `source` is a slug ("airbnb2", "bookingCom"); the claim wants the channel's real name. */
export function channelName(source: any): string {
  const s = str(source).toLowerCase()
  if (/airbnb/.test(s)) return 'Airbnb'
  if (/homeaway|vrbo/.test(s)) return 'VRBO'
  if (/booking/.test(s)) return 'Booking.com'
  if (/expedia|orbitz|travelocity/.test(s)) return 'Expedia'
  if (/direct|manual|website/.test(s)) return 'Direct'
  return str(source) || 'Other'
}

export const loadClaimPolicy = () => getSetting<Record<string, ChannelPolicy>>('claims_channel_policy', {})

export async function createClaimFromReservation(db: any, reservationId: string, opts: {
  by: string | null; assignee?: string | null; discoveredOn?: string | null
  summary?: string | null; extraNotes?: string | null; historyNote?: { action: string; to?: string } | null
}): Promise<{ ok: true; id: string } | { ok: false; error: string; status: number }> {
  const { data: r } = await db.from('guesty_reservations')
    .select('id,listing_id,listing_name,guest_name,check_in,check_out,source,confirmation_code')
    .eq('id', reservationId).maybeSingle()
  if (!r) return { ok: false, error: 'That reservation is not in the mirror yet.', status: 404 }

  let property = '', unitNo = ''
  try {
    const { data: l } = await db.from('guesty_listings').select('building,unit,nickname,title').eq('id', str(r.listing_id)).maybeSingle()
    if (l) { property = str(l.building) || str(l.nickname) || str(l.title); unitNo = str(l.unit) }
  } catch { /* listing lookup is a nicety, not a blocker */ }

  const checkOut = str(r.check_out).slice(0, 10)
  const ch = channelName(r.source)
  const pol = await loadClaimPolicy()
  const p = policyFor(ch, pol)
  const now = new Date().toISOString()
  const by = opts.by || 'team'
  const row: Record<string, any> = {
    stage: 'draft',
    reservation_id: reservationId,
    listing_id: str(r.listing_id) || null,
    property: property || str(r.listing_name) || null,
    unit_no: unitNo || null,
    guest_name: str(r.guest_name) || null,
    channel: ch,
    confirmation_code: str(r.confirmation_code) || null,
    check_in: str(r.check_in).slice(0, 10) || null,
    check_out: checkOut || null,
    discovered_on: str(opts.discoveredOn).slice(0, 10) || todayET(),
    deadline_on: deadlineFor(checkOut, ch, pol),
    // due_on holds the CHANNEL TARGET. The turnover is read fresh on every load (lib/claim-turnover).
    due_on: dueDateFor(checkOut, ch, pol),
    due_source: 'policy',
    deposit_held: p.deposit,
    guesty_url: 'https://app.guesty.com/reservations/' + reservationId + '/summary',
    created_by: opts.by || null,
    assignee_email: opts.assignee || opts.by || null,
    history: [{ at: now, by, action: 'created', to: 'draft' }],
  }
  if (opts.summary) row.summary = opts.summary
  if (opts.historyNote) row.history.push({ at: now, by, action: opts.historyNote.action, to: opts.historyNote.to || null })
  const notes: string[] = []
  if (opts.extraNotes) notes.push(opts.extraNotes)
  // A CLAIM PULLS THE GLITCH (Jon, 2026-09-22: "if a claim is created but there was a glitch for the
  // guest, it should pull that information").
  try {
    const { data: gl } = await db.from('glitches').select('id,overview,status,category,created_at,refund_approved')
      .eq('reservation_id', reservationId).order('created_at', { ascending: true }).limit(10)
    const gs = Array.isArray(gl) ? gl : []
    if (gs.length) {
      const lines = gs.map((g: any) => '• ' + str(g.created_at).slice(0, 10) + ' — ' + (str(g.overview) || 'Guest issue') + (g.category ? ' [' + str(g.category) + ']' : '') + ' (' + (str(g.status) || 'open') + (Number(g.refund_approved) ? ', refunded $' + Math.round(Number(g.refund_approved)) : '') + ')')
      notes.push('Guest issues logged during this stay:\n' + lines.join('\n'))
      row.history.push({ at: now, by: 'system', action: 'linked glitches', to: gs.map((g: any) => str(g.id)).join(',') })
    }
  } catch { /* the claim is still worth creating without them */ }
  if (notes.length) row.notes = notes.join('\n\n')

  let ins = await db.from('claims').insert(row).select('id').single()
  if (ins.error && /column|schema/i.test(ins.error.message)) {
    delete row.due_on; delete row.due_source; delete row.deposit_held; delete row.notes; delete row.summary
    ins = await db.from('claims').insert(row).select('id').single()
  }
  if (ins.error || !ins.data) return { ok: false, error: (ins.error && ins.error.message) || 'Could not create the claim.', status: 500 }
  return { ok: true, id: String(ins.data.id) }
}
