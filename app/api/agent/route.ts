// The in-app Eve assistant — Stay Hospitality's GM command brain.
// Answers Jon using a RICH live snapshot of the business (unanswered & low reviews,
// unread guest threads, today's check-ins/outs & in-house, upcoming arrivals + revenue,
// open/overdue field work, approvals waiting) plus the operating rules.
// Auth via createClient/getUser (logged-in users only). Snapshot via supabaseAdmin().
// Requires ANTHROPIC_API_KEY.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }
function nowISO() { return new Date().toISOString() }

// Roll unit / building names up to their parent property.
function rollupBuilding(raw: any): string {
  const s = String(raw || '').toLowerCase()
  if (!s) return 'Unknown'
  if (s.includes('botanica')) return 'Botanica'
  if (s.includes('arya')) return 'Arya'
  if (s.includes('oasis')) return 'Oasis'
  // Oasis plant-named units
  if (/mahogany|royal\s*palm|bougainvillea|bamboo|sapodilla|jasmine/.test(s)) return 'Oasis'
  return String(raw)
}

// A rating is "low" on a 5-scale if <=3, or on a 10-scale if <=7.
function isLowRating(r: any): boolean {
  const n = Number(r)
  if (!isFinite(n) || n <= 0) return false
  return n > 5 ? n <= 7 : n <= 3
}

