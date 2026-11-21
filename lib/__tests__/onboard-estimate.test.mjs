// node lib/__tests__/onboard-estimate.test.mjs
//
// THE ONBOARDING COST ESTIMATE (Jon, 2026-11-20). Plain node: lib/onboard-estimate.ts has no runtime
// imports, and the linen is priced by the real lib/linens.ts, so this checks the modules the page runs.
// Prices here are made up — the real ones live in the saved linen standard and the catalog, not in code.
const E = await import('../onboard-estimate.ts')
const L = await import('../linens.ts')
const { DEFAULT_EST_SETTINGS, normEstSettings, estDefaults, normEstInput, hasDefaults, guestsFromBeds, linenUnitOf, linenEstimate, cleanEstimate,
  catalogRows, wanted, invQty, inventoryEstimate, estimate, estimateText, LINEN_TIER_OF, bedsText, unitLabel } = E

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)
const S = DEFAULT_EST_SETTINGS

// A standard with a price on every line: $10 a piece, a King sheet $12.
const std = L.defaultLinenStandard()
for (const it of std.items) for (const t of L.LINEN_TIERS) { it.tiers[t] = { ...(it.tiers[t] || {}), price: t === 'lux' ? 20 : 10 }; if (it.id === 'fitted-sheet') it.tiers[t].priceBySize = { King: 12 } }
const quoteFor = i => L.linenQuote({ ...(i.par ? L.atPar(std, i.par) : std), markupPct: 0, taxPct: 0 }, [linenUnitOf(i)], LINEN_TIER_OF[i.level])

console.log('\nthe unit')
const one = estDefaults(1)
eq('a 1 bedroom starts with one King, one bath, two guests, one TV', [one.beds, one.baths, one.guests, one.tvs], [{ King: 1 }, 1, 2, 1])
eq('a 3 bedroom: King + 2 Queen, sleeps 6, 3 TVs', [estDefaults(3).beds, estDefaults(3).guests, estDefaults(3).tvs], [{ King: 1, Queen: 2 }, 6, 3])
eq('a studio is 0 bedrooms with one King', [estDefaults(0).bedrooms, estDefaults(0).beds, unitLabel(0)], [0, { King: 1 }, 'Studio'])
eq('guests follow beds: a twin sleeps one, a full sleeps two', guestsFromBeds({ King: 1, Full: 1, Twin: 2, 'Sofa bed': 1 }), 8)
ok('a Full bed is counted in the linen', quoteFor({ ...estDefaults(1), beds: { Full: 1 } }).rows.some(r => r.size === 'Full'))
eq('a full kitchen comes with a stove and a microwave', hasDefaults('full'), { stove: true, microwave: true })
eq('a kitchenette has no microwave', hasDefaults('kitchenette'), { stove: true, microwave: false })
eq('the linen unit: a kitchenette has no full kitchen', [linenUnitOf({ ...one, kitchen: 'kitchenette' }).kitchens, linenUnitOf(one).kitchens], [0, 1])
eq('junk input is made safe', (() => { const n = normEstInput({ bedrooms: 'x', beds: { King: -3, Queen: 99, Bunk: 2 }, baths: 2.3, guests: 0, kitchen: 'boat', stock: 'lots', level: 'gold' }); return [n.bedrooms, n.beds, n.baths, n.guests, n.kitchen, n.stock, n.level] })(), [0, { Queen: 20 }, 2.5, 1, 'full', 'rec', 'mid'])
eq('beds as words', bedsText({ King: 1, Queen: 2, 'Sofa bed': 1 }), '1 King, 2 Queen, 1 sofa bed')

