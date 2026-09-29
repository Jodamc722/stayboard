// WHO MAY RUN A SCHEDULED JOB.
//
// History, briefly: this app grew two ways of authorising a cron — an OPEN pattern ("require the
// bearer when CRON_SECRET is set, otherwise run") and a GATED one ("bearer, or a signed-in
// session") — at a time when CRON_SECRET was not set, so the gated five never ran on schedule and
// the open twenty ran for anyone who knew the URL. CRON_SECRET IS SET now (Vercel sends it as a
// bearer on every scheduled call), which makes both patterns the same thing in practice: the
// bearer, or nothing.
//
// Two things were still wrong with that (2026-09-28 audit, 07 B-4/B-13, 03 #26):
//   1. It failed OPEN. If the env var ever went missing — a new project, a copied deployment, a
//      typo — every job that writes Guesty calendars, hammers Breezeway or spends model money
//      would run for any anonymous caller. A missing secret in a production build now denies.
//   2. The manual paths trusted too little or too much. Some accepted ANY signed-in session
//      (a disabled employee's still-valid session included), some trusted a spoofable
//      `x-vercel-cron` header, and the bearer-only ones left no way for an admin to press
//      "Run now" at all.
//
// requireCron() is the one answer: the scheduler's bearer, or a signed-in admin (or a caller-given
// stricter/looser gate for the few jobs a non-admin legitimately presses), or nothing.
import 'server-only'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseAdmin } from './supabase-admin'
import { requireAdmin, type Access } from './access'
import { safeEqual } from './signing'

/** A deployed build. Local `next dev` is the only place a missing secret may mean "open". */
function isProductionBuild(): boolean {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'
}

/**
 * Is this request the scheduler? With CRON_SECRET set, only the matching bearer passes (Vercel
 * sends it on every cron call). Without it: denied in any deployed build, open only in local dev.
 */
export function cronAllowed(req: NextRequest | Request): { ok: boolean; viaSecret: boolean } {
  const secret = process.env.CRON_SECRET
  if (!secret) return { ok: !isProductionBuild(), viaSecret: false }
  const auth = req.headers.get('authorization') || ''
  // CONSTANT TIME (2026-09-29 review): timingSafeEqual on equal-length buffers (lib/signing
  // safeEqual), so how long a wrong bearer takes to refuse says nothing about how much of it matched.
  const ok = safeEqual(auth, 'Bearer ' + secret)
  return { ok, viaSecret: ok }
}

export type CronGate =
  | { ok: true; viaSecret: boolean; access: Access | null; res?: undefined }
  | { ok: false; viaSecret: false; access: null; res: NextResponse }

type FallbackGate = () => Promise<{ ok: boolean; access?: Access | null }>

/**
 * The scheduler (bearer), or a person allowed to press "Run now" — a signed-in admin by default,
 * or whatever `fallback` gate the route passes (e.g. requireUser for a Sync button the whole team
 * uses). `access` is set when a person ran it, null when the scheduler did.
 *
 * A refusal is ALWAYS a 401 — never the fallback's 403 — so withRouteReceipt treats an
 * unauthorised poke as "not a run" rather than as a failed run.
 */
export async function requireCron(req: NextRequest | Request, opts: { fallback?: FallbackGate } = {}): Promise<CronGate> {
  const c = cronAllowed(req)
  if (c.viaSecret) return { ok: true, viaSecret: true, access: null }
  try {
    const g = opts.fallback ? await opts.fallback() : await requireAdmin()
    if (g.ok) return { ok: true, viaSecret: false, access: g.access || null }
  } catch { /* no session to read (the scheduler, a script) — fall through */ }
  // Local development without a secret: open, as it always was.
  if (c.ok) return { ok: true, viaSecret: false, access: null }
  return { ok: false, viaSecret: false, access: null, res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
}

/**
 * Has this job already run inside its own interval? Uses `automation_runs` as the ledger.
 * Returns the skip payload to hand straight back, or null to proceed.
 *
 * Deliberately fails OPEN (returns null) if the ledger cannot be read: a throttle that cannot see
 * the history must not become the reason a job never runs.
 */
export async function tooSoon(name: string, minMinutes: number): Promise<{ skipped: string; lastRunAt: string } | null> {
  try {
    const { data } = await supabaseAdmin()
      .from('automation_runs')
      .select('ran_at')
      .eq('name', name)
      .order('ran_at', { ascending: false })
      .limit(1)
    const last = ((data as any[]) || [])[0]?.ran_at
    if (!last) return null
    const mins = (Date.now() - new Date(last).getTime()) / 60000
    if (mins < minMinutes) {
      return { skipped: `ran ${Math.round(mins)} min ago; this job runs at most every ${minMinutes} min`, lastRunAt: last }
    }
    return null
  } catch {
    return null
  }
}
