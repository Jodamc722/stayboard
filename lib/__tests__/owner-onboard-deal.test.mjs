// node lib/__tests__/owner-onboard-deal.test.mjs
// THE DEAL ON AN OWNER ONBOARDING (lib/owner-onboard-deal.ts): the live date sales set and the management fee, how they
// are cleaned on the way in, and the order the owners list is worked in (soonest live date first).
const { cleanDeal, daysToLive, liveIn, feeLabel, byLiveDate } = await import('../owner-onboard-deal.ts')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + ' vs ' + JSON.stringify(b))

eq('a new deal', cleanDeal({ liveDate: '2026-12-05', fee: 15 }), { liveDate: '2026-12-05', fee: 15 })
eq('nothing given', cleanDeal(undefined), { liveDate: '', fee: null })
eq('a bad date is dropped', cleanDeal({ liveDate: '12/05/2026', fee: '18.5' }), { liveDate: '', fee: 18.5 })
eq('only the date changes', cleanDeal({ liveDate: '2026-12-10' }, { liveDate: '2026-12-05', fee: 20 }), { liveDate: '2026-12-10', fee: 20 })
eq('only the fee changes', cleanDeal({ fee: 12 }, { liveDate: '2026-12-05', fee: 20 }), { liveDate: '2026-12-05', fee: 12 })
eq('the date can be cleared', cleanDeal({ liveDate: '' }, { liveDate: '2026-12-05', fee: 20 }), { liveDate: '', fee: 20 })
eq('the fee can be cleared', cleanDeal({ fee: null }, { liveDate: '2026-12-05', fee: 20 }), { liveDate: '2026-12-05', fee: null })
eq('a fee over 100 keeps the old one', cleanDeal({ fee: 150 }, { liveDate: '', fee: 20 }), { liveDate: '', fee: 20 })
eq('a zero fee is a fee', cleanDeal({ fee: 0 }), { liveDate: '', fee: 0 })

const now = new Date('2026-11-20T15:00:00Z')   // 10 am Eastern
eq('today', daysToLive('2026-11-20', now), 0)
eq('in 15 days', daysToLive('2026-12-05', now), 15)
eq('passed', daysToLive('2026-11-17', now), -3)
eq('no date', daysToLive('', now), null)
eq('late evening Eastern is still the same day', daysToLive('2026-11-20', new Date('2026-11-21T03:30:00Z')), 0)
eq('words', [liveIn(0), liveIn(1), liveIn(15), liveIn(-3)], ['today', 'tomorrow', 'in 15 days', '3 days ago'])
eq('fee words', [feeLabel(15), feeLabel(18.5), feeLabel(null), feeLabel(0)], ['15%', '18.5%', '', '0%'])

const rows = [
  { code: 'none-old', liveDate: '', stage: 'Home details', updatedAt: '2026-11-01' },
  { code: 'dec', liveDate: '2026-12-05', stage: 'Home details', updatedAt: '2026-11-02' },
  { code: 'live', liveDate: '2026-10-01', stage: 'Live', updatedAt: '2026-11-19' },
  { code: 'nov', liveDate: '2026-11-25', stage: 'Photos', updatedAt: '2026-11-03' },
  { code: 'none-new', liveDate: '', stage: 'Home details', updatedAt: '2026-11-18' },
  { code: 'arch', liveDate: '2026-11-21', stage: 'Photos', archived: true, updatedAt: '2026-11-10' },
]
eq('soonest first, undated next (newest first), live and archived last', [...rows].sort(byLiveDate).map(r => r.code), ['nov', 'dec', 'none-new', 'none-old', 'live', 'arch'])

console.log(`owner-onboard-deal: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
