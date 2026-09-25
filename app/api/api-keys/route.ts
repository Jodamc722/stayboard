// A person's own API keys (lib/api-keys.ts). Session only — a key cannot mint or revoke keys.
//   GET                          → my keys (prefix, label, created, last used, revoked)
//   POST { label }               → make one; the plaintext comes back ONCE
//   DELETE { id }                → revoke
import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isSuperadmin } from '@/lib/access'
import { createApiKey, listApiKeys, revokeApiKey, listAllApiKeys, decideApiKey } from '@/lib/api-keys'

export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await requireUser(); if (!g.ok) return g.res
  const email = String(g.access.email || '')
  const superuser = isSuperadmin(email)
  // The superadmin sees every key so he can approve them (2026-09-25); everyone else sees their own.
  return NextResponse.json({ ok: true, superuser, keys: await listApiKeys(email), all: superuser ? await listAllApiKeys() : [] })
}
export async function POST(req: NextRequest) {
  const g = await requireUser(); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({}))
  const email = String(g.access.email || '')
  const live = (await listApiKeys(email)).filter(k => !k.revoked_at)
  if (live.length >= 5) return NextResponse.json({ error: 'Five live keys is the limit — revoke one first.' }, { status: 400 })
  const r = await createApiKey(email, String(b?.label || ''), email)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  // Tell Jon a key is waiting on him (his own are approved on creation).
  if (!r.row.approved_at) {
    try {
      const { notify } = await import('@/lib/notify')
      await notify(['jon@stay-hospitality.com'], { kind: 'api_key', actor: email, link: '/api-keys', title: `API key waiting for your approval: ${email}`, body: r.row.label ? `"${r.row.label}" · ${r.row.prefix}…` : r.row.prefix + '…' })
    } catch { /* the request still stands */ }
  }
  return NextResponse.json({ ok: true, key: r.key, row: r.row })
}
// PATCH { id, approve: true|false } — the superadmin decides.
export async function PATCH(req: NextRequest) {
  const g = await requireUser(); if (!g.ok) return g.res
  const email = String(g.access.email || '')
  if (!isSuperadmin(email)) return NextResponse.json({ error: 'Only Jon approves API keys.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const ok = await decideApiKey(String(b?.id || ''), !!b?.approve, email)
  return NextResponse.json({ ok })
}
export async function DELETE(req: NextRequest) {
  const g = await requireUser(); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({}))
  const ok = await revokeApiKey(String(b?.id || ''), String(g.access.email || ''))
  return NextResponse.json({ ok })
}
