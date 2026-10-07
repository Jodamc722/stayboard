// AUTO-TRANSLATE SPANISH TASK TITLES → ENGLISH, pushed back to Breezeway (Jon 2026-08-07).
// The field team writes titles in Spanish or half-and-half ("Trash & Common Area Checklist /
// Lista de..."); the owner statement and the board should read in English. POST { month }
// scans the month's mirror for Spanish-looking titles, translates them in AI batches, PATCHes
// each Breezeway task (their PATCH requires the name — that IS the change here) and updates the
// mirror. Resumable: 250s budget, returns remaining; call again to continue.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { updateBreezewayTask, breezewayConfigured } from '@/lib/breezeway'
import { monthTasks, rangeTasks } from '@/lib/billing'
import { getSetting, setSetting } from '@/lib/app-settings'
import { refreshFromBreezeway } from '@/lib/breezeway-refresh'
import { modelPairFor } from '@/lib/ai-models'
import { anthropicMessages, textOf } from '@/lib/anthropic-call'
import { bustBoards } from '@/lib/bust'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SPANISHY = /[áéíóúñü¿¡]|\b(limpieza|limpiar|lista|baño|bano|cocina|basura|revisar|revision|reparar|arreglo|arreglar|cambiar|fuga|puerta|ventana|luz|agua|caliente|colchon|colchón|sabanas|sábanas|toallas|cerradura|pintura|urgente|huesped|huésped|dañado|danado|pendiente|falta|faltan|no funciona|piso|pared|techo|llaves|nevera|estufa|espejo|silla|mesa|cortina|salida)\b/i

