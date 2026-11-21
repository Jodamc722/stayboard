// node lib/__tests__/onboard-estimate.test.mjs
//
// THE ONBOARDING COST ESTIMATE (Jon, 2026-11-20). Plain node: lib/onboard-estimate.ts has no runtime
// imports, and the linen is priced by the real lib/linens.ts, so this checks the modules the page runs.
// The inventory list is the need list calculator's own (lib/onboard-estimate-list.ts → need-list, need-buy);
// those import each other without a file extension, so one small resolve hook lets plain node follow them.
// Linen prices here are made up — the real ones live in the saved linen standard, not in code.
import { register } from 'node:module'
register('data:text/javascript,' + encodeURIComponent("export async function resolve(s, c, n) { try { return await n(s, c) } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return n(s + '.ts', c); throw e } }"))
const E = await import('../onboard-estimate.ts')
const L = await import('../linens.ts')
const BL = await import('../onboard-estimate-list.ts')
const N = await import('../need-list.ts')
const NB = await import('../need-buy.ts')
const { DEFAULT_EST_SETTINGS, normEstSettings, estDefaults, normEstInput, guestsFromBeds, linenUnitOf, linenEstimate, cleanEstimate, kitSizeOf,
  PRICE_BOOK, SUPPLIED_KEYS, priceFor, productFor, inventoryEstimate, estimate, estimateText, LINEN_TIER_OF, GRADE_OF, OPTIONAL_FOR_LEVEL, EST_LEVELS, bedsText, unitLabel } = E
const { buyRowsFor, priceBookLines } = BL

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)
const S = DEFAULT_EST_SETTINGS
const r2 = n => Math.round(n * 100) / 100

// A standard with a price on every line: $10 a piece, a King sheet $12.
const std = L.defaultLinenStandard()
for (const it of std.items) for (const t of L.LINEN_TIERS) { it.tiers[t] = { ...(it.tiers[t] || {}), price: t === 'lux' ? 20 : 10 }; if (it.id === 'fitted-sheet') it.tiers[t].priceBySize = { King: 12 } }
const quoteFor = i => L.linenQuote({ ...(i.par ? L.atPar(std, i.par) : std), markupPct: 0, taxPct: 0 }, [linenUnitOf(i)], LINEN_TIER_OF[i.level])

console.log('\nthe unit')
const one = estDefaults(1)
eq('a 1 bedroom starts with one King, one bath, two guests', [one.beds, one.baths, one.guests], [{ King: 1 }, 1, 2])
eq('a 3 bedroom: King + 2 Queen, 2 baths, sleeps 6', [estDefaults(3).beds, estDefaults(3).baths, estDefaults(3).guests], [{ King: 1, Queen: 2 }, 2, 6])
eq('a studio is 0 bedrooms with one King', [estDefaults(0).bedrooms, estDefaults(0).beds, unitLabel(0)], [0, { King: 1 }, 'Studio'])
eq('guests follow beds: a twin sleeps one, a full sleeps two', guestsFromBeds({ King: 1, Full: 1, Twin: 2, 'Sofa bed': 1 }), 8)
ok('a Full bed is counted in the linen', quoteFor({ ...estDefaults(1), beds: { Full: 1 } }).rows.some(r => r.size === 'Full'))
eq('a unit starts with a full kitchen and every appliance', [one.kitchen, Object.values(one.appliances).every(Boolean)], [true, true])
eq('the linen unit: kitchen towels only for a kitchen that cooks', [linenUnitOf({ ...one, appliances: { ...one.appliances, stove: false } }).kitchens, linenUnitOf({ ...one, kitchen: false }).kitchens, linenUnitOf(one).kitchens], [0, 0, 1])
eq('the unit as the calculator reads it', kitSizeOf(one), { bedrooms: 1, bathrooms: 1, guests: 2, kitchen: true, appliances: { stove: true, oven: true, microwave: true, fridge: true, dishwasher: true } })
eq('no kitchen: no appliances either; a half bath rounds up', [kitSizeOf({ ...one, kitchen: false }).appliances.oven, kitSizeOf({ ...one, baths: 1.5 }).bathrooms], [false, 2])
eq('junk input is made safe', (() => { const n = normEstInput({ bedrooms: 'x', beds: { King: -3, Queen: 99, Bunk: 2 }, baths: 2.3, guests: 0, kitchen: 'boat', appliances: { oven: false, jet: true }, level: 'gold' }); return [n.bedrooms, n.beds, n.baths, n.guests, n.kitchen, n.appliances.oven, n.appliances.stove, n.level, n.optional] })(),
  [0, { Queen: 20 }, 2.5, 1, true, false, true, 'mid', false])
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

