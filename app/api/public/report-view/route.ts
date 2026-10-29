// PUBLIC beacon for shared decks and owner reports (Jon, 2026-10-29: "track views or opens, click
// rate, how or where people are spending their time … with the owner sharable link, not users that
// are logged in"). The page sends the running totals of one viewing session; this overwrites that
// session's row. No auth (the share code is the key); nothing here is ever read back publicly.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const s = (v: any, n: number) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n)
const int = (v: any, max: number) => { const n = Math.round(Number(v) || 0); return Math.max(0, Math.min(max, n)) }

function device(ua: string): string {
  if (/ipad|tablet/i.test(ua)) return 'Tablet'
  if (/mobi|iphone|android/i.test(ua)) return 'Phone'
  return 'Desktop'
}
function cleanSlides(v: any): Record<string, { ms: number; views: number; ix: number }> {
  const out: Record<string, { ms: number; views: number; ix: number }> = {}
  if (!v || typeof v !== 'object') return out
  for (const k of Object.keys(v).slice(0, 80)) {
    const x = v[k] || {}
    out[s(k, 80)] = { ms: int(x.ms, 6 * 3600e3), views: int(x.views, 500), ix: int(x.ix, 200) }
  }
  return out
}
function cleanClicks(v: any): { s: string; l: string; t: number }[] {
  if (!Array.isArray(v)) return []
  return v.slice(0, 200).map((c: any) => ({ s: s(c?.s, 80), l: s(c?.l, 80), t: int(c?.t, 6 * 3600e3) }))
}

export async function POST(req: NextRequest) {
  let body: any = null
  try { body = JSON.parse(await req.text()) } catch { return NextResponse.json({ ok: false }, { status: 400 }) }
  const code = s(body?.code, 40)
  const session = s(body?.session, 64)
  if (!/^[0-9a-f]{12,32}$/i.test(code) || !/^[A-Za-z0-9_-]{8,64}$/.test(session)) return NextResponse.json({ ok: false }, { status: 400 })
  const db = supabaseAdmin()
  const { data: rep } = await db.from('owner_reports').select('id').eq('code', code).limit(1)
  const reportId = (rep || [])[0]?.id
  if (!reportId) return NextResponse.json({ ok: false }, { status: 404 })
  const ua = s(req.headers.get('user-agent'), 240)
  if (/bot|crawler|spider|preview|slackbot|facebookexternalhit|whatsapp|headless/i.test(ua)) return NextResponse.json({ ok: true, skipped: 'bot' })
  const dec = (h: string | null) => { try { return h ? decodeURIComponent(h) : '' } catch { return h || '' } }
  const row = {
    report_id: reportId, code, session_id: session,
    visitor_id: s(body?.visitor, 64) || null,
    started_at: (() => { const d = new Date(String(body?.started || '')); return isNaN(+d) ? new Date().toISOString() : d.toISOString() })(),
    last_seen: new Date().toISOString(),
    device: device(ua), ua,
    referrer: s(body?.referrer, 200) || null,
    country: s(req.headers.get('x-vercel-ip-country'), 8) || null,
    region: s(dec(req.headers.get('x-vercel-ip-country-region')), 40) || null,
    city: s(dec(req.headers.get('x-vercel-ip-city')), 60) || null,
    total_ms: int(body?.total, 6 * 3600e3),
    max_slide: int(body?.maxSlide, 200),
    slide_count: int(body?.slideCount, 200),
    presented: !!body?.presented,
    slides: cleanSlides(body?.slides),
    clicks: cleanClicks(body?.clicks),
  }
  const { error } = await db.from('report_views').upsert(row, { onConflict: 'session_id' })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
