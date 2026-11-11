// node lib/__tests__/sales-cma.test.mjs
//
// THE CHARTS AND THE NUMBERS AGREE (Jon, 2026-11-11: "make sure the data and the charts align if we
// customize them"). 400 random customizations of The Rider: building scale, plan scale, months
// dragged both ways, years set by hand. Every time: the twelve months sum to the year printed, the
// monthly average is the year over twelve, the peak is the tallest bar, nightly follows the year.
import { riderTemplate, planNumbers, setMonth, resetPlan } from '../sales-cma.ts'
const r100 = (n) => Math.round(n / 100) * 100
let fails = 0, checks = 0
const ok = (c, m) => { checks++; if (!c) { fails++; if (fails < 10) console.log('FAIL', m) } }
function verify(c, p, tag) {
  const n = planNumbers(c, p)
  const sLo = n.months.reduce((a, m) => a + m.lo, 0), sHi = n.months.reduce((a, m) => a + m.hi, 0)
  ok(sHi === n.hi, `${tag} months hi ${sHi} != year ${n.hi}`)
  ok(sLo === n.lo, `${tag} months lo ${sLo} != year ${n.lo}`)
  ok(n.monthHi === r100(n.hi / 12) && n.monthLo === r100(n.lo / 12), `${tag} monthly avg`)
  ok(n.peak === r100(Math.max(...n.months.map(m => m.hi))), `${tag} peak ${n.peak}`)
  ok(n.months.every(m => m.lo <= m.hi + 1), `${tag} a month has low above high`)
  ok(n.lo <= n.hi, `${tag} year low above high`)
  ok(n.nightlyHi === Math.round(n.hi / (365 * p.occHi / 100) / Math.max(1, p.suites)), `${tag} nightly`)
}
const c = riderTemplate()
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
for (let trial = 0; trial < 400; trial++) {
  c.adjust = Math.round(rnd() * 60 - 30)
  c.plans = c.plans.map((p) => {
    let q = resetPlan(p)
    q = { ...q, adjust: Math.round(rnd() * 80 - 40) }
    for (let k = 0; k < 4; k++) q = setMonth(c, q, Math.floor(rnd() * 12), Math.round(rnd() * 25000), rnd() < 0.5)
    if (rnd() < 0.2) q = { ...q, override: { lo: 40000 + Math.round(rnd() * 40000), hi: 90000 + Math.round(rnd() * 60000) } }
    verify(c, q, `trial ${trial} ${p.name}`)
    return q
  })
}
console.log(`sales-cma: ${checks} checks, ${fails} failures`)
if (fails) process.exit(1)
