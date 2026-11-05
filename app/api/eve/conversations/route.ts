// EVE'S CONVERSATIONS — the list on the /eve Chat tab (Jon, 2026-11-05: "EVE chat needs to be a
// learning chat, where we can teach Eve"). GET → { ok, conversations: [{ id, title, created_at,
// updated_at }], needsMigration? } for the signed-in person, newest first. Before migration 171 the
// list is empty and needsMigration is true; the chat still works.
import { NextRequest, NextResponse } from 'next/server'
import { eveGate } from '../../agent/route'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { listConversations } from '@/lib/eve/conversations'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function GET(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  if (!isVrLogin(gate.access)) return hotelOnlyRes()
  const limit = Number(new URL(req.url).searchParams.get('limit')) || 50
  const r = await listConversations(gate.access.email, limit)
  return NextResponse.json({ ok: true, conversations: r.conversations.map(c => ({ id: c.id, title: c.title, created_at: c.created_at, updated_at: c.updated_at })), needsMigration: !!r.needsMigration })
}