console.log('\nthe list is the inventory calculator\'s')
const three = estDefaults(3)
const withG = (g, x = {}) => ({ ...three, guests: g, ...x })
const row = (i, key) => buyRowsFor(i).find(r => r.key === key)
const qty = (i, key) => row(i, key)?.qty ?? 0
eq('it is the calculator\'s own buy list, line for line', buyRowsFor(one).map(r => [r.key, r.qty]),
  NB.buyList(N.needList(kitSizeOf(one)).filter(l => l.tier !== 'optional')).map(b => [b.key, b.qty]))
eq('two place settings per guest: dinnerware sets (service for 4) grow with the guests', [2, 4, 6, 8, 10].map(g => qty(withG(g), 'set-dinnerware')), [1, 2, 3, 4, 5])
eq('flatware follows the same place settings', [2, 6, 10].map(g => qty(withG(g), 'set-flatware')), [1, 3, 5])
eq('tall glasses: two per guest in packs of 4; wine glasses: one per guest', [qty(withG(6), 'tall-glasses'), qty(withG(6), 'wine-glasses'), qty(withG(10), 'wine-glasses')], [3, 2, 3])
eq('mugs come in the dinnerware set, so cups rise with the guests too', [row(withG(6), 'set-dinnerware').detail.includes('4 coffee mugs'), row(withG(6), 'mugs')], [true, undefined])
eq('ten guests: a second coffee maker and cookware set', [qty(withG(8), 'coffee-maker'), qty(withG(10), 'coffee-maker'), qty(withG(10), 'set-cookware')], [1, 2, 2])
eq('per bedroom and per bathroom lines follow the unit', [qty(three, 'hangers'), qty(three, 'luggage-rack'), qty(three, 'hair-dryer'), qty(three, 'smoke-alarms')], [2, 3, 2, 4])
eq('steak knives past the six in the block are bought singly', [qty(withG(6), 'steak-knives'), qty(withG(8), 'steak-knives')], [0, 2])
ok('no oven → no bakeware or oven mitts; no stove → no cookware', (() => { const i = { ...one, appliances: { ...one.appliances, oven: false, stove: false } }; return !row(i, 'set-bakeware') && !row(i, 'oven-mitts') && !row(i, 'set-cookware') && !!row(one, 'set-bakeware') && !!row(one, 'set-cookware') })())
ok('no dishwasher makes the dish rack a must', row({ ...one, appliances: { ...one.appliances, dishwasher: false } }, 'dish-rack').tier === 'must' && row(one, 'dish-rack').tier === 'recommended')
ok('no kitchen: the dishes and cookware go, the coffee maker and glasses stay', (() => { const i = { ...one, kitchen: false }; return !row(i, 'set-dinnerware') && !row(i, 'set-cookware') && !row(i, 'toaster') && !!row(i, 'coffee-maker') && !!row(i, 'wine-glasses') })())
ok('optional extras only when asked', !row(one, 'blender') && !!row({ ...one, optional: true }, 'blender') && row({ ...one, optional: true }, 'blender').tier === 'optional')
eq('a set is as needed as what it is bought for, and shows what is in it', [row(one, 'set-cookware').tier, row(one, 'set-measuring').tier, row(one, 'set-knives').icon], ['must', 'recommended', 'chef-knife'])

