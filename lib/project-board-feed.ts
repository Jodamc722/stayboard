// WHAT THE SHARED BOARDS DID, INTO #leadership — TWICE A DAY (Jon, 2026-10-09).
//
// He asked for live posts, saw what live meant, and said: "I don't want notifications every
// second. It could be done daily in the evening. Morning index." So the per-event post is gone
// and two summaries take its place:
//
//   EVENING RECAP   what moved today, by board. Silent on a day nothing moved.
//   MORNING INDEX   what is open and waiting as the day starts — overdue, due today, technician
//                   requests nobody has answered, owner comments nobody has replied to.
//
// Both are built from project_notes, which already records every one of these actions, so
// nothing new is stored to make them and a board cannot drift out of step with its own summary.
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


const str = (v: any) => (typeof v === 'string' ? v.trim() : '')
const trim = (v: any, n = 150) => { const t = str(v).replace(/\s+/g, ' '); return t.length > n ? t.slice(0, n - 1) + '…' : t }
/** Today where the work is, not where the server is. */
const todayET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

type Board = { id: string; ref: string | null; title: string }

/** Every project with a live share link. Those are the boards other people can touch. */
async function sharedBoards(): Promise<Board[]> {
  const { data } = await supabaseAdmin().from('projects')
    .select('id,ref,title,share_token,share_expires,archived')
    .not('share_token', 'is', null).limit(200)
  const now = Date.now()
  return ((data || []) as any[])
    .filter(p => !p.archived && (!p.share_expires || new Date(p.share_expires).getTime() > now))
    .map(p => ({ id: String(p.id), ref: p.ref || null, title: String(p.title || 'Project') }))
}

const link = (b: Board) => `<${APP}/projects?open=${b.id}|${trim([b.ref, b.title].filter(Boolean).join(' · '), 70)}>`

/**
 * THE EVENING RECAP — what moved today on the boards people outside can see.
 *
 * Only what came in THROUGH a link (via_share). Our own team's work on a board is already in the
 * app's feed and in everyone's inbox; the thing a leadership room does not otherwise learn is
 * that an owner ticked four jobs and asked a question.
 */
export async function eveningRecap(opts: { dry?: boolean } = {}): Promise<{ posted: boolean; boards: number; lines: number; text: string }> {
  const boards = await sharedBoards()
  const empty = { posted: false, boards: 0, lines: 0, text: '' }
  if (!boards.length) return empty
  const since = todayET() + 'T00:00:00-04:00'
  const parts: string[] = []
  let lines = 0

  for (const b of boards) {
    const { data } = await supabaseAdmin().from('project_notes')
      .select('body,author,kind,created_at,via_share')
      .eq('project_id', b.id).eq('via_share', true).gte('created_at', since)
      .order('created_at').limit(120)
    const rows = ((data || []) as any[])
    if (!rows.length) continue
    // Ticks are counted, not listed: "marked 4 items done" is the useful sentence, and twelve
    // lines of "marked a step done" is the noise he objected to in the first place.
    const ticks = rows.filter(r => / marked a step /i.test(str(r.body))).length
    const said = rows.filter(r => r.kind === 'comment')
    const events = rows.filter(r => r.kind === 'event' && !/ marked a step /i.test(str(r.body)))
    // EDITS COLLAPSE THE SAME WAY TICKS DO. Fixing a title, then its date, then its unit is one
    // piece of work to the room and three rows in the table; listing all three is the noise this
    // whole change was about. Named once each, counted after that.
    const edited: string[] = []
    const rest: any[] = []
    for (const r of events) {
      const m = str(r.body).match(/ edited [“"](.+?)[”"]\s*$/)
      if (m) { if (!edited.includes(m[1])) edited.push(m[1]) }
      else rest.push(r)
    }
    const bits: string[] = []
    if (ticks) bits.push(`• ${ticks} ${ticks === 1 ? 'item' : 'items'} ticked`)
    if (edited.length) bits.push(`• ${edited.length} ${edited.length === 1 ? 'item' : 'items'} changed — ${edited.slice(0, 3).map(x => trim(x, 46)).join('; ')}${edited.length > 3 ? '; …' : ''}`)
    for (const r of rest.slice(0, 8)) bits.push(`• ${trim(r.body, 160)}`)
    if (rest.length > 8) bits.push(`• …and ${rest.length - 8} more`)
    for (const r of said.slice(0, 5)) bits.push(`• _${trim(r.author, 30) || 'someone'}_: “${trim(r.body, 160)}”`)
    if (said.length > 5) bits.push(`• …and ${said.length - 5} more comments`)
    if (!bits.length) continue
    lines += bits.length
    parts.push(`*${link(b)}*\n${bits.join('\n')}`)
  }

  if (!parts.length) return empty        // a quiet day says nothing at all
  const text = `:crescent_moon: *Shared boards today*\n\n${parts.join('\n\n')}`
  if (opts.dry) return { posted: false, boards: parts.length, lines, text }
  const channel = EVE_CHANNELS.leadership
  if (!channel) return { posted: false, boards: parts.length, lines, text }
  try { await postToChannel(channel, text) } catch { return { posted: false, boards: parts.length, lines, text } }
  return { posted: true, boards: parts.length, lines, text }
}

