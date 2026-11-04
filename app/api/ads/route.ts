// AD STUDIO projects (Jon, 2026-11-02). See lib/ad-studio.ts.
//   GET                 → the list
//   GET ?id=            → one project (+ a signed URL for its voice take)
//   POST { new: true }  → a fresh project with the house defaults
//   POST { project }    → save
//   DELETE ?id=         → delete it and its voice takes (edit — Jon, 2026-11-04: "need to be able to delete ads")
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { listProjects, getProject, saveProject, deleteProject, newProject, signedAudio, normalize } from '@/lib/ad-studio'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const g = await requireLevel('ads', 'view'); if (!g.ok) return g.res
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (id) {
      const p = await getProject(id)
      if (!p) return NextResponse.json({ ok: false, error: 'No such ad.' }, { status: 404 })
      return NextResponse.json({ ok: true, project: p, audioUrl: p.voice ? await signedAudio(p.voice.path) : null })
    }
    return NextResponse.json({ ok: true, projects: await listProjects() })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  const by = String(g.access.email || '')
  try {
    const b = await req.json().catch(() => ({} as any))
    if (b?.new) return NextResponse.json({ ok: true, project: await newProject(by) })
    if (!b?.project) return NextResponse.json({ ok: false, error: 'Nothing to save.' }, { status: 400 })
    const saved = await saveProject(normalize(b.project), by)
    return NextResponse.json({ ok: true, project: saved })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 })
  try { await deleteProject(id); return NextResponse.json({ ok: true }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
