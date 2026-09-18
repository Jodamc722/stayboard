// THE CHANNEL TRIGGER — run the health check, compare it with yesterday's, and tell somebody when a
// listing has dropped off a channel it was on.
//
// Jon, 2026-09-18: "A report or page that creates a trigger if a listing is suspended etc."
//
// WHEN IT RUNS. Chained into the listings sync (app/api/cron/guesty-catalog) rather than given a
// cron of its own: `raw.integrations` only changes when that sync writes it, so running this at any
// other moment compares the same data with itself — and vercel.json is at its 40-cron cap anyway.
// The Refresh button on /channels and POST /api/channels/check run the same function.
//
// THREE OUTPUTS, one snapshot:
//   1. Slack — ONE message per run listing every alert-worthy transition, to the leadership room
//      (the same room the labor report and the arrivals heads-up use). Through the outbox, so the
//      master mute and the per-event switch in /users → Slack alerts apply like any other alert.
//   2. eve_audits — one open finding per listing × channel that is currently off a major channel,
//      stable id `channel:<listingId>:<platform>`; it closes itself the run the channel is live again.
//   3. The snapshot itself (app_settings.channel_health_snapshot) — what the Command Center's Fix
//      band and Eve read, so neither has to recompute 290 × 9 cells to show a row.
//
// FIRST RUN. No previous snapshot means nothing has "changed", so no Slack message — but the
// audit findings ARE written for whatever is already broken, because a listing that was already
// off Booking.com before we started looking is not less off Booking.com.
import 'server-only'
import { revalidateTag } from 'next/cache'
import { supabaseAdmin } from './supabase-admin'
import { recordRun } from './automation-runs'
import { draft } from './slack-queue'
import { getSlackRules } from './slack-rules'
import { CHANNEL_LABEL, VERDICT_LABEL, type CellVerdict } from './channel-types'
import {
  buildChannelHealth, readSnapshot, writeSnapshot, snapshotOf, diffChannelHealth, problemsFromSnapshot,
  type ChannelHealth, type ChannelSnapshot, type Transition,
} from './channel-health'

export const CHANNELS_CACHE_TAG = 'channels'
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')

export const CHANNEL_FIX = 'Reconnect on Guesty → Listings → Channels'

export type ChannelCheckResult = {
  ok: boolean
  at: string
  firstRun: boolean
  listings: number
  problems: number
  transitions: number
  alerts: Transition[]
  audits: { opened: number; resolved: number }
  slack: any
  errors: string[]
  ms: number
}

const label = (v: string) => (VERDICT_LABEL as Record<string, string>)[v] || v
const chLabel = (p: string) => p === 'airbnb2:approval' ? 'Airbnb approval' : (CHANNEL_LABEL[p] || p)

/** The findings for what is broken RIGHT NOW, from the snapshot. Shared with Eve's standing audit so both write identical rows. */
export function channelFindings(s: ChannelSnapshot | null): { id: string; area: 'listings'; severity: 'warn'; title: string; detail: string; fix: string; count: number; evidence: any }[] {
  return problemsFromSnapshot(s).map(p => ({
    id: 'channel:' + p.listingId + ':' + p.platform,
    area: 'listings' as const,
    severity: 'warn' as const,
    title: `${p.unit} is ${label(p.verdict).toLowerCase()} on ${chLabel(p.platform)}`,
    detail: `Guesty reports this listing as "${label(p.verdict)}" on ${chLabel(p.platform)}${p.building ? ' (' + p.building + ')' : ''}. While it stays that way the unit cannot be booked there, and nothing else in the app will notice — the calendar looks the same either way.`,
    fix: CHANNEL_FIX,
    count: 1,
    evidence: { listingId: p.listingId, platform: p.platform, verdict: p.verdict, href: '/channels?listing=' + p.listingId },
  }))
}

