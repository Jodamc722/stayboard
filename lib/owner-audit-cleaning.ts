// EVERY RESERVATION SHOULD CARRY A CLEANING FEE — AND WHERE ONE DOESN'T, SAY WHOSE PROBLEM IT IS.
//
// Jon, 2026-09-16: "Yes all reservations shoould have a cleaning fee" and, on the eleven
// Booking.com stays that had none, "look at other booking.com units, if there is a fee it could
// be missing or refunded? It should be flagged."
//
// He was right that the first check was too weak. It asked only whether a line TITLED "clean"
// existed. A fee that is charged and then refunded leaves the line behind, so presence-only
// reported zero missing fees on Airbnb while forty-two Airbnb stays actually collected nothing.
// Netting the cleaning lines instead of counting them is what this module is for.
//
// WHAT THE BOOK ACTUALLY SHOWS (Jul 1 – Aug 31 2026, 1,919 live bookings, netted not counted):
//
//   airbnb2       1,360     0 with no line      42 netting $0      1,318 charged
//   booking.com     272    11 with no line       0 netting $0        261 charged
//   expedia         130     0                    0                   130 charged
//   vrbo             70 · hotels.com 28 · expedia affiliate 11 — every one charged
//   be-api           21     0                    1 netting $0         20 charged
//   manual           11     7                    0                     4
//   owner 8 · owner-guest 8 — none, which is the separate owner-stay rule
//
// And then the part that decides the shape of this rule. Fifty guest stays collected no cleaning
// fee, and they are not fifty problems:
//
//   Botanica 2201 — 28 Airbnb stays, $0 on ALL 28, no cleaningFee set on the Guesty listing
//   Botanica 2101 — 11 Booking.com stays, $0 on ALL 11, no cleaningFee set on the Guesty listing
//   Botanica 1103 — 13 Airbnb stays Jul 5 – Aug 5 at $0, on a unit that charges on its others
//   Elser 2707 (be-api) and Elser 3707 (airbnb2) — one stay each, same story
//
// So the eleven Booking.com bookings Jon asked about are not a Booking.com convention and not
// eleven findings: they are ONE unit with no fee configured. Flagging them one by one would put
// thirty-nine rows on the board for two listing settings, and the board is already the thing he
// finds noisy. The unit is the finding when the unit never charges; the booking is the finding
// when its own unit charges everybody else.
//
// Nothing here writes to Guesty. The fix for a unit that never charges is a listing setting; the
// fix for one stay is a folio line — both are done in Guesty by a person, which is the rule.

/** One stay's cleaning position, already netted by the caller. */
export type CleanStay = {
  resId: string
  unitKey: string               // listing id — the grouping that matters
  when: string                  // check-in, ISO date; picks which stay carries a unit finding
  net: number                   // sum of every cleaning-ish folio line, refunds included
  lines: number                 // how many such lines exist (0 = none was ever raised)
  hadNegative: boolean          // at least one cleaning line is a credit — charged, then given back
}

export type CleanVerdictKind =
  | 'ok'            // charged something; nothing to say
  | 'missing'       // no fee, and this unit charges on its other stays — a real gap
  | 'refunded'      // a fee was raised and handed back, on a unit that charges its others
  | 'thin'          // no fee, and the unit has charged before but too rarely to be sure
  | 'unit'          // no fee anywhere on this unit — the listing is the finding
  | 'unit_more'     // same unit, another stay; carried as info so it never doubles the count

export type CleanVerdict = {
  resId: string
  kind: CleanVerdictKind
  severity: 'high' | 'review' | 'info'
  expected: number | null       // what this unit normally collects, when it collects anything
  peers: number                 // how many of the unit's other stays did charge
  siblings: number              // other stays on this unit sharing this verdict (unit kinds only)
}

export type CleanOpts = {
  /** Charged stays needed on a unit before a $0 stay there counts as an anomaly. */
  peerMin?: number
  /** Below this, a "fee" is no fee. Folio amounts are dollars, so half a cent. */
  eps?: number
}

