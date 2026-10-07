// THE DAY'S DIRECTION — one computation behind the Ops Command email and Eve's single morning post
// (Jon, 2026-10-07: "consolidate Eve's engagement in a way that's helpful and direction-focused" ·
// "bring the ops command brief and make it better").
//
// It reads the Today board's own engine (lib/command-day buildCommandDay) rather than inventing a
// second opinion, so the email, the Slack post and the board can never disagree about what matters:
//   • health   — the Ops Health score (lib/ops-health) from the board's counts, as of now
//   • decide   — the board's ranked "next" list, top items only, each with ONE owner and ONE next step
//   • loops    — what Slack says is waiting on a person (eve_slack_items): guest asks, problems with
//                nobody on them, promises gone stale. This used to be Eve's separate "Keeping tabs" post.
//   • wins     — yesterday's real wins, one line
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildCommandDay, OWNER_LABEL, type CommandDay, type NextItem } from '@/lib/command-day'
import { opsHealth, type OpsHealth } from '@/lib/ops-health'

export type Direction = { key: string; unit: string; title: string; owner: string; next: string; due: string; severity: NextItem['severity']; href: string | null }
export type Loop = { id: string; kind: 'guest_ask' | 'problem' | 'commitment'; summary: string; unit: string | null; owner: string | null; ageH: number; channel: string | null; urgent: boolean }
export type DayDirection = {
  today: string
  day: CommandDay | null
  health: OpsHealth | null
  decide: Direction[]
  loops: { asks: Loop[]; unowned: Loop[]; late: Loop[]; open: number; closed24h: number }
  wins: string[]
  degraded: string[]
}

const str = (v: any) => (v == null ? '' : String(v))
const etNowMin = () => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date()); return (Number(p.find(x => x.type === 'hour')?.value || 0) % 24) * 60 + Number(p.find(x => x.type === 'minute')?.value || 0) }
const etToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const capped = <X,>(p: Promise<X>, ms = 40_000): Promise<X | null> => Promise.race([p.catch(() => null), new Promise<null>(r => setTimeout(() => r(null), ms))])

/** The Ops Health score from the board's own counts. Calls/notices/checklist the board core does not carry count as clean. */
export function healthFromDay(day: CommandDay): OpsHealth {
  const c = day.tiles.cleans
  const nobody = (who: string) => !str(who).trim() || /unassigned/i.test(who)
  const sameDay = c.rows.filter(r => r.sameDay)
  const trouble = (r: (typeof c.rows)[number]) => r.status === 'late' || r.status === 'atRisk' || r.behind === 'late' || r.behind === 'atRisk'
  const maint = day.tiles.tasks.rows.filter(t => /maint/i.test(t.dept) && t.state !== 'done')
  const arr = day.tiles.arrivals
  return opsHealth({
    nowMin: etNowMin(),
    cleans: { total: c.total, done: c.done, late: c.late, atRisk: c.atRisk, nobody: c.rows.filter(r => r.status !== 'done' && r.status !== 'vendor' && nobody(r.who)).length, sameDay: sameDay.length, sameDayDone: sameDay.filter(r => r.status === 'done').length, sameDayTrouble: sameDay.filter(trouble).length },
    glitches: { open: day.tiles.glitches.open, overdue: day.tiles.glitches.overdue, noTask: day.tiles.glitches.noTask, awaitingApproval: Number(day.tiles.glitches.byLane?.manager_review || 0) },
    maint: { open: maint.length, urgentOpen: maint.filter(t => /urgent|high/i.test(t.prio)).length, nobody: maint.filter(t => nobody(t.who)).length },
    insp: { needed: arr.bigToday, done: arr.rows.filter(r => r.today && r.big && r.inspection === 'done').length, nobody: 0, missingBig: arr.missingInspection },
    calls: { todayOwed: day.tiles.guestDesk.welcome, todayDone: day.completed.callsDone, recoveryOwed: 0, recoveryDone: 0, loaded: true },
    notices: { toSend: 0, late: 0 },
    reviews: { waiting: day.tiles.guestDesk.reviews, lowWaiting: 0 },
    checklist: { total: 0, done: 0, late: 0 },
    claims: { open: day.tiles.claims.open, dueSoon: day.tiles.claims.dueSoon, review: day.tiles.claims.review },
    unpaid: { open: 0, today: 0 },
  })
}

/** The row's title without the board's long prefixes ("Guest issue past its due date: …" → "Overdue: …"). */
function shortTitle(n: NextItem): string {
  return str(n.title)
    .replace(/^Guest issue past its due date:\s*/i, 'Overdue glitch: ')
    .replace(/^Guest issue in Ops with no Breezeway task:\s*/i, 'Glitch, no task: ')
    .replace(/^Incident open:\s*/i, 'Incident: ')
    .replace(/\s*—\s*inspections are not automated$/i, '')
}

/**
 * THE NEXT STEP, IN WORDS (2026-10-07). The board's `why` is evidence ("Jordan Chang · 2d old ·
 * Yoslenis · task done"), not an instruction. A direction needs one verb: what the owner does next.
 * The row's own action label wins when it has one; otherwise it is read from the kind and the evidence.
 */
