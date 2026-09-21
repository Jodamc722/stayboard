// SHARE LINK ROWS — the server half of lib/share-links.ts: read one, count a use, mint a passcode,
// and the one-time hashing of any legacy plaintext passcode migration 101 carried across.
import 'server-only'
import { randomBytes, randomInt } from 'crypto'
import { supabaseAdmin } from './supabase-admin'
import { hashPassword } from './edit-access'
import { hintOf, type ShareLinkRow } from './share-links'

const str = (v: any) => typeof v === 'string' ? v : (v == null ? '' : String(v))
const CODE_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/i
const SCHED_CODE = /^[0-9a-f]{12}$/i

export function normalizeRow(row: any): ShareLinkRow {
  const scope = row.scope && typeof row.scope === 'object' ? row.scope : {}
  // BEFORE MIGRATION 101 HAS RUN the row has no passcode_hash / open / kind columns and still
  // carries the old `passcode`. Read it the way the old code did: a passcode is the passcode, a
  // custom report without one was always open on its code alone. (A field board or parking board
  // without one used to fall back to the team password, which this code no longer honours — those
  // stay shut until the migration lands. Nothing opens that was locked before.)
  const legacy = row.passcode_hash === undefined && 'passcode' in row
  const sections = row.sections && typeof row.sections === 'object' ? row.sections : {}
  const legacyKind = !legacy ? null
    : sections.parking === true ? 'parking'
    : ['today', 'units', 'crew', 'cleans', 'verify', 'vacant', 'work', 'issues', 'requests', 'add'].some(k => sections[k] === true) ? 'field-board'
    : 'custom-page'
  const hash = legacy ? (row.passcode ? str(row.passcode) : null) : (row.passcode_hash ? str(row.passcode_hash) : null)
  return {
    ...row,
    code: str(row.code), kind: str(row.kind) || legacyKind || 'custom-page', title: row.title ?? row.label ?? null,
    audience: str(row.audience) || 'internal', scope,
    passcode_hash: hash, passcode_hint: row.passcode_hint ? str(row.passcode_hint) : null,
    open: legacy ? (!hash && legacyKind === 'custom-page') : row.open === true, expires_at: row.expires_at || null, revoked_at: row.revoked_at || null,
    last_used_at: row.last_used_at || null, uses: Number(row.uses) || 0, notes: row.notes ?? null,
  }
}

// THE FORMER FAMILY PAGES, BEFORE MIGRATION 101 HAS RUN. The code deploys first and the migration
// runs when Jon runs it; in between, /vendor/botanica, /day, /report/marketing… have no row yet.
// Rather than lock every crew out for that window, the gate synthesises the row the migration
// will create from the same source the migration copies: share_settings 1/3/4/7. Same code, same
// stored value → the same cookie generation, so a cookie minted now is still good once the row
// exists. The id is 'legacy:<settings id>' so a plaintext upgrade lands in share_settings.
const LEGACY_FAMILY: Record<string, { id: number; kind: string; audience: string; title: string; scope: Record<string, any> }> = {
  botanica: { id: 1, kind: 'vendor-board', audience: 'vendor', title: 'Botanica — cleaning board', scope: { vendor: 'botanica' } },
  pt: { id: 1, kind: 'vendor-board', audience: 'vendor', title: 'Park Towers — cleaning board', scope: { vendor: 'pt' } },
  'amrit-capri-lucerne': { id: 1, kind: 'vendor-board', audience: 'vendor', title: 'Amrit / Capri / Lucerne — cleaning board', scope: { vendor: 'amrit-capri-lucerne' } },
  salato: { id: 1, kind: 'vendor-board', audience: 'partner', title: 'Salato — front desk board', scope: { vendor: 'salato' } },
  'salato-desk': { id: 1, kind: 'salato-desk', audience: 'partner', title: 'Salato — occupancy & ID viewer', scope: {} },
  day: { id: 1, kind: 'day-sheet', audience: 'crew', title: 'Day sheet — crew', scope: {} },
  delivery: { id: 1, kind: 'delivery', audience: 'crew', title: 'Delivery log', scope: {} },
  'orders-live': { id: 1, kind: 'orders-live', audience: 'crew', title: 'Guest orders — live', scope: {} },
  marketing: { id: 3, kind: 'marketing', audience: 'partner', title: 'Direct bookings report — partners', scope: {} },
  'owner-audit': { id: 4, kind: 'owner-audit', audience: 'internal', title: 'Owner statement audit — reviewers', scope: {} },
  'botanica-report': { id: 7, kind: 'botanica', audience: 'owner', title: 'Botanica report — Margaux', scope: {} },
}
export const LEGACY_ID_PREFIX = 'legacy:'
/** share_settings row id behind a synthesised legacy link id, or null for a real row. */
export function legacySettingsId(linkId: string): number | null {
  const s = str(linkId)
  if (s.indexOf(LEGACY_ID_PREFIX) !== 0) return null
  const n = Number(s.slice(LEGACY_ID_PREFIX.length))
  return Number.isFinite(n) && n > 0 ? n : null
}
/** True for any synthesised pre-migration row (family page or scheduler): nothing to count or upgrade in share_links. */
export const isLegacyLink = (linkId: string) => str(linkId).indexOf(LEGACY_ID_PREFIX) === 0
async function legacyFamilyLink(code: string): Promise<ShareLinkRow | null> {
  const fam = LEGACY_FAMILY[code]
  if (!fam) return null
  try {
    const { data, error } = await supabaseAdmin().from('share_settings').select('password').eq('id', fam.id).maybeSingle()
    if (error) return null
    const stored = data && (data as any).password ? str((data as any).password) : ''
    return normalizeRow({
      id: LEGACY_ID_PREFIX + fam.id, code, kind: fam.kind, title: fam.title, label: fam.title, audience: fam.audience, scope: fam.scope,
      passcode_hash: stored || null, passcode_hint: null, open: false, expires_at: null, revoked_at: null,
      created_by: null, created_at: new Date(0).toISOString(), last_used_at: null, uses: 0, notes: null,
    })
  } catch { return null }
}