// 2026-09-30: descriptions too (Jon: "auto-translate all the Spanish ones to English"), over any
// window, and a standing switch (app_settings billing_prefs.autoTranslate) the desk honours on load.
const SYS = `You translate property-maintenance task titles and descriptions from Spanish (or mixed Spanish/English) into clean English.
Rules: keep unit numbers, names, amounts and technical details exactly; produce a natural, professional result; anything ALREADY fully English is returned unchanged, character for character. Never add, drop or invent information.
Input is a JSON array of {"id","title","description"}. Answer with ONLY a JSON array of {"id","title","description"} in English.`
const PREFS = 'billing_prefs'
// WHAT HAS ALREADY BEEN THROUGH THE TRANSLATOR (2026-10-07). The Auto switch runs this on every
// load of the Billing review, and a task that only LOOKS Spanish — a name with an accent, "Mesa",
// a title that was already translated but still carries one Spanish word — came back unchanged and
// so matched again on the next load: 188 calls, $15 in one morning, translating the same tasks over
// and over. Each task's text is fingerprinted once it has been through; it is sent again only when
// its title or description actually changes.
const SEEN = 'billing_translate_seen'
const fp = (t: string, d: string) => { let h = 5381; const s = t + '\u0001' + d; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function GET() {
  const gate = await requireLevel('billing', 'view')
  if (!gate.ok) return gate.res
  const p = await getSetting<any>(PREFS, null).catch(() => null)
  return NextResponse.json({ ok: true, autoTranslate: !!p?.autoTranslate })
}

export async function PUT(req: NextRequest) {
  const gate = await requireLevel('billing', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({} as any))
  const cur = await getSetting<any>(PREFS, null).catch(() => null) || {}
  await setSetting(PREFS, { ...cur, autoTranslate: !!b?.autoTranslate }, gate.access.email || 'billing')
  return NextResponse.json({ ok: true, autoTranslate: !!b?.autoTranslate })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('billing', 'edit')
  if (!gate.ok) return gate.res
  if (!breezewayConfigured()) return NextResponse.json({ ok: false, error: 'Breezeway is not configured.' }, { status: 400 })
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: false, error: 'AI is not configured (ANTHROPIC_API_KEY missing).' }, { status: 400 })
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const month = String(body?.month || '').slice(0, 7)
  const isYmd = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
  let tasks: any[]
  if (isYmd(body?.from) && isYmd(body?.to)) tasks = await rangeTasks(body.from, body.to)
  else if (/^\d{4}-\d{2}$/.test(month)) tasks = await monthTasks(month)
  else return NextResponse.json({ ok: false, error: 'month or from/to required' }, { status: 400 })
  const only: string[] | null = Array.isArray(body?.ids) ? body.ids.map(String) : null

  const seen: Record<string, string> = { ...(await getSetting<Record<string, string>>(SEEN, {}).catch(() => ({}))) }
  const force = body?.force === true
  const candidates = tasks
    .map(t => ({ id: String(t.id), title: String(t.name || ''), description: String(t.descr || '') }))
    .filter(t => !t.id.startsWith('lh-') && (!only || only.includes(t.id)) && t.title && (SPANISHY.test(t.title) || SPANISHY.test(t.description)))
    .filter(t => force || seen[t.id] !== fp(t.title, t.description))
  if (!candidates.length) return NextResponse.json({ ok: true, scanned: tasks.length, candidates: 0, translated: 0, remaining: 0 })

  const started = Date.now()
  let translated = 0
  let failed = 0
  let processed = 0
  const changed: { id: string; name: string; description: string }[] = []
  for (let i = 0; i < candidates.length; i += 20) {
    if (Date.now() - started > 240_000) break
    const batch = candidates.slice(i, i + 20).map(c => ({ ...c, description: c.description.slice(0, 1200) }))
    let out: { id: string; title: string; description?: string }[] = []
    try {
      const { model, fallback } = await modelPairFor('billing')
      const r = await anthropicMessages(key, { model, max_tokens: 6000, system: SYS, messages: [{ role: 'user', content: JSON.stringify(batch) }] }, fallback, 'billing')
      const text = textOf(r.data)
      const m = text.match(/\[[\s\S]*\]/)
      if (r.ok && m) out = JSON.parse(m[0])
    } catch { /* batch failed — skip, counted below */ }
    const byId: Record<string, { title: string; description: string | null }> = {}
    for (const o of Array.isArray(out) ? out : []) if (o && o.id && typeof o.title === 'string') byId[String(o.id)] = { title: o.title.trim().slice(0, 200), description: typeof o.description === 'string' ? o.description.trim().slice(0, 4000) : null }
    for (const c of candidates.slice(i, i + 20)) {
      processed++
      const nt = byId[c.id]
      if (!nt) continue
      // Through the translator: remember the text it LEFT with (or came in with, if unchanged).
      seen[c.id] = fp(nt.title || c.title, nt.description != null && c.description.length <= 1200 ? nt.description : c.description)
      const newName = nt.title || c.title
      // A description longer than what we sent keeps its tail: only replace it when we sent it whole.
      const newDesc = nt.description != null && c.description.length <= 1200 ? nt.description : c.description
      if (newName === c.title && newDesc === c.description) continue   // already English
      try {
        const patch: Record<string, any> = { name: newName }
        if (newDesc !== c.description) patch.description = newDesc
        const pr = await updateBreezewayTask(c.id, patch)
        if (pr.ok) {
          translated++
          changed.push({ id: c.id, name: newName, description: newDesc })
          try { await db.from('breezeway_tasks_sync').update({ name: newName }).eq('id', c.id) } catch { /* mirror catches up */ }
          if (patch.description != null) { try { await refreshFromBreezeway(db, c.id) } catch { /* next sync */ } }
        } else failed++
      } catch { failed++ }
      await sleep(100)
    }
  }
  // Keep the memory small: the most recent few thousand tasks is every month anyone reviews.
  { const ks = Object.keys(seen); if (ks.length > 6000) for (const k of ks.slice(0, ks.length - 6000)) delete seen[k] }
  await setSetting(SEEN, seen, gate.access.email || 'billing').catch(() => {})
  // Renamed tasks show on the Scheduler and the day through cached reads of the mirror.
  if (translated > 0) bustBoards()
  return NextResponse.json({ ok: true, scanned: tasks.length, candidates: candidates.length, translated, failed, remaining: candidates.length - processed, changed })
}
