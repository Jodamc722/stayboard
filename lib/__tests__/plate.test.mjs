// node lib/__tests__/plate.test.mjs
// THE PLATE HELPERS (lib/plate.ts) — what the parking lot check matches on. Plain node, no deps.
const P = await import('../plate.ts')
const { normalizePlate, tidyPlate, plateDistance, platesClose, nightsBetween, addDays, rangesOverlap, carLabel, cents } = P

let pass = 0, fail = 0
const eq = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`) } }

// Normalising: case, spaces, dashes, punctuation all vanish; letters and digits stay.
eq('normalize lower + space', normalizePlate('abc 1234'), 'ABC1234')
eq('normalize dash', normalizePlate('ABC-1234'), 'ABC1234')
eq('normalize junk', normalizePlate(' a.b/c 12 34 '), 'ABC1234')
eq('normalize empty', normalizePlate(null), '')
eq('tidy keeps a single space', tidyPlate('  abc   1234 '), 'ABC 1234')

// Distance: identical = 0, a confusable swap = 0.5, a real typo = 1, two typos = 2.
eq('distance same', plateDistance('ABC1234', 'abc-1234'), 0)
eq('distance O/0', plateDistance('ABC0234', 'ABCO234'), 0.5)
eq('distance one wrong', plateDistance('ABC1234', 'ABC1239'), 1)
eq('distance missing char', plateDistance('ABC1234', 'ABC123'), 1)
eq('distance two wrong', plateDistance('ABC1234', 'XBC1239'), 2)

// Close: one honest mistake away, never for very short plates, never for empties.
eq('close same', platesClose('ABC1234', 'ABC 1234'), true)
eq('close one typo', platesClose('ABC1234', 'ABC1284'), true)
eq('close 8/B', platesClose('A8C1234', 'ABC1234'), true)
eq('not close two typos', platesClose('ABC1234', 'ABD1235'), false)
eq('not close short', platesClose('AB1', 'AB2'), false)
eq('not close empty', platesClose('', 'ABC1234'), false)

// Nights: [start, end). Checkout day is not a night.
eq('nights 3', nightsBetween('2026-10-27', '2026-10-30'), 3)
eq('nights 0 same day', nightsBetween('2026-10-27', '2026-10-27'), 0)
eq('nights negative → 0', nightsBetween('2026-10-30', '2026-10-27'), 0)
eq('nights across DST', nightsBetween('2026-10-31', '2026-11-02'), 2)
eq('addDays', addDays('2026-10-30', 2), '2026-11-01')
eq('addDays back', addDays('2026-11-01', -1), '2026-10-31')

// Overlap: a car leaving on the 30th and one arriving on the 30th share the spot.
eq('overlap touching ends is free', rangesOverlap('2026-10-27', '2026-10-30', '2026-10-30', '2026-11-02'), false)
eq('overlap inside', rangesOverlap('2026-10-27', '2026-10-30', '2026-10-28', '2026-10-29'), true)
eq('overlap one night', rangesOverlap('2026-10-27', '2026-10-30', '2026-10-29', '2026-11-02'), true)

eq('carLabel full', carLabel({ color: 'Black', make: 'Honda', model: 'Civic' }), 'Black Honda Civic')
eq('carLabel empty', carLabel({}), 'vehicle')
eq('cents whole', cents(3000), '$30')
eq('cents fraction', cents(1250), '$12.50')

console.log(`plate: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
