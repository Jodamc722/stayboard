// SEND THE INTRODUCTORY EMAIL FROM THE APP, FROM THE MAILBOX OF THE PERSON IT IS WRITTEN FROM (Jon, 2026-11-20: "if
// Nick connects his email he can send emails from the app", then "If from Nick it should send from Nick's email").
// The email is written as sales or as the GM and signed by that person, so it leaves from THAT person's connected
// Gmail, whoever on the team presses Send; who pressed it is recorded on the onboarding. It is the same text the page
// shows (lib/owner-onboard introEmail). If that person has not connected Google it cannot be sent from here.
//   GET                           → { sales: { name, email, ready }, gm: { … } }: whose mailbox can send
//   POST { from: 'sales' | 'gm' } → sends from that person's mailbox, and marks the intro sent
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel, accessForEmail } from '@/lib/access'
import { readRecord, saveRecord } from '@/lib/owner-onboard-server'
import { introEmail, teamView } from '@/lib/owner-onboard'
import { readOOSettings } from '@/lib/owner-onboard-mail'
import { sendGmail } from '@/lib/gmail-send'
import { myGoogle } from '@/lib/google-mine'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const OKMAIL = /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/

const isTeammate = async (email: string) => { if (!OKMAIL.test(email)) return false; const a = await accessForEmail(email).catch(() => null); return !!a?.allowed }

export async function GET(_: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'view'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  const me = String(g.access.email || '').trim().toLowerCase()
  const one = async (p: { name: string; email: string }) => { const email = String(p?.email || '').trim().toLowerCase(); const s = OKMAIL.test(email) && (email === me || await isTeammate(email)) ? await myGoogle(email) : null; return { name: String(p?.name || ''), email, ready: !!s?.connected && s.mail, mine: email === me } }
  const [sales, gm] = await Promise.all([one(r.custom.sales), one(r.custom.gm)])
  return NextResponse.json({ ok: true, sales, gm })
}

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'edit'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  const b = await req.json().catch(() => ({} as any))
  const from: 'sales' | 'gm' = b?.from === 'gm' ? 'gm' : 'sales'
  const me = String(g.access.email || '').trim().toLowerCase()
  const persona = from === 'gm' ? r.custom.gm : r.custom.sales
  const box = String(persona.email || '').trim().toLowerCase()
  // only a teammate's own mailbox: never a shared one, and never an address typed onto the onboarding that is not a Lighthouse login
  if (box !== me && !(await isTeammate(box))) return NextResponse.json({ ok: false, error: `${box || 'That address'} is not a Lighthouse login, so nothing can be sent from it here. Copy the email into your own instead.` }, { status: 403 })
  if (!me || !OKMAIL.test(box)) return NextResponse.json({ ok: false, error: `Add ${persona.name || 'the sender'}’s email on this onboarding first.` }, { status: 400 })
  const to = String(r.custom.ownerEmail || '').trim()
  if (!OKMAIL.test(to)) return NextResponse.json({ ok: false, error: 'Add the owner’s email first.' }, { status: 400 })
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin).replace(/\/$/, '')
  const e = introEmail({ ...r, custom: { ...r.custom, from } }, origin + '/join/' + r.code)
  const s = await readOOSettings().catch(() => null)
  const cc = Array.from(new Set([from === 'sales' ? r.custom.gm.email : '', ...((s?.teamCc || []) as string[])].map(x => String(x || '').trim().toLowerCase()).filter(x => OKMAIL.test(x) && x !== box && x !== to.toLowerCase())))
  // plain paragraphs, links made clickable: it should read like an email a person wrote, not a template
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2937">' + esc(e.body).split(/\n{2,}/).map(p => '<p style="margin:0 0 14px">' + p.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+[^\s<.,)])/g, '<a href="$1">$1</a>') + '</p>').join('') + '</div>'
  const sent = await sendGmail({ fromEmail: box, to: [to], cc, subject: e.subject, html, source: 'owner-onboarding' }).catch(err => ({ ok: false, error: String(err?.message || err) }))
  if (!sent.ok) {
    const why = String(sent.error || 'not sent')
    const who = box === me ? 'Your' : (persona.name || box) + '’s'
    return NextResponse.json({ ok: false, error: /No Google connection/i.test(why) ? `${who} Google account is not connected yet, so this cannot be sent from ${box}. ${box === me ? 'Connect it on Account, then send.' : 'They connect it on their Account page.'}` : /insufficient|permission|scope|403/i.test(why) ? `${who} Google connection is missing the email permission. It needs connecting again on the Account page with every box ticked.` : 'Not sent: ' + why.slice(0, 200) }, { status: 502 })
  }
  // `by` is the person who pressed Send, which may not be the person it went from
  r.intro = { at: new Date().toISOString(), by: me.slice(0, 160), from }
  await saveRecord(r, me)
  return NextResponse.json({ ok: true, record: teamView(r), to, cc, sentFrom: box })
}
