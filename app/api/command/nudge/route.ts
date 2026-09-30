// COMMAND CENTER — MESSAGE THE PEOPLE ON THE WORK (Jon, 2026-09-30: "be able to push a message out
// via Slack to the assigned team members of the tasks").
//
//   POST { taskIds: string[], note?: string }
//   → { ok, sent: [{ who, via }], skipped: [{ who, reason }] }
//
// HOW IT DECIDES WHO HEARS WHAT
//   1. The tasks are read from the Breezeway mirror (breezeway_tasks_sync) — the same rows the Today
//      page drew — and grouped by assignee. One person, one message, however many tasks are in view.
//   2. Each assignee name is resolved to a Slack user the way every alert does (lib/slack-rules
//      resolveSlackId: manual override → email → the fuzzy name matcher). No match, no guess: the
//      person is reported as not reached, never tagged wrong.
//   3. The message goes where the team already reads: the building's housekeeping or maintenance
//      channel (the routing groups in Slack rules), tagging the person. A person whose buildings
//      have no channel gets a DM instead. Work across several buildings goes to the first
//      building's channel with the other units named — one message, not four.
//   4. Field crews are Spanish-first (Jon, 2026-08-19); vendor-run buildings and anyone with no
//      group stay English. A short note from the sender rides along, verbatim, in both.
//
// TONE: state the picture, point at the next thing, stay on their side (the house rule for every
// message the crew reads). Never a scoreboard. Never "why isn't this done".
//
// Sends straight away — a person pressed the button, that IS the approval — and writes a receipt
// (automation_runs: command-nudge) so the Health page can say when it last ran and what it did.
// It never touches the task: nothing here completes, reassigns or reschedules anything.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAnyLevel } from '@/lib/access'
import { getSlackRules, groupForBuilding, channelFor, resolveSlackId, type Dept } from '@/lib/slack-rules'
import { getDirectory, postToChannel, dmUser, mention } from '@/lib/slack'
import { buildingOf } from '@/lib/segments'
import { signedInName } from '@/lib/caller-name'
import { recordRun } from '@/lib/automation-runs'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const deptOf = (v: any): Dept => (/housekeep|clean/i.test(str(v)) ? 'housekeeping' : 'maintenance')
const isDone = (s: string) => /done|complete|finished|closed/i.test(s)
const isRunning = (s: string) => /progress|started|running/i.test(s)

type Job = { id: string; name: string; unit: string; building: string | null; dept: Dept; state: 'open' | 'running'; prio: string }

function lines(jobs: Job[], es: boolean): string {
  return jobs.map(j => {
    const st = j.state === 'running' ? (es ? 'en curso' : 'in progress') : (es ? 'pendiente' : 'not started')
    const pr = /urgent|high/i.test(j.prio) ? (es ? ' · urgente' : ' · urgent') : ''
    return '• *' + j.unit + '* — ' + j.name + ' _(' + st + pr + ')_'
  }).join('\n')
}

/** The note, in the house voice. `tag` is the Slack mention or the bare first name. */
function compose(tag: string, jobs: Job[], note: string, bilingual: boolean, from: string): string {
  const n = jobs.length
  const en = [
    `${tag} — quick check-in from ${from} on what's still open for you today (${n}):`,
    lines(jobs, false),
    note ? `> ${note}` : '',
    `If anything is blocking you, reply here and we'll clear it. Thanks! :pray:`,
  ].filter(Boolean).join('\n')
  if (!bilingual) return en
  const es = [
    `${tag} — un chequeo rápido de ${from} sobre lo que sigue abierto para ti hoy (${n}):`,
    lines(jobs, true),
    note ? `> ${note}` : '',
    `Si algo te está bloqueando, responde aquí y lo resolvemos. ¡Gracias! :pray:`,
  ].filter(Boolean).join('\n')
  return es + '\n\n' + en
}