async function writeAudits(next: ChannelSnapshot): Promise<{ opened: number; resolved: number; error?: string }> {
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const findings = channelFindings(next)
  const ids = findings.map(f => f.id)
  let opened = 0, resolved = 0
  try {
    // What is already on the tab, so first_seen_at survives and a still-open row is not "new".
    const prev: any = await db.from('eve_audits').select('id,status,first_seen_at').like('id', 'channel:%').limit(3000)
    const prevRows: any[] = (prev && prev.data) || []
    const prevById: Record<string, any> = {}
    for (const r of prevRows) prevById[String(r.id)] = r
    const rows = findings.map(f => {
      const old = prevById[f.id]
      const wasOpen = old && (old.status === 'open' || old.status === 'acknowledged' || old.status === 'snoozed')
      if (!wasOpen) opened++
      return {
        id: f.id, area: f.area, severity: f.severity, title: f.title.slice(0, 300), detail: f.detail.slice(0, 2000),
        fix: f.fix.slice(0, 600), count: f.count, evidence: f.evidence,
        // Keep an acknowledged/snoozed row as it is — a person decided that; only a resolved or
        // absent row goes back to open.
        status: wasOpen ? old.status : 'open',
        first_seen_at: wasOpen && old.first_seen_at ? old.first_seen_at : now,
        last_seen_at: now, resolved_at: null,
      }
    })
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await db.from('eve_audits').upsert(rows.slice(i, i + 100), { onConflict: 'id' })
      if (error) return { opened, resolved, error: 'eve_audits upsert: ' + error.message.slice(0, 160) }
    }
    // Live again → the finding closes itself.
    const healed = prevRows.filter(r => r.status !== 'resolved' && ids.indexOf(String(r.id)) < 0).map(r => String(r.id))
    for (let i = 0; i < healed.length; i += 100) {
      await db.from('eve_audits').update({ status: 'resolved', resolved_at: now }).in('id', healed.slice(i, i + 100))
    }
    resolved = healed.length
    return { opened, resolved }
  } catch (e: any) {
    return { opened, resolved, error: String(e?.message || e).slice(0, 160) }
  }
}

function slackBody(alerts: Transition[]): { body: string; summary: string } {
  const n = alerts.length
  const lines = alerts.map(t =>
    '• *' + t.unit + '*' + (t.building ? ' (' + t.building + ')' : '') + ' · ' + chLabel(t.platform) + ' · ' +
    (t.platform === 'airbnb2:approval' ? t.from + ' → *' + t.to + '*' : label(t.from) + ' → *' + label(t.to) + '*'))
  const body = ':electric_plug: *' + n + ' listing' + (n === 1 ? '' : 's') + ' dropped off a channel since the last check*\n' +
    lines.join('\n') +
    '\nGuests cannot book these there until they are reconnected. ' + CHANNEL_FIX + '.\n' +
    '<' + APP_URL + '/channels?problems=1|Open Channel connections>'
  return { body, summary: n + ' listing' + (n === 1 ? '' : 's') + ' lost a channel connection' }
}

/**
 * Run the check now. Never throws on its own reporting: a Slack or audit failure is returned in
 * `errors`, and the snapshot is still written, because the page must not go stale over a Slack
 * scope error.
 */
export async function runChannelCheck(opts?: { health?: ChannelHealth }): Promise<ChannelCheckResult> {
  const started = Date.now()
  const errors: string[] = []
  const health = opts?.health || await buildChannelHealth()
  const prev = await readSnapshot()
  const next = snapshotOf(health)
  const transitions = diffChannelHealth(prev, next)
  const alerts = transitions.filter(t => t.alert)

  await writeSnapshot(next)
  try { revalidateTag(CHANNELS_CACHE_TAG) } catch { /* outside a request scope — the 10-minute TTL covers it */ }

  const audits = await writeAudits(next)
  if (audits.error) errors.push(audits.error)

  let slack: any = prev ? 'nothing changed' : 'first run — snapshot saved, nothing compared'
  if (prev && alerts.length) {
    try {
      const rules = await getSlackRules()
      const { body, summary } = slackBody(alerts)
      slack = await draft({
        eventKey: 'channel_health',
        // One message per run: a re-run the same day with new transitions gets its own message.
        groupKey: 'channel_health:' + next.at.slice(0, 16),
        channelId: rules.leadershipChannel || rules.opsChannel || rules.defaultChannel || rules.firehose,
        body, summary, audience: rules.core, itemCount: alerts.length,
      }, rules)
    } catch (e: any) {
      slack = { ok: false, reason: String(e?.message || e).slice(0, 160) }
      errors.push('slack: ' + slack.reason)
    }
  }

  const problems = problemsFromSnapshot(next).length
  const ms = Date.now() - started
  recordRun({
    name: 'channel-check', ok: errors.length === 0, itemCount: alerts.length,
    detail: { listings: health.listings.length, problems, transitions: transitions.length, alerts: alerts.length, audits, slack, firstRun: !prev },
    error: errors.join('; ') || null, ms,
  })
  return { ok: errors.length === 0, at: next.at, firstRun: !prev, listings: health.listings.length, problems, transitions: transitions.length, alerts, audits: { opened: audits.opened, resolved: audits.resolved }, slack, errors, ms }
}

/** The current problem rows without a recompute — what the Command Center and Eve read. */
export async function channelProblemsNow() {
  const s = await readSnapshot()
  return { at: s ? s.at : null, problems: problemsFromSnapshot(s) }
}

export type { CellVerdict }
