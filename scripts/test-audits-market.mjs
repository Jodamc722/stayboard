// node scripts/test-audits-market.mjs
//
// The market bucket used by /api/ops-today/audits-due. Jon 2026-08-10: "Botanica should be under
// the vendor tab, not Broward". The ops board was fixed earlier; this endpoint was still labelling
// by raw geography, so one screen showed the same unit in two different tabs.
//
// The rule under test is copied structurally from the route (same two helpers, same order). It
// imports the REAL vendorRegex and the REAL marketOf, so a change to either vendor list or to the
// building registry fails here rather than silently re-splitting the tabs.
import { vendorRegex, DEFAULT_VENDOR_BUILDINGS } from '../lib/ops-presets.ts'
import { marketOf } from '../lib/segments.ts'

const VENDOR_MARKET = 'Vendor'
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** Exactly what the route does, over a list of listing rows. */
function bucket(listings, vendorList = DEFAULT_VENDOR_BUILDINGS) {
  const RE = vendorRegex(vendorList)
  const nameOf = (l) => l.nickname || l.title || 'Unit'
  const geoOf = (l) => marketOf(l.building, l.address_city, nameOf(l))
  const isVendor = (l) => RE.test(str(l.building)) || RE.test(nameOf(l))
  const active = (l) => str(l.status).trim().toLowerCase() === 'active'

  const geoHasOwnUnits = new Set()
  for (const l of listings) {
    if (isVendor(l)) continue
    if (!active(l)) continue
    geoHasOwnUnits.add(geoOf(l))
  }
  return listings.filter(active).map(l => {
    const geo = geoOf(l), v = isVendor(l)
    return {
      unit: nameOf(l),
      market: v ? VENDOR_MARKET : geo,
      market2: v && !geoHasOwnUnits.has(geo) ? geo : null,
    }
  })
}

/** What the panel shows for a given market chip (mirrors the filter in TodayInOps). */
const shown = (rows, chip) => rows.filter(r => chip === 'all' || r.market === chip || r.market2 === chip).map(r => r.unit)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++
  else { fail++; console.log('  FAIL  ' + name + '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)) }
}
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }

// A portfolio shaped like the real one: in-house units in Miami and Broward, Botanica (vendor, in
// Broward geographically), and a North cluster that is entirely vendor-managed.
const PORTFOLIO = [
  { id: '1', nickname: 'Bay House 12B', building: 'Bay House',  address_city: 'Miami',        status: 'active' },
  { id: '2', nickname: 'Vue 804',       building: 'Vue',        address_city: 'Fort Lauderdale', status: 'active' },
  { id: '3', nickname: 'Botanica 1502', building: 'Botanica',   address_city: 'Fort Lauderdale', status: 'active' },
  { id: '4', nickname: 'Capri 3',       building: 'Capri',      address_city: 'West Palm Beach', status: 'active' },
  { id: '5', nickname: 'Park Towers 9', building: 'Park Towers', address_city: 'Miami',       status: 'active' },
]

console.log('\nbucketing')
const rows = bucket(PORTFOLIO)
const by = Object.fromEntries(rows.map(r => [r.unit, r]))

eq('Botanica is a vendor row, not a Broward one', by['Botanica 1502'].market, 'Vendor')
eq('...and is NOT also listed under Broward, which has our own units',
  by['Botanica 1502'].market2, null)
eq('Park Towers is vendor too, and Miami keeps its own units', by['Park Towers 9'].market, 'Vendor')
eq('Park Towers is not double-listed under Miami', by['Park Towers 9'].market2, null)
eq('an in-house Broward unit stays in Broward', by['Vue 804'].market, 'Broward')
eq('an in-house Miami unit stays in Miami', by['Bay House 12B'].market, 'Miami')

// North is entirely vendor-managed. Without market2 the North chip would show nothing at all.
eq('Capri is a vendor row', by['Capri 3'].market, 'Vendor')
eq('...but North has no in-house units, so it is kept alive there too', by['Capri 3'].market2, 'North')

