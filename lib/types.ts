// Shared TypeScript types for the app.
export type FieldRequestStatus = 'open' | 'acknowledged' | 'in_progress' | 'blocked' | 'done' | 'cancelled'
export type FieldRequestPriority = 'low' | 'medium' | 'high' | 'urgent'
export type FieldRequestType = 'issue' | 'order' | 'pte'

export type FieldRequest = {
  id: string
  type: FieldRequestType
  title: string
  description: string | null
  listing_id: string | null
  building: string | null
  unit: string | null
  reservation_id: string | null
  priority: FieldRequestPriority
  status: FieldRequestStatus
  created_by_email: string | null
  assignee_email: string | null
  due_at: string | null
  vendor: string | null
  amount_usd: number | null
  approval_required: boolean
  approval_status: 'pending' | 'approved' | 'rejected' | null
  approver_email: string | null
  approved_at: string | null
  photos: string[] | null
  created_at: string
  updated_at: string
}

export const PRIORITY_LABEL: Record<FieldRequestPriority, string> = {
  low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent'
}
export const PRIORITY_STYLE: Record<FieldRequestPriority, string> = {
  low:    'bg-slate-100 text-slate-600 ring-slate-200',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  high:   'bg-orange-50 text-orange-700 ring-orange-200',
  urgent: 'bg-rose-50 text-rose-700 ring-rose-200'
}
export const STATUS_LABEL: Record<FieldRequestStatus, string> = {
  open: 'Open', acknowledged: 'Acknowledged', in_progress: 'In progress',
  blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled'
}
export const STATUS_STYLE: Record<FieldRequestStatus, string> = {
  open:         'bg-rose-50 text-rose-700 ring-rose-200',
  acknowledged: 'bg-blue-50 text-blue-700 ring-blue-200',
  in_progress:  'bg-indigo-50 text-indigo-700 ring-indigo-200',
  blocked:      'bg-amber-50 text-amber-700 ring-amber-200',
  done:         'bg-emerald-50 text-emerald-700 ring-emerald-200',
  cancelled:    'bg-slate-100 text-slate-500 ring-slate-200'
}
export const TYPE_LABEL: Record<FieldRequestType, string> = {
  issue: 'Issue', order: 'Order', pte: 'PTE'
}
