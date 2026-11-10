// A LOW REVIEW'S CASE FILE — what a person decided about it, kept in table `review_cases`.
//
// The playbook on a review row works everything out fresh each time (lib/review-playbook). What it
// cannot work out is what a person DID: which causes they confirmed, who owns the fix, whether a
// removal request was filed and on what ground, whether a private note went to the guest. That is
// this record. Nothing here sends, files or posts anything — it records that a person did.
//
// THE TABLE MAY NOT EXIST YET. Every read and write fails open: a missing table answers
// `missing: true`, the playbook renders exactly as it does without a saved case, and the save
// controls say once that saving needs the table. Never a 500 for that.
//
// Client-safe: types and pure helpers only.

export const REMOVAL_STATUSES = ['none', 'drafted', 'filed', 'removed', 'declined'] as const
export type RemovalStatus = typeof REMOVAL_STATUSES[number]

export type ReviewCase = {
  rootCauses: string[]
  owner: string
  removalStatus: RemovalStatus
  removalGround: string
  removalFiledAt: string | null
  removalFiledBy: string | null
  guestNoteSentAt: string | null
  notes: string
  updatedAt: string | null
  updatedBy: string | null
}

export const emptyCase = (): ReviewCase => ({
  rootCauses: [], owner: '', removalStatus: 'none', removalGround: '', removalFiledAt: null, removalFiledBy: null,
  guestNoteSentAt: null, notes: '', updatedAt: null, updatedBy: null,
})

const s = (v: any, max: number): string => String(v == null ? '' : v).trim().slice(0, max)

/** A database row → the shape the page uses. */
export function caseFromRow(row: any): ReviewCase {
  if (!row) return emptyCase()
  const st = String(row.removal_status || 'none') as RemovalStatus
  return {
    rootCauses: Array.isArray(row.root_causes) ? (row.root_causes as any[]).map(x => s(x, 60)).filter(Boolean).slice(0, 12) : [],
    owner: s(row.owner, 60),
    removalStatus: REMOVAL_STATUSES.indexOf(st) >= 0 ? st : 'none',
    removalGround: s(row.removal_ground, 200),
    removalFiledAt: row.removal_filed_at ? String(row.removal_filed_at) : null,
    removalFiledBy: row.removal_filed_by ? String(row.removal_filed_by) : null,
    guestNoteSentAt: row.guest_note_sent_at ? String(row.guest_note_sent_at) : null,
    notes: s(row.notes, 2000),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
  }
}

/** Is this the error PostgREST / Postgres gives for a table that has not been created? */
export function isMissingTable(error: any): boolean {
  if (!error) return false
  const code = String(error.code || '')
  const msg = String(error.message || error)
  return code === '42P01' || code === 'PGRST205' || /relation .* does not exist|could not find the table|schema cache/i.test(msg)
}
