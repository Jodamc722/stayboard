// ADD TO GMAIL DRAFTS — front-desk notices (Jon, 2026-08-17). One click puts the notice email into
// support@stay-hospitality.com's Drafts folder, addressed and written, so the desk attaches the
// registration form and hits send from Gmail. The draft is created from the fields the board is
// showing RIGHT NOW (to/cc/subject/body), so what you previewed is exactly what lands in Drafts.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { createGmailDraft } from '@/lib/gmail-send'

export const dynamic = 'force-dynamic'

// The mailbox the desk actually works out of. Its Google connection must hold the drafts scope.
const SUPPORT_FROM = 'support@stay-hospitality.com'

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  const b = await req.json().catch(() => ({} as any))
  const to = String(b?.to || '').split(/[,;]+/).map((x: string) => x.trim()).filter(Boolean)
  const cc = String(b?.cc || '').split(/[,;]+/).map((x: string) => x.trim()).filter(Boolean)
  const subject = String(b?.subject || '').slice(0, 300)
  const body = String(b?.body || '')
  if (!to.length) return NextResponse.json({ error: 'No recipient — add one in Settings first.' }, { status: 400 })
  if (!subject || !body) return NextResponse.json({ error: 'Draft has no subject or body.' }, { status: 400 })
  // The notice body is plain text; Gmail drafts carry HTML. Escape, then keep the line breaks.
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;white-space:pre-wrap">' + esc(body) + '</div>'
  const r = await createGmailDraft({ fromEmail: SUPPORT_FROM, to, cc, subject, html })
  if (!r.ok) return NextResponse.json({ error: r.error || 'Could not create the draft.' }, { status: 502 })
  return NextResponse.json({ ok: true, from: SUPPORT_FROM })
}
