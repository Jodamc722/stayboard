// The "Our properties" list from Lighthouse — see portfolioProperties. Team only.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { portfolioProperties } from '@/lib/building-photos'
import { EXPERIENCE_ITEMS } from '@/lib/onboarding-copy'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const items = await portfolioProperties(EXPERIENCE_ITEMS as any)
  return NextResponse.json({ ok: true, items })
}
