// ADAM — the Garden Hotel's agent, as an API.
//
//   POST { messages }                        → his reply (view level on 'garden')
//   POST { rate: { chatId, rating, note? } } → thumbs / correction
//   GET                                      → settings, memories, recent chats (for /garden/adam)
//   PUT  { name?, direction?, enabled? }     → settings (owner)
//   DELETE { id }                            → forget one memory (edit level)
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel, requireAdmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { runAdam, rateAdam, adamSettings, saveAdamSettings, adamMemories, adamForget, adamRemember } from '@/lib/garden/adam'
import { tierFor } from '@/lib/ai-models'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const gate = await requireLevel('garden', 'view')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  if (b?.rate) {
    const r = b.rate
    if (!r.chatId) return NextResponse.json({ error: 'chatId required' }, { status: 400 })
    await rateAdam(String(r.chatId), Number(r.rating) > 0 ? 1 : -1, r.note ? String(r.note).slice(0, 600) : null, gate.access.email || null)
    return NextResponse.json({ ok: true })
  }
  if (b?.teach) {
    const id = await adamRemember({ content: String(b.teach), kind: b.kind || 'rule', subject: b.subject || 'hotel', source: 'jon', by: gate.access.email || null, confidence: 0.95 })
    return NextResponse.json({ ok: !!id, id })
  }
  const out = await runAdam({ access: gate.access, messages: Array.isArray(b?.messages) ? b.messages : [] })
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ reply: out.reply, chatId: out.chatId, meta: out.meta })
}

export async function GET() {
  const gate = await requireLevel('garden', 'view')
  if (!gate.ok) return gate.res
  try {
    const [settings, memories, tier, { data: chats }] = await Promise.all([
      adamSettings(), adamMemories(200), tierFor('adam'),
      supabaseAdmin().from('garden_agent_chats').select('id,email,question,reply,tools,model,rating,note,created_at').order('created_at', { ascending: false }).limit(40),
    ])
    return NextResponse.json({ ok: true, settings, tier, memories, chats: chats || [] })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
}

export async function PUT(req: NextRequest) {
  const gate = await requireAdmin('owner')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const patch: any = {}
  if (typeof b?.name === 'string' && b.name.trim()) patch.name = b.name.trim().slice(0, 40)
  if (typeof b?.direction === 'string') patch.direction = b.direction.slice(0, 2000)
  if (typeof b?.enabled === 'boolean') patch.enabled = b.enabled
  await saveAdamSettings(patch, gate.access.email || 'owner')
  return NextResponse.json({ ok: true, settings: await adamSettings() })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireLevel('garden', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  if (!b?.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await adamForget(String(b.id))
  return NextResponse.json({ ok: true })
}
