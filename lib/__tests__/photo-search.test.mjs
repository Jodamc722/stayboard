// node lib/__tests__/photo-search.test.mjs
// The smart photo search rules (Jon, 2026-10-27: "smart search like 17west pool or elser pool").
const { haystack, wordMatch, matchQuery, expand, normalizeWord, queryWords, SYNONYMS } = await import('../photo-search.ts')
let pass = 0, fail = 0
const eq = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`) } }

// ── query words ──
eq('query words: lower-case, split, capped at six', queryWords('  17WEST Pool, Deck! a b c d e'), ['17west', 'pool', 'deck', 'a', 'b', 'c'])
eq('normalize plural of a family word', normalizeWord('pools'), 'pool')
eq('normalize -ies plural', normalizeWord('balconies'), 'balcony')
eq('normalize leaves unknown words alone', normalizeWord('elser'), 'elser')
eq('normalize does not strip a unit code', normalizeWord('511s'), '511s')
eq('expand a family key', expand('pool').indexOf('jacuzzi') >= 0, true)
eq('expand a family member to its family', expand('jacuzzi').indexOf('pool') >= 0, true)
eq('expand an unknown word to itself', expand('elser'), ['elser'])
eq('every family lists its own key first', Object.keys(SYNONYMS).every(k => SYNONYMS[k][0] === k), true)

// ── a 17WEST photo: pool deck, analysed ──
const pool17 = haystack(['17WEST - 511 - 2BR', '17WEST'], ['Pool deck', 'amenity', 'pool', 'rooftop pool with loungers', 'heated pool', 'city view'])
eq('17west pool', matchQuery(pool17, ['17west', 'pool']), ['17west', 'pool'])
eq('17 west pool — typed with a space, joined', matchQuery(pool17, ['17', 'west', 'pool']), ['17', 'west', 'pool'])
eq('17west swimming — a family word finds the pool', matchQuery(pool17, ['17west', 'swimming']), ['17west', 'pool'])
eq('17west jacuzzi — family member as query', matchQuery(pool17, ['17west', 'jacuzzi']), ['17west', 'pool'])
eq('17west pools — plural', matchQuery(pool17, ['17west', 'pools']), ['17west', 'pool'])
eq('17west view — from the analysis selling points', matchQuery(pool17, ['17west', 'view']), ['17west', 'view'])
eq('17west rooftop', matchQuery(pool17, ['17west', 'rooftop']), ['17west', 'rooftop'])
eq('511 pool — unit number', matchQuery(pool17, ['511', 'pool']), ['511', 'pool'])
eq('17west gym — not this photo', matchQuery(pool17, ['17west', 'gym']), null)
eq('elser pool — wrong property', matchQuery(pool17, ['elser', 'pool']), null)
eq('every word must land', matchQuery(pool17, ['17west', 'pool', 'kitchen']), null)
eq('no words, no match', matchQuery(pool17, []), null)

// ── an Elser bedroom with only a human caption ──
const elserBed = haystack(['ELSER 1203', 'Elser'], ['King bedroom with bay views'])
eq('elser bedroom', matchQuery(elserBed, ['elser', 'bedroom']), ['elser', 'bedroom'])
eq('elser king', matchQuery(elserBed, ['elser', 'king']), ['elser', 'bedroom'])
eq('elser bed — exact short word', matchQuery(elserBed, ['elser', 'bed']), ['elser', 'bedroom'])
eq('elser view — "views" on the photo', matchQuery(elserBed, ['elser', 'view']), ['elser', 'view'])
eq('elser bay', matchQuery(elserBed, ['elser', 'bay']), ['elser', 'view'])
eq('elser 1203 — the unit, every photo', matchQuery(elserBed, ['elser', '1203']), ['elser', '1203'])
eq('elser pool — not a pool photo', matchQuery(elserBed, ['elser', 'pool']), null)

// ── short family words never match inside longer ones ──
const spacious = haystack(['PARK - 101', 'Park Towers'], ['Spacious living room'])
eq('"spa" does not find "spacious"', wordMatch(spacious, 'spa'), null)
eq('"pool" does not find "spacious"', wordMatch(spacious, 'pool'), null)
eq('"living" does', wordMatch(spacious, 'living'), 'living')
eq('"sofa" finds the living room family', matchQuery(spacious, ['park', 'sofa']), ['park', 'living'])
eq('a four-letter form matches the start of a longer word', wordMatch(haystack([], ['poolside bar']), 'pool'), 'pool')
eq('a form never matches the middle of a word — whirlpool is found as its own family word', wordMatch(haystack([], ['whirlpool bath']), 'pool'), 'whirlpool')
eq('"pool" does not find "carpool"', wordMatch(haystack([], ['carpool lane']), 'pool'), null)
eq('"bath" finds "bathroom" (reported as the family word it landed on)', wordMatch(haystack([], ['Master bathroom']), 'bath'), 'bathroom')
eq('"roof" finds "rooftop"', wordMatch(haystack([], ['Rooftop lounge']), 'roof'), 'rooftop')

// ── location words: squashed names ──
const dash = haystack(['17 WEST - 404 - 3BR', '17 West'], [])
eq('"17west" finds "17 WEST"', wordMatch(dash, '17west'), '17west')
eq('"404" finds the unit', wordMatch(dash, '404'), '404')
eq('"3br" finds the size', wordMatch(dash, '3br'), '3br')
eq('"40" is too loose but allowed (as the unit search)', wordMatch(dash, '40'), '40')
eq('a single character never matches by squash', wordMatch(dash, '4'), null)
eq('a photo with no caption and no analysis is found only by location', matchQuery(dash, ['17west']), ['17west'])
eq('… not by content', matchQuery(dash, ['17west', 'pool']), null)

// ── the haystack ──
eq('tokens are unique lower-case words', haystack(['Elser 1203', 'Elser'], ['Pool, pool!']).tokens, ['elser', '1203', 'pool'])
eq('squashed names carry only the location, padded', haystack(['Elser 1203', 'Elser'], ['Pool']).squashed, ' elser1203 elser ')

console.log(`photo-search: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
