// RECURRING PROJECTS — the morning pass that makes the next one.
//
//   GET /api/cron/project-recur        6:35am ET (before the reminders and the digest, so a new 1:1
//                                      already exists when its owner's morning email is built)
//   GET ?dry=1                         signed-in only: which series are due, nothing created
//
// House auth: CRON_SECRET bearer when set, else Vercel's x-vercel-cron header; a signed-in person
// may run it by hand. Idempotent — the schedule moves with the instance, so running twice in a
// morning creates nothing the second time.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { withReceipt } from '@/lib/automation-runs'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { runRecurrences } from '@/lib/project-templates'
import { todayISO } from '@/lib/projects-shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function signedIn(): Promise<boolean> {
  try { const { data: { user } } = await createClient().auth.getUser(); return !!user } catch { return false }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const isCron = secret ? auth === 'Bearer ' + secret : !!req.headers.get('x-vercel-cron')
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const me = await signedIn()
  if (dry ? !me : (!isCron && !me)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const today = todayISO()
  try {
    if (dry) {
      const { data } = await supabaseAdmin().from('projects').select('id,title,recurs').not('recurs', 'is', null).eq('archived', false).limit(200)
      const due = ((data || []) as any[]).filter(p => p.recurs?.next_on && p.recurs.next_on <= today).map(p => ({ id: p.id, title: p.title, next_on: p.recurs.next_on }))
      return NextResponse.json({ ok: true, dry: true, today, due })
    }
    const out = await withReceipt('project-recur', () => runRecurrences(today), o => ({ itemCount: o.created.length, detail: o }))
    return NextResponse.json({ ok: true, today, ...out })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
