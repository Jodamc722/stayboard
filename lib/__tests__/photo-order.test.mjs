// node lib/__tests__/photo-order.test.mjs
// THE FIRST FIVE (Jon, 2026-11-25: "audit the way we decide the first 5 photos … if same building please
// switch it up and make sure that is on the model. Need to be distinct."). The order engine is pure, so
// the rules are tested here: the cover, the four after it, and what sister units change.
const R = await import('../photo-order.ts')
const { buildOrder, heroScore, rankHeroes, pickShowcase, marketingChecks, hamming, sameShot, sceneOf, sceneWords, coverCrowding, showcaseCrowding, siblingRead } = R
let pass = 0, fail = 0
const ok = (name, v) => { if (v) pass++; else { fail++; console.log('  FAIL  ' + name) } }
const eq = (name, got, want) => ok(name + ` (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want))

const H = { pool: 'aaaaaaaaaaaaaaaa', pool2: '5555555555555555', bed: '0f0f0f0f0f0f0f0f', living: 'f0f0f0f0f0f0f0f0', kitchen: '3c3c3c3c3c3c3c3c', balcony: 'c3c3c3c3c3c3c3c3', bath: '9999999999999999', roof: '6666666666666666' }
const ph = (id, room, category, quality, extra = {}) => ({ _id: id, url: 'u/' + id, room, category, subject: id, shotType: 'wide', quality, kind: 'property', faults: [], sellingPoints: [], duplicateOf: null, heroWorthy: false, caption: '', captionSource: 'ai', ...extra })
const unit = () => [
  ph('pool', 'pool', 'amenity', 88, { sellingPoints: ['pool'], heroWorthy: true, hash: H.pool, distinct: 20 }),
  ph('bed', 'bedroom-1', 'bedroom', 86, { sellingPoints: ['king-bed'], heroWorthy: true, hash: H.bed, distinct: 92 }),
  ph('living', 'living', 'living', 82, { hash: H.living, distinct: 90 }),
  ph('kitchen', 'kitchen', 'kitchen', 78, { hash: H.kitchen, distinct: 80 }),
  ph('balcony', 'balcony', 'outdoor', 80, { sellingPoints: ['balcony'], hash: H.balcony, distinct: 88 }),
  ph('bath', 'bath-primary', 'bathroom', 79, { hash: H.bath, distinct: 60 }),
  ph('roof', 'rooftop', 'amenity', 84, { sellingPoints: ['rooftop'], hash: H.roof, distinct: 20 }),
]
const profile = { bedrooms: 1, bathrooms: 1, isStudio: false }
const sib = (name, five) => ({ name, five })
const shot = (hash, scene) => ({ hash, scene })

// The hash
eq('the same hash is the same shot', [hamming(H.pool, H.pool), sameShot(H.pool, H.pool)], [0, true])
eq('a few bits apart is still the same photograph', [hamming('aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaab'), sameShot('aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaa2b')], [1, true])
ok('different photographs are far apart', hamming(H.pool, H.bed) > 20 && !sameShot(H.pool, H.bed))
eq('a missing hash matches nothing', [hamming(undefined, H.pool), hamming('', ''), sameShot(undefined, undefined)], [64, 64, false])
eq('scenes: shared spaces by name, bedrooms as one scene', [sceneOf({ room: 'pool', category: 'amenity' }), sceneOf({ room: 'rooftop', category: 'outdoor' }), sceneOf({ room: 'bedroom-2', category: 'bedroom' }), sceneOf({ room: 'bath-guest', category: 'bathroom' }), sceneOf({ room: 'living', category: 'living' }), sceneOf({ room: '', category: 'exterior' })], ['pool', 'rooftop', 'bedroom', 'bathroom', 'living', 'exterior'])
eq('scenes in words', [sceneWords('pool'), sceneWords('bedroom'), sceneWords('sky-lounge')], ['the pool', 'a bedroom', 'the sky lounge'])

// On its own: nothing about sister units changes a single home
const solo = buildOrder(unit(), null, profile)
eq('alone, the pool leads', solo.placed[0]._id, 'pool')
ok('alone, no cost for crowding', coverCrowding(unit()[0], undefined) === 0 && coverCrowding(unit()[0], []) === 0 && showcaseCrowding(unit()[0], []) === 0)
ok('alone, there is no sister-unit check', !marketingChecks(solo.placed, profile).some(c => c.key === 'distinct'))
ok('five different spaces open the listing', new Set(solo.placed.slice(0, 5).map(p => p.room)).size === 5)

// Any of the five can be the cover: an ordinary bathroom waits for the tour
ok('an ordinary bathroom is not in the first five while other spaces are', !solo.placed.slice(0, 5).some(p => p.category === 'bathroom'))
const tub = unit().map(p => p._id === 'bath' ? { ...p, quality: 90, heroWorthy: true, sellingPoints: ['soaking-tub'] } : p).filter(p => p._id !== 'roof' && p._id !== 'balcony')
ok('a feature bathroom can earn a seat', buildOrder(tub, null, profile).placed.slice(0, 5).some(p => p._id === 'bath'))
const few = unit().filter(p => ['bed', 'living', 'kitchen', 'bath'].includes(p._id))
ok('with nothing else left, the bathroom still fills the five', buildOrder(few, null, profile).placed.slice(0, 4).some(p => p._id === 'bath'))
ok('a subject at the edge costs a cover', heroScore({ ...unit()[1], faults: ['edge-subject'] }) === heroScore(unit()[1]) - 12)

// The same photo as a sister unit's cover
const twins = [sib('Arya 1012', [shot(H.pool, 'pool'), shot('1111111111111111', 'bedroom')]), sib('Arya 2011', [shot('aaaaaaaaaaaaaaab', 'pool'), shot('2222222222222222', 'living')]), sib('Arya 906', [shot('7777777777777777', 'balcony')])]
const r1 = siblingRead(unit()[0], twins)
eq('the pool photo is two sister units’ cover', [r1.n, r1.sameCover, r1.sceneCover, r1.inFives], [3, ['Arya 1012', 'Arya 2011'], 2, 2])
const d1 = buildOrder(unit(), null, profile, { siblings: twins })
ok('so this unit does not open with it', d1.placed[0]._id !== 'pool')
eq('it opens with its own bedroom', d1.placed[0]._id, 'bed')
ok('and says why', /distinct from the building: Arya 1012 and Arya 2011 already use the top-scoring photo/.test(d1.placed[0].placement.why))
ok('the check passes', marketingChecks(d1.placed, profile, twins).find(c => c.key === 'distinct').ok === true)
// A cover the host chose stands, and the check says what it costs
const kept = buildOrder(unit(), 'pool', profile, { siblings: twins })
eq('your cover is never overridden', [kept.placed[0]._id, kept.placed[0].placement.why], ['pool', 'your cover photo'])
ok('a cover the engine chose a step earlier keeps its reason', /^engine pick — bed/.test(buildOrder(unit(), 'bed', profile, { siblings: twins, enginePicked: true }).placed[0].placement.why))
const kc = marketingChecks(kept.placed, profile, twins).find(c => c.key === 'distinct')
ok('but the check fails and names the units', kc.ok === false && /Same cover photo as Arya 1012, Arya 2011/.test(kc.detail))

// A crowded scene: different pool photos, same opening
const crowd = Array.from({ length: 8 }, (_, i) => sib('Capri ' + (101 + i), [shot((i + 1).toString(16).repeat(16), i < 6 ? 'pool' : 'bedroom')]))
ok('six of eight open with the pool: one more pool cover pays', coverCrowding(unit()[0], crowd) > coverCrowding(unit()[1], crowd) + 20)
eq('this unit leads with something else', buildOrder(unit(), null, profile, { siblings: crowd }).placed[0]._id, 'bed')
ok('and says how many', /6 of 8 sister units already open with the pool/.test(buildOrder(unit(), null, profile, { siblings: crowd }).placed[0].placement.why))
const fair = Array.from({ length: 9 }, (_, i) => sib('U' + i, [shot((i + 1).toString(16).repeat(16), i < 3 ? 'pool' : i < 6 ? 'living' : 'balcony')]))
const noDistinct = unit().map(p => ({ ...p, distinct: undefined }))
eq('a third of the building may lead with one scene for free', coverCrowding(noDistinct[0], fair), 0)
eq('and then the pool still leads', buildOrder(noDistinct, null, profile, { siblings: fair }).placed[0]._id, 'pool')
ok('a shared scene costs more than a unit’s own room at the same share', (() => { const beds = crowd.map(s => ({ ...s, five: [shot(s.five[0].hash, s.five[0].scene === 'pool' ? 'bedroom' : 'pool')] })); return coverCrowding(noDistinct[0], crowd) > coverCrowding(noDistinct[1], beds) })())
ok('a photo every unit could show costs a little as cover; a unit’s own does not', coverCrowding({ ...unit()[0], hash: undefined }, [sib('X', [shot('1234123412341234', 'view')])]) > 0 && coverCrowding({ ...unit()[1], hash: undefined }, [sib('X', [shot('1234123412341234', 'view')])]) < 0)
const cc = marketingChecks(buildOrder(unit(), 'pool', profile, { siblings: crowd }).placed, profile, crowd).find(c => c.key === 'distinct')
ok('the check counts the building', cc.ok === false && /7 of the building's 9 listings open with the pool/.test(cc.detail))

// Seats 2–5
const usesRoof = [sib('A', [shot('1111111111111111', 'bedroom'), shot(H.roof, 'rooftop')]), sib('B', [shot('2222222222222222', 'living'), shot(H.roof, 'rooftop')]), sib('C', [shot('3333333333333333', 'balcony'), shot(H.roof, 'rooftop')]), sib('D', [shot('4444444444444444', 'view'), shot(H.roof, 'rooftop')])]
eq('a photo four sister units already show costs a seat', showcaseCrowding(unit()[6], usesRoof), 12)
const two = [ph('roofA', 'rooftop', 'amenity', 84, { sellingPoints: ['rooftop'], hash: H.roof }), ph('poolB', 'pool', 'amenity', 82, { sellingPoints: ['pool'], hash: H.pool2 })]
eq('alone, the stronger amenity photo takes the seat', pickShowcase(two, [], 1)[0].p._id, 'roofA')
eq('beside sister units that use it, the other one does', pickShowcase(two, [], 1, false, usesRoof)[0].p._id, 'poolB')
const rest = unit().filter(p => p._id !== 'pool').map(p => p._id === 'bed' ? { ...p, quality: 80, heroWorthy: false, sellingPoints: [] } : p)
const aloneSecond = sceneOf(pickShowcase(rest, [unit()[0]], 4)[0].p)
const allSecond = Array.from({ length: 4 }, (_, i) => sib('S' + i, [shot((i + 1).toString(16).repeat(16), 'pool'), shot((i + 5).toString(16).repeat(16), aloneSecond)]))
const picks = pickShowcase(rest, [unit()[0]], 4, false, allSecond)
ok('the first swipe is not the scene every sister unit shows second', sceneOf(picks[0].p) !== aloneSecond && picks[0].why.includes(`second here because 4 of 4 sister units show ${sceneWords(aloneSecond)} second`))
ok('and that scene is still in the five', picks.some(x => sceneOf(x.p) === aloneSecond))
const weakRest = rest.map(p => sceneOf(p) === aloneSecond ? { ...p, quality: 99 } : { ...p, quality: 62 })
eq('but a clearly stronger photo keeps the second seat', sceneOf(pickShowcase(weakRest, [unit()[0]], 4, false, allSecond)[0].p), aloneSecond)
const same5 = [sib('Twin', [shot('1111111111111111', 'view'), shot(H.bed, 'bedroom'), shot(H.living, 'living'), shot(H.kitchen, 'kitchen'), shot(H.balcony, 'balcony')])]
const sc = marketingChecks(buildOrder(unit(), null, profile).placed, profile, same5).find(c => c.key === 'distinct')
ok('three of five the same photos as one sister unit fails the check', sc.ok === false && /same photos as Twin/.test(sc.detail))
ok('the cover candidates are ranked with the building in mind', rankHeroes(unit(), 4, twins)[0]._id === 'bed' && rankHeroes(unit(), 4)[0]._id === 'pool')

console.log(`photo order: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
