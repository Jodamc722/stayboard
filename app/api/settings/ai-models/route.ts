// AI MODELS — which model performs which task. Read by every admin; written by the owner.
//   GET  -> { tasks: [{ key, title, what, matters, group, background, def, tier, overridden }], tiers, prices }
//   PUT  { overrides: { [taskKey]: tier | null } } -> saves; null (or the task's default) clears the override
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'
import { AI_MODELS_KEY, AI_TASKS, MODEL_IDS, MODEL_LABEL, MODEL_PRICE, aiModelTable, bustAiModelsCache, isTier } from '@/lib/ai-models'

export const dynamic = 'force-dynamic'

async function payload() {
  const table = await aiModelTable()
  const byKey = Object.fromEntries(table.map(t => [t.key, t]))
  return {
    ok: true,
    tasks: AI_TASKS.map(t => ({ ...t, tier: byKey[t.key]?.tier || t.def, overridden: !!byKey[t.key]?.overridden })),
    tiers: (Object.keys(MODEL_IDS) as (keyof typeof MODEL_IDS)[]).map(k => ({ key: k, label: MODEL_LABEL[k], id: MODEL_IDS[k], price: MODEL_PRICE[k] })),
  }
}

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  return NextResponse.json(await payload())
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isSuperadmin(access.email)) return NextResponse.json({ error: 'Only the owner can change which model runs a task.' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  const incoming = body?.overrides && typeof body.overrides === 'object' ? body.overrides : {}
  const current = await getSetting<Record<string, any>>(AI_MODELS_KEY, {})
  const next: Record<string, string> = { ...(current || {}) }
  for (const t of AI_TASKS) {
    if (!(t.key in incoming)) continue
    const v = incoming[t.key]
    // Choosing the default is the same as clearing the override: the table stays small and a
    // future change to the default in code is not silently pinned by an old save.
    if (v == null || v === t.def || !isTier(v)) delete next[t.key]
    else next[t.key] = v
  }
  const r = await setSetting(AI_MODELS_KEY, next, access.email)
  if (!r.ok) return NextResponse.json({ error: r.error || 'save failed' }, { status: 500 })
  bustAiModelsCache()
  return NextResponse.json(await payload())
}
