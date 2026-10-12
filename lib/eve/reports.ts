// THE REPORTS DESK — long-form goes here, not to Slack (Jon, 2026-10-12: "there are so many Slack
// posts, especially the big, long updates. We need a better place to organize that. Slack should be
// a place for more day-to-day operations").
//
// Every long-form thing Eve writes — the Monday quality audit, the Sunday shadow-scheduler scorecard,
// the shared-boards digests, the labor report, notable arrivals, the shift handover, the morning Ops
// Command, the ops desk's plan and recap — is FILED here first, under its kind and date, and read on
// the Eve tab → Reports. What reaches Slack is decided per kind by a routing table:
//   page     filed only — nothing in Slack
//   pointer  filed, and the room gets ONE line with the headline and a link
//   slack    the full text, as before (for the few rooms that genuinely read it in Slack)
// Defaults put every report on the page with a pointer for the ones a room used to act on; Jon can
// move any kind in Settings → Eve → Agent mode → Reports routing. Rows live in eve_knowledge
// (type 'report') — no migration; 90 days are kept.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting, setSetting } from '@/lib/app-settings'

export type ReportKind = 'quality_week' | 'shadow_scorecard' | 'shared_boards' | 'labor_report' | 'notable_arrivals' | 'handover' | 'market_brief' | 'digest' | 'ops_command' | 'ops_plan' | 'ops_recap' | 'weekly_review' | 'pilot_two_plan' | 'other'
export type Route = 'page' | 'pointer' | 'slack'
export const REPORT_KINDS: { key: ReportKind; label: string; cadence: string; defaultRoute: Route; what: string }[] = [
  { key: 'quality_week', label: 'Quality this week', cadence: 'Monday', defaultRoute: 'pointer', what: 'The quality audit — what is bleeding, three findings with an owner each.' },
  { key: 'weekly_review', label: 'Weekly review', cadence: 'Monday', defaultRoute: 'pointer', what: 'The Monday review pack — plans for the week, graded in three weeks.' },
  { key: 'shadow_scorecard', label: 'Shadow scheduler scorecard', cadence: 'Sunday', defaultRoute: 'page', what: 'How often her clean plan beat the real schedule.' },
  { key: 'shared_boards', label: 'Shared boards digest', cadence: 'morning & evening', defaultRoute: 'page', what: 'What is waiting and what changed on the owner / vendor project boards.' },
  { key: 'labor_report', label: 'Labor report', cadence: 'daily', defaultRoute: 'page', what: 'Hours and cleans by person, from Homebase and Breezeway.' },
  { key: 'notable_arrivals', label: 'Notable arrivals', cadence: 'daily', defaultRoute: 'page', what: 'Owners, VIPs, big groups and long stays coming up.' },
  { key: 'handover', label: 'Shift handover', cadence: 'daily', defaultRoute: 'pointer', what: 'What the next shift inherits.' },
  { key: 'market_brief', label: 'Market brief', cadence: 'daily', defaultRoute: 'page', what: 'The market in one read.' },
  { key: 'digest', label: 'Hub digest', cadence: 'daily', defaultRoute: 'page', what: 'The hub rooms\' daily roll-up.' },
  { key: 'ops_command', label: 'Ops Command', cadence: 'morning', defaultRoute: 'page', what: 'The morning picture — also emailed.' },
  { key: 'ops_plan', label: 'Ops desk plan', cadence: 'morning', defaultRoute: 'page', what: 'Today\'s field plan by person.' },
  { key: 'ops_recap', label: 'End of day', cadence: 'evening', defaultRoute: 'page', what: 'What closed and what carries over.' },
  { key: 'pilot_two_plan', label: 'Pilot Two plan', cadence: '4× daily', defaultRoute: 'page', what: 'The scheduler\'s plan for the day.' },
  { key: 'other', label: 'Other long posts', cadence: '—', defaultRoute: 'page', what: 'Anything long that does not have a kind yet.' },
]
export const ROUTING_KEY = 'eve_report_routing'
const KEEP_DAYS = 90
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

export type Report = { id: string; kind: ReportKind; title: string; text: string; room: string | null; at: string; meta?: any }