export async function POST(req: NextRequest) {
  // --- Auth guard (preserved): logged-in users only ---
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured - add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })

  const body = await req.json().catch(() => ({} as any))
  const messages = Array.isArray(body?.messages)
    ? body.messages.filter((m: any) => m && m.role && m.content).slice(-12)
    : []
  if (!messages.length) return NextResponse.json({ error: 'no messages' }, { status: 400 })

  const today = new Date()
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(today)
  const in7 = addDays(today, 7)
  const nowTs = nowISO()

  // --- Build the rich live snapshot via admin client (degrades gracefully) ---
  let context: any = { today: todayStr }
  try {
    const db = supabaseAdmin()

    // Listing names for joins (id -> nickname/title). Cheap lookup map.
    let listingName: Record<string, string> = {}
    try {
      const { data: listingRows } = await db.from('guesty_listings').select('id,nickname,title')
      for (const l of (listingRows || [])) {
        listingName[String((l as any).id)] = (l as any).nickname || (l as any).title || ''
      }
    } catch { /* listings table missing or empty */ }

    const nameOf = (lid: any) => listingName[String(lid)] || ''

    const safe = async <T>(p: PromiseLike<T>, fb: T): Promise<T> => {
      try { return await p } catch { return fb }
    }

    const [
      // Reviews
      reviewsUnansweredCount,
      reviewsUnanswered,
      reviewsLow,
      // Conversations
      convsUnread,
      // Reservations
      checkInsRes,
      checkOutsRes,
      inHouseRes,
      arrivalsRes,
      // Field requests
      frOpen,
      frInProgress,
      frActive,
      frApproval,
      // Listings (active)
      listingsActive,
    ] = await Promise.all([
      // count of unanswered reviews
      safe(db.from('guesty_reviews').select('*', { count: 'exact', head: true }).eq('has_reply', false), { count: 0 } as any),
      // examples of unanswered reviews
      safe(db.from('guesty_reviews').select('id,listing_id,rating,content,channel,guest_name,created_at').eq('has_reply', false).order('created_at', { ascending: false }).limit(8), { data: [] } as any),
      // recent low-rated reviews (filter low in JS to handle 5/10 scales)
      safe(db.from('guesty_reviews').select('id,listing_id,rating,content,channel,guest_name,created_at,has_reply').order('created_at', { ascending: false }).limit(40), { data: [] } as any),
      // unread conversations
      safe(db.from('guesty_conversations').select('guest_name,channel,unread_count,last_message_preview,last_message_at').gt('unread_count', 0).order('last_message_at', { ascending: false }).limit(40), { data: [] } as any),
      // today's check-ins
      safe(db.from('guesty_reservations').select('guest_name,listing_name,nights,money_total,status,source').eq('check_in', todayStr).limit(40), { data: [] } as any),
      // today's check-outs
      safe(db.from('guesty_reservations').select('guest_name,listing_name,nights,status,source').eq('check_out', todayStr).limit(40), { data: [] } as any),
      // in-house now (checked in on/before today, checking out after today)
      safe(db.from('guesty_reservations').select('guest_name,listing_name,check_in,check_out,status').lte('check_in', todayStr).gt('check_out', todayStr).limit(80), { data: [] } as any),
      // arrivals next 7 days
      safe(db.from('guesty_reservations').select('guest_name,listing_name,nights,money_total,status,source,check_in').gt('check_in', todayStr).lte('check_in', in7).order('check_in').limit(60), { data: [] } as any),
      // field requests by status
      safe(db.from('field_requests').select('*', { count: 'exact', head: true }).eq('status', 'open'), { count: 0 } as any),
      safe(db.from('field_requests').select('*', { count: 'exact', head: true }).eq('status', 'in_progress'), { count: 0 } as any),
      safe(db.from('field_requests').select('title,type,priority,building,status,due_at,vendor,amount_usd,assignee_email,approval_required,approval_status').in('status', ['open', 'in_progress']).order('due_at', { ascending: true, nullsFirst: false }).limit(60), { data: [] } as any),
      safe(db.from('field_requests').select('title,type,priority,building,status,due_at,vendor,amount_usd,assignee_email,approval_required,approval_status').eq('approval_required', true).limit(40), { data: [] } as any),
      // active listings
      safe(db.from('guesty_listings').select('id,status'), { data: [] } as any),
    ])

    const notCancelled = (r: any) => !/cancel|declin/i.test(String(r?.status || ''))

    // Reviews ---
    const unansweredEx = (reviewsUnanswered.data || []).map((r: any) => ({
      property: nameOf(r.listing_id) || 'Unknown',
      rating: r.rating,
      channel: r.channel,
      guest: r.guest_name,
      when: r.created_at ? String(r.created_at).slice(0, 10) : null,
      excerpt: String(r.content || '').slice(0, 160),
    }))
    const lowReviews = (reviewsLow.data || [])
      .filter((r: any) => isLowRating(r.rating))
      .slice(0, 8)
      .map((r: any) => ({
        property: nameOf(r.listing_id) || 'Unknown',
        rating: r.rating,
        channel: r.channel,
        guest: r.guest_name,
        answered: !!r.has_reply,
        when: r.created_at ? String(r.created_at).slice(0, 10) : null,
        excerpt: String(r.content || '').slice(0, 160),
      }))

    // Conversations ---
    const unreadThreads = (convsUnread.data || [])
    const totalUnread = unreadThreads.reduce((s: number, c: any) => s + (Number(c.unread_count) || 0), 0)
    const unreadEx = unreadThreads.slice(0, 8).map((c: any) => ({
      guest: c.guest_name,
      channel: c.channel,
      unread: c.unread_count,
      preview: String(c.last_message_preview || '').slice(0, 140),
      when: c.last_message_at ? String(c.last_message_at).slice(0, 16).replace('T', ' ') : null,
    }))

    // Reservations ---
    const checkIns = (checkInsRes.data || []).filter(notCancelled)
    const checkOuts = (checkOutsRes.data || []).filter(notCancelled)
    const inHouse = (inHouseRes.data || []).filter(notCancelled)
    const arrivals = (arrivalsRes.data || []).filter(notCancelled)
    const bookedRevenue7 = arrivals.reduce((s: number, r: any) => s + (Number(r.money_total) || 0), 0)

    const trimRes = (r: any) => ({ guest: r.guest_name, property: r.listing_name, nights: r.nights, value: r.money_total, source: r.source, check_in: r.check_in, check_out: r.check_out })

    // Field requests ---
    const active = (frActive.data || [])
    const isClosed = (s: any) => /closed|done|complete|cancel/i.test(String(s || ''))
    const overdue = active.filter((r: any) => r.due_at && String(r.due_at) < nowTs && !isClosed(r.status))
    const awaitingApproval = (frApproval.data || []).filter((r: any) => r.approval_required && String(r.approval_status || '').toLowerCase() !== 'approved')

    const trimFR = (r: any) => ({
      title: r.title,
      type: r.type,
      priority: r.priority,
      building: rollupBuilding(r.building),
      status: r.status,
      due: r.due_at ? String(r.due_at).slice(0, 16).replace('T', ' ') : null,
      vendor: r.vendor,
      amount_usd: r.amount_usd,
      assignee: r.assignee_email,
      approval: r.approval_status,
    })

    // Active listings ---
    const inactiveRe = /inactive|disabled|archived|deleted/i
    const activeListings = (listingsActive.data || []).filter((l: any) => !inactiveRe.test(String(l.status || '')))

    context = {
      today: todayStr,
      listings_active: activeListings.length,

      reviews: {
        unanswered_total: reviewsUnansweredCount.count ?? unansweredEx.length,
        unanswered_examples: unansweredEx,
        low_rated_recent: lowReviews,
      },

      messages: {
        unread_threads: unreadThreads.length,
        total_unread: totalUnread,
        latest: unreadEx,
      },

      reservations: {
        check_ins_today: checkIns.length,
        check_outs_today: checkOuts.length,
        in_house_now: inHouse.length,
        arrivals_next_7d: arrivals.length,
        booked_revenue_next_7d: Math.round(bookedRevenue7),
        check_ins_today_list: checkIns.slice(0, 8).map(trimRes),
        check_outs_today_list: checkOuts.slice(0, 8).map(trimRes),
        upcoming_arrivals: arrivals.slice(0, 8).map(trimRes),
      },

      field_work: {
        open: frOpen.count ?? 0,
        in_progress: frInProgress.count ?? 0,
        overdue_count: overdue.length,
        awaiting_approval_count: awaitingApproval.length,
        overdue_items: overdue.slice(0, 8).map(trimFR),
        awaiting_approval_items: awaitingApproval.slice(0, 8).map(trimFR),
        open_items: active.slice(0, 8).map(trimFR),
      },
    }
  } catch (e) { /* fall back to minimal context — snapshot best-effort */ }

  const SYSTEM = `You are Eve — the sophisticated hospitality intelligence for Stay Hospitality, a South Florida short-term-rental property manager. You speak directly to Jon (owner / Mini GM) as his trusted chief of staff and right hand on the business. Your voice carries a refined, five-star hospitality sensibility — gracious, warm, and composed, like a seasoned luxury-hotel general manager who anticipates needs before they are spoken — yet you remain precise, decisive, and genuinely useful. You surface what needs attention, prioritize it, and give specific operational recommendations. Polished, never stuffy; personable and discreet, never vague or robotic. When you greet or refer to yourself, you are simply Eve.

TEAMS: Work is run by three teams — CCS, Miami, and Broward. When you plan or dispatch work, organize actions by the relevant team.

LIVE SNAPSHOT (JSON — current state of the business; numbers are real, do not invent others):
${JSON.stringify(context)}

HOW TO USE THE SNAPSHOT:
- Be PROACTIVE. When Jon asks "what needs my attention," answer from the snapshot with a crisp, PRIORITIZED list — lead with the highest-stakes items: overdue field work, low-rated/unanswered reviews, items awaiting approval, unread guest threads, then today's arrivals/departures and in-house guests.
- Prioritize by impact: guest-facing problems (low reviews, unanswered messages, today's check-ins) and overdue/approval-blocked work come first; routine items later.
- Cite real figures from the snapshot (counts, names, properties, revenue). If something Jon asks about isn't in the snapshot, say what you'd need rather than guessing. Never invent reservations, reviews, or numbers.
- Refer to properties by their rolled-up building name (Botanica, Oasis, Arya) when discussing buildings.
- If the snapshot shows a table is empty (e.g. reviews before the first sync), just say that data isn't synced yet — don't pretend.

WHAT YOU CAN DO ON REQUEST:
- Draft guest messages (warm, professional, on-brand) when asked.
- Draft review replies when asked — following the safety rules below exactly.
- Build ops plans, prioritize the day, recommend who/which team handles what, and suggest next actions.

REVIEW-REPLY SAFETY RULES (CRITICAL — always apply when drafting any guest-facing review reply or message):
- NEVER admit fault or accept blame.
- NEVER mention unit numbers in guest-facing replies.
- NEVER affirm, confirm, or name bed bugs, pests, break-ins, intrusion, or anyone entering / "walking in." Do not repeat the allegation. Instead, thank the guest for their feedback and note that the team is looking into it / has taken corrective action.
- Keep replies gracious, brief, and professional; redirect serious claims to a private channel where appropriate.

STYLE: Concise. Use short bullets when they help a scan. Lead with the answer or the priority list, then the detail. You're here to make Jon's next decision easy.`

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SYSTEM,
        messages: messages.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) }))
      })
    })
    const d: any = await r.json()
    if (!r.ok) return NextResponse.json({ error: `Anthropic ${r.status}: ${(d?.error?.message || JSON.stringify(d)).slice(0, 200)}` }, { status: 502 })
    const reply = Array.isArray(d?.content) ? d.content.map((c: any) => c?.text || '').join('').trim() : ''
    return NextResponse.json({ reply: reply || '(no response)' })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
