// ADAM — the Garden Hotel's own agent.
//
// Jon, 2026-09-28: "The Garden Hotel should look like my current board — has user settings, an AI
// agent… a different learning model, a different section we can call him Adam." / "For the garden
// agent, think new business, new model."
//
// So Adam is NOT Eve with a different name. He has:
//   - his own model (AI task 'adam', default the newest Sonnet; Settings → AI models)
//   - his own memory (garden_agent_memory) — what he is taught about the hotel, and only the hotel
//   - his own chat log (garden_agent_chats) with thumbs and corrections
//   - his own tools, all over garden_* tables (today, rooms, cleans, calls, verifications, reports)
//   - his own voice/direction (app_settings garden_agent: direction, name)
// Nothing here imports from lib/eve. The two businesses learn separately by design.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { anthropicMessages, textOf } from '../anthropic-call'
import { modelPairFor } from '../ai-models'
import { getSetting, setSetting } from '../app-settings'
import { gardenToday, gardenRooms, gardenCalls, gardenReport, gardenStatus } from './desk'
import { todayET } from './sync'
import type { Access } from '../access'

export const ADAM_KEY = 'garden_agent'
export type AdamSettings = { name: string; direction: string; enabled: boolean }
export const ADAM_DEFAULTS: AdamSettings = {
  name: 'Adam',
  direction: 'You work the front desk and housekeeping side of a boutique hotel in Fort Lauderdale. Be short, specific and warm. Name the room, the guest and the time. Say what you do not know.',
  enabled: true,
}
export async function adamSettings(): Promise<AdamSettings> {
  const v = await getSetting<Partial<AdamSettings>>(ADAM_KEY, {}).catch(() => ({} as Partial<AdamSettings>))
  return { ...ADAM_DEFAULTS, ...(v || {}) }
}
export async function saveAdamSettings(patch: Partial<AdamSettings>, by: string) {
  const cur = await adamSettings()
  await setSetting(ADAM_KEY, { ...cur, ...patch }, by)
}

// ---- Memory ------------------------------------------------------------------------------------
export type AdamMemory = { id: string; kind: string; subject: string | null; content: string; source: string; by_email: string | null; confidence: number; active: boolean; created_at: string }
export async function adamMemories(limit = 200): Promise<AdamMemory[]> {
  const { data } = await supabaseAdmin().from('garden_agent_memory').select('*').eq('active', true).order('created_at', { ascending: false }).limit(limit)
  return (data || []) as AdamMemory[]
}
export async function adamRemember(m: { kind?: string; subject?: string | null; content: string; source?: string; by?: string | null; confidence?: number }): Promise<string | null> {
  const content = String(m.content || '').trim().slice(0, 600)
  if (!content) return null
  const db = supabaseAdmin()
  // The same sentence twice is one memory.
  const { data: dup } = await db.from('garden_agent_memory').select('id').eq('active', true).eq('content', content).limit(1)
  if (dup && dup[0]) return String(dup[0].id)
  const { data } = await db.from('garden_agent_memory').insert({ kind: m.kind || 'fact', subject: m.subject || null, content, source: m.source || 'chat', by_email: m.by || null, confidence: m.confidence ?? 0.8 }).select('id').single()
  return data ? String(data.id) : null
}
export async function adamForget(id: string) {
  await supabaseAdmin().from('garden_agent_memory').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id)
}

