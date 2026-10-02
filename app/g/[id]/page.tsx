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

export default async function PublicGuidebookPage({ params, searchParams }: { params: { id: string }; searchParams?: { book?: string } }) {
  const id = String(params.id || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const { data } = await supabaseAdmin().from('guidebooks').select('*').eq('id', id).limit(1)
  const gb = (data || [])[0]
  if (!gb) notFound()
  // PHONE vs BOOK (Jon, 2026-10-02: "guidebook sharable links … optimized for phones, make it
  // great"). Under 768px the guest gets the phone guide (GuideMobile); wider screens and print get
  // the book. ?book=1 forces the book on a phone — the footer link for someone who wants to print.
  const forceBook = String(searchParams?.book || '') === '1'
  const book = <GuidebookView initial={gb} guest photoToken={signPlacePhotoToken(String(gb.id))} />
  if (forceBook) return book
  return (
    <>
      <div className="md:hidden print:hidden"><GuideMobile gb={gb} /></div>
      <div className="hidden md:block print:block">{book}</div>
    </>
  )
}
