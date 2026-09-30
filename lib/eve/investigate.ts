// EVE INVESTIGATES A REPORT THE WAY A PERSON WOULD (Jon, 2026-09-30).
//
// "I don't think Eve is really grasping the connection between a Slack message and a Breezeway
// task. With the AC leaking, there is a Breezeway task that's created … She needs to: get the
// context of the messages around it; get the context of the task being created; look at all of the
// activity in the particular unit to see if there's a task that matches the criteria of the
// complaint; review the glitch board to see if the glitch also matches the unit, the day of
// creation… more human-like thinking than just 'this triggers, this triggers'."
//
// What was wrong, found on the 1205 A/C leak: the Slack message itself said
// "BW: app.breezeway.io/task/170713965". Eve never read it. The old matcher (lib/eve/loop-match
// matchTask) compared topic words on ONE unit — and "1205" had been resolved to Botanica 1205 by
// guessing, when 1205 exists in more than one building. Wrong unit, no link read, no match.
//
// The investigation, in the order a person does it:
//   1. READ THE EVIDENCE. Links in the message or anywhere in its thread — a Breezeway task, a
//      Guesty reservation or inbox thread, a Lighthouse glitch / claim / booking — are facts, not
//      guesses. A linked task also says which unit it really is (its reference_property_id), which
//      corrects a mis-resolved unit.
//   2. GATHER THE CONTEXT. The whole thread (who said what after), every Breezeway task on every
//      unit the report could mean (all buildings that have that number) from the day before to
//      now — any department — tasks elsewhere whose name mentions the number, glitches on those
//      units in the same days, and the guest in the unit.
//   3. JUDGE. A model reads all of it next to the lessons the team has taught her about matching
//      (lib/eve/match-lessons) and says which task / glitch / unit belongs to the report, how sure
//      it is, what is still open, and the next step — in words a person can check. Below 0.7 it is
//      filed as "possible" for a person to confirm, never as fact.
// Budgeted: at most MAX_PER_RUN judgements per sweep, and a report is not re-judged until its
// candidate set changes.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { anthropicMessages } from '@/lib/anthropic-call'
import { modelPairFor } from '@/lib/ai-models'
import { retrieveBreezewayTask, mapBreezewayTask } from '@/lib/breezeway'
import { threadReplies } from './slack-read'
import { matchLessonsText } from './match-lessons'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const clip = (s: any, n: number) => { const t = str(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }

export const MAX_PER_RUN = 6

export type Investigation = {
  at: string
  method: 'linked' | 'judged' | 'none'
  taskId: string | null
  glitchId: string | null
  listingId: string | null
  unit: string | null
  confidence: number
  reasoning: string
  stillOpen: string | null
  nextStep: string | null
  /** A snapshot for the nudge text and the page — so a message can say exactly where things stand. */
  task?: { name: string; status: string; assignees: string[]; scheduled: string | null; startedAt: string | null; finishedAt: string | null } | null
  guest?: { name: string; checkOut: string | null; reservationId: string } | null
  candidatesKey: string
  links: { reservationId?: string; conversationId?: string; claimId?: string }
}

/** Every reference a person pasted: Breezeway tasks, Guesty reservations / threads, Lighthouse pages. */
export function refsIn(text: string) {
  const t = str(text)
  const tasks = Array.from(new Set(Array.from(t.matchAll(/breezeway\.io\/(?:task|tasks)\/(\d{5,})/gi)).map(m => m[1])
    .concat(Array.from(t.matchAll(/\bBW\s*[:#-]?\s*(\d{7,})\b/gi)).map(m => m[1]))))
  const reservations = Array.from(new Set(Array.from(t.matchAll(/guesty\.com\/reservations\/([a-f0-9]{24})/gi)).map(m => m[1])
    .concat(Array.from(t.matchAll(/\/reservations\/([a-f0-9]{24})/gi)).map(m => m[1]))))
  const conversations = Array.from(new Set(Array.from(t.matchAll(/guesty\.com\/inbox[^\s>|]*?\/([a-f0-9]{24})/gi)).map(m => m[1])
    .concat(Array.from(t.matchAll(/\/messages\/([a-f0-9]{24})/gi)).map(m => m[1]))))
  const claims = Array.from(new Set(Array.from(t.matchAll(/\/claims\/([0-9a-f-]{36})/gi)).map(m => m[1])))
  return { tasks, reservations, conversations, claims }
}

type LoopLike = { id?: string; kind: string; summary: string; unit?: string | null; building?: string | null; listing_id?: string | null; first_seen: string; channel?: string; channel_name?: string; msg_ts?: string; thread_ts?: string | null; evidence?: any }

async function taskRow(db: any, id: string): Promise<any | null> {
  const { data } = await db.from('breezeway_tasks_sync').select('id,name,status,type_department,scheduled_date,started_at,finished_at,assignees,reference_property_id,raw').eq('id', id).maybeSingle()
  if (data) return data
  // Created minutes ago and not mirrored yet: read it from Breezeway and mirror it.
  try {
    const r = await retrieveBreezewayTask(id)
    if (r.ok && r.data) {
      const row = mapBreezewayTask(r.data)
      if (row.id) { try { await db.from('breezeway_tasks_sync').upsert(row, { onConflict: 'id' }) } catch { /* the read still counts */ } return row }
    }
  } catch { /* fall through */ }
  return null
}
const snap = (t: any) => t ? {
  name: str(t.name), status: t.finished_at ? 'finished' : str(t.status) || 'open',
  assignees: Array.isArray(t.assignees) ? t.assignees.map((a: any) => str(a?.name || a)).filter(Boolean) : [],
  scheduled: t.scheduled_date || null, startedAt: t.started_at || null, finishedAt: t.finished_at || null,
} : null

async function guestInUnit(db: any, listingId: string | null, day: string) {
  if (!listingId) return null
  try {
    const { data } = await db.from('guesty_reservations').select('id,guest_name,check_in,check_out,status').eq('listing_id', listingId).lte('check_in', day).gte('check_out', day).limit(5)
    const r = ((data || []) as any[]).find(x => !/cancel|declin|inquir|expire/i.test(str(x.status)))
    return r ? { name: str(r.guest_name), checkOut: r.check_out || null, reservationId: str(r.id) } : null
  } catch { return null }
}

/**
 * Investigate one report. `force` re-judges even if the candidate set is unchanged.
 * Returns null when there is nothing to say (no unit, no links, no candidates).
 */
export async function investigateLoop(item: LoopLike, opts: { force?: boolean; allowModel?: boolean } = {}): Promise<Investigation | null> {
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const day = str(item.first_seen).slice(0, 10) || now.slice(0, 10)

  // 1. The thread — what was said around it.
  let thread: { who: string; text: string; at: string }[] = []
  if (item.channel && (item.thread_ts || item.msg_ts)) {
    try { const r = await threadReplies(item.channel, str(item.thread_ts || item.msg_ts)); if (Array.isArray(r?.messages)) thread = r.messages.slice(0, 40) } catch { /* optional */ }
  }
  const allText = [item.summary, str(item.evidence?.text), ...thread.map(m => m.text)].join('\n')
  const refs = refsIn(allText)

  // 2a. A linked task is the answer.
  for (const tid of refs.tasks) {
    const t = await taskRow(db, tid)
    if (!t) continue
    const listingId = t.reference_property_id ? str(t.reference_property_id) : (item.listing_id || null)
    let unit = item.unit || null
    if (listingId) { try { const { data: l } = await db.from('guesty_listings').select('nickname,title').eq('id', listingId).maybeSingle(); if (l) unit = str((l as any).nickname || (l as any).title) } catch { /* keep */ } }
    const guest = await guestInUnit(db, listingId, now.slice(0, 10))
    let glitchId: string | null = null
    try { const { data: g } = await db.from('glitches').select('id').eq('breezeway_task_id', tid).limit(1); glitchId = g && (g as any[])[0] ? str((g as any[])[0].id) : null } catch { /* fine */ }
    const s = snap(t)
    return {
      at: now, method: 'linked', taskId: str(t.id), glitchId, listingId, unit, confidence: 1,
      reasoning: `The report links the Breezeway task directly (task ${tid}${s ? ` "${s.name}"` : ''}), so that is the task — and it is on ${unit || 'the unit it names'}.`,
      stillOpen: s && !s.finishedAt ? `task is ${s.status || 'open'}${s.assignees.length ? ', with ' + s.assignees.join(', ') : ', nobody assigned'}` : null,
      nextStep: s && !s.finishedAt ? (s.assignees.length ? (s.startedAt ? 'Wait for the fix, then tell the guest' : 'Get ' + s.assignees[0] + ' started') : 'Assign someone to the task') : 'Tell the guest it is fixed',
      task: s, guest, candidatesKey: 'link:' + tid,
      links: { reservationId: refs.reservations[0] || guest?.reservationId, conversationId: refs.conversations[0], claimId: refs.claims[0] },
    }
  }

  // 2b. The context a person would pull up.
  const number = (str(item.unit).match(/\d{3,4}(?:\/\d)?/) || allText.match(/\b(\d{3,4}(?:\/\d)?)\b/) || [])[0] || ''
  const candListings: { id: string; name: string; building: string }[] = []
  try {
    if (item.listing_id) {
      const { data } = await db.from('guesty_listings').select('id,nickname,title,building,status').eq('id', item.listing_id).maybeSingle()
      if (data) candListings.push({ id: str((data as any).id), name: str((data as any).nickname || (data as any).title), building: str((data as any).building) })
    }
    if (number) {
      const { data } = await db.from('guesty_listings').select('id,nickname,title,building,status').or(`nickname.ilike.%${number}%,title.ilike.%${number}%`).limit(20)
      for (const l of ((data || []) as any[])) {
        if (/inactive|archived|deleted/i.test(str(l.status))) continue
        if (!new RegExp(`(^|[^0-9])${number.replace('/', '\\/')}([^0-9]|$)`).test(str(l.nickname) + ' ' + str(l.title))) continue
        if (!candListings.some(c => c.id === str(l.id))) candListings.push({ id: str(l.id), name: str(l.nickname || l.title), building: str(l.building) })
      }
    }
  } catch { /* judged on what we have */ }
  if (!candListings.length && !refs.reservations.length) return null

  const from = new Date(Date.parse(day + 'T12:00:00Z') - 2 * 86400000).toISOString().slice(0, 10)
  const ids = candListings.map(c => c.id).slice(0, 8)
  const [tasksRes, glitchRes] = await Promise.all([
    ids.length ? db.from('breezeway_tasks_sync').select('id,name,status,type_department,scheduled_date,started_at,finished_at,assignees,reference_property_id,description:raw->>description,created_at:raw->>created_at')
      .in('reference_property_id', ids).gte('scheduled_date', from).order('scheduled_date', { ascending: true }).limit(80) : Promise.resolve({ data: [] }),
    ids.length ? db.from('glitches').select('id,listing_id,unit,status,category,overview,created_at,breezeway_task_id,reservation_id').in('listing_id', ids).gte('created_at', from + 'T00:00:00Z').limit(30) : Promise.resolve({ data: [] }),
  ])
  const tasks = ((tasksRes as any).data || []) as any[]
  const glitches = ((glitchRes as any).data || []) as any[]
  const guests: Record<string, any> = {}
  for (const c of candListings.slice(0, 6)) guests[c.id] = await guestInUnit(db, c.id, now.slice(0, 10))

  const key = 'cands:' + tasks.map(t => str(t.id) + (t.finished_at ? 'f' : '')).sort().join(',') + '|' + glitches.map(g => str(g.id)).sort().join(',')
  const prev = item.evidence?.investigation as Investigation | undefined
  if (!opts.force && prev && prev.candidatesKey === key) return prev
  if (!tasks.length && !glitches.length) {
    return { at: now, method: 'none', taskId: null, glitchId: null, listingId: candListings.length === 1 ? candListings[0].id : (item.listing_id || null), unit: candListings.length === 1 ? candListings[0].name : (item.unit || null),
      confidence: 0, reasoning: `No Breezeway task or glitch on ${candListings.map(c => c.name).join(' / ') || 'the unit'} since ${from}.`, stillOpen: 'nobody has created a task for it', nextStep: 'Create the Breezeway task', task: null, guest: candListings.length === 1 ? guests[candListings[0].id] : null, candidatesKey: key, links: {} }
  }
  if (opts.allowModel === false) return null

  // 3. Judge.
  const keyApi = process.env.ANTHROPIC_API_KEY
  if (!keyApi) return null
  const nameOf = (id: string) => candListings.find(c => c.id === id)?.name || id
  const pack = [
    `REPORT (Slack #${str(item.channel_name)}, ${str(item.first_seen).slice(0, 16).replace('T', ' ')} UTC, ${str(item.evidence?.who) || 'someone'}):`,
    str(item.evidence?.text) || item.summary,
    thread.length ? `\nTHREAD (${thread.length} messages):\n` + thread.map(m => `- ${m.at.slice(5, 16).replace('T', ' ')} ${m.who}: ${clip(m.text, 280)}`).join('\n') : '\nTHREAD: no replies',
    `\nUNITS THE REPORT COULD MEAN: ${candListings.map(c => `${c.name} [${c.id}]${guests[c.id] ? ` — guest ${guests[c.id].name} in until ${str(guests[c.id].checkOut)}` : ' — empty'}`).join('; ')}`,
    `\nBREEZEWAY TASKS ON THOSE UNITS SINCE ${from}:\n` + (tasks.length ? tasks.map(t => `- [${t.id}] ${nameOf(str(t.reference_property_id))} · ${str(t.type_department)} · "${clip(t.name, 90)}"${t.description ? ' — ' + clip(t.description, 160) : ''} · scheduled ${str(t.scheduled_date)}${t.created_at ? ' · created ' + str(t.created_at).slice(0, 16) : ''} · ${t.finished_at ? 'finished ' + str(t.finished_at).slice(0, 16) : str(t.status) || 'open'} · ${(Array.isArray(t.assignees) ? t.assignees.map((a: any) => a?.name || a).join(', ') : '') || 'unassigned'}`).join('\n') : '(none)'),
    `\nGLITCHES ON THOSE UNITS SINCE ${from}:\n` + (glitches.length ? glitches.map(g => `- [${g.id}] ${nameOf(str(g.listing_id)) || str(g.unit)} · ${clip(g.overview, 140)} · ${str(g.category)} · ${str(g.status)} · filed ${str(g.created_at).slice(0, 16)}${g.breezeway_task_id ? ' · task ' + g.breezeway_task_id : ''}`).join('\n') : '(none)'),
  ].join('\n')
  const lessons = await matchLessonsText().catch(() => '')
  const SYSTEM = `You are Eve, the operations coordinator for a short-term-rental company, matching a problem reported in Slack to the work that is (or is not) happening for it — the way an experienced coordinator would.
Think like a person: which unit is really meant (the channel's market, the building, who reported, the guest in the unit), which Breezeway task was created FOR this report (same unit; created on or after the report or scheduled that day; about the same thing even in other words — "AC leaking water" and "HVAC - water on floor, drain line" are the same job; a departure clean or a routine inspection is NOT the fix for a repair unless the report is about cleanliness), and which glitch on the board is the same incident (same unit, same day, same thing).
Say NO match when nothing fits — a wrong link is worse than none. Confidence: 0.9+ only when unit, timing and subject all line up; 0.7 when two of three do; below 0.5 means you are guessing.
Write reasoning a coordinator can check in one read: which facts decided it. stillOpen: what is not done yet (e.g. "task not started, nobody assigned", "guest not told"). nextStep: the one concrete next action and for whom.${lessons ? '\n\nLESSONS THE TEAM HAS TAUGHT YOU ABOUT MATCHING (follow them):\n' + lessons : ''}`
  const SCHEMA = { type: 'object', properties: {
    listingId: { type: ['string', 'null'], description: 'the unit the report is about, one of the ids given, or null if unclear' },
    taskId: { type: ['string', 'null'] }, glitchId: { type: ['string', 'null'] },
    confidence: { type: 'number' }, reasoning: { type: 'string' }, stillOpen: { type: ['string', 'null'] }, nextStep: { type: ['string', 'null'] },
  }, required: ['listingId', 'taskId', 'glitchId', 'confidence', 'reasoning'] }
  try {
    const { model, fallback } = await modelPairFor('eve-investigate')
    const r = await anthropicMessages(keyApi, {
      model, max_tokens: 900, system: SYSTEM,
      tools: [{ name: 'match', description: 'Your judgement.', input_schema: SCHEMA }], tool_choice: { type: 'tool', name: 'match' },
      messages: [{ role: 'user', content: pack }],
    }, fallback, 'eve-investigate')
    const out = (r.data?.content || []).find((c: any) => c.type === 'tool_use')?.input
    if (!r.ok || !out) return null
    const taskId = out.taskId && tasks.some(t => str(t.id) === str(out.taskId)) ? str(out.taskId) : null
    const glitchId = out.glitchId && glitches.some(g => str(g.id) === str(out.glitchId)) ? str(out.glitchId) : null
    const listingId = out.listingId && candListings.some(c => c.id === str(out.listingId)) ? str(out.listingId) : (candListings.length === 1 ? candListings[0].id : null)
    const t = taskId ? tasks.find(x => str(x.id) === taskId) : null
    return {
      at: now, method: 'judged', taskId, glitchId, listingId, unit: listingId ? nameOf(listingId) : (item.unit || null),
      confidence: Math.max(0, Math.min(1, Number(out.confidence) || 0)), reasoning: clip(out.reasoning, 600),
      stillOpen: out.stillOpen ? clip(out.stillOpen, 200) : null, nextStep: out.nextStep ? clip(out.nextStep, 200) : null,
      task: snap(t), guest: listingId ? guests[listingId] || null : null, candidatesKey: key,
      links: { reservationId: refs.reservations[0] || (listingId && guests[listingId] ? guests[listingId].reservationId : undefined), conversationId: refs.conversations[0], claimId: refs.claims[0] },
    }
  } catch { return null }
}
