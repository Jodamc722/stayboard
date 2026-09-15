// MAILCHIMP — connection + the push (Jon, 2026-09-14: "connect to api to mailchimp to upload the
// contact info").
//
// The API key is a SECRET and follows the same rule as the Slack webhook next door: it is written
// here, read only on the server, and publicView() is the only shape allowed to cross the wire.
// A Mailchimp key carries its datacentre on the end ("...-us14"), which is also the subdomain the
// API lives on, so nothing extra has to be configured or guessed.
//
// WHAT GETS SENT, AND WHAT NEVER DOES. Only addresses classified `mailable` (lib/guest-contacts.ts)
// are ever uploaded. OTA forwarding aliases are filtered out at the door, twice — once when the
// caller picks the rows and once here — because the cost of getting this wrong is a bounce storm
// and an Airbnb terms problem, and a guard that exists in one place is a guard that gets refactored
// away.
//
// STATUS. New contacts go up as `subscribed` only when the operator has confirmed they have consent
// (that is a human decision, not ours to assume); otherwise `transactional`, which parks the contact
// in the audience without treating it as marketing opt-in. Existing members are never downgraded:
// upsert writes status_if_new, so someone who already unsubscribed stays unsubscribed.
import 'server-only'
import { createHash } from 'crypto'
import { getSetting, setSetting } from './app-settings'
import type { Contact } from './guest-contacts'

export const MAILCHIMP_KEY = 'integration_mailchimp'

export type MailchimpConnection = {
  apiKey: string            // SECRET — never returned to the browser
  dc: string                // datacentre, e.g. "us14" — parsed from the key
  audienceId: string        // the list contacts land in
  audienceName: string
  accountName?: string
  connectedBy: string
  connectedAt: string
  /** Set by the operator when they confirm these guests consented to marketing. */
  consentConfirmed?: boolean
  lastSyncAt?: string | null
  lastSyncCount?: number | null
}

export type PublicMailchimp = {
  connected: boolean
  audienceId?: string; audienceName?: string; accountName?: string; dc?: string
  connectedBy?: string; connectedAt?: string
  consentConfirmed?: boolean
  lastSyncAt?: string | null; lastSyncCount?: number | null
  /** Last four of the key, so an admin can tell which key is installed without seeing it. */
  keyHint?: string
}

export function dcFromKey(apiKey: string): string {
  const m = /-([a-z]{2}\d{1,3})$/i.exec(String(apiKey || '').trim())
  return m ? m[1].toLowerCase() : ''
}

export async function getMailchimp(): Promise<MailchimpConnection | null> {
  const stored = await getSetting<any>(MAILCHIMP_KEY, null)
  if (!stored || typeof stored !== 'object' || !stored.apiKey) return null
  return stored as MailchimpConnection
}

export async function setMailchimp(conn: MailchimpConnection | null, actor: string) {
  return setSetting(MAILCHIMP_KEY, conn, actor)
}

/** The ONLY shape that may reach the browser. */
export function publicMailchimp(c: MailchimpConnection | null): PublicMailchimp {
  if (!c || !c.apiKey) return { connected: false }
  return {
    connected: true,
    audienceId: c.audienceId, audienceName: c.audienceName, accountName: c.accountName, dc: c.dc,
    connectedBy: c.connectedBy, connectedAt: c.connectedAt,
    consentConfirmed: !!c.consentConfirmed,
    lastSyncAt: c.lastSyncAt || null, lastSyncCount: c.lastSyncCount ?? null,
    keyHint: '••••' + String(c.apiKey).slice(-4),
  }
}

