// node lib/__tests__/linens.test.mjs
//
// THE LINEN STANDARD AND ITS ARITHMETIC (Jon, 2026-09-29: "I create the standard, you just need to
// create a place where I can edit that or update it"). Plain node, no deps: lib/linens.ts has no
// imports on purpose and node >= 22.18 strips the TypeScript types itself, so this checks the very
// module the page and the API run.
const L = await import('../linens.ts')
const { DEFAULT_LINEN_STANDARD, defaultLinenStandard, normLinenStandard, linenNeeds, linenTotals, bedsFromGuestyRooms, bedsFromOnboarding, assumedBeds, normBeds, bedsLabel, linenCsv, linenText, priceFor } = L

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
eq('"$12.50" reads as 12.5; "lots" is no par', [a.price, 'par' in a], [12.5, false])
ok('rotates must be a real true', a.rotates === false)
ok('unknown item keys dropped; qtyBySize dropped off a non-bed item', !('evil' in a) && !('qtyBySize' in a))
eq('qty clamped to 999; bad size values dropped; negative price → 0', [b.qty, b.qtyBySize, b.priceBySize], [999, { Queen: 3 }, { King: 0 }])
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

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
