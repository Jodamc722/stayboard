// THE SAMPLE OWNER STATEMENT — ONE COPY, SHARED BY EVERY DECK.
//
// Jon, 2026-09-17: "the owner statement is a sample one to show the owner and explain how to
// read — should be a standard slide, so once we build it, it's the default one we use."
//
// It used to be assembled inside buildOnboardingContent and frozen into each report's content
// JSON at generation time. That is the right home for the owner's OWN facts and the wrong home
// for a teaching example: when the statement was remodelled on the real Guesty PDF, every deck
// generated before that day kept the old shape, and the slide rendered as a headline over an
// empty table — headers, no rows. The slide was there; there was nothing in it. The decks Jon
// had already built were blank on the one page he walks an owner through line by line.
//
// So the sample lives here, in code, as a constant. The renderer falls back to it whenever a
// stored statement has no rows, which repairs every existing deck without regenerating it, and
// a statement that HAS been edited keeps the edit. Change the example once, here, and every
// deck — old and new — carries the change.
//
// THE ARITHMETIC FOOTS, AND THAT IS THE POINT. The one statement an owner is ever shown is the
// one they will add up on the call. Modelled on a real issued August statement (figures, guest
// names and the unit changed; line items kept):
//
//   rental 2,456.00 (already net of channel fees) + reimbursement 37.50
//     = property income 2,493.50
//   - management 491.20 (20% of rental) - supplies 86.80 - maintenance 168.00 (4.2h @ $40)
//     = ending balance 1,747.50, which is the payment due.
//
// NO CLEANING FEE LINE (Jon, 2026-09-17: "on the owner statement they won't see cleaning fees,
// that's pulled out"). The guest's cleaning fee settles the turnover before any of this reaches
// the owner, so a cleaning-fee row -- as income or as a charge -- describes money the owner
// never touches. It used to appear on both sides, which made the document contradict the rule
// three slides later that says departure cleans are never billed to them.
//
// WHAT THE OWNER ACTUALLY SEES, AND WHAT THEY DO NOT (Jon, 2026-09-17): "owners do not see
// cleaning fee or OTA fees, the rev from rental income is already net of fees", and the
// reimbursement line "is the fee they charge on cleaning fee we give back because we keep the
// cleaning fee".
//
// Three consequences, and this sample got all three wrong before:
//
//   1. NO OTA FEE LINE. The channel's cut is already taken out of the rental figure. Showing a
//      separate OTA fee row would deduct it a second time and understate the payout.
//   2. NO CLEANING FEE LINE, in either direction. Stay keeps the cleaning fee; it settles the
//      turnover and never reaches the owner's side of the ledger.
//   3. ONE GIVE-BACK, not two fee lines. The channel charges a fee on the cleaning portion.
//      Since the cleaning fee is ours, that charge is not the owner's to carry, so it comes back
//      to them. I briefly had this as a separate $54 "cleaning channel fee" row on top of the RM
//      row — two lines for one idea, and the larger of them money the owner never sees.
//
// SIZED AT 15% OF A $125 CLEANING FEE (Jon, 2026-09-17), so $18.75 a booking and $37.50 for the
// month. The ledger's own spread on this line is wider -- 1.13 to 16.55 a booking on the
// reservations sampled, against an average of 1.69 -- because the rate rides on each unit's own
// cleaning fee. The rule is the thing to teach an owner, not the average, so the example carries
// the rule. Change the cleaning fee this example assumes and this number moves with it.
//
// NO PARKING LINE (Jon, 2026-09-17: "remove parking from owner statement"). It is real on the
// units that have it and simply not typical enough to belong in the one example every owner is
// walked through -- an owner without a parking space reading a parking row has to be told to
// ignore it, which is the opposite of what a teaching document should do.
//
// SUPPLIES ARE THINGS, NOT CONSUMABLES (Jon, 2026-09-17: "we don't charge for coffee pods, it
// could be like a lamp replacement or something like that"). What gets charged to an owner is a
// replacement that stays in the unit. Coffee, paper goods and dish soap are ours. Keep every
// example on this statement something an owner would expect to pay for and recognise.
//
// EXPENSES ARE LUMPED AT THE TOP, AT THEIR FULL AMOUNT (Jon, 2026-09-17: "billable labor is
// lumped in at the top, its full amount"). The issued statement keeps two things apart: the
// per-booking financials -- rental, commission, channel fee, parking -- and the owner expenses,
// which are one line each for the month. Splitting the month's labour across the two stays,
// which is what this sample used to do, invents a link between a booking and a job that the
// real document does not make, and it buries the number the owner actually asks about behind
// two part-amounts. Supplies are handled the same way, for the same reason.
//
// So the detail foots to the booking subtotal -- 837.95 + 1,164.35 = 2,002.30 -- and the two
// expense lines carry that down to the 1,747.50 payout. Twenty-one
// nights across the two stays is 68% of August, which is the occupancy in the strip. If you
// change a figure here, change its partners: nothing in this object is independent of the rest.
import type { KV } from './onboarding-report'

export type SampleStatement = {
  unitLabel: string; period: string
  kpis: KV[]
  summary: { k: string; v: string; neg?: boolean; rule?: boolean }[]
  due: KV
  reservations: {
    guest: string; stay: string
    lines: { date: string; desc: string; cat: string; amt: string; neg?: boolean }[]
    total: string
  }[]
  propertyIncome: KV
}

const m = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MINUS = '−'

