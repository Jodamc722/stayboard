// Eve — Stay Hospitality's operating brain. A TOOL-USING agent with progressive tool loading,
// a durable memory, and every exchange logged so she can be corrected and get better.
//
// WHAT CHANGED IN v2 (2026-08-19):
//   ACCESS  — the hardcoded `email !== jon@` check is gone. Eve is now a real feature key, so she is
//             owner + admin by default and can be switched on for any role from /users -> Roles
//             without a code change.
//   REACH   — 13 tools over 6 tables became 48 tools over ~38, split into five domains that load on
//             demand (lib/eve/registry.ts explains why that beats handing her all 48 at once).
//   MEMORY  — what she learns survives the conversation (lib/eve/memory.ts).
//   LOGGING — every exchange lands in eve_chats with the tools she used, so a thumbs-down can be
//             turned into a correction instead of evaporating.
//   BUDGET  — maxDuration 60 -> 300 (ten other routes in this app already run at 300) and the loop
//             cap 10 -> 16, because a real investigation now chains more calls.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, canSeeMoney, isSuperadmin } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildCtx, todayET, daysAgoISO, safe, count as cnt, lc } from '@/lib/eve/ctx'
import { wireTools, runTool, DOMAIN_KEYS } from '@/lib/eve/registry'
import { loadMemories, renderMemories, touchMemories, scopesForText, saveMemory } from '@/lib/eve/memory'
import { appAtlas } from '@/lib/eve/atlas'
import { buildSystem, getVoiceProfile } from '@/lib/eve/prompt'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MODEL = 'claude-opus-4-8'

// Anthropic's SERVER-SIDE web search. Jon asked Eve to "connect to internet and study trends in
// south florida" — this is the supported way. Verified against the tool reference (Aug 2026):
// type `web_search_20250305`, name `web_search`, NO anthropic-beta header, and it lives in the same
// tools array as our own client tools.
//
// It does NOT emit `tool_use` blocks — it emits `server_tool_use` + `web_search_tool_result` — so
// the dispatch loop below never mistakes a search for one of our tools.
//
// Model support for this exact model string is not enumerated in the docs, so `callAnthropic` below
// degrades gracefully: if the API rejects the tool, we retry once without it rather than failing the
// whole answer. Costs $10 per 1,000 searches, hence max_uses.
const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 6,
  user_location: { type: 'approximate', city: 'Miami', region: 'Florida', country: 'US', timezone: 'America/New_York' },
}
const MAX_TURNS = 16
const TOOL_RESULT_CHARS = 9000

