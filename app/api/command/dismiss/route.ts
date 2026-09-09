// CLEAR a Command Center row for the day — SHARED. Stored in app_settings under `command_dismissed`
// keyed by ET date, so every device and every person sees the same list (the per-device
// localStorage "handled" ticks it replaces showed two supervisors two different counts).
//
// POST   { key, outcome?, title?, unit? }
//          outcome 'done'    → the work happened; the row lands in Completed
//          outcome 'skipped' → not relevant today (the default — what "dismiss" always meant)
//        title/unit are stored so a row the engine stops generating (you created the inspection,
//        so "no inspection" is gone) can still be listed under Completed with its words.
// DELETE { key }  → bring it back (omit key to bring back everything cleared today)
// Days older than yesterday are pruned on every write so the setting never grows.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getSetting, setSetting } from '@/lib/app-settings'
import { DISMISS_KEY } from '@/lib/command-day'

export const dynamic = 'force-dynamic'

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

type Entry = { by: string; at: string; outcome?: 'done' | 'skipped'; title?: string; unit?: string }

async function mutate(req: NextRequest, remove: boolean) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const key = String(body?.key || '').slice(0, 200)
  if (!remove && !key) return NextResponse.json({ ok: false, error: 'key required' }, { status: 400 })
  const today = ymd(new Date())
  const yesterday = ymd(new Date(Date.now() - 86400000))
  const cur = (await getSetting<any>(DISMISS_KEY, null)) || {}
  const next: Record<string, Record<string, Entry>> = {}
  for (const d of Object.keys(cur)) if (d === today || d === yesterday) next[d] = cur[d]
  next[today] = next[today] || {}
  if (remove) { if (key) delete next[today][key]; else next[today] = {} }
  else {
    const e: Entry = { by: user.email || 'someone', at: new Date().toISOString(), outcome: body?.outcome === 'done' ? 'done' : 'skipped' }
    if (body?.title) e.title = String(body.title).slice(0, 160)
    if (body?.unit) e.unit = String(body.unit).slice(0, 80)
    next[today][key] = e
  }
  const r = await setSetting(DISMISS_KEY, next, user.email || null)
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error || 'could not save' }, { status: 500 })
  return NextResponse.json({ ok: true, dismissed: next[today] })
}

export async function POST(req: NextRequest) { return mutate(req, false) }
export async function DELETE(req: NextRequest) { return mutate(req, true) }
