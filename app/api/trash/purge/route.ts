// PERMANENT DELETE, BEHIND THE PASSWORD YOU ALREADY HAVE.
//
// Jon, 2026-09-16, wanted an early purge gated by an admin password. He originally described a new
// "admin level password" stored in user settings; asked, he picked re-authentication instead, and
// the difference matters enough to write down.
//
// THIS APP HAS BEEN HERE BEFORE. lib/trash.ts carries the note: the old glitch delete demanded an
// admin share password that had never been set, so the honest behaviour of that button was "Delete
// is locked", forever, discoverable only by pressing it. A second stored secret is a second thing
// to set, rotate, leak and forget — and the failure mode when it is forgotten is a dead button
// nobody can explain.
//
// So: the admin retypes the Lighthouse password they already use, and it is checked against
// Supabase, which is the only thing that knows it. Nothing new is stored, nothing can rot, and
// there is no second credential to steal. This is the pattern GitHub and Google use before a
// destructive action, and it is called sudo mode for a reason.
//
// THREE THINGS THIS FILE IS CAREFUL ABOUT:
//   1. The password is never logged, never persisted, and never written to an error message.
//   2. Verification runs on a THROWAWAY client with no cookie jar. Signing in on the request's own
//      client would rotate the caller's session tokens as a side effect of checking a password.
//   3. The email checked is the SESSION's, never one supplied in the body — otherwise this route
//      would be an oracle for testing passwords against other people's accounts.
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createBareClient } from '@supabase/supabase-js'
import { requireUser } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { canDelete, canDeleteProject } from '@/lib/trash'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  // A Lighthouse user on the allowlist, not merely a Supabase session (the sudo re-check below
  // proves the password, and canDelete() decides who may purge what).
  const gate = await requireUser()
  if (!gate.ok) return gate.res
  const email = String(gate.access.email || '').toLowerCase()
  if (!email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 })

  const b = await req.json().catch(() => ({} as any))
  const id = String(b?.id || '').trim()
  const password = String(b?.password || '')
  if (!id) return NextResponse.json({ ok: false, error: 'Which record?' }, { status: 400 })
  if (!password) return NextResponse.json({ ok: false, error: 'Enter your Lighthouse password to delete this for good.' }, { status: 400 })

  const db = supabaseAdmin()
  const { data: shot } = await db.from('deleted_records').select('id,kind,record_id,label').eq('id', id).maybeSingle()
  if (!shot) return NextResponse.json({ ok: false, error: 'That is no longer in the trash.' }, { status: 404 })

  // Same rule as putting it there in the first place: the project's owner, or an admin.
  const who = String((shot as any).kind) === 'project'
    ? await canDeleteProject(String((shot as any).record_id))
    : await canDelete()
  if (!who.ok) return NextResponse.json({ ok: false, error: who.reason }, { status: 403 })

  // Throwaway client: no cookies, so a password check cannot disturb the session that made it.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return NextResponse.json({ ok: false, error: 'Sign-in is not configured on this deployment, so I cannot verify your password.' }, { status: 500 })

  const check = createBareClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: authErr } = await check.auth.signInWithPassword({ email, password })
  if (authErr) {
    // Deliberately vague about WHY. "No such user" and "wrong password" are the same sentence here.
    return NextResponse.json({ ok: false, error: 'That password is not right.' }, { status: 403 })
  }
  try { await check.auth.signOut() } catch { /* the throwaway session dies with the request anyway */ }

  const { error } = await db.from('deleted_records').delete().eq('id', id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, purged: true, label: String((shot as any).label || '') })
}
