// THE PHOTO LIBRARY (Jon, 2026-10-27) — every property and unit photo as Guesty holds it: browse,
// view, download one, a picked set, a unit or a whole property as a ZIP.
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { Shell } from '@/components/Shell'
import { PhotoLibrary } from '@/components/PhotoLibrary'

export const dynamic = 'force-dynamic'

export default async function PhotosPage() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  const access = await getAccess()
  const canEdit = atLeast(access.levels['photo-library'], 'edit')
  return (
    <Shell>
      <Suspense fallback={null}>
        <PhotoLibrary canEdit={canEdit} />
      </Suspense>
    </Shell>
  )
}