console.log('\nlinen: cost per item × par, then tax, then the allowance')
const q1 = quoteFor(one)
// One King, 1 bath, 2 guests, full kitchen on the starting standard: fitted 3×$12, flat 6, protector 2, insert 2, cover 3, pillows 5, pillow protectors 8,
// cases 10, hand towels 12, mat 3, makeup 6, bath towels 12, washcloths 12, pool towels 2, kitchen towels 6, throw 1 → 36 + 90×10
eq('at par, before tax', q1.subtotal, 36 + 90 * 10)
const l1 = linenEstimate(q1, S)
eq('7% tax, then 15% on top', [l1.atPar, l1.taxed, l1.total], [936, 1001.52, 1151.75])
eq('no allowance, no tax → the par cost itself', linenEstimate(q1, { ...S, taxPct: 0, linenUpliftPct: 0 }).total, 936)
eq('luxury uses the lux tier of the standard', quoteFor({ ...one, level: 'luxury' }).subtotal, 3 * 12 + 90 * 20)
eq('standard uses the low tier', LINEN_TIER_OF, { standard: 'low', mid: 'mid', luxury: 'lux' })
// Par 2: fitted 2, flat 4, cover 2, hand 8, mat 2, makeup 4, bath 8, wash 8, kitchen 4; protector 2, insert 2, pillows 5, protectors 8, cases 10, pool 2, throw 1 unchanged
eq('par 2 instead of 3: only the sets in rotation shrink', quoteFor({ ...one, par: 2 }).subtotal, 2 * 12 + 70 * 10)
eq('par 0 means the saved standard\'s par', [one.par, quoteFor({ ...one, par: 0 }).subtotal], [0, 936])
eq('a typed par is rounded to a half and capped', [normEstInput({ bedrooms: 1, par: 2.3 }).par, normEstInput({ bedrooms: 1, par: 99 }).par, normEstInput({ bedrooms: 1, par: 'x' }).par], [2.5, 6, 0])
ok('a sofa bed adds linen', quoteFor({ ...one, beds: { King: 1, 'Sofa bed': 1 }, guests: 4 }).subtotal > q1.subtotal)
const bare = L.defaultLinenStandard()
const qBare = L.linenQuote({ ...bare, markupPct: 0, taxPct: 0 }, [linenUnitOf(one)], 'mid')
eq('a standard with no prices: nothing is guessed, every row is counted unpriced', [linenEstimate(qBare, S).total, qBare.priced, qBare.unpriced > 10], [0, 0, true])

console.log('\nthe clean')
eq('studio $200, one bedroom $250', [cleanEstimate(estDefaults(0), S).total, cleanEstimate(one, S).total], [200, 250])
eq('each further bedroom adds the setting', [cleanEstimate(estDefaults(2), S).total, cleanEstimate(estDefaults(3), S).total], [300, 350])
eq('inside the typical size: no change', cleanEstimate({ ...one, sqft: 900 }, S).extra, 0)
eq('500 sq ft over a typical 1 bedroom: two blocks', cleanEstimate({ ...one, sqft: 1400 }, S), { base: 250, extra: 50, typical: 900, total: 300 })
eq('the square-foot rule can be switched off', cleanEstimate({ ...one, sqft: 5000 }, { ...S, sqftStepCost: 0 }).extra, 0)