// ---- Tools ---------------------------------------------------------------------------------------
const TOOLS = [
  { name: 'today', description: "Today's picture at the hotel: arrivals, departures, in-house count, occupancy, room condition counts, today's cleans and tasks, pre-arrival calls due and verifications pending.", input_schema: { type: 'object', properties: {} } },
  { name: 'rooms', description: 'Every room with its condition (clean/dirty/inspected), whether occupied, the current stay, the next arrival and open tasks.', input_schema: { type: 'object', properties: { filter: { type: 'string', description: 'optional: dirty | occupied | turning | empty' } } } },
  { name: 'calls', description: 'Arrivals in the next 7 days with whether they were reached by phone, ID and card verification status, and every call logged; plus the recent call log.', input_schema: { type: 'object', properties: {} } },
  { name: 'report', description: 'Occupancy, arrivals by source, booked revenue and ADR, cleans done by kind, calls reached rate and verifications for a date range.', input_schema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['from', 'to'] } },
  { name: 'status', description: 'Whether Cloudbeds is connected and when each feed last synced.', input_schema: { type: 'object', properties: {} } },
  { name: 'call_desk', description: 'What the front desk owes each guest right now: welcome calls due, verifications pending, post-stay calls — with attempts so far.', input_schema: { type: 'object', properties: {} } },
  { name: 'reviews', description: 'Recent reviews (90 days) with the average, the negative ones, the themes, and which still have no reply.', input_schema: { type: 'object', properties: { only: { type: 'string', description: 'optional: negative | unanswered' } } } },
  { name: 'schedule', description: 'This week: who is on shift each day and what the day holds (cleans, stayovers, arrivals), with where the roster is short.', input_schema: { type: 'object', properties: {} } },
  { name: 'ask', description: "When you do not know something about the hotel that a person should tell you (a policy, a rule, who handles what), file the question so the GM answers it on Adam's page. The answer becomes a memory.", input_schema: { type: 'object', properties: { question: { type: 'string' }, context: { type: 'string', description: 'why it came up' }, subject: { type: 'string' } }, required: ['question'] } },
  { name: 'remember', description: 'Save something you were told about the hotel so you know it next time (a rule, a fact about a room or a guest, a preference). Only for things a person told you, never your own guesses.', input_schema: { type: 'object', properties: { content: { type: 'string' }, kind: { type: 'string', description: 'fact | rule | preference | person' }, subject: { type: 'string', description: 'a room number, a guest name, a vendor, or "hotel"' } }, required: ['content'] } },
]

