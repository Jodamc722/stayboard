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
import { monthTasks } from '@/lib/billing'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SPANISHY = /[áéíóúñü¿¡]|\b(limpieza|limpiar|lista|baño|bano|cocina|basura|revisar|revision|reparar|arreglo|arreglar|cambiar|fuga|puerta|ventana|luz|agua|caliente|colchon|colchón|sabanas|sábanas|toallas|cerradura|pintura|urgente|huesped|huésped|dañado|danado|pendiente|falta|faltan|no funciona|piso|pared|techo|llaves|nevera|estufa|espejo|silla|mesa|cortina|salida)\b/i

const SYS = `You translate property-maintenance task titles from Spanish (or mixed Spanish/English) into clean English.
Rules: keep unit numbers, names and technical details exactly; produce a natural, professional task title; if a title is ALREADY fully English, return it unchanged, character for character. Never invent information.
Input is a JSON array of {"id","title"}. Answer with ONLY a JSON array of {"id","title"} with the English titles.`

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function POST(req: NextRequest) {
  const gate = await requireLevel('billing', 'edit')
  if (!gate.ok) return gate.res
  if (!breezewayConfigured()) return NextResponse.json({ ok: false, error: 'Breezeway is not configured.' }, { status: 400 })
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: false, error: 'AI is not configured (ANTHROPIC_API_KEY missing).' }, { status: 400 })
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const month = String(body?.month || '').slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ ok: false, error: 'month required' }, { status: 400 })

  const tasks = await monthTasks(month)
  const candidates = tasks
    .map(t => ({ id: String(t.id), title: String(t.name || '') }))
    .filter(t => t.title && SPANISHY.test(t.title))
  if (!candidates.length) return NextResponse.json({ ok: true, scanned: tasks.length, candidates: 0, translated: 0, remaining: 0 })

  const started = Date.now()
  let translated = 0
  let failed = 0
  let processed = 0
  for (let i = 0; i < candidates.length; i += 25) {
    if (Date.now() - started > 240_000) break
    const batch = candidates.slice(i, i + 25)
    let out: { id: string; title: string }[] = []
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 3000, system: SYS, messages: [{ role: 'user', content: JSON.stringify(batch) }] }),
      })
      const j: any = await r.json().catch(() => null)
      const text = j && Array.isArray(j.content) && j.content[0] && j.content[0].text ? String(j.content[0].text) : ''
      const m = text.match(/\[[\s\S]*\]/)
      if (r.ok && m) out = JSON.parse(m[0])
    } catch { /* batch failed — skip, counted below */ }
    const byId: Record<string, string> = {}
    for (const o of Array.isArray(out) ? out : []) if (o && o.id && typeof o.title === 'string') byId[String(o.id)] = o.title.trim().slice(0, 200)
    for (const c of batch) {
      processed++
      const nt = byId[c.id]
      if (!nt || nt === c.title) continue   // unchanged (already English) or AI skipped it
      try {
        const pr = await updateBreezewayTask(c.id, { name: nt })
        if (pr.ok) {
          translated++
          try { await db.from('breezeway_tasks_sync').update({ name: nt }).eq('id', c.id) } catch { /* mirror catches up */ }
        } else failed++
      } catch { failed++ }
      await sleep(100)
    }
  }
  return NextResponse.json({ ok: true, scanned: tasks.length, candidates: candidates.length, translated, failed, remaining: candidates.length - processed })
}
