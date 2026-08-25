// VAULTS WITHIN THE VAULT — create them, put people in them, move items between them.
//
// A collection is a named vault: "Managers", "Front desk", or one with a single member, which is
// what a private vault actually is. Membership is people AND app_roles keys, and the two add up.
//
// Creating and editing a vault is an admin act — it is the widest lever in here, because moving
// one item into "Managers" hands it to everyone that role will ever contain. Reading the list is
// open to any signed-in user, because you have to see the vaults you are in to use them.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  ITEMS, COLLECTIONS, COLLECTION_MEMBERS, collectionsFor, logAccess, isMissingTable,
} from '@/lib/vault'
import { snapshotVault } from '@/lib/vault-backup'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const str = (v: any, max = 300) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max)
const trimmed = (v: any, max = 300) => str(v, max).trim()
const email = (v: any) => trimmed(v, 200).toLowerCase()
const ipOf = (req: NextRequest) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'vault'

/** GET — the vaults, with their members, and which ones I can open. */
export async function GET() {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const me = String(access.email || '')
  const owner = isSuperadmin(access.email)
  const isAdmin = access.role === 'admin'

  try {
    const db = supabaseAdmin()
    const { data, error } = await db.from(COLLECTIONS).select('*').is('deleted_at', null).order('name')
    if (error) {
      return NextResponse.json({ ok: false, needsMigration: isMissingTable(error.message), error: error.message, collections: [] })
    }
    const mine = await collectionsFor(me, access.accessRole, owner)

    // Member lists are only shown to people who can manage vaults — who else can open a vault is
    // itself worth protecting.
    let members: any[] = []
    if (isAdmin) {
      const m = await db.from(COLLECTION_MEMBERS).select('collection_id, email, created_at')
      members = (m.data || []) as any[]
    }
    // How many items sit in each vault, so an empty one is obvious before you trust it.
    const { data: counts } = await db.from(ITEMS).select('collection_id').is('deleted_at', null).limit(5000)
    const tally: Record<string, number> = {}
    for (const r of (counts || []) as any[]) {
      const k = r.collection_id ? String(r.collection_id) : 'none'
      tally[k] = (tally[k] || 0) + 1
    }

    const collections = ((data || []) as any[]).map(c => ({
      id: c.id, name: c.name, slug: c.slug, description: c.description,
      roles: Array.isArray(c.roles) ? c.roles : [], level: c.level, color: c.color,
      items: tally[String(c.id)] || 0,
      myLevel: mine.get(String(c.id)) || null,
      members: isAdmin ? members.filter(m => String(m.collection_id) === String(c.id)).map(m => m.email) : undefined,
    }))
    return NextResponse.json({ ok: true, collections, privateCount: tally['none'] || 0, isAdmin, canManage: isAdmin })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

/** POST — create a vault, add/remove a member, or move items into one. */
export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const me = String(access.email || '')
  const b = await req.json().catch(() => ({} as any))
  const action = trimmed(b.action, 20)

  try {
    const db = supabaseAdmin()

    // ---- MOVE items between vaults. Needs manage on every item being moved, checked one by one,
    // because moving something into a shared vault is a disclosure.
    if (action === 'move') {
      const ids = Array.isArray(b.ids) ? b.ids.map((x: any) => trimmed(x, 60)).filter(Boolean).slice(0, 500) : []
      const target = b.collection_id === null || b.collection_id === '' ? null : trimmed(b.collection_id, 60)
      if (!ids.length) return NextResponse.json({ ok: false, error: 'Nothing selected.' }, { status: 400 })

      let name = 'Private (owner only)'
      if (target) {
        const { data: col } = await db.from(COLLECTIONS).select('id, name').eq('id', target).is('deleted_at', null).maybeSingle()
        if (!col) return NextResponse.json({ ok: false, error: 'That vault no longer exists.' }, { status: 404 })
        name = String((col as any).name)
      }

      const { data: rows } = await db.from(ITEMS).select('id, owner_email, collection_id, title').in('id', ids).is('deleted_at', null)
      const mineCols = await collectionsFor(me, access.accessRole, isSuperadmin(access.email))
      const allowed: string[] = []
      const refused: string[] = []
      for (const r of (rows || []) as any[]) {
        const owner = isSuperadmin(access.email) || String(r.owner_email || '').toLowerCase() === me.toLowerCase()
        const viaCol = r.collection_id ? mineCols.get(String(r.collection_id)) === 'manage' : false
        if (owner || viaCol) allowed.push(String(r.id)); else refused.push(String(r.title || r.id))
      }
      if (!allowed.length) {
        await logAccess({ itemId: null, email: me, action: 'denied', detail: 'move ' + ids.length + ' item(s)', ip: ipOf(req) })
        return NextResponse.json({ ok: false, error: 'You cannot move any of those.' }, { status: 403 })
      }

      const { error } = await db.from(ITEMS)
        .update({ collection_id: target, updated_at: new Date().toISOString() }).in('id', allowed)
      if (error) return NextResponse.json({ ok: false, needsMigration: isMissingTable(error.message), error: error.message }, { status: 500 })

      await logAccess({ itemId: null, email: me, action: 'move', detail: allowed.length + ' item(s) → ' + name, ip: ipOf(req) })
      await snapshotVault('move', me)
      return NextResponse.json({ ok: true, moved: allowed.length, refused })
    }

    // Everything below changes who can see what, so: admins only.
    if (access.role !== 'admin') {
      return NextResponse.json({ ok: false, error: 'Only an admin can create or change a vault.' }, { status: 403 })
    }

    // ---- ADD / REMOVE a person.
    if (action === 'add-member' || action === 'remove-member') {
      const id = trimmed(b.collection_id, 60)
      const who = email(b.email)
      if (!id) return NextResponse.json({ ok: false, error: 'Which vault?' }, { status: 400 })
      if (!looksLikeEmail(who)) return NextResponse.json({ ok: false, error: 'That does not look like an email address.' }, { status: 400 })
      const { data: col } = await db.from(COLLECTIONS).select('id, name').eq('id', id).is('deleted_at', null).maybeSingle()
      if (!col) return NextResponse.json({ ok: false, error: 'That vault no longer exists.' }, { status: 404 })

      if (action === 'add-member') {
        const { error } = await db.from(COLLECTION_MEMBERS).insert({ collection_id: id, email: who, added_by: me })
        // A duplicate is a no-op, not a failure — the person is already in, which is the desired end state.
        if (error && !/duplicate|unique/i.test(error.message || '')) {
          return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
        }
        await logAccess({ itemId: null, email: me, action: 'grant', detail: who + ' → vault ' + (col as any).name, ip: ipOf(req) })
      } else {
        const { error } = await db.from(COLLECTION_MEMBERS).delete().eq('collection_id', id).ilike('email', who)
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
        await logAccess({ itemId: null, email: me, action: 'revoke', detail: who + ' ✕ vault ' + (col as any).name, ip: ipOf(req) })
      }
      return NextResponse.json({ ok: true })
    }

    // ---- CREATE / UPDATE a vault.
    const name = trimmed(b.name, 60)
    const id = trimmed(b.id, 60)
    if (!name && !id) return NextResponse.json({ ok: false, error: 'Give the vault a name.' }, { status: 400 })

    const patch: any = { updated_at: new Date().toISOString() }
    if (name) { patch.name = name; if (!id) patch.slug = slugify(name) }
    if (b.description !== undefined) patch.description = trimmed(b.description, 500) || null
    if (b.color !== undefined) patch.color = trimmed(b.color, 20) || null
    if (b.level !== undefined) patch.level = b.level === 'manage' ? 'manage' : 'view'
    if (Array.isArray(b.roles)) patch.roles = b.roles.map((r: any) => trimmed(r, 40).toLowerCase()).filter(Boolean).slice(0, 12)

    if (id) {
      const { data, error } = await db.from(COLLECTIONS).update(patch).eq('id', id).select('*').single()
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      await logAccess({ itemId: null, email: me, action: 'update', detail: 'vault ' + name, ip: ipOf(req) })
      return NextResponse.json({ ok: true, collection: data })
    }

    patch.created_by = me
    const { data, error } = await db.from(COLLECTIONS).insert(patch).select('*').single()
    if (error) return NextResponse.json({ ok: false, needsMigration: isMissingTable(error.message), error: error.message }, { status: 500 })
    await logAccess({ itemId: null, email: me, action: 'create', detail: 'vault ' + name, ip: ipOf(req) })
    return NextResponse.json({ ok: true, collection: data })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

/** DELETE ?id= — retire a vault. Its items fall back to owner-only; nothing is ever deleted. */
export async function DELETE(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ ok: false, error: 'Only an admin can delete a vault.' }, { status: 403 })
  const me = String(access.email || '')
  const id = trimmed(req.nextUrl.searchParams.get('id'), 60)
  if (!id) return NextResponse.json({ ok: false, error: 'Which vault?' }, { status: 400 })

  try {
    const db = supabaseAdmin()
    const { data: col } = await db.from(COLLECTIONS).select('id, name').eq('id', id).is('deleted_at', null).maybeSingle()
    if (!col) return NextResponse.json({ ok: false, error: 'That vault no longer exists.' }, { status: 404 })
    // Items first, so there is never a moment where they point at a vault that is gone.
    await db.from(ITEMS).update({ collection_id: null }).eq('collection_id', id)
    const { error } = await db.from(COLLECTIONS).update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    await logAccess({ itemId: null, email: me, action: 'delete', detail: 'vault ' + (col as any).name + ' — its items are now owner-only', ip: ipOf(req) })
    await snapshotVault('vault-deleted', me)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