/** One row by code, revoked or not (the gate decides what revoked means). Null for a bad code. */
export async function getLink(code: string): Promise<ShareLinkRow | null> {
  const c = str(code).trim().toLowerCase()
  if (!CODE_RE.test(c)) return null
  let migrated = true
  try {
    const { data, error } = await supabaseAdmin().from('share_links').select('*').eq('code', c).limit(1)
    const row = (data || [])[0]
    if (row) return normalizeRow(row)
    if (error || !(LEGACY_FAMILY[c] || SCHED_CODE.test(c))) return null
    // No row for a family / scheduler code. Only while the table still lacks migration 101's columns does a family code fall
    // back to share_settings; once migrated, a missing row is a missing row (revoked = row kept).
    const probe = await supabaseAdmin().from('share_links').select('passcode_hash').limit(1)
    migrated = !probe.error
  } catch { return null }
  if (migrated) return null
  return (await legacyFamilyLink(c)) || legacySchedulerLink(c)
}

/** Before migration 101: a scheduler code still lives in schedule_links. Read it as the row the
 *  migration will make (same code, same passcode, same view-only flag), so the crews keep working. */
async function legacySchedulerLink(code: string): Promise<ShareLinkRow | null> {
  if (!SCHED_CODE.test(code)) return null
  try {
    const { data, error } = await supabaseAdmin().from('schedule_links').select('*').eq('code', code).limit(1)
    const row = (data || [])[0] as any
    if (error || !row) return null
    const market = str(row.market) || 'All'
    const title = str(row.label) || market + ' team schedule'
    return normalizeRow({
      id: LEGACY_ID_PREFIX + 'sched', code, kind: 'scheduler', title, label: title, audience: 'crew',
      scope: { market, viewOnly: row.view_only === true }, passcode_hash: row.passcode ? str(row.passcode) : null, passcode_hint: null,
      open: !row.passcode, expires_at: null, revoked_at: row.revoked_at || null, created_by: row.created_by || null,
      created_at: row.created_at || new Date(0).toISOString(), last_used_at: null, uses: 0, notes: null,
    })
  } catch { return null }
}

// uses / last_used_at, at most once a minute per link per instance — a board polling every thirty
// seconds must not turn into a write per poll. Fire-and-forget: a failed count never blocks a page.
const touched: Map<string, number> = new Map()
export function touchLink(link: Pick<ShareLinkRow, 'id' | 'code'>): void {
  if (isLegacyLink(link.id)) return
  const last = touched.get(link.code) || 0
  const now = Date.now()
  if (now - last < 60 * 1000) return
  touched.set(link.code, now)
  if (touched.size > 500) { const first = touched.keys().next().value; if (first) touched.delete(first) }
  const run = async () => {
    const db = supabaseAdmin()
    const { data } = await db.from('share_links').select('uses').eq('id', link.id).limit(1)
    const uses = Number(((data || [])[0] as any)?.uses) || 0
    await db.from('share_links').update({ uses: uses + 1, last_used_at: new Date(now).toISOString() }).eq('id', link.id)
  }
  run().catch(() => undefined)
}

/** 8 characters from an alphabet with no 0/O/1/l/I — read aloud over the phone without a mix-up. */
export function generatePasscode(len = 8): string {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < len; i++) out += A[randomInt(0, A.length)]
  return out
}

export function newCode(): string { return randomBytes(8).toString('hex') }

const isHash = (stored: string) => /^s1\$[0-9a-f]+\$[0-9a-f]+$/i.test(String(stored || ''))

/**
 * NO PLAINTEXT AT REST. Migration 101 moved every old `passcode` (some scrypt, some legacy
 * plaintext) into passcode_hash; SQL cannot scrypt, so the first hub load does it here — it has
 * the cleartext in hand, hashes it, and records the two-character hint. The passcode itself keeps
 * working; only the way it is stored changes. Idempotent and cheap once nothing is left to do.
 */
export async function hashLegacyPasscodes(): Promise<number> {
  const db = supabaseAdmin()
  const { data } = await db.from('share_links').select('id, passcode_hash').not('passcode_hash', 'is', null).limit(500)
  let n = 0
  for (const r of (data || []) as any[]) {
    const v = str(r.passcode_hash)
    if (!v || isHash(v)) continue
    const { error } = await db.from('share_links').update({ passcode_hash: hashPassword(v), passcode_hint: hintOf(v) }).eq('id', r.id)
    if (!error) n++
  }
  return n
}
