// Sync route — pulls reservations / listings / custom fields / conversations from Guesty
// and upserts into Supabase.
//
// Triggered by:
//   1. Vercel cron (every 15 min) — Authorization: Bearer ${CRON_SECRET}
//   2. Manual button in the UI from authenticated users
//
// In all cases, this code runs server-side so it can use the service-role key.
import { NextRequest, NextResponse } from 'next/server'
import { runFullSync } from '@/lib/guesty'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function authorize(req: NextRequest): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Vercel cron sends Authorization: Bearer ${CRON_SECRET}
  const auth = req.headers.get('authorization') || ''
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return { ok: true }
  // Otherwise require a logged-in Supabase user
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) return { ok: true }
  return { ok: false, reason: 'unauthorized' }
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req)
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 })
  const started = Date.now()
  try {
    const full = new URL(req.url).searchParams.get('full') === '1'
    const result = await runFullSync(full)
    return NextResponse.json({
      ok: true,
      elapsed_ms: Date.now() - started,
      ...result
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 })
  }
}

// Allow GET for Vercel cron (which sends GET requests)
export const GET = POST
