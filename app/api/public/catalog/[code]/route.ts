// PUBLIC catalog link (Jon, 2026-10-27). The code IS the capability: an unknown code is a 404 and
// nothing else is computed.
//   GET                      → in 'view' mode the approved list; in 'select' mode every allowed option + the owner's picks
//   POST { itemKey, src }    → the owner's choice for one item (select mode only; src null clears it)
import { NextRequest, NextResponse } from 'next/server'
import { readShared, ownerPick } from '@/lib/ffe-approved-catalog'

export const dynamic = 'force-dynamic'
const str = (v: any) => (typeof v === 'string' ? v.trim() : '')

export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const r = await readShared(String(params.code || ''))
  if (!r) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true, catalog: r.catalog, decisions: r.decisions, mode: r.mode, canEdit: false }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const b = await req.json().catch(() => ({}))
  const itemKey = str(b.itemKey)
  if (!itemKey) return NextResponse.json({ ok: false, error: 'Which item?' }, { status: 400 })
  const r = await ownerPick(String(params.code || ''), itemKey, b.src == null ? null : str(b.src))
  if (!r.ok) return NextResponse.json(r, { status: r.error === 'not found' ? 404 : 400 })
  return NextResponse.json(r)
}
