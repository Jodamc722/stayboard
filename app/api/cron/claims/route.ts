// KEEP CLAIMS FROM AGEING OUT.
//
// A due date nobody is shown is a wish. Everything else in the claims board — the channel windows,
// the turnover clock, the evidence gates — is worth nothing if the claim simply sits in Draft
// while the fortnight runs out, which is exactly what happened in Asana and is why claims were
// filed on day 12 in the first place.
//
// Once a morning: anything unfiled that is due today, overdue, or about to lose its evidence to
// the next guest gets a notification, and the claim remembers it was nudged so the same card does
// not shout every single day.
//
// BARE PATH ON PURPOSE — a Vercel cron pointed at a path WITH A QUERY STRING never fires.
// Auth: the scheduler's bearer, or a signed-in admin (lib/cron-auth requireCron).
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireCron, cronAllowed } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'
import { atEasternHour } from '@/lib/et-clock'
import { getRoles, resolveLevels } from '@/lib/access'
import { notify } from '@/lib/notify'
import { getSetting, setSetting } from '@/lib/app-settings'
import { nextCheckInMap } from '@/lib/claim-turnover'
import { claimTitle, daysUntil, effectiveDue, money, num, itemsTotal, todayET, type Claim } from '@/lib/claims'

// "Already shouted today", kept in app_settings rather than a column on claims — same reason the
// turnover clock is computed rather than stored: this feature had to work without a migration.
// A claim id -> date map, pruned to what is still open so it cannot grow forever.
const NUDGED_KEY = 'claims_nudged_on'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const OPEN_STAGES = ['draft', 'review', 'ready']

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

/**
 * Active people whose resolved level on Claims is 'full' (lib/access resolveLevels — the same
 * resolution the app gates with), not counting admins, who hold everything by role. When nobody
 * holds it, the active admins. Empty on a read error — the claim's owner still gets the bell.
 */
async function claimsApprovers(db: any): Promise<{ emails: string[]; basis: 'claims-full' | 'admins' | 'none' }> {
  try {
    const { data, error } = await db.from('app_users').select('*').eq('status', 'active')
    if (error) return { emails: [], basis: 'none' }
    const roles = await getRoles()
    const full: string[] = []
    const admins: string[] = []
    for (const u of (data || []) as any[]) {
      const email = str(u.email).toLowerCase()
      if (!email) continue
      if (u.role === 'admin') { admins.push(email); continue }
      if (resolveLevels(u, roles).levels['claims'] === 'full') full.push(email)
    }
    if (full.length) return { emails: full, basis: 'claims-full' }
    return { emails: admins, basis: admins.length ? 'admins' : 'none' }
  } catch { return { emails: [], basis: 'none' } }
}

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const started = Date.now()
  const today = todayET()
  try {
    const db = supabaseAdmin()
    const { data, error } = await db.from('claims')
      .select('*').is('deleted_at', null).in('stage', OPEN_STAGES).limit(500)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    const raw = (data || []) as Claim[]
    // The turnover clock, fresh, for the whole batch.
    const arrivals = await nextCheckInMap(db, raw as any[])
    const claims: Claim[] = raw.map(c => ({ ...c, next_check_in: arrivals[String(c.id)] || null }))
    const nudged = await getSetting<Record<string, string>>(NUDGED_KEY, {})

    const urgent: { claim: Claim; why: string; rank: number }[] = []
    for (const c of claims) {
      const due = daysUntil(effectiveDue(c).due)
      const hard = daysUntil(c.deadline_on)
      const arrival = daysUntil(c.next_check_in)
      let why = ''
      let rank = 9
      // Ordered by how final the consequence is, not by how soon the date is.
      if (hard !== null && hard < 0) { why = 'the filing window has closed'; rank = 0 }
      else if (hard !== null && hard <= 2) { why = 'the filing window closes in ' + hard + ' day(s)'; rank = 1 }
      else if (arrival !== null && arrival >= 0 && arrival <= 1) { why = 'the next guest arrives ' + (arrival === 0 ? 'today' : 'tomorrow') + ' — photograph it now'; rank = 2 }
      else if (due !== null && due < 0) { why = 'due ' + Math.abs(due) + ' day(s) ago'; rank = 3 }
      else if (due !== null && due === 0) { why = 'due today'; rank = 4 }
      else if (due !== null && due <= 2) { why = 'due in ' + due + ' day(s)'; rank = 5 }
      if (!why) continue
      // Already shouted today. An alert that repeats every morning stops being an alert.
      if (str(nudged[String(c.id)]) === today) continue
      urgent.push({ claim: c, why, rank })
    }
    urgent.sort((a, b) => a.rank - b.rank)

    if (!urgent.length) {
      return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), elapsed_ms: Date.now() - started, checked: claims.length, nudged: 0 })
    }

    // WHO HEARS ABOUT IT (2026-09-28, 09 D20): the claim's owner, plus the people whose role holds
    // Claims at FULL — the ones who approve and file — instead of every admin. Admins are the
    // fallback only when no role holds claims:full, so an ageing claim always reaches somebody.
    const approvers = await claimsApprovers(db)

    let sent = 0
    const nextNudged: Record<string, string> = {}
    // Keep only claims that are still open, so the map cannot grow without bound.
    for (const c of claims) { const p = str(nudged[String(c.id)]); if (p) nextNudged[String(c.id)] = p }

    for (const u of urgent.slice(0, 40)) {
      const c = u.claim
      const amount = num(c.amount_sought) || itemsTotal(c.items)
      const eff = effectiveDue(c)
      const to = Array.from(new Set(approvers.emails.concat([str(c.assignee_email).toLowerCase()]).filter(Boolean)))
      if (!to.length) continue
      try {
        await notify(to, {
          kind: 'claim',
          title: 'Claim ' + u.why + ': ' + claimTitle(c),
          body: (amount > 0 ? money(amount) + ' · ' : '') + String(c.channel || '') + (eff.due ? ' · due ' + eff.due : ''),
          link: '/claims/' + c.id,
        })
        sent++
        nextNudged[String(c.id)] = today
      } catch { /* one bad claim must not stop the round */ }
    }
    if (sent) { try { await setSetting(NUDGED_KEY, nextNudged, 'cron') } catch { /* worst case it repeats tomorrow */ } }

    return NextResponse.json({
      ok: true, ranAt: new Date().toISOString(), elapsed_ms: Date.now() - started,
      checked: claims.length, nudged: sent, audience: approvers.basis,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

// RECEIPT (2026-09-28), under the registry's key for this job (lib/eve/automations 'claims-nudge').
const receipted = withRouteReceipt<NextRequest>('claims-nudge', run, { count: (b) => (typeof b.nudged === 'number' ? b.nudged : undefined) })

// 8:08AM EASTERN ALL YEAR (2026-09-29). vercel.json fires this at 12:08 AND 13:08 UTC; on the
// scheduler's own call, the one that is not 8am in New York stops here — before the receipt or a
// single nudge (lib/et-clock). An admin's "Run now" carries no bearer and is never skipped.
async function scheduled(req: NextRequest) {
  if (cronAllowed(req).viaSecret && !atEasternHour(8)) return NextResponse.json({ ok: true, skipped: 'daylight-saving twin — this job runs at 8am Eastern' })
  return receipted(req)
}
export async function GET(req: NextRequest) { return scheduled(req) }
export async function POST(req: NextRequest) { return scheduled(req) }
