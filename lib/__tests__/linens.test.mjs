// node lib/__tests__/linens.test.mjs
//
// THE LINEN STANDARD AND ITS ARITHMETIC (Jon, 2026-09-29: "I create the standard, you just need to
// create a place where I can edit that or update it"). Plain node, no deps: lib/linens.ts has no
// imports on purpose and node >= 22.18 strips the TypeScript types itself, so this checks the very
// module the page and the API run.
const L = await import('../linens.ts')
const { DEFAULT_LINEN_STANDARD, defaultLinenStandard, normLinenStandard, linenNeeds, linenTotals, bedsFromGuestyRooms, bedsFromOnboarding, assumedBeds, normBeds, bedsLabel, linenCsv, linenText, priceFor,
  LINEN_TIERS, linenQuote, linenQuoteAllTiers, vendorOrder, vendorOrderCsv, quoteText, normManualUnit, manualUnits, linenDeckSection, normLinenQuotes, fmtUsd, tierOf, inTier,
  linenSummary, onboardingLinenUnit } = L

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)
const row = (rows, id, size) => rows.find(r => r.itemId === id && (size === undefined ? !r.size : r.size === size))

// The worked example: a 2BR (1 King + 1 Queen), 2 bath, sleeps 6.
const unit = { id: 'u1', name: 'Salato 302', building: 'Salato', bedrooms: 2, bathrooms: 2, guests: 6, beds: { King: 1, Queen: 1 }, bedsSource: 'saved' }
const std = defaultLinenStandard()

console.log('\nthe starting values')
eq('par starts at 3', std.par, 3)
eq('bed sizes', std.bedSizes, ['King', 'Queen', 'Full', 'Twin', 'Sofa bed'])
eq('item order, Bed → Bath → Kitchen → Other', std.items.map(i => i.id), [
  'mattress-protector', 'pillow-protectors', 'pillows', 'pillowcases', 'fitted-sheet', 'flat-sheet', 'duvet-insert', 'duvet-cover',
  'bath-towels', 'hand-towels', 'washcloths', 'makeup-cloths', 'bath-mat', 'pool-towels',
  'kitchen-towels', 'dish-cloths', 'oven-mitts', 'pot-holders',
  'throw-blanket', 'extra-blanket'])
ok('pool/beach towels start switched off', std.items.find(i => i.id === 'pool-towels').active === false)
ok('every other item starts active', std.items.filter(i => i.id !== 'pool-towels').every(i => i.active === true))
ok('defaults are a copy, not the shared object', std.items[0] !== DEFAULT_LINEN_STANDARD.items[0] && std.items[1].qtyBySize !== DEFAULT_LINEN_STANDARD.items[1].qtyBySize)

console.log('\n2BR · 1 King + 1 Queen · 2 bath · 6 guests')
const need = linenNeeds(std, unit)
// Rotation / par: qty × count × par for rotating items, × 1 for the rest.
eq('fitted sheet, King: 1 on the bed × par 3', row(need, 'fitted-sheet', 'King'), { itemId: 'fitted-sheet', name: 'Fitted sheet', group: 'Bed', size: 'King', perUnitQty: 1, par: 3, total: 3 })
eq('fitted sheet, Queen', row(need, 'fitted-sheet', 'Queen').total, 3)
eq('mattress protector uses its own par 2', [row(need, 'mattress-protector', 'King').par, row(need, 'mattress-protector', 'King').total], [2, 2])
eq('duvet insert does not rotate: one per bed', [row(need, 'duvet-insert', 'King').par, row(need, 'duvet-insert', 'King').total], [1, 1])
eq('duvet cover rotates', row(need, 'duvet-cover', 'Queen').total, 3)
// qtyBySize.
eq('pillows on a King: 4, no rotation', [row(need, 'pillows', 'King').perUnitQty, row(need, 'pillows', 'King').total], [4, 4])
eq('pillowcases on a Queen: 4 × par 3', row(need, 'pillowcases', 'Queen').total, 12)
eq('pillow protectors on a King: 4 × 3', row(need, 'pillow-protectors', 'King').total, 12)
ok('no rows for bed sizes the unit does not have', !need.some(r => r.size === 'Twin' || r.size === 'Full' || r.size === 'Sofa bed'))
// Per guest / per bathroom / per unit / per bedroom.
eq('bath towels: 1 × 6 guests × 3', row(need, 'bath-towels').total, 18)
eq('hand towels: 2 × 2 baths × 3', row(need, 'hand-towels').total, 12)
eq('makeup cloths: 1 × 6 × 3', row(need, 'makeup-cloths').total, 18)
eq('bath mat: 1 × 2 × 3', row(need, 'bath-mat').total, 6)
eq('kitchen towels: 4 × 3', row(need, 'kitchen-towels').total, 12)
eq('oven mitts do not rotate', row(need, 'oven-mitts').total, 2)
eq('throw blanket: 1 per bedroom', row(need, 'throw-blanket').total, 2)
// Inactive.
ok('inactive pool towels are skipped', !need.some(r => r.itemId === 'pool-towels'))
const poolOn = normLinenStandard({ ...std, items: std.items.map(i => i.id === 'pool-towels' ? { ...i, active: true } : i) })
eq('switched on, pool towels count per guest, one set', row(linenNeeds(poolOn, unit), 'pool-towels').total, 6)
// Global par change flows through everything that rotates and has no par of its own.
const par4 = normLinenStandard({ ...std, par: 4 })
eq('par 4: fitted sheet King = 4', row(linenNeeds(par4, unit), 'fitted-sheet', 'King').total, 4)
eq('par 4: mattress protector keeps its own par 2', row(linenNeeds(par4, unit), 'mattress-protector', 'King').total, 2)
eq('par 4: duvet insert still 1', row(linenNeeds(par4, unit), 'duvet-insert', 'King').total, 1)

