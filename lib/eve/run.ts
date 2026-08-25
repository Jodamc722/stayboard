// ONE EVE. This is the agent loop — the actual thinking — lifted out of app/api/agent/route.ts so
// that every surface she appears on is the SAME Eve.
//
// WHY THIS FILE EXISTS. On 2026-08-21 we found three Eves: the /eve workspace, a BrainChat pill and
// a BrainConsole, each with its own prompt, its own tools and its own idea of what she remembered.
// Two of them were years behind the third and nobody could tell which one they were talking to.
// That was a UI problem. Putting Telegram on a copy of this loop would have been the same problem
// again, except server-side and invisible — a Telegram Eve quietly missing the tool domain, the
// memory or the money gate that the web Eve got last week.
//
// So: the route is now a thin wrapper around runEve(), Telegram calls the same runEve(), and
// anything added here — a tool, a rule, a memory behaviour — is live on every surface at once.
//
// The ONLY thing a caller varies is WHO is asking (an Access) and WHERE the question came from.
// Permissions, money redaction and memory all follow from the Access, never from the surface.
import 'server-only'
import { canSeeMoney, isSuperadmin } from '@/lib/access'
import type { Access } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildCtx, todayET, daysAgoISO, safe, count as cnt, lc } from './ctx'
import { wireTools, runTool, DOMAIN_KEYS } from './registry'
import { loadMemories, renderMemories, touchMemories, scopesForText, saveMemory } from './memory'
import { appAtlas } from './atlas'
import { buildSystem, getVoiceProfile } from './prompt'

const MODEL = 'claude-opus-4-8'

// Anthropic's SERVER-SIDE web search. Jon asked Eve to "connect to internet and study trends in
// south florida" — this is the supported way. Verified against the tool reference (Aug 2026):
// type `web_search_20250305`, name `web_search`, NO anthropic-beta header, and it lives in the same
// tools array as our own client tools.
//
// It does NOT emit `tool_use` blocks — it emits `server_tool_use` + `web_search_tool_result` — so
// the dispatch loop below never mistakes a search for one of our tools.
const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 6,
  user_location: { type: 'approximate', city: 'Miami', region: 'Florida', country: 'US', timezone: 'America/New_York' },
}
const MAX_TURNS = 16
const TOOL_RESULT_CHARS = 9000

/**
 * May this person use Eve at all? Owner, anyone with role=admin, or a DB role explicitly granted
 * `eve` from /users → Roles. ONE definition, because the web route and the Telegram bridge must
 * never disagree about who she talks to.
 *
 * Deliberately NOT the legacy workspace path: a legacy "gm" workspace resolves every page to full,
 * which would hand Eve to people Jon has not switched on. An explicit accessRole is required.
 */
export function canUseEve(access: Access): boolean {
  const byRole = !!access.accessRole && atLeast(access.levels?.eve, 'view')
  return isSuperadmin(access.email) || access.role === 'admin' || byRole
}

export type EveMessage = { role: string; content: any }

export type RunEveInput = {
  access: Access
  messages: EveMessage[]
  /** Domains to pre-open so she does not spend a turn on it (the /eve page does this). */
  domains?: string[]
  /** Where the question came from. Logged, and it slightly changes how she writes. */
  source?: 'web' | 'telegram' | 'api'
  /** Extra situational line for the system prompt (e.g. "you are in a Telegram group"). */
  surfaceNote?: string
  maxTurns?: number
}

export type RunEveOk = {
  ok: true
  reply: string
  chatId: string | null
  meta: { turns: number; ms: number; tools: string[]; domains: string[]; memories: number; moneyRedacted: boolean; webSearch: string }
}
export type RunEveErr = { ok: false; status: number; error: string }
export type RunEveResult = RunEveOk | RunEveErr

/** How she writes in a chat app vs. in the app's own workspace. Content and permissions are identical. */
const TELEGRAM_NOTE = `WHERE YOU ARE: Telegram, on a phone. Same you, tighter delivery — the person is probably standing somewhere, not sitting at a desk. Answer in a few short paragraphs. No headers, no tables, no markdown links; a plain bullet list only if you are listing more than three things. If a full answer needs a screen, give the call and the one number it rests on, then offer the detail.`

