// WHERE A NUMBER CAME FROM (Eve reorganisation, 2026-11-10).
//
// The rules have always said "no data, no number" and "say when a list is partial" — as prose. This
// file makes the receipt a thing: one line per lookup with the source it read, the window it covered,
// when it was read, how many records it rests on and whether it was cut short. run.ts collects them
// into meta.evidence and the chat shows them under "What I used".
//
// Newer tools state it themselves in `_meta` (lib/eve/ctx.ts toolMeta). For the older ones the same
// facts are read off the fields they already return — nothing is invented: a field that is not in the
// result is simply left out of the line.
//
// No imports, so the chat component and a plain node test can both use the type and the function.

export type EvidenceItem = {
  tool: string
  source?: string
  window?: string
  as_of?: string
  n?: number
  truncated?: boolean
  basis?: string
}

const clip = (v: any, max: number): string => {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v)
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function windowOf(o: any): string {
  const w = o?.window
  if (typeof w === 'string') return w
  if (w && typeof w === 'object') {
    if (w.from && w.to) return `${w.from} → ${w.to}`
    if (w.days) return `last ${w.days} days`
  }
  if (o?.window_days) return `last ${o.window_days} days`
  if (o?.range && o.range.from && o.range.to) return `${o.range.from} → ${o.range.to}`
  if (typeof o?.month === 'string') return o.month
  if (typeof o?.date === 'string') return o.date
  if (o?.from && o?.to && typeof o.from === 'string' && typeof o.to === 'string') return `${o.from} → ${o.to}`
  return ''
}

function countOf(o: any): number | undefined {
  for (const k of ['total_rows', 'total', 'count', 'review_count', 'task_count', 'open_count', 'bookings_scanned', 'units_scored', 'scanned']) {
    const v = o?.[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return undefined
}

/** One evidence line for a tool result, or null for a result that carries no facts (an error, a write). */
export function evidenceOf(tool: string, output: any): EvidenceItem | null {
  if (!tool || tool === 'open_domain') return null
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null
  if (output.error || output.ambiguous) return null
  const m = output._meta && typeof output._meta === 'object' ? output._meta : null
  const item: EvidenceItem = { tool }
  const source = m?.source
  if (source) item.source = clip(source, 90)
  const win = (m && m.window) || windowOf(output)
  if (win) item.window = clip(win, 60)
  if (m?.as_of) item.as_of = clip(m.as_of, 40)
  const n = m && typeof m.n === 'number' ? m.n : countOf(output)
  if (typeof n === 'number') item.n = n
  const cut = !!(m && m.truncated) || output.truncated === true || !!output._cut || !!output.more || output.complete === false || output.payroll_complete === false
  if (cut) item.truncated = true
  const basis = (m && m.basis) || (typeof output.basis === 'string' ? output.basis : '')
  if (basis) item.basis = clip(basis, 110)
  // A write or a bare acknowledgement has none of these — it is not evidence for a number.
  if (!item.source && !item.window && item.n == null && !item.truncated && !item.basis) return null
  return item
}

/** The `_evidence:<json>` entry run.ts appends to meta.tools, parsed back out. Never throws. */
export function evidenceFromTools(tools: any): EvidenceItem[] {
  try {
    const list: any[] = Array.isArray(tools) ? tools : []
    const hit = list.find(t => typeof t === 'string' && t.indexOf('_evidence:') === 0)
    if (!hit) return []
    const parsed = JSON.parse(String(hit).slice('_evidence:'.length))
    return Array.isArray(parsed) ? parsed.filter((x: any) => x && typeof x.tool === 'string') : []
  } catch { return [] }
}
