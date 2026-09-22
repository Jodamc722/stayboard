// ── SINCE THE LAST ONE ───────────────────────────────────────────────────────────────────────
// Jon, 2026-09-22: "if I generate the report from one week to the next week and it's in the same
// month, it should show the percentage increase… +5% in occupancy, +$30K in revenue… If I delete
// one, then it has nothing to reference, but if the report is still live and I created it, then
// it should populate it."
//
// So this is a LOOKUP, not a stored field: at render we find the most recent OTHER live report
// for the same scope covering the same calendar month, and diff its headline numbers against
// this one's. Deleting the earlier report removes the reference and the chips disappear on the
// next load, which is exactly the behaviour asked for — nothing to migrate, nothing to clean up.
//
// WHY ONLY THE SAME MONTH. A September report against an August one is not a week of progress,
// it is a different period, and the deck already has a whole slide for month-over-month. This
// exists for the mid-month re-run: same month, a few days later, what moved.
import { supabaseAdmin } from './supabase-admin'
import { basisTriple, type Basis, type BasisRaw } from './basis'

export type DeltaRow = {
  key: 'revenue' | 'occupancy' | 'adr' | 'revpar'
  label: string
  /** Signed, already formatted: "+$30K", "-2.4 pts". */
  delta: string
  /** Signed percentage change, formatted: "+5.2%". Null when the base was zero. */
  pct: string | null
  /** True when the movement is in the owner's favour. */
  good: boolean
}
export type ReportDelta = {
  /** "the review you sent on 12 September" — what the chips are measured against. */
  since: string
  sinceCode: string
  days: number
  rows: DeltaRow[]
}

const money = (v: number): string => {
  const a = Math.abs(v)
  const s = v < 0 ? '−' : '+'
  if (a >= 1_000_000) return s + '$' + (a / 1_000_000).toFixed(2) + 'M'
  if (a >= 10_000) return s + '$' + Math.round(a / 1000) + 'K'
  return s + '$' + Math.round(a).toLocaleString()
}
const signed = (v: number, unit: string, dp = 0): string =>
  (v < 0 ? '−' : '+') + Math.abs(v).toFixed(dp) + unit

const monthOf = (iso: string): string => String(iso || '').slice(0, 7)

/** The basis the report itself is set to, so the chips agree with the numbers above them. */
function basisOf(content: any): Basis {
  const b = content?.basis || {}
  const v = String(b.snapshotPrimary || b.default || 'netota')
  return (v === 'net' || v === 'gross' || v === 'netota') ? v : 'netota'
}

function metricsOf(content: any): { raw: BasisRaw | null; occPct: number | null } {
  const m = content?.snapshot?.metrics || {}
  const has = m && (m.accomGrossNum != null || m.accomNetNum != null || m.cleaningNum != null)
  return { raw: has ? (m as BasisRaw) : null, occPct: m?.occPct == null ? null : Number(m.occPct) }
}

/**
 * Find the previous live report for this scope and month, and diff it.
 * Returns null whenever there is nothing honest to compare against — no earlier report, a
 * different month, or neither report carrying the raw numbers a basis needs.
 */
export async function reportDelta(report: any): Promise<ReportDelta | null> {
  try {
    const month = monthOf(report?.period_start)
    if (!month) return null
    const db = supabaseAdmin()
    let q = db.from('owner_reports')
      .select('code, title, created_at, period_start, period_end, content, scope_label')
      .neq('id', report.id)
      .lt('created_at', report.created_at)
      .gte('period_start', month + '-01')
      .lte('period_start', month + '-31')
      .order('created_at', { ascending: false })
      .limit(1)
    // Same scope, or the chips would compare two different buildings.
    if (report.scope_label) q = q.eq('scope_label', report.scope_label)
    const { data } = await q
    const prev = (data || [])[0] as any
    if (!prev) return null
    // The earlier report has to cover the same window, or "since last week" is really "a shorter
    // month vs a longer one" and every number moves for the wrong reason.
    if (monthOf(prev.period_start) !== month) return null

    const b = basisOf(report?.content)
    const now = metricsOf(report?.content)
    const was = metricsOf(prev?.content)
    const rows: DeltaRow[] = []

    if (now.raw && was.raw) {
      const a = basisTriple(now.raw, b)
      const z = basisTriple(was.raw, b)
      const push = (key: DeltaRow['key'], label: string, cur: number, old: number, fmt: (v: number) => string) => {
        if (!Number.isFinite(cur) || !Number.isFinite(old)) return
        const d = cur - old
        if (Math.abs(d) < 0.5) return
        rows.push({
          key, label, delta: fmt(d),
          pct: old ? signed((d / Math.abs(old)) * 100, '%', 1) : null,
          good: d > 0,
        })
      }
      push('revenue', 'Revenue', a.revenue, z.revenue, money)
      push('adr', 'ADR', a.adr, z.adr, money)
      push('revpar', 'RevPAR', a.revpar, z.revpar, money)
    }
    if (now.occPct != null && was.occPct != null) {
      const d = now.occPct - was.occPct
      if (Math.abs(d) >= 0.1) {
        rows.push({
          key: 'occupancy', label: 'Occupancy', delta: signed(d, ' pts', 1),
          pct: was.occPct ? signed((d / Math.abs(was.occPct)) * 100, '%', 1) : null,
          good: d > 0,
        })
      }
    }
    if (!rows.length) return null

    const when = new Date(String(prev.created_at))
    const days = Math.max(0, Math.round((new Date(String(report.created_at)).getTime() - when.getTime()) / 86_400_000))
    const since = Number.isNaN(when.getTime())
      ? 'the last review'
      : when.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    return { since, sinceCode: String(prev.code || ''), days, rows }
  } catch {
    return null
  }
}
