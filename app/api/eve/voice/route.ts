// Eve's editable voice profile — the same pattern as the review-reply voice in /users
// (app_settings key `review_voice`), so Jon can tune how she sounds without a deploy.
import { NextRequest, NextResponse } from 'next/server'
import { getSetting, setSetting } from '@/lib/app-settings'
import { EVE_VOICE_KEY } from '@/lib/eve/prompt'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

export async function GET() {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const v = await getSetting<any>(EVE_VOICE_KEY, null)
  return NextResponse.json({ ok: true, text: v && typeof v === 'object' ? String(v.text || '') : '' })
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  // app_settings.value is TEXT and a BARE SCALAR round-trips to the fallback — always wrap.
  const res = await setSetting(EVE_VOICE_KEY, { text: String(body?.text || '').slice(0, 2000) }, String(gate.access.email || ''))
  if (!res.ok) return NextResponse.json({ error: res.error || 'save failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
