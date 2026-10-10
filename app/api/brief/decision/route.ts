// ONE TAP FROM THE GM BRIEF (Eve audit 2026-10-10): "Decided" / "Defer a week" / "Back on the list".
// GET so it works as a link in an email on a phone; admins only, and it is signed-in — Gmail's link
// scanner never carries a Lighthouse session, so a scanner cannot decide anything.
//   /api/brief/decision?key=blocked&do=decided
//   /api/brief/decision?key=blocked&do=defer&days=7
//   /api/brief/decision?key=blocked&do=reopen
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/access'
import { setDecision } from '@/lib/gm-decisions'

export const dynamic = 'force-dynamic'

const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const LABEL: Record<string, string> = {
  blocked: 'Blocked units', nocharge: 'Maintenance closed with no charge', claims: 'Open claims', overdue: 'Overdue work orders', short: 'Short days ahead',
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin('admin')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const key = String(sp.get('key') || '').replace(/[^a-z0-9:_-]/gi, '').slice(0, 60)
  const act = String(sp.get('do') || '')
  const days = Number(sp.get('days') || 7)
  if (!key || !['decided', 'defer', 'reopen'].includes(act)) return NextResponse.json({ ok: false, error: 'key and do=decided|defer|reopen' }, { status: 400 })
  const e = await setDecision(key, act as any, days, String(gate.access.email || 'admin'), todayET())
  const what = LABEL[key.split(':')[0]] || key
  const line = act === 'decided' ? `${what} — marked decided. It stays off the GM Brief until the number moves.`
    : act === 'defer' ? `${what} — deferred until ${e.until}. Back on the brief that morning.`
    : `${what} — back on the list tomorrow.`
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>GM Brief</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;color:#0b1220;margin:0;padding:28px 18px">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px 22px">
<p style="margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6b7280">GM Brief</p>
<p style="margin:0;font-size:16px;line-height:1.5">${line.replace(/</g, '&lt;')}</p>
<p style="margin:14px 0 0;font-size:13px"><a href="/command" style="color:#4338ca">Open Lighthouse →</a></p>
</div></body></html>`
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