/** Eve is owner + admin by default; a role can be granted `eve` explicitly from /users. */
export async function eveGate() {
  const access = await getAccess()
  if (!access.user) return { ok: false as const, res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }), access }
  if (!access.allowed) return { ok: false as const, res: NextResponse.json({ error: 'no-access' }, { status: 403 }), access }
  // Owner, anyone with role=admin, or a DB role that has been explicitly granted `eve`.
  // Deliberately NOT the legacy workspace path: a legacy "gm" workspace resolves every page to
  // full, which would hand Eve to people Jon has not switched on. An explicit accessRole is required.
  const byRole = !!access.accessRole && atLeast(access.levels?.eve, 'view')
  const allowed = isSuperadmin(access.email) || access.role === 'admin' || byRole
  if (!allowed) {
    return { ok: false as const, res: NextResponse.json({ error: 'forbidden', message: 'Eve is available to admins. Ask Jon to switch her on for your role.' }, { status: 403 }), access }
  }
  return { ok: true as const, access }
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const access = gate.access

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured - add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })

  const body = await req.json().catch(() => ({} as any))
  const messages = Array.isArray(body?.messages) ? body.messages.filter((m: any) => m && m.role && m.content).slice(-12) : []
  if (!messages.length) return NextResponse.json({ error: 'no messages' }, { status: 400 })

  const startedAt = Date.now()
  const canMoney = canSeeMoney(access)
  const ctx = await buildCtx(access, canMoney)
  const db = supabaseAdmin()
  const today = todayET()

  // --- Light headline snapshot: cheap counts, for instant situational awareness only. ---
  const cutoff60 = daysAgoISO(60)
  const [unansweredRows, unreadCount, checkinCount, checkoutCount, inhouseCount, openFW, apprFW] = await Promise.all([
    safe(db.from('guesty_reviews').select('listing_id').eq('has_reply', false).eq('excluded_from_score', false).gte('created_at', cutoff60).order('id').limit(500), { data: [] } as any),
    cnt(db.from('guesty_conversations').select('*', { count: 'exact', head: true }).gt('unread_count', 0)),
    cnt(db.from('guesty_reservations').select('*', { count: 'exact', head: true }).eq('check_in', today)),
    cnt(db.from('guesty_reservations').select('*', { count: 'exact', head: true }).eq('check_out', today)),
    cnt(db.from('guesty_reservations').select('*', { count: 'exact', head: true }).lte('check_in', today).gt('check_out', today)),
    cnt(db.from('field_requests').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress'])),
    cnt(db.from('field_requests').select('*', { count: 'exact', head: true }).eq('approval_required', true).neq('approval_status', 'approved')),
  ])
  const headline = {
    today,
    unanswered_reviews_60d: ((unansweredRows as any).data || []).filter((r: any) => ctx.reviewable(r.listing_id)).length,
    unread_guest_threads: unreadCount, checkins_today: checkinCount, checkouts_today: checkoutCount,
    in_house_now: inhouseCount, open_field_work: openFW, approvals_waiting: apprFW,
    listings_total: Object.keys(ctx.listingMeta).length,
  }

  // --- Memory, scoped to what this question is actually about. ---
  const lastUser = String([...messages].reverse().find((m: any) => m.role === 'user')?.content || '')
  const wholeThread = messages.map((m: any) => String(m.content || '')).join(' \n ')
  const scopes = scopesForText(wholeThread, ctx.listingMeta)
  // The question rides along so retrieval can rank by RELEVANCE, not just weight — the memories
  // about the thing being asked beat equally-weighted trivia about everything else.
  const memories = await loadMemories(scopes, ctx.email, 60, lastUser || wholeThread)
  const voice = await safe(getVoiceProfile(), '')

  const userName = String((access.profile as any)?.name || '') || (access.email ? access.email.split('@')[0] : '')

  // Domains stay open for the whole exchange once Eve opens them. A caller may pre-open some
  // (the /eve page does this when you click into a board) so she does not spend a turn on it.
  const open: string[] = []
  const preOpen = Array.isArray(body?.domains) ? body.domains : []
  for (const d of preOpen) { const k = lc(d); if (DOMAIN_KEYS.indexOf(k) >= 0 && open.indexOf(k) < 0) open.push(k) }

  const convo: any[] = messages.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 8000) }))
  const toolsUsed: string[] = []

  try {
    let finalText = ''
    let turns = 0
    let pauses = 0
    // Flipped off permanently for this request if the API rejects the server-side search tool.
    let webOk = true
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      turns = turn + 1
      // The atlas rides with the memories: what every page of the app is for, and a live census of
      // her own tool domains — so "where do I…" questions get a real answer, and a tool added in
      // code is in her head on the next deploy without anyone re-teaching her.
      const system = buildSystem({ headline, memories: appAtlas() + '\n\n' + renderMemories(memories), openDomains: open, voice, userName, canMoney })
      // Keep the SAME tools array across the whole conversation. If a resume request drops a server
      // tool the API is still waiting on, it 400s with "but no web_search tool was provided".
      const toolset: any[] = wireTools(open)
      if (webOk) toolset.push(WEB_SEARCH_TOOL as any)

      let r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: 4096, system, tools: toolset, messages: convo }),
      })
      let d: any = await r.json()

      // If this model/account cannot use the server-side search tool, lose the search — not the answer.
      if (!r.ok && webOk && /web_search/i.test(JSON.stringify(d?.error || ''))) {
        webOk = false
        r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: MODEL, max_tokens: 4096, system, tools: wireTools(open), messages: convo }),
        })
        d = await r.json()
      }

      if (!r.ok) {
        const msg = (d?.error?.message || JSON.stringify(d)).slice(0, 240)
        // A 429 here is almost always the org tokens-per-minute ceiling, not a bug. Say so.
        const hint = r.status === 429 ? ' — that is the Anthropic rate limit, not a failure. Give it a minute and ask again.' : ''
        return NextResponse.json({ error: `Anthropic ${r.status}: ${msg}${hint}` }, { status: 502 })
      }
      convo.push({ role: 'assistant', content: d.content })

      // A long web search can be PAUSED mid-turn. The assistant message goes back UNCHANGED and the
      // API carries on. Treating this as terminal (the obvious bug) silently truncates the search.
      if (d.stop_reason === 'pause_turn') { pauses++; if (pauses > 4) break; continue }

      if (d.stop_reason === 'tool_use') {
        const results: any[] = []
        for (const block of (d.content || [])) {
          if (block?.type !== 'tool_use') continue
          toolsUsed.push(block.name)
          const { output, opened } = await runTool(block.name, block.input || {}, ctx, open)
          if (opened && open.indexOf(opened) < 0) open.push(opened)
          results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(output).slice(0, TOOL_RESULT_CHARS) })
        }
        convo.push({ role: 'user', content: results })
        continue
      }
      finalText = (d.content || []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('').trim()
      break
    }

    if (!finalText) finalText = 'I ran out of steps before I got to an answer. Ask me again and narrow it a little — a building, a date range, or one unit.'

    // Log the exchange. This is the substrate the improvement loop runs on; without it a thumbs-down
    // is just a feeling. Never let a logging failure break the answer.
    let chatId: string | null = null
    try {
      const { data } = await db.from('eve_chats').insert({
        user_email: ctx.email,
        question: lastUser.slice(0, 4000),
        answer: finalText.slice(0, 8000),
        tools_used: toolsUsed,
        domains_opened: open,
        turns,
        ms: Date.now() - startedAt,
      }).select('id').maybeSingle()
      chatId = (data as any)?.id || null
    } catch { /* migration 045 may not be run yet */ }

    touchMemories(memories.map(m => m.id)).catch(() => {})

    // CONSTANT LEARNING, ZERO CEREMONY (Jon, 2026-08-19: "read and learn and update constantly").
    // When the user speaks in standing-instruction form — always / never / from now on / stop
    // doing / make sure — that sentence IS a preference, whether or not anyone clicks "teach her".
    // Saved at modest weight with the chat as evidence; the dedupe in saveMemory absorbs repeats,
    // and everything captured is visible and deletable in Settings → Eve. Deterministic on purpose:
    // no second model call on the hot path, no guessing.
    try {
      const directive = /\b(always|never|from now on|going forward|do not ever|don'?t ever|stop (?:doing|sending|creating|drafting)|make sure (?:to|you|we|it))\b/i
      if (directive.test(lastUser) && lastUser.length >= 25 && lastUser.length <= 600) {
        const kind = /\b(always|never)\b/i.test(lastUser) ? 'rule' : 'preference'
        saveMemory({
          text: lastUser.trim(), kind, scope: 'portfolio', weight: 6, source: 'eve',
          why: 'said in chat — auto-captured', evidence: chatId ? { chatId } : null, created_by: ctx.email || null,
        }).catch(() => {})
      }
    } catch { /* learning is never worth breaking an answer */ }

    return NextResponse.json({
      reply: finalText,
      chatId,
      meta: { turns, ms: Date.now() - startedAt, tools: toolsUsed, domains: open, memories: memories.length, moneyRedacted: !canMoney, webSearch: webOk ? 'available' : 'unavailable-on-this-model' },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
