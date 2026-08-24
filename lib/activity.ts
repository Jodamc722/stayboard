// APP-WIDE ACTIVITY LOG (Jon, 2026-08-22: "see user logs per user... track the meta data and
// record all activity in the app").
//
// METADATA ONLY, BY DESIGN. Who, what screen or feature, when, with how much power. Request
// bodies, query results and secrets are never written here — an activity log that stores what
// people SAW becomes the most sensitive table in the database overnight.
//
// FIRE AND FORGET. Logging must never slow a request or take one down: every failure path is
// swallowed, and a missing table (migration 047 not run yet) simply means no rows until it is.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'

export type ActivityRow = {
  email: string
  kind: 'page' | 'api'
  path?: string | null
  feature?: string | null
  need?: string | null
  allowed?: boolean
  meta?: Record<string, any>
}

export function logActivity(row: ActivityRow): void {
  try {
    const email = String(row.email || '').trim().toLowerCase()
    if (!email) return
    supabaseAdmin().from('user_activity').insert({
      email,
      kind: row.kind,
      path: row.path ? String(row.path).slice(0, 300) : null,
      feature: row.feature ? String(row.feature).slice(0, 60) : null,
      need: row.need ? String(row.need).slice(0, 10) : null,
      allowed: row.allowed !== false,
      meta: row.meta && typeof row.meta === 'object' ? row.meta : {},
    }).then(() => undefined, () => undefined)
  } catch { /* never let logging hurt the request */ }
}