export async function POST(req: NextRequest) {
  const gate = await requireAnyLevel(['schedule', 'plan'], 'edit')
  if (!gate.ok) return gate.res

  const body = await req.json().catch(() => ({} as any))
  const ids: string[] = Array.isArray(body?.taskIds) ? body.taskIds.map(str).filter(Boolean).slice(0, 80) : []
  const note = str(body?.note).trim().slice(0, 400)
  if (!ids.length) return NextResponse.json({ ok: false, error: 'No tasks' }, { status: 400 })

  const t0 = Date.now()
  const db = supabaseAdmin()
  const [{ data: tasks, error }, rules, dir, from] = await Promise.all([
    db.from('breezeway_tasks_sync').select('id,reference_property_id,name,status,assignees,type_department,prio:raw->>type_priority').in('id', ids),
    getSlackRules(),
    getDirectory(),
    signedInName(supabaseAdmin(), str(gate.access.email)).catch(() => ''),
  ])
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  const rows = (tasks || []) as any[]
  const lids = Array.from(new Set(rows.map(r => str(r.reference_property_id)).filter(Boolean)))
  const { data: listings } = lids.length ? await db.from('guesty_listings').select('id,nickname,title,building').in('id', lids) : { data: [] as any[] }
  const lmap: Record<string, { name: string; building: string | null }> = {}
  for (const l of (listings || []) as any[]) lmap[str(l.id)] = { name: str(l.nickname) || str(l.title) || 'Unit', building: buildingOf(l.building, str(l.nickname) || str(l.title)) }

  // One person → their open jobs.
  const byPerson: Record<string, Job[]> = {}
  let closed = 0, nobody = 0
  for (const r of rows) {
    const status = str(r.status).toLowerCase()
    if (isDone(status)) { closed++; continue }
    const li = lmap[str(r.reference_property_id)]
    const job: Job = { id: str(r.id), name: str(r.name) || 'Task', unit: li ? li.name : 'Building / common area', building: li ? li.building : null, dept: deptOf(r.type_department), state: isRunning(status) ? 'running' : 'open', prio: str(r.prio) }
    const ppl: string[] = (Array.isArray(r.assignees) ? r.assignees : []).map((p: any) => str(p && (p.name || p))).filter(Boolean)
    if (!ppl.length) { nobody++; continue }
    for (const p of ppl) (byPerson[p] ||= []).push(job)
  }

  const sender = from || str(gate.access.email).split('@')[0] || 'the office'
  const sent: { who: string; via: string }[] = []
  const skipped: { who: string; reason: string }[] = []
  for (const who of Object.keys(byPerson)) {
    const jobs = byPerson[who]
    const slackId = resolveSlackId(who, dir.users || [], rules)
    if (!slackId) { skipped.push({ who, reason: 'not matched to a Slack user' }); continue }
    // The room: the first building with a channel for this trade. Vendor groups tag nobody by name.
    let channel: string | null = null, vendor = false, grouped = false
    for (const j of jobs) {
      const g = groupForBuilding(rules, j.building)
      if (!g) continue
      grouped = true
      if (g.vendor) { vendor = true; continue }
      const ch = channelFor(rules, g, j.dept)
      if (ch) { channel = ch; break }
    }
    const bilingual = !!rules.bilingualFieldChannels && !vendor
    const text = compose(mention(slackId), jobs, note, bilingual, sender)
    try {
      const res = channel ? await postToChannel(channel, text) : await dmUser(slackId, text)
      if (res.ok) sent.push({ who, via: channel ? 'channel' : 'dm' })
      else skipped.push({ who, reason: res.error || 'Slack refused it' })
    } catch (e: any) { skipped.push({ who, reason: String(e?.message || e).slice(0, 80) }) }
    void grouped
  }

  recordRun({ name: 'command-nudge', ok: true, itemCount: sent.length, ms: Date.now() - t0, detail: { by: gate.access.email, tasks: ids.length, closed, nobody, sent, skipped } })
  return NextResponse.json({ ok: true, sent, skipped, closed, nobody })
}
