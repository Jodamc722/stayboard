// INSTANT MESSAGES + ALERTS, THE SWITCHES (lib/guesty-webhooks).
//   GET                                   → { connected, lastEventAt, events, signed, alerts (mine), canConnect }
//   POST { action: 'alerts', on }         → my own "Alert me on every new guest message" (any Messages viewer)
//   POST { action: 'connect' | 'disconnect' } → subscribe / unsubscribe Guesty's message webhook (full on Messages)
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { readWebhookSettings, connectWebhook, disconnectWebhook } from '@/lib/guesty-webhooks'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function myPrefs(email: string): Promise<Record<string, any>> {
  const { data } = await supabaseAdmin().from('app_users').select('prefs').eq('email', email).maybeSingle()
  const p = (data as any)?.prefs
  return p && typeof p === 'object' && !Array.isArray(p) ? p : {}
}

export async function GET() {
  const g = await requireLevel('messages', 'view'); if (!g.ok) return g.res
  const s = await readWebhookSettings()
  const email = String(g.access.email || '').toLowerCase()
  const prefs = email ? await myPrefs(email).catch(() => ({} as Record<string, any>)) : {}
  return NextResponse.json({
    ok: true, connected: !!(s.url && s.subscriptionId), connectedAt: s.connectedAt || null, lastEventAt: s.lastEventAt || null,
    events: s.events || 0, signed: !!s.secret, alerts: prefs.guest_alerts === true, canConnect: atLeast(g.access.levels['messages'], 'full'),
  })
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any))
  const action = String(b?.action || '')
  if (action === 'alerts') {
    const g = await requireLevel('messages', 'view'); if (!g.ok) return g.res
    const email = String(g.access.email || '').toLowerCase()
    if (!email) return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 })
    const prefs = await myPrefs(email)
    const { error } = await supabaseAdmin().from('app_users').update({ prefs: { ...prefs, guest_alerts: !!b?.on } }).eq('email', email)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, alerts: !!b?.on })
  }
  if (action === 'connect' || action === 'disconnect') {
    const g = await requireLevel('messages', 'full'); if (!g.ok) return g.res
    const by = String(g.access.email || '')
    try {
      if (action === 'disconnect') { await disconnectWebhook(by); return NextResponse.json({ ok: true, connected: false }) }
      const origin = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin
      const r = await connectWebhook(origin, by)
      return NextResponse.json({ ok: true, connected: true, reused: r.reused, signed: !!r.secret })
    } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 502 }) }
  }
  return NextResponse.json({ ok: false, error: 'action must be alerts | connect | disconnect' }, { status: 400 })
}
