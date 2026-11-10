// THE LINEN STANDARD AS ANYONE MAY SEE IT (Jon, 2026-11-10: "linen calculator as a link like this, no
// need for login or password"). /kit/linens counts linen from Jon's standard for whoever opens it, so
// the standard handed to the page keeps only what a count needs — items, quantities, par, bed sizes —
// and the product description per tier. Never sent: prices, per-size prices, vendors, SKUs, case
// sizes, minimums, markup and tax. Isomorphic.
import type { LinenStandard, LinenTier, LinenUnit } from './linens'
import { LINEN_TIERS, normBeds } from './linens'

export function publicLinenStandard(s: LinenStandard): LinenStandard {
  return {
    par: s.par, bedSizes: [...s.bedSizes], tierLabels: { ...s.tierLabels }, vendors: [],
    sofaSize: s.sofaSize, sofaPar: s.sofaPar, markupPct: 0, taxPct: 0,
    items: s.items.filter(i => i.active !== false).map(i => {
      const tiers: Partial<Record<LinenTier, { product?: string; off?: boolean }>> = {}
      for (const t of LINEN_TIERS) { const o = i.tiers?.[t]; if (o) tiers[t] = { ...(o.product ? { product: o.product } : {}), ...(o.off ? { off: true } : {}) } }
      return { id: i.id, name: i.name, group: i.group, per: i.per, qty: i.qty, ...(i.qtyBySize ? { qtyBySize: { ...i.qtyBySize } } : {}), rotates: i.rotates, ...(typeof i.par === 'number' ? { par: i.par } : {}), tiers }
    }),
  }
}

// The units a person typed, as the Excel link carries them: ?u=[{"n":"302","bd":2,"ba":2,"g":6,"k":1,"beds":{"King":1,"Queen":1}}]
export type PublicLinenUnit = { n: string; bd: number; ba: number; g: number; k: number; beds: Record<string, number> }
const int = (v: any, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d }
export function linenUnitsFromParam(raw: string | null | undefined): LinenUnit[] {
  let arr: any[] = []
  try { const j = JSON.parse(raw || '[]'); if (Array.isArray(j)) arr = j.slice(0, 60) } catch { /* nothing */ }
  return arr.map((x, i) => ({
    id: 'u' + i, name: String(x?.n || `Unit ${i + 1}`).slice(0, 40),
    bedrooms: Math.round(int(x?.bd, 0, 20, 1)), bathrooms: Math.round(int(x?.ba, 0, 20, 1) * 2) / 2, guests: Math.round(int(x?.g, 0, 50, 2)),
    kitchens: Math.round(int(x?.k, 0, 10, 1)), beds: normBeds(x?.beds), bedsSource: 'manual' as const,
  }))
}
