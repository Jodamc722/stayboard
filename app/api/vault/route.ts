// VAULT — list, create, update, soft-delete.
//
// What this endpoint will NEVER return: a decrypted secret. Revealing one is a separate, logged
// request (see ./reveal). The list is safe to render, cache in a component, and screenshot.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  ITEMS, GRANTS, COLLECTIONS, accessFor, grantedItemIds, collectionsFor, logAccess, publicItem,
  encryptSecret, maskHint, vaultKeyReady, isMissingTable, type VaultKind, type VaultLevel,
} from '@/lib/vault'
import { snapshotVault } from '@/lib/vault-backup'
import { currentVaultCode } from '@/lib/shareAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const str = (v: any, max = 2000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max)
const trimmed = (v: any, max = 2000) => str(v, max).trim()
const ipOf = (req: NextRequest) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const me = String(access.email || '')
  const owner = isSuperadmin(access.email)

  try {
    const db = supabaseAdmin()
    const sp = req.nextUrl.searchParams
    const q = trimmed(sp.get('q'), 80).toLowerCase()
    const category = trimmed(sp.get('category'), 40)

    let sel = db.from(ITEMS).select('*').is('deleted_at', null).order('updated_at', { ascending: false }).limit(500)
    if (category) sel = sel.eq('category', category)
    const { data, error } = await sel
    if (error) {
      return NextResponse.json({
        ok: false, needsMigration: isMissingTable(error.message), error: error.message, items: [],
      })
    }

    // DENY BY DEFAULT. Filter in the app, not the query, so the rule lives in one readable place:
    // yours, or named on it, or in a vault you belong to, or you are the owner of the workspace.
    const mine = new Set(owner ? [] : await grantedItemIds(me))
    const myCols = await collectionsFor(me, access.accessRole, owner)
    const lower = (s: any) => String(s || '').trim().toLowerCase()
    const viaCol = (r: any): VaultLevel | null =>
      r.collection_id ? (myCols.get(String(r.collection_id)) || null) : null
    let rows = ((data || []) as any[]).filter(r =>
      owner || lower(r.owner_email) === lower(me) || mine.has(String(r.id)) || !!viaCol(r))

    if (q) {
      rows = rows.filter(r => (
        str(r.title) + ' ' + str(r.description) + ' ' + str(r.username) + ' ' +
        str(r.doc_name) + ' ' + str(r.property_id) + ' ' + str(r.unit_no) + ' ' +
        (Array.isArray(r.tags) ? r.tags.join(' ') : '')
      ).toLowerCase().includes(q))
    }

    // Widest door wins, same order as accessFor(): owner, then the named grant, then the vault.
    const items = rows.map(r => {
      let level: VaultLevel | null = null
      if (owner || lower(r.owner_email) === lower(me)) level = 'manage'
      else {
        if (mine.has(String(r.id))) level = 'view'
        const c = viaCol(r)
        if (c === 'manage') level = 'manage'
        else if (c === 'view' && !level) level = 'view'
      }
      return publicItem(r, level)
    })

    // Grants are shown only to people who can manage the item, so the card can list who else sees it.
    const manageIds = items.filter(i => i.level === 'manage').map(i => i.id)
    let grants: any[] = []
    if (manageIds.length) {
      const g = await db.from(GRANTS).select('item_id, email, level').in('item_id', manageIds)
      grants = (g.data || []) as any[]
    }

    let collectionList: any[] = []
    try {
      const c = await db.from(COLLECTIONS).select('id, name, slug, color, level, roles').is('deleted_at', null).order('name')
      collectionList = ((c.data || []) as any[]).map(x => ({ ...x, myLevel: myCols.get(String(x.id)) || null }))
    } catch { /* pre-052: no vaults yet, and the page says so */ }

    return NextResponse.json({
      ok: true, items, grants, me, isOwner: owner, isAdmin: access.role === 'admin',
      collections: collectionList,
      keyReady: vaultKeyReady(),
      // Whether the second lock exists yet. Without it nothing can be revealed — say so up front.
      codeSet: !!(await currentVaultCode()),
      counts: {
        total: items.length,
        expiring: items.filter(i => i.expires_on && daysUntil(i.expires_on) !== null && daysUntil(i.expires_on)! <= 30).length,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

function daysUntil(d: string): number | null {
  const t = Date.parse(String(d) + 'T12:00:00Z')
  if (!Number.isFinite(t)) return null
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  return Math.round((t - Date.parse(today + 'T12:00:00Z')) / 86400000)
}

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const me = String(access.email || '')

  const b = await req.json().catch(() => ({} as any))
  const kind = (['secret', 'file', 'note'].includes(b.kind) ? b.kind : 'secret') as VaultKind
  const title = trimmed(b.title, 160)
  if (!title) return NextResponse.json({ ok: false, error: 'Give it a name you would recognise in a year.' }, { status: 400 })

  const secret = typeof b.secret === 'string' ? b.secret : ''
  if (kind === 'secret' && !secret) return NextResponse.json({ ok: false, error: 'Nothing to store — type the code or password.' }, { status: 400 })
  if (secret && !vaultKeyReady()) {
    return NextResponse.json({ ok: false, error: 'VAULT_KEY is not set on the server, so secrets cannot be stored yet.' }, { status: 503 })
  }

  try {
    const row: any = {
      kind,
      category: trimmed(b.category, 40) || 'company',
      title,
      description: trimmed(b.description, 4000) || null,
      property_id: trimmed(b.property_id, 60) || null,
      unit_no: trimmed(b.unit_no, 40) || null,
      reservation_id: trimmed(b.reservation_id, 60) || null,
      username: trimmed(b.username, 200) || null,
      url: trimmed(b.url, 500) || null,
      expires_on: trimmed(b.expires_on, 10) || null,
      tags: Array.isArray(b.tags) ? b.tags.map((t: any) => trimmed(t, 40)).filter(Boolean).slice(0, 12) : [],
      collection_id: trimmed(b.collection_id, 60) || null,
      owner_email: me,
      created_by: me,
    }
    if (secret) {
      row.secret_cipher = encryptSecret(secret)
      row.secret_hint = trimmed(b.secret_hint, 60) || maskHint(secret)
    }

    const { data, error } = await supabaseAdmin().from(ITEMS).insert(row).select('*').single()
    if (error) {
      return NextResponse.json({ ok: false, needsMigration: isMissingTable(error.message), error: error.message }, { status: 500 })
    }
    await logAccess({ itemId: (data as any).id, email: me, action: 'create', detail: kind + ': ' + title, ip: ipOf(req) })
    await snapshotVault('create', me)
    return NextResponse.json({ ok: true, item: publicItem(data, 'manage') })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const me = String(access.email || '')

  const b = await req.json().catch(() => ({} as any))
  const id = trimmed(b.id, 60)
  if (!id) return NextResponse.json({ ok: false, error: 'Which item?' }, { status: 400 })

  try {
    const db = supabaseAdmin()
    const { data: item } = await db.from(ITEMS).select('id, owner_email, collection_id, title').eq('id', id).is('deleted_at', null).maybeSingle()
    if (!item) return NextResponse.json({ ok: false, error: 'That item no longer exists.' }, { status: 404 })

    const level = await accessFor(item as any, me, isSuperadmin(access.email), { accessRole: access.accessRole })
    if (level !== 'manage') {
      await logAccess({ itemId: id, email: me, action: 'denied', detail: 'edit', ip: ipOf(req) })
      return NextResponse.json({ ok: false, error: 'You cannot edit this item.' }, { status: 403 })
    }

    const patch: any = { updated_at: new Date().toISOString() }
    if (b.collection_id !== undefined) patch.collection_id = trimmed(b.collection_id, 60) || null
    for (const f of ['title', 'description', 'category', 'property_id', 'unit_no', 'reservation_id', 'username', 'url', 'expires_on'] as const) {
      if (b[f] !== undefined) patch[f] = trimmed(b[f], 4000) || null
    }
    if (Array.isArray(b.tags)) patch.tags = b.tags.map((t: any) => trimmed(t, 40)).filter(Boolean).slice(0, 12)
    if (typeof b.secret === 'string' && b.secret) {
      if (!vaultKeyReady()) return NextResponse.json({ ok: false, error: 'VAULT_KEY is not set on the server.' }, { status: 503 })
      patch.secret_cipher = encryptSecret(b.secret)
      patch.secret_hint = trimmed(b.secret_hint, 60) || maskHint(b.secret)
    }

    const { data, error } = await db.from(ITEMS).update(patch).eq('id', id).select('*').single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    // The DETAIL says which fields moved, never what they moved to.
    await logAccess({ itemId: id, email: me, action: 'update', detail: Object.keys(patch).filter(k => k !== 'updated_at').join(', '), ip: ipOf(req) })
    await snapshotVault('update', me)
    return NextResponse.json({ ok: true, item: publicItem(data, 'manage') })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const me = String(access.email || '')
  const id = trimmed(req.nextUrl.searchParams.get('id'), 60)
  if (!id) return NextResponse.json({ ok: false, error: 'Which item?' }, { status: 400 })

  try {
    const db = supabaseAdmin()
    const { data: item } = await db.from(ITEMS).select('id, owner_email, collection_id, title').eq('id', id).is('deleted_at', null).maybeSingle()
    if (!item) return NextResponse.json({ ok: false, error: 'That item no longer exists.' }, { status: 404 })
    const level = await accessFor(item as any, me, isSuperadmin(access.email), { accessRole: access.accessRole })
    if (level !== 'manage') {
      await logAccess({ itemId: id, email: me, action: 'denied', detail: 'delete', ip: ipOf(req) })
      return NextResponse.json({ ok: false, error: 'You cannot delete this item.' }, { status: 403 })
    }
    // SOFT delete. The stored file and the audit trail both survive, so "who deleted the insurance
    // certificate the week before the claim" stays an answerable question.
    const { error } = await db.from(ITEMS).update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    await logAccess({ itemId: id, email: me, action: 'delete', detail: str((item as any).title, 120), ip: ipOf(req) })
    await snapshotVault('delete', me)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
