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

/**
 * ADMIN CHANGES (2026-09-28 audit, B-11). Who changed which account, role, API key or in-app
 * credential: one row per successful write in /api/users, /api/roles, /api/api-keys and
 * /api/share-settings. Same table as every gated API call, kind 'api' (the table's check allows
 * only 'page' | 'api'); `feature` reads "<area>:<action>" so the Activity tab shows it as one line,
 * and `meta.admin` marks it. `meta` carries the target and WHICH fields changed — never a password,
 * a key or a credential's value; callers pass names, not values, for anything secret.
 *
 * AWAITED, unlike logActivity: a privileged change is rare and its record matters more than the
 * few milliseconds, and a fire-and-forget insert can be cut off when the function freezes after
 * the response. Still never throws.
 */
export async function logAdmin(row: {
  email: string | null | undefined; area: string; action: string; target?: string | null
  fields?: string[]; detail?: Record<string, any>
  req?: { headers: { get(n: string): string | null } }
}): Promise<void> {
  try {
    const email = String(row.email || '').trim().toLowerCase()
    if (!email) return
    const ip = row.req ? (String(row.req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null) : null
    await supabaseAdmin().from('user_activity').insert({
      email,
      kind: 'api',
      path: null,
      feature: (row.area + ':' + row.action).slice(0, 60),
      need: 'full',
      allowed: true,
      meta: { admin: true, action: row.action, target: row.target ? String(row.target).slice(0, 200) : null, ...(row.fields && row.fields.length ? { fields: row.fields } : {}), ...(row.detail || {}), ...(ip ? { ip } : {}) },
    })
  } catch { /* never let logging hurt the request */ }
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
