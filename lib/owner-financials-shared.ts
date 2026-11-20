// The shapes and the line list of the owner financials (lib/owner-financials), without the server: the screen and
// the Excel writer both read these.
export type FinCat = 'rental' | 'cleaning' | 'fees' | 'other' | 'commission' | 'charges' | 'passthru' | 'paid'
export const FIN_LINES: { key: FinCat | 'gross' | 'expenses' | 'net' | 'guestRent' | 'guestCleaning' | 'guestGross' | 'nights'; label: string; kind: 'rev' | 'exp' | 'total' | 'memo' | 'guest' | 'guestTotal' | 'count' }[] = [
  // WHAT GUESTS PAID, FROM THE BOOKINGS (Jon, 2026-11-20: "those cleaning fees are wrong, can't be that low"). Most of
  // the cleaning fee never reaches an owner statement, so the statement line alone read as a fraction of the truth.
  { key: 'guestRent', label: 'Accommodation guests paid', kind: 'guest' },
  { key: 'guestCleaning', label: 'Cleaning fees guests paid', kind: 'guest' },
  { key: 'guestGross', label: 'Gross booking value', kind: 'guestTotal' },
  { key: 'nights', label: 'Nights sold', kind: 'count' },
  { key: 'rental', label: 'Rental income', kind: 'rev' },
  { key: 'cleaning', label: 'Cleaning credited to owners', kind: 'rev' },
  { key: 'fees', label: 'Guest fees (parking, pet, resort)', kind: 'rev' },
  { key: 'other', label: 'Other income and reimbursements', kind: 'rev' },
  { key: 'gross', label: 'Gross owner revenue', kind: 'total' },
  { key: 'commission', label: 'Management commission', kind: 'exp' },
  { key: 'charges', label: 'Owner charges', kind: 'exp' },
  { key: 'expenses', label: 'Total expenses', kind: 'total' },
  { key: 'passthru', label: 'Pass-through reservations (net)', kind: 'memo' },
  { key: 'net', label: 'Net to owner', kind: 'total' },
  { key: 'paid', label: 'Paid out', kind: 'memo' },
]
export type FinVals = { /** from the bookings: accommodation fare, cleaning fees and their sum, and nights, for stays in the period */ guestRent: number; guestCleaning: number; guestGross: number; nights: number; rental: number; cleaning: number; fees: number; other: number; commission: number; charges: number; passthru: number; paid: number; gross: number; expenses: number; net: number }
export type FinRow = FinVals & { key: string; name: string; building: string; owner: string; units: number; /** net and gross by month, for the trend columns */ byMonth: Record<string, { gross: number; net: number }> }
export type FinDetail = { cat: FinCat; name: string; amount: number; lines: number }
/** One owner, one building or one listing: the report narrowed to it, to share with that owner. */
export type FinScope = { kind: 'owner' | 'building' | 'listing'; id: string; name: string }
export type Financials = {
  from: string; to: string; months: string[]
  /** Null for the whole portfolio. */
  scope: FinScope | null
  /** Months in the range whose ledger is not fully synced (left out of nothing, but flagged), and months with ledger lines but no statement generated yet. */
  notSynced: string[]; noStatements: string[]; statements: number; ledgerLines: number
  /** Bookings read for the guest side, and what sat on units with no statement line in the period (left out of the rows). */
  stays: number; offStatement: { stays: number; gross: number }
  total: FinVals; monthly: (FinVals & { month: string })[]
  buildings: FinRow[]; listings: FinRow[]; owners: FinRow[]
  detail: FinDetail[]
}
