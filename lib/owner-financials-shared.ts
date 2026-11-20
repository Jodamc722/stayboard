// The shapes and the line list of the owner financials (lib/owner-financials), without the server: the screen and
// the Excel writer both read these.
export type FinCat = 'rental' | 'cleaning' | 'fees' | 'other' | 'commission' | 'charges' | 'passthru' | 'paid'
export const FIN_LINES: { key: FinCat | 'gross' | 'expenses' | 'net'; label: string; kind: 'rev' | 'exp' | 'total' | 'memo' }[] = [
  { key: 'rental', label: 'Rental income', kind: 'rev' },
  { key: 'cleaning', label: 'Cleaning fees', kind: 'rev' },
  { key: 'fees', label: 'Guest fees (parking, pet, resort)', kind: 'rev' },
  { key: 'other', label: 'Other income and reimbursements', kind: 'rev' },
  { key: 'gross', label: 'Gross revenue', kind: 'total' },
  { key: 'commission', label: 'Management commission', kind: 'exp' },
  { key: 'charges', label: 'Owner charges', kind: 'exp' },
  { key: 'expenses', label: 'Total expenses', kind: 'total' },
  { key: 'passthru', label: 'Pass-through reservations (net)', kind: 'memo' },
  { key: 'net', label: 'Net to owner', kind: 'total' },
  { key: 'paid', label: 'Paid out', kind: 'memo' },
]
export type FinVals = { rental: number; cleaning: number; fees: number; other: number; commission: number; charges: number; passthru: number; paid: number; gross: number; expenses: number; net: number }
export type FinRow = FinVals & { key: string; name: string; building: string; owner: string; units: number; /** net and gross by month, for the trend columns */ byMonth: Record<string, { gross: number; net: number }> }
export type FinDetail = { cat: FinCat; name: string; amount: number; lines: number }
export type Financials = {
  from: string; to: string; months: string[]
  /** Months in the range whose ledger is not fully synced (left out of nothing, but flagged), and months with ledger lines but no statement generated yet. */
  notSynced: string[]; noStatements: string[]; statements: number; ledgerLines: number
  total: FinVals; monthly: (FinVals & { month: string })[]
  buildings: FinRow[]; listings: FinRow[]; owners: FinRow[]
  detail: FinDetail[]
}
