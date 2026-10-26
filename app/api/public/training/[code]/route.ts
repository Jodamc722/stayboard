// A PERSON'S TRAINING PAGE, NO LOGIN (Jon, 2026-10-26). /learn/<code> is the link a housekeeper or
// technician opens on their phone: the videos and FAQs assigned to them, in English or Spanish, with
// a Done button. The code is the capability; nothing here can list other people or the library.
//
//   GET                               the person's items with six-hour play URLs
//   POST { action: 'complete' | 'view' | 'lang', itemId?, lang? }
import { NextRequest, NextResponse } from 'next/server'
import { personByCode, bundleForPerson, complete, recordView, updatePerson } from '@/lib/training'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status })
const langOf = (v: any) => (String(v || '').toLowerCase() === 'es' ? 'es' : 'en') as 'en' | 'es'

export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const p = await personByCode(params.code)
  if (!p) return bad('This training link is not valid.', 404)
  try {
    const b = await bundleForPerson(p)
    return NextResponse.json({ ok: true, ...b })
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const p = await personByCode(params.code)
  if (!p) return bad('This training link is not valid.', 404)
  const body = await req.json().catch(() => ({} as any))
  const action = String(body?.action || '')
  try {
    switch (action) {
      case 'complete': {
        const r = await complete(String(body.itemId || ''), p.key, langOf(body.lang), 'link')
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'view': {
        await recordView(String(body.itemId || ''), p.key, langOf(body.lang))
        return NextResponse.json({ ok: true })
      }
      case 'lang': {
        const u = await updatePerson(p.key, { lang: langOf(body.lang) })
        return NextResponse.json({ ok: !!u })
      }
      default:
        return bad('Unknown action.')
    }
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}
