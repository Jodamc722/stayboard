// The arithmetic behind the free tools (lib/free-tools). Server-only: it reads the Projections library,
// the inventory standard and the linen standard, and the full quote leaves here only after an email.
import 'server-only'
import { getSetting } from './app-settings'
import { readLibrary } from './sales-library'
import { planNumbers, SEASON } from './sales-cma'
import { bedKey } from './sales-comps'
import { normProjCalc, adjustmentsFor, sqftOf, PROJ_CALC_KEY } from './projection-calc'
import { geocode, nearby } from './projection-places'
import { money0 } from './free-tools'
import { needList, NEED_ROOMS } from './need-list'
import { describeSize, type KitSize } from './starter-kit'
import { normLinenStandard, linenQuote, parSentence, LINEN_STANDARD_KEY, SOFA_BED, type LinenUnit } from './linens'
import type { ToolKey, ToolInput, IncomeInput, InventoryInput, IncomeFull, InventoryFull, ToolSummary, ToolFull, InvRow } from './free-tools'

const MGMT = 15, CHANNEL = 15
const med = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const r100 = (n: number) => Math.round(n / 100) * 100
const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z]/g, '')

// ── income ───────────────────────────────────────────────────────────────────────────────────────
async function income(inp: IncomeInput, light = false): Promise<IncomeFull> {
  const lib = await readLibrary().catch(() => [])
  const want = inp.bedrooms === 0 ? 'studio' : String(inp.bedrooms)
  type Pt = { lo: number; hi: number; nlo: number; nhi: number; olo: number; ohi: number; area: string; src: string; sf: number | null; comp?: { name: string; market: string; gross: string; nightly: string; occ: string } }
  const asComp = (name: string, market: string, lo: number, hi: number, nlo: number, nhi: number, olo: number, ohi: number) =>
    ({ name, market, gross: lo === hi || !hi ? money0(lo) : money0(lo) + '–' + money0(hi).slice(1), nightly: nlo ? money0(nlo) + '–' + money0(nhi || nlo).slice(1) + ' a night' : '', occ: olo ? olo + (ohi && ohi !== olo ? '–' + ohi : '') + '% occupied' : '' })
  const pts: Pt[] = [], own: Pt[] = []
  // Only what the team has cleared for the public: a building switched off (calc: false) and a projection
  // marked not public (pending approval, a caveat) never feed the calculator. Unit numbers stay internal.
  const bare = (name: string) => name.split(' · ')[0]
  for (const b of lib) {
    if (b.calc === false) continue
    for (const p of b.cma.plans) {
      if (p.public === false || p.status === 'pending') continue
      if (bedKey(p.name) !== want) continue
      const n = planNumbers(b.cma, p)
      if (!(n.lo > 0)) continue
      const pt: Pt = { lo: n.lo, hi: n.hi, nlo: n.nightlyLo, nhi: n.nightlyHi, olo: p.occLo, ohi: p.occHi, area: b.area || b.cma.area || '', src: b.name, sf: sqftOf(p.sf), comp: asComp(b.name + ' ' + bare(p.name), b.area || '', n.lo, n.hi, n.nightlyLo, n.nightlyHi, p.occLo, p.occHi) }
      pts.push(pt)
      if (inp.libId && b.id === inp.libId) own.push(pt)
    }
    for (const c of b.cma.comps) {
      if (bedKey(c.name) !== want || !(c.lo > 0)) continue
      pts.push({ lo: c.lo, hi: c.hi || c.lo, nlo: c.nightlyLo, nhi: c.nightlyHi, olo: c.occLo, ohi: c.occHi, area: String(c.market || '').split(',')[0], src: 'Comparable', sf: sqftOf(c.name), comp: asComp(c.name, c.market || '', c.lo, c.hi || c.lo, c.nightlyLo, c.nightlyHi, c.occLo, c.occHi) })
    }
  }
  // Where it is: coordinates from the building we manage, else the address, geocoded; then the beach and
  // the nearest attractions from the curated list.
  let lat = inp.lat, lng = inp.lng, area = inp.area || ''
  // light: the pre-email check only says whether a projection can be built, so it never geocodes.
  if (!light && (lat == null || lng == null) && inp.address) { const g = await geocode(inp.address); if (g) { lat = g.lat; lng = g.lng; area = area || g.area } }
  const near = lat != null && lng != null ? nearby(lat, lng) : { beachMi: null, places: [] }
  // The base, most specific first: this building's own projections (the actuals we hold), then the
  // neighborhood's plans and comparables, then South Florida.
  const norm2 = (x: string) => norm(x).replace(/miami$/, '')
  const local = area ? pts.filter(p => p.area && (norm2(p.area).includes(norm2(area)) || norm2(area).includes(norm2(p.area)))) : []
  // AUDIT 2026-11-12: one or two neighbourhood points are not a market. Fewer than three local comparables and
  // the base widens to every home with this bedroom count (the building's own projections always stand).
  const localOk = local.length >= 3
  const use = own.length ? own : localOk ? local : pts
  const basisLabel = own.length ? (inp.building || 'this building') + '’s own projections' : localOk ? 'homes like it in ' + area : 'homes like it across South Florida'
  const mg = inp.managed ? MGMT : 0
  const settings = normProjCalc(await getSetting<any>(PROJ_CALC_KEY, null))
  const base: IncomeFull = { found: false, area: own.length ? (inp.building || area) : localOk ? area : 'South Florida', bedrooms: inp.bedrooms, basis: 0, basisLabel, lo: 0, hi: 0, monthLo: 0, monthHi: 0, nightlyLo: 0, nightlyHi: 0, occLo: 0, occHi: 0, months: [], netLo: 0, netHi: 0, mgmtPct: mg, channelPct: CHANNEL, sources: [],
    baseLo: 0, baseHi: 0, adjustments: [], adjTotal: 0, comps: [], places: near.places, beachMi: near.beachMi, address: inp.address || '', note: settings.note }
  if (!use.length) return base
  const baseLo = r100(med(use.map(p => p.lo))), baseHi = Math.max(baseLo, r100(med(use.map(p => p.hi))))
  const sfs = use.map(p => p.sf).filter((x): x is number => !!x)
  const oLo0 = med(use.map(p => p.olo).filter(Boolean)), oHi0 = med(use.map(p => p.ohi).filter(Boolean))
  const baseOcc = oLo0 && oHi0 ? (oLo0 + oHi0) / 2 : 70
  const adj = adjustmentsFor(settings, { view: inp.view, kitchen: inp.kitchen, balcony: inp.balcony, amenities: inp.amenities, sqft: inp.sqft, beachMi: near.beachMi, typicalSqft: sfs.length ? med(sfs) : null, baseOcc, basis: own.length ? 'own' : localOk ? 'local' : 'all' })
  // revenue moves by the rate and the occupancy together; the nightly rate by the rate alone
  const f = adj.factor
  // A thin base (fewer than three comparables in all) is shown as a wider range, never as false precision.
  const thin = !own.length && use.length < 3 ? 0.1 : 0
  const lo = r100(baseLo * f * (1 - thin)), hi = Math.max(lo, r100(baseHi * f * (1 + thin)))
  const net = (g: number) => r100(g * (1 - CHANNEL / 100) * (1 - mg / 100))
  const nlo = Math.round(med(use.map(p => p.nlo).filter(Boolean)) * adj.adrFactor), nhi = Math.round(med(use.map(p => p.nhi).filter(Boolean)) * adj.adrFactor)
  // The comparables shown in the report: this building's projections first, then the nearest set.
  const comps = Array.from(new Map([...own, ...local, ...pts].filter(p => p.comp).map(p => [p.comp!.name, p.comp!])).values()).slice(0, 5)
  return {
    ...base, found: true, lo, hi, monthLo: r100(lo / 12), monthHi: r100(hi / 12), basis: use.length, baseLo, baseHi,
    nightlyLo: nlo, nightlyHi: Math.max(nlo, nhi),
    occLo: oLo0 ? Math.round(Math.min(settings.occMax, oLo0 + adj.occ)) : 0, occHi: oHi0 ? Math.round(Math.min(settings.occMax, oHi0 + adj.occ)) : 0,
    months: SEASON.map(s => ({ lo: r100(lo * s), hi: r100(hi * s) })), netLo: net(lo), netHi: net(hi),
    sources: Array.from(new Set(use.map(p => p.src))).slice(0, 6), adjustments: adj.list, adjTotal: adj.total, adjAdr: adj.adr, adjOcc: adj.occ, comps,
  }
}

