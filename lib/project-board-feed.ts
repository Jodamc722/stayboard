// LIVE FROM A SHARED BOARD, INTO #leadership (Jon, 2026-10-09: "any updates should push to
// leadership chat if any updates, pending reminders etc", posting "live, as things happen").
//
// ONLY boards that are actually shared. A project nobody outside the company can see is worked in
// the app, where the activity feed already is; the reason to interrupt a room is that somebody
// outside it moved something, or is waiting on us.
//
// Everything here is best-effort and silent on failure. A board must never fail to save a
// comment because Slack was down, so every call is wrapped and the result is thrown away.
import { postToChannel } from './slack'
import { EVE_CHANNELS } from './slack-rules'
import { supabaseAdmin } from './supabase-admin'

const APP = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/$/, '')

/** What happened, in the words the room needs. */
export type BoardEvent =
  | { kind: 'asked'; task: string; note?: string | null }
  | { kind: 'done'; task: string }
  | { kind: 'undone'; task: string }
  | { kind: 'added'; task: string; note?: string | null }
  | { kind: 'edited'; task: string }
  | { kind: 'removed'; task: string }
  | { kind: 'comment'; task: string | null; body: string }
  | { kind: 'photo'; task: string | null }

// A technician request and an owner's words are the two things somebody has to answer. The rest
// is progress: worth seeing in the room, not worth a mention.
const LOUD = new Set(['asked', 'comment'])

const ICON: Record<string, string> = {
  asked: ':wrench:', done: ':white_check_mark:', undone: ':leftwards_arrow_with_hook:',
  added: ':heavy_plus_sign:', edited: ':pencil2:', removed: ':wastebasket:',
  comment: ':speech_balloon:', photo: ':camera:',
}

const trim = (v: string | null | undefined, n = 140) => {
  const s = String(v || '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function sentence(who: string, e: BoardEvent): string {
  const t = trim(e.task)
  switch (e.kind) {
    case 'asked': return `*${who}* asked for a technician on *${t}*${e.note ? ` — “${trim(e.note)}”` : ''}`
    case 'done': return `*${who}* marked *${t}* done`
    case 'undone': return `*${who}* reopened *${t}*`
    case 'added': return `*${who}* added *${t}*${e.note ? ` — ${trim(e.note)}` : ''}`
    case 'edited': return `*${who}* changed *${t}*`
    case 'removed': return `*${who}* removed *${t}*`
    case 'comment': return `*${who}* on ${t ? `*${t}*` : 'the board'}: “${trim(e.body, 220)}”`
    case 'photo': return `*${who}* added a photo${t ? ` to *${t}*` : ''}`
  }
}

/**
 * Post one line to leadership about something that just happened on a shared board.
 *
 * The board's own name and a link carry the context, because the room does not hold the project
 * in its head — "Arya — unit projects & tasks" and a click is the whole point of posting at all.
 */
export async function tellLeadership(projectId: string, who: string, e: BoardEvent): Promise<void> {
  try {
    const channel = EVE_CHANNELS.leadership
    if (!channel) return
    const { data: p } = await supabaseAdmin().from('projects').select('id,ref,title,share_token').eq('id', projectId).maybeSingle()
    if (!p) return
    // Not shared, not posted. See the note at the top.
    if (!(p as any).share_token) return
    const board = String((p as any).title || 'a board')
    const href = `${APP}/projects?open=${p.id}`
    const head = `${ICON[e.kind] || ':small_blue_diamond:'} ${sentence(trim(who, 40) || 'Someone', e)}`
    const tail = `<${href}|${trim([(p as any).ref, board].filter(Boolean).join(' · '), 70)}>${LOUD.has(e.kind) ? ' · needs an answer' : ''}`
    await postToChannel(channel, `${head}\n${tail}`)
  } catch { /* a board must never fail to save because Slack did */ }
}
