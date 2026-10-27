// THE PRESENTER, SAVED ONCE FOR THE HOUSE (Jon, 2026-10-27: "better customization tools").
// GET  -> the saved card
// POST -> save it   { name, role, phone, email, photo, blurb }
//
// Retyping a name, a title, a direct line and re-uploading a photograph on every proposal is the
// kind of friction that ends with decks going out with the last person's details on them. This is
// one row in app_settings, seeded into every sales deck at generate time, and still editable on
// the slide afterwards — the deck owns its copy, so changing the default never rewrites a
// proposal already sent.
import { NextRequest, NextResponse } from 'next/server'
import { getSetting, setSetting } from '@/lib/app-settings'
import { requireLevel } from '@/lib/access'
import { SALES_CONTACT_KEY, type SalesContactSetting } from '@/lib/sales-copy'

export const dynamic = 'force-dynamic'

const BLANK: SalesContactSetting = { name: '', role: '', phone: '', email: '', photo: '', blurb: '' }
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function GET() {
  const gate = await requireLevel('reports', 'view')
  if (!gate.ok) return gate.res
  return NextResponse.json({ ok: true, contact: await getSetting<SalesContactSetting>(SALES_CONTACT_KEY, BLANK) })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('reports', 'edit')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const card: SalesContactSetting = {
    name: str(body?.name).slice(0, 80),
    role: str(body?.role).slice(0, 80),
    phone: str(body?.phone).slice(0, 40),
    email: str(body?.email).slice(0, 120),
    // A data: URI photograph would be megabytes in a settings row; the deck's picker uploads and
    // stores a URL, which is what lands here.
    photo: /^https?:\/\//i.test(str(body?.photo)) || str(body?.photo).startsWith('/') ? str(body.photo).slice(0, 500) : '',
    blurb: str(body?.blurb).slice(0, 400),
  }
  if (!card.name) return NextResponse.json({ error: 'Add your name before saving it as the default.' }, { status: 400 })
  const r = await setSetting(SALES_CONTACT_KEY, card)
  if (!r.ok) return NextResponse.json({ error: r.error || 'Could not save.' }, { status: 500 })
  return NextResponse.json({ ok: true, contact: card })
}
