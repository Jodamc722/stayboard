// WHAT EVE THINKS OUR VOICE SOUNDS LIKE — readable, and re-runnable on demand.
//
// The nightly pass writes this on its own, but a learned voice that nobody can inspect is a voice
// nobody can correct. GET shows exactly what is in her prompt right now, including where she read
// it and when; POST re-reads the channels immediately, which is what you want after inviting the
// bot to a new room rather than waiting until tomorrow morning.
import { NextResponse } from 'next/server'
import { getLingo, learnLingo } from '@/lib/eve/voice'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET() {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const lingo = await getLingo()
  return NextResponse.json({
    ok: true,
    learned: !!(lingo.text || lingo.terms.length),
    ...lingo,
    note: lingo.learnedAt ? undefined : 'Nothing learned yet. POST here to read the channels now, or wait for the nightly pass.',
  })
}

export async function POST() {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const res = await learnLingo()
  return NextResponse.json(res, { status: res.ok ? 200 : 400 })
}