console.log('\nthe price book: basic, mid tier, top tier')
const allRows = buyRowsFor({ ...withG(12), optional: true })
eq('every line the calculator can buy has a price or is ours to supply', allRows.filter(r => !PRICE_BOOK[r.key] && !SUPPLIED_KEYS.includes(r.key)).map(r => r.key), [])
eq('every price book line is something the calculator buys', Object.keys(PRICE_BOOK).filter(k => !NB.BUY_SETS.some(s => s.key === k) && !N.NEED_ITEMS.some(i => i.key === k)), [])
eq('standard is never dearer than mid, and mid never dearer than luxury', Object.entries(PRICE_BOOK).filter(([, b]) => !(b.p[0] <= b.p[1] && b.p[1] <= b.p[2])).map(([k]) => k), [])
ok('every line says what the product is at each grade', Object.values(PRICE_BOOK).every(b => b.what.length === 3 && b.what.every(w => w && w.length < 48)))
ok('whole dollars: an estimate, not a quote', Object.values(PRICE_BOOK).every(b => b.p.every(n => Number.isInteger(n) && n > 0)))
eq('the grade picks the product', [productFor('set-cookware', 'standard'), productFor('set-cookware', 'mid'), productFor('set-cookware', 'luxury')], ['Nonstick', 'Tri-ply stainless', 'All-Clad stainless'])
eq('the calculator\'s grades under the names sales uses', GRADE_OF, { standard: 'std', mid: 'mid', luxury: 'lux' })
eq('a price typed on the page wins; the rest stays on the book', (() => { const s = normEstSettings({ prices: { toaster: [30, 95, 210] } }); return [priceFor('toaster', 'mid', s), priceFor('kettle', 'mid', s), priceFor('nope', 'mid', s)] })(), [95, PRICE_BOOK.kettle.p[1], null])
eq('the price editor lists every priced line once, sets first', (() => { const l = priceBookLines(); return [l.length, new Set(l.map(x => x.key)).size, l[0].key, l.some(x => x.key === 'soap-dispensers')] })(), [Object.keys(PRICE_BOOK).length, Object.keys(PRICE_BOOK).length, 'set-dinnerware', false])

console.log('\ninventory: what it costs')
const inv = (i, picks, s = S) => inventoryEstimate(buyRowsFor(i), i, s, picks)
const sumOf = (i, lv) => buyRowsFor(i).filter(r => !SUPPLIED_KEYS.includes(r.key)).reduce((a, r) => a + r.qty * PRICE_BOOK[r.key].p[lv], 0)
eq('the total is every line × its price at the level', [inv(one).total, inv({ ...one, level: 'standard' }).total, inv({ ...one, level: 'luxury', optional: false }).total], [sumOf(one, 1), sumOf(one, 0), sumOf(one, 2)])
ok('basic < mid tier < top tier, clearly', inv({ ...one, level: 'standard' }).total * 1.5 < inv(one).total && inv(one).total * 1.5 < inv({ ...one, level: 'luxury', optional: false }).total,
  [inv({ ...one, level: 'standard' }).total, inv(one).total, inv({ ...one, level: 'luxury', optional: false }).total].join(' / '))
