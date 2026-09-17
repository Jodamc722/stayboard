// SAVE THE TEAM CARDS AS THE HOUSE DEFAULT.
//
// Jon, 2026-09-17: "take photo that I uploaded and use as standard for all slides." He had just
// uploaded three headshots through the new picker, and they landed where every edit on a deck
// lands — in THAT report's content JSON. So the next onboarding he generates would open with
// monograms again and he would upload the same three faces a second time.
//
// The team is house-standard, not owner-specific: the same four people run every unit. It
// belongs in the onboarding template in app_settings, which buildOnboardingContent already reads
// (getOnboardingTemplate -> t.team). This route is the missing write for that one slice.
//
// It takes ONLY the team block. The rest of the template — money rules, the ramp doctrine, the
// questions — is edited in settings and must not be overwritten by whatever a single deck
// happens to be carrying.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireLevel } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'
import { ONBOARDING_TEMPLATE_KEY } from '@/lib/onboarding-report'

export const dynamic = 'force-dynamic'

const str = (v: any) => (typeof v === 'string' ? v.trim() : '')

export async function POST(req: NextRequest) {
  // Writing the template changes every FUTURE deck for every owner, so this is gated like the
  // other settings writes rather than on "is signed in".
  const gate = await requireLevel('optimize', 'edit')
  if (!gate.ok) return gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const incoming = Array.isArray(body?.people) ? body.people : null
  if (!incoming) return NextResponse.json({ error: 'people array required' }, { status: 400 })
  if (incoming.length > 8) return NextResponse.json({ error: 'Too many people.' }, { status: 400 })

  // Keep the shape the template declares, and drop anything blank rather than saving an empty
  // card that renders as a nameless monogram on every future deck.
  const people = incoming.map((p: any) => ({
    name: str(p?.name),
    role: str(p?.role),
    blurb: str(p?.blurb),
    photo: str(p?.photo) || null,
    phone: str(p?.phone),
    email: str(p?.email),
    market: str(p?.market),
  })).filter((p: any) => p.name || p.role)

  if (!people.length) return NextResponse.json({ error: 'Nothing to save — the cards are empty.' }, { status: 400 })

  let tpl: any = {}
  try { tpl = (await getSetting<any>(ONBOARDING_TEMPLATE_KEY, {})) || {} } catch { tpl = {} }
  if (tpl && typeof tpl === 'object' && !Array.isArray(tpl)) {
    // Only the support block travels with the team; everything else is left exactly as found.
    const next: any = { ...tpl, team: people }
    if (body?.support && typeof body.support === 'object') {
      next.supportLabel = str(body.support.label) || tpl.supportLabel
      next.supportNote = str(body.support.note) || tpl.supportNote
      next.supportEmail = str(body.support.email) || tpl.supportEmail
    }
    const res = await setSetting(ONBOARDING_TEMPLATE_KEY, next, user.email || null)
    if (!res.ok) return NextResponse.json({ error: res.error || 'could not save' }, { status: 500 })
    return NextResponse.json({ ok: true, saved: people.length })
  }
  return NextResponse.json({ error: 'template is not an object' }, { status: 500 })
}
