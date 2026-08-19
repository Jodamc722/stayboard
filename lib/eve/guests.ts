// GUESTS domain — reading actual conversations, internal comment threads, and a guest's whole history.
//
// Eve could previously COUNT unread threads but never READ one, which meant she could tell you a
// guest was unhappy and not why. These three tools close that.
import 'server-only'
import type { EveTool, EveDomain } from './types'
import { obj, S } from './types'
import { clampLimit, clampDays, lc, has, safe, cap, chunk, normStar } from './ctx'
import { RELOCATED } from './core'

const ENTITY_TYPES = ['task', 'glitch', 'claim', 'unit']

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
      const { data: msgs } = await ctx.db.from('guesty_messages').select('sender,sender_name,body,sent_at').eq('conversation_id', convId).order('sent_at', { ascending: false }).limit(lim)
      const list = (msgs || []).slice().reverse().map((m: any) => ({
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
        message_count: list.length, truncated: cap(msgs || [], lim).truncated,
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
      let q = ctx.db.from('guesty_reservations').select('id,confirmation_code,guest_name,guest_email,listing_id,listing_name,check_in,check_out,nights,status,source,money_total')
      if (email) q = q.ilike('guest_email', `%${email}%`)
      else q = q.ilike('guest_name', `%${name}%`)
      const { data: resv } = await q.order('check_in', { ascending: false }).limit(clampLimit(input?.limit, 40, 80))
      const stays = (resv || [])
      if (!stays.length) return { found: false, note: `No reservations match "${name || email}".` }
      const resIds = stays.map((r: any) => String(r.id))
      const listingIds: string[] = []
      const seenL: Record<string, true> = {}
      for (const r of stays) { const k = String((r as any).listing_id); if (k && !seenL[k]) { seenL[k] = true; listingIds.push(k) } }
      const nm = String(stays[0].guest_name || name)
      const [revRes, gliRes, claimRes] = await Promise.all([
        safe(ctx.db.from('guesty_reviews').select('listing_id,rating,content,channel,created_at,has_reply').ilike('guest_name', `%${nm}%`).order('created_at', { ascending: false }).limit(20), { data: [] } as any),
        safe(ctx.db.from('glitches').select('id,overview,status,unit,listing_id,created_at,refund_approved,recovery_cost,reservation_id').ilike('guest_name', `%${nm}%`).order('created_at', { ascending: false }).limit(20), { data: [] } as any),
        safe(ctx.db.from('claims').select('id,stage,summary,amount_sought,amount_paid,check_out,property').ilike('guest_name', `%${nm}%`).is('deleted_at', null).order('created_at', { ascending: false }).limit(10), { data: [] } as any),
      ])
      const live = stays.filter((r: any) => !/cancel|declin|inquir|expire/i.test(lc(r.status)))
      return {
        found: true, guest: nm, email: stays[0].guest_email || null,
        summary: {
          stays: live.length, cancelled: stays.length - live.length,
          nights: live.reduce((s: number, r: any) => s + (Number(r.nights) || 0), 0),
          lifetime_value: Math.round(live.reduce((s: number, r: any) => s + (Number(r.money_total) || 0), 0)),
          units_stayed: listingIds.length,
          first_stay: live.length ? String(live[live.length - 1].check_in).slice(0, 10) : null,
          last_stay: live.length ? String(live[0].check_out).slice(0, 10) : null,
        },
        stays: stays.map((r: any) => ({ confirmation: r.confirmation_code, unit: r.listing_name || ctx.nameOf(r.listing_id), check_in: String(r.check_in).slice(0, 10), check_out: String(r.check_out).slice(0, 10), nights: r.nights, status: r.status, channel: r.source, total: r.money_total })),
        reviews: (revRes.data || []).map((r: any) => ({ unit: ctx.nameOf(r.listing_id), rating: normStar(r.rating), rating_scale: '/5', channel: r.channel, date: String(r.created_at).slice(0, 10), answered: !!r.has_reply, text: String(r.content || '').slice(0, 300) })),
        glitches: (gliRes.data || []).map((g: any) => ({ issue: g.overview, status: g.status, unit: g.unit || ctx.nameOf(g.listing_id), opened: String(g.created_at).slice(0, 10), refund_approved: g.refund_approved, recovery_cost: g.recovery_cost })),
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
