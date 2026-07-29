// PUBLIC property guide - the link we send guests: what is on this week, hours, menu, things to do.
// Fully open (no login, no password). The SAME url with ?admin=1 asks for the StayBoard admin
// password and turns the page into an editor. Content lives in app_settings under 'guide:<slug>'.
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createClient } from '@/lib/supabase-server'
import { verifyEditToken } from '@/lib/edit-access'
import { guideKey, normSlug, seedFor, type Guide } from '@/lib/guide'
import { GuideView } from '@/components/GuideView'

export const dynamic = 'force-dynamic'

async function load(slug: string): Promise<Guide> {
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', guideKey(slug)).limit(1)
    const row = (data || [])[0] as any
    if (row && row.value) {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
      if (parsed && typeof parsed === 'object') return parsed as Guide
    }
  } catch { /* seed below */ }
  return seedFor(slug)
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const slug = normSlug(params.slug)
  const g = await load(slug)
  const title = (g.hero && g.hero.title) || 'Your stay'
  const description = (g.hero && g.hero.subtitle) || 'Hours, events, menu and things to do.'
  const image = (g.hero && g.hero.image) || ''
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, type: 'website', images: image ? [{ url: image }] : undefined },
    twitter: { card: image ? 'summary_large_image' : 'summary', title, description, images: image ? [image] : undefined },
  }
}

export default async function GuidePage({ params }: { params: { slug: string } }) {
  const slug = normSlug(params.slug) || 'garden'
  const content = await load(slug)
  let signedIn = false
  try {
    const { data } = await createClient().auth.getUser()
    signedIn = !!(data && data.user)
  } catch { signedIn = false }
  let unlocked = false
  try { unlocked = verifyEditToken(cookies().get('sb_guide')?.value) } catch { unlocked = false }
  return <GuideView slug={slug} initial={content} canEdit={signedIn || unlocked} />
}
