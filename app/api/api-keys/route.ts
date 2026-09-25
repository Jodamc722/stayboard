// A person's own API keys (lib/api-keys.ts). Session only — a key cannot mint or revoke keys.
//   GET                          → my keys (prefix, label, created, last used, revoked)
//   POST { label }               → make one; the plaintext comes back ONCE
//   DELETE { id }                → revoke
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/access'
import { createApiKey, listApiKeys, revokeApiKey } from '@/lib/api-keys'

export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await requireUser(); if (!g.ok) return g.res
  return NextResponse.json({ ok: true, keys: await listApiKeys(String(g.access.email || '')) })
}
export async function POST(req: NextRequest) {
  const g = await requireUser(); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({}))
  const email = String(g.access.email || '')
  const live = (await listApiKeys(email)).filter(k => !k.revoked_at)
  if (live.length >= 5) return NextResponse.json({ error: 'Five live keys is the limit — revoke one first.' }, { status: 400 })
  const r = await createApiKey(email, String(b?.label || ''), email)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true, key: r.key, row: r.row })
}
export async function DELETE(req: NextRequest) {
  const g = await requireUser(); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({}))
  const ok = await revokeApiKey(String(b?.id || ''), String(g.access.email || ''))
  return NextResponse.json({ ok })
}
