// ADAM — the Garden Hotel's agent, as an API.
//
//   POST { messages }                        → his reply (view level on 'garden')
//   POST { rate: { chatId, rating, note? } } → thumbs / correction
//   GET                                      → settings, memories, recent chats (for /garden/adam)
//   PUT  { name?, direction?, enabled? }     → settings (owner)
//   DELETE { id }                            → forget one memory (edit level)
import { NextRequest, NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { runAdam, rateAdam, adamSettings, saveAdamSettings, adamMemories, adamForget, adamRemember } from '@/lib/garden/adam'
import { tierFor } from '@/lib/ai-models'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const gate = await requireGarden('adam', 'view')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  if (b?.rate) {
    const r = b.rate
    if (!r.chatId) return NextResponse.json({ error: 'chatId required' }, { status: 400 })
    await rateAdam(String(r.chatId), Number(r.rating) > 0 ? 1 : -1, r.note ? String(r.note).slice(0, 600) : null, gate.access.email || null)
    return NextResponse.json({ ok: true })
  }
  // The learning loop (migration 118): answer his questions, and the shared bridge to Eve's side.
  if (b?.answer) {
    const g2 = await requireGarden('adam', 'edit'); if (!g2.ok) return g2.res
    const db = supabaseAdmin()
    const { data: q } = await db.from('garden_agent_questions').select('*').eq('id', String(b.answer.id || '')).maybeSingle()
    if (!q) return NextResponse.json({ error: 'question not found' }, { status: 404 })
    const text = String(b.answer.text || '').trim().slice(0, 2000)
    if (b.answer.dismiss) { await db.from('garden_agent_questions').update({ status: 'dismissed', answered_by: g2.access.email || null, answered_at: new Date().toISOString() }).eq('id', q.id); return NextResponse.json({ ok: true }) }
    if (!text) return NextResponse.json({ error: 'answer required' }, { status: 400 })
    await db.from('garden_agent_questions').update({ status: 'answered', answer: text, answered_by: g2.access.email || null, answered_at: new Date().toISOString() }).eq('id', q.id)
    await adamRemember({ content: `${q.question} — ${text}`, kind: 'rule', subject: q.subject || 'hotel', source: 'jon', by: g2.access.email || null, confidence: 0.95 })
    return NextResponse.json({ ok: true })
  }
  if (b?.share) {
    const g2 = await requireGarden('adam', 'full'); if (!g2.ok) return g2.res
    const title = String(b.share.title || '').trim().slice(0, 120), body = String(b.share.body || '').trim().slice(0, 2000)
    if (!title || !body) return NextResponse.json({ error: 'title and body required' }, { status: 400 })
    const { data, error } = await supabaseAdmin().from('shared_knowledge').insert({ title, body, businesses: ['vr', 'garden'], created_by: g2.access.email || null }).select('id').single()
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true, id: data?.id })
  }
  if (b?.unshare) {
    const g2 = await requireGarden('adam', 'full'); if (!g2.ok) return g2.res
    await supabaseAdmin().from('shared_knowledge').update({ active: false }).eq('id', String(b.unshare))
    return NextResponse.json({ ok: true })
  }
  if (b?.teach) {
    const g2 = await requireGarden('adam', 'edit'); if (!g2.ok) return g2.res
    const id = await adamRemember({ content: String(b.teach), kind: b.kind || 'rule', subject: b.subject || 'hotel', source: 'jon', by: gate.access.email || null, confidence: 0.95 })
    return NextResponse.json({ ok: !!id, id })
  }
  const out = await runAdam({ access: gate.access, messages: Array.isArray(b?.messages) ? b.messages : [] })
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ reply: out.reply, chatId: out.chatId, meta: out.meta })
}

export async function GET() {
  const gate = await requireGarden('adam', 'view')
  if (!gate.ok) return gate.res
  try {
    const db = supabaseAdmin()
    const [{ data: questions }, { data: shared }] = await Promise.all([
      db.from('garden_agent_questions').select('*').order('created_at', { ascending: false }).limit(60),
      db.from('shared_knowledge').select('*').eq('active', true).contains('businesses', ['garden']).order('created_at', { ascending: false }),
    ])
    const [settings, memories, tier, { data: chats }] = await Promise.all([
      adamSettings(), adamMemories(200), tierFor('adam'),
      supabaseAdmin().from('garden_agent_chats').select('id,email,question,reply,tools,model,rating,note,created_at').order('created_at', { ascending: false }).limit(40),
    ])
    return NextResponse.json({ ok: true, settings, tier, memories, chats: chats || [], questions: questions || [], shared: shared || [] })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
}

export async function PUT(req: NextRequest) {
  const gate = await requireGarden('adam', 'full')
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
  const gate = await requireGarden('adam', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  if (!b?.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await adamForget(String(b.id))
  return NextResponse.json({ ok: true })
}
