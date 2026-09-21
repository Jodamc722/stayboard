// RECEIPTS. Every scheduled job that matters writes one row here when it finishes.
//
// The reason this exists: for months the only proof that a nightly job had run was that its
// side-effects looked plausible. When the maintenance brief sent nothing for weeks, nothing was
// broken enough to raise an error — the job ran, found an empty recipient list, and returned 200.
// A green cron and a working automation are not the same claim, and only one of them was ever
// checked.
//
// Deliberately fire-and-forget and deliberately tiny: a job must never fail because its receipt
// failed to write, and a receipt nobody can afford to write is a receipt that gets removed the
// first time someone optimises the hot path.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'

export type RunReceipt = {
  /** Registry key from lib/eve/automations.ts. Use the same string every time. */
  name: string
  ok?: boolean
  /** What it actually did — 4 emails, 0 alerts, 37 tasks. The number a person asks for. */
  itemCount?: number
  detail?: any
  error?: string | null
  ms?: number
}

export async function recordRun(r: RunReceipt): Promise<void> {
  try {
    await supabaseAdmin().from('automation_runs').insert({
      name: String(r.name || 'unknown').slice(0, 80),
      ok: r.ok !== false,
      item_count: Number.isFinite(r.itemCount as any) ? Math.round(r.itemCount as number) : null,
      detail: r.detail ?? null,
      error: r.error ? String(r.error).slice(0, 500) : null,
      ms: Number.isFinite(r.ms as any) ? Math.round(r.ms as number) : null,
    })
  } catch { /* a missing receipt must never take down the job that earned it */ }
}

/** Wrap a job so the receipt is written whether it succeeds, returns, or throws. */
export async function withReceipt<T>(name: string, fn: () => Promise<T>, summarise?: (out: T) => { itemCount?: number; detail?: any }): Promise<T> {
  const t0 = Date.now()
  try {
    const out = await fn()
    const s = summarise ? summarise(out) : {}
    await recordRun({ name, ok: true, ms: Date.now() - t0, ...s })
    return out
  } catch (e: any) {
    await recordRun({ name, ok: false, ms: Date.now() - t0, error: String(e?.message || e) })
    throw e
  }
}

/**
 * Wrap a cron ROUTE HANDLER so the receipt is read off its own JSON response. For the jobs that
 * return `NextResponse.json({ ok, sent, to, ... })` from a dozen places (labor-trueup, eod-recap,
 * ops-brief…), threading recordRun through every return is exactly the wiring that gets missed —
 * which is why the Learning tab said "missing" for them. `skipWhen` keeps a signed-in preview or
 * test from writing a receipt as if the real send had happened.
 */
export function withRouteReceipt<R extends Request>(
  name: string,
  handler: (req: R) => Promise<Response>,
  opts: { skipWhen?: (req: R) => boolean; count?: (body: any) => number | undefined } = {},
): (req: R) => Promise<Response> {
  return async (req: R) => {
    if (opts.skipWhen && opts.skipWhen(req)) return handler(req)
    const t0 = Date.now()
    let res: Response
    try { res = await handler(req) } catch (e: any) {
      await recordRun({ name, ok: false, ms: Date.now() - t0, error: String(e?.message || e) })
      throw e
    }
    let body: any = null
    try { body = await res.clone().json() } catch { body = null }
    if (res.status === 401) return res   // an unauthorized poke is not a run
    const b = body && typeof body === 'object' ? body : {}
    const ok = res.status < 400 && b.ok !== false && !b.error
    let itemCount = opts.count ? opts.count(b) : undefined
    if (itemCount == null) {
      for (const k of ['to', 'posts', 'count', 'sent', 'upserted', 'tasks']) {
        const v = b[k]
        if (typeof v === 'number') { itemCount = v; break }
        if (typeof v === 'boolean') { itemCount = v ? 1 : 0; break }
      }
    }
    const detail: Record<string, any> = {}
    for (const k of ['reason', 'skipped', 'subject', 'sent', 'to', 'alert', 'comments']) if (b[k] != null && typeof b[k] !== 'object') detail[k] = b[k]
    await recordRun({ name, ok, ms: Date.now() - t0, itemCount, detail: Object.keys(detail).length ? detail : null, error: b.error ? String(b.error) : (res.status >= 400 ? `HTTP ${res.status}` : null) })
    return res
  }
}

export type LastRun = { name: string; ok: boolean; at: string; itemCount: number | null; error: string | null; ms: number | null }

/** The most recent run of each named automation, in one query. */
export async function lastRuns(names?: string[]): Promise<Record<string, LastRun>> {
  const out: Record<string, LastRun> = {}
  try {
    let q = supabaseAdmin().from('automation_runs')
      .select('name,ok,ran_at,item_count,error,ms')
      .order('ran_at', { ascending: false })
      .limit(600)
    if (names && names.length) q = q.in('name', names)
    const { data } = await q
    for (const r of ((data as any[]) || [])) {
      const n = String(r.name)
      if (out[n]) continue          // ordered desc, so the first one we meet is the latest
      out[n] = { name: n, ok: r.ok !== false, at: r.ran_at, itemCount: r.item_count ?? null, error: r.error ?? null, ms: r.ms ?? null }
    }
  } catch { /* no receipts yet is a real answer, not an error */ }
  return out
}

export async function runHistory(name: string, limit = 20): Promise<LastRun[]> {
  try {
    const { data } = await supabaseAdmin().from('automation_runs')
      .select('name,ok,ran_at,item_count,error,ms')
      .eq('name', name)
      .order('ran_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 100))
    return ((data as any[]) || []).map(r => ({ name: String(r.name), ok: r.ok !== false, at: r.ran_at, itemCount: r.item_count ?? null, error: r.error ?? null, ms: r.ms ?? null }))
  } catch { return [] }
}

// ---- Outbound email ------------------------------------------------------------------------------
// Written by ONE place (sendGmail), so no brief can be added later and forget to log itself.

export async function recordEmail(e: {
  source?: string | null; fromEmail?: string | null; to: string[]; cc?: string[]
  subject?: string | null; ok: boolean; error?: string | null; attachments?: number
}): Promise<void> {
  try {
    await supabaseAdmin().from('email_log').insert({
      source: e.source ? String(e.source).slice(0, 60) : null,
      from_email: e.fromEmail || null,
      to_emails: (e.to || []).slice(0, 40),
      cc_emails: (e.cc || []).slice(0, 40),
      subject: e.subject ? String(e.subject).slice(0, 300) : null,
      ok: !!e.ok,
      error: e.error ? String(e.error).slice(0, 500) : null,
      attachments: Number(e.attachments || 0),
    })
  } catch { /* never block a send on its own receipt */ }
}

/**
 * Guess which automation an email came from, from its subject. Best effort on purpose: the
 * alternative was threading a `source` argument through six call sites and every future one,
 * which is exactly the kind of wiring that gets forgotten and then lies.
 */
export function sourceFromSubject(subject: string | null | undefined): string | null {
  const s = String(subject || '').toLowerCase()
  if (!s) return null
  if (s.includes('maintenance')) return 'maint-brief'
  if (s.includes('labor') || s.includes('payroll')) return 'labor-trueup'
  if (s.includes('salato')) return 'salato-daily'
  if (s.includes('owner')) return 'owner'
  if (s.includes('brief') || s.includes('ops command') || s.includes('good morning')) return 'ops-brief'
  if (s.includes('order')) return 'guest-orders'
  if (s.includes('registration') || s.includes('notice')) return 'reservation-notices'
  return null
}
