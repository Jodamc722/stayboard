// THE SHIFT BRIEF (Jon, 2026-10-07: "have a brief feature that stays active, like a checklist etc that
// they can review and close out and pass things over").
//
// A running checklist that lives in the floater on every page (components/ShiftBrief):
//   · MINE        what I own: items I added, items passed to me, items I claimed from the pool
//   · INCOMING    the pool — items passed "to the next shift" that nobody has claimed yet
//   · PASS OVER   hand an item to a person or to the pool, with a note; the history keeps who had it
//   · CLOSE OUT   end of shift: every open item of mine must be done or passed before I can close; the
//                 close-out records what was done and what went where (and can post it to Slack)
// Pure — no imports — so the route, the panel and a test share one copy of the rules.

export type BriefEvent = { at: string; by: string; what: 'added' | 'done' | 'reopened' | 'passed' | 'claimed' | 'note'; to?: string | null; note?: string | null }
export type BriefItem = {
  id: string
  text: string
  unit: string | null
  owner: string | null           // email; null = the incoming pool
  ownerName: string | null
  status: 'open' | 'done'
  at: string; by: string; byEmail: string
  doneAt?: string | null; doneBy?: string | null
  from?: string | null           // who passed it to the current owner
  passNote?: string | null       // what they said when they passed it
  seenByOwner?: boolean          // the current owner has opened their brief since it landed
  history: BriefEvent[]
}
export type Closeout = { id: string; at: string; by: string; byEmail: string; done: string[]; passed: { text: string; to: string }[]; note: string | null; slackTs?: string | null }
export type BriefStore = { items: BriefItem[]; closeouts: Closeout[] }

const clip = (v: any, n: number) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n)

export function newItem(input: any, who: { email: string; name: string }, id: string, nowIso: string): BriefItem | null {
  const text = clip(input?.text, 300)
  if (!text) return null
  const toPool = input?.owner === null || input?.owner === 'pool'
  const owner = toPool ? null : clip(input?.owner, 120).toLowerCase() || who.email
  return {
    id, text, unit: clip(input?.unit, 80) || null,
    owner, ownerName: toPool ? null : clip(input?.ownerName, 60) || (owner === who.email ? who.name : null),
    status: 'open', at: nowIso, by: who.name, byEmail: who.email,
    from: owner && owner !== who.email ? who.name : (toPool ? who.name : null),
    passNote: clip(input?.note, 400) || null,
    seenByOwner: owner === who.email,
    history: [{ at: nowIso, by: who.name, what: 'added', to: toPool ? 'Incoming shift' : (owner === who.email ? null : clip(input?.ownerName, 60) || owner) }],
  }
}

export function mineOf(items: BriefItem[], email: string): BriefItem[] {
  const e = email.toLowerCase()
  return items.filter(i => i.owner === e && (i.status === 'open' || recentlyDone(i)))
    .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || Number(!!b.from && !b.seenByOwner) - Number(!!a.from && !a.seenByOwner) || a.at.localeCompare(b.at))
}
export function poolOf(items: BriefItem[]): BriefItem[] {
  return items.filter(i => i.owner === null && i.status === 'open').sort((a, b) => a.at.localeCompare(b.at))
}
/** A ticked item stays on the list (struck through) for 12 hours so the close-out can show it. */
export function recentlyDone(i: BriefItem, now = Date.now()): boolean {
  return i.status === 'done' && !!i.doneAt && now - Date.parse(i.doneAt) < 12 * 3600_000
}

export function tick(i: BriefItem, who: string, nowIso: string): BriefItem {
  const done = i.status !== 'done'
  return { ...i, status: done ? 'done' : 'open', doneAt: done ? nowIso : null, doneBy: done ? who : null, history: [...i.history, { at: nowIso, by: who, what: done ? 'done' : 'reopened' }] }
}
export function pass(i: BriefItem, to: { email: string | null; name: string | null }, who: string, note: string | null, nowIso: string): BriefItem {
  return {
    ...i, owner: to.email ? to.email.toLowerCase() : null, ownerName: to.email ? to.name : null,
    from: who, passNote: clip(note, 400) || null, seenByOwner: false, status: 'open', doneAt: null, doneBy: null,
    history: [...i.history, { at: nowIso, by: who, what: 'passed', to: to.email ? (to.name || to.email) : 'Incoming shift', note: clip(note, 400) || null }],
  }
}
export function claim(i: BriefItem, me: { email: string; name: string }, nowIso: string): BriefItem {
  return { ...i, owner: me.email.toLowerCase(), ownerName: me.name, seenByOwner: true, history: [...i.history, { at: nowIso, by: me.name, what: 'claimed' }] }
}
export function addNote(i: BriefItem, who: string, note: string, nowIso: string): BriefItem {
  return { ...i, history: [...i.history, { at: nowIso, by: who, what: 'note', note: clip(note, 400) }] }
}

/** Can this person close out? Only when nothing of theirs is still open. */
export function openOf(items: BriefItem[], email: string): BriefItem[] {
  return items.filter(i => i.owner === email.toLowerCase() && i.status === 'open')
}

/** The close-out record: what I finished this shift, and what I passed where. */
export function closeoutOf(items: BriefItem[], me: { email: string; name: string }, since: string, note: string | null, id: string, nowIso: string): Closeout {
  const done = items.filter(i => i.status === 'done' && i.doneBy === me.name && i.doneAt && i.doneAt >= since).map(i => i.text)
  const passed: { text: string; to: string }[] = []
  for (const i of items) for (const h of i.history) if (h.what === 'passed' && h.by === me.name && h.at >= since) passed.push({ text: i.text, to: String(h.to || 'Incoming shift') })
  return { id, at: nowIso, by: me.name, byEmail: me.email, done, passed, note: clip(note, 600) || null }
}

/** Keep the store small: done items older than 3 days and close-outs older than 30 drop off. */
export function pruneBrief(s: BriefStore, now = Date.now()): BriefStore {
  return {
    items: s.items.filter(i => !(i.status === 'done' && i.doneAt && now - Date.parse(i.doneAt) > 3 * 86400_000)).slice(-600),
    closeouts: s.closeouts.filter(c => now - Date.parse(c.at) < 30 * 86400_000).slice(-300),
  }
}
