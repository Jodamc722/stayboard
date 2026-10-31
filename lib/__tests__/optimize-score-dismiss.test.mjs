// npx tsx lib/__tests__/optimize-score-dismiss.test.mjs
const { computeScore, scoreGaps } = await import('../optimize-score.ts')
let pass = 0, fail = 0
const ok = (n, c, extra = '') => { if (c) pass++; else { fail++; console.log('  FAIL', n, extra) } }
const base = {
  title: 'Boynton Beach Cottage | King Bed & Patio Near Beach', address_city: 'Boynton Beach', building: 'Boynton - 2', nickname: 'Boynton - 2',
  amenities: ['Wifi', 'Air conditioning', 'Kitchen', 'Free parking on premises', 'Self check-in', 'Smoke alarm', 'Carbon monoxide alarm', 'TV'],
  raw: {
    publicDescription: { summary: 'x'.repeat(480), space: 'y'.repeat(800), neighborhood: '- a 5 min\n- b 6 min\n- c 7 min\n- d 8 min' },
    pictures: [{ _id: 'p1', caption: 'Pool deck with loungers and palms' }, { _id: 'p2', caption: 'Bedroom with bed and window' }],
    _photoIndex: { p1: { kind: 'property', room: 'pool', category: 'amenity', amenitiesSeen: ['Pool', 'BBQ grill'], sellingPoints: ['pool'] }, p2: { kind: 'property', room: 'bedroom-1', category: 'bedroom', amenitiesSeen: [], sellingPoints: [] } },
  },
}
const a = computeScore(base)
ok('pool seen but not listed -> finding', a.amenities.audit.seenMissing.some(x => x.name === 'Pool'))
ok('suggestions include pool', a.amenities.suggestions.some(x => x.name === 'Pool'))
const b = computeScore({ ...base, raw: { ...base.raw, _amenityDismissed: ['Pool', 'BBQ grill', 'Hot tub', 'Washer', 'Dryer', 'Gym'] } })
ok('dismissed pool not a finding', !b.amenities.audit.seenMissing.some(x => x.name === 'Pool'))
ok('dismissed pool not suggested', !b.amenities.suggestions.some(x => x.name === 'Pool'))
ok('dismissing raises amenity score', b.amenities.score > a.amenities.score, `${a.amenities.score} -> ${b.amenities.score}`)
ok('overall rises', b.overall >= a.overall, `${a.overall} -> ${b.overall}`)
const ga = scoreGaps(a)
ok('amenity ideas are recommend, not fix', ga.filter(g => g.label === 'Recommended amenities').every(g => g.kind === 'recommend'))
ok('photo-seen gap present before', ga.some(g => g.label === 'Amenities your photos show'))
ok('photo-seen gap gone after dismiss', !scoreGaps(b).some(g => g.label === 'Amenities your photos show'))
ok('title location from city', a.title.factors.find(f => f.label === 'Specific location').got === 20)
console.log(`optimize-score-dismiss: ${pass} passed, ${fail} failed`); if (fail) process.exit(1)