console.log('\nbathrooms, bedrooms and studios')
eq('2.5 baths count as 3 for per-bathroom items', row(linenNeeds(std, { ...unit, bathrooms: 2.5 }), 'hand-towels').total, 18)
eq('a studio still gets one throw blanket', row(linenNeeds(std, { ...unit, bedrooms: 0 }), 'throw-blanket').total, 1)
ok('no guest count → no per-guest rows (not a guess)', !linenNeeds(std, { ...unit, guests: 0 }).some(r => r.itemId === 'bath-towels'))
const sized = normLinenStandard({ ...std, bedSizes: [...std.bedSizes, 'Cal King'] })
eq('a size with no qtyBySize entry falls back to the item qty', row(linenNeeds(sized, { ...unit, beds: { 'Cal King': 1 } }), 'pillows', 'Cal King').perUnitQty, 2)

console.log('\ntotals across units')
const t = linenTotals(std, [unit, { ...unit, id: 'u2', name: 'Salato 602' }, { ...unit, id: 'u3', name: 'Salato 902' }])
eq('three identical units triple the King fitted sheets', t.rows.find(r => r.key === 'fitted-sheet|King').qty, 9)
eq('bath towels merged', t.rows.find(r => r.key === 'bath-towels|').qty, 54)
eq('no prices yet → no cost, no total', [t.grandTotal, t.priced, t.unpriced > 0, t.rows.every(r => r.cost === null)], [0, 0, true, true])
eq('rows come out Bed → Bath → Kitchen → Other', [...new Set(t.rows.map(r => r.group))], ['Bed', 'Bath', 'Kitchen', 'Other'])
eq('King before Queen within an item', t.rows.filter(r => r.itemId === 'pillows').map(r => r.size), ['King', 'Queen'])
const priced = normLinenStandard({ ...std, items: std.items.map(i => i.id === 'bath-towels' ? { ...i, price: 7.5, vendor: 'Complete Jantex' } : i.id === 'fitted-sheet' ? { ...i, price: 10, priceBySize: { King: 14 } } : i) })
const tp = linenTotals(priced, [unit])
eq('bath towels priced: 18 × 7.50', tp.rows.find(r => r.key === 'bath-towels|').cost, 135)
eq('King sheet at its own size price', tp.rows.find(r => r.key === 'fitted-sheet|King').cost, 42)
eq('Queen sheet at the item price', tp.rows.find(r => r.key === 'fitted-sheet|Queen').cost, 30)
eq('grand total adds the priced rows only', tp.grandTotal, 207)
eq('priced rows counted', tp.priced, 3)
eq('vendor carried to the row', tp.rows.find(r => r.key === 'bath-towels|').vendor, 'Complete Jantex')
eq('priceFor with no price', priceFor({}, 'King'), null)
ok('CSV has a header, a row per line and the total', (() => { const c = linenCsv(tp).trim().split('\n'); return c[0].startsWith('Group,Item,Size,Qty') && c.length === tp.rows.length + 2 && c[c.length - 1].includes('207') })())
ok('CSV defuses a formula-looking name', linenCsv(linenTotals(normLinenStandard({ par: 1, items: [{ name: '=HYPERLINK("x")', group: 'Other', per: 'unit', qty: 1 }] }), [unit])).includes(`"'=HYPERLINK(""x"")"`))
ok('copy text lists quantities by group', (() => { const s = linenText(t, 'Salato'); return s.startsWith('Salato\n\nBed\n6 × Mattress protector (King)\n') && s.includes('\nBath\n54 × Bath towels\n') })(), linenText(t, 'Salato').slice(0, 80))

console.log('\nnormLinenStandard refuses junk')
eq('not an object → the starting values', normLinenStandard('junk').items.length, DEFAULT_LINEN_STANDARD.items.length)
eq('null → the starting values', normLinenStandard(null).par, 3)
eq('an array → the starting values', normLinenStandard([1, 2]).bedSizes, ['King', 'Queen', 'Full', 'Twin', 'Sofa bed'])
const junk = normLinenStandard({
  par: 5000, bedSizes: ['  King ', 'king', '', 42, 'x'.repeat(80), null], hacker: true, updatedAt: 'not a date', updatedBy: ' jon@stay-hospitality.com ',
  items: [
    null, 'string', { name: '' }, { name: '   ' },
    { id: 'a b c', name: '  Fitted   sheet ', group: 'Nope', per: 'room', qty: -4, par: 'lots', price: '$12.50', rotates: 'yes', evil: '<script>', qtyBySize: { King: 2 } },
    { id: 'dup', name: 'One', group: 'Bed', per: 'bed', qty: 1e9, qtyBySize: { King: 'x', Queen: 3, '': 4 }, priceBySize: { King: -5 }, rotates: true, par: 2.6 },
    { id: 'dup', name: 'Two', group: 'Bath', per: 'guest', qty: '2', active: false, notes: 'n'.repeat(500) },
  ],
})
eq('par clamped to 999', junk.par, 999)
eq('sizes trimmed, de-duplicated, blank and non-strings dropped, long ones capped', junk.bedSizes, ['King', '42', 'x'.repeat(30)])
ok('unknown top-level keys dropped', !('hacker' in junk))
ok('a bad date is not kept; the name is trimmed', !('updatedAt' in junk) && junk.updatedBy === 'jon@stay-hospitality.com')
eq('nameless and non-object items dropped', junk.items.length, 3)
const [a, b, c] = junk.items
eq('bad group → Other, bad per → unit, negative qty → 0', [a.group, a.per, a.qty], ['Other', 'unit', 0])
eq('a bad id is rebuilt from the name', a.id, 'fitted-sheet')
eq('a name with runs of spaces is tidied', a.name, 'Fitted sheet')
// Item-level prices are the pre-tier shape: they are read as the Mid tier's (see "tiers" below).
eq('"$12.50" reads as 12.5 (into Mid); "lots" is no par', [a.tiers.mid.price, 'par' in a, 'price' in a], [12.5, false, false])
ok('rotates must be a real true', a.rotates === false)
ok('unknown item keys dropped; qtyBySize dropped off a non-bed item', !('evil' in a) && !('qtyBySize' in a))
eq('qty clamped to 999; bad size values dropped; negative price → 0', [b.qty, b.qtyBySize, b.tiers.mid.priceBySize], [999, { Queen: 3 }, { King: 0 }])
eq('par rounded to a whole set', b.par, 3)
eq('a duplicate id is made unique', c.id, 'dup-2')
eq('a numeric string qty reads', c.qty, 2)
ok('active:false kept, notes capped at 300', c.active === false && c.notes.length === 300)
eq('an empty items list is kept (it is what was saved)', normLinenStandard({ par: 3, items: [] }).items, [])
eq('items not a list → the starting items', normLinenStandard({ par: 2, items: 'x' }).items.length, DEFAULT_LINEN_STANDARD.items.length)
eq('the list is capped at 200 items', normLinenStandard({ items: Array.from({ length: 260 }, (_, i) => ({ name: 'Item ' + i })) }).items.length, 200)
eq('a round trip is stable', normLinenStandard(JSON.parse(JSON.stringify(std))), std)

