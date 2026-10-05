// node lib/__tests__/schedule-suggest.test.mjs
//
// THE MARKET IS A WALL (Jon, 2026-10-05: "the suggest schedule is not working correctly putting
// Broward staff in Miami"). A Broward cleaner is never handed a Miami clean while anyone from Miami
// has room; when nobody in the market can take it, the suggester crosses and says so.
// Plain node, no deps: lib/schedule-suggest.ts has no imports.
const S = await import('../schedule-suggest.ts')
const { suggestSchedule } = S

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }

const clean = (key, market, hub, extra = {}) => ({ key, listingId: key, unit: key, market, hub, lat: null, lng: null, bedrooms: 1, sameDayTurn: false, minutes: 100, currentIds: [], ...extra })
const person = (id, name, market, extra = {}) => ({ id, name, market, capacityMin: 414, role: 'cleaner', ...extra })

// 1. Four Miami cleans in one building, one Miami cleaner with room and one Broward cleaner already
//    "out" in Broward. Before the fix "already out" (+600) and the −900 nudge fought; now Broward never gets one.
{
  const cleans = [clean('m1', 'Miami', 'Arya'), clean('m2', 'Miami', 'Arya'), clean('m3', 'Miami', 'Arya'), clean('b1', 'Broward', 'Eden', { currentIds: [2] })]
  const people = [person(1, 'Maria Miami', 'Miami'), person(2, 'Berta Broward', 'Broward')]
  const s = suggestSchedule(cleans, people, { keepCurrent: true })
  ok('Miami cleans go to the Miami cleaner', ['m1', 'm2', 'm3'].every(k => s.assign[k] === 1), JSON.stringify(s.assign))
  ok('the Broward clean stays with Broward', s.assign.b1 === 2)
}

// 2. Miami is full (one cleaner, five cleans beyond her day even with overtime): the extra clean
//    crosses from Broward, and the card says why.
{
  const cleans = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map(k => clean(k, 'Miami', 'Arya', { minutes: 120 }))
  const people = [person(1, 'Maria Miami', 'Miami'), person(2, 'Berta Broward', 'Broward')]
  const s = suggestSchedule(cleans, people, { keepCurrent: false, targetCleans: 4, overtimeMin: 60 })
  const toBerta = Object.keys(s.assign).filter(k => s.assign[k] === 2)
  ok('Miami fills first', Object.keys(s.assign).filter(k => s.assign[k] === 1).length >= 3, JSON.stringify(s.assign))
  ok('the overflow crosses from Broward', toBerta.length > 0, JSON.stringify(s.assign))
  ok('and the card says the market ran out of room', toBerta.every(k => /nobody in Miami had room/.test(s.why[k]) && /crosses from Broward/.test(s.why[k])), JSON.stringify(s.why))
}

// 3. No known market: the first clean settles it for the day, then the wall applies.
{
  const cleans = [clean('b1', 'Broward', 'Eden'), clean('b2', 'Broward', 'Eden'), clean('m1', 'Miami', 'Arya')]
  const people = [person(1, 'Nadia New', null), person(2, 'Maria Miami', 'Miami')]
  const s = suggestSchedule(cleans, people, { keepCurrent: false })
  ok('the unknown person takes Broward', s.assign.b1 === 1 && s.assign.b2 === 1, JSON.stringify(s.assign))
  ok('and does not then wander into Miami', s.assign.m1 === 2, JSON.stringify(s.assign))
}

// 4. A caller-known market beats where today's current cleans happen to be.
{
  const cleans = [clean('m1', 'Miami', 'Arya', { currentIds: [2] }), clean('m2', 'Miami', 'Arya'), clean('m3', 'Miami', 'Arya')]
  const people = [person(1, 'Maria Miami', 'Miami'), person(2, 'Berta Broward', 'Broward')]
  const s = suggestSchedule(cleans, people, { keepCurrent: true })
  ok('kept assignment is honoured', s.assign.m1 === 2)
  ok('but the Broward cleaner is not handed more Miami while Miami has room', s.assign.m2 === 1 && s.assign.m3 === 1, JSON.stringify(s.assign))
}

