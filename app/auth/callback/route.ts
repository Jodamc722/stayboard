// MAGIC-LINK / RESET LANDING.
//
// Exchanges the one-time code for a session, then — Jon, 2026-08-20: "when we receive the magic
// link it should ask us to create a new password" — sends anyone without a password of their own
// to /welcome/password first. Once they set one, `password_set` lands in user_metadata and this
// never gets in their way again.
//
// Why it matters beyond convenience: this project sends auth mail through Supabase's built-in
// service (2 messages/hour, and only to members of the Supabase org), so a magic link is not
// something anyone should be depending on to get in. A password is.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  let needsPassword = false
  if (code) {
    const supabase = createClient()
    const { data } = await supabase.auth.exchangeCodeForSession(code)
    const meta = (data && data.user && data.user.user_metadata) || {}
    needsPassword = (meta as any).password_set !== true
  }
  return NextResponse.redirect(`${origin}${needsPassword ? '/welcome/password' : '/'}`)
}