/**
 * THE MORNING INDEX — what is waiting, before the day starts.
 *
 * Not a recap. This is the list somebody has to do something about: work that is late, work due
 * today, a technician asked for that nobody has pushed, and an owner's question with no reply
 * after it. It posts even when it is empty, once, because "nothing is waiting" is information on
 * a board people are relying on.
 */
export async function morningIndex(opts: { dry?: boolean } = {}): Promise<{ posted: boolean; text: string; counts: Record<string, number> }> {
  const boards = await sharedBoards()
  const counts = { overdue: 0, today: 0, asked: 0, unanswered: 0 }
  if (!boards.length) return { posted: false, text: '', counts }
  const t = todayET()
  const parts: string[] = []

  for (const b of boards) {
    const { data: steps } = await supabaseAdmin().from('project_steps')
      .select('id,title,due_on,status,done,bz_request,parent_id')
      .eq('project_id', b.id).limit(500)
    const open = ((steps || []) as any[]).filter(x => !x.parent_id && x.status !== 'done' && !x.done)
    const late = open.filter(x => x.due_on && String(x.due_on) < t)
    const now = open.filter(x => String(x.due_on || '') === t)
    const asked = open.filter(x => String(x.bz_request || '') === 'pending')

    // An owner's question with nothing after it. The last word being theirs is the whole test.
    const { data: notes } = await supabaseAdmin().from('project_notes')
      .select('body,author,via_share,created_at,kind')
      .eq('project_id', b.id).eq('kind', 'comment').order('created_at', { ascending: false }).limit(1)
    const waiting = ((notes || []) as any[])[0]?.via_share ? 1 : 0

    counts.overdue += late.length; counts.today += now.length; counts.asked += asked.length; counts.unanswered += waiting
    if (!late.length && !now.length && !asked.length && !waiting) continue

    const bits: string[] = []
    if (late.length) bits.push(`• *${late.length} overdue* — ${late.slice(0, 3).map(x => trim(x.title, 48)).join('; ')}${late.length > 3 ? '; …' : ''}`)
    if (now.length) bits.push(`• ${now.length} due today — ${now.slice(0, 3).map(x => trim(x.title, 48)).join('; ')}${now.length > 3 ? '; …' : ''}`)
    if (asked.length) bits.push(`• :wrench: ${asked.length} waiting on you to push to Breezeway — ${asked.slice(0, 3).map(x => trim(x.title, 48)).join('; ')}`)
    if (waiting) bits.push('• :speech_balloon: last word on the board is theirs — nobody has replied')
    parts.push(`*${link(b)}*\n${bits.join('\n')}`)
  }

  const text = parts.length
    ? `:sunrise: *Shared boards — what is waiting*\n\n${parts.join('\n\n')}`
    : ':sunrise: *Shared boards* — nothing overdue, nothing waiting on us.'
  if (opts.dry) return { posted: false, text, counts }
  const channel = EVE_CHANNELS.leadership
  if (!channel) return { posted: false, text, counts }
  try { await postToChannel(channel, text) } catch { return { posted: false, text, counts } }
  return { posted: true, text, counts }
}
