// SHARING — who else can open one item, and the log of who opened it.
//
// Granting is itself a privileged act: only someone who can MANAGE an item may share it, and both
// the grant and the revoke land in the audit trail. Sharing without a record is how a vault turns
// back into a group chat.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ITEMS, GRANTS, LOG, accessFor, logAccess } from '@/lib/vault'
import { snapshotVault } from '@/lib/vault-backup'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const str = (v: any, max = 300) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max)
const email = (v: any) => str(v, 200).trim().toLowerCase()
const ipOf = (req: NextRequest) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

/** GET ?id= — who this item is shared with, and its recent access history. */
export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const me = String(access.email || '')
  const id = str(req.nextUrl.searchParams.get('id'), 60).trim()
  if (!id) return NextResponse.json({ ok: false, error: 'Which item?' }, { status: 400 })

  try {
    const db = supabaseAdmin()
    const { data: item } = await db.from(ITEMS).select('id, owner_email, collection_id').eq('id', id).is('deleted_at', null).maybeSingle()
    if (!item) return NextResponse.json({ ok: false, error: 'That item no longer exists.' }, { status: 404 })
    const level = await accessFor(item as any, me, isSuperadmin(access.email), { accessRole: access.accessRole })
    // The history of who opened an item is itself sensitive — only managers see it.
    if (level !== 'manage') return NextResponse.json({ ok: false, error: 'You cannot manage sharing on this item.' }, { status: 403 })

    const [g, l] = await Promise.all([
      db.from(GRANTS).select('id, email, level, granted_by, created_at').eq('item_id', id).order('created_at', { ascending: true }),
      db.from(LOG).select('email, action, detail, created_at').eq('item_id', id).order('created_at', { ascending: false }).limit(100),
    ])
    return NextResponse.json({ ok: true, grants: g.data || [], log: l.data || [], owner: (item as any).owner_email })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

/** POST — grant someone access. */
export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const me = String(access.email || '')

  const b = await req.json().catch(() => ({} as any))
  const id = str(b.id, 60).trim()
  const who = email(b.email)
  const level = b.level === 'manage' ? 'manage' : 'view'
  if (!id) return NextResponse.json({ ok: false, error: 'Which item?' }, { status: 400 })
  if (!looksLikeEmail(who)) return NextResponse.json({ ok: false, error: 'That does not look like an email address.' }, { status: 400 })

  try {
    const db = supabaseAdmin()
    const { data: item } = await db.from(ITEMS).select('id, owner_email, collection_id, title').eq('id', id).is('deleted_at', null).maybeSingle()
    if (!item) return NextResponse.json({ ok: false, error: 'That item no longer exists.' }, { status: 404 })
    const mine = await accessFor(item as any, me, isSuperadmin(access.email), { accessRole: access.accessRole })
    if (mine !== 'manage') {
      await logAccess({ itemId: id, email: me, action: 'denied', detail: 'grant', ip: ipOf(req) })
      return NextResponse.json({ ok: false, error: 'You cannot share this item.' }, { status: 403 })
    }

    const { error } = await db.from(GRANTS)
      .upsert({ item_id: id, email: who, level, granted_by: me }, { onConflict: 'item_id,email' })
    if (error) {
      // The unique index is on lower(email), which upsert's onConflict cannot name directly on
      // every PostgREST version — fall back to an explicit replace rather than failing the share.
      await db.from(GRANTS).delete().eq('item_id', id).ilike('email', who)
      const retry = await db.from(GRANTS).insert({ item_id: id, email: who, level, granted_by: me })
      if (retry.error) return NextResponse.json({ ok: false, error: retry.error.message }, { status: 500 })
    }
    await logAccess({ itemId: id, email: me, action: 'grant', detail: who + ' (' + level + ')', ip: ipOf(req) })
    await snapshotVault('grant', me)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

/** DELETE ?id=&email= — take access away. */
export async function DELETE(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const me = String(access.email || '')
  const id = str(req.nextUrl.searchParams.get('id'), 60).trim()
  const who = email(req.nextUrl.searchParams.get('email'))
  if (!id || !who) return NextResponse.json({ ok: false, error: 'Which item, and whose access?' }, { status: 400 })

  try {
    const db = supabaseAdmin()
    const { data: item } = await db.from(ITEMS).select('id, owner_email, collection_id').eq('id', id).is('deleted_at', null).maybeSingle()
    if (!item) return NextResponse.json({ ok: false, error: 'That item no longer exists.' }, { status: 404 })
    const mine = await accessFor(item as any, me, isSuperadmin(access.email), { accessRole: access.accessRole })
    if (mine !== 'manage') return NextResponse.json({ ok: false, error: 'You cannot change sharing on this item.' }, { status: 403 })

    const { error } = await db.from(GRANTS).delete().eq('item_id', id).ilike('email', who)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    await logAccess({ itemId: id, email: me, action: 'revoke', detail: who, ip: ipOf(req) })
    await snapshotVault('revoke', me)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
