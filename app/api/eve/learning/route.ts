// LEARNING — "Need her to learn everything about Stay Hospitality" (Jon, 2026-09-18).
//
// GET returns the sources table: every feed she learns from, whether it is alive, when it last
// taught her anything and how much of it there is — plus Google read consent state and her memory
// counts by source and weight. POST { op: 'study' } runs the existing learning pass (sweep, study
// pending documents, generate questions) and returns the receipt; POST { op: 'teach', text, … }
// files free text as a memory at weight 8, source 'jon' — the fastest way to load a house rule.
// (From anyone but Jon it files as source 'staff' at weight 6 — Jon, 2026-09-23 review.)
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { lastRuns } from '@/lib/automation-runs'
import { eveGate } from '../../agent/route'
import { saveMemory, personSource, STAFF_MAX_WEIGHT } from '@/lib/eve/memory'
import { runSweep } from '@/lib/eve/sweep'
import { studyPending } from '@/lib/eve/study'
import { generateQuestions } from '@/lib/eve/questions'
import { WATCH_KEY } from '@/lib/eve/slack-watch'
import { getGoogleReadGrant } from '@/lib/google-read'
import { getSetting } from '@/lib/app-settings'
import { probeForMemory, runLearningAudit, learningSnapshot, setProbeActive, pruneMemory } from '@/lib/eve/learning-audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

type SourceStatus = 'ok' | 'stale' | 'missing' | 'consent'
type Source = { key: string; label: string; status: SourceStatus; lastLearned: string | null; count: number | null; note: string }

async function safe<T>(fn: () => Promise<T>, fb: T): Promise<T> { try { return await fn() } catch { return fb } }
const hoursAgo = (iso: string | null | undefined) => iso ? (Date.now() - Date.parse(iso)) / 3600_000 : Infinity
const fresh = (iso: string | null | undefined, hours: number): SourceStatus => !iso ? 'missing' : hoursAgo(iso) <= hours ? 'ok' : 'stale'

async function count(table: string, mod?: (q: any) => any): Promise<number | null> {
  try {
    let q: any = supabaseAdmin().from(table).select('*', { count: 'exact', head: true })
    if (mod) q = mod(q)
    const { count: n, error } = await q
    return error ? null : (n || 0)
  } catch { return null }
}
async function latest(table: string, col: string, mod?: (q: any) => any): Promise<string | null> {
  try {
    let q: any = supabaseAdmin().from(table).select(col).order(col, { ascending: false }).limit(1)
    if (mod) q = mod(q)
    const { data } = await q
    const v = Array.isArray(data) && data[0] ? (data[0] as any)[col] : null
    return v ? String(v) : null
  } catch { return null }
}

