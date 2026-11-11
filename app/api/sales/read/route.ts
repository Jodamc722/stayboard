// THE PROJECTIONS READER (lib/sales-read) for the Projections library page.
//   POST multipart { file, scope: 'property'|'unit', unit? } → unit types and figures from a sheet,
//        deck, PDF, Word file or picture
//   POST json { text, scope, unit? }  → the same from pasted text
//   POST json { website }             → the building's name, area, address and residence types
// Nothing is saved here: the page shows what was read, and the team decides what to keep.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readFile, readText, readWebsite } from '@/lib/sales-read'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const g = await requireLevel('sales', 'edit')
  if (!g.ok) return g.res
  try {
    const ct = req.headers.get('content-type') || ''
    if (ct.includes('multipart/form-data')) {
      const fd = await req.formData()
      const f = fd.get('file')
      if (!f || typeof f === 'string') return NextResponse.json({ ok: false, error: 'No file.' }, { status: 400 })
      const scope = fd.get('scope') === 'unit' ? 'unit' : 'property'
      return NextResponse.json({ ok: true, read: await readFile(f as File, scope, String(fd.get('unit') || '') || undefined) })
    }
    const body = await req.json().catch(() => ({} as any))
    if (body?.website) return NextResponse.json({ ok: true, read: await readWebsite(String(body.website).trim().slice(0, 300)) })
    if (body?.text) return NextResponse.json({ ok: true, read: await readText(String(body.text), body.scope === 'unit' ? 'unit' : 'property', body.unit ? String(body.unit) : undefined) })
    return NextResponse.json({ ok: false, error: 'Send a file, pasted text or a website.' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 400 })
  }
}
