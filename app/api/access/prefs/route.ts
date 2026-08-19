// Self-serve nav preferences. Anyone signed in may read and write THEIR OWN pinned tabs — nothing
// else. Deliberately separate from PATCH /api/users, which is the admin console's route and can
// change roles, status and passwords.
//
// Reads app_users directly instead of trusting getAccess().prefs: getAccess() short-circuits for
// the SUPERADMIN before it ever reads app_users, so Jon's prefs would always come back empty.
// getAccess() is still what proves WHO is calling.
//
// NO MIGRATION: app_users.prefs is the JSONB column added by migration 013 (notification mutes
// live in the same object, so every write merges rather than replaces).
import { NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { FEATURES, UNGATED_PAGES } from '@/lib/features'
import { cleanPins } from '@/lib/nav'

export const dynamic = 'force-dynamic'

// A pin must be a real page. Anything else is dropped silently rather than 400'd — a stale pin
// from a tab that has since been renamed should not block someone from saving the rest.
function validPaths(): string[] {
  const out: string[] = []
  for (let i = 0; i < FEATURES.length; i++) out.push(FEATURES[i].path)
  for (let i = 0; i < UNGATED_PAGES.length; i++) out.push(UNGATED_PAGES[i])
  return out
}

async function readPrefs(email: string): Promise<Record<string, any> | null> {
  const sb = supabaseAdmin()
  const { data, error } = await sb.from('app_users').select('email, prefs').eq('email', email).maybeSingle()
  if (error || !data) return null
  const p = (data as any).prefs
  return (p && typeof p === 'object' && !Array.isArray(p)) ? p as Record<string, any> : {}
}

export async function GET() {
  const a = await getAccess()
  if (!a.user || !a.email) return NextResponse.json({ ok: false, pins: null })
  try {
    const prefs = await readPrefs(a.email)
    if (!prefs) return NextResponse.json({ ok: false, pins: null })
    const saved = Array.isArray(prefs.nav_pins) ? cleanPins(prefs.nav_pins, validPaths()) : null
    return NextResponse.json({ ok: true, pins: saved })
  } catch {
    return NextResponse.json({ ok: false, pins: null })
  }
}

export async function POST(req: Request) {
  const a = await getAccess()
  if (!a.user || !a.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  let body: any = null
  try { body = await req.json() } catch { body = null }
  if (!body || !Array.isArray(body.pins)) {
    return NextResponse.json({ error: 'pins must be an array of paths' }, { status: 400 })
  }
  const pins = cleanPins(body.pins, validPaths())
  try {
    const prefs = await readPrefs(a.email)
    // No row for this email (bootstrap / allowlist gap): the client keeps its device copy, so say
    // so honestly instead of erroring — the band still works, it just will not follow them.
    if (!prefs) return NextResponse.json({ ok: true, pins, saved: false })
    const next: Record<string, any> = {}
    const keys = Object.keys(prefs)
    for (let i = 0; i < keys.length; i++) next[keys[i]] = prefs[keys[i]]
    next.nav_pins = pins
    const sb = supabaseAdmin()
    const { error } = await sb.from('app_users').update({ prefs: next }).eq('email', a.email)
    if (error) return NextResponse.json({ ok: true, pins, saved: false })
    return NextResponse.json({ ok: true, pins, saved: true })
  } catch {
    return NextResponse.json({ ok: true, pins, saved: false })
  }
}
