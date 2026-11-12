// THE OWNER'S LINK TO ONE DIGITAL MAGAZINE (Jon, 2026-11-12: "when you share the digital one with owners it needs
// to be a link for just that guidebook"). /m/<code> opens the page-turning magazine and nothing else: no switch to
// the print version, keynote or one-pager, no share, builder or editing — for the owner and for the team alike
// (the team builds at /r/<code>?view=magazine). Public, like /r/.
import { notFound } from 'next/navigation'
import nextDynamic from 'next/dynamic'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { reword } from '@/lib/sales-reword'
import { picsAsUrls } from '@/lib/pic-url'

const SalesMagazine = nextDynamic(() => import('@/components/SalesMagazine').then(m => m.SalesMagazine))
export const dynamic = 'force-dynamic'

async function load(code: string) {
  if (!/^[0-9a-f]{12,32}$/i.test(code)) return null
  const { data } = await supabaseAdmin().from('owner_reports').select('*').eq('code', code).limit(1)
  const rep: any = (data || [])[0]
  return rep && String(rep.content?.meta?.kind || '') === 'sales' ? rep : null
}

export async function generateMetadata({ params }: { params: { code: string } }) {
  const base = { robots: { index: false, follow: false } }
  const rep = await load(String(params.code || '')).catch(() => null)
  if (!rep) return base
  const ct: any = rep.content || {}
  const origin = process.env.NEXT_PUBLIC_SITE_URL || 'https://lighthouse-stay.vercel.app'
  const building = String(ct?.cma?.building || ct?.hero?.title || rep.scope_label || 'Stay Hospitality')
  const area = String(ct?.cma?.area || '')
  const pic = String(ct?.magazine?.photos?.cover || ct?.hero?.heroImage || '/deck-img/miami-skyline.jpg')
  const image = /^https?:\/\//.test(pic) ? pic : origin + (pic.startsWith('/') ? pic : '/' + pic)
  const title = building + ' · Stay Hospitality'
  const description = `What a residence at ${building}${area ? ' in ' + area : ''} could earn, and who would run it. The digital magazine from Stay Hospitality.`
  return { ...base, title, description, openGraph: { title, description, images: [{ url: image, width: 1200, height: 800 }], type: 'article', siteName: 'Stay Hospitality' }, twitter: { card: 'summary_large_image', title, description, images: [image] } }
}

export default async function OwnerMagazine({ params }: { params: { code: string } }) {
  const rep = await load(String(params.code || ''))
  if (!rep) notFound()
  if (rep.content && typeof rep.content === 'object') rep.content = reword(picsAsUrls(rep.content))
  return <SalesMagazine report={rep} digital reader />
}
