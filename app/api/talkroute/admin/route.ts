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
import { processCallIntel } from '@/lib/call-notes'
import { talkroutePeople, getPeopleMap, setPeopleMap } from '@/lib/talkroute-people'
import {
  getTranscribeSettings, saveTranscribeSettings, storeTranscribeKey, clearTranscribeKey,
  transcribeReady, transcribeFrom, todayET, TRANSCRIBE_DEFAULTS, USD_PER_MINUTE,
} from '@/lib/transcribe'

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
    transcribe: null as any,
    people: null as any,
  }
  // WHO MADE THE CALL. The Talkroute directory, the device strings actually seen on recent calls,
  // and the map between them — so a device that resolves to nobody can be named once and stay named.
  try {
    const db = supabaseAdmin()
    const [dir, map, seen] = await Promise.all([
      talkroutePeople().catch(() => []),
      getPeopleMap(),
      db.from('talkroute_calls').select('caller_device,caller_name').not('caller_device', 'is', null)
        .gte('call_at', new Date(Date.now() - 30 * 86400_000).toISOString()).limit(1000),
    ])
    const counts = new Map<string, { device: string; name: string; calls: number }>()
    for (const r of ((seen.data as any[]) || [])) {
      const d = String(r.caller_device || '').trim(); if (!d) continue
      const k = d.toLowerCase()
      const cur = counts.get(k) || { device: d, name: String(r.caller_name || ''), calls: 0 }
      cur.calls++; if (!cur.name && r.caller_name) cur.name = String(r.caller_name)
      counts.set(k, cur)
    }
    out.people = {
      directory: dir, map,
      devices: Array.from(counts.values()).sort((a, b) => b.calls - a.calls).slice(0, 30),
    }
  } catch { out.people = null }
  // ── TRANSCRIPTION (2026-09-21) ──────────────────────────────────────────────────────────────
  // Stay records every call and plays the notice, so recordings are readable. This reports whether
  // a key exists, what the rules are, and how the queue is doing — never the key itself.
  try {
    const t = await getTranscribeSettings()
    const ready = await transcribeReady()
    let queue: any = null
    try {
      const db = supabaseAdmin()
      const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString()
      const [pend, done, failed, notes, spendRows] = await Promise.all([
        db.from('talkroute_calls').select('id', { count: 'exact', head: true }).not('reservation_id', 'is', null).eq('result', 'answered')
          .gte('call_at', new Date((await transcribeFrom()) + 'T00:00:00-05:00').toISOString())
          .or('transcript_status.is.null,transcript_status.eq.pending'),
        db.from('talkroute_calls').select('id', { count: 'exact', head: true }).eq('transcript_status', 'done'),
        db.from('talkroute_calls').select('id', { count: 'exact', head: true }).in('transcript_status', ['failed', 'expired']),
        db.from('talkroute_calls').select('id', { count: 'exact', head: true }).not('note_pushed_at', 'is', null),
        db.from('talkroute_calls').select('cost_usd').gte('transcript_at', dayAgo).limit(2000),
      ])
      let usd = 0
      for (const r of ((spendRows.data as any[]) || [])) usd += Number(r.cost_usd) || 0
      queue = { pending: pend.count || 0, transcribed: done.count || 0, failed: failed.count || 0, notesPushed: notes.count || 0, usdToday: Math.round(usd * 100) / 100 }
    } catch { queue = null }
    out.transcribe = {
      ready, keyHint: t.keyHint || null, viaEnv: !!String(process.env.DEEPGRAM_API_KEY || '').trim(),
      enabled: t.enabled !== false, connectedBy: t.connectedBy || null, connectedAt: t.connectedAt || null,
      minSeconds: Number(t.minSeconds) || TRANSCRIBE_DEFAULTS.minSeconds,
      usdPerDay: Number(t.usdPerDay ?? TRANSCRIBE_DEFAULTS.usdPerDay),
      fromDate: await transcribeFrom(), today: todayET(),
      usdPerMinute: USD_PER_MINUTE, lastError: t.lastError || null, queue,
    }
  } catch { out.transcribe = null }
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
    // ── Transcription controls ──
    if (op === 'save_transcribe_key') {
      const r = await storeTranscribeKey(String(body?.key || ''), actor)
      if (!r.ok) return NextResponse.json({ error: r.error || 'Could not save the key.' }, { status: 400 })
      return NextResponse.json(await status())
    }
    if (op === 'people_map') {
      const m = (body?.map && typeof body.map === 'object') ? body.map : {}
      const r = await setPeopleMap(m, actor)
      if (!r.ok) return NextResponse.json({ error: r.error || 'Could not save.' }, { status: 400 })
      return NextResponse.json(await status())
    }
    if (op === 'clear_transcribe_key') { await clearTranscribeKey(actor); return NextResponse.json(await status()) }
    if (op === 'transcribe_settings') {
      const from = String(body?.fromDate || '')
      await saveTranscribeSettings({
        enabled: body?.enabled !== false,
        minSeconds: Math.max(5, Math.min(300, Number(body?.minSeconds) || TRANSCRIBE_DEFAULTS.minSeconds)),
        usdPerDay: Math.max(0, Math.min(500, Number(body?.usdPerDay ?? TRANSCRIBE_DEFAULTS.usdPerDay))),
        ...(/^\d{4}-\d{2}-\d{2}$/.test(from) ? { fromDate: from } : {}),
      }, actor)
      return NextResponse.json(await status())
    }
    if (op === 'run_notes') {
      const r = await processCallIntel(supabaseAdmin(), { deadline: Date.now() + 40_000, limit: 25 })
      return NextResponse.json({ ...(await status()), notes: r })
    }
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
