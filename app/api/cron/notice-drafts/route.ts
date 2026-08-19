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
import { gmailProfileEmail, inspectDraft } from '@/lib/gmail-send'
import { getSetting } from '@/lib/app-settings'
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
    const fromEmail = (await getTaskAutomation()).noticeDrafts.fromEmail
    try { mailbox = await gmailProfileEmail(fromEmail) } catch { /* debug only */ }
    // ?inspect=1 → per-watched-draft label + date state, for the "exists but invisible" mystery.
    let drafts: any[] | undefined
    if (new URL(req.url).searchParams.get('inspect') === '1') {
      try {
        const watch = await getSetting<any[]>('support_draft_watch', [])
        drafts = []
        for (const w of (Array.isArray(watch) ? watch : [])) {
          const info = await inspectDraft(fromEmail, String(w?.draftId || ''))
          drafts.push({ nid: String(w?.nid || '').slice(0, 8), draftId: String(w?.draftId || ''), ...info,
            internalDateIso: info?.internalDate ? new Date(Number(info.internalDate)).toISOString() : null })
        }
      } catch (e: any) { drafts = [{ error: String(e?.message || e).slice(0, 120) }] }
    }
    return NextResponse.json({ ...out, mailbox, ...(drafts ? { drafts } : {}) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
