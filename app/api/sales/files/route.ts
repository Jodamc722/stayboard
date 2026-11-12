// The Projections library's files (lib/projection-files).
//   GET [?building=<id>]                 → the files (all, or one building's; '' = unfiled), with links to open
//   POST { sign: <file name> }           → a signed upload URL (the browser PUTs the file)
//   POST { meta: { path, name, size, type, buildingId?, note? } } → record it
//   PATCH { id, buildingId?, note?, name? } → file it under a building, or note it
//   DELETE ?id=                          → remove it
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { listFiles, signUpload, addFile, updateFile, deleteFile } from '@/lib/projection-files'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = await requireLevel('sales', 'view'); if (!g.ok) return g.res
  const b = req.nextUrl.searchParams.get('building')
  try { return NextResponse.json({ ok: true, files: await listFiles(b == null ? undefined : b) }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
export async function POST(req: NextRequest) {
  const g = await requireLevel('sales', 'edit'); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  try {
    if (b?.sign) return NextResponse.json({ ok: true, ...(await signUpload(String(b.sign))) })
    if (b?.meta) return NextResponse.json({ ok: true, file: await addFile(b.meta, String(g.access.email || '')) })
    return NextResponse.json({ ok: false, error: 'Nothing to do.' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
export async function PATCH(req: NextRequest) {
  const g = await requireLevel('sales', 'edit'); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  try { await updateFile(String(b?.id || ''), b || {}, String(g.access.email || '')); return NextResponse.json({ ok: true }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 400 }) }
}
export async function DELETE(req: NextRequest) {
  const g = await requireLevel('sales', 'edit'); if (!g.ok) return g.res
  try { await deleteFile(String(req.nextUrl.searchParams.get('id') || ''), String(g.access.email || '')); return NextResponse.json({ ok: true }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 400 }) }
}
