// Pictures for the "Our Properties" slide.
//
//   GET          → { photos }               one auto picture per building (first listing's first shot)
//   GET ?all=1   → { photos, listings, chosen }  every listing's photos per building, plus the
//                  picture Jon chose once for all decks (the onboarding template's propertyPics)
//   POST { building, url }  → save that choice for every deck; url '' clears it
//
// Jon, 2026-09-24: "I need to see only the property listing photos. Once select, save for all
// properties." So the picker shows the building's listings and nothing else, and the pick is a
// template fact, not a per-deck edit: the next deck starts with it, and decks already open pick it
// up when opened for editing (ReportView fills auto pictures, never a hand-uploaded one).
import { NextRequest, NextResponse } from 'next/server'
import { buildingPhotos, buildingListingPhotos } from '@/lib/building-photos'
import { hasEditCookie } from '@/lib/edit-access'
import { requireUser } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'
import { ONBOARDING_TEMPLATE_KEY } from '@/lib/onboarding-report'

export const dynamic = 'force-dynamic'

async function chosen(): Promise<Record<string, string>> {
  try { const t = (await getSetting<any>(ONBOARDING_TEMPLATE_KEY, {})) || {}; return (t.propertyPics && typeof t.propertyPics === 'object') ? t.propertyPics : {} } catch { return {} }
}

export async function GET(req: NextRequest) {
  const gate = await requireUser()
  if (!gate.ok && !hasEditCookie()) return gate.res
  const [auto, picked] = await Promise.all([buildingPhotos(), chosen()])
  const photos = { ...auto, ...picked }
  if (req.nextUrl.searchParams.get('all') === '1') {
    const listings = await buildingListingPhotos(16)
    return NextResponse.json({ ok: true, photos, auto, chosen: picked, listings })
  }
  return NextResponse.json({ ok: true, photos })
}

export async function POST(req: NextRequest) {
  const gate = await requireUser()
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const building = String(b?.building || '').trim(), url = String(b?.url || '').trim()
  if (!building) return NextResponse.json({ error: 'building required' }, { status: 400 })
  if (url && !/^https?:\/\//.test(url) && !url.startsWith('/')) return NextResponse.json({ error: 'not a url' }, { status: 400 })
  let tpl: any = {}
  try { tpl = (await getSetting<any>(ONBOARDING_TEMPLATE_KEY, {})) || {} } catch { tpl = {} }
  const pics = { ...((tpl.propertyPics && typeof tpl.propertyPics === 'object') ? tpl.propertyPics : {}) }
  if (url) pics[building] = url; else delete pics[building]
  const res = await setSetting(ONBOARDING_TEMPLATE_KEY, { ...tpl, propertyPics: pics }, gate.access.email || null)
  if (res && (res as any).ok === false) return NextResponse.json({ error: (res as any).error || 'could not save' }, { status: 500 })
  return NextResponse.json({ ok: true, chosen: pics })
}
