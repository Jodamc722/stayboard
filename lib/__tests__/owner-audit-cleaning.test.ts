// Cases for the cleaning-fee rule. Run: npx tsx lib/__tests__/owner-audit-cleaning.test.ts
import { cleaningGaps, cleaningNote, BUNDLED_FEE_RE, type CleanStay } from '../owner-audit-cleaning'

let pass = 0, fail = 0
function ok(name: string, cond: boolean, extra?: any) {
  if (cond) { pass++; return }
  fail++
  console.log('FAIL  ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''))
}

const stay = (o: Partial<CleanStay> & { resId: string; unitKey: string }): CleanStay => ({
  when: '2026-07-01', net: 0, lines: 0, hadNegative: false, bundled: 0, ...o,
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


// ---- EXPEDIA'S LUMP IS NOT A MISSING FEE -------------------------------------------------------
// Jon, 2026-09-16: "for Expedia, sometimes the fees aren't broken out... The service is the bulk
// fees." 121 bookings from June carried a Service line averaging $162.79 and no cleaning line.
{
  const stays: CleanStay[] = [
    stay({ resId: 'a', unitKey: 'U1', net: 150 }),
    stay({ resId: 'b', unitKey: 'U1', net: 150 }),
    stay({ resId: 'c', unitKey: 'U1', net: 150 }),
    stay({ resId: 'exp', unitKey: 'U1', net: 0, bundled: 162.79 }),
  ]
  const v = cleaningGaps(stays)
  ok('the lump stay is reported, not silent', v.length === 1 && v[0].resId === 'exp', v)
  ok('it is bundled, not missing', v[0].kind === 'bundled', v[0])
  ok('it never joins the flagged count', v[0].severity === 'info', v[0])
  ok('it carries the lump amount', v[0].bundled === 162.79, v[0])
  const note = cleaningNote(v[0], 'Elser 2707', null)
  ok('the note names the lump and points at prep', /\$162\.79/.test(note) && /prep list/i.test(note), note)
  ok('the note does not call it missing', !/missing/i.test(note), note)
}

// ---- A UNIT THAT ONLY SELLS ON EXPEDIA IS NOT A BROKEN LISTING ---------------------------------
// The whole reason the lump is pulled out of the zero pile: left in, this unit would read as
// "never charged anybody" and earn a listing-setting finding on a listing that is set up right.
{
  const stays: CleanStay[] = Array.from({ length: 6 }, (_, i) =>
    stay({ resId: 'e' + i, unitKey: 'EXPONLY', net: 0, bundled: 140 }))
  const v = cleaningGaps(stays)
  ok('six lump stays, six verdicts', v.length === 6, v.length)
  ok('none of them is a unit finding', !v.some(x => x.kind === 'unit' || x.kind === 'unit_more'), v.map(x => x.kind))
  ok('nothing is flagged', v.every(x => x.severity === 'info'), v.map(x => x.severity))
}

// ---- a lump does NOT excuse a unit that also has real gaps -------------------------------------
{
  const stays: CleanStay[] = [
    stay({ resId: 'a', unitKey: 'U', net: 150 }),
    stay({ resId: 'b', unitKey: 'U', net: 150 }),
    stay({ resId: 'c', unitKey: 'U', net: 150 }),
    stay({ resId: 'exp', unitKey: 'U', net: 0, bundled: 160 }),
    stay({ resId: 'gap', unitKey: 'U', net: 0 }),
  ]
  const v = cleaningGaps(stays)
  ok('the real gap is still high', v.find(x => x.resId === 'gap')?.severity === 'high', v)
  ok('the lump is still info', v.find(x => x.resId === 'exp')?.severity === 'info', v)
  ok('the lump is not counted as a peer', v.find(x => x.resId === 'gap')?.peers === 3, v)
}

// ---- a cleaning line WINS over a lump ------------------------------------------------------------
// One booking in the real data carries both. It charged; there is nothing to say.
{
  const v = cleaningGaps([
    stay({ resId: 'a', unitKey: 'U', net: 120, bundled: 90 }),
    stay({ resId: 'b', unitKey: 'U', net: 120 }),
  ])
  ok('a stay that charged is not reported, lump or no lump', v.length === 0, v)
}

// ---- a zero or negative lump is not a lump -------------------------------------------------------
{
  const stays: CleanStay[] = [
    stay({ resId: 'a', unitKey: 'U', net: 150 }),
    stay({ resId: 'b', unitKey: 'U', net: 150 }),
    stay({ resId: 'c', unitKey: 'U', net: 150 }),
    stay({ resId: 'z', unitKey: 'U', net: 0, bundled: 0 }),
    stay({ resId: 'n', unitKey: 'U', net: 0, bundled: -50 }),
  ]
  const v = cleaningGaps(stays)
  ok('a $0 lump is still a missing fee', v.find(x => x.resId === 'z')?.kind === 'missing', v)
  ok('a reversed lump is still a missing fee', v.find(x => x.resId === 'n')?.kind === 'missing', v)
}

// ---- WHAT COUNTS AS A LUMP LINE -------------------------------------------------------------------
{
  ok('Service', BUNDLED_FEE_RE.test('Service'))
  ok('service fee', BUNDLED_FEE_RE.test('service fee'))
  ok('Service Charge', BUNDLED_FEE_RE.test('Service Charge'))
  ok('Additional Fees & Room Fees', BUNDLED_FEE_RE.test('Additional Fees & Room Fees'))
  ok('Room Fees', BUNDLED_FEE_RE.test('Room Fees'))
  // The word has to stand alone, or a pet-service or room-service charge would silence a real gap.
  ok('Service animal fee is not a lump', !BUNDLED_FEE_RE.test('Service animal fee'))
  ok('Room service is not a lump', !BUNDLED_FEE_RE.test('Room service'))
  ok('Host channel Fee is not a lump', !BUNDLED_FEE_RE.test('Host channel Fee'))
  ok('Cleaning fee is not a lump', !BUNDLED_FEE_RE.test('Cleaning fee'))
  ok('Revenue Fee is not a lump', !BUNDLED_FEE_RE.test('Revenue Fee'))
  ok('Markup is not a lump', !BUNDLED_FEE_RE.test('Markup'))
  ok('Accommodation fare is not a lump', !BUNDLED_FEE_RE.test('Accommodation fare'))
  ok('Resort fee is not a lump', !BUNDLED_FEE_RE.test('Resort fee'))
}

console.log((fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed')
if (fail) process.exit(1)
