// ONE WAY TO TAG A TEAMMATE (Jon, 2026-10-14: "all notes in Lighthouse you can tag and it notifies
// them, pop up on their page" / "clean up how we tag or mention follow up about issues").
//
// Before this there were three parsers — email prefix in comments, fuzzy name in projects, a picker
// in handoff alerts — and most note boxes parsed nothing. This is the only one now. It is a pure
// function over a roster, no imports, so every note box in the app agrees on who "@Carlo" is.
//
// What a tag can be:
//   @carlo  @Carlo  @carlo.perez  @carlo@stay-hospitality.com  @"Carlo Perez"  @Carlo Perez
// ONLY REAL LIGHTHOUSE USERS (Jon, 2026-10-16: "we should only be able to tag actual users"). There
// are no group tags — @everyone / @housekeeping resolve to nobody and come back as unknown, so a
// note can never fan out to people who were not named. A bare first name that two people share is
// NOT a tag either (we never guess); "@Carlo Perez" is.

export type RosterPerson = {
  email: string
  /** Display name, "First Last". */
  name: string
  /** 'admin' | 'supervisor' | 'housekeeping' | 'maintenance' | 'ccs' | … — whatever app_users says. */
  role?: string | null
}

export type ParsedMentions = {
  /** Emails of the people tagged, deduped, roster-cased (lower). */
  emails: string[]
  /** Always empty now — kept so callers compiled against the group era still type-check. */
  groups: string[]
  /** Tokens that looked like a tag but matched nobody — the UI can say "nobody called X". */
  unknown: string[]
}


const fold = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean)

/** First name of a display name — "Maria Jose Perez" → "maria". */
export const firstNameOf = (name: string) => words(name)[0] || ''

/**
 * Find every @tag in `text` and resolve it against the roster.
 * Resolution order per token: exact email · email prefix · full name (2–3 words) · unique first name.
 * `picked` are emails chosen from a picker — always honoured when on the roster.
 */
export function parseMentions(text: string, roster: RosterPerson[], picked: string[] = []): ParsedMentions {
  const people = roster.map(p => ({ ...p, email: fold(p.email), fw: words(p.name), prefix: fold(p.email).split('@')[0] }))
    .filter(p => p.email)
  const byEmail = new Map(people.map(p => [p.email, p]))
  const out = new Set<string>()
  const groups = new Set<string>()
  const unknown: string[] = []
  for (const e of picked) { const k = fold(e); if (byEmail.has(k)) out.add(k) }

  // Tokens: @"quoted name", @email, or @word followed by up to two more Capitalised words.
  // Deliberately case-SENSITIVE: only a Capitalised following word can extend a tag into a full name,
  // so "@carlo please check" tags Carlo and "@Carlo Perez please" tags Carlo Perez.
  const re = /(^|[^A-Za-z0-9@])@(?:"([^"\n]{2,60})"|([A-Za-z0-9][A-Za-z0-9._+-]*@[A-Za-z0-9.-]+\.[A-Za-z]{2,})|([A-Za-z0-9][A-Za-z0-9._-]*(?:\s+[A-Z][A-Za-z'-]+){0,2}))/g
  let m: RegExpExecArray | null
  const src = String(text || '')
  while ((m = re.exec(src))) {
    const quoted = m[2], email = m[3], loose = m[4]
    if (email) {
      const k = fold(email)
      if (byEmail.has(k)) out.add(k); else unknown.push(email)
      continue
    }
    const raw = (quoted || loose || '').trim()
    if (!raw) continue
    const hit = resolveName(raw, people)
    if (hit) { out.add(hit); continue }
    // "@Carlo Perez" may really be "@Carlo" followed by a sentence starting with a capital — try the
    // shorter forms before calling it unknown.
    const parts = raw.split(/\s+/)
    let found = false
    for (let n = parts.length - 1; n >= 1 && !found; n--) {
      const h = resolveName(parts.slice(0, n).join(' '), people)
      if (h) { out.add(h); found = true }
    }
    if (!found) unknown.push(raw)
  }
  return { emails: Array.from(out), groups: Array.from(groups), unknown }
}

function resolveName(raw: string, people: Array<RosterPerson & { fw: string[]; prefix: string }>): string | null {
  const k = fold(raw)
  const w = words(raw)
  if (!w.length) return null
  // email prefix: carlo.perez / cperez
  const byPrefix = people.filter(p => p.prefix === k || p.prefix === w.join('.') || p.prefix === w.join(''))
  if (byPrefix.length === 1) return byPrefix[0].email
  // full name, in order, every word a prefix of the roster word ("mari jose" → "maria jose perez")
  if (w.length >= 2) {
    const full = people.filter(p => w.length <= p.fw.length && w.every((x, i) => p.fw[i] === x || p.fw[i].startsWith(x)))
    if (full.length === 1) return full[0].email
    // first + last with middle names skipped
    const fl = people.filter(p => p.fw[0] === w[0] && p.fw[p.fw.length - 1] === w[w.length - 1])
    if (fl.length === 1) return fl[0].email
    return null
  }
  // single word: a unique first name, else a unique whole-name word
  const first = people.filter(p => p.fw[0] === w[0])
  if (first.length === 1) return first[0].email
  if (first.length > 1) return null
  const any = people.filter(p => p.fw.includes(w[0]))
  return any.length === 1 ? any[0].email : null
}

/** Names for a set of emails, for "tagged Carlo and Alberto". */
export function namesFor(emails: string[], roster: RosterPerson[]): string[] {
  const m = new Map(roster.map(p => [fold(p.email), p.name || p.email.split('@')[0]]))
  return emails.map(e => m.get(fold(e)) || e.split('@')[0])
}

/** Human line for the result — "Carlo, Alberto and 4 in housekeeping". */
export function describeMentions(p: ParsedMentions, roster: RosterPerson[]): string {
  if (!p.emails.length) return ''
  const n = namesFor(p.emails, roster).map(x => x.split(' ')[0])
  return n.length <= 3 ? n.join(', ') : `${n.slice(0, 2).join(', ')} and ${n.length - 2} more`
}
