// ONE PERSON, ONE MATCH (2026-09-02).
//
// Names for the same human arrive spelled three ways — Homebase shift, Breezeway roster, Breezeway
// task assignee — and the old fallback was `roster.find(r => r.name.includes(firstName))`: first
// hit wins, substring match, no uniqueness check. "Maria" matched "Marianne Cruz" and the Assign
// button wrote the task to the wrong person without a word. This is the one matcher every surface
// uses: exact normalized name, else a UNIQUE first name (≥3 letters), else refuse and say why.
// A guess that writes to Breezeway is worse than a button that says "assign from the board".
export type RosterPerson = { id: number; name: string; departments?: string[] }

export const personKey = (v: any): string =>
  String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

export function matchRoster(roster: RosterPerson[], name: string): { ok: true; id: number; person: RosterPerson } | { ok: false; reason: string } {
  const n = personKey(name)
  if (!n) return { ok: false, reason: 'No name to match.' }
  const exact = roster.filter(r => personKey(r.name) === n)
  if (exact.length === 1) return { ok: true, id: exact[0].id, person: exact[0] }
  if (exact.length > 1) return { ok: false, reason: 'Two Breezeway people are named "' + name + '" — assign from the board.' }
  const first = n.split(' ')[0]
  const byFirst = first.length > 2 ? roster.filter(r => personKey(r.name).split(' ')[0] === first) : []
  if (byFirst.length === 1) return { ok: true, id: byFirst[0].id, person: byFirst[0] }
  return { ok: false, reason: byFirst.length > 1 ? 'More than one "' + name.split(' ')[0] + '" on the Breezeway roster — assign from the board.' : 'Could not find "' + name + '" on the Breezeway roster — assign from the board.' }
}

/** Does a task assignee string name this person? Exact key, or a unique-enough first name. */
export function samePerson(a: any, b: any): boolean {
  const ka = personKey(a), kb = personKey(b)
  if (!ka || !kb) return false
  if (ka === kb) return true
  const fa = ka.split(' ')[0], fb = kb.split(' ')[0]
  return fa.length > 3 && fa === fb && (ka.split(' ').length === 1 || kb.split(' ').length === 1)
}
