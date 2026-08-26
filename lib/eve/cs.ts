// CUSTOMER SERVICE domain additions — the guest side, told properly.
//
// Jon, 2026-08-26: "understand everything about guesty, messages, sentiment, response time,
// reservation details, all the custom fields ... expert in all things ops and customer service."
//
// The audit found four holes, all of the same kind: the app already knew the answer and Eve had no
// route to it.
//   1. No "tell me everything about this reservation" tool — the reservation PAGE assembles exactly
//      that (row + money + resolved custom fields + conversation + notices), Eve could not.
//   2. Response time existed only inside one page component and was never written down.
//   3. Custom fields: the only field tool scanned LISTINGS, so every reservation-level field —
//      the door code for this stay, the order form, the reservation notes, the welcome call — was
//      invisible, even though those are the ones the app writes.
//   4. guest_profiles (VIP, tags, the notes the team keeps on a person) had zero references in any
//      Eve tool, while guest_history's own description told her to weigh exactly that before a
//      goodwill decision.
import 'server-only'
import type { EveTool } from './types'
import { obj, S } from './types'
import { clampLimit, clampDays, lc, has, safe, cap, num, round2 } from './ctx'
import { customFieldNameMap, filledCustomFields } from '@/lib/custom-fields'
import { fmtDuration, median } from '@/lib/response-times'

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0)

