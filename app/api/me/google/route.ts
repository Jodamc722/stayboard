// MY GOOGLE CONNECTION (lib/google-mine): is my account connected, and can it send mail and read my calendar.
//   GET → { ok, google: { email, connected, mail, calendar } }
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/access'
import { myGoogle } from '@/lib/google-mine'

export const dynamic = 'force-dynamic'
export async function GET() {
  const g = await requireUser(); if (!g.ok) return g.res
  return NextResponse.json({ ok: true, google: await myGoogle(String(g.access.email || '')) })
}
