// The approvers the "Recommend to file" dropdown offers (lib/claim-reviewers).
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireVrUser } from '@/lib/vr-gate'
import { claimReviewers } from '@/lib/claim-reviewers'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  return NextResponse.json({ ok: true, reviewers: await claimReviewers(supabaseAdmin()) })
}
