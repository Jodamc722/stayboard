// Salato house-rules editor API (share-password gated, used by the Rules tab on the board).
// GET  -> current rule set (custom or default) + version.
// POST { rules: [{id?,title,body}] } -> validate + save to app_settings 'salato_rules', bump version.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { cookies } from 'next/headers'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'
import { SALATO_RULES_KEY, SALATO_RULES_VERSION, sanitizeRules, loadSalatoRules } from '@/lib/salato-rules'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const authed = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
  if (!authed) return NextResponse.json({ ok: false, needsPassword: true, error: 'Password required' }, { status: 401 })
  try {
    const db = supabaseAdmin()
    const { rules, version, custom } = await loadSalatoRules(db)
    return NextResponse.json({ ok: true, rules, version, custom })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const authed = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
  if (!authed) return NextResponse.json({ ok: false, needsPassword: true, error: 'Password required' }, { status: 401 })
  try {
    const body: any = await req.json().catch(() => ({}))
    const rules = sanitizeRules(body && body.rules)
    if (!rules.length) return NextResponse.json({ ok: false, error: 'Add at least one rule with a title.' }, { status: 400 })
    const db = supabaseAdmin()
    // Bump the version whenever the wording changes, so past signatures stay tied to their exact set.
    const prev = await loadSalatoRules(db)
    const version = (prev.version || SALATO_RULES_VERSION) + 1
    const doc = JSON.stringify({ version, rules })
    const { error } = await db.from('app_settings').upsert({ key: SALATO_RULES_KEY, value: doc, updated_at: new Date().toISOString() })
    if (error) return NextResponse.json({ ok: false, error: String(error.message || error).slice(0, 160) }, { status: 500 })
    return NextResponse.json({ ok: true, rules, version })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
