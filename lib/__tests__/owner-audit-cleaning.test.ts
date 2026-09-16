// Cases for the cleaning-fee rule. Run: npx tsx lib/__tests__/owner-audit-cleaning.test.ts
import { cleaningGaps, cleaningNote, type CleanStay } from '../owner-audit-cleaning'

let pass = 0, fail = 0
function ok(name: string, cond: boolean, extra?: any) {
  if (cond) { pass++; return }
  fail++
  console.log('FAIL  ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''))
}

const stay = (o: Partial<CleanStay> & { resId: string; unitKey: string }): CleanStay => ({
  when: '2026-07-01', net: 0, lines: 0, hadNegative: false, ...o,
});

// ---- a unit that charges everybody: one $0 stay is the exception -------------------------------
{
  const stays: CleanStay[] = [
    stay({ resId: 'a', unitKey: 'U1', net: 150 }),
    stay({ resId: 'b', unitKey: 'U1', net: 150 }),
    stay({ resId: 'c', unitKey: 'U1', net: 160 }),
    stay({ resId: 'd', unitKey: 'U1', net: 0 }),
  ]
  const v = cleaningGaps(stays)
  ok('only the $0 stay is returned', v.length === 1 && v[0].resId === 'd', v)
  ok('called missing at high severity', v[0].kind === 'missing' && v[0].severity === 'high', v[0])
  ok('expected is the median of the charged stays', v[0].expected === 150, v[0])
  ok('peers counts the charged stays', v[0].peers === 3, v[0])
}

// ---- charged then handed back reads as refunded, not missing -----------------------------------
{
  const stays: CleanStay[] = [
    stay({ resId: 'a', unitKey: 'U1', net: 125 }),
    stay({ resId: 'b', unitKey: 'U1', net: 125 }),
    stay({ resId: 'c', unitKey: 'U1', net: 125 }),
    stay({ resId: 'd', unitKey: 'U1', net: 0, lines: 2, hadNegative: true }),
  ]
  const v = cleaningGaps(stays)
  ok('a refunded fee is named as refunded', v[0].kind === 'refunded', v[0])
}

// ---- a zero-valued line that was never a credit is still MISSING, not refunded ------------------
// Airbnb sends "Cleaning fee = 0". The line exists, nothing was ever charged, nothing given back.
{
  const stays: CleanStay[] = [
    stay({ resId: 'a', unitKey: 'U1', net: 140 }),
    stay({ resId: 'b', unitKey: 'U1', net: 140 }),
    stay({ resId: 'c', unitKey: 'U1', net: 140 }),
    stay({ resId: 'd', unitKey: 'U1', net: 0, lines: 1, hadNegative: false }),
  ]
  const v = cleaningGaps(stays)
  ok('a zero-valued line is missing, not refunded', v[0].kind === 'missing', v[0])
}

// ---- THE BOTANICA 2101 CASE: eleven bookings, one listing setting ------------------------------
{
  const stays: CleanStay[] = Array.from({ length: 11 }, (_, i) =>
    stay({ resId: 'r' + i, unitKey: 'B2101', when: '2026-07-' + String(i + 2).padStart(2, '0') }))
  const v = cleaningGaps(stays)
  ok('every stay gets a verdict', v.length === 11, v.length)
  const flagged = v.filter(x => x.severity !== 'info')
  ok('exactly one of them is flagged', flagged.length === 1, flagged.length)
  ok('the flagged one is the earliest stay', flagged[0].resId === 'r0', flagged[0])
  ok('it is a unit finding, not a booking one', flagged[0].kind === 'unit', flagged[0])
  ok('it says how many others it covers', flagged[0].siblings === 10, flagged[0])
  ok('the rest are info', v.filter(x => x.kind === 'unit_more').length === 10)
}

// ---- out-of-order input still puts the finding on the earliest stay -----------------------------
{
  const stays: CleanStay[] = [
    stay({ resId: 'late', unitKey: 'U9', when: '2026-08-20' }),
    stay({ resId: 'early', unitKey: 'U9', when: '2026-07-03' }),
    stay({ resId: 'mid', unitKey: 'U9', when: '2026-07-30' }),
  ]
  const v = cleaningGaps(stays)
  ok('earliest carries it regardless of input order', v.find(x => x.kind === 'unit')?.resId === 'early', v)
}

// ---- one charged stay is not enough to call the others wrong -----------------------------------
{
  const stays: CleanStay[] = [
    stay({ resId: 'a', unitKey: 'U2', net: 100 }),
    stay({ resId: 'b', unitKey: 'U2', net: 0 }),
  ]
  const v = cleaningGaps(stays)
  ok('a thin unit is review, not high', v[0].kind === 'thin' && v[0].severity === 'review', v[0])
  ok('peerMin is tunable', cleaningGaps(stays, { peerMin: 1 })[0].kind === 'missing')
}

// ---- units are judged on their own book, never pooled -------------------------------------------
{
  const stays: CleanStay[] = [
    stay({ resId: 'a', unitKey: 'RICH', net: 200 }),
    stay({ resId: 'b', unitKey: 'RICH', net: 200 }),
    stay({ resId: 'c', unitKey: 'RICH', net: 200 }),
    stay({ resId: 'z1', unitKey: 'POOR' }),
    stay({ resId: 'z2', unitKey: 'POOR' }),
  ]
  const v = cleaningGaps(stays)
  ok('a busy neighbour does not make POOR a booking gap',
    v.filter(x => x.resId.startsWith('z')).every(x => x.kind === 'unit' || x.kind === 'unit_more'), v)
  ok('RICH contributes nothing', !v.some(x => x.resId === 'a'), v)
}

// ---- a fully clean month returns nothing --------------------------------------------------------
{
  const v = cleaningGaps([stay({ resId: 'a', unitKey: 'U1', net: 150 }), stay({ resId: 'b', unitKey: 'U1', net: 150 })])
  ok('nothing to report when everyone paid', v.length === 0, v)
}

// ---- degenerate input is survived, not thrown on ------------------------------------------------
{
  ok('empty in, empty out', cleaningGaps([]).length === 0)
  ok('a stay with no unit is skipped', cleaningGaps([stay({ resId: 'x', unitKey: '' })]).length === 0)
  const tiny = cleaningGaps([
    stay({ resId: 'a', unitKey: 'U', net: 0.004 }),
    stay({ resId: 'b', unitKey: 'U', net: 150 }),
    stay({ resId: 'c', unitKey: 'U', net: 150 }),
    stay({ resId: 'd', unitKey: 'U', net: 150 }),
  ])
  ok('four tenths of a cent is not a cleaning fee', tiny.length === 1 && tiny[0].resId === 'a', tiny)
}

// ---- even median on an even number of charged stays ---------------------------------------------
{
  const v = cleaningGaps([
    stay({ resId: 'a', unitKey: 'U', net: 100 }),
    stay({ resId: 'b', unitKey: 'U', net: 200 }),
    stay({ resId: 'c', unitKey: 'U', net: 100 }),
    stay({ resId: 'd', unitKey: 'U', net: 200 }),
    stay({ resId: 'e', unitKey: 'U', net: 0 }),
  ])
  ok('even-count median is the midpoint', v[0].expected === 150, v[0])
}

// ---- the sentences say something a person can act on --------------------------------------------
{
  const unitV = cleaningGaps(Array.from({ length: 3 }, (_, i) => stay({ resId: 'r' + i, unitKey: 'B', when: '2026-07-0' + (i + 1) })))
  const first = unitV.find(x => x.kind === 'unit')!
  const noFee = cleaningNote(first, 'Botanica 2101', null)
  ok('unit note names the listing setting', /no cleaning fee set/i.test(noFee) && /Botanica 2101/.test(noFee), noFee)
  ok('unit note counts all three stays', /3 stays/.test(noFee), noFee)
  const withFee = cleaningNote(first, 'Botanica 2101', 150)
  ok('a configured fee points at the channel instead', /channel mapping/i.test(withFee) && /\$150\.00/.test(withFee), withFee)
  ok('a note exists for every kind', (['ok'] as const).every(() => true)
    && ['unit', 'unit_more', 'refunded', 'missing', 'thin'].every(k =>
      cleaningNote({ resId: 'x', kind: k as any, severity: 'review', expected: 150, peers: 4, siblings: 2 }, 'U', null).length > 20))
}

console.log((fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed')
if (fail) process.exit(1)
