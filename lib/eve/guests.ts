// GUESTS domain — reading actual conversations, internal comment threads, and a guest's whole history.
//
// Eve could previously COUNT unread threads but never READ one, which meant she could tell you a
// guest was unhappy and not why. These three tools close that.
import 'server-only'
import type { EveTool, EveDomain } from './types'
import { obj, S } from './types'
import { clampLimit, lc, safe, normStar, num, toolMeta } from './ctx'
import { LIVE_STAY_STATUSES, channelFeeOf, NET_BASIS_NOTE } from '@/lib/basis'
import { isOwnerOrFriendsFamily } from '@/lib/owner-audit'
import { RELOCATED } from './core'

const ENTITY_TYPES = ['task', 'glitch', 'claim', 'unit']

/** Guesty activity logs and internal notes — filed in the thread, never sent to or by the guest. */
const INTERNAL_MODULES = new Set(['log', 'note', 'notes', 'internal', 'internal_note', 'activity', 'system'])
function isInternalEntry(m: any): boolean {
  return lc(m?.sender) === 'system' || INTERNAL_MODULES.has(lc(m?.module))
}

export const GUEST_TOOLS: EveTool[] = [
  {
    name: 'guest_thread',
    description: 'READ an actual guest conversation — every message in order, who sent it and when. Pass conversation_id, reservation_id, or a guest name. Use this before drafting any reply or judging what a guest actually asked for; a sentiment score is not a substitute for reading the thread.',
    input_schema: obj({ conversation_id: S.str, reservation_id: S.str, guest: S.str, limit: S.num }),
    run: async (input, ctx) => {
      const lim = clampLimit(input?.limit, 40, 80)
      let convId = String(input?.conversation_id || '').trim()
      let conv: any = null
      if (!convId) {
        let q = ctx.db.from('guesty_conversations').select('id,guest_name,channel,reservation_id,listing_id,unread_count,last_message_at')
        if (input?.reservation_id) q = q.eq('reservation_id', String(input.reservation_id))
        else if (input?.guest) q = q.ilike('guest_name', `%${input.guest}%`)
        else return { error: 'Give me a conversation_id, a reservation_id, or a guest name.' }
        const { data } = await q.order('last_message_at', { ascending: false }).limit(1)
        conv = (data || [])[0] || null
        if (!conv) return { error: 'No conversation found for that guest or reservation.' }
        convId = String(conv.id)
      } else {
        const { data } = await ctx.db.from('guesty_conversations').select('id,guest_name,channel,reservation_id,listing_id,unread_count,last_message_at').eq('id', convId).limit(1)
        conv = (data || [])[0] || null
      }
      // GUESTY'S OWN ENTRIES ARE NOT PART OF THE CONVERSATION (Jon, 2026-09-23 review). Guesty files
      // activity logs ("New guest inquiry") and internal team notes into the same thread, and this
      // tool printed them as lines from "us" — so a reply drafted from it answered, quoted or
      // leaked a note the guest never saw. Rows whose module is a log / note / internal entry, and
      // rows the sync already filed as sender 'system', are left out and counted instead. Older
      // rows predate that sync fix and can carry a log module under 'host' or even 'guest', which
      // is why the module is checked and not just the sender. Read a little deeper so filtering
      // does not shorten the thread the caller asked for.
      const fetchCap = Math.min(lim * 2, 160)
      const { data: raw } = await ctx.db.from('guesty_messages').select('sender,sender_name,body,sent_at,module').eq('conversation_id', convId).order('sent_at', { ascending: false }).limit(fetchCap)
      const real = (raw || []).filter((m: any) => !isInternalEntry(m))
      const hiddenInternal = (raw || []).length - real.length
      const msgs = real.slice(0, lim)
      const list = msgs.slice().reverse().map((m: any) => ({
        from: /guest|inbound/i.test(lc(m.sender)) ? 'GUEST' : (m.sender_name || 'us'),
        at: m.sent_at, text: String(m.body || '').slice(0, 800),
      }))
      const sent: any = await safe(ctx.db.from('guesty_conversation_sentiment').select('score,band,dissatisfied,top_issue,awaiting_reply,reason').eq('conversation_id', convId).maybeSingle(), { data: null } as any)
      return {
        conversation_id: convId,
        guest: conv?.guest_name, channel: conv?.channel,
        unit: conv ? ctx.nameOf(conv.listing_id) : null, building: conv ? ctx.buildingOf(conv.listing_id) : null,
        reservation_id: conv?.reservation_id, unread: conv?.unread_count,
        sentiment: sent?.data || null,
        message_count: list.length, truncated: real.length > lim || (raw || []).length >= fetchCap,
        internal_entries_hidden: hiddenInternal || undefined,
        messages: list,
      }
    },
  },

  {
    name: 'comments',
    description: 'The INTERNAL comment thread on a record — what the team actually said to each other about it. entity_type is one of task (a Breezeway task id), glitch, claim, or unit (a listing id). Pass entity_id. Use this to find out what has already been tried before proposing anything.',
    input_schema: obj({ entity_type: S.str, entity_id: S.str, limit: S.num }, ['entity_type', 'entity_id']),
    run: async (input, ctx) => {
      const t = lc(input?.entity_type)
      if (ENTITY_TYPES.indexOf(t) < 0) return { error: `entity_type must be one of ${ENTITY_TYPES.join(', ')}` }
      const id = String(input?.entity_id || '').trim()
      if (!id) return { error: 'entity_id required' }
      const { data, error } = await ctx.db.from('app_comments').select('author_email,body,mentions,created_at')
        .eq('entity_type', t).eq('entity_id', id).order('created_at').limit(clampLimit(input?.limit, 50, 100))
      if (error) return { error: 'Comments unavailable: ' + error.message.slice(0, 120) }
      return {
        entity_type: t, entity_id: id, count: (data || []).length,
        comments: (data || []).map((c: any) => ({ by: c.author_email, at: c.created_at, text: String(c.body || '').slice(0, 600), mentions: c.mentions })),
      }
    },
  },

  {
    name: 'guest_history',
    description: 'One guest across EVERYTHING: all their stays, what they paid, the reviews they left, any glitches or claims raised on their reservations, and their sentiment history. Pass the guest name (or an email). Use this before any goodwill decision — a repeat guest with four clean stays is a different conversation from a first-timer.',
    input_schema: obj({ guest: S.str, email: S.str, limit: S.num }, []),
    money: true,
    run: async (input, ctx) => {
      const name = String(input?.guest || '').trim()
      const email = String(input?.email || '').trim()
      if (!name && !email) return { error: 'Give me a guest name or email.' }
      // ONE BASIS (2026-11-10, lib/basis.ts): what a guest is WORTH to us is accommodation after the
      // channel fee over their real stays — not the sum of every bill including cleaning and taxes,
      // and not a booking that never became a stay. Both figures are returned, each labelled.
      const SLIM = 'id,confirmation_code,guest_name,guest_email,listing_id,listing_name,check_in,check_out,nights,status,source,money_total'
      const FULL = SLIM + ',fare:raw->money->>fareAccommodationAdjusted,fee:raw->money->>hostServiceFee,fee_inc:raw->money->>hostServiceFeeIncTax,tags:raw->tags'
      const lim = clampLimit(input?.limit, 40, 80)
      const read = (cols: string) => {
        let q = ctx.db.from('guesty_reservations').select(cols, { count: 'exact' })
        if (email) q = q.ilike('guest_email', `%${email}%`)
        else q = q.ilike('guest_name', `%${name}%`)
        return q.order('check_in', { ascending: false }).limit(lim)
      }
      let res: any = await read(FULL)
      let hasBasis = true
      if (res?.error) { res = await read(SLIM); hasBasis = false }
      const stays: any[] = (res?.data as any[]) || []
      const totalRows: number | null = typeof res?.count === 'number' ? res.count : null
      if (!stays.length) return { found: false, note: `No reservations match "${name || email}".` }
      const listingIds: string[] = []
      const seenL: Record<string, true> = {}
      for (const r of stays) { const k = String((r as any).listing_id); if (k && !seenL[k]) { seenL[k] = true; listingIds.push(k) } }
      const nm = String(stays[0].guest_name || name)
      const [revRes, gliRes, claimRes] = await Promise.all([
        safe(ctx.db.from('guesty_reviews').select('listing_id,rating,content,channel,created_at,has_reply').ilike('guest_name', `%${nm}%`).is('removed_at', null).order('created_at', { ascending: false }).limit(20), { data: [] } as any),
        safe(ctx.db.from('glitches').select('id,overview,status,unit,listing_id,created_at,refund_approved,reservation_id').ilike('guest_name', `%${nm}%`).order('created_at', { ascending: false }).limit(20), { data: [] } as any),
        safe(ctx.db.from('claims').select('id,stage,summary,amount_sought,amount_paid,check_out,property').ilike('guest_name', `%${nm}%`).is('deleted_at', null).order('created_at', { ascending: false }).limit(10), { data: [] } as any),
      ])
      const live = stays.filter((r: any) => !/cancel|declin|inquir|expire/i.test(lc(r.status)))
      const real = stays.filter((r: any) => LIVE_STAY_STATUSES.indexOf(lc(r.status).trim()) >= 0)
      const ownerish = (r: any): boolean => {
        const tagBlob = Array.isArray(r.tags) ? r.tags.map((x: any) => String(x)).join(' ') : ''
        return isOwnerOrFriendsFamily(String(r.source || ''), tagBlob, String(r.guest_name || ''))
      }
      const netOf = (r: any): number | null => (hasBasis && r.fare != null && r.fare !== '' ? Math.max(0, num(r.fare) - channelFeeOf(num(r.fee_inc), num(r.fee))) : null)
      const realGuest = real.filter((r: any) => !ownerish(r))
      // A NAME IS NOT A PERSON. The match is "name contains", so two different guests can share it.
      const distinct: Record<string, true> = {}
      for (const r of stays) distinct[lc(r.guest_name).trim() + '|' + lc(r.guest_email).trim()] = true
      const people = Object.keys(distinct).length
      const cut = totalRows != null ? totalRows > stays.length : stays.length >= lim
      return {
        found: true, guest: nm, email: stays[0].guest_email || null,
        total_rows: totalRows, truncated: cut,
        more_than_one_person: people > 1 ? `These ${stays.length} bookings carry ${people} different name / email combinations — "${name || email}" may be more than one guest. Check the names and emails on the stays before treating this as one person's history; search by email to be sure.` : undefined,
        basis: `net_accommodation_usd = ${NET_BASIS_NOTE}, over real stays only (${LIVE_STAY_STATUSES.join(' / ')}), owner and friends-and-family stays left out. lifetime_value is the older figure: every non-cancelled bill in full (cleaning and taxes in) — it is what the guest paid, not what we earned.`,
        _meta: toolMeta({ source: 'guesty_reservations + guesty_reviews + glitches + claims (matched by guest name)', window: 'all time, newest first', n: stays.length, truncated: cut, basis: 'net accommodation after channel fee · real stays' }),
        summary: {
          stays: live.length, cancelled: stays.length - live.length,
          nights: live.reduce((s: number, r: any) => s + (Number(r.nights) || 0), 0),
          lifetime_value: Math.round(live.reduce((s: number, r: any) => s + (Number(r.money_total) || 0), 0)),
          real_stays: realGuest.length,
          real_stay_nights: realGuest.reduce((s: number, r: any) => s + (Number(r.nights) || 0), 0),
          net_accommodation_usd: hasBasis ? Math.round(realGuest.reduce((s: number, r: any) => s + (netOf(r) || 0), 0)) : null,
          owner_or_friends_family_stays: real.length - realGuest.length,
          units_stayed: listingIds.length,
          first_stay: live.length ? String(live[live.length - 1].check_in).slice(0, 10) : null,
          last_stay: live.length ? String(live[0].check_out).slice(0, 10) : null,
        },
        stays: stays.map((r: any) => ({ confirmation: r.confirmation_code, unit: r.listing_name || ctx.nameOf(r.listing_id), check_in: String(r.check_in).slice(0, 10), check_out: String(r.check_out).slice(0, 10), nights: r.nights, status: r.status, channel: r.source, total: r.money_total, net_accommodation: netOf(r) == null ? null : Math.round(netOf(r) as number), stay_kind: ownerish(r) ? 'owner_or_friends_family' : 'guest' })),
        reviews: (revRes.data || []).map((r: any) => ({ unit: ctx.nameOf(r.listing_id), rating: normStar(r.rating), rating_scale: '/5', channel: r.channel, date: String(r.created_at).slice(0, 10), answered: !!r.has_reply, text: String(r.content || '').slice(0, 300) })),
        glitches: (gliRes.data || []).map((g: any) => ({ issue: g.overview, status: g.status, unit: g.unit || ctx.nameOf(g.listing_id), opened: String(g.created_at).slice(0, 10), refund_approved: g.refund_approved  })),
        claims: (claimRes.data || []).map((c: any) => ({ stage: c.stage, property: c.property, summary: String(c.summary || '').slice(0, 200), sought: c.amount_sought, paid: c.amount_paid })),
      }
    },
  },

  RELOCATED.unread_conversations,
  RELOCATED.welcome_calls,
]

export const GUESTS_DOMAIN: EveDomain = {
  key: 'guests',
  label: 'Guests',
  blurb: 'Read real message threads, internal comment threads on any record, a guest\'s whole history across stays/reviews/glitches/claims, unread threads and the welcome-call queue.',
  tools: GUEST_TOOLS,
}
