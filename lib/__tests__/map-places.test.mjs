// node lib/__tests__/map-places.test.mjs
import { streetOf, baseName, placesByAddress } from '../map-places.ts'
let pass = 0, fail = 0
const eq = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; console.error('FAIL', n, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b)) } }
eq('unit after street', streetOf('398 Northeast 5th Street 3707, Miami, Florida 33132, United States of America'), '398 Northeast 5th Street')
eq('tower + unit after street', streetOf('398 Northeast 5th Street Elser 2811, Miami, Florida'), '398 Northeast 5th Street')
eq('plain', streetOf('1220 17th Street, Miami Beach, Florida 33139, United States'), '1220 17th Street')
eq('highway', streetOf('905 North Federal Highway, Lake Worth Beach, Florida'), '905 North Federal Highway')
eq('street named Court', streetOf('100 Court Street Apt 4, Miami'), '100 Court Street')
eq('trailing direction kept', streetOf('2100 Ocean Drive South #12, Hallandale'), '2100 Ocean Drive South')
eq('no street word', streetOf('12 Broadway 4B, New York'), '12 Broadway 4B'.replace(' 4B', ''))
eq('base name', [baseName('Botanica 6107'), baseName('Arya 2004 FULL'), baseName('17W 504'), baseName('Elser'), baseName('17WEST')], ['Botanica', 'Arya', '17W', 'Elser', '17WEST'])
const U = (id, building, address, city, lat = 26, lng = -80) => ({ id, name: building, building, address, city, lat, lng })
const ps = placesByAddress([
  U('1', 'Botanica 6107', '3821 North Ocean Boulevard, Fort Lauderdale, Florida', 'Fort Lauderdale'), U('2', 'Botanica 6202', '3821 North Ocean Boulevard, Fort Lauderdale, Florida', 'Fort Lauderdale'),
  U('3', 'Botanica', '3621 North Ocean Boulevard, Fort Lauderdale, Florida', 'Fort Lauderdale'),
  U('4', 'Elser', '398 Northeast 5th Street 3707, Miami, Florida', 'Miami'), U('5', 'Elser', '398 Northeast 5th Street, Miami, Florida', 'Miami'), U('6', 'Elser', '398 Northeast 5th Street Elser 2811, Miami, Florida', 'Miami'),
  U('7', 'Arya 1418', '2889 McFarlane Road, Miami, Florida', 'Miami'), U('8', 'Arya 2004 FULL', '2889 Mcfarlane Road, Miami, Florida', 'Miami'),
])
eq('four addresses, not eight listings', ps.length, 4)
eq('names and counts', ps.map(p => p.name + ':' + p.units.length), ['Elser:3', 'Arya:2', 'Botanica · 3821:2', 'Botanica · 3621:1'])
eq('address shown', ps[0].address, '398 Northeast 5th Street, Miami')
console.log(`map-places: ${pass} passed, ${fail} failed`); if (fail) process.exit(1)
