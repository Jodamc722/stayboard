// THE SHAPE OF A MORNING ASK, and the one grouping rule — kept out of ask.ts so it can be tested
// without a database (ask.ts is server-only).
export type AskType = 'question' | 'finding' | 'ralph' | 'action'

export type AskItem = {
  type: AskType
  /** The row this ask is about — a question id or an audit finding id. */
  ref: string
  /** A grouped ask (five listings off one channel) — the member finding ids. A reply decides all of them. */
  refs?: string[]
  title: string
  body: string
  /** Higher goes first. Severity and repetition both raise it. */
  rank: number
}

// FIVE LISTINGS OFF ONE CHANNEL IS ONE ASK, NOT FIVE (independent study 2026-10-10: the morning
// preview was five separate "X is not connected on Expedia" items, three of which would have taken
// the whole day's budget). Channel findings share a fix and an answer, so they are asked together
// with every room number on the line; the reply decides all of them (resolveAsk applies it to each
// member). Other findings are still one ask each.
const CHANNEL_TITLE_RE = /^(.+?) is (.+?) on (.+)$/
export function groupChannelFindings(audits: any[], fresh: (type: AskType, ref: string) => boolean): { items: AskItem[]; rest: any[] } {
  const rest: any[] = []
  const groups = new Map<string, any[]>()
  for (const a of audits) {
    const id = String(a.id || '')
    const ev = a.evidence && typeof a.evidence === 'object' ? a.evidence : {}
    const m = CHANNEL_TITLE_RE.exec(String(a.title || ''))
    if (!id.startsWith('channel:') || !m) { rest.push(a); continue }
    if (!fresh('finding', id)) continue
    const key = `${String(ev.platform || m[3])}:${String(ev.verdict || m[2])}`
    groups.set(key, (groups.get(key) || []).concat([{ ...a, _unit: m[1].trim(), _state: m[2].trim(), _channel: m[3].trim() }]))
  }
  const items: AskItem[] = []
  for (const [key, members] of Array.from(groups.entries())) {
    if (members.length === 1) { rest.push(members[0]); continue }
    const first = members[0]
    const age = Math.max(0, ...members.map(x => Number(x.ageDays) || 0))
    const units = members.map(x => String(x._unit).replace(/\s*-\s*/g, ' ').replace(/\s{2,}/g, ' ')).slice(0, 12)
    items.push({
      type: 'finding',
      ref: 'channel-group:' + key,
      refs: members.map(x => String(x.id)),
      title: `Something looks off — ${first.area || 'listings'}`,
      body: [
        `**${members.length} listings are ${String(first._state).toLowerCase()} on ${first._channel}** — ${units.join(', ')}${members.length > units.length ? ` +${members.length - units.length}` : ''}`,
        `Guesty reports each of them as "${first._state}" on ${first._channel}. While they stay that way they cannot be booked there, and nothing else in the app will notice — the calendar looks the same either way.`,
        first.fix ? `\n**What I'd do:** ${first.fix}` : '',
        age > 0 ? `\n_Oldest open ${age} day${age === 1 ? '' : 's'}._` : '',
        `\nReply and tell me to fix it — or tell me why it's fine and I'll remember that for all of them.`,
      ].filter(Boolean).join('\n'),
      rank: (first.severity === 'critical' ? 1000 : 500) + Math.min(age, 60),
    })
  }
  return { items, rest }
}
