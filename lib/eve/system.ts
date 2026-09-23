// SYSTEM domain — what this app does when nobody is watching, and where it says so.
//
// Jon, 2026-08-26: "she needs to understand all automations ... Slack, what channels are for what."
//
// Before this, Eve could read almost every operational table and none of the machinery. She could
// tell you a clean was late but not that the late-clean ALERT exists, which channel it goes to, or
// whether it was switched off in March. Asked "is guest orders on", her only honest answer was to
// look at whether orders had appeared — inference, not knowledge, about a thing that has a switch.
//
// Four tools, one idea: the app's own behaviour is a subject she can look up rather than deduce.
import 'server-only'
import type { EveTool, EveDomain } from './types'
import { obj, S } from './types'
import { lc, has, safe, clampLimit, clampDays } from './ctx'
import { AUTOMATIONS, allAutomationStates, findAutomation, automationState } from './automations'
import { lastRuns, runHistory } from '@/lib/automation-runs'
import { getSlackRules, EVENT_LABELS, groupForBuilding, channelFor, type SlackRules } from '@/lib/slack-rules'
import { getDirectory } from '@/lib/slack'
import { pendingItems, recentItems } from '@/lib/slack-queue'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { describeLink, linkStatus, pathFor } from '@/lib/share-links'
import { myLearning } from './learning-audit'
import { getSetting } from '@/lib/app-settings'
import { pageRows } from './ctx'

const minsToClock = (m: any): string => {
  const n = Number(m)
  if (!Number.isFinite(n)) return '—'
  const h = Math.floor(n / 60), mm = n % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')} ET`
}

/** Channel id -> #name, from the cached Slack directory. Ids are unreadable to a human. */
async function channelNames(): Promise<Record<string, { name: string; isPrivate: boolean; isMember: boolean; purpose?: string; topic?: string }>> {
  const out: Record<string, any> = {}
  try {
    const dir = await getDirectory()
    for (const c of (dir.channels || [])) out[c.id] = { name: '#' + c.name, isPrivate: c.isPrivate, isMember: c.isMember, purpose: (c as any).purpose || '', topic: (c as any).topic || '' }
  } catch { /* names degrade to raw ids */ }
  return out
}

// ---- WHAT DID I DO TODAY ------------------------------------------------------------------------
//
// Jon, 2026-09-23 review. In a live test Eve was asked "what did you do today?" and answered
// "nothing sent" — after roughly ten posts that day. She was not lying; she had no way to look. Every
// decision she makes is already written down (eve_agent_log, one row per act / propose / draft /
// observe / deferred), every ask and draft is a row in eve_actions with its status, On Watch keeps
// its flags in app_settings, and Slack Watch stamps its nudges on eve_slack_items. Nothing read them
// back to HER. This does: one day, ET, grouped and counted, so "what did you do" and "what's waiting
// on me" are answered from the receipts rather than from what she happens to remember.

const ET = 'America/New_York'

/** UTC instants bounding an ET calendar day (DST-safe: offset measured at local noon). */
function etDayBounds(ymd: string): { start: string; end: string } {
  const noon = new Date(ymd + 'T12:00:00Z')
  let offMin = -300
  try {
    const tz = new Intl.DateTimeFormat('en-US', { timeZone: ET, timeZoneName: 'shortOffset' }).formatToParts(noon)
      .find(p => p.type === 'timeZoneName')?.value || ''
    const m = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(tz)
    if (m) offMin = Number(m[1]) * 60 + (m[1].startsWith('-') ? -1 : 1) * Number(m[2] || 0)
  } catch { /* EST fallback */ }
  const start = Date.parse(ymd + 'T00:00:00Z') - offMin * 60_000
  return { start: new Date(start).toISOString(), end: new Date(start + 24 * 3600_000).toISOString() }
}

const etClock = (iso: any): string => {
  const t = Date.parse(String(iso || ''))
  if (!Number.isFinite(t)) return '—'
  return new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t)) + ' ET'
}

