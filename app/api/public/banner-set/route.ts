// Save the chosen banner photo for a share surface (report or a vendor board scope).
// Persisted globally in app_settings (key 'banner_overrides') so the pick sticks for everyone
// on the link, across devices. Share-password gated, same as the board notes endpoint.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { cookies } from 'next/headers'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'

export const dynamic = 'force-dynamic'
const KEY = 'banner_overrides'

export async function POST(req: NextRequest) {
  const authed = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
  if (!authed) return NextResponse.json({ ok: false, error: 'Password required' }, { status: 401 })
  try {
    const body: any = await req.json().catch(() => ({}))
    const surface = typeof body?.surface === 'string' ? body.surface.trim().slice(0, 60) : ''
    const url = typeof body?.url === 'string' ? body.url.trim() : ''
    // surface must look like "report:<id>" or "board:<id>"
    if (!/^(report|board):[a-z0-9-]+$/i.test(surface)) return NextResponse.json({ ok: false, error: 'bad surface' }, { status: 400 })
    if (url && (url.indexOf('https://') !== 0 || url.length > 500)) return NextResponse.json({ ok: false, error: 'bad url' }, { status: 400 })
    const db = supabaseAdmin()
    const { data } = await db.from('app_settings').select('value').eq('key', KEY).limit(1)
    let obj: Record<string, string> = {}
    const row: any = Array.isArray(data) ? data[0] : null
    if (row && row.value) { try { const j = JSON.parse(row.value); if (j && typeof j === 'object') obj = j } catch {} }
    if (url) obj[surface] = url; else delete obj[surface]
    const { error } = await db.from('app_settings').upsert({ key: KEY, value: JSON.stringify(obj), updated_at: new Date().toISOString() })
    if (error) return NextResponse.json({ ok: false, error: String(error.message || error).slice(0, 120) }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 120) }, { status: 500 })
  }
}
