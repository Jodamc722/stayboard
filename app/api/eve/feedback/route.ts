// Thumbs on an Eve answer — and, when it is a thumbs-down with a note, the correction becomes a
// MEMORY so the same mistake does not come back next week. That is the whole improvement loop:
// without a written correction a thumbs-down is just a feeling that evaporates.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { saveMemory } from '@/lib/eve/memory'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const id = String(body?.chatId || '')
  if (!id) return NextResponse.json({ error: 'chatId required' }, { status: 400 })
  const rating = body?.rating === 1 ? 1 : body?.rating === -1 ? -1 : null
  const correction = String(body?.correction || '').trim().slice(0, 1000)
  const db = supabaseAdmin()

  const { error } = await db.from('eve_chats').update({ rating, correction: correction || null }).eq('id', id)
  if (error) return NextResponse.json({ error: 'Could not save feedback — migration 045 may not have run.' }, { status: 500 })

  let memoryId: string | null = null
  if (correction) {
    // `voice` corrections are preferences (how she sounds); everything else is a correction
    // (what she got wrong). Both carry weight 9 — Jon typed them on purpose.
    const isVoice = body?.kind === 'voice'
    const saved = await saveMemory({
      kind: isVoice ? 'preference' : 'correction',
      text: correction,
      why: isVoice ? 'Jon said an answer did not sound like him' : 'Jon corrected an answer',
      scope: 'portfolio', weight: 9, source: 'jon',
      created_by: String(gate.access.email || ''),
      evidence: { chatId: id },
    })
    memoryId = saved.id || null
  }
  return NextResponse.json({ ok: true, memoryId })
}
