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

export const SYSTEM_TOOLS: EveTool[] = [
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
]

export const SYSTEM_DOMAIN: EveDomain = {
  key: 'system',
  label: 'Automations & Slack wiring',
  blurb: 'every automated job and whether it is on, what email actually went out and to whom, how Slack alerts are routed, and what is waiting for approval',
  tools: SYSTEM_TOOLS,
}