export const SAMPLE_STATEMENT: SampleStatement = {
  unitLabel: 'Sample statement · 2 BR / 2 BA condo',
  period: 'Example month · August',
  kpis: [
    { k: 'Occupancy', v: '68%' },
    { k: 'Proceeds', v: m(1747.5) },
    { k: 'Nights occupied', v: '21' },
    { k: 'Working capital', v: m(0) },
  ],
  summary: [
    { k: 'Initial balance', v: m(0) },
    { k: 'Rental income', v: m(2456) },
    { k: 'Airbnb RM channel fee reimbursement', v: m(37.5) },
    { k: 'Management fee', v: MINUS + m(491.2), neg: true },
    { k: 'Supplies and purchases', v: MINUS + m(86.8), neg: true },
    { k: 'Maintenance — owner charge', v: MINUS + m(168), neg: true },
    { k: 'Ending balance', v: m(1747.5), rule: true },
  ],
  due: { k: 'Payment due to owner', v: m(1747.5) },
  reservations: [
    {
      guest: 'M. Alvarez', stay: 'Aug 2 – Aug 8 · 6 nights',
      lines: [
        { date: 'Aug 2', desc: 'Rental payment for HMABC12345 \u2014 after the channel\u2019s fee', cat: 'Rental income', amt: m(1024) },
        { date: 'Aug 2', desc: 'PMC commission — 20% of rental', cat: 'Management fee', amt: MINUS + m(204.8), neg: true },
        { date: 'Aug 2', desc: 'Airbnb RM channel fee reimbursement \u2014 15% of the cleaning fee, returned to you', cat: 'Airbnb RM channel fee reimbursement', amt: m(18.75) },
      ],
      total: m(837.95),
    },
    {
      guest: 'R. Whitfield', stay: 'Aug 14 – Aug 29 · 15 nights',
      lines: [
        { date: 'Aug 14', desc: 'Rental payment for BC-9KD3LM \u2014 after the channel\u2019s fee', cat: 'Rental income', amt: m(1432) },
        { date: 'Aug 14', desc: 'PMC commission — 20% of rental', cat: 'Management fee', amt: MINUS + m(286.4), neg: true },
        { date: 'Aug 14', desc: 'Airbnb RM channel fee reimbursement \u2014 15% of the cleaning fee, returned to you', cat: 'Airbnb RM channel fee reimbursement', amt: m(18.75) },
      ],
      total: m(1164.35),
    },
  ],
  propertyIncome: { k: 'Property income', v: m(2493.5) },
}

/** True when a stored statement actually has rows to render. */
export function statementHasRows(st: unknown): boolean {
  const s = (st || {}) as Record<string, unknown>
  const arr = (x: unknown) => Array.isArray(x) && x.length > 0
  return arr(s.summary) && arr(s.reservations)
}

// ── THE READING GUIDE ───────────────────────────────────────────────────────
// The four lines an owner asks about, and the reason each one looks the way it does. House
// doctrine: identical for every owner, so it lives here with the sample it explains rather than
// being frozen into each deck's content JSON. ReportView draws it as its own slide.
//
// THE REIMBURSEMENT IS THE ONE THAT NEEDS THE MECHANIC, NOT THE RULE (Jon, 2026-09-18: "if not
// the owner is paying the fee on the Airbnb, that's why we reimburse -- Guesty does not give us
// ability to separate so we reimburse that RM, we reimburse fees that we charge guests"). The
// previous wording said the cleaning fee is ours and therefore the fee on it "comes back to
// you", which reads as circular: if it was never theirs, why is it landing on their statement as
// income? The answer is the plumbing. Airbnb charges its fee against the whole booking, rent and
// cleaning together; Guesty cannot apportion that charge across the two, so all of it is netted
// out of the rental line the owner receives. Left there, the owner would be paying the channel's
// fee on a cleaning fee Stay keeps. The reimbursement puts that piece back.
export const STATEMENT_ALSO: KV[] = [
    { k: 'No cleaning line, no OTA fee line', v: 'You will not see either. We keep the cleaning fee and it pays for the turnover, and the channel’s commission is already out of your rental figure rather than shown again below it.' },
    { k: 'Channel fee reimbursement', v: 'The channel charges its fee on the whole booking — the rent and the cleaning fee together — and the entire charge comes out of your rental line. Guesty cannot split it, so without this line you would be paying the fee on a cleaning fee we keep. We pay that part back to you: 15% of the cleaning fee.' },
    { k: 'Revenue management', v: 'Appears only if you are on a revenue-management arrangement.' },
    { k: 'Adjustments', v: 'A cancellation, a refund, or a late-landing charge from a prior month. Always labelled with the month it belongs to.' },
]

/**
 * The day the reading-guide slide shipped. Every deck generated before it froze one of the older
 * versions of these rows into its content JSON -- including the two Jon corrected: a "Cleaning
 * fee" row describing a fee owners never see, and a reimbursement row describing the OTA
 * commission, which is already out of the rental line. Those rows were never rendered, so no one
 * can have edited them on purpose, which is why an old deck is safe to overwrite wholesale.
 * A deck generated from today forward keeps whatever is stored, edits included.
 */
export const STATEMENT_ALSO_SINCE = '2026-09-18'

/** True when a deck predates the slide and its stored rows should be replaced by the house set. */
export function statementAlsoStale(generatedAt: unknown): boolean {
  const g = String(generatedAt || '').slice(0, 10)
  return !g || g < STATEMENT_ALSO_SINCE
}
