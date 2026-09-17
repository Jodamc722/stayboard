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
// one they will add up on the call. Modelled on a real issued August statement (figures, names
// and the unit changed; line items kept):
//
//   rental 2,456.00 + channel reimbursement 2.90 + cleaning 360.00 + parking 75.00
//     = property income 2,893.90
//   − management 491.20 (20% of rental) − supplies 86.80 − maintenance 168.00 (4.2h @ $40)
//     = ending balance 2,147.90, which is the payment due.
//
// The per-booking detail foots to the same place: 903.70 + 1,244.20 = 2,147.90. It did not
// before — the old version charged 20% in the summary and itemised 10% on the bookings, so an
// owner adding up the detail got a different answer than the total above it. Twenty-one nights
// across the two stays is 68% of August, which is the occupancy in the strip. If you change a
// figure here, change its partners: nothing in this object is independent of the rest.
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
    { k: 'Proceeds', v: m(2147.9) },
    { k: 'Nights occupied', v: '21' },
    { k: 'Working capital', v: m(0) },
  ],
  summary: [
    { k: 'Initial balance', v: m(0) },
    { k: 'Rental income', v: m(2456) },
    { k: 'Channel commission', v: m(2.9) },
    { k: 'Cleaning fee', v: m(360) },
    { k: 'Parking', v: m(75) },
    { k: 'Management fee', v: MINUS + m(491.2), neg: true },
    { k: 'Supplies and purchases', v: MINUS + m(86.8), neg: true },
    { k: 'Maintenance — owner charge', v: MINUS + m(168), neg: true },
    { k: 'Ending balance', v: m(2147.9), rule: true },
  ],
  due: { k: 'Payment due to owner', v: m(2147.9) },
  reservations: [
    {
      guest: 'M. Alvarez', stay: 'Aug 2 – Aug 8 · 6 nights',
      lines: [
        { date: 'Aug 2', desc: 'Rental payment for HMABC12345', cat: 'Rental income', amt: m(1024) },
        { date: 'Aug 2', desc: 'PMC commission — 20% of rental', cat: 'Management fee', amt: MINUS + m(204.8), neg: true },
        { date: 'Aug 2', desc: 'Cleaning fee', cat: 'Cleaning fee', amt: m(180) },
        { date: 'Aug 2', desc: 'Airbnb RM channel fee reimbursement', cat: 'Channel commission', amt: m(2.9) },
        { date: 'Aug 6', desc: 'Coffee, paper goods, replacement bath mat', cat: 'Supplies and purchases', amt: MINUS + m(38.4), neg: true },
        { date: 'Aug 7', desc: 'Kitchen faucet cartridge — 1.5h at $40', cat: 'Maintenance — owner charge', amt: MINUS + m(60), neg: true },
      ],
      total: m(903.7),
    },
    {
      guest: 'R. Whitfield', stay: 'Aug 14 – Aug 29 · 15 nights',
      lines: [
        { date: 'Aug 14', desc: 'Rental payment for BC-9KD3LM', cat: 'Rental income', amt: m(1432) },
        { date: 'Aug 14', desc: 'PMC commission — 20% of rental', cat: 'Management fee', amt: MINUS + m(286.4), neg: true },
        { date: 'Aug 14', desc: 'Cleaning fee', cat: 'Cleaning fee', amt: m(180) },
        { date: 'Aug 14', desc: 'Nightly parking', cat: 'Parking', amt: m(75) },
        { date: 'Aug 20', desc: 'Linens, dish soap, coffee pods', cat: 'Supplies and purchases', amt: MINUS + m(48.4), neg: true },
        { date: 'Aug 23', desc: 'A/C service and filter change — 2.7h at $40', cat: 'Maintenance — owner charge', amt: MINUS + m(108), neg: true },
      ],
      total: m(1244.2),
    },
  ],
  propertyIncome: { k: 'Property income', v: m(2893.9) },
}

/** True when a stored statement actually has rows to render. */
export function statementHasRows(st: unknown): boolean {
  const s = (st || {}) as Record<string, unknown>
  const arr = (x: unknown) => Array.isArray(x) && x.length > 0
  return arr(s.summary) && arr(s.reservations)
}