export function nextStep(n: NextItem): string {
  if (n.action && n.action.type !== 'open' && n.action.label) return n.action.label
  const why = str(n.why)
  const who = (() => { const parts = why.split(' · '); const a = parts.find(p => /^[A-Z][a-z]+ [A-Z]/.test(p) && !/old$/.test(p) && parts.indexOf(p) > 0); return a ? a.split(' ')[0] : '' })()
  switch (n.kind) {
    case 'glitch':
      if (/task done|task completed/i.test(why)) return `fixed in Breezeway — tell the guest and close the glitch${who ? ` (${who})` : ''}`
      if (/task deleted|task cancel/i.test(why)) return 'its task was deleted — re-open a task or close the glitch with a reason'
      if (/no Breezeway task|nobody assigned/i.test(why + ' ' + n.title)) return 'make a Breezeway task and put someone on it'
      return `chase the task to done${who ? ` with ${who}` : ''}, then close it with the guest told`
    case 'guest': return /unhappy/i.test(n.title) ? 'call or reply now — the guest is unhappy' : 'reply to the guest'
    case 'turn': return /in progress/i.test(why) ? 'watch it lands before the guest' : 'start the clean now — a guest lands today'
    case 'late': return /nobody assigned/i.test(why) ? 'assign a cleaner now' : 'call the cleaner — it is running late'
    case 'unassigned': return 'put someone on it'
    case 'inspection': return 'book the pre-arrival inspection'
    case 'feedback': return 'send someone to check the complaint before the guest lands'
    case 'pending': return 'get the overdue work done before the arrival'
    case 'duplicate': return 'cancel the duplicate task'
    case 'refund': return 'approve or decline the refund'
    case 'claim': return 'move the claim before its deadline'
    case 'staffing': return 'add a shift or call the on-call'
    case 'channel': return 'fix the listing in Guesty channel settings'
    default: return why || (n.action ? n.action.label : '')
  }
}

/** The board's ranked list, cut to what decides today: now first, then today, one row per unit. */
export function decideFrom(day: CommandDay, max = 6): Direction[] {
  const out: Direction[] = []
  const seen = new Set<string>()
  for (const n of day.next) {
    if (n.dismissed || n.severity === 'soon') continue
    const k = (n.unit || n.key).toLowerCase() + '|' + n.kind
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ key: n.key, unit: n.unit, title: shortTitle(n), owner: OWNER_LABEL[n.owner] || String(n.owner), next: nextStep(n).replace(/\s+/g, ' ').slice(0, 140), due: n.due, severity: n.severity, href: n.href || (n.action && n.action.type === 'open' ? n.action.href : null) })
    if (out.length >= max) break
  }
  return out
}

async function loopsNow(): Promise<DayDirection['loops']> {
  const db = supabaseAdmin()
  const { data } = await db.from('eve_slack_items').select('id,kind,summary,unit,owner_name,first_seen,channel_name,urgent,evidence,status').eq('status', 'open').order('first_seen', { ascending: true }).limit(300)
  const rows = (data || []) as any[]
  const hours = (r: any) => (Date.now() - Date.parse(r.first_seen)) / 3600_000
  const big = (r: any) => r?.evidence?.weight !== 'small'
  const toLoop = (r: any): Loop => ({ id: str(r.id), kind: r.kind, summary: str(r.summary).replace(/\s+/g, ' '), unit: r.unit || null, owner: r.owner_name || null, ageH: Math.round(hours(r)), channel: r.channel_name || null, urgent: !!r.urgent })
  const asks = rows.filter(r => r.kind === 'guest_ask').map(toLoop)
  const unowned = rows.filter(r => r.kind === 'problem' && big(r) && !r.owner_name && (r.urgent || hours(r) >= 24)).map(toLoop)
  const late = rows.filter(r => r.kind === 'commitment' && big(r) && hours(r) >= 48).map(toLoop)
  let closed24h = 0
  try { const { count } = await db.from('eve_slack_items').select('id', { count: 'exact', head: true }).eq('status', 'closed').gte('closed_at', new Date(Date.now() - 26 * 3600_000).toISOString()); closed24h = count || 0 } catch { /* fine */ }
  return { asks, unowned, late, open: rows.length, closed24h }
}

export async function buildDirection(): Promise<DayDirection> {
  const degraded: string[] = []
  const [day, loops, wins] = await Promise.all([
    capped(buildCommandDay({ money: false })),
    capped(loopsNow()),
    capped(import('@/lib/eve/wins').then(m => m.winsFor())),
  ])
  if (!day) degraded.push('the Today board could not be read')
  if (!loops) degraded.push('the Slack loops could not be read')
  let health: OpsHealth | null = null
  try { if (day) health = healthFromDay(day) } catch { degraded.push('the health score could not be computed') }
  return {
    today: day?.today || etToday(),
    day: day || null,
    health,
    decide: day ? decideFrom(day) : [],
    loops: loops || { asks: [], unowned: [], late: [], open: 0, closed24h: 0 },
    wins: (wins as any)?.lines ? ((wins as any).lines as string[]).slice(0, 2) : [],
    degraded,
  }
}