export const CS_TOOLS: EveTool[] = [
  {
    name: 'response_times',
    description: 'How fast we actually answer guests — median and average first response, how many within an hour, how many threads are waiting right now, sliced by building, channel or day. Also reports how much of our "response" was an automated Guesty message rather than a person. Use this for any question about responsiveness, speed of reply, or unanswered guests.',
    input_schema: obj({ days: S.num, building: S.str, channel: S.str, by: S.str, limit: S.num }),
    run: async (input, ctx) => {
      const days = clampDays(input?.days, 30, 180)
      const since = new Date(Date.now() - days * 86400000).toISOString()
      const lim = clampLimit(input?.limit, 500, 2000)
      let q = ctx.db.from('conversation_response')
        .select('conversation_id,reservation_id,listing_id,building,channel,first_ms,human_first_ms,replies,guest_msgs,awaiting,last_guest_at,last_host_at,last_responder')
        .gte('last_guest_at', since)
        .order('last_guest_at', { ascending: false })
        .limit(lim)
      if (input?.building) q = q.ilike('building', `%${String(input.building)}%`)
      if (input?.channel) q = q.ilike('channel', `%${String(input.channel)}%`)
      const { data } = await safe(q, { data: [] } as any)
      const rows = ((data as any[]) || [])

      if (!rows.length) {
        return {
          window_days: days,
          note: 'No response records in that window. This table is built by the conversations sync; if it is empty everywhere, the sync has not run since response tracking shipped (2026-08-26).',
        }
      }

      const answered = rows.filter(r => Number.isFinite(r.first_ms))
      const gaps = answered.map(r => Number(r.first_ms))
      const humanGaps = rows.filter(r => Number.isFinite(r.human_first_ms)).map(r => Number(r.human_first_ms))
      const withinHour = gaps.filter(g => g <= 3600_000).length
      const waiting = rows.filter(r => r.awaiting)
      const knownOrigin = rows.filter(r => Number.isFinite(r.human_first_ms)).length

      const group = lc(input?.by)
      let breakdown: any[] | undefined
      if (group === 'building' || group === 'channel') {
        const buckets: Record<string, number[]> = {}
        const waits: Record<string, number> = {}
        for (const r of rows) {
          const k = String((group === 'building' ? r.building : r.channel) || 'unknown')
          if (Number.isFinite(r.first_ms)) (buckets[k] = buckets[k] || []).push(Number(r.first_ms))
          if (r.awaiting) waits[k] = (waits[k] || 0) + 1
        }
        breakdown = Object.keys(buckets).concat(Object.keys(waits).filter(k => !buckets[k]))
          .filter((v, i, a) => a.indexOf(v) === i)
          .map(k => ({
            [group]: k,
            threads: (buckets[k] || []).length,
            median_first_response: fmtDuration(median(buckets[k] || [])),
            within_1h_pct: pct((buckets[k] || []).filter(g => g <= 3600_000).length, (buckets[k] || []).length),
            waiting_now: waits[k] || 0,
          }))
          .sort((a: any, b: any) => (b.waiting_now - a.waiting_now) || (b.threads - a.threads))
      }

      return {
        window_days: days,
        threads: rows.length,
        answered: answered.length,
        median_first_response: fmtDuration(median(gaps)),
        average_first_response: fmtDuration(gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null),
        within_1h_pct: pct(withinHour, gaps.length),
        waiting_now: waiting.length,
        longest_waiting: waiting
          .sort((a, b) => new Date(a.last_guest_at || 0).getTime() - new Date(b.last_guest_at || 0).getTime())
          .slice(0, 8)
          .map(r => ({ unit: ctx.nameOf(r.listing_id), building: r.building, channel: r.channel, guest_last_spoke: r.last_guest_at, waiting: fmtDuration(Date.now() - new Date(r.last_guest_at || 0).getTime()) })),
        by: breakdown,
        // The honesty line. Guesty fires templates AS the host, so a "fast reply" may have been a
        // robot. Say what share of this number we can actually attribute to a person.
        human_vs_automated: {
          median_when_a_person_replied: fmtDuration(median(humanGaps)),
          threads_where_origin_is_known: knownOrigin,
          coverage_pct: pct(knownOrigin, rows.length),
          caveat: knownOrigin < rows.length * 0.5
            ? 'Origin is unknown for most of these — Guesty did not tell us whether the reply was a person or an automation, so the headline number may be flattered by template messages. Say so when you quote it.'
            : 'Where origin is known, the human number is the one to quote — the headline includes automated replies.',
        },
        data_note: 'Guesty files its own activity entries ("log", "note") into the same threads; those are excluded — they were never sent to a guest. Only real inbound/outbound messages count here.',
        attribution_note: 'These are TEAM numbers. Attributing a reply to an individual relies on the sender name Guesty gives us, which is a proxy, not proof — do not name a person as slow off this tool.',
      }
    },
  },

  {
    name: 'reservation_detail',
    description: 'EVERYTHING about one reservation: guest, dates, unit, channel, money, notes, every custom field with its real name (door code for the stay, order form, welcome call, cleaning time), the conversation and its sentiment, plus any glitches or claims attached. Pass reservation_id or confirmation_code, or a guest name plus optionally a unit. This is the tool for "tell me about this booking" and the one to open before answering anything guest-specific.',
    input_schema: obj({ reservation_id: S.str, confirmation_code: S.str, guest: S.str, unit: S.str }, []),
    money: true,
    run: async (input, ctx) => {
      const sel = 'id,listing_id,listing_name,guest_id,guest_name,guest_email,guest_phone,check_in,check_out,nights,status,source,confirmation_code,money_total,money_paid,money_balance,notes,custom_fields,conversation_id,created_at,raw'
      let row: any = null
      const id = String(input?.reservation_id || '').trim()
      const code = String(input?.confirmation_code || '').trim()
      if (id) {
        const { data } = await safe(ctx.db.from('guesty_reservations').select(sel).eq('id', id).limit(1), { data: [] } as any)
        row = ((data as any[]) || [])[0] || null
      }
      if (!row && code) {
        const { data } = await safe(ctx.db.from('guesty_reservations').select(sel).ilike('confirmation_code', code).order('check_in', { ascending: false }).limit(1), { data: [] } as any)
        row = ((data as any[]) || [])[0] || null
      }
      if (!row && input?.guest) {
        let q = ctx.db.from('guesty_reservations').select(sel).ilike('guest_name', `%${String(input.guest)}%`)
        if (input?.unit) {
          const ids = ctx.idsForName(String(input.unit))
          if (ids.length) q = q.in('listing_id', ids)
        }
        const { data } = await safe(q.order('check_in', { ascending: false }).limit(1), { data: [] } as any)
        row = ((data as any[]) || [])[0] || null
      }
      if (!row) return { error: 'No reservation matched. Give me a reservation id, a confirmation code, or a guest name (a unit narrows it).' }

      // Custom fields, resolved to their real names. This plumbing already existed for the
      // reservation page and had never been wired to a tool.
      let fields: { name: string; value: string }[] = []
      try {
        const map = await customFieldNameMap()
        fields = filledCustomFields(row.custom_fields, map)
      } catch { /* an unresolved field list is better than no reservation */ }

      const m = row?.raw?.money || {}
      const conv = row.conversation_id
        ? await safe(ctx.db.from('guesty_conversations').select('id,channel,unread_count,last_message_at').eq('id', row.conversation_id).maybeSingle(), { data: null } as any)
        : { data: null } as any
      const sent = row.conversation_id
        ? await safe(ctx.db.from('guesty_conversation_sentiment').select('score,band,dissatisfied,top_issue,reason,awaiting_reply').eq('conversation_id', row.conversation_id).maybeSingle(), { data: null } as any)
        : { data: null } as any
      const resp = row.conversation_id
        ? await safe(ctx.db.from('conversation_response').select('first_ms,human_first_ms,replies,awaiting,last_guest_at,last_responder').eq('conversation_id', row.conversation_id).maybeSingle(), { data: null } as any)
        : { data: null } as any
      const gl = await safe(ctx.db.from('glitches').select('id,overview,status,unit,created_at').eq('reservation_id', row.id).order('created_at', { ascending: false }).limit(10), { data: [] } as any)
      const cl = await safe(ctx.db.from('claims').select('id,stage,summary,amount_sought,amount_paid,deadline_on').eq('reservation_id', row.id).is('deleted_at', null).order('deadline_on', { ascending: true }).limit(10), { data: [] } as any)
      const prof = row.guest_email
        ? await safe(ctx.db.from('guest_profiles').select('vip,tags,notes').eq('guest_key', lc(row.guest_email)).maybeSingle(), { data: null } as any)
        : { data: null } as any

      return {
        reservation_id: row.id,
        confirmation_code: row.confirmation_code,
        guest: { name: row.guest_name, email: row.guest_email, phone: row.guest_phone,
                 vip: prof?.data?.vip || false, tags: prof?.data?.tags || [], team_notes: prof?.data?.notes || null },
        unit: ctx.nameOf(row.listing_id), building: ctx.buildingOf(row.listing_id), listing_id: row.listing_id,
        stay: { check_in: row.check_in, check_out: row.check_out, nights: row.nights, status: row.status, booked_on: row.created_at },
        channel: row.source,
        money: {
          total: num(row.money_total), paid: num(row.money_paid), balance: num(row.money_balance),
          accommodation: round2(m.fareAccommodationAdjusted ?? m.fareAccommodation), cleaning: round2(m.fareCleaning),
          host_payout: round2(m.hostPayout), fully_paid: m.isFullyPaid ?? undefined,
        },
        notes: row.notes || null,
        custom_fields: fields.length ? fields : 'none set on this reservation',
        conversation: conv?.data ? {
          id: conv.data.id, channel: conv.data.channel, unread: conv.data.unread_count, last_message_at: conv.data.last_message_at,
          sentiment: sent?.data || null,
          first_response: resp?.data ? fmtDuration(resp.data.first_ms) : null,
          first_response_by_a_person: resp?.data ? fmtDuration(resp.data.human_first_ms) : null,
          awaiting_our_reply: resp?.data?.awaiting ?? sent?.data?.awaiting_reply ?? null,
          last_responder: resp?.data?.last_responder || null,
        } : 'no conversation linked',
        glitches: ((gl as any)?.data || []).map((g: any) => ({ id: g.id, what: g.overview, status: g.status, unit: g.unit, at: g.created_at })),
        claims: ((cl as any)?.data || []).map((c: any) => ({ id: c.id, stage: c.stage, what: c.summary, sought: c.amount_sought, paid: c.amount_paid, deadline: c.deadline_on })),
        read_the_thread_with: 'guest_thread with this conversation_id — a sentiment score is not a substitute for the actual words.',
      }
    },
  },

  {
    name: 'custom_fields',
    description: 'The Guesty custom-field map — every field we know about, whether it lives on the LISTING or on the RESERVATION, its merge tag, and how often it is actually filled in. Pass a name to look one up, and a reservation_id or unit to read its value there. Use this before saying a field does not exist, and for "what fields do we have", "is the door code set on this stay", "how many units are missing X".',
    input_schema: obj({ name: S.str, reservation_id: S.str, unit: S.str, target: S.str }),
    run: async (input, ctx) => {
      const { data: defs } = await safe(
        ctx.db.from('guesty_custom_fields').select('id,name,slug,type,target,tracked,display_name').order('target').limit(400),
        { data: [] } as any,
      )
      let list = ((defs as any[]) || [])
      if (input?.target) list = list.filter(d => lc(d.target) === lc(input.target))
      if (input?.name) list = list.filter(d => has(d.name, input.name) || has(d.slug, input.name) || has(d.display_name, input.name))

      // Value on a specific reservation.
      if (input?.reservation_id) {
        const { data } = await safe(ctx.db.from('guesty_reservations').select('id,guest_name,listing_id,custom_fields').eq('id', String(input.reservation_id)).limit(1), { data: [] } as any)
        const row = ((data as any[]) || [])[0]
        if (!row) return { error: 'No reservation with that id.' }
        let fields: { name: string; value: string }[] = []
        try { fields = filledCustomFields(row.custom_fields, await customFieldNameMap()) } catch { /* fall through */ }
        const wanted = input?.name ? fields.filter(f => has(f.name, input.name)) : fields
        return {
          reservation_id: row.id, guest: row.guest_name, unit: ctx.nameOf(row.listing_id),
          fields_set: wanted.length ? wanted : (input?.name ? `nothing set for "${input.name}" on this reservation` : 'no custom fields set'),
          all_fields_set_count: fields.length,
          note: 'A field missing here means nobody filled it in for this stay — it does not mean the field does not exist.',
        }
      }

      // Value on a specific unit (listing-level fields live on the listing row).
      if (input?.unit) {
        const ids = ctx.idsForName(String(input.unit))
        if (!ids.length) return { error: `No unit matched "${input.unit}".` }
        const { data } = await safe(ctx.db.from('guesty_listings').select('id,nickname,title,raw').in('id', ids.slice(0, 5)).order('id'), { data: [] } as any)
        const out = ((data as any[]) || []).map((l: any) => {
          const cfs = Array.isArray(l?.raw?.customFields) ? l.raw.customFields : []
          const named = cfs.map((c: any) => ({ name: String(c?.fieldId?.name || c?.fieldName || c?.name || ''), value: String(c?.value ?? '') })).filter((c: any) => c.name && c.value)
          return { unit: l.nickname || l.title, fields: input?.name ? named.filter((f: any) => has(f.name, input.name)) : named }
        })
        return { units: out, note: 'Listing-level fields. The code valid for a specific STAY is a reservation field — read that with reservation_id.' }
      }

      // Coverage across reservations for reservation-scoped fields (the blind spot the old
      // guesty_fields tool had: it only ever scanned listings).
      const resFields = list.filter(d => lc(d.target) === 'reservation')
      let coverage: any = undefined
      if (resFields.length) {
        const { data } = await safe(
          ctx.db.from('guesty_reservations').select('custom_fields').gte('check_in', new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)).order('check_in', { ascending: false }).limit(600),
          { data: [] } as any,
        )
        const rows = ((data as any[]) || [])
        const counts: Record<string, number> = {}
        for (const r of rows) {
          for (const cf of (Array.isArray(r.custom_fields) ? r.custom_fields : [])) {
            const fid = String(cf?.fieldId?._id || cf?.fieldId || '')
            const v = cf?.value
            if (fid && v !== null && v !== undefined && String(v).trim() !== '') counts[fid] = (counts[fid] || 0) + 1
          }
        }
        coverage = { sampled_reservations: rows.length, filled: resFields.map(f => ({ field: f.name, filled_on: counts[String(f.id)] || 0, pct: pct(counts[String(f.id)] || 0, rows.length) })) }
      }

      return {
        count: list.length,
        fields: list.map(d => ({ name: d.display_name || d.name, merge_tag: d.slug, lives_on: d.target, type: d.type, tracked: d.tracked })),
        reservation_field_coverage: coverage,
        truncated: cap(list, 400).truncated,
      }
    },
  },

  {
    name: 'guest_profile',
    description: 'What the team knows about a person, as opposed to a booking: VIP flag, tags, and the internal notes anyone has written about them. Pass a name or email. ALWAYS check this before recommending goodwill, a refund, or how to handle someone.',
    input_schema: obj({ guest: S.str, email: S.str, limit: S.num }),
    run: async (input, ctx) => {
      const lim = clampLimit(input?.limit, 10, 40)
      let q = ctx.db.from('guest_profiles').select('guest_key,name,email,phone,vip,tags,notes,updated_at').order('updated_at', { ascending: false }).limit(lim)
      if (input?.email) q = q.ilike('email', `%${String(input.email)}%`)
      else if (input?.guest) q = q.ilike('name', `%${String(input.guest)}%`)
      else q = q.eq('vip', true)
      const { data } = await safe(q, { data: [] } as any)
      const rows = ((data as any[]) || [])
      if (!rows.length) {
        return { found: 0, note: input?.guest || input?.email ? 'No profile for that guest. That means nobody has written anything down about them — not that they are a new guest. Check guest_history for their stays.' : 'No VIP guests flagged.' }
      }
      return {
        found: rows.length,
        guests: rows.map(r => ({
          name: r.name, email: r.email, phone: r.phone || undefined,
          vip: !!r.vip, tags: r.tags || [], notes: r.notes || null, updated: r.updated_at,
        })),
        note: 'VIP here is OUR flag, set by the team — it also triggers an automatic pre-arrival inspection. It is not a Guesty field.',
      }
    },
  },

  {
    name: 'awaiting_reply',
    description: 'Guest threads waiting on US right now — the guest spoke last and nobody has answered — oldest first, with how long they have been waiting and what the thread is about. Use this for "who is waiting", "anything unanswered", and at the start of any customer-service sweep.',
    input_schema: obj({ building: S.str, hours: S.num, limit: S.num }),
    run: async (input, ctx) => {
      const lim = clampLimit(input?.limit, 25, 80)
      const minHours = Math.max(Number(input?.hours) || 0, 0)
      let q = ctx.db.from('conversation_response')
        .select('conversation_id,reservation_id,listing_id,building,channel,last_guest_at,guest_msgs,replies')
        .eq('awaiting', true)
        .order('last_guest_at', { ascending: true })
        .limit(lim * 2)
      if (input?.building) q = q.ilike('building', `%${String(input.building)}%`)
      const { data } = await safe(q, { data: [] } as any)
      let rows = ((data as any[]) || [])
      if (minHours) rows = rows.filter(r => Date.now() - new Date(r.last_guest_at || 0).getTime() >= minHours * 3600_000)
      rows = rows.slice(0, lim)
      if (!rows.length) return { waiting: 0, note: 'Nothing is waiting on us in that scope. If that seems too good, check that the conversations sync ran — awaiting_reply is only as fresh as the last message pull.' }

      const ids = rows.map(r => String(r.conversation_id))
      const sent: any = await safe(ctx.db.from('guesty_conversation_sentiment').select('conversation_id,score,band,top_issue,dissatisfied').in('conversation_id', ids.slice(0, 60)), { data: [] } as any)
      const byConv: Record<string, any> = {}
      for (const s of ((sent?.data as any[]) || [])) byConv[String(s.conversation_id)] = s

      return {
        waiting: rows.length,
        threads: rows.map(r => {
          const s = byConv[String(r.conversation_id)]
          return {
            conversation_id: r.conversation_id,
            unit: ctx.nameOf(r.listing_id), building: r.building, channel: r.channel,
            guest_last_spoke: r.last_guest_at,
            waiting_for: fmtDuration(Date.now() - new Date(r.last_guest_at || 0).getTime()),
            exchanges: `${r.guest_msgs} from them / ${r.replies} from us`,
            sentiment: s ? { score: s.score, band: s.band, issue: s.top_issue, unhappy: s.dissatisfied } : null,
          }
        }),
        unhappy_and_waiting: rows.filter(r => byConv[String(r.conversation_id)]?.dissatisfied).length,
        next: 'Read any of these with guest_thread before drafting anything.',
      }
    },
  },
]
