// PUBLIC guest guidebook — read-only, no login. The unguessable UUID doubles as the share token;
// robots are told not to index. Editing/deleting stays behind auth at /guidebooks/[id].
import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { GuidebookView } from '@/components/GuidebookView'

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
    const s = JSON.stringify(gb)
    const exts = ['.jpg', '.jpeg', '.png', '.webp']
    let best = -1
    for (const ext of exts) {
      const i = s.indexOf(ext)
      if (i >= 0) { const start = s.lastIndexOf('http', i); if (start >= 0 && (best < 0 || start < best)) { best = start; img = s.slice(start, i + ext.length) } }
    }
  } catch {}
  const title = name + ' — Guest Guidebook'
  const description = 'Your private guide to ' + name + ': Wi-Fi, check-in, the house guide, local picks and everything you need for a perfect stay.'
  return { ...base, title, description, openGraph: { title, description, type: 'website', images: img ? [{ url: img }] : undefined }, twitter: { card: img ? 'summary_large_image' : 'summary', title, description, images: img ? [img] : undefined } }
}

export default async function PublicGuidebookPage({ params }: { params: { id: string } }) {
  const id = String(params.id || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const { data } = await supabaseAdmin().from('guidebooks').select('*').eq('id', id).limit(1)
  const gb = (data || [])[0]
  if (!gb) notFound()
  return <GuidebookView initial={gb} guest />
}