export async function getRouting(): Promise<Record<ReportKind, Route>> {
  const v = (await getSetting<any>(ROUTING_KEY, null)) || {}
  const out: any = {}
  for (const k of REPORT_KINDS) out[k.key] = v[k.key] === 'page' || v[k.key] === 'pointer' || v[k.key] === 'slack' ? v[k.key] : k.defaultRoute
  return out
}
export async function setRouting(patch: Record<string, string>, by: string): Promise<Record<ReportKind, Route>> {
  const cur = (await getSetting<any>(ROUTING_KEY, null)) || {}
  for (const [k, v] of Object.entries(patch || {})) if (REPORT_KINDS.some(x => x.key === k) && (v === 'page' || v === 'pointer' || v === 'slack')) cur[k] = v
  await setSetting(ROUTING_KEY, cur, by)
  return getRouting()
}

const base = () => (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/$/, '')
export const reportUrl = (id: string) => `${base()}/eve?tab=reports&id=${encodeURIComponent(id)}`

/** File a report. Returns its id and link. Never throws — a report that cannot be filed still posts as the route says. */
export async function fileReport(r: { kind: ReportKind; title: string; text: string; room?: string | null; meta?: any; at?: string }): Promise<{ id: string; url: string } | null> {
  const at = r.at || new Date().toISOString()
  const id = `report:${r.kind}:${at.slice(0, 16).replace(/[-:T]/g, '')}`
  try {
    const db = supabaseAdmin()
    const content: Report = { id, kind: r.kind, title: str(r.title).slice(0, 200), text: str(r.text).slice(0, 20000), room: r.room || null, at, meta: r.meta || null }
    const { error } = await db.from('eve_knowledge').upsert({ id, type: 'report', scope: `report:${r.kind}`, title: content.title, content: JSON.stringify(content), evidence_count: 0, updated_at: at }, { onConflict: 'id' })
    if (error) { console.error('[reports] file:', error.message); return null }
    // Keep the shelf short.
    try { await db.from('eve_knowledge').delete().eq('type', 'report').lt('updated_at', new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString()) } catch { /* next time */ }
    return { id, url: reportUrl(id) }
  } catch (e: any) { console.error('[reports] file:', str(e?.message || e)); return null }
}

/** The headline of a Slack-formatted report: its first bold phrase, else its first line. */
export function headlineOf(text: string, fallback: string): string {
  const m = /\*([^*\n]{3,120})\*/.exec(str(text))
  const line = (m ? m[1] : str(text).split('\n').find(l => l.trim()) || fallback).replace(/^[:\w_]+:\s*/, '').trim()
  return line.slice(0, 120) || fallback
}

/**
 * Route a long-form post. Files it, then says what the room should get:
 *   { post: false }                      — page only
 *   { post: true, text: one line + link } — pointer
 *   { post: true, text: the full text }   — slack
 */
export async function routeReport(r: { kind: ReportKind; title: string; text: string; room?: string | null; meta?: any; pointer?: string }): Promise<{ post: boolean; text: string; route: Route; id: string | null; url: string | null }> {
  const routing = await getRouting().catch(() => null)
  const route: Route = routing ? routing[r.kind] : (REPORT_KINDS.find(k => k.key === r.kind)?.defaultRoute || 'page')
  const filed = await fileReport(r)
  if (route === 'slack' || !filed) return { post: true, text: r.text, route: filed ? route : 'slack', id: filed?.id || null, url: filed?.url || null }
  if (route === 'page') return { post: false, text: '', route, id: filed.id, url: filed.url }
  const head = r.pointer || headlineOf(r.text, r.title)
  return { post: true, text: `📄 *${r.title}* — ${head} · <${filed.url}|read it on the Eve tab>`, route, id: filed.id, url: filed.url }
}

export async function listReports(opts: { kind?: string; days?: number; limit?: number } = {}): Promise<Report[]> {
  try {
    const db = supabaseAdmin()
    const since = new Date(Date.now() - (opts.days || 30) * 86400_000).toISOString()
    let q = db.from('eve_knowledge').select('id,content,updated_at').eq('type', 'report').gte('updated_at', since).order('updated_at', { ascending: false }).limit(Math.min(opts.limit || 200, 500))
    if (opts.kind) q = q.eq('scope', `report:${opts.kind}`)
    const { data } = await q
    return ((data as any[]) || []).map(r => { try { return JSON.parse(str(r.content)) as Report } catch { return null } }).filter(Boolean) as Report[]
  } catch { return [] }
}
export async function getReport(id: string): Promise<Report | null> {
  try {
    const { data } = await supabaseAdmin().from('eve_knowledge').select('content').eq('id', id).maybeSingle()
    return data ? (JSON.parse(str((data as any).content)) as Report) : null
  } catch { return null }
}
