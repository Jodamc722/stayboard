// The owner's sign-in to their onboarding link (lib/owner-onboard-auth). Public; everything is checked here.
//   POST { magic }        → spend an emailed link token and sign in
//   POST { password }     → sign in with the password
//   POST { setPassword }  → create or change the password (signed in only; 8+ characters)
//   POST { signOut: 1 }   → sign out of this browser
//   POST { sendLink: 1 }  → email a fresh sign-in link to the address on file (three an hour)
import { NextRequest, NextResponse } from 'next/server'
import { readRecord, saveRecord } from '@/lib/owner-onboard-server'
import { whoSignedIn, sessionCookie, clearedCookie, seen, setPassword, matchPassword, useToken, canSend, emailMagicLink, accounts, account } from '@/lib/owner-onboard-auth'

export const dynamic = 'force-dynamic'
const tries = new Map<string, number[]>()
const limited = (k: string) => { const now = Date.now(), w = (tries.get(k) || []).filter(t => now - t < 15 * 60_000); w.push(now); tries.set(k, w); if (tries.size > 5000) tries.clear(); return w.length > 12 }

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const r = await readRecord(params.code)
  if (!r || r.archived) return NextResponse.json({ ok: false, error: 'This link is not active.' }, { status: 404 })
  const b = await req.json().catch(() => ({} as any))
  const by = 'owner:' + (r.custom.ownerEmail || r.code)
  if (b.magic) {
    const id = useToken(r, String(b.magic))
    if (!id) return NextResponse.json({ ok: false, error: 'That sign-in link has expired or was already used. Ask for a new one below.' }, { status: 401 })
    seen(r, id)
    await saveRecord(r, by)
    const res = NextResponse.json({ ok: true, hasPassword: !!account(r, id)?.auth?.pass }); res.cookies.set(sessionCookie(r, id)); return res
  }
  if (typeof b.password === 'string') {
    if (limited(r.code)) return NextResponse.json({ ok: false, error: 'Too many tries. Wait a few minutes, or ask for a sign-in link by email.' }, { status: 429 })
    // several owners on the link: each signs in with their own email and password
    const multi = accounts(r).length > 1
    const email = String(b.email || '').trim()
    if (multi && !email) return NextResponse.json({ ok: false, error: 'Enter your email address too.' }, { status: 400 })
    const id = matchPassword(r, b.password, multi ? email : undefined)
    if (!id) return NextResponse.json({ ok: false, error: multi ? 'That email and password do not match.' : 'That password is not right.' }, { status: 401 })
    seen(r, id); await saveRecord(r, by).catch(() => null)
    const res = NextResponse.json({ ok: true, hasPassword: true }); res.cookies.set(sessionCookie(r, id)); return res
  }
  if (b.signOut) { const res = NextResponse.json({ ok: true }); res.cookies.set(clearedCookie(r)); return res }
  if (typeof b.setPassword === 'string') {
    const id = whoSignedIn(req, r)
    if (!id) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 })
    if (b.setPassword.length < 8 || b.setPassword.length > 200) return NextResponse.json({ ok: false, error: 'Use at least 8 characters.' }, { status: 400 })
    setPassword(r, b.setPassword, id)
    await saveRecord(r, by)
    const res = NextResponse.json({ ok: true, hasPassword: true }); res.cookies.set(sessionCookie(r, id)); return res
  }
  if (b.sendLink) {
    // the same answer whether or not it was sent, so the form never confirms an address. With an email, only that
    // owner; without one, every owner on the link gets their own link at their own address.
    const email = String(b.email || '').trim().toLowerCase()
    let any = false
    for (const a of accounts(r)) { if (!a.email || (email && a.email.trim().toLowerCase() !== email)) continue; if (canSend(r, a.id)) { await emailMagicLink(r, process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin, 'signin', a.id).catch(() => null); any = true } }
    if (any) await saveRecord(r, by)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ ok: false, error: 'Nothing to do.' }, { status: 400 })
}
