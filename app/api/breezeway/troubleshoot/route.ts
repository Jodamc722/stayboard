// DRAFT THE TROUBLESHOOT BLOCK BEFORE THE TASK IS PUSHED (Jon, 2026-11-05). The Add-a-task sheet
// calls this when the type is Maintenance; the coordinator edits the text and it rides the create as
// `troubleshoot`. Nothing is written anywhere here.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { troubleshootBlock } from '@/lib/troubleshoot'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

export async function POST(req: NextRequest) {
  const gate = await requireLevel('plan', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({} as any))
  const name = String(b?.name || '').slice(0, 160)
  if (!name.trim()) return NextResponse.json({ ok: false, error: 'Add a title first — the steps are written for the issue.' }, { status: 400 })
  let homeId = Number(b?.homeId)
  if (!Number.isFinite(homeId) && b?.listingId) {
    const { data } = await supabaseAdmin().from('breezeway_properties').select('home_id').eq('reference_property_id', String(b.listingId)).limit(1)
    homeId = Number(data?.[0]?.home_id)
  }
  const text = (await troubleshootBlock({ name, description: String(b?.description || '').slice(0, 1500), home_id: Number.isFinite(homeId) ? homeId : null })).trim()
  return NextResponse.json({ ok: true, text })
}