console.log('\nwhere beds come from')
eq('Guesty listing rooms', bedsFromGuestyRooms([
  { roomNumber: 0, beds: [{ type: 'SOFA_BED', quantity: 1 }] },
  { roomNumber: 1, beds: [{ type: 'KING_BED', quantity: 1 }] },
  { roomNumber: 2, beds: [{ type: 'QUEEN_BED', quantity: 2 }, { type: 'AIR_MATTRESS', quantity: 1 }, { type: 'CRIB' }] },
  { roomNumber: 3, beds: [{ type: 'double_bed' }, { type: 'SINGLE_BED', quantity: 2 }, { type: 'BUNK_BED', quantity: 1 }] },
]), { 'Sofa bed': 1, King: 1, Queen: 2, Full: 1, Twin: 4 })
eq('no rooms / junk → nothing', [bedsFromGuestyRooms(null), bedsFromGuestyRooms([{ beds: 'x' }, 5]), bedsFromGuestyRooms([{ beds: [{ type: 'KING_BED', quantity: 0 }] }])], [{}, {}, {}])
eq('onboarding pre-form', bedsFromOnboarding({ beds: { master_bedroom: ['king'], bedroom_2: ['queen', 'bunk', 'crib'] }, sleeperSofa: 1 }), { King: 1, Queen: 1, Twin: 2, 'Sofa bed': 1 })
eq('assumed: one Queen per bedroom', assumedBeds(3), { Queen: 3 })
eq('assumed: a studio is one Queen', assumedBeds(0), { Queen: 1 })
eq('saved beds: whole counts, zeros and junk dropped', normBeds({ King: '1', Queen: 2.4, Twin: 0, Full: -1, '': 3, Sofa: 'x' }), { King: 1, Queen: 2 })
eq('beds label in size order', bedsLabel({ Queen: 2, King: 1 }), 'King ×1, Queen ×2')

// ══ TIERS, CASES AND THE TWO BILLS (Jon, 2026-09-30: "three different tiers: low, mid, and luxury…
// It should also know how the ordering works. Some of these items have to be bulk ordered.") ══════
const pack = (s, id, t = 'mid') => tierOf(s.items.find(i => i.id === id), t).packSize

console.log('\nstarting tiers')
eq('three tiers, labelled Low / Mid / Luxury', [LINEN_TIERS, std.tierLabels], [['low', 'mid', 'lux'], { low: 'Low', mid: 'Mid', lux: 'Luxury' }])
eq('no vendors, no markup, no tax to start', [std.vendors, std.markupPct, std.taxPct], [[], 0, 0])
ok('every item has all three tiers', std.items.every(i => LINEN_TIERS.every(t => i.tiers[t] && i.tiers[t].product)))
ok('no starting price and no starting vendor anywhere', std.items.every(i => LINEN_TIERS.every(t => !('price' in i.tiers[t]) && !('priceBySize' in i.tiers[t]) && !('vendor' in i.tiers[t]))))
for (const id of ['bath-towels', 'hand-towels', 'washcloths', 'makeup-cloths', 'bath-mat', 'pillowcases', 'fitted-sheet', 'flat-sheet', 'pillow-protectors', 'kitchen-towels', 'dish-cloths']) eq(`${id} sold by the dozen`, pack(std, id), 12)
for (const id of ['mattress-protector', 'duvet-cover']) eq(`${id} sold by the half-dozen`, pack(std, id), 6)
for (const id of ['pillows', 'duvet-insert', 'throw-blanket', 'extra-blanket', 'oven-mitts', 'pot-holders', 'pool-towels']) eq(`${id} sold singly`, pack(std, id), 1)
eq('sheets step up by thread count', LINEN_TIERS.map(t => tierOf(std.items.find(i => i.id === 'fitted-sheet'), t).product), ['T-180 poly-cotton', 'T-300 cotton percale', 'T-400+ cotton sateen'])
ok('pack sizes are the same at every tier to start', std.items.every(i => i.tiers.low.packSize === i.tiers.mid.packSize && i.tiers.mid.packSize === i.tiers.lux.packSize))