const tally = (xs: string[]): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const x of xs) out[x] = (out[x] || 0) + 1
  return out
}

/** eve_actions.status is proposed|approved|rejected|executed|failed|expired; say what it MEANS now. */
function actionStatus(r: any, now: number): string {
  const st = lc(r.status)
  const delivery = lc(r?.result?.delivery)
  if (st === 'proposed') {
    if (r.expires_at && Date.parse(r.expires_at) < now) return 'expired'
    if (delivery === 'undeliverable') return 'undeliverable'
    if (r?.payload?.type === 'deferred') return 'deferred'
    return 'waiting'
  }
  return st || 'unknown'
}

export async function myActionsOn(day: string): Promise<any> {
  const db = supabaseAdmin()
  const { start, end } = etDayBounds(day)
  const now = Date.now()
  const gaps: string[] = []

  // 1. The decision log. Every act / propose / draft / observe / deferred is one row here.
  let logRows: any[] = []
  let logTruncated = false
  {
    const read = (cols: string) => pageRows((a, b) => db.from('eve_agent_log').select(cols)
      .gte('at', start).lt('at', end).order('at').order('id').range(a, b), 3)
    let r = await read('id,at,action,rung,allowed,mode,reason,summary,ref,by,actor,undo,undone_at')
    // Migration 102 not run: no undo columns. Read the log without them rather than read nothing.
    if (r.truncated && !r.rows.length) r = await read('id,at,action,rung,allowed,mode,reason,summary,ref,by,actor')
    logRows = r.rows
    logTruncated = r.truncated
    if (r.truncated && !r.rows.length) gaps.push('eve_agent_log could not be read (migration 100 not run, or a blip) — the decision log below is empty because it was unreadable, not because nothing happened.')
  }
  const log = logRows.map(r => ({
    time: etClock(r.at), action: r.action, mode: r.mode || (r.allowed ? 'act' : 'observe'),
    summary: r.summary || null, by: r.by, actor: r.actor || undefined,
    why: r.reason ? String(r.reason).slice(0, 160) : undefined, ref: r.ref || undefined,
    undo_available: !!r.undo && !r.undone_at && now - Date.parse(r.at) < 24 * 3600_000,
    undone_at: r.undone_at || undefined,
  }))

  // 2. What she filed for a person: asks, proposals, drafts — and where each one stands now.
  let filed: any[] = []
  try {
    const { data, error } = await db.from('eve_actions')
      .select('id,kind,status,payload,why,created_by,created_at,decided_by,decided_at,expires_at,result')
      .gte('created_at', start).lt('created_at', end).order('created_at').limit(500)
    if (error) throw error
    filed = ((data as any[]) || []).map(r => ({
      time: etClock(r.created_at), id: r.id, kind: r.kind, type: r?.payload?.type || undefined,
      action: r?.payload?.action || undefined,
      summary: String(r?.payload?.summary || r?.payload?.question || r.why || '').slice(0, 240) || null,
      status: actionStatus(r, now), decided_by: r.decided_by || undefined, decided_at: r.decided_at ? etClock(r.decided_at) : undefined,
      delivered_via: r?.result?.delivery || undefined,
    }))
  } catch (e: any) { gaps.push('eve_actions could not be read: ' + String(e?.message || e).slice(0, 120)) }

  // 3. Everything still waiting on a person, whatever day it was filed — "what's waiting on me".
  let waiting: any[] = []
  try {
    const { data } = await db.from('eve_actions')
      .select('id,kind,status,payload,why,created_at,expires_at,result')
      .eq('status', 'proposed').order('created_at', { ascending: false }).limit(200)
    waiting = ((data as any[]) || [])
      .map(r => ({ r, st: actionStatus(r, now) }))
      .filter(x => x.st === 'waiting' || x.st === 'undeliverable' || x.st === 'deferred')
      .map(({ r, st }) => ({
        filed: String(r.created_at || '').slice(0, 10) + ' ' + etClock(r.created_at), id: r.id, kind: r.kind,
        action: r?.payload?.action || r?.payload?.type || undefined,
        summary: String(r?.payload?.summary || r?.payload?.question || r.why || '').slice(0, 200) || null, status: st,
      }))
  } catch { /* the day's list above still stands */ }

  // 4. On Watch — the hourly field check. Its flags live in app_settings, not a table.
  let onWatch: any[] = []
  try {
    const st = await getSetting<any>('eve_on_watch_state', null)
    const flags = (st && st.flags) || {}
    onWatch = Object.entries(flags)
      .filter(([, f]: [string, any]) => (f?.at && f.at >= start && f.at < end) || (f?.resolvedAt && f.resolvedAt >= start && f.resolvedAt < end))
      .map(([key, f]: [string, any]) => ({
        key, kind: f.kind, room: f.room, what: f.label, line: f.line,
        raised: f.at >= start && f.at < end ? etClock(f.at) : undefined,
        posted: !!f.ts, channel: f.channel || undefined,
        escalated: !!f.escalated, resolved: f.resolved || undefined,
        resolved_at: f.resolvedAt ? etClock(f.resolvedAt) : undefined,
      }))
  } catch { gaps.push('On Watch state could not be read.') }

  // 5. Slack Watch — nudges she posted in threads, and whether the digest went out.
  let nudges: any[] = []
  let digest: string | null = null
  try {
    const { data } = await db.from('eve_slack_items')
      .select('id,channel_name,kind,summary,unit,status,nudged_at,nudge_count')
      .gte('nudged_at', start).lt('nudged_at', end).order('nudged_at').limit(200)
    nudges = ((data as any[]) || []).map(r => ({
      time: etClock(r.nudged_at), channel: r.channel_name ? '#' + r.channel_name : undefined,
      kind: r.kind, about: String(r.summary || '').slice(0, 160), unit: r.unit || undefined, item_now: r.status,
    }))
    const sw = await getSetting<any>('eve_slack_watch', null)
    digest = sw?.lastDigest === day ? 'posted (or held for quiet hours) today' : 'not recorded for this day'
  } catch { gaps.push('Slack Watch items could not be read.') }

  const byMode = tally(log.map(l => String(l.mode)))
  const byStatus = tally(filed.map(f => String(f.status)))
  const acted = byMode.act || 0
  const posts = log.filter(l => l.mode === 'act' && /slack_post/.test(String(l.action))).length
  const headline = `${day}: ${log.length} logged decision(s) — ${acted} done, ${byMode.propose || 0} proposed, ${byMode.draft || 0} drafted, ${byMode.deferred || 0} deferred, ${byMode.observe || 0} only observed`
    + `; ${posts} Slack post(s) made; ${filed.length} item(s) filed for a person (${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'})`
    + `; On Watch raised ${onWatch.filter(o => o.raised).length} flag(s), ${onWatch.filter(o => o.posted).length} posted; ${nudges.length} Slack nudge(s).`
    + ` ${waiting.length} thing(s) are waiting on a person right now.`

  return {
    day, headline,
    counts: {
      decisions: log.length, by_mode: byMode, by_action: tally(log.map(l => String(l.action))), by_source: tally(log.map(l => String(l.by))),
      filed: filed.length, filed_by_status: byStatus,
      on_watch_flags: onWatch.length, slack_nudges: nudges.length, waiting_now: waiting.length,
      undo_available: log.filter(l => l.undo_available).length,
    },
    decisions: log.slice(-250),
    filed_for_a_person: filed,
    waiting_on_a_person_now: waiting.slice(0, 40),
    on_watch: onWatch,
    slack_watch: { nudges, digest },
    truncated: logTruncated && logRows.length > 0 ? true : undefined,
    gaps: gaps.length ? gaps : undefined,
    how_to_read: 'decisions is the full log: mode "act" happened, "propose" is waiting for a yes (see filed_for_a_person), "draft" was written down for a person, "deferred" runs after quiet hours, "observe" means you noticed and did nothing. Never say you did nothing if decisions or on_watch is non-empty. On Watch keeps resolved flags about 48 hours, so older days show fewer.',
  }
}

