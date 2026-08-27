// THE MORNING SUGGESTION RUN.
//
//   GET               → build today's short list; create the ones whose cadence is set to 'auto'.
//   GET ?preview=1    → build it and create nothing (signed-in humans only).
//
// Jon, 2026-08-26: "this should live in user setting where you can have automations (suggestion
// sent)". A cadence has three settings — Off, Suggest it, Create it automatically — and this is
// what the third one means. It obeys every cap the suggested list obeys, including the day read,
// because the cap is the whole promise: "we can't have 200 tasks just auto populate."
//
// So on a heavy turn day this route creates NOTHING and says so. That is the feature working.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { recordRun } from '@/lib/automation-runs'
import { buildSuggestions, createFromSuggestion, logAccepted, getCadenceCfg } from '@/lib/suggestions'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

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
  const me = await signedIn()

  // PREVIEW NAMES UNITS AND PEOPLE. The lenient no-CRON_SECRET cron heuristic exists so Vercel's
  // scheduler can RUN the job, never so an anonymous caller can read who is working where today.
  if (preview) {
    if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  } else if (!isCron && !me) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const date = ymd(new Date())
  try {
    const cfg = await getCadenceCfg()
    const run = await buildSuggestions(date)

    // COUNTS ONLY on the anonymous path — no unit names, no staff names.
    const safe = {
      ok: true, date, enabled: cfg.enabled,
      day: run.day, considered: run.considered, dropped: run.dropped,
      historyComplete: run.historyComplete, suggested: run.suggestions.length,
    }

    if (!cfg.enabled) return NextResponse.json({ ...safe, created: 0, note: 'Suggestions are switched off in settings.' })
    if (preview) return NextResponse.json({ ...safe, suggestions: run.suggestions })

    const autoKeys = new Set(cfg.cadences.filter(c => c.mode === 'auto').map(c => c.key))
    const toMake = run.suggestions.filter(s => autoKeys.has(s.cadenceKey))

    const created: string[] = []
    const failed: string[] = []
    for (const s of toMake) {
      const made = await createFromSuggestion(s, 'lighthouse-cron')
      if (made.ok) { created.push(made.taskId || ''); await logAccepted(s, 'lighthouse-cron', made.taskId || null) }
      else failed.push(String(made.error || '').slice(0, 120))
    }

    // Receipt, so the automations screen can prove this ran and say what it did.
    await recordRun({
      name: 'suggestions', ok: failed.length === 0, itemCount: created.length,
      detail: { suggested: run.suggestions.length, autoCreated: created.length, failed: failed.length, verdict: run.day.verdict },
      error: failed[0] || null,
    })

    const out = { ...safe, created: created.length, failed: failed.length, errors: failed.slice(0, 3) }
    return NextResponse.json(me ? { ...out, suggestions: run.suggestions } : out)
  } catch (e: any) {
    return NextResponse.json({ ok: false, date, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
