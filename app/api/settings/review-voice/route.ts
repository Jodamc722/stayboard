// Review-reply AI voice profile. Admin-only. Stored in app_settings key 'review_voice' as
// { guidelines: string, examples: [{review, reply}] }. The draft endpoint
// (app/api/reviews/draft) appends this to its system prompt so every AI draft matches the
// house voice. No auto-posting, no auto-learning — only what an admin saves here is used.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAccess } from '@/lib/access'

export const dynamic = 'force-dynamic'

const KEY = 'review_voice'
const MISSING_TABLE = 'This needs the workspaces migration — run supabase/migrations/013_user_workspaces.sql in Supabase, then try again.'

async function requireAdmin() {
  const access = await getAccess()
  if (!access.user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }), access }
  if (access.role !== 'admin') return { error: NextResponse.json({ error: 'Admins only.' }, { status: 403 }), access }
  return { error: null, access }
}

// app_settings.value is TEXT (shared with banner_overrides / guesty_owners) — JSON-stringify in, parse out.
function parseValue(v: any): any {
  if (v && typeof v === 'object') return v
  if (typeof v === 'string' && v) { try { const j = JSON.parse(v); if (j && typeof j === 'object') return j } catch { /* not json */ } }
  return null
}

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error
  try {
    const { data, error: e } = await supabaseAdmin().from('app_settings').select('value, updated_by, updated_at').eq('key', KEY).maybeSingle()
    if (e) return NextResponse.json({ voice: null, note: MISSING_TABLE })
    return NextResponse.json({ voice: parseValue(data?.value), updated_by: data?.updated_by || null, updated_at: data?.updated_at || null })
  } catch { return NextResponse.json({ voice: null, note: MISSING_TABLE }) }
}

export async function PUT(req: NextRequest) {
  const { error, access } = await requireAdmin()
  if (error) return error
  const body = await req.json().catch(() => ({} as any))
  const guidelines = typeof body?.guidelines === 'string' ? body.guidelines.slice(0, 6000) : ''
  const examples = (Array.isArray(body?.examples) ? body.examples : [])
    .filter((e: any) => e && (typeof e.review === 'string' || typeof e.reply === 'string'))
    .map((e: any) => ({ review: String(e.review || '').slice(0, 1500), reply: String(e.reply || '').slice(0, 1500) }))
    .filter((e: any) => e.reply.trim())
    .slice(0, 12)
  const value = { guidelines, examples }
  const { error: e } = await supabaseAdmin().from('app_settings').upsert(
    { key: KEY, value: JSON.stringify(value), updated_by: access.email, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (e) return NextResponse.json({ error: /app_settings/i.test(e.message || '') || /relation/i.test(e.message || '') ? MISSING_TABLE : e.message }, { status: 500 })
  return NextResponse.json({ ok: true, voice: value })
}
