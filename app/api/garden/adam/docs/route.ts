// ADAM'S LIBRARY (lib/garden/adam-docs).
//   GET                                                        → { docs, categories }      (adam view)
//   POST { title, category, body, source?, file_path?, learn? } → file it, chunk it, learn  (adam edit)
//   POST { cloudbedsGuides: true }   → file + learn Cloudbeds' own procedures (lib/garden/sop-learn)
//   POST { observe: true }           → draft "how our desk works" from the hotel's data (inactive until approved)
//   POST { approve: id, body? }      → the draft becomes a live SOP and Adam learns it
//   DELETE { id }                                              → retire                    (adam edit)
import { NextRequest, NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { listAdamDocs, saveAdamDoc, retireAdamDoc, ADAM_DOC_CATEGORIES } from '@/lib/garden/adam-docs'
import { learnCloudbedsGuides, observeDeskSop, approveDraft, draftDocs } from '@/lib/garden/sop-learn'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET() {
  const gate = await requireGarden('adam', 'view')
  if (!gate.ok) return gate.res
  try { return NextResponse.json({ ok: true, docs: await listAdamDocs(), categories: ADAM_DOC_CATEGORIES, drafts: await draftDocs().catch(() => []) }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireGarden('adam', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const by = gate.access.email || null
  try {
    if (b?.cloudbedsGuides) return NextResponse.json({ ok: true, ...(await learnCloudbedsGuides(by)) })
    if (b?.observe) { const r = await observeDeskSop(by); return NextResponse.json(r, { status: r.ok ? 200 : 400 }) }
    if (b?.approve) { const r = await approveDraft(String(b.approve), b?.body ? String(b.body) : null, by); return NextResponse.json(r, { status: r.ok ? 200 : 400 }) }
  } catch (e: any) { return NextResponse.json({ error: String(e?.message || e) }, { status: 400 }) }
  try { return NextResponse.json({ ok: true, ...(await saveAdamDoc({ ...b, by })) }) }
  catch (e: any) { return NextResponse.json({ error: String(e?.message || e) }, { status: 400 }) }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireGarden('adam', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  if (b?.discard) {   // a draft never approved: stop listing it
    const { supabaseAdmin } = await import('@/lib/supabase-admin')
    const db = supabaseAdmin(); const { data } = await db.from('garden_agent_docs').select('title').eq('id', String(b?.id || '')).maybeSingle()
    if (data) await db.from('garden_agent_docs').update({ active: false, title: String((data as any).title) + ' · superseded' }).eq('id', String(b.id))
    return NextResponse.json({ ok: true })
  }
  await retireAdamDoc(String(b?.id || ''))
  return NextResponse.json({ ok: true })
}
