// TALKROUTE ADMIN — the Users & admin → Talkroute panel.
//   GET             status: connected?, key hint, numbers, webhook subscriptions, last syncs, counts
//   POST {op}       save_key {key} · clear_key · subscribe · unsubscribe · sync {full?} · settings {voicemailMaxSec}
// Admins only. The key itself is never returned.
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { requireAdmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  getTalkrouteSettings, saveTalkrouteSettings, storeTalkrouteKey, clearTalkrouteKey, talkrouteConfigured,
  trVirtualNumbers, trSubscriptions, trSubscribe, trUnsubscribe, trAccount, formatPhone, phoneDigits,
  TR_WEBHOOK_TYPES, DEFAULT_VOICEMAIL_MAX_SEC,
} from '@/lib/talkroute'
import { syncTalkrouteAll } from '@/lib/talkroute-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
function hookUrl(token: string, type: string) { return `${APP_URL}/api/talkroute/webhook?t=${token}&type=${type}` }

async function status() {
  const s = await getTalkrouteSettings()
  const connected = await talkrouteConfigured()
  const viaEnv = !!String(process.env.TALKROUTE_API_KEY || '').trim()
  const out: any = {
    ok: true, connected, viaEnv, keyHint: s.keyHint || null, connectedBy: s.connectedBy || null, connectedAt: s.connectedAt || null,
    voicemailMaxSec: Number(s.voicemailMaxSec) || DEFAULT_VOICEMAIL_MAX_SEC,
    lastCallSyncAt: s.lastCallSyncAt || null, lastTextSyncAt: s.lastTextSyncAt || null, lastVoicemailSyncAt: s.lastVoicemailSyncAt || null,
    lastError: s.lastError || null, webhookRegistered: false, numbers: [], subscriptions: [], account: null, apiError: null, counts: null,
  }
  if (connected) {
    try {
      const [nums, subs, acct] = await Promise.all([trVirtualNumbers(), trSubscriptions(), trAccount().catch(() => null)])
      out.numbers = nums.map(n => ({ id: n.id, number: formatPhone(phoneDigits(n.phoneNumber)), label: n.description || '', messaging: !!n.messagingStatus }))
      out.subscriptions = subs.map(x => ({ id: x.id, type: x.type, ours: s.webhookToken ? String(x.hookUrl || '').indexOf(s.webhookToken) >= 0 : false }))
      out.webhookRegistered = out.subscriptions.some((x: any) => x.ours && x.type === 'new_call_record')
      const a: any = acct && (acct.data || acct)
      out.account = a ? { name: a.companyName || a.name || a.company || null } : null
    } catch (e: any) { out.apiError = String(e?.message || e).slice(0, 240) }
    try {
      const sb = supabaseAdmin()
      const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString()
      const [c, t, v, w] = await Promise.all([
        sb.from('talkroute_calls').select('id', { count: 'exact', head: true }).gte('call_at', weekAgo),
        sb.from('talkroute_texts').select('id', { count: 'exact', head: true }).gte('sent_at', weekAgo),
        sb.from('talkroute_voicemails').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
        sb.from('guest_calls').select('reservation_id', { count: 'exact', head: true }).eq('source', 'talkroute').gte('last_attempt_at', weekAgo),
      ])
      out.counts = { calls7d: c.count || 0, texts7d: t.count || 0, voicemails7d: v.count || 0, autoLogged7d: w.count || 0 }
    } catch { out.counts = null }
  }
  return out
}

export async function GET() {
  const g = await requireAdmin('admin')
  if (!g.ok) return g.res
  return NextResponse.json(await status())
}

export async function POST(req: NextRequest) {
  const g = await requireAdmin('admin')
  if (!g.ok) return g.res
  const actor = String(g.access.email || '')
  const body: any = await req.json().catch(() => ({}))
  const op = String(body?.op || '')
  try {
    if (op === 'save_key') {
      const r = await storeTalkrouteKey(String(body?.key || ''), actor)
      if (!r.ok) return NextResponse.json({ error: r.error || 'Could not save the key.' }, { status: 400 })
      // Prove it works before saying so.
      try { await trVirtualNumbers() } catch (e: any) { await clearTalkrouteKey(actor); return NextResponse.json({ error: 'Talkroute rejected that key: ' + String(e?.message || e).slice(0, 160) }, { status: 400 }) }
      return NextResponse.json(await status())
    }
    if (op === 'clear_key') { await clearTalkrouteKey(actor); return NextResponse.json(await status()) }
    if (op === 'settings') {
      const v = Math.max(5, Math.min(120, Number(body?.voicemailMaxSec) || DEFAULT_VOICEMAIL_MAX_SEC))
      await saveTalkrouteSettings({ voicemailMaxSec: v }, actor)
      return NextResponse.json(await status())
    }
    if (!(await talkrouteConfigured())) return NextResponse.json({ error: 'Talkroute is not connected.' }, { status: 400 })
    if (op === 'subscribe') {
      const s = await getTalkrouteSettings()
      const token = s.webhookToken || randomBytes(18).toString('hex')
      if (!s.webhookToken) await saveTalkrouteSettings({ webhookToken: token }, actor)
      const existing = await trSubscriptions()
      const made: string[] = []
      for (const type of TR_WEBHOOK_TYPES) {
        const url = hookUrl(token, type)
        if (existing.some(x => x.type === type && String(x.hookUrl) === url)) continue
        // Replace any older registration of ours for this type (a token rotation or domain change).
        for (const old of existing.filter(x => x.type === type && String(x.hookUrl).indexOf('/api/talkroute/webhook') >= 0)) { try { await trUnsubscribe(old.id) } catch { /* fine */ } }
        await trSubscribe(url, type); made.push(type)
      }
      return NextResponse.json({ ...(await status()), made })
    }
    if (op === 'unsubscribe') {
      const existing = await trSubscriptions()
      let n = 0
      for (const x of existing) if (String(x.hookUrl).indexOf('/api/talkroute/webhook') >= 0) { try { await trUnsubscribe(x.id); n++ } catch { /* fine */ } }
      return NextResponse.json({ ...(await status()), removed: n })
    }
    if (op === 'sync') {
      // 40s of a 60s function: the first backfill is several runs; each one resumes where the last stopped.
      const r = await syncTalkrouteAll(supabaseAdmin(), { fullTexts: !!body?.full, budgetMs: 40_000 })
      return NextResponse.json({ ...(await status()), sync: r })
    }
    return NextResponse.json({ error: 'unknown op' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 502 })
  }
}