async function runTool(name: string, args: any, by: string | null): Promise<any> {
  try {
    if (name === 'today') return await gardenToday()
    if (name === 'rooms') {
      const r = await gardenRooms()
      const f = String(args?.filter || '')
      const rooms = r.rooms.filter((x: any) => f === 'dirty' ? x.hk_status === 'dirty' : f === 'occupied' ? !!x.stay : f === 'turning' ? x.tasks.some((t: any) => t.kind === 'clean' && t.status !== 'done') : f === 'empty' ? !x.stay : true)
      return { date: r.date, count: rooms.length, rooms: rooms.map((x: any) => ({ room: x.name, type: x.room_type, condition: x.hk_status, occupied: x.occupied, stay: x.stay, next: x.next, tasks: x.tasks.map((t: any) => ({ kind: t.kind, status: t.status, who: t.assigned_to, note: t.note })) })) }
    }
    if (name === 'calls') { const c = await gardenCalls(); return { date: c.date, upcoming: c.upcoming.map((r: any) => ({ guest: r.guest_name, rooms: r.room_names, check_in: r.check_in, nights: r.nights, phone: r.guest_phone, reached: r.reached, attempts: r.attempts, id: r.idStatus, card: r.cardStatus, balance: r.balance })), recentCalls: c.recent.slice(0, 20) } }
    if (name === 'report') {
      const ok = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
      return await gardenReport(ok(args?.from) ? args.from : todayET(-29), ok(args?.to) ? args.to : todayET(0))
    }
    if (name === 'status') return await gardenStatus()
    if (name === 'call_desk') { const { callQueue } = await import('./call-desk'); const q = await callQueue({ days: 3 }); return { count: q.length, calls: q.map((x: any) => ({ kind: x.kind, guest: x.reservation?.guest_name, room: (x.reservation?.room_names || []).join(', '), check_in: x.reservation?.check_in, due: x.due_at, dueNow: x.dueNow, attempts: x.attempts, lastOutcome: x.last_outcome })) } }
    if (name === 'reviews') { const { reviewStats } = await import('./reviews'); const db = supabaseAdmin(); let q = db.from('garden_reviews').select('source,guest_name,rating,max_rating,title,body,received_at,sentiment,themes,reply_status').gte('received_at', new Date(Date.now() - 90 * 86400000).toISOString()).order('received_at', { ascending: false }).limit(40); if (args?.only === 'negative') q = q.eq('sentiment', 'negative'); if (args?.only === 'unanswered') q = q.in('reply_status', ['none', 'drafted']); const { data } = await q; return { stats: await reviewStats(90), reviews: data || [] } }
    if (name === 'schedule') { const { weekSchedule, weekStart } = await import('./schedule'); const w = await weekSchedule(weekStart(), 7); return { from: w.from, days: w.days.map((d: any) => ({ date: d.date, load: d.load, on: d.shifts.map((s: any) => `${s.staff?.name} (${s.role} ${s.start_time}–${s.end_time})`), short: d.suggest.gaps.filter((g: any) => g.short).map((g: any) => `${g.role} short ${g.short}`) })) } }
    if (name === 'ask') { const q = String(args?.question || '').trim().slice(0, 500); if (!q) return { error: 'question required' }; const db = supabaseAdmin(); const { data: dup } = await db.from('garden_agent_questions').select('id').eq('status', 'open').eq('question', q).limit(1); if (dup?.length) return { ok: true, already: true }; const { data } = await db.from('garden_agent_questions').insert({ question: q, context: args?.context ? String(args.context).slice(0, 500) : null, subject: args?.subject ? String(args.subject).slice(0, 80) : null }).select('id').single(); return { ok: true, id: data?.id } }
    if (name === 'remember') { const id = await adamRemember({ content: args?.content, kind: args?.kind, subject: args?.subject, by, source: 'chat' }); return { ok: !!id, id } }
    return { error: 'unknown tool' }
  } catch (e: any) { return { error: String(e?.message || e).slice(0, 300) } }
}

// ---- The hotel's handbook and the shared bridge (migration 118) ----------------------------------
export async function adamHandbook(maxChars = 12000): Promise<string> {
  try {
    const { data } = await supabaseAdmin().from('garden_handbook').select('section,title,body').order('sort')
    let out = ''
    for (const e of ((data || []) as any[])) { const b = String(e.body || '').trim(); if (!b) continue; const add = `## ${e.section} — ${e.title}\n${b}\n\n`; if (out.length + add.length > maxChars) break; out += add }
    return out.trim()
  } catch { return '' }
}
export async function adamShared(): Promise<string> {
  try {
    const { data } = await supabaseAdmin().from('shared_knowledge').select('title,body').eq('active', true).contains('businesses', ['garden']).order('created_at').limit(40)
    return ((data || []) as any[]).map(k => `- ${k.title}: ${k.body}`).join('\n')
  } catch { return '' }
}

// ---- The loop ------------------------------------------------------------------------------------
export type AdamRun = { ok: true; reply: string; chatId: string | null; meta: { tools: string[]; model: string } } | { ok: false; status: number; error: string }

