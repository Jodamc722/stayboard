// AD STUDIO — the expert audit (Jon, 2026-11-03: "as an ad expert, audit this and make the best ads possible").
// POST { project } → { score, verdict, strengths, issues: [{ scene, problem, fix, patch }], checks: [...] }
// The deterministic checks (lib/ad-engine auditAd) run first; the model reviews on top of them. Nothing is saved.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { askJson } from '@/lib/ad-json'
import { normalize, auditPrompt, propertiesLine } from '@/lib/ad-studio'
import { auditAd, auditScore, timeline, HOUSE_FACTS, GUEST_FACTS, KINDS, tidyHead } from '@/lib/ad-engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'view'); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  const p = normalize(b?.project || {})
  const tl = timeline(p)
  const facts = p.audience === 'guests' ? GUEST_FACTS : HOUSE_FACTS
  const checks = auditAd(p, tl, facts)
  const base = auditScore(checks)
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || b?.quick) return NextResponse.json({ ok: true, score: base, verdict: '', strengths: [], issues: [], checks })
  try {
    const a = await askJson(key, auditPrompt(p, checks, tl.total, await propertiesLine()), { maxTokens: 2500, temperature: 0.4 })
    if (!a.ok) return NextResponse.json({ ok: true, score: base, verdict: '', strengths: [], issues: [], checks, note: a.error })
    const j = a.json
    const kinds = KINDS.map(k => k.kind as string)
    const issues = (Array.isArray(j?.issues) ? j.issues : []).slice(0, 6).map((x: any) => {
      const sc = Math.max(1, Math.min(p.scenes.length, Number(x?.scene) || 1)) - 1
      const pt = x?.patch || {}
      const patch: any = {}
      if (typeof pt.head === 'string') patch.head = tidyHead(pt.head.slice(0, 300))
      if (typeof pt.vo === 'string') patch.vo = pt.vo.slice(0, 600)
      if (typeof pt.sub === 'string') patch.sub = pt.sub.slice(0, 300)
      if (Array.isArray(pt.items)) patch.items = pt.items.map((s: any) => String(s).slice(0, 160)).slice(0, 12)
      if (typeof pt.kind === 'string' && kinds.indexOf(pt.kind) >= 0) patch.kind = pt.kind
      if (typeof pt.badge === 'string') patch.badge = pt.badge.slice(0, 22)
      return { scene: sc, problem: String(x?.problem || '').slice(0, 300), fix: String(x?.fix || '').slice(0, 400), patch: Object.keys(patch).length ? patch : null, remove: !!pt.delete }
    }).filter((x: any) => x.problem)
    const score = Math.round((base + (Number(j?.score) || base)) / 2)
    return NextResponse.json({ ok: true, score, verdict: String(j?.verdict || '').slice(0, 300), strengths: (Array.isArray(j?.strengths) ? j.strengths : []).slice(0, 4).map((s: any) => String(s).slice(0, 200)), issues, checks })
  } catch (e: any) { return NextResponse.json({ ok: true, score: base, verdict: '', strengths: [], issues: [], checks, note: String(e?.message || e).slice(0, 200) }) }
}
