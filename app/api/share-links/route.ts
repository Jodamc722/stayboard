// SHARE LINKS HUB — the team side. ONE directory of every share link (Jon, 2026-08-20), and since
// 2026-09-18 ONE MODEL: every row in share_links has a kind, an audience, a scope and its own
// passcode (scrypt hash; the cleartext is shown ONCE, at create or rotate, and never stored).
//
//   GET                       → every row (live, expiring, expired, revoked in the last 30 days),
//                               the generated links minted by other tabs, and the pick-lists.
//   GET ?lite=1               → just the rows (the Users & admin card).
//   POST {action:'create'}    → a new row; answers { link, passcode } — the only time the passcode is sent.
//   POST {action:'update'}    → title / audience / scope / expiry / notes.
//   POST {action:'rotate'}    → a fresh passcode (given or generated); old cookies die at once.
//   POST {action:'revoke'}    → off, for one id or ids[].
//   POST {action:'extend'}    → a new expires_at (or null = never) for one id or ids[].
//   POST {action:'restore'}   → un-revoke.
//
// requireLevel('share-links') gates everything: these links can carry revenue and guest data, so
// the tab's permission decides who mints them. Dollars on a link need canSeeMoney on the maker.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { MARKETS } from '@/lib/segments'
import { requireLevel, canSeeMoney } from '@/lib/access'
import { storablePasscode } from '@/lib/passcode-gate'
import { LINK_KINDS, AUDIENCES, FIXED_CODE_KINDS, VENDOR_LABEL, describeLink, linkStatus, pathFor, hintOf, type LinkScope } from '@/lib/share-links'
import { generatePasscode, newCode, hashLegacyPasscodes, normalizeRow } from '@/lib/share-links-server'

export const dynamic = 'force-dynamic'

const str = (v: any) => typeof v === 'string' ? v : (v == null ? '' : String(v))
const isKind = (k: string) => (LINK_KINDS as readonly string[]).indexOf(k) >= 0
const isAudience = (a: string) => (AUDIENCES as readonly string[]).indexOf(a) >= 0

// Every section a custom link / field board / parking board can carry. Keep in lockstep with the
// builder UI, /api/share/[code] and lib/field-board BOARD_SECTIONS.
const REPORT_SECTIONS = ['reservations', 'revenue', 'marketing', 'cleaning', 'verification', 'notes', 'team', 'team_maint', 'audience', 'contacts'] as const
const BOARD_SECTIONS = ['today', 'units', 'crew', 'cleans', 'verify', 'vacant', 'work', 'issues', 'requests', 'add'] as const
const SECTION_KEYS: readonly string[] = [...REPORT_SECTIONS, 'parking', ...BOARD_SECTIONS]
const SCOPE_TYPES = ['portfolio', 'market', 'building', 'owner', 'listing']

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
function expiresFrom(v: any): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const s = str(v)
  const d = ISO_DAY.test(s) ? new Date(s + 'T23:59:59-04:00') : new Date(s)
  return isNaN(d.getTime()) ? undefined : d.toISOString()
}

