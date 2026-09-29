// "DRAFT WITH EVE" ON THE REPLY BOX (2026-09-28 audit, D1). Returns a suggested reply for one
// Guesty thread — the same drafting Eve's guest_unanswered_1h watch does (lib/guest-reply-draft).
// Nothing is sent and nothing is saved: the text goes into the reply box for a person to edit and
// Send. Edit access on Messages, the same bar as sending.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { draftGuestReply } from '@/lib/guest-reply-draft'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const gate = await requireLevel('messages', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({} as any))
  const conversationId = String(b?.conversationId || '').trim()
  if (!conversationId) return NextResponse.json({ ok: false, error: 'Which conversation?' }, { status: 400 })
  const r = await draftGuestReply(conversationId)
  return NextResponse.json(r)
}
