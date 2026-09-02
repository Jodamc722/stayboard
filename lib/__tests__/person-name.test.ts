// THE GEHRON REGIS TEST.
//
// On 2026-09-02 the People board showed one man twice: once carrying nineteen maintenance jobs and
// once as "Free · On shift, nothing assigned". A coordinator reading that would have sent him work
// he had no capacity for. The cause was a name comparison that used `.toLowerCase()` and nothing
// else, so an invisible difference in whitespace made one human into two.
//
// Every case below is a shape those three systems actually produce. If one of these starts failing,
// somebody has replaced the matcher with something that looks equivalent and is not.
import { nameMatches, personKey, bestSpelling, nameMatchesRoster } from '../person-name'

const SAME: [string, string, string][] = [
  ['double space',        'Gehron Regis',      'Gehron  Regis'],
  ['trailing space',      'Gehron Regis',      'Gehron Regis '],
  ['leading space',       'Gehron Regis',      ' Gehron Regis'],
  ['non-breaking space',  'Gehron Regis',      'Gehron Regis'],
  ['case',                'Gehron Regis',      'gehron regis'],
  ['accent dropped',      'Yoslenis Pérez', 'Yoslenis Perez'],
  ['accent added',        'Jose Martínez',  'Jose Martinez'],
  ['generational suffix', 'Anthony Perry',     'Anthony Perry III'],
  ['suffix with dot',     'Anthony Perry',     'Anthony Perry Jr.'],
  ['swapped order',       'Yunisleidy Perez',  'Perez Yunisleidy'],
  ['typo in surname',     'Ana Rodriguez',     'Ana Rodiguez'],
  ['typo in first',       'Yunisleidy Perez',  'Yunisleydi Perez'],
  ['first name only',     'Roberto',           'Roberto Diaz'],
]

const DIFFERENT: [string, string, string][] = [
  ['different surname',   'Gehron Regis',      'Gehron Alvarez'],
  ['different people',    'Ana Rodriguez',     'Marta Rodriguez'],
  ['empty vs name',       '',                  'Gehron Regis'],
  ['both empty',          '',                  ''],
]

let failed = 0
for (const [why, a, b] of SAME) {
  if (!nameMatches(a, b)) { console.log(`FAIL same (${why}): ${JSON.stringify(a)} vs ${JSON.stringify(b)}`); failed++ }
}
for (const [why, a, b] of DIFFERENT) {
  if (nameMatches(a, b)) { console.log(`FAIL different (${why}): ${JSON.stringify(a)} vs ${JSON.stringify(b)}`); failed++ }
}

// personKey groups; it is allowed to be stricter than nameMatches (it cannot forgive a typo),
// but it must never disagree on the invisible-difference cases, because those are what broke.
const KEY_SAME = SAME.filter(([why]) => !/typo|swapped|first name only/.test(why))
for (const [why, a, b] of KEY_SAME) {
  if (personKey(a) !== personKey(b)) { console.log(`FAIL key (${why}): ${JSON.stringify(personKey(a))} vs ${JSON.stringify(personKey(b))}`); failed++ }
}
if (personKey('Gehron Regis') === personKey('Gehron Alvarez')) { console.log('FAIL key collapsed two people'); failed++ }

// The display spelling keeps the fuller name, so a row never loses a surname it had.
if (bestSpelling('Roberto', 'Roberto Diaz') !== 'Roberto Diaz') { console.log('FAIL bestSpelling'); failed++ }
if (bestSpelling('Gehron  Regis', '') !== 'Gehron Regis') { console.log('FAIL bestSpelling trim'); failed++ }

// Maiden/married drift resolves only when it is unambiguous.
if (nameMatchesRoster('Shaany Espinoza', ['Shaany Christian', 'Ana Rodriguez']) !== 'Shaany Christian') { console.log('FAIL roster drift'); failed++ }
if (nameMatchesRoster('Maria Lopez', ['Maria Gomez', 'Maria Santos']) !== null) { console.log('FAIL roster ambiguity should not resolve'); failed++ }

console.log(failed === 0 ? `person-name: all ${SAME.length + DIFFERENT.length + KEY_SAME.length + 5} checks passed` : `person-name: ${failed} FAILED`)
if (failed) process.exit(1)