console.log('\nwhat each chip shows')
eq('Vendor chip lists every vendor unit', shown(rows, 'Vendor').sort(), ['Botanica 1502', 'Capri 3', 'Park Towers 9'])
eq('Broward chip no longer shows Botanica', shown(rows, 'Broward'), ['Vue 804'])
eq('Miami chip no longer shows Park Towers', shown(rows, 'Miami'), ['Bay House 12B'])
eq('North chip still shows its vendor units rather than reading empty', shown(rows, 'North'), ['Capri 3'])
eq('All shows everything', shown(rows, 'all').length, 5)

console.log('\nself-correction')
// The moment a unit of ours opens in North, Capri stops being double-listed — the rule fixes
// itself instead of needing a per-building exception.
const withNorthOfOurs = PORTFOLIO.concat([
  { id: '6', nickname: 'Palm 21', building: 'Palm House', address_city: 'West Palm Beach', status: 'active' },
])
const rows2 = bucket(withNorthOfOurs)
const capri2 = rows2.find(r => r.unit === 'Capri 3')
eq('Capri drops its North listing once we have a real North unit', capri2.market2, null)
eq('North chip now shows only the unit we clean', shown(rows2, 'North'), ['Palm 21'])

console.log('\nedges')
// An inactive unit must not prop a geography up, or a sold-off building would keep a tab alive.
const inactiveNorth = PORTFOLIO.concat([
  { id: '7', nickname: 'Palm 21', building: 'Palm House', address_city: 'West Palm Beach', status: 'inactive' },
])
const rows3 = bucket(inactiveNorth)
eq('an inactive unit does not count as "we have units here"',
  rows3.find(r => r.unit === 'Capri 3').market2, 'North')
ok('and the inactive unit is not listed at all', !rows3.some(r => r.unit === 'Palm 21'))

// Vendor match works off the unit name too, not just the building column.
const nameOnly = [{ id: '8', nickname: 'Botanica 210', building: null, address_city: 'Fort Lauderdale', status: 'active' }]
eq('vendor detected from the unit name when building is blank', bucket(nameOnly)[0].market, 'Vendor')

// Turning a vendor building in-house puts it straight back into its geography.
const inHouse = DEFAULT_VENDOR_BUILDINGS.map(v => v.id === 'botanica' ? { ...v, enabled: false } : v)
const rows4 = bucket(PORTFOLIO, inHouse)
eq('disabling the vendor flag returns Botanica to Broward',
  rows4.find(r => r.unit === 'Botanica 1502').market, 'Broward')

// An empty vendor list must never match everything.
const rows5 = bucket(PORTFOLIO, [])
ok('an empty vendor list buckets nothing as Vendor', !rows5.some(r => r.market === 'Vendor'))

console.log('\nagreement with the ops board')
// Both routes must read the SAME operator-editable list. If someone points one of them at the
// hardcoded registry in lib/segments instead, these two drift apart again.
import { readFileSync } from 'node:fs'
const board = readFileSync(new URL('../app/api/ops-today/route.ts', import.meta.url), 'utf8')
const audits = readFileSync(new URL('../app/api/ops-today/audits-due/route.ts', import.meta.url), 'utf8')
for (const [label, src] of [['ops board', board], ['audits-due', audits]]) {
  ok(label + ' uses vendorRegex(presets.vendorBuildings)', /vendorRegex\(presets\.vendorBuildings\)/.test(src))
  ok(label + " uses the 'Vendor' bucket name", /VENDOR_MARKET = 'Vendor'/.test(src))
  ok(label + ' keeps an otherwise-empty geography alive', /geoHasOwnUnits/.test(src))
}
// And the panel must actually read market2, or the North rows are computed and then thrown away.
const panel = readFileSync(new URL('../components/TodayInOps.tsx', import.meta.url), 'utf8')
ok('the audits panel filters on market2 as well as market',
  /x\.market === market \|\| x\.market2 === market/.test(panel))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
