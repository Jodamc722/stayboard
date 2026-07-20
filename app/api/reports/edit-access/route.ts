// Shared team-edit-password flow for owner-report links.
//   GET                          -> { hasPassword } (is a team password configured?)
//   POST { action:'set', password }    -> team members (logged in) set/replace the password
//   POST { action:'unlock', password } -> anyone with the link + password gets a signed edit cookie
//   POST { action:'clear' }            -> team members clear the edit cookie (lock again)
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { EDIT_COOKIE, EDIT_TTL_MS, signEditToken, hashPassword, verifyPassword } from '@/lib/edit-access'

export const dynamic = 'force-dynamic'

const KEY = 'owner_edit_password'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

async function loadHash(): Promise<string | null> {
  const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', KEY).limit(1)
  const row = (data || [])[0] as any
  return row ? str(row.value) : null
}

export async function GET() {
  const hash = await loadHash()
  return NextResponse.json({ ok: true, hasPassword: !!hash })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const action = str(body?.action)
  const password = str(body?.password)

  if (action === 'set') {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    if (password.length < 4) return NextResponse.json({ error: 'Password must be at least 4 characters.' }, { status: 400 })
    const { error } = await supabaseAdmin().from('app_settings').upsert({ key: KEY, value: hashPassword(password), updated_at: new Date().toISOString() })
    if (error) return NextResponse.json({ error: 'Could not save the password (run migration 013_app_settings.sql?).' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'unlock') {
    const hash = await loadHash()
    if (!hash) return NextResponse.json({ error: 'No team edit password is set yet.' }, { status: 400 })
    if (!password || !verifyPassword(password, hash)) return NextResponse.json({ error: 'Wrong password.' }, { status: 401 })
    const token = signEditToken(Date.now() + EDIT_TTL_MS)
    const res = NextResponse.json({ ok: true })
    res.cookies.set(EDIT_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: Math.floor(EDIT_TTL_MS / 1000), path: '/' })
    return res
  }

  if (action === 'clear') {
    const res = NextResponse.json({ ok: true })
    res.cookies.set(EDIT_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0, path: '/' })
    return res
  }

  return NextResponse.json({ error: 'action must be set|unlock|clear' }, { status: 400 })
}
