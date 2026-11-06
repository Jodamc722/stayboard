// PUBLIC guest guidebook — read-only, no login. The unguessable UUID doubles as the share token;
// robots are told not to index. Editing/deleting stays behind auth at /guidebooks/[id].
import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { GuidebookView } from '@/components/GuidebookView'
import { GuideMobile, GuidePrint } from '@/components/GuideMobile'
import { signPlacePhotoToken } from '@/lib/place-photo-token'
import { buildingGuideFor } from '@/lib/welcome-call-guide'
import { guestUnitNo, guestUnitName, guestUnitFull } from '@/lib/guest-unit'

/** What the page adds to the book at render time: the unit, and the walk to the beach for the print FAQ. */
async function withListing(gb: any): Promise<any> {
  let l: any = null
  if (gb?.listing_id) {
    try { const { data } = await supabaseAdmin().from('guesty_listings').select('id, nickname, title, building, unit, lat:raw->address->>lat, lng:raw->address->>lng').eq('id', gb.listing_id).limit(1); l = (data || [])[0] || null } catch { /* the book alone */ }
  }
  const bg = buildingGuideFor([l?.nickname, l?.building, gb?.listing_name, gb?.title].filter(Boolean).join(' '))
  // The building's beach line only when it is written for guests (staff notes say "confirm…").
  const beach = bg && bg.recs.beach && !/confirm/i.test(bg.recs.beach) ? bg.recs.beach : ''
  const lat = Number(l?.lat), lng = Number(l?.lng)
  return { ...gb, _unit: guestUnitFull(l), _unitName: guestUnitName(l), _unitNo: guestUnitNo(l), _beach: beach, _building: l?.building || '', _nickname: l?.nickname || '',
    _geo: isFinite(lat) && isFinite(lng) && (lat || lng) ? { lat, lng } : null }
}

export const dynamic = 'force-dynamic'
export async function generateMetadata({ params }: { params: { id: string } }) {
  const id = String(params.id || '')
  const base = { robots: { index: false, follow: false } }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return base
  const { data } = await supabaseAdmin().from('guidebooks').select('*').eq('id', id).limit(1)
  const gb = (data || [])[0]
  if (!gb) return base
  let unit = ''
  try { if (gb.listing_id) { const { data: ls } = await supabaseAdmin().from('guesty_listings').select('nickname, building, unit').eq('id', gb.listing_id).limit(1); if (ls && ls[0]) unit = guestUnitFull(ls[0]) } } catch { /* title without it */ }
  const name = (unit ? unit + ' — ' : '') + String(gb.title || 'Your Stay').replace(/\s*[—–-]\s*Guest Guidebook\s*$/i, '').split(/\s+\|\s+/)[0]
  let img = ''
  try {
    const photos = (gb as any)?.sections?._photos
    if (Array.isArray(photos) && photos.length && typeof photos[0] === 'string') img = photos[0]
    if (!img) {
      const s = JSON.stringify(gb)
      const exts = ['jpg', 'jpeg', 'png', 'webp']
      for (const ext of exts) {
        const i = s.indexOf(ext)
        if (i >= 0) { const start = s.lastIndexOf('http', i); if (start >= 0) { img = s.slice(start, i + ext.length); break } }
      }
    }
  } catch {}
  const title = /guidebook/i.test(name) ? name : name + ' — Guest Guidebook'
  const description = 'Your private guide to ' + name + ': Wi-Fi, check-in, the house guide, local picks and everything you need for a perfect stay.'
  return { ...base, title, description, openGraph: { title, description, type: 'website', images: img ? [{ url: img }] : undefined }, twitter: { card: img ? 'summary_large_image' : 'summary', title, description, images: img ? [img] : undefined } }
}

export default async function PublicGuidebookPage({ params, searchParams }: { params: { id: string }; searchParams?: { book?: string; print?: string; printview?: string } }) {
  const id = String(params.id || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const { data } = await supabaseAdmin().from('guidebooks').select('*').eq('id', id).limit(1)
  const row = (data || [])[0]
  if (!row) notFound()
  const gb = await withListing(row)
  // ONE GUIDE, EVERY SCREEN (2026-10-29, Jon: "revamp all guidebooks, clean it up and make it
  // great … optimized for the phone and have a printable setting"). The clean guide (GuideMobile)
  // on phones and laptops alike; printing it gives the short house manual (GuidePrint, inside it).
  // ?print=1 opens the print dialog straight away. The old 12-page magazine book still opens at
  // ?book=1 for anyone who wants it.
  // ?printview=1 — the printed house manual ON SCREEN (the review page's "Printable view").
  if (String((searchParams as any)?.printview || '') === '1') return <div style={{ background: '#e7e7e7', minHeight: '100vh', padding: '1px 12px' }}><GuidePrint gb={gb} screen /></div>
  if (String(searchParams?.book || '') === '1') return <GuidebookView initial={gb} guest photoToken={signPlacePhotoToken(String(gb.id))} />
  return <GuideMobile gb={gb} autoPrint={String(searchParams?.print || '') === '1'} photoToken={signPlacePhotoToken(String(gb.id))} />
}
