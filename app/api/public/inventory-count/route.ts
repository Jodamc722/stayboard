// THE COUNTER'S SIDE. Public by design: the code is the only key, and everything here is scoped to
// one link. Nothing on this route can list links, reach a reservation, or read a guest.
//
//   GET  ?code=…            the shelves to pick from
//   GET  ?code=…&scope=…    the sheet for one shelf
//   POST { code, scope, counter, counts[] }   write the count
import { NextRequest, NextResponse } from 'next/server'
import { linkByCode, shelvesFor, sheetFor, submitCount } from '@/lib/inventory-count'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** A passcode is compared here and never sent to the browser. */
function passOk(link: { passcode: string | null }, given: string): boolean {
  if (!link.passcode) return true
  return String(given || '').trim() === String(link.passcode).trim()
}

export async function GET(req: NextRequest) {
  const code = String(req.nextUrl.searchParams.get('code') || '').trim()
  const link = await linkByCode(code)
  if (!link) return NextResponse.json({ ok: false, error: 'This counting link is not valid.' }, { status: 404 })
  const pass = String(req.nextUrl.searchParams.get('pass') || '')
  if (!passOk(link, pass)) return NextResponse.json({ ok: false, needsPasscode: true, label: link.label || 'Stock count' }, { status: 200 })

  const scope = String(req.nextUrl.searchParams.get('scope') || '')
  if (!scope) return NextResponse.json({ ok: true, label: link.label || 'Stock count', shelves: await shelvesFor() })
  const sheet = await sheetFor(scope)
  return NextResponse.json({ ok: true, label: link.label || 'Stock count', scope, shelf: sheet.label, items: sheet.items })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const link = await linkByCode(String(body?.code || '').trim())
  if (!link) return NextResponse.json({ ok: false, error: 'This counting link is not valid.' }, { status: 404 })
  if (!passOk(link, String(body?.pass || ''))) return NextResponse.json({ ok: false, error: 'That passcode is not right.' }, { status: 403 })
  // Blanks are dropped HERE as well as in the browser — "leave it alone" is the rule that makes a
  // partial count safe, and it must not depend on the phone getting it right.
  const counts = (Array.isArray(body?.counts) ? body.counts : [])
    .map((c: any) => ({ itemId: String(c?.itemId || ''), count: Number(c?.count) }))
    .filter((c: any) => c.itemId && Number.isFinite(c.count) && c.count >= 0)
  const r = await submitCount({ scope: String(body?.scope || ''), counter: String(body?.counter || ''), note: String(body?.note || ''), linkCode: link.code, counts })
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
  const c = r.count!
  return NextResponse.json({ ok: true, counted: c.items, changed: c.changed, at: c.created_at, by: c.counted_by, lines: c.lines })
}
