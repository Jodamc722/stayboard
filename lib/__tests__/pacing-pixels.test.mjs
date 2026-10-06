// node lib/__tests__/pacing-pixels.test.mjs
// The chart MEASURER (lib/pacing-pixels). A synthetic chart drawn in PriceLabs' format — light
// gridlines, a dark x axis with tick marks, our line in rgb(51,51,51), the market line in solid
// rgb(230,62,61) and a DASH-DOT red "last year" decoy crossing above it — must be read back exactly.
// (No real PDF in this public repo: the real 17WEST pull measured 74.7% vs 60.9%, $220 vs $207.)
const P = await import('../pacing-pixels.ts')
const { measureChart } = P

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }

const W = 1800, H = 800
function chart({ ours, market, decoy }) {
  const rgb = new Uint8Array(W * H * 3).fill(255)
  const set = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (Math.round(y) * W + Math.round(x)) * 3; rgb[i] = c[0]; rgb[i + 1] = c[1]; rgb[i + 2] = c[2] }
  const thick = (x, y, c) => { for (let d = -2; d <= 2; d++) set(x, y + d, c) }
  // y: 100 at row 18, 0 at the axis row 542 → gridlines at 100/75/50/25
  const yOf = v => 542 - (v / 100) * (542 - 18)
  for (const v of [100, 75, 50, 25]) for (let x = 90; x < 1780; x++) set(x, yOf(v), [230, 230, 230])
  for (let x = 90; x < 1780; x++) { set(x, 542, [51, 51, 51]); set(x, 543, [51, 51, 51]) }
  // x: 2026-09-28 at 334.5, then every 2 days +354 → 2026-10-06 at 1750.5
  const day0 = Math.floor(Date.parse('2026-09-28T00:00:00Z') / 86400000)
  const xOf = iso => 334.5 + (Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000) - day0) * 177
  for (const d of ['2026-09-28', '2026-09-30', '2026-10-02', '2026-10-04', '2026-10-06']) for (let y = 545; y < 553; y++) { set(xOf(d), y, [51, 51, 51]); set(xOf(d) + 1, y, [51, 51, 51]) }
  for (let x = 300; x < 1779; x++) {
    const t = (x - 334.5) / 177   // days since 9/28
    thick(x, yOf(ours(t)), [51, 51, 51])
    thick(x, yOf(market(t)), [230, 62, 61])
    if (Math.floor(x / 14) % 3 !== 2) thick(x, yOf(decoy(t)), [230, 62, 61])   // dash-dot: gaps every 3rd 14px block
  }
  return { w: W, h: H, rgb }
}
const labels = { metric: 'occupancy', yTicks: [100, 75, 50, 25, 0], xDates: ['2026-09-28', '2026-09-30', '2026-10-02', '2026-10-04', '2026-10-06'] }
const ours = t => 85 - 2 * t, market = t => 70 - 1.5 * t, decoy = t => 40 + 4 * t   // decoy crosses the market line around day 4–5
const pts = measureChart(chart({ ours, market, decoy }), labels, '2026-10-01', '2026-10-06')
ok('six daily points', pts && pts.length === 6, JSON.stringify(pts))
if (pts) {
  for (const p of pts) {
    const t = (Date.parse(p.date + 'T00:00:00Z') - Date.parse('2026-09-28T00:00:00Z')) / 86400000
    ok('ours on ' + p.date + ' ≈ ' + ours(t).toFixed(1), Math.abs(p.ours - ours(t)) < 0.6, String(p.ours))
    ok('market on ' + p.date + ' ≈ ' + market(t).toFixed(1) + ' (not the dash-dot decoy)', Math.abs(p.market - market(t)) < 0.6, String(p.market))
  }
}
ok('no calibration → no reading (never a guess)', measureChart(chart({ ours, market, decoy }), { ...labels, xDates: ['2026-09-28'] }, '2026-10-01', '2026-10-06') === null)

console.log(`pacing-pixels: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
