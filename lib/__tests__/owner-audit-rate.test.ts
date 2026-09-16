// THE LENGTH DISCOUNT — the reason low-rate was flagging every monthly booking.
//
// These cases are the argument for the weights. The real portfolio numbers they are built from are
// in the header of lib/owner-audit-rate.ts.
import { lengthBand, lengthFactors, expectedForLength, lengthNote, NEUTRAL_FACTORS, BAND_MIN_SAMPLES } from '../owner-audit-rate'

let fail = 0
const eq = (label: string, got: any, want: any) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) { console.log('FAIL', label, '\n  got ', g, '\n  want', w); fail++ } else console.log('ok  ', label)
}
const ok = (label: string, cond: boolean) => eq(label, !!cond, true)
const many = (n: number, nights: number, nightly: number) => Array.from({ length: n }, () => ({ nights, nightly }))

// ── the bands are the ones people price in ─────────────────────────────────────────────────────
eq('a weekend is short', lengthBand(2), 'short')
eq('six nights is still short', lengthBand(6), 'short')
eq('seven is a week', lengthBand(7), 'week')
eq('a fortnight is extended', lengthBand(14), 'extended')
eq('28 is monthly', lengthBand(28), 'monthly')
eq('nonsense is short, not a crash', lengthBand(NaN as any), 'short')

// ── the portfolio's real shape reproduces its real factors ─────────────────────────────────────
{
  const f = lengthFactors([
    ...many(400, 3, 157), ...many(60, 9, 106), ...many(30, 20, 101), ...many(20, 30, 78),
  ])
  eq('short is the baseline', f.short, 1)
  ok('a week lands near 68%', Math.abs(f.week - 0.675) < 0.02)
  ok('a month lands near 49%', Math.abs(f.monthly - 0.497) < 0.02)
  ok('every factor is a discount', f.week < 1 && f.extended < 1 && f.monthly < 1)
}

// ── THE BUG THIS EXISTS TO FIX ─────────────────────────────────────────────────────────────────
{
  const f = lengthFactors([...many(400, 3, 157), ...many(20, 30, 78)])
  const cohort = 157            // the cohort average, made mostly of short stays
  const booking = 78            // a perfectly normal monthly rate
  const before = Math.round((booking / cohort) * 100)
  const after = Math.round((booking / expectedForLength(cohort, 30, f)) * 100)
  ok('before: a normal monthly booking reads as 50% of expected — under the 55% bar', before < 55)
  ok('after: it reads as ~100% and does not fire', after >= 95)
}

// ── a genuinely bad monthly booking must STILL fire ────────────────────────────────────────────
{
  const f = lengthFactors([...many(400, 3, 157), ...many(20, 30, 78)])
  const pct = Math.round((35 / expectedForLength(157, 30, f)) * 100)
  ok('$35/night on a month is still far under the bar', pct < 55)
}

// ── a thin band keeps the neutral 1 rather than inventing a discount ───────────────────────────
{
  const f = lengthFactors([...many(400, 3, 157), ...many(BAND_MIN_SAMPLES - 1, 30, 78)])
  eq('too few monthly bookings to have an opinion', f.monthly, 1)
  eq('and the expected rate is untouched', expectedForLength(200, 30, f), 200)
}

// ── no baseline, no ratios ─────────────────────────────────────────────────────────────────────
eq('no short stays means neutral', lengthFactors(many(50, 30, 78)), NEUTRAL_FACTORS)
eq('nothing at all means neutral', lengthFactors([]), NEUTRAL_FACTORS)

// ── one huge corporate month must not move the number ──────────────────────────────────────────
{
  const median = lengthFactors([...many(400, 3, 157), ...many(20, 30, 78), { nights: 30, nightly: 9000 }])
  ok('the median ignores the outlier', Math.abs(median.monthly - 0.497) < 0.02)
}

// ── guard rails ────────────────────────────────────────────────────────────────────────────────
{
  const absurd = lengthFactors([...many(400, 3, 200), ...many(20, 30, 2)])
  ok('a factor never goes below the floor', absurd.monthly >= 0.35)
  const rich = lengthFactors([...many(400, 3, 100), ...many(20, 30, 900)])
  ok('nor above the ceiling', rich.monthly <= 1.15)
}

// ── refunded and comped nights are not market rate ─────────────────────────────────────────────
{
  const f = lengthFactors([...many(400, 3, 157), ...many(20, 30, 78), ...many(40, 30, 0)])
  ok('zero-value nights are ignored', Math.abs(f.monthly - 0.497) < 0.02)
}

// ── the sentence only appears when it is worth saying ──────────────────────────────────────────
{
  const f = lengthFactors([...many(400, 3, 157), ...many(20, 30, 78)])
  eq('nothing to explain on a short stay', lengthNote(3, f), '')
  ok('a monthly stay says why expected moved', /monthly stays/.test(lengthNote(30, f)))
  eq('a neutral factor says nothing', lengthNote(30, NEUTRAL_FACTORS), '')
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed')
process.exit(fail ? 1 : 0)
