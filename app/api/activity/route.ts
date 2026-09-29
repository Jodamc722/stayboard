// USER ACTIVITY — POST logs a page view (called by the app shell as people navigate);
// GET reads the log, per user, for the Vault's Activity tab.
//
// READING IS OWNER/ADMIN ONLY. Watching what the team does is a management power, so the read side
// is limited to the people who can already change roles.
//
// THIS GATE USED TO BE UNPASSABLE. It read `requireLevel('users', 'full')` — but 'users' is not a
// key in lib/features.ts at all (/users is in UNGATED_PAGES), so `levels['users']` was always
// undefined, atLeast() normalised that to 'off', and the check failed for every caller INCLUDING
// the owner. Meanwhile every gated API call kept writing an activity row, so the log filled up
// with data nobody on earth could open. A permission check against a permission that does not
// exist does not fail safe — it fails silent, which is worse.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { logActivity } from '@/lib/activity'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed || !access.email) return NextResponse.json({ ok: false }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const path = String(body?.path || '').slice(0, 300)
  if (!path.startsWith('/')) return NextResponse.json({ ok: false }, { status: 400 })
  logActivity({
    email: access.email, kind: 'page', path,
    meta: {
      ua: String(req.headers.get('user-agent') || '').slice(0, 160),
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    },
  })
  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  // Admins of the app — the same bar /users itself enforces, which is the real intent.
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ ok: false, error: 'Admins only.' }, { status: 403 })
  const sp = req.nextUrl.searchParams
  const email = String(sp.get('email') || '').trim().toLowerCase()
  const days = Math.max(1, Math.min(30, parseInt(String(sp.get('days') || '7'), 10) || 7))
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const db = supabaseAdmin()
  try {
    let sel = db.from('user_activity').select('at,email,kind,path,feature,need,allowed,meta')
      .gte('at', since).order('at', { ascending: false }).limit(1000) // deliberate cap: newest-first feed (the tab lists the newest 400); picker + totals below cover the whole window
    if (email) sel = sel.eq('email', email)
    const { data, error } = await sel
    if (error) {
      const missing = /relation .*user_activity.* does not exist|could not find the table/i.test(error.message)
      return NextResponse.json({ ok: false, needsMigration: missing, error: error.message, rows: [] })
    }
    const rows = (data || []) as any[]
    // THE FEED IS ONLY THE NEWEST 1,000 ROWS — on a busy week, a few hours. When it was cut off, the
    // user picker and the totals are worked out over the WHOLE window instead of from those rows
    // (2026-09-29: the picker listed only whoever was active in the last few hours, and the counts
    // topped out at 1,000, whatever window was picked).
    const capped = rows.length >= 1000
    const feedUsers = Array.from(new Set(rows.map(r => String(r.email))))
    let users = feedUsers
    if (capped && !email) {
      // Anyone on the allowlist missing from the feed: one indexed one-row probe each (email, at).
      const { data: people } = await db.from('app_users').select('email')
      const extra = Array.from(new Set(((people || []) as any[]).map(p => String(p.email || '').trim().toLowerCase())))
        .filter(e => !!e && feedUsers.indexOf(e) < 0)
      const probes = await Promise.all(extra.map(e => db.from('user_activity').select('id').eq('email', e).gte('at', since).limit(1)))
      users = feedUsers.concat(extra.filter((_, i) => (((probes[i] as any).data || []) as any[]).length > 0))
    }
    users.sort()
    // "N screens · M actions · K refused": exact counts when the feed was cut off (null if a count
    // fails), otherwise straight from the rows, which are then the whole window.
    const count = async (f: (q: any) => any): Promise<number | null> => {
      let q: any = db.from('user_activity').select('id', { count: 'exact', head: true }).gte('at', since)
      if (email) q = q.eq('email', email)
      const { count: n, error: cErr } = await f(q)
      return cErr ? null : (n ?? 0)
    }
    let totals: { pages: number; apis: number; refused: number } | null = {
      pages: rows.filter(r => r.kind === 'page').length, apis: rows.filter(r => r.kind === 'api').length,
      refused: rows.filter(r => r.allowed === false).length,
    }
    if (capped) {
      const [pages, apis, refused] = await Promise.all([count(q => q.eq('kind', 'page')), count(q => q.eq('kind', 'api')), count(q => q.eq('allowed', false))])
      totals = pages == null || apis == null || refused == null ? null : { pages, apis, refused }
    }
    return NextResponse.json({ ok: true, rows, users, days, totals, capped })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200), rows: [] }, { status: 500 })
  }
}