console.log('\na standard saved before tiers (2026-09-29) keeps its prices, as Mid')
const legacy = normLinenStandard({
  par: 3, bedSizes: ['King', 'Queen'],
  items: [
    { id: 'fitted-sheet', name: 'Fitted sheet', group: 'Bed', per: 'bed', qty: 1, rotates: true, vendor: 'Complete Jantex', sku: 'FS-1', price: 10, priceBySize: { King: 14 } },
    { id: 'bath-towels', name: 'Bath towels', group: 'Bath', per: 'guest', qty: 1, rotates: true, price: 7.5 },
    { id: 'robe', name: 'Robe', group: 'Bath', per: 'guest', qty: 1, rotates: false, price: 20, vendor: 'Robes Inc' },
    { id: 'mug', name: 'Mug', group: 'Kitchen', per: 'unit', qty: 2 },
  ],
})
const lf = legacy.items[0]
eq('item-level vendor/SKU/price/per-size price move into Mid', [lf.tiers.mid.vendor, lf.tiers.mid.sku, lf.tiers.mid.price, lf.tiers.mid.priceBySize], ['Complete Jantex', 'FS-1', 10, { King: 14 }])
ok('nothing left at item level', !['vendor', 'sku', 'price', 'priceBySize'].some(k => k in lf))
eq('a known item picks up the starting products and pack sizes', [lf.tiers.low.product, lf.tiers.mid.product, lf.tiers.lux.packSize], ['T-180 poly-cotton', 'T-300 cotton percale', 12])
ok('the migrated Low and Luxury tiers carry no price', !('price' in lf.tiers.low) && !('price' in lf.tiers.lux))
eq('a custom item gets Mid only', legacy.items[2].tiers, { mid: { vendor: 'Robes Inc', price: 20 } })
eq('an item with nothing to migrate has empty tiers', legacy.items[3].tiers, {})
eq('the migrated standard round-trips unchanged', normLinenStandard(JSON.parse(JSON.stringify(legacy))), legacy)
eq('old prices still price the old buy list (Mid is the default tier)', linenTotals(legacy, [unit]).rows.find(r => r.key === 'fitted-sheet|King').cost, 42)
eq('a Mid value already set wins over an item-level one', normLinenStandard({ items: [{ name: 'X', per: 'unit', qty: 1, price: 9, tiers: { mid: { price: 12 } } }] }).items[0].tiers.mid.price, 12)
eq('an item that has tiers is not re-seeded with starting hints', normLinenStandard({ items: [{ id: 'fitted-sheet', name: 'Fitted sheet', group: 'Bed', per: 'bed', qty: 1, tiers: {} }] }).items[0].tiers, {})

console.log('\ntier values are cleaned like everything else')
const tj = normLinenStandard({
  tierLabels: { low: '  Value ', mid: '', lux: 'L'.repeat(50), ultra: 'x' }, markupPct: '15%', taxPct: 500,
  vendors: [{ name: ' Complete Jantex ', minOrder: '$500', leadDays: 5.6, email: 'orders@example.com', orderVia: 'Portal' }, { name: 'complete jantex' }, { name: '' }, 'x', { name: 'B', minOrder: -3, leadDays: 'soon' }],
  items: [
    { id: 't', name: 'Towel', group: 'Bath', per: 'guest', qty: 1, tiers: {
      low: { packSize: 0, minCases: -3, off: 'yes', product: 'p'.repeat(200), priceBySize: { King: 3 } },
      mid: { packSize: 12.4, minCases: 2.2, off: true, price: '4.25' },
      ultra: { price: 1 },
    } },
  ],
})
eq('tier labels: trimmed, blank → default, capped at 30', tj.tierLabels, { low: 'Value', mid: 'Mid', lux: 'L'.repeat(30) })
eq('markup "15%" reads as 15; tax clamped to 100', [tj.markupPct, tj.taxPct], [15, 100])
eq('negative markup → 0', normLinenStandard({ markupPct: -5 }).markupPct, 0)
eq('vendors: trimmed, de-duplicated by name, nameless dropped', tj.vendors.map(v => v.name), ['Complete Jantex', 'B'])
eq('vendor minimum and lead time read as numbers', [tj.vendors[0].minOrder, tj.vendors[0].leadDays, tj.vendors[0].orderVia], [500, 6, 'Portal'])
ok('a negative minimum and a word for lead time are dropped', !('minOrder' in tj.vendors[1]) && !('leadDays' in tj.vendors[1]))
eq('vendor list capped at 30', normLinenStandard({ vendors: Array.from({ length: 40 }, (_, i) => ({ name: 'V' + i })) }).vendors.length, 30)
const tt = tj.items[0].tiers
eq('pack 0 and negative min cases dropped; "yes" is not off; product capped; per-size price only on a per-bed item', tt.low, { product: 'p'.repeat(120) })
eq('pack and min cases rounded to whole numbers; off kept', tt.mid, { price: 4.25, packSize: 12, minCases: 2, off: true })
ok('an unknown tier is dropped', !('ultra' in tt))

console.log('\nitems left out of a tier')
const offLux = normLinenStandard({ ...std, items: std.items.map(i => i.id === 'bath-towels' ? { ...i, tiers: { ...i.tiers, lux: { ...i.tiers.lux, off: true } } } : i) })
const bt = offLux.items.find(i => i.id === 'bath-towels')
ok('off at Luxury, still in at Mid', !inTier(bt, 'lux') && inTier(bt, 'mid'))
ok('the Luxury buy list has no bath towels', !linenTotals(offLux, [unit], 'lux').rows.some(r => r.itemId === 'bath-towels'))
eq('the Luxury quote names what it leaves out', linenQuote(offLux, [unit], 'lux').off, [{ itemId: 'bath-towels', name: 'Bath towels' }])
eq('Mid still counts them', linenQuote(offLux, [unit], 'mid').rows.find(r => r.itemId === 'bath-towels').qty, 18)
ok('a switched-off item is not listed as left out of a tier', !linenQuote(std, [unit], 'lux').off.some(o => o.itemId === 'pool-towels'))