export const SYSTEM_TOOLS: EveTool[] = [
  {
    name: 'my_actions_today',
    description: 'YOUR OWN RECEIPTS — the answer to "what did you do today?", "what have you posted?", "what did you raise?" and "what\'s waiting on me / for approval?". For one day (default today, ET): every entry in your decision log (acted, proposed, drafted, deferred, only observed — with time, summary, who/what triggered it, and whether undo is still available), every ask / proposal / draft you filed and its status now (waiting, approved, rejected, executed, expired, undeliverable), what On Watch flagged and posted (room, channel, resolved or not), and the Slack Watch nudges and digest — grouped and counted, plus everything still waiting on a person from any day. ALWAYS call this before answering a question about what you did or what is pending; never answer from memory and never say you did nothing without checking. Param: date (YYYY-MM-DD).',
    input_schema: obj({ date: S.str }),
    run: async (input, ctx) => {
      const d = String(input?.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(input.date) : ctx.today
      return myActionsOn(d)
    },
  },

  {
    name: 'my_learning',
    description: 'Your own learning audit — the honest answer to "are you actually learning?". The latest run of the self-test: a 0–100 learning score and its four parts (retention of things Jon taught you, asked back with NO tools; how often your memories actually shape an answer; how often you re-propose something Jon already declined; your recommendation hit rate), the probes you failed with the expected answer next to yours, the honesty check, and the memories that never earn their place. Use it whenever someone asks whether you learn, remember, improve, or repeat mistakes. Quote the misses.',
    input_schema: obj({}),
    run: async () => myLearning(),
  },

  {
    name: 'automations',
    description: 'EVERY automated thing this app does — what it is, when it runs, whether it is switched ON, who its emails go to, and when it last actually ran. Use this for any "is X on", "why did/didn\'t X happen", "what runs at 7am", "what am I not seeing" question. Optional area filter: sync, guests, ops, money, slack, eve. This is the authoritative list; never guess whether an automation exists.',
    input_schema: obj({ area: S.str, only_off: S.bool }),
    run: async (input) => {
      const states = await allAutomationStates(input?.area)
      const runs = await lastRuns()
      const rows = states
        .filter(s => !input?.only_off || s.on === false)
        .map(s => {
          const r = runs[s.key] || null
          return {
            key: s.key, name: s.label, what: s.what, area: s.area,
            runs: s.runs,
            switched_on: s.on === null ? 'always on' : (s.on ? 'ON' : 'OFF'),
            why: s.onWhy,
            recipients: s.recipients?.length
              ? s.recipients.map(r2 => `${r2.path}: ${r2.count ? r2.to.join(', ') : 'NOBODY'}`).join(' | ')
              : undefined,
            last_run: r ? { at: r.at, ok: r.ok, did: r.itemCount, error: r.error } : (s.receipt === 'none' ? 'not recorded' : 'never recorded'),
            change_it_at: s.settings,
            note: s.notes,
          }
        })
      const off = rows.filter(r => r.switched_on === 'OFF').map(r => r.name)
      const noRecipients = states.filter(s => (s.recipients || []).some(r => r.count === 0)).map(s => s.label)
      return {
        count: rows.length,
        automations: rows,
        switched_off: off,
        // The maintenance briefs were "enabled" with nobody to send to for weeks. An automation
        // that is on and addressed to nobody is off, and should be named as such.
        enabled_but_addressed_to_nobody: noRecipients,
        how_to_read_this: 'A run recorded as "never recorded" means either the job has not run since receipts were added, or it does not write one. "Not recorded" means it never writes one by design. Neither proves it did not run — say which you mean.',
      }
    },
  },

  {
    name: 'automation_detail',
    description: 'One automation in full: what it does, its schedule, its live configuration switch, its recipients, and its last runs with outcomes. Pass name (e.g. "ops-brief", "guest-orders", "slack-alerts", or a cron path).',
    input_schema: obj({ name: S.str, runs: S.num }, ['name']),
    run: async (input) => {
      const def = findAutomation(String(input?.name || ''))
      if (!def) {
        return { error: `I do not know an automation called "${input?.name}". Call automations to see the list.`, known: AUTOMATIONS.map(a => a.key) }
      }
      const state = await automationState(def)
      const history = await runHistory(def.key, clampLimit(input?.runs, 10, 50))
      return {
        ...state,
        recent_runs: history.length ? history : 'no runs recorded for this one',
        receipt_kind: def.receipt,
      }
    },
  },

  {
    name: 'emails_sent',
    description: 'What outbound email this app actually sent, and to whom — every brief, notice and report goes through one sender, so this is the receipt. Filter by days, source (ops-brief, maint-brief, labor-trueup, salato-daily) or a recipient address. Use it to answer "did the brief go out this morning", "who is on the labor email", "has anything failed to send".',
    input_schema: obj({ days: S.num, source: S.str, to: S.str, limit: S.num }),
    run: async (input, ctx) => {
      const days = clampDays(input?.days, 7, 120)
      const lim = clampLimit(input?.limit, 40, 200)
      const since = new Date(Date.now() - days * 86400000).toISOString()
      let q = ctx.db.from('email_log').select('source,from_email,to_emails,cc_emails,subject,ok,error,attachments,sent_at')
        .gte('sent_at', since).order('sent_at', { ascending: false }).limit(lim)
      if (input?.source) q = q.eq('source', lc(input.source))
      const { data } = await safe(q, { data: [] } as any)
      let rows = ((data as any[]) || [])
      if (input?.to) rows = rows.filter(r => (r.to_emails || []).concat(r.cc_emails || []).some((e: string) => has(e, input.to)))
      const failed = rows.filter(r => r.ok === false)
      return {
        window_days: days,
        sent: rows.length - failed.length,
        failed: failed.length,
        truncated: rows.length >= lim,
        emails: rows.map(r => ({
          at: r.sent_at, source: r.source || 'unknown', subject: r.subject,
          to: (r.to_emails || []).join(', '), cc: (r.cc_emails || []).join(', ') || undefined,
          ok: r.ok, error: r.error || undefined,
        })),
        note: rows.length ? undefined : 'Nothing in the window. Receipts started on 2026-08-26 — an empty list before that date means the log did not exist yet, NOT that nothing was sent.',
      }
    },
  },

  {
    name: 'slack_routing',
    description: 'How Slack alerts are wired: which channel each building and department posts to, which alerts are switched on, their quiet hours and cooldowns, who approves what, and what each channel is for. Use this for "why did that go to that channel", "who gets told when a clean is late", "what is #vr-oasis for", "which alerts are off".',
    input_schema: obj({ building: S.str, event: S.str }),
    run: async (input) => {
      const rules: SlackRules = await getSlackRules()
      const names = await channelNames()
      const nameOf = (id: any) => (id && names[String(id)]?.name) || (id ? String(id) : '—')
      const describe = (id: any) => {
        const c = id && names[String(id)]
        if (!c) return undefined
        const d = [c.purpose, c.topic].filter(Boolean).join(' · ')
        return d || undefined
      }

      // A specific building: answer the exact routing question, with the reasoning shown.
      if (input?.building) {
        const g = groupForBuilding(rules, String(input.building))
        if (!g) {
          return {
            building: input.building,
            answer: `No routing group claims "${input.building}", so its alerts fall through to ${nameOf(rules.defaultChannel)} and then the firehose ${nameOf(rules.firehose)}.`,
            fix: 'Add the building to a group at /users → Settings → Slack alerts & rules → Areas.',
            groups: rules.groups.map(x => ({ label: x.label, buildings: x.buildings })),
          }
        }
        return {
          building: input.building,
          group: g.label,
          housekeeping: { channel: nameOf(g.housekeeping), what_for: describe(g.housekeeping) },
          maintenance: { channel: nameOf(g.maintenance), what_for: describe(g.maintenance) },
          supervisors_tagged: g.supervisors?.length || 0,
          vendor_building: !!g.vendor,
          how_it_resolves: 'The building is matched to a group, then the department picks the channel. If that department has no channel the other one is used, then the default channel, then the firehose.',
          vendor_note: g.vendor ? 'Vendor building: we do not staff it, so individual people are not tagged — the channel gets @here instead.' : undefined,
        }
      }

      const events = Object.entries(rules.events || {}).map(([k, r]: any) => ({
        event: (EVENT_LABELS as any)[k] || k,
        key: k,
        on: r?.enabled !== false,
        needs_approval: !!r?.approval,
        quiet_hours: (r?.quietStart === r?.quietEnd) ? 'none — any time' : `silent outside ${minsToClock(r?.quietStart)}–${minsToClock(r?.quietEnd)}`,
        cooldown_min: r?.cooldownMin ?? 0,
      }))
      const wanted = input?.event ? events.filter(e => has(e.key, input.event) || has(e.event, input.event)) : events

      return {
        areas: rules.groups.map(g => ({
          group: g.label,
          buildings: g.buildings,
          housekeeping: nameOf(g.housekeeping), housekeeping_for: describe(g.housekeeping),
          maintenance: nameOf(g.maintenance), maintenance_for: describe(g.maintenance),
          vendor: !!g.vendor, supervisors: g.supervisors?.length || 0,
        })),
        special_channels: {
          firehose: nameOf(rules.firehose), default: nameOf(rules.defaultChannel),
          ops: nameOf(rules.opsChannel), leadership: nameOf(rules.leadershipChannel),
        },
        alerts: wanted,
        alerts_off: events.filter(e => !e.on).map(e => e.event),
        approvers: (rules.approvers || []).length,
        approval_expiry_min: rules.approvalExpiryMin,
        thresholds: { overtime_hours: rules.overtimeHours, big_booking_usd: rules.bigBookingUsd, long_stay_nights: rules.longStayNights },
        change_it_at: '/users → Settings → Slack alerts & rules',
        channel_purpose_note: Object.values(names).some(c => c.purpose || c.topic)
          ? undefined
          : 'No channel purposes have been read from Slack yet (the directory refreshes every few hours). Until then I can say where things go, not what a channel is described as.',
      }
    },
  },

  {
    name: 'slack_queue',
    description: 'The Slack approval outbox — what is waiting for a human to approve right now, and what was recently sent, skipped or expired, with the reason. Use this for "what is pending", "did that alert go out", "why did nothing post last night".',
    input_schema: obj({ limit: S.num, recent: S.bool }),
    run: async (input) => {
      const lim = clampLimit(input?.limit, 20, 60)
      const names = await channelNames()
      const nameOf = (id: any) => (id && names[String(id)]?.name) || (id ? String(id) : '—')
      const shape = (r: any) => ({
        event: (EVENT_LABELS as any)[r.event_key] || r.event_key,
        building: r.building || undefined,
        channel: nameOf(r.channel_id),
        status: r.status,
        items: r.item_count,
        summary: String(r.summary || r.body || '').slice(0, 220),
        created: r.created_at, sent: r.sent_at || undefined,
        decided_by: r.decided_by || undefined,
        expires: r.expires_at || undefined,
        error: r.error || undefined,
      })
      const pend = await safe(pendingItems(lim), [] as any[])
      const recent = input?.recent === false ? [] : await safe(recentItems(lim), [] as any[])
      return {
        waiting_for_approval: (pend || []).map(shape),
        recent: (recent || []).map(shape),
        note: 'Nothing here sends until it is approved in the Command Center or by the one-time link DM\'d to an approver. Unapproved items expire rather than piling up.',
      }
    },
  },

  // SHARE LINKS (2026-09-18). "Which links are still active?" has one answer: share_links. Every
  // row is a page somebody outside the app can open — a vendor board, the marketing report, a
  // scheduler link. NO PASSCODES, ever: the rows hold only scrypt hashes and Eve gets the hint at
  // most. What she can say is who it is for, what it shows, whether it is live, and when it was
  // last opened.
  {
    name: 'share_links',
    description: 'EVERY share link the company has handed out — vendor boards, scheduler links, field boards, parking boards, the marketing / audit / Botanica reports, custom reports — with who it is for (audience), what it shows, whether it is live / expiring / expired / revoked / waiting for a passcode, when it was last opened and how often. Use for "which links are still active", "does Botanica have a link", "who has a link to X", "what expires this week". Never contains a passcode. Filters: audience (crew|vendor|owner|guest|partner|internal), kind, status (live|expiring|expired|revoked|unset), text.',
    input_schema: obj({ audience: S.str, kind: S.str, status: S.str, text: S.str, include_revoked: S.bool }),
    run: async (input) => {
      const { data } = await supabaseAdmin().from('share_links')
        .select('code, kind, title, label, audience, scope, passcode_hint, open, expires_at, revoked_at, created_by, created_at, last_used_at, uses, notes')
        .order('created_at', { ascending: false }).limit(400)
      const q = lc(input?.text)
      const rows = ((data || []) as any[])
        .map(r => ({ ...r, status: linkStatus(r), what: describeLink(r), path: pathFor(String(r.kind), String(r.code)) }))
        .filter(r => input?.include_revoked === true || !r.revoked_at)
        .filter(r => !input?.audience || r.audience === lc(input.audience))
        .filter(r => !input?.kind || r.kind === lc(input.kind))
        .filter(r => !input?.status || r.status === lc(input.status))
        .filter(r => !q || has(String(r.title || r.label || '') + ' ' + r.what + ' ' + String(r.notes || '') + ' ' + r.kind, q))
        .slice(0, clampLimit(input?.limit, 120))
        .map(r => ({
          title: r.title || r.label || r.code, kind: r.kind, for: r.audience, shows: r.what, page: r.path,
          status: r.status, lock: r.open ? 'open link (no passcode)' : r.passcode_hint ? 'passcode set' : 'NO PASSCODE YET — shut until one is set on /links',
          expires: r.expires_at || 'never', last_opened: r.last_used_at || 'never', opens: Number(r.uses) || 0,
          made_by: r.created_by || null, made: r.created_at, notes: r.notes || undefined,
        }))
      return {
        count: rows.length,
        links: rows,
        waiting_for_passcode: rows.filter(r => r.status === 'unset').map(r => r.title),
        expiring_soon: rows.filter(r => r.status === 'expiring').map(r => r.title),
        how_to_read_this: 'Every row is a page people outside the app can open. Passcodes are never available here — say "set or rotate it on the Share Links page" if asked. "Live" means not revoked, not expired and lockable; "unset" means nobody can open it until a passcode is set.',
      }
    },
  },
]

export const SYSTEM_DOMAIN: EveDomain = {
  key: 'system',
  label: 'Automations & Slack wiring',
  blurb: 'every automated job and whether it is on, what email actually went out and to whom, how Slack alerts are routed, what is waiting for approval, and every share link handed out (who it is for, live or not)',
  // my_actions_today lives in core (registry.coreTools) so "what did you do?" never costs a turn.
  tools: SYSTEM_TOOLS.filter(t => t.name !== 'my_actions_today'),
}