// 5. A clean already started (or finished) in Breezeway stays put, even with "Keep current" off
//    (Jon, 2026-10-05: "make sure it shows in progress if task is started").
{
  const cleans = [
    clean('m1', 'Miami', 'Arya', { currentIds: [2], taskStatus: 'in_progress' }),
    clean('m2', 'Miami', 'Arya', { currentIds: [2], taskStatus: 'completed' }),
    clean('m3', 'Miami', 'Arya', { currentIds: [9], taskStatus: 'in_progress' }),
  ]
  const people = [person(1, 'Maria Miami', 'Miami'), person(2, 'Yuni Miami', 'Miami')]
  const s = suggestSchedule(cleans, people, { keepCurrent: false })
  ok('in progress stays with the person doing it', s.assign.m1 === 2 && /in progress/.test(s.why.m1), JSON.stringify(s))
  ok('finished stays too', s.assign.m2 === 2 && s.why.m2 === 'finished')
  ok('started by someone off the board is not handed to anyone else', s.assign.m3 === null && /not on this board/.test(s.why.m3))
}

// 6. ONE CLEANER PER BUILDING (Jon, 2026-10-05: "should pick the same cleaner per building,
//    shouldn't space it out"). Tomorrow's real case: Vilma already out in Eden, Maribel free —
//    the two Rustic cleans went one each. Now the whole building goes to Maribel.
{
  const cleans = [
    clean('e1', 'Broward', 'Eden', { minutes: 85 }), clean('e2', 'Broward', 'Eden', { minutes: 85 }), clean('e3', 'Broward', 'Eden', { minutes: 85 }),
    clean('r1', 'Broward', 'Rustic', { minutes: 100 }), clean('r2', 'Broward', 'Rustic', { minutes: 100 }),
  ]
  const people = [person(1, 'vilma martinez', 'Broward'), person(2, 'Maribel Alvarez', 'Broward')]
  const s = suggestSchedule(cleans, people, { keepCurrent: false })
  const who = k => s.assign[k]
  ok('Eden stays with one cleaner', who('e1') === who('e2') && who('e2') === who('e3'), JSON.stringify(s.assign))
  ok('Rustic stays with one cleaner', who('r1') === who('r2'), JSON.stringify(s.assign))
  ok('and the card says so', /all 2 in Rustic, one cleaner/.test(s.why.r1), s.why.r1)
}
// 7. Too big for one person → as few hands as possible, biggest share first, and it says why.
{
  const cleans = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map(k => clean(k, 'Miami', 'Arya', { minutes: 110 }))
  const people = [person(1, 'Yuni Miami', 'Miami'), person(2, 'Ely Miami', 'Miami'), person(3, 'Third Miami', 'Miami')]
  const s = suggestSchedule(cleans, people, { keepCurrent: false })
  const used = new Set(Object.values(s.assign).filter(v => v != null))
  ok('six long cleans split across two people, not three', used.size === 2, JSON.stringify(s.assign))
  ok('split cards explain it', Object.values(s.why).some(w => /of 6 in Arya — nobody had room for all/.test(w)), JSON.stringify(s.why))
}

// 8. LOCATION DENSITY (Jon, 2026-10-05: "the scheduler needs to think about location density").
//    Real geography: Hendricks is ~1.8 km from Eden; Pelican is ~13.5 km away in the north cluster.
//    Vilma has Eden; the nearby Hendricks clean goes to her, Pelican goes to the fresh person.
{
  const at = (lat, lng) => ({ lat, lng })
  const EDEN = at(25.9870, -80.1180), HEND = at(26.0030, -80.1200), PEL = at(26.1080, -80.1050)
  const cleans = [
    clean('e1', 'Broward', 'Eden', { minutes: 85, ...EDEN }), clean('e2', 'Broward', 'Eden', { minutes: 85, ...EDEN }),
    clean('h1', 'Broward', 'Hendricks', { minutes: 85, ...HEND }),
    clean('p1', 'Broward', 'Pelican', { minutes: 85, ...PEL }),
  ]
  const people = [person(1, 'vilma martinez', 'Broward'), person(2, 'Maribel Alvarez', 'Broward')]
  const s = suggestSchedule(cleans, people, { keepCurrent: false })
  const v = s.assign.e1
  ok('Eden together', s.assign.e2 === v, JSON.stringify(s.assign))
  ok('nearby Hendricks joins the Eden run', s.assign.h1 === v, JSON.stringify(s.assign))
  ok('far-off Pelican goes to the other cleaner', s.assign.p1 != null && s.assign.p1 !== v, JSON.stringify(s.assign))
  ok('the card says why', /near Eden \(2 km\)/.test(s.why.h1), s.why.h1)
}

console.log(`schedule-suggest: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