const DEFAULT_PEER_MIN = 3
const DEFAULT_EPS = 0.005

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Judge a month's stays together, because a single stay cannot tell you whether $0 is a mistake.
 * Returns one verdict per stay that collected nothing; stays that charged are left out.
 */
export function cleaningGaps(stays: CleanStay[], opts: CleanOpts = {}): CleanVerdict[] {
  const peerMin = Math.max(1, Math.round(opts.peerMin ?? DEFAULT_PEER_MIN))
  const eps = opts.eps ?? DEFAULT_EPS

  const byUnit = new Map<string, CleanStay[]>()
  for (const s of stays) {
    const k = String(s.unitKey || '')
    if (!k) continue
    const arr = byUnit.get(k)
    if (arr) arr.push(s); else byUnit.set(k, [s])
  }

  const out: CleanVerdict[] = []
  for (const group of Array.from(byUnit.values())) {
    const charged = group.filter(s => s.net > eps)
    const zero = group.filter(s => s.net <= eps)
    if (!zero.length) continue
    const expected = charged.length ? Math.round(median(charged.map(s => s.net)) * 100) / 100 : null

    if (!charged.length) {
      // THE UNIT IS THE FINDING. Every stay on it collected nothing, so this is a listing that
      // was never set up to charge — one thing to fix, however many bookings it touched. The
      // earliest stay carries it; the rest are info so the flagged count stays honest.
      const ordered = [...zero].sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : a.resId < b.resId ? -1 : 1))
      ordered.forEach((s, i) => out.push({
        resId: s.resId,
        kind: i === 0 ? 'unit' : 'unit_more',
        severity: i === 0 ? 'review' : 'info',
        expected: null,
        peers: 0,
        siblings: ordered.length - 1,
      }))
      continue
    }

    // The unit charges. Now a $0 stay on it is an exception to its own habit, which is the
    // strongest signal available — and a refunded fee is a different conversation from one that
    // was never raised, so the two are named apart rather than lumped as "missing".
    const confident = charged.length >= peerMin
    for (const s of zero) {
      out.push({
        resId: s.resId,
        kind: !confident ? 'thin' : (s.lines > 0 && s.hadNegative) ? 'refunded' : 'missing',
        severity: confident ? 'high' : 'review',
        expected,
        peers: charged.length,
        siblings: 0,
      })
    }
  }
  return out
}

/** The sentence that goes on the board. `unitName` is the listing's display name. */
export function cleaningNote(v: CleanVerdict, unitName: string, unitFee: number | null): string {
  const u = unitName || 'this unit'
  const fee = unitFee != null && unitFee > 0 ? '$' + unitFee.toFixed(2) : null
  switch (v.kind) {
    case 'unit':
      return 'No cleaning fee on this stay — and none on any of ' + u + "'s " + (v.siblings + 1)
        + ' stays this month. ' + (fee
          ? 'The Guesty listing does carry a ' + fee + ' cleaning fee, so the bookings are not picking it up — check the channel mapping.'
          : 'The Guesty listing has no cleaning fee set. Fix it on the listing, not booking by booking.')
    case 'unit_more':
      return 'No cleaning fee — same gap as the rest of ' + u + ' this month; counted once on the earliest stay.'
    case 'refunded':
      return 'The cleaning fee on this stay was charged and then refunded to $0. ' + u + ' collects '
        + (v.expected != null ? '$' + v.expected.toFixed(2) : 'a fee') + ' on its other ' + v.peers
        + ' stays this month — confirm the refund was authorized, or re-raise the fee.'
    case 'missing':
      return 'No cleaning fee on this stay. ' + u + ' charges '
        + (v.expected != null ? '$' + v.expected.toFixed(2) : 'a fee') + ' on its other ' + v.peers
        + ' stays this month, so this one is the exception — the turnover still has to be paid for.'
    case 'thin':
      return 'No cleaning fee on this stay. ' + u + ' has only ' + v.peers + ' stay'
        + (v.peers === 1 ? '' : 's') + ' with a fee this month, which is too few to be sure — worth a look.'
    default:
      return ''
  }
}
