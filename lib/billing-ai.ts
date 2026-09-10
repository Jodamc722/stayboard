// THE MODEL'S ONE JOB ON THE BILLING DESK: read a routine task (unit check / strip) whose
// description is NOT the template and say whether real, chargeable work happened.
//
// Jon, 2026-09-10: "unit check without task should not cost anything, use AI to determine if it
// should have a cost… so auto close unit check… also unit strip is not a billable task."
//
// The deterministic part lives in lib/billing: a routine task with a blank / template description
// closes itself at $0 with no model call at all (that is ~98% of them). This file handles the
// remainder — a couple of dozen a month — once each, and writes the verdict into
// billing_adjustments.ai_* so the desk never asks twice. 'no_charge' lets the task close itself;
// 'bill' keeps it open with the reason and a suggested amount the reviewer can take or change.
// The model never sets a price on its own: a human still approves every dollar.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { anthropicMessages } from '@/lib/anthropic-call'
import { modelPairFor } from '@/lib/ai-models'
import { billingMonth, isBareRoutine, type BillingTask } from '@/lib/billing'

const MAX_PER_RUN = 40

export type JudgeResult = { ok: boolean; judged: number; billed: number; pending: number; model?: string; error?: string }

/** The routine tasks in a month that still need a verdict. */
export function pendingRoutine(tasks: BillingTask[]): BillingTask[] {
  return tasks.filter(t => t.routine && t.reviewState === 'open' && !t.aiVerdict && t.overrideAmount == null && !t.excluded
    && t.billedAmount === 0 && !isBareRoutine(t.name, t.description))
}

const SYSTEM = `You review work orders for a short-term rental property manager in South Florida. Each task is a routine "unit check" (an access log — staff entering a unit) or a "strip" (stripping beds before a clean). These are NOT billable to the unit's owner by default. Your job: read the description and any cost lines and decide whether REAL, CHARGEABLE work was done beyond the routine visit — a repair, a delivery, restocking supplies the owner pays for, handling a guest problem that took real labor, time spent for a building/city inspection at the owner's request.

Answer "no_charge" when the text is instructions or a checklist for the routine visit itself ("check cleanliness vs photos", "verify everything is ready", "long stay: add amenities"), when it is a note with no work done, or when the work described is part of normal turnover. Answer "bill" only when the description clearly shows extra labor or materials the owner should pay for. When you answer "bill", give a fair amount in whole USD for that labor/materials in this market (technician labor about $45-65/hour, minimum $35; materials at cost) and a one-sentence reason a manager could put on the owner's statement. Be conservative: when unsure, answer "no_charge".

STRICT JSON ONLY, no markdown: {"verdicts":[{"id":"<id>","verdict":"no_charge"|"bill","amount":0,"reason":"<one sentence>"}]}`

/** Judge the month's pending routine tasks (up to MAX_PER_RUN) and store the verdicts. */
export async function judgeRoutineTasks(month: string): Promise<JudgeResult> {
  const key = process.env.ANTHROPIC_API_KEY
  const data = await billingMonth(month)
  const pending = pendingRoutine(data.tasks)
  if (!pending.length) return { ok: true, judged: 0, billed: 0, pending: 0 }
  if (!key) return { ok: false, judged: 0, billed: 0, pending: pending.length, error: 'AI not configured' }
  const batch = pending.slice(0, MAX_PER_RUN)
  const payload = batch.map(t => ({
    id: t.id, task: t.name, unit: t.unit,
    description: String(t.description || '').slice(0, 600),
    minutes_on_clock: t.actualMinutes ?? null,
    cost_lines: t.items.map(i => ({ what: i.description, amount: i.amount, bill_to: i.bill_to || 'owner' })),
    status: t.status,
  }))
  const { model, fallback } = await modelPairFor('billing-judge')
  let answered = model
  let verdicts: { id: string; verdict: string; amount?: any; reason?: any }[] = []
  try {
    const r = await anthropicMessages(key, {
      model, max_tokens: 4000, system: SYSTEM,
      messages: [{ role: 'user', content: 'Tasks: ' + JSON.stringify(payload) }],
    }, fallback)
    answered = r.model
    if (!r.ok) throw new Error(String(r.data?.error?.message || 'model call failed (' + r.status + ')'))
    const text = (r.data?.content || []).filter((c: any) => c.type === 'text').map((c: any) => String(c.text || '')).join('\n')
    const m = text.match(/\{[\s\S]*\}/)
    const parsed = m ? JSON.parse(m[0]) : null
    verdicts = parsed && Array.isArray(parsed.verdicts) ? parsed.verdicts : []
  } catch (e: any) {
    return { ok: false, judged: 0, billed: 0, pending: pending.length, model: answered, error: String(e?.message || e).slice(0, 200) }
  }

  const known = new Set(batch.map(t => t.id))
  const now = new Date().toISOString()
  const rows: Record<string, any>[] = []
  let billed = 0
  for (const v of verdicts) {
    const id = String(v?.id || '')
    if (!known.has(id)) continue
    const verdict = v.verdict === 'bill' ? 'bill' : 'no_charge'
    const amt = verdict === 'bill' ? Math.round(Number(v.amount)) : null
    const amount = amt != null && Number.isFinite(amt) && amt > 0 && amt <= 5000 ? amt : null
    const reason = String(v.reason || '').replace(/\s+/g, ' ').trim().slice(0, 240) || null
    if (verdict === 'bill') billed++
    rows.push({ task_id: id, ai_verdict: verdict, ai_reason: reason, ai_amount: amount, ai_at: now, updated_by: 'ai:' + answered, updated_at: now })
    known.delete(id)
  }
  if (rows.length) {
    // Partial upsert: only the ai_* columns (plus the audit stamp) travel. A row that does not
    // exist yet is created with every other column at its default (open, no price, no note).
    const db = supabaseAdmin()
    const { error } = await db.from('billing_adjustments').upsert(rows, { onConflict: 'task_id' })
    if (error) return { ok: false, judged: 0, billed: 0, pending: pending.length, model: answered, error: error.message }
  }
  return { ok: true, judged: rows.length, billed, pending: pending.length - rows.length, model: answered }
}