ok('more guests cost more', inv(withG(10)).total > inv(withG(6)).total && inv(withG(6)).total > inv(withG(2)).total, [2, 6, 10].map(g => inv(withG(g)).total).join(' / '))
ok('we supply the soap dispensers: on the need list, never on the estimate', N.needList(kitSizeOf(one)).some(l => l.item.key === 'soap-dispensers') && !inv(one).rows.some(r => r.key === 'soap-dispensers'))
eq('unticking a line takes it off the total and the count', (() => { const a = inv(one), b = inv(one, { 'coffee-maker': false }); return [r2(a.total - b.total), a.count - b.count, b.rows.find(r => r.key === 'coffee-maker').on] })(), [PRICE_BOOK['coffee-maker'].p[1], 1, false])
eq('a line with no price is named, never counted at $0', (() => { const r = inventoryEstimate([{ key: 'mystery', kind: 'single', name: 'Mystery thing', group: 'Bedroom', qty: 2, pieces: 2, tier: 'must' }], one, S); return [r.total, r.count, r.unpriced, r.rows[0].price] })(), [0, 0, ['Mystery thing'], null])
eq('each row carries its product, price and cost', (() => { const r = inv(withG(6)).rows.find(x => x.key === 'set-dinnerware'); return [r.qty, r.price, r.cost, r.product, r.on] })(), [3, PRICE_BOOK['set-dinnerware'].p[1], 3 * PRICE_BOOK['set-dinnerware'].p[1], 'Porcelain or bone china', true])

console.log('\none level per unit')
eq('a luxury unit starts with the optional extras; standard and mid do not', OPTIONAL_FOR_LEVEL, { standard: false, mid: false, luxury: true })
eq('the level a unit is typed with sets its starting extras', [normEstInput({ bedrooms: 1, level: 'luxury' }).optional, normEstInput({ bedrooms: 1, level: 'luxury', optional: false }).optional, normEstInput({ bedrooms: 1 }).optional], [true, false, false])
eq('three levels, in order', EST_LEVELS, ['standard', 'mid', 'luxury'])

console.log('\nall three lines')
const e1 = estimate(q1, buyRowsFor(one), one, S)
eq('each line is rounded to $10 and the total is their sum', [e1.lines.linen, e1.lines.clean, e1.lines.inventory, e1.total], [1150, 250, Math.round(inv(one).total / 10) * 10, 1150 + 250 + Math.round(inv(one).total / 10) * 10])
ok('the range is 10% either way, to the nearest $50', e1.low % 50 === 0 && e1.high % 50 === 0 && e1.low < e1.total && e1.high > e1.total)
const txt = estimateText(one, e1)
ok('the text names the unit and the three lines', /1 bedroom \(1 King; 1 bath; sleeps 2\)/.test(txt) && /Linen, bedding and towels \(mid level\): \$1,150/.test(txt) && /Onboarding clean: \$250/.test(txt) && /Kitchen and housewares, \d+ items \(mid level\): \$[\d,]+/.test(txt), txt)
ok('it says it assumes a furnished unit, that we supply the consumables, and that it is not a quote', /fully furnished unit, not a quote\. We supply the consumables\./.test(txt))
ok('no inventory line when everything is unticked', !/housewares/.test(estimateText(one, estimate(q1, [], one, S))))

console.log('\nsettings')
eq('the defaults: Jon\'s clean prices, 7% tax, 15% on linen', [S.cleanStudio, S.clean1br, S.taxPct, S.linenUpliftPct], [200, 250, 7, 15])
eq('a saved blob is clamped', (() => { const n = normEstSettings({ cleanStudio: -5, clean1br: 'x', linenUpliftPct: 500, taxPct: 8.5, typicalSqft: [1, 2] }); return [n.cleanStudio, n.clean1br, n.linenUpliftPct, n.taxPct, n.typicalSqft] })(), [0, 250, 100, 8.5, [100, 100]])
eq('nothing saved → no price overrides', normEstSettings(null).prices, {})
eq('junk prices are dropped, good ones kept', normEstSettings({ prices: { toaster: [30, 95, 210], kettle: [1, 2], 'BAD KEY': [1, 2, 3], blender: [1, -2, 3], iron: ['x', 2, 3] } }).prices, { toaster: [30, 95, 210] })
ok('no supplier quote lives in the code: whole dollars only', !/\b\d+\.\d{2}\b/.test((await import('node:fs')).readFileSync(new URL('../onboard-estimate.ts', import.meta.url), 'utf8')))

console.log(`\nonboard estimate: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
