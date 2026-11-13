// ROOT LOGIN SETUP (Jon, 2026-11-13: "just do it and send me the email"). One purpose, owner-only: make sure the
// hidden root account (jodamc722@gmail.com) has a Supabase Auth login, and email that account a one-time sign-in link
// through Lighthouse's own mailer, so it never depends on Supabase's unreliable email. The target is hardcoded to the
// root email: this route can never create or sign in any other account, whoever calls it.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, isSuperadmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendGmail } from '@/lib/gmail-send'
import { sendResendEmail } from '@/lib/resend-send'
import { stayEmail, escHtml } from '@/lib/email-layout'

const ROOT = 'jodamc722@gmail.com'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const gate = await requireAdmin('owner')
  if (!gate.ok) return gate.res
  if (!isSuperadmin(gate.access.email)) return NextResponse.json({ error: 'Only the owner can do this.' }, { status: 403 })
  const sb: any = supabaseAdmin()
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin).replace(/\/$/, '')
  const redirectTo = origin + '/auth/callback'

  // 1. ensure the auth login exists (no password; the link signs them in and they set one after)
  let created = false
  try {
    const { error: cErr } = await sb.auth.admin.createUser({ email: ROOT, email_confirm: true })
    if (cErr && !/already|registered|exists/i.test(cErr.message || '')) return NextResponse.json({ error: 'Could not create the login: ' + cErr.message }, { status: 500 })
    created = !cErr
  } catch (e: any) { return NextResponse.json({ error: 'Could not create the login: ' + String(e?.message || e) }, { status: 500 }) }

  // 2. a one-time magic sign-in link we send ourselves
  let link = ''
  try {
    const { data, error: lErr } = await sb.auth.admin.generateLink({ type: 'magiclink', email: ROOT, options: { redirectTo } })
    link = data?.properties?.action_link || ''
    if (lErr) return NextResponse.json({ error: 'Could not make a sign-in link: ' + lErr.message }, { status: 500 })
  } catch (e: any) { return NextResponse.json({ error: 'Could not make a sign-in link: ' + String(e?.message || e) }, { status: 500 }) }
  if (!link) {
    // fallback: let Supabase send its own invite email
    try { await sb.auth.admin.inviteUserByEmail(ROOT, { redirectTo }) } catch { /* reported below */ }
    return NextResponse.json({ ok: true, created, how: 'supabase-invite', note: 'A Supabase invite email was sent instead; if it does not arrive, use “Forgot password” on the login page.' })
  }

  // 3. send the link through Lighthouse's own mailer (Gmail from the owner's mailbox first, Resend fallback)
  const subject = 'Your Lighthouse sign-in link'
  const html = stayEmail({
    origin, preheader: 'Your one-time link to sign in to Lighthouse and set a password.',
    eyebrow: 'Lighthouse access', heading: 'Sign in to Lighthouse',
    paragraphs: ['Hi Jon,', 'Here is your sign-in link for your Lighthouse admin account. It signs you in once; afterwards you can set a password for this login from the login page’s “Forgot password”.'],
    cta: { label: 'Sign in to Lighthouse', url: link },
    ctaNote: `If the button does not work, open <a href="${escHtml(origin)}/login" style="color:#7A7B80">${escHtml(origin.replace(/^https?:\/\//, ''))}/login</a> and use “Forgot password” for this email.`,
    note: 'This link is private to you. Please do not forward it — it signs in whoever opens it.',
    footer: 'Lighthouse · Stay Hospitality',
  })
  let how = ''
  const g = await sendGmail({ fromEmail: 'jon@stay-hospitality.com', to: [ROOT], subject, html, source: 'root-invite' }).catch(() => ({ ok: false }))
  if (g.ok) how = 'gmail'
  else { const r = await sendResendEmail({ to: [ROOT], subject, html }).catch(() => ({ ok: false, error: 'send failed' } as any)); how = r.ok ? 'resend' : '' }
  return NextResponse.json({ ok: !!how, created, how: how || 'none', ...(how ? {} : { error: 'The login is ready, but the email did not send. Use “Forgot password” on the login page for ' + ROOT + '.' }) })
}
