// The owner's sign-in to their onboarding link (lib/owner-onboard-auth). Public; everything is checked here.
//   POST { magic }        → spend an emailed link token and sign in
//   POST { password }     → sign in with the password
//   POST { setPassword }  → create or change the password (signed in only; 8+ characters)
//   POST { signOut: 1 }   → sign out of this browser
//   POST { sendLink: 1 }  → email a fresh sign-in link to the address on file (three an hour)
import { NextRequest, NextResponse } from 'next/server'
import { readRecord, saveRecord } from '@/lib/owner-onboard-server'
import { signedIn, sessionCookie, clearedCookie, seen, setPassword, checkPassword, useToken, canSend, emailMagicLink, isProtected } from '@/lib/owner-onboard-auth'

export const dynamic = 'force-dynamic'
const tries = new Map<string, number[]>()
const limited = (k: string) => { const now = Date.now(), w = (tries.get(k) || []).filter(t => now - t < 15 * 60_000); w.push(now); tries.set(k, w); if (tries.size > 5000) tries.clear(); return w.length > 12 }

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const r = await readRecord(params.code)
  if (!r || r.archived) return NextResponse.json({ ok: false, error: 'This link is not active.' }, { status: 404 })
  const b = await req.json().catch(() => ({} as any))
  const by = 'owner:' + (r.custom.ownerEmail || r.code)
  if (b.magic) {
    if (!useToken(r, String(b.magic))) return NextResponse.json({ ok: false, error: 'That sign-in link has expired or was already used. Ask for a new one below.' }, { status: 401 })
    seen(r)
    await saveRecord(r, by)
    const res = NextResponse.json({ ok: true, hasPassword: !!r.auth?.pass }); res.cookies.set(sessionCookie(r)); return res
  }
  if (typeof b.password === 'string') {
    if (limited(r.code)) return NextResponse.json({ ok: false, error: 'Too many tries. Wait a few minutes, or ask for a sign-in link by email.' }, { status: 429 })
    if (!checkPassword(r, b.password)) return NextResponse.json({ ok: false, error: 'That password is not right.' }, { status: 401 })
    seen(r); await saveRecord(r, by).catch(() => null)
    const res = NextResponse.json({ ok: true, hasPassword: true }); res.cookies.set(sessionCookie(r)); return res
  }
  if (b.signOut) { const res = NextResponse.json({ ok: true }); res.cookies.set(clearedCookie(r)); return res }
  if (typeof b.setPassword === 'string') {
    if (isProtected(r) && !signedIn(req, r)) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 })
    if (b.setPassword.length < 8 || b.setPassword.length > 200) return NextResponse.json({ ok: false, error: 'Use at least 8 characters.' }, { status: 400 })
    setPassword(r, b.setPassword)
    await saveRecord(r, by)
    const res = NextResponse.json({ ok: true, hasPassword: true }); res.cookies.set(sessionCookie(r)); return res
  }
  if (b.sendLink) {
    // the same answer whether or not it was sent, so the form never confirms an address
    if (r.custom.ownerEmail && canSend(r)) { await emailMagicLink(r, process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin, 'signin').catch(() => null); await saveRecord(r, by) }
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ ok: false, error: 'Nothing to do.' }, { status: 400 })
}
