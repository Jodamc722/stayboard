// node lib/eve/__tests__/domain-guess.test.mjs
// The keyword vote that opens a tool drawer before Eve's first turn (lib/eve/domain-guess.ts).
const { guessDomains } = await import('../domain-guess.ts')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const first = (q) => guessDomains(q)[0] || null

console.log('\ndomain guess')
ok('clean status → ops', first("what's the status on the 401 clean?") === 'ops')
ok('spanish clean → ops', first('ya terminé la limpieza del 502, qué sigue?') === 'ops')
ok('inspection → ops', first('did anyone walk the inspection on Elser 1703') === 'ops')
ok('who usually cleans → ops', first('who usually cleans Elser and how long does it take') === 'ops')
ok('payout → money', first('what was the September payout for Capri 112') === 'money')
ok('occupancy → money', first('occupancy and ADR for Miami last month') === 'money')
ok('review → quality', first('any new reviews under 3 stars this week?') === 'quality')
ok('clocked in → labor', first("who's clocked in right now in Broward") === 'labor')
ok('guest message → guests', first('did the guest in 17WEST 510 reply to our message') === 'guests')
ok('welcome calls → guests', first('how many welcome calls are left today') === 'guests')
ok('slack channel → slack', first('what did the team say in #vr-miami-hk about the elevator') === 'slack')
ok('wifi → property', first('what is the wifi password for Arya 1002') === 'property')
ok('automation → system', first('is the trash sweep automation on and when did it last run') === 'system')
ok('replace the AC → ops', first('should we replace the A/C at Arya 1705, it keeps breaking') === 'ops')
ok('repeat failures → ops', first('any repeat failures in Broward?') === 'ops')
ok('cost most to maintain → ops', guessDomains('which units cost the most to maintain per occupied night at Eden').includes('ops'))
ok('owner → money', first('how is owner Smith doing this year') === 'money')
ok('repeat guest is not upkeep', !guessDomains('is she a repeat guest?').includes('ops'))
ok('nothing → none', guessDomains('thank you!').length === 0)
ok('greeting → none', guessDomains('hola Eve').length === 0)
ok('two strong → two', (() => { const d = guessDomains('is the clean on 401 done and did the guest message us about arrival'); return d.length === 2 && d.includes('ops') && d.includes('guests') })())
ok('never more than two', guessDomains('clean review payout clocked guest slack wifi automation').length <= 2)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
