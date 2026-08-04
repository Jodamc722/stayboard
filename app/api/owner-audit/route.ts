// OWNER STATEMENT AUDIT API.
//
// GET  ?month=YYYY-MM  — the full audit for one statement month (defaults to the newest month
//                        that has generated statements), plus the month picker feed.
// POST                 — save review state on one item: status, note, or an appended comment.
//
// AUTH: a signed-in Lighthouse user OR the owner-audit share cookie (its own password,
// share_settings id=4 — see lib/shareAuth). The share link is a WORKING link by design: a VA or
// accountant marks rows and comments without an app login. They still can't touch anything else
// in the app — this route only ever reads the mirror and writes owner_audit_reviews.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { OA_COOKIE, auditCookieValid } from '@/lib/shareAuth'
import { auditMonths, buildAudit, AuditStatus } from '@/lib/owner-audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function whoAmI(): Promise<{ ok: boolean; internal: boolean; email: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) return { ok: true, internal: true, email: String(user.email || '') }
  const shared = await auditCookieValid(cookies().get(OA_COOKIE)?.value)
  return { ok: shared, internal: false, email: '' }
}

export async function GET(req: NextRequest) {
  const who = await whoAmI()
  if (!who.ok) return NextResponse.json({ ok: false, needsPassword: true, error: 'unauthorized' }, { status: 401 })

  try {
    const months = await auditMonths()
    const wanted = new URL(req.url).searchParams.get('month') || ''
    const month = /^\d{4}-\d{2}$/.test(wanted) ? wanted : (months[0]?.m || '')
    if (!month) return NextResponse.json({ ok: true, internal: who.internal, months, data: null })
    const data = await buildAudit(month)
    return NextResponse.json({ ok: true, internal: who.internal, months, data })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

const STATUSES: AuditStatus[] = ['review', 'action', 'done']

export async function POST(req: NextRequest) {
  const who = await whoAmI()
  if (!who.ok) return NextResponse.json({ ok: false, needsPassword: true, error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const month = String(body.month || '')
  const ownerId = String(body.ownerId || '')
  const itemKey = String(body.itemKey || '').slice(0, 160)
  if (!/^\d{4}-\d{2}$/.test(month) || !ownerId || !itemKey) {
    return NextResponse.json({ ok: false, error: 'month, ownerId and itemKey are required' }, { status: 400 })
  }

  const status = body.status !== undefined ? String(body.status) : undefined
  if (status !== undefined && !STATUSES.includes(status as AuditStatus)) {
    return NextResponse.json({ ok: false, error: 'bad status' }, { status: 400 })
  }
  const note = body.note !== undefined ? String(body.note).slice(0, 2000) : undefined
  const commentBody = body.comment ? String(body.comment.body || '').trim().slice(0, 1000) : ''
  const commentAuthor = who.internal
    ? who.email
    : ('link · ' + String(body.comment?.author || body.author || 'reviewer').trim().slice(0, 60))
  if (body.comment && !commentBody) return NextResponse.json({ ok: false, error: 'empty comment' }, { status: 400 })

  const by = who.internal ? who.email : commentAuthor
  const db = supabaseAdmin()

  try {
    const { data: existing, error: readErr } = await db.from('owner_audit_reviews')
      .select('status, note, comments')
      .eq('month', month).eq('owner_id', ownerId).eq('item_key', itemKey)
      .maybeSingle()
    if (readErr) throw new Error(readErr.message)

    const comments: any[] = Array.isArray(existing?.comments) ? existing!.comments.slice() : []
    if (commentBody) comments.push({ author: commentAuthor, body: commentBody, at: new Date().toISOString() })
    if (comments.length > 100) comments.splice(0, comments.length - 100)

    const row = {
      month, owner_id: ownerId, item_key: itemKey,
      status: status !== undefined ? status : (existing?.status || 'review'),
      note: note !== undefined ? note : (existing?.note || ''),
      comments,
      updated_by: by,
      updated_at: new Date().toISOString(),
    }
    const { error } = await db.from('owner_audit_reviews')
      .upsert(row, { onConflict: 'month,owner_id,item_key' })
    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true, status: row.status, note: row.note, comments, updatedBy: by, updatedAt: row.updated_at })
  } catch (e: any) {
    const msg = String(e?.message || e)
    // The one honest special case: migration not run yet.
    const hint = /owner_audit_reviews/.test(msg) && /does not exist|schema cache/.test(msg)
      ? ' — run migration 023_owner_audit.sql in Supabase first.' : ''
    return NextResponse.json({ ok: false, error: msg.slice(0, 300) + hint }, { status: 500 })
  }
}
