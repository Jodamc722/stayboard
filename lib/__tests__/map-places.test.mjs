// node lib/__tests__/map-places.test.mjs
import { streetOf, baseName, canonStreet, placesByAddress } from '../map-places.ts'
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
eq('three properties: Botanica is one', ps.length, 3)
eq('names and counts', ps.map(p => p.name + ':' + p.units.length), ['Botanica:3', 'Elser:3', 'Arya:2'])
eq('merged address', ps[0].address, '3621 and 3821 North Ocean Boulevard, Fort Lauderdale')
eq('address shown', ps[1].address, '398 Northeast 5th Street, Miami')
const far = placesByAddress([U('1', 'Capri 1', '905 North Federal Highway, Lake Worth Beach', 'Lake Worth Beach', 26.62, -80.05), U('2', 'Capri 2', '15 South K Street, Lake Worth Beach', 'Lake Worth Beach', 26.621, -80.051), U('3', 'Capri 9', '10 Ocean Drive, Miami Beach', 'Miami Beach', 25.77, -80.13), U('4', '101', '101 Lucerne Avenue, Lake Worth Beach', 'Lake Worth Beach', 26.615, -80.057)])
eq('near ones merge, a far namesake does not, 101 is Lucerne', far.map(p => p.name + ':' + p.units.length + ':' + p.address).sort(), ['Capri · 10:1:10 Ocean Drive, Miami Beach', 'Capri · 905:2:905 North Federal Highway and 15 South K Street, Lake Worth Beach', 'Lucerne:1:101 Lucerne Avenue, Lake Worth Beach'].sort())
eq('one spelling per street', [canonStreet('101 Lucerne Ave'), canonStreet('911 N Federal Hwy'), canonStreet('398 NE 5th St.')], ['101 Lucerne Avenue', '911 North Federal Highway', '398 Northeast 5th Street'])
const ab = placesByAddress([U('1', '101', '101 Lucerne Avenue, Lake Worth Beach', 'Lake Worth Beach'), U('2', '101', '101 Lucerne Ave, Lake Worth Beach', 'Lake Worth Beach')])
eq('abbreviated and spelled out are one address', ab.map(p => p.name + ':' + p.units.length + ':' + p.address), ['Lucerne:2:101 Lucerne Avenue, Lake Worth Beach'])
console.log(`map-places: ${pass} passed, ${fail} failed`); if (fail) process.exit(1)
