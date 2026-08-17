// CONNECTED MAILBOXES — which sender accounts hold a Google connection (Jon, 2026-08-17: "how do
// I add the support inbox... create in settings, so I can make the connection"). Returns the
// mailboxes the app sends as — the ops-brief sender, the digest senders, and support@ (the
// front-desk drafts mailbox) — with a connected yes/no each. Booleans only: the refresh tokens
// themselves never leave the server.
import { NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { getSetting } from '@/lib/app-settings'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const SUPPORT = 'support@stay-hospitality.com'

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  const wanted: { email: string; usedFor: string }[] = []
  const add = (email: any, usedFor: string) => {
    const e = String(email || '').trim().toLowerCase()
    if (!e || !/@/.test(e)) return
    const hit = wanted.find(w => w.email === e)
    if (hit) { if (!hit.usedFor.includes(usedFor)) hit.usedFor += ' · ' + usedFor; return }
    wanted.push({ email: e, usedFor })
  }
  const [ops, weekly, salato] = await Promise.all([
    getSetting<any>('ops_brief', null).catch(() => null),
    getSetting<any>('labor_weekly', null).catch(() => null),
    getSetting<any>('salato_daily', null).catch(() => null),
  ])
  add(ops?.fromEmail || 'jon@stay-hospitality.com', 'morning briefs')
  add(weekly?.fromEmail, 'labor true-up')
  add(salato?.fromEmail, 'Salato daily')
  add(SUPPORT, 'front-desk drafts')
  const emails = wanted.map(w => w.email)
  const { data } = await supabaseAdmin().from('google_tokens').select('user_email').in('user_email', emails)
  const connected: Record<string, boolean> = {}
  for (const row of (data || []) as any[]) connected[String(row.user_email).toLowerCase()] = true
  return NextResponse.json({
    ok: true,
    mailboxes: wanted.map(w => ({ email: w.email, usedFor: w.usedFor, connected: !!connected[w.email] })),
  })
}
