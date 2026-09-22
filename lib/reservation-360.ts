// THE FULL PICTURE OF ONE BOOKING (Jon, 2026-09-22).
//
// "every source of data that we have for an active reservation should integrate across all the
// different sets … a glitch, revenue, guest communication, the review score for that listing, the
// last review data point, guest sentiment from their messages, data that we manually input … whether
// we called the guest, how many times we called the guest, how many times that guest booked, guest
// profiles … A claim and a glitch: if a claim is created but there was a glitch for the guest, it
// should pull that information."
//
// Before this there were three partial readers of the same booking, each missing different things:
// the /reservations/[id] page (no glitches, sentiment, reviews, profile, tasks), Eve's
// reservation_detail (no calls, no repeat stays, and a profile lookup that never matched), and the
// glitch evidence builder (starts from a glitch). This is the ONE loader; every surface that shows a
// booking reads it through /api/reservation/<id>/360 and renders it with <StayPanel>.
//
// Rules:
//   • Fail-soft per dataset. A missing table or a slow read blanks that block, never the booking.
//   • Links are by reservation id first. Where the app only has a softer link (texts by phone,
//     reviews by listing), it says so in the field name (`listing…`).
//   • Money is returned raw; the route strips it for people without money access.
import 'server-only'
import { loadContactHistory, type ContactHistory } from './reservation-contact'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: any): number | null => { const n = Number(v); return v == null || v === '' || !Number.isFinite(n) ? null : n }
const round = (v: any) => { const n = num(v); return n == null ? null : Math.round(n * 100) / 100 }

/** The same identity rule as the Guests directory (app/api/guests) and guest_profiles.guest_key. */
export function guestKeyOf(email: any, guestId: any, name: any): string {
  const e = str(email).trim().toLowerCase()
  if (e && /@/.test(e)) return 'e:' + e
  if (str(guestId).trim()) return 'g:' + str(guestId).trim()
  return 'n:' + str(name).trim().toLowerCase().replace(/\s+/g, ' ')
}

async function soft<T>(p: PromiseLike<{ data: any; error?: any }>, fallback: T): Promise<T> {
  try { const r = await p; return (r && r.data != null && !r.error) ? r.data as T : fallback } catch { return fallback }
}

export type Stay360 = {
  id: string
  confirmationCode: string | null
  status: string
  channel: string
  guest: {
    name: string; email: string | null; phone: string | null; key: string
    vip: boolean; tags: string[]; teamNotes: string | null
    /** every stay this guest has had with us (this one included), newest first */
    stays: number; nights: number; lifetimeValue: number | null
    repeat: boolean
    history: { id: string; unit: string; checkIn: string; checkOut: string; status: string; value: number | null }[]
  }
  listing: { id: string; unit: string; building: string | null }
  dates: { checkIn: string; checkOut: string; nights: number | null; bookedAt: string | null; leadDays: number | null; phase: 'upcoming' | 'in-house' | 'past' | 'cancelled' }
  money: { total: number | null; paid: number | null; balance: number | null; accommodation: number | null; cleaning: number | null; hostPayout: number | null; fullyPaid: boolean | null; currency: string; refunded: number | null } | null
  notes: string | null
  customFields: { name: string; value: string }[]
  calls: {
    welcome: { outcome: string; attempts: number; by: string; at: string; note: string } | null
    postCheckout: { outcome: string; attempts: number; by: string; at: string; note: string } | null
    totals: ContactHistory['totals']
    lastContactAt: string
    promised: ContactHistory['promised']
    openIssues: string[]
  }
  messages: {
    conversationId: string | null
    unread: number
    lastMessageAt: string | null
    count: number
    awaitingReply: boolean | null
    firstResponseMin: number | null
    sentiment: { score: number | null; band: string | null; dissatisfied: boolean; topIssue: string | null; reason: string | null } | null
  }
  glitches: { id: string; overview: string; status: string; category: string | null; createdAt: string; refund: number | null; priority: string | null }[]
  claims: { id: string; stage: string; summary: string | null; sought: number | null; paid: number | null; deadline: string | null; outcome: string | null }[]
  reviews: {
    /** the review THIS stay left, when the channel's payload names the reservation */
    thisStay: { id: string; rating: number | null; channel: string; at: string; content: string; replied: boolean } | null
    listingAvg90: number | null
    listingCount90: number
    listingLast: { rating: number | null; channel: string; at: string; content: string } | null
  }
  tasks: { id: string; name: string; status: string; dept: string; scheduled: string | null; finished: string | null; assignees: string[]; reportUrl: string | null }[]
  orders: { count: number; totalUsd: number | null; linkSent: boolean }
  notice: { sent: boolean; sentAt: string | null } | null
  parking: { status: string } | null
  /** One-word flags every surface can show as tags, most important first. */
  flags: { key: string; label: string; tone: 'rose' | 'amber' | 'emerald' | 'violet' | 'slate' | 'brand'; why?: string }[]
}

