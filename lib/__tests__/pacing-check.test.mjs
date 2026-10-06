// node lib/__tests__/pacing-check.test.mjs
// The PriceLabs pacing slide (owner reports). 17WEST October review, 2026-10-06: the model read the
// chart correctly — ours 75% / $200, market 68% / $215 — but the swap test compared it with our
// WHOLE-October occupancy (59%, unbooked weeks included), "un-swapped" a correct read, and the slide
// told the owner we trailed the market on occupancy. Our own Oct 1–6: 78% / $188.
const P = await import('../pacing-check.ts')
const { reconcilePacing, pacingWindow, seriesRows, crossCheckAdr } = P

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const read = [{ metric: 'Occupancy', ours: '~75%', comps: '~68%', delta: '+7 pts' }, { metric: 'ADR', ours: '~$200', comps: '~$215', delta: '-$15' }]

// The window
ok('window: "Oct 01–06, 2026"', JSON.stringify(pacingWindow('Oct 01–06, 2026 pacing – vs PriceLabs ABB comp set', null, 2026)) === '{"from":"2026-10-01","to":"2026-10-06"}')
ok('window: "Aug 31–Sep 11"', JSON.stringify(pacingWindow('Aug 31–Sep 11 pacing', null, 2026)) === '{"from":"2026-08-31","to":"2026-09-11"}')
ok('window: printed dates beat the model\'s window', JSON.stringify(pacingWindow('Oct 01–06, 2026', { from: '2026-09-28', to: '2026-10-06' }, 2026)) === '{"from":"2026-10-01","to":"2026-10-06"}')
ok('window: explicit used when nothing printed', JSON.stringify(pacingWindow('Jul pacing', { from: '2026-07-01', to: '2026-07-31' }, 2026)) === '{"from":"2026-07-01","to":"2026-07-31"}')
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

// THE ACTUAL PDF (PortfolioAnalytics-October_6_2026.pdf), read point by point off the Pacing vs Market
// charts for Oct 1–6: ours occupancy ~80→68, market ~64→57; ours ADR ~212→230, market ~207→205.
{
  const w = { from: '2026-10-01', to: '2026-10-06' }
  const series = {
    occupancy: [['2026-09-30', 82, 66], ['2026-10-01', 80, 64], ['2026-10-02', 79, 63], ['2026-10-03', 77, 62], ['2026-10-04', 74, 60], ['2026-10-05', 71, 59], ['2026-10-06', 68, 57]].map(([date, ours, market]) => ({ date, ours, market })),
    adr: [['2026-10-01', 212, 207], ['2026-10-02', 213, 207], ['2026-10-03', 215, 206], ['2026-10-04', 219, 206], ['2026-10-05', 225, 205], ['2026-10-06', 230, 205]].map(([date, ours, market]) => ({ date, ours, market })),
  }
  const rows = seriesRows(series, w)
  ok('series: occupancy averaged inside the window only (Sep 30 ignored)', rows && rows[0].ours === '~75%' && rows[0].comps === '~61%', JSON.stringify(rows))
  ok('series: ADR averaged', rows && rows[1].ours === '~$219' && rows[1].comps === '~$206', JSON.stringify(rows))
  const r = reconcilePacing(rows, { occPct: 78, adr: 188 })
  const rp = r.rows.find(x => /revpar/i.test(x.metric))
  ok('ahead across the board', r.ahead === true, JSON.stringify(r))
  ok('RevPAR ≈ the PDF RevPAR chart (~$164 vs ~$124)', rp && /\$16[3-6]/.test(rp.ours) && /\$12[4-7]/.test(rp.comps), JSON.stringify(rp))
  ok('no swap on a correct read', !r.notes.some(n => /swapped/.test(n)))
}
ok('series: fewer than two points → no series', seriesRows({ occupancy: [{ date: '2026-10-01', ours: 80, market: 60 }] }, null) === null)

// THE LIVE READER ON THIS PDF (2026-10-06): occupancy right, ADR lines flipped ($205 vs $221).
// The PDF's own RevPAR chart (~$164 vs ~$124) only fits occupancy x ADR the other way round.
{
  const live = [{ metric: 'Occupancy', ours: '~77%', comps: '~63%', delta: '' }, { metric: 'ADR', ours: '~$205', comps: '~$221', delta: '' }]
  const x = crossCheckAdr(live, { o: 164, m: 124 })
  ok('ADR exchanged by the RevPAR cross-check', x.rows[1].ours === '~$221' && x.rows[1].comps === '~$205' && /exchanged/.test(x.note || ''), JSON.stringify(x))
  const good = [{ metric: 'Occupancy', ours: '~75%', comps: '~61%', delta: '' }, { metric: 'ADR', ours: '~$219', comps: '~$206', delta: '' }]
  ok('a correct ADR read is left alone', crossCheckAdr(good, { o: 164, m: 124 }).note === null)
  ok('no RevPAR series → no change', crossCheckAdr(live, null).note === null)
}

console.log(`pacing-check: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