export async function runAdam(input: { access: Access; messages: { role: 'user' | 'assistant'; content: string }[] }): Promise<AdamRun> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, status: 503, error: 'AI not configured — add ANTHROPIC_API_KEY in Vercel.' }
  const settings = await adamSettings()
  if (!settings.enabled) return { ok: false, status: 403, error: `${settings.name} is switched off (Garden Hotel → Adam).` }
  const msgs = (input.messages || []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim()).slice(-16)
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return { ok: false, status: 400, error: 'Ask something.' }
  const email = input.access.email || null

  const [memories, status, handbook, shared] = await Promise.all([adamMemories(120), gardenStatus().catch(() => null), adamHandbook(), adamShared()])
  const memoryBlock = memories.length
    ? memories.map(m => `- (${m.kind}${m.subject ? ` · ${m.subject}` : ''}) ${m.content}`).join('\n')
    : '- nothing yet — you are new here; ask, and remember what you are told'
  const system = [
    `You are ${settings.name}, the Garden Hotel's own assistant inside Lighthouse. The Garden Hotel is a boutique hotel in Fort Lauderdale run on Cloudbeds. You are a separate brain from Eve (the vacation-rental assistant): you know only this hotel, and you learn only about this hotel.`,
    settings.direction,
    `Today is ${todayET(0)} (America/New_York). The person asking is ${email || 'a team member'}.`,
    status ? `Cloudbeds: ${status.mode === 'none' ? 'NOT CONNECTED yet — the hotel tables may be empty; say so plainly rather than inventing numbers' : `connected (${status.mode})`}. Rooms in mirror: ${status.rooms}. Reservations in mirror: ${status.reservations}.` : '',
    `Use the tools for anything about today, rooms, cleans, the call desk, verifications, reviews, the schedule or numbers — never guess a figure. When someone tells you a rule or a fact about the hotel, call remember. Answer in a few short lines; no headers.`,
    handbook ? `The hotel's handbook (its own SOPs — ground truth; follow it over anything else):\n${handbook}` : `The hotel's handbook is still empty — when a question needs a policy you have not been told, call ask.`,
    shared ? `Shared knowledge (the ONLY things from Stay Hospitality's vacation-rental side you know; everything else about that business is outside your world):\n${shared}` : '',
    `What you have been taught about the hotel:\n${memoryBlock}`,
  ].filter(Boolean).join('\n\n')

  const { model, fallback } = await modelPairFor('adam')
  const convo: any[] = msgs.map(m => ({ role: m.role, content: m.content }))
  const toolsUsed: string[] = []
  let finalText = ''
  let usage: any = null
  let usedModel = model
  for (let turn = 0; turn < 8; turn++) {
    const r = await anthropicMessages(key, { model, max_tokens: 1200, system, tools: TOOLS, messages: convo }, fallback, 'adam')
    usedModel = r.model
    if (!r.ok) {
      const msg = String(r.data?.error?.message || r.status)
      return { ok: false, status: 502, error: `Anthropic ${r.status}: ${msg}${r.status === 429 ? ' — rate limit; give it a minute.' : ''}` }
    }
    const d = r.data
    usage = d.usage || usage
    convo.push({ role: 'assistant', content: d.content })
    if (d.stop_reason === 'tool_use') {
      const results: any[] = []
      for (const block of (d.content || [])) {
        if (block?.type !== 'tool_use') continue
        toolsUsed.push(block.name)
        const out = await runTool(block.name, block.input || {}, email)
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out).slice(0, 60000) })
      }
      convo.push({ role: 'user', content: results })
      continue
    }
    finalText = textOf(d).trim()
    break
  }
  if (!finalText) finalText = 'I ran out of steps before I had an answer — ask again, a little narrower.'
  let chatId: string | null = null
  try {
    const { data } = await supabaseAdmin().from('garden_agent_chats').insert({ email, question: msgs[msgs.length - 1].content.slice(0, 4000), reply: finalText.slice(0, 8000), tools: toolsUsed, model: usedModel, usage }).select('id').single()
    chatId = data ? String(data.id) : null
  } catch { /* the log never blocks an answer */ }
  return { ok: true, reply: finalText, chatId, meta: { tools: toolsUsed, model: usedModel } }
}

/** Thumbs + correction. A "wrong" with a note becomes a memory of kind correction. */
export async function rateAdam(chatId: string, rating: number, note: string | null, by: string | null) {
  const db = supabaseAdmin()
  await db.from('garden_agent_chats').update({ rating, note }).eq('id', chatId)
  if (rating < 0 && note) await adamRemember({ kind: 'correction', content: note, source: 'correction', by, confidence: 0.95 })
}
