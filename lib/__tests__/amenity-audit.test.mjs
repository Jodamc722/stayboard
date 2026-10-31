// npx tsx lib/__tests__/amenity-audit.test.mjs
const { auditAmenities } = await import('../amenity-audit.ts')
let pass = 0, fail = 0
const eq = (n, g, w) => { if (JSON.stringify(g) === JSON.stringify(w)) pass++; else { fail++; console.log('  FAIL', n, '\n   got ', JSON.stringify(g), '\n   want', JSON.stringify(w)) } }
const idx = {
  a: { kind: 'property', room: 'kitchen', category: 'kitchen', amenitiesSeen: ['Toaster', 'Coffee maker'], sellingPoints: [] },
  b: { kind: 'property', room: 'balcony', category: 'outdoor', amenitiesSeen: [], sellingPoints: ['balcony'] },
  c: { kind: 'property', room: 'bedroom-1', category: 'bedroom', amenitiesSeen: [], sellingPoints: ['workspace'] },
  d: { kind: 'stock', room: 'pool', category: 'amenity', amenitiesSeen: ['Pool'], sellingPoints: ['pool'] },
  e: { kind: 'property', room: 'living', category: 'living', amenitiesSeen: ['TV'], sellingPoints: [] },
  f: { kind: 'property', room: 'bath-primary', category: 'bathroom', amenitiesSeen: [], sellingPoints: [] },
}
const r = auditAmenities(['Coffee maker', 'Pool', 'Wifi', 'TV', 'Garage'], idx, ['a', 'b', 'c', 'd', 'e', 'f'], 'Free on-site parking lot, one space per reservation.')
eq('analyzed skips stock', r.analyzed, 5)
eq('seen missing', r.seenMissing.map(x => x.name).sort(), ['Dedicated workspace', 'Patio or balcony', 'Toaster'])
eq('pool listed, only stock shows it', r.listedNoPhoto.map(x => x.name), ['Pool'])
eq('garage conflict', r.conflicts.map(x => x.name), ['Garage'])
const r2 = auditAmenities(['Balcony', 'Garage'], idx, [], 'Secured garage on site.')
eq('balcony listed counts for patio-or-balcony', r2.seenMissing.some(x => x.name === 'Patio or balcony'), false)
eq('garage fine when facts say garage', r2.conflicts.length, 0)
eq('no index, no findings', auditAmenities(['Pool'], null).listedNoPhoto.length, 0)
console.log(`amenity-audit: ${pass} passed, ${fail} failed`); if (fail) process.exit(1)
