// THE REPORT AUDIT, ON DEMAND (lib/billing-evidence). The review desk sends the billable rows it
// has not checked yet — at most 24 per call — and gets each one's verdict back to merge in place.
//
//   POST { taskIds: string[], force?: boolean } → { ok, evidence: { [id]: Evidence }, remaining }
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured } from '@/lib/breezeway'
import { gatherEvidence, readEvidence, saveEvidence, type Evidence } from '@/lib/billing-evidence'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const gate = await requireLevel('billing', 'view')
  if (!gate.ok) return gate.res
  if (!breezewayConfigured()) return NextResponse.json({ ok: false, error: 'Breezeway is not configured' }, { status: 503 })
  const b = await req.json().catch(() => ({}))
  const asked: string[] = Array.from(new Set((Array.isArray(b?.taskIds) ? b.taskIds : []).map((x: any) => String(x)).filter((x: string) => /^\d+$/.test(x))))
  const have = b?.force ? {} : await readEvidence()
  const todo = asked.filter(id => !have[id]).slice(0, 24)
  if (!todo.length) return NextResponse.json({ ok: true, evidence: {}, remaining: 0 })
  const { data } = await supabaseAdmin().from('breezeway_tasks_sync').select('id, name, descr:raw->>description').in('id', todo)
  const meta: Record<string, any> = {}
  for (const r of (data || []) as any[]) meta[String(r.id)] = r
  let photosById: Record<string, number> = {}
  try { const { readExtras } = await import('@/lib/task-extras'); const ex: any = await readExtras(); for (const id of todo) photosById[id] = Array.isArray(ex?.[id]?.photos) ? ex[id].photos.length : 0 } catch { photosById = {} }
  const out: Record<string, Evidence> = {}
  const started = Date.now()
  for (let i = 0; i < todo.length; i += 4) {
    if (Date.now() - started > 90_000) break
    await Promise.all(todo.slice(i, i + 4).map(async id => {
      try { out[id] = await gatherEvidence(id, { name: meta[id]?.name, description: meta[id]?.descr }, photosById[id] || 0) } catch { /* next pass */ }
    }))
  }
  await saveEvidence(out, gate.access.email || 'billing')
  return NextResponse.json({ ok: true, evidence: out, remaining: Math.max(0, asked.filter(id => !have[id]).length - Object.keys(out).length) })
}