/** Validate + shape a scope for a kind. Sections are restricted to the kind's own set. */
function cleanScope(kind: string, raw: any): { scope: LinkScope; error?: string } {
  const s: any = raw && typeof raw === 'object' ? raw : {}
  const out: LinkScope = {}
  const list = (v: any, n = 100) => (Array.isArray(v) ? v : []).map(str).map(x => x.trim()).filter(Boolean).slice(0, n)
  if (kind === 'vendor-board') {
    const vendor = str(s.vendor).toLowerCase()
    if (!VENDOR_LABEL[vendor]) return { scope: out, error: 'Pick which vendor board: ' + Object.keys(VENDOR_LABEL).join(', ') + '.' }
    out.vendor = vendor
    const b = list(s.buildings, 20); if (b.length) out.buildings = b
    return { scope: out }
  }
  if (kind === 'scheduler') {
    const m = str(s.market)
    if (MARKETS.indexOf(m as any) < 0 && m !== 'All') return { scope: out, error: 'market must be Miami, Broward, North or All' }
    out.market = m; out.viewOnly = s.viewOnly === true
    return { scope: out }
  }
  if (kind === 'day-sheet') {
    const m = str(s.market)
    if (m && m !== 'All') { if (MARKETS.indexOf(m as any) < 0) return { scope: out, error: 'market must be Miami, Broward, North or All' }; out.market = m }
    return { scope: out }
  }
  if (kind === 'marketing') {
    if (ISO_DAY.test(str(s.from))) out.from = str(s.from)
    if (ISO_DAY.test(str(s.to))) out.to = str(s.to)
    if (out.from && out.to && out.from > out.to) { const t = out.from; out.from = out.to; out.to = t }
    if (s.showMoney === false) out.showMoney = false
    return { scope: out }
  }
  if (kind === 'field-board' || kind === 'parking' || kind === 'custom-page') {
    const st = SCOPE_TYPES.indexOf(str(s.scopeType)) >= 0 ? str(s.scopeType) : 'portfolio'
    const ids = list(s.scopeIds)
    if (st !== 'portfolio' && !ids.length) return { scope: out, error: 'Pick at least one ' + st + '.' }
    out.scopeType = st as any; out.scopeIds = ids
    const allowed: readonly string[] = kind === 'parking' ? ['parking'] : kind === 'field-board' ? BOARD_SECTIONS : REPORT_SECTIONS
    const sec: Record<string, boolean> = {}
    for (const k of SECTION_KEYS) sec[k] = allowed.indexOf(k) >= 0 && s.sections?.[k] === true
    if (kind === 'parking') sec.parking = true
    if (!Object.values(sec).some(Boolean)) return { scope: out, error: 'Turn on at least one section — an empty link shows nothing.' }
    out.sections = sec
    out.showMoney = s.showMoney === true
    out.guestNames = s.guestNames === true
    const wd = Number(s.windowDays)
    out.windowDays = Number.isFinite(wd) && wd >= 7 && wd <= 120 ? wd : (kind === 'parking' ? 45 : 30)
    return { scope: out }
  }
  return { scope: out }
}

/** The legacy columns the custom report / field board / parking builders still read. */
function legacyColumns(kind: string, scope: LinkScope): Record<string, any> {
  if (kind !== 'field-board' && kind !== 'parking' && kind !== 'custom-page') return {}
  return {
    scope_type: scope.scopeType || 'portfolio', scope_ids: scope.scopeIds || [], sections: scope.sections || {},
    show_money: scope.showMoney === true, guest_names: scope.guestNames === true, window_days: scope.windowDays || 30,
  }
}

function shape(row: any, names: { owners: Record<string, string>; listings: Record<string, string> }) {
  const l = normalizeRow(row)
  return {
    id: l.id, code: l.code, kind: l.kind, title: l.title || l.label || '', audience: l.audience, scope: l.scope,
    hint: l.passcode_hint, hasPasscode: !!l.passcode_hash, open: l.open,
    expires_at: l.expires_at, revoked_at: l.revoked_at, created_by: l.created_by, created_at: l.created_at,
    last_used_at: l.last_used_at, uses: l.uses, notes: l.notes,
    status: linkStatus(l), path: pathFor(l.kind, l.code), what: describeLink(l, names),
  }
}

