// node lib/__tests__/pacing-check.test.mjs
// The PriceLabs pacing slide (owner reports). 17WEST October review, 2026-10-06: the model read the
// chart correctly — ours 75% / $200, market 68% / $215 — but the swap test compared it with our
// WHOLE-October occupancy (59%, unbooked weeks included), "un-swapped" a correct read, and the slide
// told the owner we trailed the market on occupancy. Our own Oct 1–6: 78% / $188.
const P = await import('../pacing-check.ts')
const { reconcilePacing, pacingWindow } = P

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const read = [{ metric: 'Occupancy', ours: '~75%', comps: '~68%', delta: '+7 pts' }, { metric: 'ADR', ours: '~$200', comps: '~$215', delta: '-$15' }]

// The window
ok('window: "Oct 01–06, 2026"', JSON.stringify(pacingWindow('Oct 01–06, 2026 pacing – vs PriceLabs ABB comp set', null, 2026)) === '{"from":"2026-10-01","to":"2026-10-06"}')
ok('window: "Aug 31–Sep 11"', JSON.stringify(pacingWindow('Aug 31–Sep 11 pacing', null, 2026)) === '{"from":"2026-08-31","to":"2026-09-11"}')
ok('window: explicit wins', JSON.stringify(pacingWindow('Oct 01–06', { from: '2026-10-02', to: '2026-10-05' }, 2026)) === '{"from":"2026-10-02","to":"2026-10-05"}')
ok('window: none', pacingWindow('Jul 2026 pacing - vs comp set', null, 2026) === null)

// The right window keeps a correct read
{
  const r = reconcilePacing(read, { occPct: 78, adr: 188 })
  const occ = r.rows.find(x => /occ/i.test(x.metric)), adr = r.rows.find(x => /adr/i.test(x.metric)), rp = r.rows.find(x => /revpar/i.test(x.metric))
  ok('Oct 1–6 truth: not swapped', occ.ours.includes('75') && occ.comps.includes('68'), JSON.stringify(r))
  ok('ADR stays ours $200 vs $215', adr.ours.includes('200') && adr.comps.includes('215'))
  ok('RevPAR derived: $150 vs $146 (+$4)', rp && rp.ours === '$150' && rp.comps === '$146' && /\+\$4/.test(rp.delta), JSON.stringify(rp))
  ok('no swap note', !r.notes.some(n => /swapped/.test(n)), JSON.stringify(r.notes))
}
// Even with the wrong (full-month) occupancy, ADR now vetoes the flip
{
  const r = reconcilePacing(read, { occPct: 59, adr: 188 })
  ok('wrong-window occupancy alone cannot flip it when ADR disagrees', r.rows.find(x => /occ/i.test(x.metric)).ours.includes('75'), JSON.stringify(r))
}
// A real swap still gets caught (both agree)
{
  const swapped = [{ metric: 'Occupancy', ours: '68%', comps: '78%', delta: '' }, { metric: 'ADR', ours: '$215', comps: '$190', delta: '' }]
  const r = reconcilePacing(swapped, { occPct: 78, adr: 188 })
  ok('a genuine swap is still corrected', r.rows.find(x => /occ/i.test(x.metric)).ours.includes('78') && r.notes.some(n => /swapped/.test(n)), JSON.stringify(r))
}

console.log(`pacing-check: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
