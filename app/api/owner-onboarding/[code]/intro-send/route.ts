// SEND THE INTRODUCTORY EMAIL FROM THE APP, FROM THE SENDER'S OWN GMAIL (Jon, 2026-11-20: "if Nick connects his
// email he can send emails from the app"). The email is written as sales or as the GM and signed by that person, so
// only that person can send it here, from their own connected mailbox; anyone else still copies it or opens it in
// their own email. It is the same text the page shows (lib/owner-onboard introEmail).
//   POST { from: 'sales' | 'gm' } → sends, and marks the intro sent
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readRecord, saveRecord } from '@/lib/owner-onboard-server'
import { introEmail, teamView } from '@/lib/owner-onboard'
import { readOOSettings } from '@/lib/owner-onboard-mail'
import { sendGmail } from '@/lib/gmail-send'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const OKMAIL = /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'edit'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  const b = await req.json().catch(() => ({} as any))
  const from: 'sales' | 'gm' = b?.from === 'gm' ? 'gm' : 'sales'
  const me = String(g.access.email || '').trim().toLowerCase()
  const persona = from === 'gm' ? r.custom.gm : r.custom.sales
  if (!me || String(persona.email || '').trim().toLowerCase() !== me) return NextResponse.json({ ok: false, error: `This email is written from ${persona.name || 'someone else'}, so only they can send it from here. Switch who it is from, or copy it into your own email.` }, { status: 403 })
  const to = String(r.custom.ownerEmail || '').trim()
  if (!OKMAIL.test(to)) return NextResponse.json({ ok: false, error: 'Add the owner’s email first.' }, { status: 400 })
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin).replace(/\/$/, '')
  const e = introEmail({ ...r, custom: { ...r.custom, from } }, origin + '/join/' + r.code)
  const s = await readOOSettings().catch(() => null)
  const cc = Array.from(new Set([from === 'sales' ? r.custom.gm.email : '', ...((s?.teamCc || []) as string[])].map(x => String(x || '').trim().toLowerCase()).filter(x => OKMAIL.test(x) && x !== me && x !== to.toLowerCase())))
  // plain paragraphs, links made clickable: it should read like an email a person wrote, not a template
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2937">' + esc(e.body).split(/\n{2,}/).map(p => '<p style="margin:0 0 14px">' + p.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+[^\s<.,)])/g, '<a href="$1">$1</a>') + '</p>').join('') + '</div>'
  const sent = await sendGmail({ fromEmail: me, to: [to], cc, subject: e.subject, html, source: 'owner-onboarding' }).catch(err => ({ ok: false, error: String(err?.message || err) }))
  if (!sent.ok) {
    const why = String(sent.error || 'not sent')
    return NextResponse.json({ ok: false, needsGoogle: /No Google connection|insufficient|permission|scope|403|invalid_grant/i.test(why), error: /No Google connection/i.test(why) ? 'Your Google account is not connected yet. Connect it on My account, then send.' : 'Not sent: ' + why.slice(0, 200) }, { status: 502 })
  }
  r.intro = { at: new Date().toISOString(), by: me.slice(0, 160), from }
  await saveRecord(r, me)
  return NextResponse.json({ ok: true, record: teamView(r), to, cc })
}
