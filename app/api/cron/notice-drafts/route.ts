// ARRIVAL-DAY NOTICE DRAFTS — cron runner + signed-in preview.
//
//   GET               → draft today's unsent front-desk notices into Gmail (cron or signed-in)
//   GET ?preview=1    → count what WOULD be drafted, create nothing (signed-in)
//
// Runs each morning; exactly-once per notice via reservation_notices.draft_created_at.
// Off by default — the switch lives in Settings → Task automation.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { runNoticeDrafts } from '@/lib/notice-drafts'
import { gmailProfileEmail } from '@/lib/gmail-send'
import { getTaskAutomation } from '@/lib/auto-inspections'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function signedIn(): Promise<boolean> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return !!user
  } catch { return false }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const isCron = secret ? auth === 'Bearer ' + secret : (!!req.headers.get('x-vercel-cron') || auth === '')
  const preview = new URL(req.url).searchParams.get('preview') === '1'

  if (preview) {
    if (!(await signedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  } else if (!isCron && !(await signedIn())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const out = await runNoticeDrafts({ dryRun: preview })
    // The mailbox the token ACTUALLY opens (users/me/profile) — when this differs from the
    // configured fromEmail, every draft is landing in the wrong account's Drafts folder.
    let mailbox: string | null = null
    try { mailbox = await gmailProfileEmail((await getTaskAutomation()).noticeDrafts.fromEmail) } catch { /* debug only */ }
    return NextResponse.json({ ...out, mailbox })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