console.log('\nthe catalog')
const items = [
  { id: 'a', category: 'Kitchen', name: 'Coffee maker', need: 'must', qty: 1, qty_per: 'unit' },
  { id: 'b', category: 'Kitchen', name: 'Wine glasses', need: 'recommended', qty: 1, qty_per: 'unit' },
  { id: 'c', category: 'Kitchen', name: 'Microwave', need: 'recommended', qty: 1, qty_per: 'unit' },
  { id: 'd', category: 'Cleaning supplies', name: 'Dish pods', need: 'must', qty: 1, qty_per: 'unit' },
  { id: 'e', category: 'Paper & consumables', name: 'Toilet paper', need: 'must', qty: 1, qty_per: 'unit' },
  { id: 'f', category: 'Safety', name: 'Smoke and CO detector', need: 'must', qty: 1, qty_per: 'bedroom' },
  { id: 'g', category: 'Cleaning supplies', name: 'Glass cleaner', need: 'must', qty: 1, qty_per: 'unit' },
  { id: 'h', category: 'Bath amenities', name: 'Shampoo refill', need: 'recommended', qty: 1, qty_per: 'unit' },
  { id: 'i', category: 'Kitchen', name: 'Condiment kit', need: 'recommended', qty: 1, qty_per: 'unit' },
  { id: 'j', category: 'Entertainment', name: 'Streaming stick', need: 'recommended', qty: 1, qty_per: 'bedroom' },
  { id: 'k', category: 'Kitchen', name: 'Cookware set', need: 'must', qty: 1, qty_per: 'unit' },
  { id: 'l', category: 'Family', name: 'High chair', need: 'suggested', qty: 1, qty_per: 'unit' },
  { id: 'm', category: 'Cleaning supplies', name: 'Laundry pods', need: 'must', qty: 1, qty_per: 'unit' },
]
const options = [
  { item_id: 'a', tier: 'standard', price: 30, name: '12-cup drip' }, { item_id: 'a', tier: 'midlux', price: 70, name: '2-way programmable' }, { item_id: 'a', tier: 'luxury', price: 170, name: 'Grinder and steam wand' },
  { item_id: 'b', tier: 'standard', price: 20 }, { item_id: 'b', tier: 'midlux', price: 23 }, { item_id: 'b', tier: 'luxury', price: 31 },
  { item_id: 'c', tier: 'standard', price: 80 }, { item_id: 'c', tier: 'midlux', price: 90 }, { item_id: 'c', tier: 'luxury', price: 100 },
  { item_id: 'd', tier: null, price: 53.89, each: '$8.98' },
  { item_id: 'e', tier: null, price: 59.17, each: '$0.62' },
  { item_id: 'f', tier: 'standard', price: 43, name: '10-year combo' }, { item_id: 'f', tier: 'luxury', price: 104, name: 'Sealed smart combo' },
  { item_id: 'g', tier: null, price: 14, each: null },
  { item_id: 'h', tier: null, price: 125.39, each: '$31.34' },
  { item_id: 'i', tier: null, price: null },
  { item_id: 'j', tier: 'standard', price: 49 }, { item_id: 'j', tier: 'midlux', price: 58 }, { item_id: 'j', tier: 'luxury', price: 60 },
  { item_id: 'k', tier: 'standard', price: 56 }, { item_id: 'k', tier: 'midlux', price: 110 }, { item_id: 'k', tier: 'luxury', price: 324 },
  { item_id: 'l', tier: 'standard', price: 50 }, { item_id: 'l', tier: 'midlux', price: 60 }, { item_id: 'l', tier: 'luxury', price: 64 },
  { item_id: 'm', tier: null, price: 43.13, each: '$10.78 / box' },
]
const { rows, left } = catalogRows(items, options, S)
const R = n => rows.find(r => r.name === n)
eq('consumables are ours to supply, and unpriced lines are not guessed: both left out, with the reason', left, [
  { name: 'Dish pods', why: 'consumable, we supply it' }, { name: 'Toilet paper', why: 'consumable, we supply it' }, { name: 'Glass cleaner', why: 'consumable, we supply it' },
  { name: 'Shampoo refill', why: 'consumable, we supply it' }, { name: 'Condiment kit', why: 'no price in the catalog' }, { name: 'Laundry pods', why: 'consumable, we supply it' }])
ok('no consumable is a priced row', !rows.some(r => ['Dish pods', 'Toilet paper', 'Glass cleaner', 'Laundry pods', 'Shampoo refill'].includes(r.name)))
eq('a tiered item keeps its three prices', R('Coffee maker').prices, [30, 70, 170])
eq('a missing tier borrows the price and the product of the one below', [R('Smoke and CO detector').prices, R('Smoke and CO detector').products], [[43, 43, 104], ['10-year combo', '10-year combo', 'Sealed smart combo']])
eq('each level has its own product', R('Coffee maker').products, ['12-cup drip', '2-way programmable', 'Grinder and steam wand'])
eq('sets carry who they serve', R('Wine glasses').serves, [6, 6, 12])

console.log('\ninventory: what goes on the list')
const inv = (i, picks) => inventoryEstimate(rows, i, picks)
const on = (i, picks) => inv(i, picks).rows.filter(r => r.on).map(r => r.name)
eq('must-haves only', on({ ...one, stock: 'must' }), ['Coffee maker', 'Smoke and CO detector', 'Cookware set'])
eq('with recommended (the unit has a microwave, so none is bought)', on(one), ['Coffee maker', 'Wine glasses', 'Smoke and CO detector', 'Streaming stick', 'Cookware set'])
ok('everything adds the nice-to-haves', on({ ...one, stock: 'all' }).includes('High chair'))
eq('already stocked: nothing', [on({ ...one, stock: 'none' }), inv({ ...one, stock: 'none' }).total], [[], 0])
ok('no stove → no cookware set', !on({ ...one, has: { ...one.has, stove: false } }).includes('Cookware set'))
ok('no microwave in the unit → a countertop one, even on must-haves only', on({ ...one, stock: 'must', has: { ...one.has, microwave: false } }).includes('Microwave'))
eq('only the built-ins are asked', E.EST_HAS.map(h => h.key), ['stove', 'microwave'])
ok('no TVs → no streaming stick', !on({ ...one, tvs: 0 }).includes('Streaming stick'))
eq('no kitchen: the coffee maker stays, the cookware goes, a microwave is added', on({ ...one, kitchen: 'none', has: hasDefaults('none') }), ['Coffee maker', 'Wine glasses', 'Microwave', 'Smoke and CO detector', 'Streaming stick'])
eq('a tick overrides the rules, both ways', [on(one, { 'High chair': true }).includes('High chair'), on(one, { 'Coffee maker': false }).includes('Coffee maker')], [true, false])