export async function GET(req: NextRequest) {
  const gate = await requireLevel('share-links', 'view')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const lite = req.nextUrl.searchParams.get('lite') === '1'
  // NO PLAINTEXT AT REST: anything migration 101 carried over as cleartext is hashed on first load.
  try { await hashLegacyPasscodes() } catch { /* next load tries again */ }
  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  const [{ data: live }, { data: dead }, { data: owners }, { data: listings }] = await Promise.all([
    db.from('share_links').select('*').is('revoked_at', null).order('created_at', { ascending: false }).limit(400),
    lite ? Promise.resolve({ data: [] } as any) : db.from('share_links').select('*').not('revoked_at', 'is', null).gte('revoked_at', since).order('revoked_at', { ascending: false }).limit(100),
    lite ? Promise.resolve({ data: [] } as any) : db.from('guesty_owners').select('id, full_name, listing_ids').limit(2000),
    db.from('guesty_listings').select('id, nickname, title, building, status').limit(2000),
  ])
  const names = { owners: {} as Record<string, string>, listings: {} as Record<string, string> }
  for (const o of (owners || []) as any[]) names.owners[str(o.id)] = str(o.full_name)
  for (const l of (listings || []) as any[]) names.listings[str(l.id)] = str(l.nickname || l.title)
  const links = ((live || []) as any[]).concat((dead || []) as any[]).map(r => shape(r, names))
  if (lite) return NextResponse.json({ ok: true, links })

  // LOCKED OUT: five wrong passcodes in fifteen minutes on a link (any address) — worth a pill.
  let lockedCodes: string[] = []
  try {
    const since15 = new Date(Date.now() - 15 * 60000).toISOString()
    const { data: den } = await db.from('parking_access_log').select('code').eq('action', 'denied').gte('created_at', since15).like('code', 'link:%').limit(2000)
    const n: Record<string, number> = {}
    for (const d of (den || []) as any[]) { const c = str(d.code).slice(5); n[c] = (n[c] || 0) + 1 }
    lockedCodes = Object.keys(n).filter(c => n[c] >= 5)
  } catch { lockedCodes = [] }

  // GENERATED links — one per record, minted by their own tabs. Best-effort: a missing table must
  // never take the hub down, so each of these degrades to an empty group. They are read-only here
  // (no passcode of their own; the unguessable code is the key) and shown in the same row shape.
  const [{ data: reports }, { data: books }, { data: guideRows }, { data: counts }] = await Promise.all([
    db.from('owner_reports').select('code, title, scope_label, period_start, period_end, status, updated_at').order('updated_at', { ascending: false }).limit(100),
    db.from('guidebooks').select('id, listing_name, title, status, updated_at').order('updated_at', { ascending: false }).limit(100),
    db.from('app_settings').select('key').like('key', 'guide:%').limit(50),
    db.from('inventory_count_links').select('code, label, created_at, revoked_at').is('revoked_at', null).order('created_at', { ascending: false }).limit(50),
  ])
  const gen = (kind: string, code: string, title: string, sub: string, audience: string, status: string, updated: string) => ({
    id: kind + ':' + code, code, kind, title, audience, scope: {}, hint: null, hasPasscode: false, open: true,
    expires_at: null, revoked_at: null, created_by: null, created_at: updated, last_used_at: null, uses: 0, notes: sub || null,
    status: status && status !== 'published' && status !== 'live' ? status : 'live', path: pathFor(kind, code), what: sub || describeLink({ kind, scope: {}, audience }),
    generated: true,
  })
  const generated = ([] as any[]).concat(
    ((reports || []) as any[]).map(r => gen('owner-report', str(r.code), str(r.title) || (str(r.scope_label) + ' — Owner Review'), [str(r.scope_label), str(r.period_start).slice(0, 7)].filter(Boolean).join(' · '), 'owner', str(r.status), str(r.updated_at))),
    ((books || []) as any[]).map(b => gen('guidebook', str(b.id), str(b.listing_name) || str(b.title) || 'Guidebook', str(b.title), 'guest', str(b.status), str(b.updated_at))),
    ((guideRows || []) as any[]).map(g => str(g.key).replace(/^guide:/, '')).filter(Boolean).map(slug => gen('guide', slug, slug, 'guest guide page', 'guest', '', '')),
    ((counts || []) as any[]).map(c => gen('count', str(c.code), str(c.label) || 'Inventory count', 'inventory count sheet', 'crew', '', str(c.created_at))),
  )

  const active = ((listings || []) as any[]).filter(l => str(l.status).toLowerCase() !== 'inactive')
  const buildings = Array.from(new Set(active.map(l => str(l.building)).filter(Boolean))).sort()
  return NextResponse.json({
    ok: true,
    links, generated, lockedCodes,
    canSeeMoney: canSeeMoney(gate.access),
    meta: {
      buildings, markets: MARKETS.slice(),
      vendors: Object.keys(VENDOR_LABEL).map(k => ({ id: k, name: VENDOR_LABEL[k] })),
      owners: ((owners || []) as any[]).map(o => ({ id: str(o.id), name: str(o.full_name), units: Array.isArray(o.listing_ids) ? o.listing_ids.length : 0 })),
      listings: active.map(l => ({ id: str(l.id), name: str(l.nickname || l.title), building: str(l.building) })),
    },
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('share-links', 'edit')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const action = str(body.action || 'create')
  const now = new Date().toISOString()
  const ids: string[] = (Array.isArray(body.ids) ? body.ids : [body.id]).map(str).filter(Boolean).slice(0, 200)
  const names = { owners: {}, listings: {} }

  if (action === 'revoke' || action === 'restore' || action === 'extend') {
    if (!ids.length) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    const patch: any = { updated_at: now }
    if (action === 'revoke') patch.revoked_at = now
    if (action === 'restore') patch.revoked_at = null
    if (action === 'extend') {
      const exp = expiresFrom(body.expiresAt)
      if (exp === undefined) return NextResponse.json({ ok: false, error: 'expiresAt must be a date, or null for never.' }, { status: 400 })
      patch.expires_at = exp
    }
    const { error } = await db.from('share_links').update(patch).in('id', ids)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, count: ids.length })
  }

  if (action === 'rotate') {
    const id = ids[0]
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    const { data: cur } = await db.from('share_links').select('*').eq('id', id).limit(1)
    const row = (cur || [])[0] as any
    if (!row) return NextResponse.json({ ok: false, error: 'Unknown link.' }, { status: 404 })
    const given = str(body.passcode).trim()
    if (given && given.length < 6) return NextResponse.json({ ok: false, error: 'A passcode needs at least 6 characters.' }, { status: 400 })
    if (row.kind === 'parking' && given && given.length < 8) return NextResponse.json({ ok: false, error: 'A parking passcode needs at least 8 characters — the garage is outside the company.' }, { status: 400 })
    const pw = given || generatePasscode()
    const { data, error } = await db.from('share_links').update({ passcode_hash: storablePasscode(pw), passcode_hint: hintOf(pw), open: false, updated_at: now }).eq('id', id).select('*').limit(1)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    // THE ONE TIME THE PASSCODE LEAVES THE SERVER. It is not stored; the hub shows it once.
    return NextResponse.json({ ok: true, link: shape((data || [])[0], names), passcode: pw })
  }

  if (action === 'update') {
    const id = ids[0]
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    const { data: cur } = await db.from('share_links').select('*').eq('id', id).limit(1)
    const row = (cur || [])[0] as any
    if (!row) return NextResponse.json({ ok: false, error: 'Unknown link.' }, { status: 404 })
    const kind = str(row.kind)
    const patch: any = { updated_at: now }
    if (body.title !== undefined) { patch.title = str(body.title).slice(0, 120) || null; patch.label = patch.title }
    if (body.audience !== undefined && isAudience(str(body.audience))) patch.audience = str(body.audience)
    if (body.notes !== undefined) patch.notes = str(body.notes).slice(0, 600) || null
    const exp = expiresFrom(body.expiresAt)
    if (exp !== undefined) patch.expires_at = exp
    if (body.scope !== undefined) {
      // A scheduler's view-only-ness is fixed at create (migration 084): a saved link is a promise.
      const merged = kind === 'scheduler' ? { ...body.scope, viewOnly: row.scope?.viewOnly === true } : body.scope
      const c = cleanScope(kind, merged)
      if (c.error) return NextResponse.json({ ok: false, error: c.error }, { status: 400 })
      // Money on a link needs money access on the editor; otherwise leave the row's switch alone.
      if (c.scope.showMoney === true && !canSeeMoney(gate.access)) c.scope.showMoney = row.scope?.showMoney === true
      if (kind === 'marketing' && c.scope.showMoney === undefined && !canSeeMoney(gate.access) && row.scope?.showMoney === false) c.scope.showMoney = false
      patch.scope = c.scope
      Object.assign(patch, legacyColumns(kind, c.scope))
      if (!canSeeMoney(gate.access) && patch.show_money !== undefined) patch.show_money = row.show_money === true
    }
    const { data, error } = await db.from('share_links').update(patch).eq('id', id).select('*').limit(1)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, link: shape((data || [])[0], names) })
  }

  // ── create ──
  const kind = str(body.kind)
  if (!isKind(kind)) return NextResponse.json({ ok: false, error: 'Unknown link kind.' }, { status: 400 })
  if (FIXED_CODE_KINDS.indexOf(kind) >= 0 || ['owner-report', 'guidebook', 'guide', 'count', 'salato-desk'].indexOf(kind) >= 0) {
    return NextResponse.json({ ok: false, error: 'That page has one fixed link — edit or rotate the existing row instead of making another.' }, { status: 400 })
  }
  const audience = isAudience(str(body.audience)) ? str(body.audience) : (kind === 'vendor-board' ? 'vendor' : kind === 'scheduler' || kind === 'field-board' ? 'crew' : 'internal')
  const c = cleanScope(kind, body.scope)
  if (c.error) return NextResponse.json({ ok: false, error: c.error }, { status: 400 })
  if (c.scope.showMoney === true && !canSeeMoney(gate.access)) c.scope.showMoney = false
  const exp = expiresFrom(body.expiresAt)
  if (exp === undefined && body.expiresAt !== undefined) return NextResponse.json({ ok: false, error: 'expiresAt must be a date.' }, { status: 400 })

  // PASSCODE: given, generated, or (custom kinds only) none — an OPEN link whose code is the key.
  // Parking never opens without one, and neither does anything that used to sit on a family password.
  const given = str(body.passcode).trim()
  const wantsOpen = body.open === true && !given
  if (given && given.length < 6) return NextResponse.json({ ok: false, error: 'A passcode needs at least 6 characters.' }, { status: 400 })
  if (kind === 'parking' && (wantsOpen || (given && given.length < 8))) return NextResponse.json({ ok: false, error: 'A parking link needs its own passcode, at least 8 characters — the garage is outside the company.' }, { status: 400 })
  if (wantsOpen && ['vendor-board', 'day-sheet', 'delivery', 'orders-live', 'marketing', 'owner-audit', 'botanica'].indexOf(kind) >= 0) {
    return NextResponse.json({ ok: false, error: 'This kind of link always has a passcode.' }, { status: 400 })
  }
  if (c.scope.sections?.contacts && wantsOpen) return NextResponse.json({ ok: false, error: 'A link carrying the contact list needs a passcode.' }, { status: 400 })
  const pw = wantsOpen ? '' : (given || generatePasscode())
  const title = str(body.title).slice(0, 120) || (kind === 'vendor-board' ? (VENDOR_LABEL[String(c.scope.vendor)] + ' — cleaning board') : kind === 'scheduler' ? (c.scope.market + (c.scope.viewOnly ? ' schedule (view only)' : ' team schedule')) : 'Shared link')
  const row: any = {
    code: kind === 'scheduler' ? newCode().slice(0, 12) : newCode(),
    kind, title, label: title, audience, scope: c.scope,
    passcode_hash: pw ? storablePasscode(pw) : null, passcode_hint: pw ? hintOf(pw) : null, open: !pw,
    expires_at: exp || null, notes: str(body.notes).slice(0, 600) || null,
    created_by: gate.access.email || null, updated_at: now,
    ...legacyColumns(kind, c.scope),
  }
  const { data, error } = await db.from('share_links').insert(row).select('*').limit(1)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, link: shape((data || [])[0], names), passcode: pw || null })
}
