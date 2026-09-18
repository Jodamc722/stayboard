// TEAM SCHEDULER LINKS — the desk side (signed in, feature 'schedule').
//   GET  → links + recent submissions
//   POST {action:'feedback', id, feedback} | {action:'reviewed', id}
//
// 2026-09-18: scheduler links are share_links rows (kind 'scheduler') and are MADE on /links like
// every other link, with their own passcode. This route keeps the submissions desk; create /
// passcode / revoke moved to /api/share-links and answer 410 here so an old tab says why.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
const str = (v: any) => (v == null ? '' : String(v)).trim()

export async function GET() {
  const g = await requireLevel('schedule', 'view'); if (!g.ok) return g.res
  const db = supabaseAdmin()
  const [{ data: links }, { data: subs }] = await Promise.all([
    db.from('share_links').select('id, code, title, label, scope, passcode_hint, open, created_at, revoked_at, expires_at, uses, last_used_at').eq('kind', 'scheduler').order('created_at', { ascending: false }),
    db.from('schedule_submissions').select('*').order('created_at', { ascending: false }).limit(60),
  ])
  const shaped = (links || []).map((l: any) => ({
    id: l.id, code: l.code, market: str(l.scope?.market) || 'All', label: l.title || l.label || null,
    passcode_hint: l.passcode_hint || null, open: l.open === true, view_only: l.scope?.viewOnly === true,
    created_at: l.created_at, revoked_at: l.revoked_at, expires_at: l.expires_at, uses: l.uses, last_used_at: l.last_used_at,
  }))
  return NextResponse.json({ ok: true, links: shaped, submissions: subs || [] })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('schedule', 'edit'); if (!g.ok) return g.res
  const me = g.access.email || null
  const b = await req.json().catch(() => ({} as any))
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  try {
    if (b.action === 'create' || b.action === 'passcode' || b.action === 'revoke') {
      return NextResponse.json({ ok: false, error: 'Scheduler links are made and managed on the Share Links page (/links) now.' }, { status: 410 })
    }
    const id = str(b.id); if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    if (b.action === 'feedback') {
      const feedback = str(b.feedback).slice(0, 4000)
      await db.from('schedule_submissions').update({ feedback: feedback || null, status: 'reviewed', reviewed_by: me, reviewed_at: now }).eq('id', id)
      return NextResponse.json({ ok: true })
    }
    if (b.action === 'reviewed') { await db.from('schedule_submissions').update({ status: 'reviewed', reviewed_by: me, reviewed_at: now }).eq('id', id); return NextResponse.json({ ok: true }) }
    return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
}