// One item, one vendor: the case arithmetic on its own.
const oneItem = (opt, extra = {}) => normLinenStandard({ par: 3, items: [{ id: 'wc', name: 'Washcloths', group: 'Bath', per: 'guest', qty: 1, rotates: false, tiers: { mid: { vendor: 'Complete Jantex', price: 0.5, packSize: 12, ...opt } } }], ...extra })
const guests = (n) => [{ ...unit, guests: n }]

console.log('\nwhole cases')
const vo7 = vendorOrder(oneItem({}), guests(7), 'mid').groups[0].lines[0]
eq('7 washcloths, dozen pack → 1 case, 12 ordered, 5 to stock', [vo7.piecesNeeded, vo7.cases, vo7.piecesOrdered, vo7.overage], [7, 1, 12, 5])
eq('case price and cost: 12 × $0.50 = $6', [vo7.casePrice, vo7.cost], [6, 6])
const vo13 = vendorOrder(oneItem({}), guests(13), 'mid').groups[0].lines[0]
eq('13 → 2 cases, 24 ordered, 11 to stock', [vo13.cases, vo13.piecesOrdered, vo13.overage], [2, 24, 11])
const vo12 = vendorOrder(oneItem({}), guests(12), 'mid').groups[0].lines[0]
eq('12 → exactly 1 case, nothing to stock', [vo12.cases, vo12.overage], [1, 0])
eq('no guests → no line to order', vendorOrder(oneItem({}), guests(0), 'mid').groups.length, 0)
const single = vendorOrder(oneItem({ packSize: undefined }), guests(7), 'mid').groups[0].lines[0]
eq('no pack size = sold singly: 7 needed, 7 ordered', [single.packSize, single.cases, single.piecesOrdered, single.overage], [1, 7, 7, 0])
const minC = vendorOrder(oneItem({ minCases: 3 }), guests(7), 'mid').groups[0].lines[0]
eq('minimum 3 cases: 7 needed → 3 cases, 36 ordered, 29 to stock', [minC.cases, minC.piecesOrdered, minC.overage], [3, 36, 29])
const minMet = vendorOrder(oneItem({ minCases: 3 }), guests(40), 'mid').groups[0].lines[0]
eq('a minimum below the need changes nothing: 40 → 4 cases', minMet.cases, 4)

console.log('\nthe owner pays for pieces, the vendor is paid for cases')
const q7 = linenQuote(oneItem({}), guests(7), 'mid')
eq('owner: 7 pieces × $0.50 = $3.50', [q7.pieces, q7.subtotal, q7.total], [7, 3.5, 3.5])
eq('vendor: 1 case = $6.00', vendorOrder(oneItem({}), guests(7), 'mid').total, 6)

console.log('\nmarkup and tax')
const flat = (m, t) => normLinenStandard({ par: 1, markupPct: m, taxPct: t, items: [{ id: 'k', name: 'Kit', group: 'Other', per: 'unit', qty: 4, tiers: { mid: { price: 25 } } }] })
const qm = linenQuote(flat(10, 7), [unit], 'mid')
eq('4 × $25 = $100; 10% markup = $10; 7% tax on $110 = $7.70; total $117.70', [qm.subtotal, qm.markup, qm.tax, qm.total], [100, 10, 7.7, 117.7])
eq('the percentages ride on the quote', [qm.markupPct, qm.taxPct], [10, 7])
const q0 = linenQuote(flat(0, 0), [unit], 'mid')
eq('no markup, no tax → total is the subtotal', [q0.markup, q0.tax, q0.total], [0, 0, 100])
const qt = linenQuote(flat(0, 7), [unit], 'mid')
eq('tax only: 7% of $100', [qt.tax, qt.total], [7, 107])
const qUn = linenQuote(normLinenStandard({ par: 1, markupPct: 10, taxPct: 7, items: [{ name: 'A', per: 'unit', qty: 1, tiers: { mid: { price: 10 } } }, { name: 'B', per: 'unit', qty: 2 }] }), [unit], 'mid')
eq('unpriced lines are counted, never priced at $0', [qUn.priced, qUn.unpriced, qUn.subtotal, qUn.rows.find(r => r.name === 'B').cost], [1, 1, 10, null])
const cents = linenQuote(normLinenStandard({ par: 1, markupPct: 12.5, taxPct: 7, items: [{ name: 'A', per: 'unit', qty: 3, tiers: { mid: { price: 3.33 } } }] }), [unit], 'mid')
eq('money rounds to cents at each step: $9.99 + 12.5% = $1.25; tax 7% of $11.24 = $0.79', [cents.subtotal, cents.markup, cents.tax, cents.total], [9.99, 1.25, 0.79, 12.03])

