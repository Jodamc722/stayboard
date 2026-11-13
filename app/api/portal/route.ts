// THE OWNER PORTAL SIGN-IN (Jon, 2026-11-13: "when we set up an owner it should be a portal: they click the link,
// create a password and live as an owner user"). An owner account is the email on their onboarding plus the
// password they created there. It is NOT a Lighthouse staff login: it opens their own /join/<code> page and nothing
// else. Public; everything is checked here.
//   POST { email, password } → signs in to every onboarding with that email and password; returns where to go
//   POST { email, sendLink } → emails a one-time sign-in link for each (the same answer either way)
import { NextRequest, NextResponse } from 'next/server'
import { listRecords, readRecord, saveRecord } from '@/lib/owner-onboard-server'
import { checkPassword, sessionCookie, seen, canSend, emailMagicLink } from '@/lib/owner-onboard-auth'

export const dynamic = 'force-dynamic'
const tries = new Map<string, number[]>()
const limited = (k: string, max: number) => { const now = Date.now(), w = (tries.get(k) || []).filter(t => now - t < 15 * 60_000); w.push(now); tries.set(k, w); if (tries.size > 5000) tries.clear(); return w.length > max }
const WRONG = 'That email and password do not match an owner account. Check them, or ask for a sign-in link below.'

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any))
  const email = String(b.email || '').trim().toLowerCase().slice(0, 160)
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'ip'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ ok: false, error: 'Enter your email address.' }, { status: 400 })
  if (limited('e:' + email, 10) || limited('i:' + ip, 40)) return NextResponse.json({ ok: false, error: 'Too many tries. Wait a few minutes, or ask for a sign-in link by email.' }, { status: 429 })
  const all = (await listRecords()).filter(x => !x.archived)
  const rows = all.filter(x => x.email === email)
  // links saved before the list kept the owner's email: look inside them (a bounded number), newest first
  for (const x of all.filter(x => x.email === undefined).slice(0, 80)) { const r = await readRecord(x.code); if (r && String(r.custom.ownerEmail || '').trim().toLowerCase() === email) rows.push(x) }
  rows.splice(12)
  if (b.sendLink) {
    for (const x of rows) { const r = await readRecord(x.code); if (r && !r.archived && canSend(r)) { await emailMagicLink(r, process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin, 'signin').catch(() => null); await saveRecord(r, 'owner:' + email).catch(() => null) } }
    return NextResponse.json({ ok: true })   // never says whether the address is known
  }
  const pw = String(b.password || '')
  if (!pw) return NextResponse.json({ ok: false, error: 'Enter your password.' }, { status: 400 })
  const open: { code: string; label: string }[] = []
  const cookies: ReturnType<typeof sessionCookie>[] = []
  for (const x of rows) {
    const r = await readRecord(x.code)
    if (!r || r.archived || !checkPassword(r, pw)) continue
    seen(r); await saveRecord(r, 'owner:' + email).catch(() => null)
    cookies.push(sessionCookie(r))
    open.push({ code: r.code, label: [r.attach.property, r.attach.unitLabel ? 'Unit ' + r.attach.unitLabel : r.home?.unit ? 'Unit ' + r.home.unit : ''].filter(Boolean).join(' · ') || 'Your home' })
  }
  if (!open.length) return NextResponse.json({ ok: false, error: WRONG }, { status: 401 })
  const res = NextResponse.json({ ok: true, open }, { headers: { 'Cache-Control': 'no-store' } })
  for (const c of cookies) res.cookies.set(c)
  return res
}
