// ONE EVE CONVERSATION — its turns, read back from eve_chats (Jon, 2026-11-05: "EVE chat needs to be
// a learning chat, where we can teach Eve"). GET → { ok, conversation: { id, title, … }, turns:
// [{ chatId, question, answer, rating, at, tools }] }. Only its owner (or Jon) may read it.
import { NextRequest, NextResponse } from 'next/server'
import { eveGate } from '../../../agent/route'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { canSeeMoney } from '@/lib/access'
import { maskMoneyText } from '@/lib/eve/redact'
import { conversationFor, conversationTurns } from '@/lib/eve/conversations'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  if (!isVrLogin(gate.access)) return hotelOnlyRes()
  const conv = await conversationFor(String(params?.id || ''), gate.access.email)
  if (!conv) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const money = canSeeMoney(gate.access)
  const turns = (await conversationTurns(conv.id)).map(t => ({
    chatId: t.chatId, at: t.at, rating: t.rating, tools: t.tools,
    question: t.question, answer: money ? t.answer : maskMoneyText(t.answer),
  }))
  return NextResponse.json({ ok: true, conversation: { id: conv.id, title: conv.title, created_at: conv.created_at, updated_at: conv.updated_at }, turns })
}