// ── inventory, with the linen in it ──────────────────────────────────────────────────────────────
// The supplies are the website need list (lib/need-list), sized by the appliances the home actually
// has; the linen is the linen standard at par for these beds and baths, in quantities only.
async function inventory(inp: InventoryInput): Promise<InventoryFull> {
  const z: KitSize = { bedrooms: Math.max(1, inp.bedrooms), bathrooms: Math.ceil(inp.bathrooms), guests: inp.guests, kitchen: inp.kitchen, appliances: { ...inp.appliances } }
  const tierOf = (t: string): InvRow['tier'] => (t === 'optional' ? 'suggested' : t as InvRow['tier'])
  const rows: InvRow[] = needList(z).map(l => ({ name: l.item.name, qty: l.count, group: l.item.room, tier: tierOf(l.tier) }))
  const order = NEED_ROOMS as readonly string[]
  rows.sort((x, y) => order.indexOf(x.group) - order.indexOf(y.group))
  const groups = order.map(g => ({ group: g, items: rows.filter(r => r.group === g).length })).filter(g => g.items)

  const standard = normLinenStandard(await getSetting<any>(LINEN_STANDARD_KEY, null))
  const beds = { ...inp.beds }
  if (inp.sleeper) beds[SOFA_BED] = (beds[SOFA_BED] || 0) + 1
  const unit: LinenUnit = { id: 'free-tool', name: 'Your home', bedrooms: Math.max(1, inp.bedrooms), bathrooms: inp.bathrooms, guests: inp.guests, kitchens: inp.kitchen ? 1 : 0, beds, bedsSource: 'manual' }
  const q = linenQuote(standard, [unit], 'mid')   // quantities only; prices never leave the server
  const linen = q.rows.map(r => ({ name: r.name, group: r.group, size: r.size, qty: r.qty }))
  const bedText = Object.entries(inp.beds).map(([k, n]) => n + ' ' + k).join(', ') + (inp.sleeper ? ', sofa bed' : '')
  return {
    items: rows.length, pieces: rows.reduce((a, r) => a + r.qty, 0),
    must: rows.filter(r => r.tier === 'must').length, recommended: rows.filter(r => r.tier === 'recommended').length, suggested: rows.filter(r => r.tier === 'suggested').length,
    groups, rows, describe: describeSize(z) + ' · ' + bedText,
    linen, linenPieces: q.pieces, par: standard.par, parText: parSentence(standard),
  }
}

export async function runTool(tool: ToolKey, inp: ToolInput, opts: { light?: boolean } = {}): Promise<ToolFull> {
  if (tool === 'income') return income(inp as IncomeInput, !!opts.light)
  return inventory(inp as InventoryInput)
}

/** What anyone sees before leaving an email: the headline, never the list. */
export function summaryOf(tool: ToolKey, full: ToolFull): ToolSummary {
  if (tool === 'income') { const f = full as IncomeFull; return { found: f.found, area: f.area, bedrooms: f.bedrooms, basis: f.basis, basisLabel: f.basisLabel } }
  const f = full as InventoryFull
  return { items: f.items, pieces: f.pieces, must: f.must, recommended: f.recommended, suggested: f.suggested, groups: f.groups, linenPieces: f.linenPieces, par: f.par }
}