console.log('\ninventory: how many, and what it costs')
const three = estDefaults(3)
eq('smoke detectors: one per bedroom, a studio has one', [invQty(R('Smoke and CO detector'), estDefaults(0)), invQty(R('Smoke and CO detector'), three)], [1, 3])
eq('wine glasses: a set of 6 covers 6 guests; luxury sets are 12', [invQty(R('Wine glasses'), one), invQty(R('Wine glasses'), { ...three, guests: 8 }), invQty(R('Wine glasses'), { ...three, guests: 8, level: 'luxury' })], [1, 2, 1])
eq('one streaming stick per TV', invQty(R('Streaming stick'), three), 3)
// 1 bedroom, mid, must + recommended: 70 + 23 + 43 + 58 + 110
eq('the 1 bedroom total at mid', inv(one).total, 304)
eq('…and its count and groups', [inv(one).count, inv(one).groups.Kitchen], [5, 203])
ok('standard costs less, luxury more', inv({ ...one, level: 'standard' }).total < inv(one).total && inv({ ...one, level: 'luxury' }).total > inv(one).total)
eq('an unticked line still shows its cost, and is not in the total', (() => { const x = inv(one, { 'Cookware set': false }); return [x.rows.find(r => r.name === 'Cookware set').cost, x.total] })(), [110, 194])

console.log('\none level per unit')
eq('the level changes the product and the price on the line', ['standard', 'mid', 'luxury'].map(level => { const x = inv({ ...one, level }).rows.find(r => r.name === 'Coffee maker'); return [x.product, x.price] }), [['12-cup drip', 30], ['2-way programmable', 70], ['Grinder and steam wand', 170]])
eq('a standard unit starts with must-haves, mid adds recommended, luxury takes everything', E.STOCK_FOR_LEVEL, { standard: 'must', mid: 'rec', luxury: 'all' })
eq('a typical unit is mid with recommended', [one.level, one.stock], ['mid', 'rec'])
eq('a saved choice of how much to buy is kept', normEstInput({ bedrooms: 1, level: 'luxury', stock: 'must' }).stock, 'must')
eq('with no choice, it follows the level', normEstInput({ bedrooms: 1, level: 'luxury' }).stock, 'all')

console.log('\nall three lines')
const e1 = estimate(q1, rows, one, S)
eq('each line rounds to $10 and the total is their sum', [e1.lines, e1.total], [{ linen: 1150, clean: 250, inventory: 300 }, 1700])
eq('the range is 10% either way, to the nearest $50', [e1.low, e1.high], [1550, 1850])
const txt = estimateText(one, e1)
ok('the text names the unit and the three lines', /1 bedroom \(1 King; 1 bath; sleeps 2\)/.test(txt) && /Linen, bedding and towels \(mid level\): \$1,150/.test(txt) && /Onboarding clean: \$250/.test(txt) && /Inventory, 5 items \(mid level\): \$300/.test(txt) && /Estimated total: \$1,700/.test(txt))
ok('it says it assumes a furnished unit, that we supply the consumables, and that it is not a quote', /fully furnished unit, not a quote\. We supply the consumables\./.test(txt))
ok('no inventory line when nothing is bought', !/Inventory/.test(estimateText({ ...one, stock: 'none' }, estimate(q1, rows, { ...one, stock: 'none' }, S))))

console.log('\nsettings')
eq('the defaults: Jon\'s clean prices, 7% tax, 15% on linen', [S.cleanStudio, S.clean1br, S.taxPct, S.linenUpliftPct], [200, 250, 7, 15])
eq('a saved blob is clamped', (() => { const n = normEstSettings({ cleanStudio: -5, clean1br: 'x', linenUpliftPct: 500, taxPct: 8.5, typicalSqft: [1, 2] }); return [n.cleanStudio, n.clean1br, n.linenUpliftPct, n.taxPct, n.typicalSqft] })(), [0, 250, 100, 8.5, [100, 100]])
eq('nothing saved → the defaults', normEstSettings(null).serves['Dishware set'], [4, 8, 8])
ok('no vendor price lives in the code', !/\b\d+\.\d{2}\b/.test((await import('node:fs')).readFileSync(new URL('../onboard-estimate.ts', import.meta.url), 'utf8')))

console.log(`\nonboard estimate: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