async function mc(conn: { apiKey: string; dc: string }, path: string, init?: RequestInit) {
  const url = 'https://' + conn.dc + '.api.mailchimp.com/3.0' + path
  const r = await fetch(url, {
    ...init,
    headers: {
      'Authorization': 'Basic ' + Buffer.from('key:' + conn.apiKey).toString('base64'),
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  })
  const text = await r.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { /* Mailchimp errors are sometimes HTML */ }
  if (!r.ok) {
    const detail = json?.detail || json?.title || text.slice(0, 200) || ('HTTP ' + r.status)
    throw new Error(detail)
  }
  return json
}

/**
 * Run `fn` over `items` with at most `limit` in flight.
 *
 * Mailchimp allows ten simultaneous connections per key and the whole push has to finish inside the
 * route's sixty-second budget. Reading a 7,500-member audience one page at a time is eight round
 * trips in series for no reason; so is posting sixteen batches of five hundred. Nothing here shares
 * state between workers beyond appending to counters, so order does not matter.
 */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

/** Verify a key and list the audiences it can reach — the connect screen's first call. */
export async function probe(apiKey: string): Promise<{ accountName: string; dc: string; audiences: { id: string; name: string; members: number }[] }> {
  const dc = dcFromKey(apiKey)
  if (!dc) throw new Error('That does not look like a Mailchimp API key — they end in a datacentre, like "-us14".')
  const me = await mc({ apiKey, dc }, '/')
  const lists = await mc({ apiKey, dc }, '/lists?count=100&fields=lists.id,lists.name,lists.stats.member_count')
  return {
    accountName: String(me?.account_name || me?.username || ''),
    dc,
    audiences: (lists?.lists || []).map((l: any) => ({
      id: String(l.id), name: String(l.name), members: Number(l?.stats?.member_count) || 0,
    })),
  }
}

/** Mailchimp addresses a member by the MD5 of the lowercased email. */
function memberHash(email: string): string {
  return createHash('md5').update(String(email).trim().toLowerCase()).digest('hex')
}

/** The tags Jon asked to segment on, built from what Lighthouse already knows. */
export function tagsFor(c: Contact): string[] {
  const t: string[] = []
  if (c.channel) t.push('Channel: ' + c.channel)
  if (c.everDirect) t.push('Has booked direct')
  if (c.family === 'ota') t.push('OTA guest')
  t.push(c.stays >= 5 ? 'Stays: 5+' : c.stays >= 2 ? 'Stays: 2-4' : 'Stays: 1')
  if (c.stays >= 2) t.push('Repeat guest')
  if (c.lastBuilding) t.push('Building: ' + c.lastBuilding)
  for (const mk of c.markets.slice(0, 2)) if (mk && mk !== 'Unknown') t.push('Market: ' + mk)
  if (c.vip) t.push('VIP')
  if (c.reviews > 0) t.push('Has left a review')
  for (const own of c.tags.slice(0, 6)) t.push(own)
  // Mailchimp caps a tag at 100 chars and dislikes commas in the tag name.
  return Array.from(new Set(t.map(x => x.replace(/,/g, ' ').trim().slice(0, 100)).filter(Boolean))).slice(0, 25)
}

// ── WHAT IS ALREADY IN THE AUDIENCE ─────────────────────────────────────────────────────────────
//
// THE DUPLICATE QUESTION, ANSWERED PROPERLY (Jon, 2026-09-14: "make sure no duplicates are sent
// over"). There are three different things people mean by that, and only one of them needed work.
//
//   1. The same address twice inside one push. Handled below by byEmail — and it has to be, because
//      a repeated address makes Mailchimp reject the whole batch of 500, not just the one row.
//   2. The same address on a second push next month. Cannot happen. A Mailchimp member is keyed by
//      the MD5 of their lowercased email, so a second push of the same contact is an UPDATE. The
//      audience is physically incapable of holding one address twice.
//   3. Pushing somebody Mailchimp has already written off. THIS is the one that was missing, and
//      it is the one that costs money and sending reputation:
//        unsubscribed — they opted out. status_if_new already stops us re-subscribing them, but
//                       there is nothing to gain by writing to the record either.
//        cleaned      — the address hard-bounced. Re-sending it is how a sending reputation dies.
//        archived     — somebody took them out of the audience ON PURPOSE. Archived members are not
//                       returned by the default member read, so without the second read below a
//                       push would quietly un-archive every contact ever cleared out, and bill for
//                       them. That is the closest thing here to a real duplicate.
//
// So the audience is read before anything is sent. It costs one request per thousand members, and
// it turns "trust me, nothing is duplicated" into a number on the screen before the button is
// pressed.
export type AudienceMember = { status: string; tags: string[] }
export type AudienceIndex = {
  /** lowercased email -> what Mailchimp holds (subscribed | transactional | unsubscribed | cleaned | pending | archived) */
  members: Map<string, AudienceMember>
  total: number
  /** The read hit its ceiling or failed — treat the counts as a floor, not a fact. */
  partial: boolean
}

const MEMBER_PAGE = 1000
const MEMBER_PAGE_CAP = 60   // 60,000 members before we admit we only have part of the picture
const FIELDS = 'total_items,members.email_address,members.status,members.tags'

function absorb(index: AudienceIndex, rows: any[], archived: boolean) {
  for (const m of rows) {
    const e = String(m?.email_address || '').trim().toLowerCase()
    // The archived pass must not overwrite a live status: first write wins.
    if (!e || index.members.has(e)) continue
    const tags = Array.isArray(m?.tags) ? m.tags.map((t: any) => String(t?.name || t || '')).filter(Boolean) : []
    index.members.set(e, { status: archived ? 'archived' : String(m?.status || ''), tags })
  }
}

async function readMembers(conn: MailchimpConnection, index: AudienceIndex, archived: boolean) {
  const base = '/lists/' + encodeURIComponent(conn.audienceId) + '/members'
    + '?count=' + MEMBER_PAGE + '&fields=' + FIELDS + (archived ? '&status=archived' : '')
  // Page one tells us how many there are; the rest go out together rather than in a queue.
  const first = await mc(conn, base + '&offset=0')
  const firstRows: any[] = Array.isArray(first?.members) ? first.members : []
  absorb(index, firstRows, archived)
  const total = Number(first?.total_items) || firstRows.length
  if (!archived) index.total = total
  if (firstRows.length < MEMBER_PAGE) return

  const pages = Math.min(Math.ceil(total / MEMBER_PAGE), MEMBER_PAGE_CAP)
  if (Math.ceil(total / MEMBER_PAGE) > MEMBER_PAGE_CAP) index.partial = true
  const offsets: number[] = []
  for (let p = 1; p < pages; p++) offsets.push(p * MEMBER_PAGE)
  const batches = await pool(offsets, 5, off => mc(conn, base + '&offset=' + off))
  for (const r of batches) absorb(index, Array.isArray(r?.members) ? r.members : [], archived)
}

/** Read the whole audience — live members first, then the archived ones the default read hides. */
export async function audienceIndex(conn: MailchimpConnection): Promise<AudienceIndex> {
  const index: AudienceIndex = { members: new Map(), total: 0, partial: false }
  await readMembers(conn, index, false)
  await readMembers(conn, index, true)
  return index
}

// ── TAGS GO STALE, AND STALE TAGS ARE WHAT BREAK SEGMENTS ───────────────────────────────────────
//
// The batch endpoint's `tags` array is applied when a member is CREATED. On a member that already
// exists it is, at best, not something to rely on — which means a guest who has gone from one stay
// to five keeps the tag "Stays: 1" forever and quietly falls out of the repeat-guest segment.
//
// The cheap fix is to notice. We already read every member to answer the duplicate question, so we
// read their tags at the same time and compare. Almost always nothing has changed and nothing is
// sent; when something has, only that member gets a second call.
//
// WE ONLY RETIRE TAGS WE OWN. A tag Jon typed in Mailchimp by hand looks exactly like one of ours
// to the API, and deleting somebody's segmentation because our list did not happen to contain it
// would be unforgivable. So a tag comes OFF only if it matches a shape this file generates.
const MANAGED_PREFIXES = ['Channel: ', 'Building: ', 'Market: ', 'Stays: ']
const MANAGED_EXACT = new Set(['Repeat guest', 'Has booked direct', 'OTA guest', 'VIP', 'Has left a review'])
function isManagedTag(name: string): boolean {
  return MANAGED_EXACT.has(name) || MANAGED_PREFIXES.some(p => name.startsWith(p))
}

/** What would have to change on an existing member for their tags to be right. */
function tagDelta(current: string[], desired: string[]): { name: string; status: 'active' | 'inactive' }[] {
  const have = new Set(current)
  const want = new Set(desired)
  const ops: { name: string; status: 'active' | 'inactive' }[] = []
  for (const n of desired) if (!have.has(n)) ops.push({ name: n, status: 'active' })
  for (const n of current) if (isManagedTag(n) && !want.has(n)) ops.push({ name: n, status: 'inactive' })
  return ops
}

/** Past this many in one run we stop and say so, rather than running the route out of time. */
const TAG_REFRESH_CAP = 400

export type SyncResult = {
  attempted: number; created: number; updated: number; failed: number
  skippedNotMailable: number
  /** Held back by a CHANNEL rule rather than a bad address — Expedia and friends. */
  skippedRestricted: number
  /** Held back because they left us 3 stars or fewer. */
  skippedUnhappy: number
  /** Dropped as a repeat of an address already in this same push. */
  skippedDuplicate: number
  // ── the preflight, filled in from audienceIndex() ──
  /** Contacts Mailchimp has never seen. These are the only ones that add to the member count. */
  willCreate: number
  /** Contacts already in the audience. These are updated in place — never duplicated. */
  alreadyInAudience: number
  skippedUnsubscribed: number
  skippedCleaned: number
  skippedArchived: number
  /** Existing members whose tags no longer match what Lighthouse knows. */
  tagsStale: number
  /** How many of those we actually corrected this run. */
  tagsRefreshed: number
  /** Left for next time because we hit TAG_REFRESH_CAP. */
  tagsDeferred: number
  /** Members in the connected audience right now. */
  audienceTotal: number
  /** The audience read failed or was truncated — the numbers above are a floor. */
  audiencePartial: boolean
  errors: { email: string; reason: string }[]
}

/** Merge fields we have nothing for are OMITTED, never sent empty. Sending FNAME:"" on a contact
 *  Mailchimp already has a first name for would blank it — a push meant to enrich the audience
 *  would quietly strip it instead. */
function mergeFields(c: Contact): Record<string, string> {
  const f: Record<string, string> = {}
  if (c.first) f.FNAME = c.first
  if (c.last) f.LNAME = c.last
  if (c.phone) f.PHONE = c.phone
  return f
}

/**
 * Push contacts into the audience, 500 at a time, via Mailchimp's batch-subscribe endpoint.
 *
 * `skip_merge_validation` is deliberately on: a guest whose phone number arrived from an OTA in a
 * shape Mailchimp's phone validator rejects should still get into the audience with their name and
 * email. Losing the contact over a badly formatted phone field is the worse outcome.
 */
export async function syncContacts(conn: MailchimpConnection, contacts: Contact[], opts?: { dryRun?: boolean }): Promise<SyncResult> {
  const out: SyncResult = {
    attempted: 0, created: 0, updated: 0, failed: 0,
    skippedNotMailable: 0, skippedRestricted: 0, skippedUnhappy: 0, skippedDuplicate: 0,
    willCreate: 0, alreadyInAudience: 0,
    skippedUnsubscribed: 0, skippedCleaned: 0, skippedArchived: 0,
    tagsStale: 0, tagsRefreshed: 0, tagsDeferred: 0,
    audienceTotal: 0, audiencePartial: false, errors: [],
  }

  // The last gate, and it is deliberately redundant with the caller's. Anything that is not a real
  // address, or that a channel forbids us marketing to, or that belongs to a guest who told us they
  // had a bad stay, stops here no matter who asked. They are counted separately because they mean
  // different things: a dead mailbox, a contractual block, and a person we have decided not to sell
  // to. Only the last one is a choice, and it is Jon's.
  const rows = contacts.filter(c => {
    if (c.mail === 'restricted') { out.skippedRestricted++; return false }
    if (c.mail !== 'mailable' || !c.email) { out.skippedNotMailable++; return false }
    if (c.unhappy) { out.skippedUnhappy++; return false }
    return true
  })
  // One row per address — a duplicate inside one batch makes Mailchimp reject the whole batch.
  const byEmail = new Map<string, Contact>()
  for (const c of rows) {
    if (byEmail.has(c.email!)) { out.skippedDuplicate++; continue }
    byEmail.set(c.email!, c)
  }

  // THE PREFLIGHT. If this read fails we do not abandon the push — we push without the skipping and
  // say so, because a broken preflight is not a reason to leave the audience stale. status_if_new
  // still protects anyone who unsubscribed.
  let index: AudienceIndex | null = null
  try {
    index = await audienceIndex(conn)
    out.audienceTotal = index.total
    out.audiencePartial = index.partial
  } catch (e: any) {
    out.audiencePartial = true
    out.errors.push({ email: 'audience read', reason: String(e?.message || e).slice(0, 200) })
  }

  const list: Contact[] = []
  const retag: { email: string; ops: { name: string; status: 'active' | 'inactive' }[] }[] = []
  for (const c of Array.from(byEmail.values())) {
    const held = index ? index.members.get(c.email!) : undefined
    const state = held?.status || ''
    // These three mean "leave this person where they are" — see the note above audienceIndex.
    if (state === 'unsubscribed') { out.skippedUnsubscribed++; continue }
    if (state === 'cleaned') { out.skippedCleaned++; continue }
    if (state === 'archived') { out.skippedArchived++; continue }
    if (held) {
      out.alreadyInAudience++
      const ops = tagDelta(held.tags, tagsFor(c))
      if (ops.length) { out.tagsStale++; retag.push({ email: c.email!, ops }) }
    } else if (index) out.willCreate++
    list.push(c)
  }
  out.attempted = list.length
  if (opts?.dryRun) { out.tagsDeferred = out.tagsStale; return out }
  if (!list.length) return out

  const statusIfNew = conn.consentConfirmed ? 'subscribed' : 'transactional'

  const slices: Contact[][] = []
  for (let i = 0; i < list.length; i += 500) slices.push(list.slice(i, i + 500))

  await pool(slices, 3, async slice => {
    const body = {
      members: slice.map(c => ({
        email_address: c.email,
        email_type: 'html',
        status_if_new: statusIfNew,
        merge_fields: mergeFields(c),
        tags: tagsFor(c),
      })),
      update_existing: true,
      skip_merge_validation: true,
    }
    try {
      const r = await mc(conn, '/lists/' + encodeURIComponent(conn.audienceId), { method: 'POST', body: JSON.stringify(body) })
      out.created += Number(r?.new_members?.length) || 0
      out.updated += Number(r?.updated_members?.length) || 0
      const errs = Array.isArray(r?.errors) ? r.errors : []
      out.failed += errs.length
      for (const e of errs.slice(0, 20)) {
        out.errors.push({ email: String(e?.email_address || ''), reason: String(e?.error || e?.error_code || 'rejected') })
      }
    } catch (e: any) {
      // A whole batch failing is worth saying out loud rather than reporting a silent zero.
      out.failed += slice.length
      out.errors.push({ email: slice.length + ' contacts', reason: String(e?.message || e).slice(0, 200) })
    }
  })

  // Now the members whose tags had drifted. This is the only per-contact call in the whole push and
  // it fires for nobody on a steady-state run — on a first sync after months it might be a few
  // hundred, which is why it is capped and reports what it left behind.
  const doNow = retag.slice(0, TAG_REFRESH_CAP)
  out.tagsDeferred = retag.length - doNow.length
  await pool(doNow, 5, async r => {
    try {
      await mc(conn, '/lists/' + encodeURIComponent(conn.audienceId) + '/members/' + memberHash(r.email) + '/tags',
        { method: 'POST', body: JSON.stringify({ tags: r.ops }) })
      out.tagsRefreshed++
    } catch (e: any) {
      // A tag that would not update is not worth failing the push over — the contact is correct.
      if (out.errors.length < 25) out.errors.push({ email: r.email, reason: 'tags: ' + String(e?.message || e).slice(0, 120) })
    }
  })

  return out
}

export { memberHash }