export async function loadReservation360(db: any, reservationId: string, opts: { withContact?: boolean } = {}): Promise<Stay360 | null> {
  const r: any = await soft(db.from('guesty_reservations').select('*').eq('id', reservationId).maybeSingle(), null)
  if (!r) return null
  const today = new Date().toISOString().slice(0, 10)
  const gKey = guestKeyOf(r.guest_email, r.guest_id, r.guest_name)
  const conv = str(r.conversation_id) || null

  // Everything keyed by this booking, in parallel.
  const [listing, profile, calls, glitches, claims, convRow, sentiment, resp, msgCount, reviewThis, tasks, orders, orderLink, notice, parking, history] = await Promise.all([
    soft<any>(db.from('guesty_listings').select('id,nickname,title,building').eq('id', r.listing_id).maybeSingle(), null),
    soft<any>(db.from('guest_profiles').select('vip,tags,notes').eq('guest_key', gKey).maybeSingle(), null),
    soft<any[]>(db.from('guest_calls').select('kind,outcome,attempts,called_by,called_at,note').eq('reservation_id', reservationId), []),
    soft<any[]>(db.from('glitches').select('id,overview,status,category,created_at,refund_approved').eq('reservation_id', reservationId).order('created_at', { ascending: false }).limit(20), []),
    soft<any[]>(db.from('claims').select('id,stage,summary,amount_sought,amount_paid,deadline_on,outcome').eq('reservation_id', reservationId).is('deleted_at', null).order('created_at', { ascending: false }).limit(10), []),
    conv ? soft<any>(db.from('guesty_conversations').select('unread_count,last_message_at').eq('id', conv).maybeSingle(), null) : Promise.resolve(null),
    conv ? soft<any>(db.from('guesty_conversation_sentiment').select('score,band,dissatisfied,top_issue,reason,awaiting_reply').eq('conversation_id', conv).maybeSingle(), null) : Promise.resolve(null),
    conv ? soft<any>(db.from('conversation_response').select('first_ms,awaiting').eq('conversation_id', conv).maybeSingle(), null) : Promise.resolve(null),
    conv ? (async () => { try { const x = await db.from('guesty_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conv); return Number(x?.count) || 0 } catch { return 0 } })() : Promise.resolve(0),
    soft<any[]>(db.from('guesty_reviews').select('id,rating,channel,created_at,content,has_reply').eq('raw->>reservationId', reservationId).limit(1), []),
    soft<any[]>(db.from('breezeway_tasks_sync').select('id,name,status,type_department,scheduled_date,finished_at,assignees,report_url').eq('linked_reservation_id', reservationId).order('scheduled_date', { ascending: true }).limit(30), []),
    soft<any[]>(db.from('guest_orders').select('total_usd,status').eq('reservation_id', reservationId).limit(50), []),
    soft<any[]>(db.from('guest_order_links').select('sent_at').eq('reservation_id', reservationId).limit(1), []),
    soft<any[]>(db.from('reservation_notices').select('sent_at').eq('reservation_id', reservationId).is('deleted_at', null).order('created_at', { ascending: false }).limit(1), []),
    soft<any[]>(db.from('parking_permits').select('status').eq('reservation_id', reservationId).limit(1), []),
    // Every stay by the same guest — by email when we have it, else by Guesty guest id, else name.
    (async () => {
      const cols = 'id,listing_id,check_in,check_out,status,money_total,nights'
      if (gKey.startsWith('e:')) return soft<any[]>(db.from('guesty_reservations').select(cols).ilike('guest_email', gKey.slice(2)).order('check_in', { ascending: false }).limit(60), [])
      if (gKey.startsWith('g:')) return soft<any[]>(db.from('guesty_reservations').select(cols).eq('guest_id', gKey.slice(2)).order('check_in', { ascending: false }).limit(60), [])
      return soft<any[]>(db.from('guesty_reservations').select(cols).ilike('guest_name', str(r.guest_name)).order('check_in', { ascending: false }).limit(60), [])
    })(),
  ])

  // The listing's recent review picture (90 days, not removed).
  const since90 = new Date(Date.now() - 90 * 86400000).toISOString()
  // removed_at arrives with migration 107; if it is not there yet, read without it rather than
  // silently losing the listing's whole review picture.
  let listingReviews = await soft<any[] | null>(db.from('guesty_reviews').select('rating,channel,created_at,content,excluded_from_score,removed_at')
    .eq('listing_id', r.listing_id).gte('created_at', since90).order('created_at', { ascending: false }).limit(200), null)
  if (!listingReviews) listingReviews = await soft<any[]>(db.from('guesty_reviews').select('rating,channel,created_at,content,excluded_from_score')
    .eq('listing_id', r.listing_id).gte('created_at', since90).order('created_at', { ascending: false }).limit(200), [])
  const counted = listingReviews.filter(x => !x.excluded_from_score && !x.removed_at && num(x.rating) != null)
  const avg = counted.length ? Math.round((counted.reduce((a, x) => a + Number(x.rating), 0) / counted.length) * 100) / 100 : null
  const last = counted[0] || null

  // Names of the units in the guest's history.
  const histIds = Array.from(new Set(history.map(h => str(h.listing_id)).filter(Boolean)))
  const names: Record<string, string> = {}
  if (histIds.length) {
    const ls = await soft<any[]>(db.from('guesty_listings').select('id,nickname,title').in('id', histIds.slice(0, 60)), [])
    for (const l of ls) names[str(l.id)] = str(l.nickname || l.title)
  }
  const live = (s: any) => !/cancel|declin|expire|inquir/i.test(str(s))
  const liveHist = history.filter(h => live(h.status))
  const ltv = liveHist.reduce((a, h) => a + (num(h.money_total) || 0), 0)

  const contact: ContactHistory | null = opts.withContact === false ? null
    : await loadContactHistory(db, reservationId, r.guest_phone).catch(() => null)

  const w = calls.find(c => c.kind === 'welcome') || null
  const p = calls.find(c => c.kind === 'post_checkout') || null
  const callOf = (c: any) => c ? { outcome: str(c.outcome), attempts: Number(c.attempts) || 0, by: str(c.called_by), at: str(c.called_at), note: str(c.note) } : null

  const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
  const phase: Stay360['dates']['phase'] = !live(r.status) ? 'cancelled' : ci > today ? 'upcoming' : co <= today ? 'past' : 'in-house'
  const booked = str(r.created_at).slice(0, 10) || null
  const lead = booked && ci ? Math.max(0, Math.round((Date.parse(ci) - Date.parse(booked)) / 86400000)) : null
  const m = (r.raw && r.raw.money) || {}
  const refunded = glitches.reduce((a, g) => a + (num(g.refund_approved) || 0), 0)

  let customFields: { name: string; value: string }[] = []
  try {
    const { customFieldNameMap, filledCustomFields } = await import('./custom-fields')
    customFields = filledCustomFields(r.custom_fields, await customFieldNameMap())
  } catch { /* a booking without resolved field names is still a booking */ }

  const s: Stay360 = {
    id: str(r.id), confirmationCode: r.confirmation_code || null, status: str(r.status), channel: str(r.source),
    guest: {
      name: str(r.guest_name) || 'Guest', email: r.guest_email || null, phone: r.guest_phone || null, key: gKey,
      vip: !!profile?.vip, tags: Array.isArray(profile?.tags) ? profile.tags : [], teamNotes: profile?.notes || null,
      stays: liveHist.length || 1, nights: liveHist.reduce((a, h) => a + (Number(h.nights) || 0), 0),
      lifetimeValue: ltv || null, repeat: liveHist.length > 1,
      history: history.slice(0, 20).map(h => ({ id: str(h.id), unit: names[str(h.listing_id)] || str(h.listing_id), checkIn: str(h.check_in).slice(0, 10), checkOut: str(h.check_out).slice(0, 10), status: str(h.status), value: num(h.money_total) })),
    },
    listing: { id: str(r.listing_id), unit: str(listing?.nickname || listing?.title || r.listing_name || r.listing_id), building: listing?.building || null },
    dates: { checkIn: ci, checkOut: co, nights: num(r.nights), bookedAt: booked, leadDays: lead, phase },
    money: {
      total: num(r.money_total), paid: num(r.money_paid), balance: num(r.money_balance),
      accommodation: round(m.fareAccommodationAdjusted ?? m.fareAccommodation), cleaning: round(m.fareCleaning), hostPayout: round(m.hostPayout),
      fullyPaid: m.isFullyPaid == null ? null : !!m.isFullyPaid, currency: str(r.money_currency) || 'USD', refunded: refunded || null,
    },
    notes: r.notes || null,
    customFields,
    calls: {
      welcome: callOf(w), postCheckout: callOf(p),
      totals: contact ? contact.totals : { calls: 0, answered: 0, talkSeconds: 0, texts: 0, voicemails: 0 },
      lastContactAt: contact ? contact.lastContactAt : '',
      promised: contact ? contact.promised.slice(0, 8) : [],
      openIssues: contact ? contact.openIssues.slice(0, 8) : [],
    },
    messages: {
      conversationId: conv, unread: Number(convRow?.unread_count) || 0, lastMessageAt: convRow?.last_message_at || null, count: msgCount,
      awaitingReply: resp ? !!resp.awaiting : (sentiment ? !!sentiment.awaiting_reply : null),
      firstResponseMin: resp?.first_ms != null ? Math.round(Number(resp.first_ms) / 60000) : null,
      sentiment: sentiment ? { score: num(sentiment.score), band: sentiment.band || null, dissatisfied: !!sentiment.dissatisfied, topIssue: sentiment.top_issue || null, reason: sentiment.reason || null } : null,
    },
    glitches: glitches.map(g => ({ id: str(g.id), overview: str(g.overview), status: str(g.status), category: g.category || null, createdAt: str(g.created_at), refund: num(g.refund_approved), priority: null })),
    claims: claims.map(c => ({ id: str(c.id), stage: str(c.stage), summary: c.summary || null, sought: num(c.amount_sought), paid: num(c.amount_paid), deadline: c.deadline_on || null, outcome: c.outcome || null })),
    reviews: {
      thisStay: reviewThis[0] ? { id: str(reviewThis[0].id), rating: num(reviewThis[0].rating), channel: str(reviewThis[0].channel), at: str(reviewThis[0].created_at), content: str(reviewThis[0].content).slice(0, 600), replied: !!reviewThis[0].has_reply } : null,
      listingAvg90: avg, listingCount90: counted.length,
      listingLast: last ? { rating: num(last.rating), channel: str(last.channel), at: str(last.created_at), content: str(last.content).slice(0, 300) } : null,
    },
    tasks: tasks.map(t => ({ id: str(t.id), name: str(t.name), status: str(t.status), dept: str(t.type_department), scheduled: t.scheduled_date || null, finished: t.finished_at || null, assignees: Array.isArray(t.assignees) ? t.assignees.map((a: any) => str(a?.name || a)).filter(Boolean) : [], reportUrl: t.report_url || null })),
    orders: { count: orders.length, totalUsd: orders.length ? orders.reduce((a, o) => a + (num(o.total_usd) || 0), 0) : null, linkSent: !!(orderLink[0] && orderLink[0].sent_at) },
    notice: notice[0] ? { sent: !!notice[0].sent_at, sentAt: notice[0].sent_at || null } : null,
    parking: parking[0] ? { status: str(parking[0].status) } : null,
    flags: [],
  }
  s.flags = flagsOf(s)
  return s
}

/** The tags a row shows for this booking — the "one line" version of the whole picture. */
export function flagsOf(s: Stay360): Stay360['flags'] {
  const f: Stay360['flags'] = []
  const openGl = s.glitches.filter(g => !/closed|resolved|done/i.test(g.status))
  if (openGl.length) f.push({ key: 'glitch', label: openGl.length + ' open issue' + (openGl.length === 1 ? '' : 's'), tone: 'rose', why: openGl.map(g => g.overview).join(' · ') })
  else if (s.glitches.length) f.push({ key: 'glitch', label: s.glitches.length + ' past issue' + (s.glitches.length === 1 ? '' : 's'), tone: 'slate', why: s.glitches.map(g => g.overview).join(' · ') })
  if (s.messages.sentiment?.dissatisfied) f.push({ key: 'sentiment', label: 'Unhappy', tone: 'rose', why: s.messages.sentiment.topIssue || s.messages.sentiment.reason || 'dissatisfied in messages' })
  if (s.messages.awaitingReply) f.push({ key: 'reply', label: 'Awaiting reply', tone: 'amber' })
  if (s.claims.length) f.push({ key: 'claim', label: 'Claim · ' + s.claims[0].stage, tone: 'violet' })
  if (s.guest.vip) f.push({ key: 'vip', label: 'VIP', tone: 'violet', why: s.guest.teamNotes || undefined })
  if (s.guest.repeat) f.push({ key: 'repeat', label: s.guest.stays + ' stays', tone: 'emerald', why: 'Returning guest' })
  const wc = s.calls.welcome
  if (wc && /reached|voicemail/.test(wc.outcome)) f.push({ key: 'called', label: wc.outcome === 'voicemail' ? 'Voicemail left' : 'Called', tone: 'emerald', why: (wc.by ? 'by ' + wc.by : '') + (wc.attempts > 1 ? ' · ' + wc.attempts + ' attempts' : '') })
  else if (wc && wc.attempts) f.push({ key: 'called', label: 'No answer ×' + wc.attempts, tone: 'slate' })
  else if (s.dates.phase === 'upcoming') f.push({ key: 'called', label: 'Not called', tone: 'slate' })
  if (s.money && s.money.balance != null && s.money.balance > 0) f.push({ key: 'balance', label: 'Owes $' + Math.round(s.money.balance), tone: 'amber' })
  if (s.money && s.money.refunded) f.push({ key: 'refund', label: 'Refunded $' + Math.round(s.money.refunded), tone: 'rose' })
  if (s.reviews.thisStay && s.reviews.thisStay.rating != null) f.push({ key: 'review', label: 'Reviewed ' + s.reviews.thisStay.rating + '★', tone: s.reviews.thisStay.rating >= 4.5 ? 'emerald' : s.reviews.thisStay.rating >= 4 ? 'slate' : 'rose' })
  if (s.reviews.listingLast && s.reviews.listingLast.rating != null && s.reviews.listingLast.rating <= 3) f.push({ key: 'unit-review', label: 'Unit last review ' + s.reviews.listingLast.rating + '★', tone: 'amber', why: s.reviews.listingLast.content })
  if (s.calls.promised.length) f.push({ key: 'promised', label: s.calls.promised.length + ' promised', tone: 'brand', why: s.calls.promised.map(x => x.item).join(' · ') })
  return f
}

/** Money stripped for people without money access. */
export function redactStay(s: Stay360): Stay360 {
  return { ...s, money: null, guest: { ...s.guest, lifetimeValue: null, history: s.guest.history.map(h => ({ ...h, value: null })) }, claims: s.claims.map(c => ({ ...c, sought: null, paid: null })), glitches: s.glitches.map(g => ({ ...g, refund: null })), orders: { ...s.orders, totalUsd: null }, flags: s.flags.filter(f => f.key !== 'balance' && f.key !== 'refund') }
}
