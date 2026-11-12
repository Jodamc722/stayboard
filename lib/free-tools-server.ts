// The arithmetic behind the free tools (lib/free-tools). Server-only: it reads the Projections library,
// the inventory standard and the linen standard, and the full quote leaves here only after an email.
import 'server-only'
import { getSetting } from './app-settings'
import { readLibrary } from './sales-library'
import { planNumbers, SEASON } from './sales-cma'
import { bedKey } from './sales-comps'
import { needList, NEED_ROOMS } from './need-list'
import { describeSize, type KitSize } from './starter-kit'
import { normLinenStandard, linenQuote, parSentence, LINEN_STANDARD_KEY, SOFA_BED, type LinenUnit } from './linens'
import type { ToolKey, ToolInput, IncomeInput, InventoryInput, LinenInput, IncomeFull, InventoryFull, LinenFull, ToolSummary, ToolFull, InvRow } from './free-tools'

const MGMT = 15, CHANNEL = 15
const med = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const r100 = (n: number) => Math.round(n / 100) * 100
const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z]/g, '')

// ── income ───────────────────────────────────────────────────────────────────────────────────────
async function income(inp: IncomeInput): Promise<IncomeFull> {
  const lib = await readLibrary().catch(() => [])
  const want = inp.bedrooms === 0 ? 'studio' : String(inp.bedrooms)
  type Pt = { lo: number; hi: number; nlo: number; nhi: number; olo: number; ohi: number; area: string; src: string }
  const pts: Pt[] = []
  for (const b of lib) {
    for (const p of b.cma.plans) {
      if (bedKey(p.name) !== want) continue
      const n = planNumbers(b.cma, p)
      if (n.lo > 0) pts.push({ lo: n.lo, hi: n.hi, nlo: n.nightlyLo, nhi: n.nightlyHi, olo: p.occLo, ohi: p.occHi, area: b.area || b.cma.area || '', src: b.name })
    }
    for (const c of b.cma.comps) {
      if (bedKey(c.name) !== want || !(c.lo > 0)) continue
      pts.push({ lo: c.lo, hi: c.hi || c.lo, nlo: c.nightlyLo, nhi: c.nightlyHi, olo: c.occLo, ohi: c.occHi, area: String(c.market || '').split(',')[0], src: 'Comparable' })
    }
  }
  // The neighborhood's own figures when there are any; Stay's South Florida set otherwise.
  const local = inp.area ? pts.filter(p => norm(p.area).includes(norm(inp.area!)) || norm(inp.area!).includes(norm(p.area))) : []
  const use = local.length ? local : pts
  const base: IncomeFull = { found: false, area: local.length ? inp.area! : 'South Florida', bedrooms: inp.bedrooms, lo: 0, hi: 0, monthLo: 0, monthHi: 0, basis: 0, nightlyLo: 0, nightlyHi: 0, occLo: 0, occHi: 0, months: [], netLo: 0, netHi: 0, mgmtPct: MGMT, channelPct: CHANNEL, sources: [] }
  if (!use.length) return base
  const lo = r100(med(use.map(p => p.lo))), hi = Math.max(lo, r100(med(use.map(p => p.hi))))
  const net = (g: number) => r100(g * (1 - CHANNEL / 100) * (1 - MGMT / 100))
  return {
    ...base, found: true, lo, hi, monthLo: r100(lo / 12), monthHi: r100(hi / 12), basis: use.length,
    nightlyLo: Math.round(med(use.map(p => p.nlo).filter(Boolean))), nightlyHi: Math.round(med(use.map(p => p.nhi).filter(Boolean))),
    occLo: Math.round(med(use.map(p => p.olo).filter(Boolean))), occHi: Math.round(med(use.map(p => p.ohi).filter(Boolean))),
    months: SEASON.map(s => ({ lo: r100(lo * s), hi: r100(hi * s) })), netLo: net(lo), netHi: net(hi),
    sources: Array.from(new Set(use.map(p => p.src))).slice(0, 6),
  }
}