export async function runEve(input: RunEveInput): Promise<RunEveResult> {
  const { access } = input
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, status: 503, error: 'AI not configured - add ANTHROPIC_API_KEY in Vercel env.' }

  const messages = (Array.isArray(input.messages) ? input.messages : []).filter(m => m && m.role && m.content).slice(-12)
  if (!messages.length) return { ok: false, status: 400, error: 'no messages' }

  const startedAt = Date.now()
  const source = input.source || 'web'
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
  const lastUser = String([...messages].reverse().find(m => m.role === 'user')?.content || '')
  const wholeThread = messages.map(m => String(m.content || '')).join(' \n ')
  const scopes = scopesForText(wholeThread, ctx.listingMeta)
  // The question rides along so retrieval can rank by RELEVANCE, not just weight — the memories
  // about the thing being asked beat equally-weighted trivia about everything else.
  const memories = await loadMemories(scopes, ctx.email, 60, lastUser || wholeThread)
  const voice = await safe(getVoiceProfile(), '')

  const userName = String((access.profile as any)?.name || '') || (access.email ? access.email.split('@')[0] : '')

  const open: string[] = []
  const preOpen = Array.isArray(input.domains) ? input.domains : []
  for (const d of preOpen) { const k = lc(d); if (DOMAIN_KEYS.indexOf(k) >= 0 && open.indexOf(k) < 0) open.push(k) }

  const surface = [source === 'telegram' ? TELEGRAM_NOTE : '', input.surfaceNote || ''].filter(Boolean).join('\n')
  const voicePlus = [voice, surface].filter(Boolean).join('\n\n')

  const convo: any[] = messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 8000) }))
  const toolsUsed: string[] = []
  const limit = Math.min(Math.max(Number(input.maxTurns) || MAX_TURNS, 4), MAX_TURNS)

  try {
    let finalText = ''
    let turns = 0
    let pauses = 0
    // Flipped off permanently for this request if the API rejects the server-side search tool.
    let webOk = true
    for (let turn = 0; turn < limit; turn++) {
      turns = turn + 1
      // The atlas rides with the memories: what every page of the app is for, and a live census of
      // her own tool domains — so "where do I…" questions get a real answer, and a tool added in
      // code is in her head on the next deploy without anyone re-teaching her.
      const system = buildSystem({ headline, memories: appAtlas() + '\n\n' + renderMemories(memories), openDomains: open, voice: voicePlus, userName, canMoney })
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
        return { ok: false, status: 502, error: `Anthropic ${r.status}: ${msg}${hint}` }
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
    const row: any = {
      user_email: ctx.email,
      question: lastUser.slice(0, 4000),
      answer: finalText.slice(0, 8000),
      tools_used: toolsUsed,
      domains_opened: open,
      turns,
      ms: Date.now() - startedAt,
    }
    try {
      const { data, error } = await db.from('eve_chats').insert({ ...row, source }).select('id').maybeSingle()
      if (error) throw error
      chatId = (data as any)?.id || null
    } catch {
      // `source` arrived with migration 055. Before it runs, log the exchange without it rather
      // than losing every Telegram conversation from the learning loop.
      try {
        const { data } = await db.from('eve_chats').insert(row).select('id').maybeSingle()
        chatId = (data as any)?.id || null
      } catch { /* migration 045 may not be run yet */ }
    }

    touchMemories(memories.map(m => m.id)).catch(() => {})

    // CONSTANT LEARNING, ZERO CEREMONY (Jon, 2026-08-19: "read and learn and update constantly").
    // When the user speaks in standing-instruction form — always / never / from now on / stop
    // doing / make sure — that sentence IS a preference, whether or not anyone clicks "teach her".
    try {
      const directive = /\b(always|never|from now on|going forward|do not ever|don'?t ever|stop (?:doing|sending|creating|drafting)|make sure (?:to|you|we|it))\b/i
      if (directive.test(lastUser) && lastUser.length >= 25 && lastUser.length <= 600) {
        const kind = /\b(always|never)\b/i.test(lastUser) ? 'rule' : 'preference'
        saveMemory({
          text: lastUser.trim(), kind, scope: 'portfolio', weight: 6, source: 'eve',
          why: source === 'telegram' ? 'said on Telegram — auto-captured' : 'said in chat — auto-captured',
          evidence: chatId ? { chatId } : null, created_by: ctx.email || null,
        }).catch(() => {})
      }
    } catch { /* learning is never worth breaking an answer */ }

    return {
      ok: true,
      reply: finalText,
      chatId,
      meta: { turns, ms: Date.now() - startedAt, tools: toolsUsed, domains: open, memories: memories.length, moneyRedacted: !canMoney, webSearch: webOk ? 'available' : 'unavailable-on-this-model' },
    }
  } catch (e: any) {
    return { ok: false, status: 500, error: e?.message || String(e) }
  }
}