console.log('\nvendors and minimums')
const vstd = (min, price) => normLinenStandard({
  par: 3,
  vendors: [{ name: 'Complete Jantex', minOrder: min, leadDays: 5, orderVia: 'Rep: email the order' }],
  items: [
    { id: 'bt', name: 'Bath towels', group: 'Bath', per: 'guest', qty: 1, rotates: true, tiers: { mid: { vendor: 'complete jantex', sku: 'BT-27', price, packSize: 12 } } },
    { id: 'ht', name: 'Hand towels', group: 'Bath', per: 'bathroom', qty: 2, rotates: true, tiers: { mid: { vendor: 'Complete Jantex', sku: 'HT-16', price: 2, packSize: 12 } } },
    { id: 'km', name: 'Oven mitts', group: 'Kitchen', per: 'unit', qty: 2, rotates: false, tiers: { mid: { price: 6 } } },
  ],
})
const vo = vendorOrder(vstd(500, 7.5), [unit], 'mid')
eq('two groups: the vendor, then "no vendor set" last', vo.groups.map(g => g.vendor), ['Complete Jantex', null])
const cj = vo.groups[0]
eq('the vendor name matches its card case-insensitively and takes the card\'s spelling', [cj.vendor, cj.info && cj.info.orderVia], ['Complete Jantex', 'Rep: email the order'])
// 18 bath towels → 2 cases (24) × 12 × 7.50 = $180; 12 hand towels → 1 case × 12 × $2 = $24 → $204
eq('vendor subtotal: 2 cases of bath towels + 1 of hand towels = $204', cj.subtotal, 204)
eq('below its $500 minimum by $296, 5 days lead', [cj.belowMinimum, cj.shortBy, cj.minOrder, cj.leadDays], [true, 296, 500, 5])
eq('pieces needed vs ordered vs to stock', [cj.piecesNeeded, cj.piecesOrdered, cj.overage], [30, 36, 6])
eq('meeting the minimum clears the flag', vendorOrder(vstd(500, 25), [unit], 'mid').groups[0].belowMinimum, false)
eq('no minimum on the card → never flagged', vendorOrder(vstd(null, 7.5), [unit], 'mid').groups[0].belowMinimum, false)
eq('the no-vendor group has no card, no minimum', [vo.groups[1].info, vo.groups[1].minOrder, vo.groups[1].belowMinimum], [null, null, false])
eq('order total adds every group (oven mitts sold singly: 2 × $6)', vo.total, 204 + 12)
const vn = vendorOrder(vstd(500, null), [unit], 'mid').groups[0]
eq('an unpriced line has no case price or cost and is counted', [vn.lines[0].casePrice, vn.lines[0].cost, vn.unpriced, vn.priced], [null, null, 1, 1])

console.log('\nmany units, one order')
const salato = [unit, { ...unit, id: 'u2', name: 'Salato 602' }, { ...unit, id: 'u3', name: 'Salato 902' }]
const pooled = vendorOrder(vstd(500, 7.5), salato, 'mid').groups[0].lines.find(l => l.itemId === 'bt')
eq('54 bath towels pooled across 3 units → 5 cases (60), 6 to stock', [pooled.piecesNeeded, pooled.cases, pooled.piecesOrdered, pooled.overage], [54, 5, 60, 6])
ok('pooling beats per-unit rounding (3 × 2 cases = 72)', pooled.piecesOrdered < 72)
const q3 = linenQuote(vstd(500, 7.5), salato, 'mid')
eq('the owner quote for 3 units: 54 × $7.50 + 36 × $2 + 6 × $6', q3.subtotal, 54 * 7.5 + 36 * 2 + 6 * 6)
const sameSku = normLinenStandard({ par: 3, items: [
  { id: 'a', name: 'Hand towels', group: 'Bath', per: 'bathroom', qty: 2, rotates: true, tiers: { mid: { vendor: 'V', sku: 'TW-1', price: 2, packSize: 12 } } },
  { id: 'b', name: 'Gym towels', group: 'Bath', per: 'unit', qty: 2, rotates: true, tiers: { mid: { vendor: 'V', sku: 'tw-1', price: 2, packSize: 12 } } },
] })
const ss = vendorOrder(sameSku, [unit], 'mid').groups[0].lines
eq('two items on the same vendor SKU are one line: 12 + 6 = 18 → 2 cases', [ss.length, ss[0].name, ss[0].piecesNeeded, ss[0].cases], [1, 'Hand towels / Gym towels', 18, 2])
const sheetsBySize = normLinenStandard({ par: 3, items: [{ id: 'fs', name: 'Fitted sheet', group: 'Bed', per: 'bed', qty: 1, rotates: true, tiers: { mid: { vendor: 'V', sku: 'FS', price: 10, priceBySize: { King: 14 }, packSize: 12 } } }] })
const sb = vendorOrder(sheetsBySize, salato, 'mid').groups[0].lines
eq('bed sizes stay separate lines, each at its own size price', sb.map(l => [l.size, l.piecesNeeded, l.cases, l.casePrice, l.cost]), [['King', 9, 1, 168, 168], ['Queen', 9, 1, 120, 120]])

console.log('\nthree tiers side by side')
const priced3 = normLinenStandard({ ...std, tierLabels: { lux: 'Premium' }, items: std.items.map(i => i.id === 'bath-towels' ? { ...i, tiers: { low: { ...i.tiers.low, price: 5 }, mid: { ...i.tiers.mid, price: 7.5 }, lux: { ...i.tiers.lux, price: 12 } } } : i) })
const all3 = linenQuoteAllTiers(priced3, [unit])
eq('low / mid / lux totals for 18 bath towels', LINEN_TIERS.map(t => all3[t].total), [90, 135, 216])
eq('labels come from the standard', LINEN_TIERS.map(t => all3[t].label), ['Low', 'Mid', 'Premium'])
eq('the same pieces at every tier', LINEN_TIERS.map(t => all3[t].pieces), [all3.low.pieces, all3.low.pieces, all3.low.pieces])
eq('product carried to the rows', all3.lux.rows.find(r => r.key === 'fitted-sheet|King').product, 'T-400+ cotton sateen')

