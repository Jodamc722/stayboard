// EVE'S OWN PAGE, THE NUMBERS BEHIND IT (Jon, 2026-09-28: "we need to have an Eve tab where open
// loops are, training questions, Eve command center overview").
//
// One call, one screen. Everything here already exists somewhere else — her receipts for the day
// (my_actions_today), the loops she is keeping tabs on (/loops), the questions only a person can
// answer (Settings → Eve), what she is thinking (Thinking), and whether each of her desks and
// nightly jobs is switched on and actually ran (automations). This route reads them together so
// the page can say, in one line each, what needs Jon and what is running.
//
//   GET → { today, loops, questions, expectations, thoughts, agent, desks }
import { NextResponse } from 'next/server'
import { eveGate } from '../../agent/route'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { myActionsOn } from '@/lib/eve/system'
import { countOpenQuestions } from '@/lib/eve/questions'
import { countOpenExpectations } from '@/lib/eve/expectations'
import { unseenCount, allObserving } from '@/lib/eve/thoughts'
import { getAgentSettings } from '@/lib/eve/agent-mode'
import { allAutomationStates } from '@/lib/eve/automations'
import { lastRuns } from '@/lib/automation-runs'
import { todayET } from '@/lib/eve/ctx'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// The desks and nightly jobs that belong on the overview, in the order a person reads them: what
// runs during the day first, the night shift after. Keys are lib/eve/automations.ts keys.
const DESKS = ['slack-watch', 'on-watch', 'ops-desk', 'scheduler-shadow', 'eve-ask', 'eve-review', 'quality-audit', 'expectations', 'eve-brain', 'eve-dossiers', 'eve-learn', 'eve-audit', 'eve-metrics']

export async function GET() {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const email = String(gate.access.email || '').toLowerCase()
  const day = todayET()

  const [today, loops, questions, unseen, settings, states, runs, expectations] = await Promise.all([
    myActionsOn(day).catch((e: any) => ({ error: String(e?.message || e) })),
    loopCounts(),
    countOpenQuestions().catch(() => 0),
    unseenCount(email).catch(() => 0),
    getAgentSettings(),
    allAutomationStates('eve').catch(() => [] as any[]),
    lastRuns().catch(() => ({} as Record<string, any>)),
    countOpenExpectations().catch(() => 0),
  ])

  const byKey: Record<string, any> = {}
  for (const s of states as any[]) byKey[s.key] = s
  const desks = DESKS.filter(k => byKey[k]).map(k => {
    const s = byKey[k]; const r = runs[k] || null
    return {
      key: k, label: s.label, what: s.what, runs: s.runs, settings: s.settings || null,
      on: s.on, // true / false / null (always on)
      last: r ? { at: r.at, ok: !!r.ok, did: r.itemCount, error: r.error } : null,
    }
  })

  const waiting: any[] = Array.isArray((today as any).waiting_on_a_person_now) ? (today as any).waiting_on_a_person_now : []
  const decisions: any[] = Array.isArray((today as any).decisions) ? (today as any).decisions : []
  return NextResponse.json({
    ok: true, day,
    today: {
      headline: (today as any).headline || null,
      counts: (today as any).counts || null,
      waiting: waiting.slice(0, 12),
      decisions: decisions.slice(-14).reverse(),
      gaps: (today as any).gaps || null,
      error: (today as any).error || null,
    },
    loops, questions, expectations,
    thoughts: { unseen, allObserving: allObserving(settings) },
    agent: { enabled: !!settings.enabled, rungs: settings.rungs || null },
    desks,
  })
}

// Open loops by kind — the same table /loops reads, counted rather than listed.
async function loopCounts(): Promise<{ open: number; byKind: Record<string, number>; urgent: number; oldestHours: number | null }> {
  try {
    const { data } = await supabaseAdmin().from('eve_slack_items').select('kind,urgent,first_seen').eq('status', 'open').limit(1000)
    const rows = (data || []) as any[]
    const byKind: Record<string, number> = {}
    let urgent = 0; let oldest: number | null = null
    for (const r of rows) {
      byKind[r.kind] = (byKind[r.kind] || 0) + 1
      if (r.urgent) urgent += 1
      const h = (Date.now() - Date.parse(r.first_seen)) / 3600000
      if (Number.isFinite(h) && (oldest == null || h > oldest)) oldest = h
    }
    return { open: rows.length, byKind, urgent, oldestHours: oldest == null ? null : Math.round(oldest) }
  } catch { return { open: 0, byKind: {}, urgent: 0, oldestHours: null } }
}