export async function GET() {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()

  const [syncRows, runs, watch, google] = await Promise.all([
    safe(async () => { const { data } = await db.from('guesty_sync_status').select('entity,last_sync_at,last_error').limit(50); return (data as any[]) || [] }, [] as any[]),
    lastRuns(['slack-watch', 'eve-learn', 'labor-trueup', 'breezeway-tasks', 'owner-statements', 'eve-review']),
    getSetting<any>(WATCH_KEY, null),
    getGoogleReadGrant(),
  ])
  const sync = (entity: string) => syncRows.find(r => String(r.entity) === entity) || null

  const sources: Source[] = []

  // Guesty — four feeds, each with its own sync row.
  const guesty: Array<[string, string, string, number]> = [
    ['listings', 'Guesty listings', 'guesty_listings', 30], ['reservations', 'Guesty reservations', 'guesty_reservations', 6],
    ['messages', 'Guesty messages', 'guesty_messages', 6], ['reviews', 'Guesty reviews', 'guesty_reviews', 30],
  ]
  for (const [entity, label, table, hours] of guesty) {
    const s = sync(entity)
    const n = await count(table)
    sources.push({ key: 'guesty:' + entity, label, status: s?.last_error ? 'stale' : fresh(s?.last_sync_at, hours), lastLearned: s?.last_sync_at || null, count: n, note: s?.last_error ? String(s.last_error).slice(0, 120) : s ? 'synced by cron' : 'no sync row yet' })
  }

  // Breezeway mirror.
  const bzAt = await latest('breezeway_tasks_sync', 'synced_at')
  sources.push({ key: 'breezeway', label: 'Breezeway tasks', status: fresh(bzAt, 6), lastLearned: bzAt, count: await count('breezeway_tasks_sync'), note: runs['breezeway-tasks']?.error ? String(runs['breezeway-tasks'].error).slice(0, 120) : 'task mirror' })

  // Homebase is read live; the receipt is the labor job that reads it.
  const hbConfigured = !!(process.env.HOMEBASE_API_KEY || process.env['Homebase_Secret_id'])
  const hb = runs['labor-trueup']
  sources.push({ key: 'homebase', label: 'Homebase (labor)', status: !hbConfigured ? 'missing' : fresh(hb?.at, 30), lastLearned: hb?.at || null, count: hb?.itemCount ?? null, note: hbConfigured ? (hb?.error ? String(hb.error).slice(0, 120) : 'read live; last labor run shown') : 'HOMEBASE_API_KEY not set' })

  // Slack — how many rooms she can read, and when she last kept tabs.
  let slackRooms: number | null = null
  try { const { getDirectory } = await import('@/lib/slack'); const dir: any = await getDirectory(); slackRooms = (dir?.channels || []).filter((c: any) => c?.isMember).length } catch { slackRooms = null }
  const watchAt = watch?.lastRun ? String(watch.lastRun) : (runs['slack-watch']?.at || null)
  sources.push({ key: 'slack', label: 'Slack', status: slackRooms == null ? 'missing' : fresh(watchAt, 14), lastLearned: watchAt, count: slackRooms, note: slackRooms == null ? 'bot not connected' : `${slackRooms} channel${slackRooms === 1 ? '' : 's'} the bot is in · items tracked: ${await count('eve_slack_items') ?? 0}` })

  // Telegram — approved contacts and the last exchange.
  const tgAt = await latest('telegram_messages', 'created_at')
  const tgContacts = await count('telegram_contacts', q => q.eq('status', 'approved'))
  sources.push({ key: 'telegram', label: 'Telegram', status: !process.env.TELEGRAM_BOT_TOKEN ? 'missing' : tgContacts ? fresh(tgAt, 24 * 7) : 'stale', lastLearned: tgAt, count: tgContacts, note: process.env.TELEGRAM_BOT_TOKEN ? `${tgContacts ?? 0} approved contact${tgContacts === 1 ? '' : 's'}` : 'TELEGRAM_BOT_TOKEN not set' })

  // Documents — the library and the last study receipt.
  const docs = await count('eve_docs', q => q.eq('active', true))
  const studiedAt = await latest('eve_knowledge', 'updated_at', q => q.like('id', 'doc_study_%'))
  sources.push({ key: 'docs', label: 'Documents (Library)', status: !docs ? 'missing' : fresh(studiedAt, 24 * 14), lastLearned: studiedAt, count: docs, note: docs ? `${docs} active document${docs === 1 ? '' : 's'}; study receipts in eve_knowledge` : 'nothing uploaded yet — Settings → Eve → Library' })

  // The OTA playbook — channel money rules, taught cell by cell (lib/ota-playbook-server.ts).
  const otaSync = await getSetting<any>('ota_playbook_sync', null)
  const otaMap = await getSetting<Record<string, any>>('ota_playbook_memory', {})
  const otaCells = Object.keys(otaMap || {}).length
  sources.push({ key: 'ota', label: 'OTA playbook', status: !otaCells ? 'missing' : fresh(otaSync?.at, 24 * 3), lastLearned: otaSync?.at || null, count: otaCells, note: otaCells ? `${otaCells} channel rules as memories${otaSync?.gaps ? `; ${otaSync.gaps} gaps she has asked you about` : ''} — Settings → Eve → OTA playbook` : 'not taught yet — open Settings → Eve → OTA playbook and press Teach her now' })

  // Owner statements.
  const osAt = await latest('guesty_owner_statements', 'synced_at')
  sources.push({ key: 'owner-statements', label: 'Owner statements', status: fresh(osAt, 24 * 45), lastLearned: osAt, count: await count('guesty_owner_statements'), note: runs['owner-statements']?.error ? String(runs['owner-statements'].error).slice(0, 120) : 'monthly' })

  // App usage — what the team actually opens.
  const since14 = new Date(Date.now() - 14 * 86400_000).toISOString()
  const usageAt = await latest('user_activity', 'at')
  sources.push({ key: 'app-usage', label: 'App usage', status: fresh(usageAt, 48), lastLearned: usageAt, count: await count('user_activity', q => q.gte('at', since14)), note: 'page and API activity, last 14 days' })

  // Google read — consent state only; the corpus is the next step.
  const granted = google.granted
  sources.push({ key: 'google', label: 'Google (Gmail · Drive · Calendar, read)', status: granted ? 'ok' : 'consent', lastLearned: granted ? google.at : null, count: null, note: granted ? `read access granted by ${google.email || 'owner'} — ingest not built yet` : 'needs your consent — Connect below' })

  // Her own learning pass, for the header.
  const learn = runs['eve-learn'] || null
  const review = runs['eve-review'] || null

  // Memory by source and by weight.
  const memBySource: Record<string, number> = {}
  const memByWeight: Record<string, number> = {}
  let memTotal = 0
  try {
    const { data } = await db.from('eve_memory').select('source,weight').is('superseded_by', null).limit(5000)
    for (const r of ((data as any[]) || [])) {
      memTotal++
      const src = String(r.source || 'eve'); memBySource[src] = (memBySource[src] || 0) + 1
      const w = String(Number(r.weight) || 0); memByWeight[w] = (memByWeight[w] || 0) + 1
    }
  } catch { /* migration 045 */ }

  // "Is she learning?" — the audit's latest run, the failed probes, the dead memories, the shapes
  // she keeps proposing after Jon said no, and the probe list (lib/eve/learning-audit.ts).
  const audit = await safe(() => learningSnapshot(), null as any)

  return NextResponse.json({ ok: true, sources, google, lastStudy: learn, lastReview: review, memory: { total: memTotal, bySource: memBySource, byWeight: memByWeight }, audit })
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const by = String(gate.access.email || '')

  if (body?.op === 'teach') {
    const text = String(body?.text || '').trim()
    if (text.length < 8) return NextResponse.json({ error: 'Say a little more — a rule she can follow.' }, { status: 400 })
    // Weight 8 and source 'jon' only when Jon is the one teaching; anyone else is 'staff' at the
    // staff ceiling of 6 (Jon, 2026-09-23 review).
    const who = personSource(by, 8)
    const res = await saveMemory({ text: text.slice(0, 1000), kind: body?.kind || 'rule', why: `Taught by ${by} in Settings → Eve → Learning on ${new Date().toISOString().slice(0, 10)}`, scope: body?.scope || 'portfolio', weight: who.weight, maxWeight: who.source === 'staff' ? STAFF_MAX_WEIGHT : undefined, source: who.source, confidence: 1, created_by: by })
    if (!res.ok) return NextResponse.json({ error: res.error || 'could not save' }, { status: 500 })
    // Taught → tested. A probe is written for it now (one Haiku call) and asked tomorrow, with no
    // tools, so "she was told" becomes "she still knows". A reinforced duplicate re-arms its probe.
    let probe: any = null
    if (res.id) { try { probe = await probeForMemory(res.id, 'taught') } catch { probe = null } }
    return NextResponse.json({ ok: true, id: res.id, deduped: !!res.deduped, probe: probe?.ok ? { id: probe.id, question: probe.question } : null })
  }

  if (body?.op === 'selftest') {
    const run = await runLearningAudit({ kind: 'manual', limit: Math.min(15, Math.max(1, Number(body?.limit) || 15)), by })
    return NextResponse.json(run.ok ? { ok: true, run: run.run } : { error: run.error || 'the self-test did not run' }, { status: run.ok ? 200 : 500 })
  }
  if (body?.op === 'probe_active') {
    const r = await setProbeActive(String(body?.id || ''), body?.active !== false, by)
    return NextResponse.json(r.ok ? { ok: true } : { error: r.error }, { status: r.ok ? 200 : 400 })
  }
  if (body?.op === 'prune') {
    const r = await pruneMemory(String(body?.memoryId || ''), by)
    return NextResponse.json(r.ok ? { ok: true } : { error: r.error }, { status: r.ok ? 200 : r.forbidden ? 403 : 400 })
  }

  // 'study' — the same pass /api/eve/learn runs nightly, minus the model-heavy FAQ and vision
  // phases, so it comes back inside a request: sweep → pending documents → questions.
  const t0 = Date.now()
  const receipt: any = { by, startedAt: new Date(t0).toISOString() }
  try { receipt.sweep = await runSweep(30) } catch (e: any) { receipt.sweep = { ok: false, error: String(e?.message || e).slice(0, 200) } }
  try { receipt.studied = await studyPending(3) } catch (e: any) { receipt.studied = { studied: 0, error: String(e?.message || e).slice(0, 200) } }
  try { receipt.questions = await generateQuestions() } catch (e: any) { receipt.questions = { error: String(e?.message || e).slice(0, 200) } }
  receipt.ms = Date.now() - t0
  return NextResponse.json({ ok: true, receipt })
}