console.log('\na unit with no listing')
const m = normManualUnit({ name: '  Salato 302 ', bedrooms: '2', bathrooms: 2.3, guests: 6.4, beds: { King: 1, Queen: '1', Twin: 0 }, copies: 3 })
eq('typed in: bedrooms, halves of a bath, whole guests, beds', [m.unit.name, m.unit.bedrooms, m.unit.bathrooms, m.unit.guests, m.unit.beds, m.unit.bedsSource], ['Salato 302', 2, 2.5, 6, { King: 1, Queen: 1 }, 'manual'])
eq('3 identical units', m.copies, 3)
const mj = normManualUnit({ bedrooms: 99, bathrooms: -2, guests: -5, beds: { King: 50 }, copies: 0 }, 4)
eq('clamped: 20 bedrooms, 0 baths, 0 guests, 20 beds a size, at least 1 copy, a default name', [mj.unit.bedrooms, mj.unit.bathrooms, mj.unit.guests, mj.unit.beds, mj.copies, mj.unit.name], [20, 0, 0, { King: 20 }, 1, 'Unit 5'])
eq('copies stop at 200', normManualUnit({ copies: 500 }).copies, 200)
eq('junk is an empty studio', normManualUnit('junk').unit, { id: 'manual-1', name: 'Unit', bedrooms: 0, bathrooms: 0, guests: 0, beds: {}, bedsSource: 'manual' })
const mu = manualUnits([{ name: 'Salato 302', bedrooms: 2, bathrooms: 2, guests: 6, beds: { King: 1, Queen: 1 }, copies: 3 }, { name: 'B', copies: 2 }])
eq('copies expand: 5 units, labelled', [mu.units.length, mu.requested, mu.labels], [5, 5, ['Salato 302 ×3', 'B ×2']])
ok('copies have their own ids', new Set(mu.units.map(u => u.id)).size === 5)
const big = manualUnits([{ copies: 150 }, { copies: 100 }])
eq('more than 200 asked: capped at 200, and the ask is reported', [big.units.length, big.requested], [200, 250])
eq('not a list → nothing', manualUnits('x'), { units: [], requested: 0, labels: [] })
eq('a typed-in unit quotes exactly like the same unit from a listing', linenQuote(priced3, [normManualUnit({ bedrooms: 2, bathrooms: 2, guests: 6, beds: { King: 1, Queen: 1 } }).unit], 'mid').rows.map(r => [r.key, r.qty]), linenQuote(priced3, [unit], 'mid').rows.map(r => [r.key, r.qty]))
eq('3 typed-in copies = the Salato three', linenQuote(priced3, manualUnits([{ bedrooms: 2, bathrooms: 2, guests: 6, beds: { King: 1, Queen: 1 }, copies: 3 }]).units, 'mid').total, linenQuote(priced3, salato, 'mid').total)

console.log('\nthe onboarding deck slide')
eq('nothing priced → no slide', linenDeckSection(std, [unit], null), null)
eq('no units → no slide', linenDeckSection(priced3, [], null), null)
const deck = linenDeckSection(priced3, [unit], 'mid')
eq('three tiers, Mid chosen', [deck.tiers.map(t => t.label), deck.tiers.map(t => t.chosen), deck.chosen], [['Low', 'Mid', 'Premium'], [false, true, false], 'mid'])
eq('totals as money', deck.tiers.map(t => t.total), ['$90.00', '$135.00', '$216.00'])
eq('the product line for each key item', deck.tiers[2].lines.map(l => l.k + ': ' + l.v), ['Sheets: T-400+ cotton sateen', 'Duvet cover: T-400+ cotton sateen, white', 'Pillows: Hotel down-alternative, cluster fill', 'Towels: Ring-spun cotton, 650+ GSM'])
ok('the subtitle names the beds', deck.subtitle.includes('1 King and 1 Queen'), deck.subtitle)
ok('the note names the par, true to per-item pars', deck.note.includes('3 sets') && !/markup/i.test(deck.note), deck.note)
ok('unpriced lines are named on the tier, not hidden', /to be priced/.test(deck.tiers[1].sub), deck.tiers[1].sub)
const onlyMid = normLinenStandard({ ...std, items: std.items.map(i => i.id === 'bath-towels' ? { ...i, tiers: { ...i.tiers, mid: { ...i.tiers.mid, price: 7.5 } } } : i) })
eq('a tier with no price says so instead of $0', linenDeckSection(onlyMid, [unit], null).tiers.map(t => t.total), ['To be priced', '$135.00', 'To be priced'])
eq('three units: the pieces are across them', linenDeckSection(priced3, salato, null).tiers[0].sub.includes('across 3 units'), true)

console.log('\nthe onboarding desk one-liner')
const obRow = { code: 'ab12cd34', name: 'Salato 302', building: 'Salato', listing_id: null, details: { bedrooms: 2, bathrooms: 2, occupancy: 6, beds: { master_bedroom: ['king'], bedroom_2: ['queen'] } } }
const ou = onboardingLinenUnit(obRow, {})
eq('beds from the walk, baths and guests from the pre-form', [ou.id, ou.beds, ou.bedsSource, ou.bathrooms, ou.guests], ['onboard:ab12cd34', { King: 1, Queen: 1 }, 'onboarding', 2, 6])
eq('beds saved on the linen page win', onboardingLinenUnit(obRow, { 'onboard:ab12cd34': { Twin: 2 } }).beds, { Twin: 2 })
eq('an assigned unit reads the beds saved for its listing', onboardingLinenUnit({ ...obRow, listing_id: 'L1' }, { L1: { King: 2 } }).beds, { King: 2 })
eq('no walk beds → one Queen per bedroom', [onboardingLinenUnit({ ...obRow, details: { bedrooms: 3 } }, {}).beds, onboardingLinenUnit({ ...obRow, details: { bedrooms: 3 } }, {}).bedsSource], [{ Queen: 3 }, 'assumed'])
eq('junk row → an empty studio, not a crash', onboardingLinenUnit(null, null).beds, { Queen: 1 })
const sum = linenSummary(priced3, ou, 'lux')
eq('three totals and the chosen tier', [LINEN_TIERS.map(t => sum.tiers[t].total), sum.chosen, sum.tiers.lux.label, sum.beds], [[90, 135, 216], 'lux', 'Premium', 'King ×1, Queen ×1'])
eq('nothing priced: zero priced lines, so the page shows a tag, not $0', linenSummary(std, ou, null).tiers.mid.priced, 0)

