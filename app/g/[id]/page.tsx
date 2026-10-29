// PUBLIC guest guidebook — read-only, no login. The unguessable UUID doubles as the share token;
// robots are told not to index. Editing/deleting stays behind auth at /guidebooks/[id].
import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { GuidebookView } from '@/components/GuidebookView'
import { GuideMobile } from '@/components/GuideMobile'
import { signPlacePhotoToken } from '@/lib/place-photo-token'

export const dynamic = 'force-dynamic'
export async function generateMetadata({ params }: { params: { id: string } }) {
  const id = String(params.id || '')
  const base = { robots: { index: false, follow: false } }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return base
  const { data } = await supabaseAdmin().from('guidebooks').select('*').eq('id', id).limit(1)
  const gb = (data || [])[0]
  if (!gb) return base
  const name = gb.title || 'Your Stay'
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

export default async function PublicGuidebookPage({ params, searchParams }: { params: { id: string }; searchParams?: { book?: string; print?: string } }) {
  const id = String(params.id || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const { data } = await supabaseAdmin().from('guidebooks').select('*').eq('id', id).limit(1)
  const gb = (data || [])[0]
  if (!gb) notFound()
  // ONE GUIDE, EVERY SCREEN (2026-10-29, Jon: "revamp all guidebooks, clean it up and make it
  // great … optimized for the phone and have a printable setting"). The clean guide (GuideMobile)
  // on phones and laptops alike; printing it gives the short house manual (GuidePrint, inside it).
  // ?print=1 opens the print dialog straight away. The old 12-page magazine book still opens at
  // ?book=1 for anyone who wants it.
  if (String(searchParams?.book || '') === '1') return <GuidebookView initial={gb} guest photoToken={signPlacePhotoToken(String(gb.id))} />
  return <GuideMobile gb={gb} autoPrint={String(searchParams?.print || '') === '1'} photoToken={signPlacePhotoToken(String(gb.id))} />
}
