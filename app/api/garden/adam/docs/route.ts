// ADAM'S LIBRARY (lib/garden/adam-docs).
//   GET                                                        → { docs, categories }      (adam view)
//   POST { title, category, body, source?, file_path?, learn? } → file it, chunk it, learn  (adam edit)
//   DELETE { id }                                              → retire                    (adam edit)
import { NextRequest, NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { listAdamDocs, saveAdamDoc, retireAdamDoc, ADAM_DOC_CATEGORIES } from '@/lib/garden/adam-docs'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET() {
  const gate = await requireGarden('adam', 'view')
  if (!gate.ok) return gate.res
  try { return NextResponse.json({ ok: true, docs: await listAdamDocs(), categories: ADAM_DOC_CATEGORIES }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireGarden('adam', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  try { return NextResponse.json({ ok: true, ...(await saveAdamDoc({ ...b, by: gate.access.email || null })) }) }
  catch (e: any) { return NextResponse.json({ error: String(e?.message || e) }, { status: 400 }) }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireGarden('adam', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  await retireAdamDoc(String(b?.id || ''))
  return NextResponse.json({ ok: true })
}