console.log('\nthe tier chosen per onboarding unit')
eq('valid entries kept, codes lower-cased; bad codes and tiers dropped', normLinenQuotes({
  'ab12cd34': { tier: 'lux', updatedAt: '2026-09-30T12:00:00Z', updatedBy: 'someone@example.com' },
  'AB12CD99': { tier: 'low' }, 'onboard:ab12cd34': { tier: 'mid' }, 'zz': { tier: 'mid' }, 'ab12cd35': { tier: 'ultra' }, 'ab12cd36': 'mid',
}), { ab12cd34: { tier: 'lux', updatedAt: '2026-09-30T12:00:00Z', updatedBy: 'someone@example.com' }, ab12cd99: { tier: 'low' } })
eq('junk → empty', [normLinenQuotes(null), normLinenQuotes([1])], [{}, {}])

console.log('\ntext and CSV')
eq('money formats as $1,234.56', [fmtUsd(1234.5), fmtUsd(0), fmtUsd(7)], ['$1,234.50', '$0.00', '$7.00'])
const txt = quoteText(qm, 'Salato 302')
ok('quote text: markup folded into the lines, no markup line, same total', txt.startsWith('Salato 302 — Mid linen package\n\nOther\n4 × Kit — $110.00\n') && !/markup/i.test(txt) && txt.includes('Tax (7%) $7.70') && txt.includes('Total $117.70'), txt)
ok('quote text names unpriced lines', quoteText(qUn).includes('1 line still to be priced'))
const vcsv = vendorOrderCsv(vo).trim().split('\n')
eq('vendor CSV header', vcsv[0], 'Vendor,SKU,Item,Product,Size,Pieces needed,Pieces per case,Cases,Pieces ordered,To stock,Case price,Amount')
eq('vendor CSV: a line, its numbers', vcsv[1], 'Complete Jantex,BT-27,Bath towels,,,18,12,2,24,6,90,180')
ok('vendor CSV: a subtotal per vendor, the unvendored group named, the order total last', vcsv.some(l => l.startsWith('Complete Jantex,,Subtotal,')) && vcsv.some(l => l.startsWith('No vendor set,')) && vcsv[vcsv.length - 1].startsWith(',,Order total,'))
ok('vendor CSV defuses a formula-looking SKU', vendorOrderCsv(vendorOrder(normLinenStandard({ items: [{ name: 'X', per: 'unit', qty: 1, tiers: { mid: { sku: '=cmd()', vendor: 'V' } } }] }), [unit], 'mid')).includes("'=cmd()"))

// ── review fixes (2026-09-30) ──
{
  const L = await import('../linens.ts')
  // A shared SKU on different terms stays two lines, each on its own terms.
  const st = L.normLinenStandard({ par: 1, items: [
    { id: 'fs', name: 'Fitted sheet', group: 'Bed', per: 'unit', qty: 12, rotates: false, tiers: { mid: { vendor: 'V', sku: 'SAME', price: 10, packSize: 12 } } },
    { id: 'ff', name: 'Flat sheet', group: 'Bed', per: 'unit', qty: 12, rotates: false, tiers: { mid: { vendor: 'V', sku: 'same', price: 20, packSize: 6, minCases: 3 } } },
  ] })
  const u1 = { id: 'u', name: 'U', bedrooms: 1, bathrooms: 1, guests: 2, beds: { Queen: 1 }, bedsSource: 'manual' }
  const o = L.vendorOrder(st, [u1], 'mid')
  eq('same SKU, different terms: two lines', o.groups[0].lines.length, 2)
  eq('each on its own terms', o.groups[0].lines.map(l => l.cost), [120, 360])
  ok('the conflict is tagged', o.groups[0].lines.every(l => !!l.conflict))
  // An unpriced vendor is never "below minimum".
  const up = L.normLinenStandard({ vendors: [{ name: 'V', minOrder: 500 }], items: [{ id: 'x', name: 'X', per: 'unit', qty: 1, tiers: { mid: { vendor: 'V' } } }] })
  eq('no minimum flag with nothing priced', L.vendorOrder(up, [u1], 'mid').groups[0].belowMinimum, false)
  // Price per piece keeps 4 decimals: a $41.99 case of 12 prints back as $41.99.
  const pr = L.normLinenStandard({ items: [{ id: 'w', name: 'Washcloths', per: 'unit', qty: 12, tiers: { mid: { vendor: 'V', price: 41.99 / 12, packSize: 12 } } }] })
  eq('case price round-trips', L.vendorOrder(pr, [u1], 'mid').groups[0].lines[0].casePrice, 41.99)
  // One resolver: saved onboarding beds, then listing beds, then walk, then Guesty, then assumed; guests fall back to the listing.
  const walk = { code: 'abcdef12', name: 'Salato 302', listing_id: 'L1', details: { bedrooms: 2, bathrooms: 2 } }
  const listing = { id: 'L1', nickname: 'Salato 302', bedrooms: 2, bathrooms: 2, max_occupancy: 6, rooms: [{ beds: [{ type: 'KING_BED', quantity: 1 }] }] }
  eq('onboarding-saved beds win', L.resolveLinenUnit(walk, listing, { 'onboard:abcdef12': { Twin: 2 }, L1: { King: 1 } }).beds, { Twin: 2 })
  eq('then the listing-saved beds', L.resolveLinenUnit(walk, listing, { L1: { Queen: 2 } }).beds, { Queen: 2 })
  eq('then Guesty rooms', L.resolveLinenUnit(walk, listing, {}).beds, { King: 1 })
  eq('guests fall back to the listing', L.resolveLinenUnit(walk, listing, {}).guests, 6)
  eq('desk and deck agree', L.onboardingLinenUnit(walk, {}, listing).beds, L.resolveLinenUnit(walk, listing, {}).beds)
  // The rotation sentence names per-item pars.
  ok('par sentence names the exception', L.parSentence(L.defaultLinenStandard()).includes('mattress protector 2'))
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