// ── inventory ────────────────────────────────────────────────────────────────────────────────────
// The same list as the free need list on the website (/kit/plan, lib/need-list): what a home of this
// shape needs, grouped into the sets things are bought in, must-have / recommended / optional.
async function inventory(inp: InventoryInput): Promise<InventoryFull> {
  const full = inp.kitchen === 'full', any = inp.kitchen !== 'none'
  const z: KitSize = { bedrooms: Math.max(1, inp.bedrooms), bathrooms: Math.ceil(inp.bathrooms), guests: inp.guests, kitchen: any,
    appliances: { stove: any, oven: full, microwave: any, fridge: any, dishwasher: full } }
  const lines = needList(z)
  const tierOf = (t: string): InvRow['tier'] => (t === 'optional' ? 'suggested' : t as InvRow['tier'])
  const rows: InvRow[] = lines.map(l => ({ name: l.item.name, qty: l.count, group: l.item.room, tier: tierOf(l.tier) }))
  const order = NEED_ROOMS as readonly string[]
  rows.sort((x, y) => order.indexOf(x.group) - order.indexOf(y.group))
  const groups = order.map(g => ({ group: g, items: rows.filter(r => r.group === g).length })).filter(g => g.items)
  return {
    items: rows.length, pieces: rows.reduce((a, r) => a + r.qty, 0),
    must: rows.filter(r => r.tier === 'must').length, recommended: rows.filter(r => r.tier === 'recommended').length, suggested: rows.filter(r => r.tier === 'suggested').length,
    groups, rows, describe: describeSize(z),
  }
}

// ── linen ────────────────────────────────────────────────────────────────────────────────────────
async function linen(inp: LinenInput): Promise<LinenFull> {
  const standard = normLinenStandard(await getSetting<any>(LINEN_STANDARD_KEY, null))
  const beds = { ...inp.beds }
  if (inp.sleeper) beds[SOFA_BED] = (beds[SOFA_BED] || 0) + 1
  const bedrooms = Math.max(0, Object.entries(inp.beds).reduce((a, [, n]) => a + n, 0))
  const unit: LinenUnit = { id: 'free-tool', name: 'Your home', bedrooms, bathrooms: inp.bathrooms, guests: inp.guests, kitchens: inp.kitchen ? 1 : 0, beds, bedsSource: 'manual' }
  // Quantities only (Jon, 2026-11-12): the pieces come from the standard's mid tier list, never a price.
  const q = linenQuote(standard, [unit], 'mid')
  const rows = q.rows.map(r => ({ name: r.name, group: r.group, size: r.size, qty: r.qty }))
  const groups = Array.from(new Set(rows.map(r => r.group))).map(g => ({ group: g, pieces: rows.filter(r => r.group === g).reduce((a, r) => a + r.qty, 0) }))
  return { pieces: q.pieces, par: standard.par, groups, rows, parText: parSentence(standard) }
}

export async function runTool(tool: ToolKey, inp: ToolInput): Promise<ToolFull> {
  if (tool === 'income') return income(inp as IncomeInput)
  if (tool === 'inventory') return inventory(inp as InventoryInput)
  return linen(inp as LinenInput)
}

/** What anyone sees before leaving an email: the headline, never the list. */
export function summaryOf(tool: ToolKey, full: ToolFull): ToolSummary {
  if (tool === 'income') { const f = full as IncomeFull; return { found: f.found, area: f.area, bedrooms: f.bedrooms, lo: f.lo, hi: f.hi, monthLo: f.monthLo, monthHi: f.monthHi, basis: f.basis } }
  if (tool === 'inventory') { const f = full as InventoryFull; return { items: f.items, pieces: f.pieces, must: f.must, recommended: f.recommended, suggested: f.suggested, groups: f.groups } }
  const f = full as LinenFull
  return { pieces: f.pieces, par: f.par, groups: f.groups }
}
