// WHO MAY CLOSE A CLAIM (Jon, 2026-11-06: "Once paid sits in new section and from there needs to be
// closed out by accounting / GM / Admin only"). Closing is the books step — the money is in and the
// owner statement reflects it — so it belongs to the people who own the books, not to whoever filed.
//
// Yes: the owner; anyone with app role 'admin'; anyone whose access role is Admin, Manager (the GM
// seat), or an accounting / finance / GM role (matched on key or label so a role added later at
// /users → Roles called "Accounting" just works); or a person switched on by hand with
// features.claims_close = true. Everyone else can still record the decision and the amount — they
// just cannot close.
//
// Admin roles (Jon, 2026-11-06: "also give Admin roles access to close"): any role with "admin" in its
// name, and the administrator seat — anyone who has the Admin desk AND full Claims (today the Data role).
import 'server-only'
import { getRoles, isSuperadmin, type Access } from '@/lib/access'

const CLOSER_KEYS = ['admin', 'manager', 'gm', 'general_manager', 'accounting', 'accountant', 'finance', 'bookkeeper', 'payables']
const CLOSER_LABEL = /accounting|accountant|finance|bookkeep|payable|general manager|\bgm\b|admin|^manager$/i

export async function canCloseClaims(access: Pick<Access, 'email' | 'role' | 'accessRole' | 'features' | 'levels'>): Promise<boolean> {
  if (isSuperadmin(access.email)) return true
  if (access.role === 'admin') return true
  if ((access.features as any)?.claims_close === true) return true
  const lv = access.levels || {}
  if (lv['claims'] === 'full' && ['view', 'edit', 'full'].includes(String(lv['admin-desk'] || ''))) return true
  const key = String(access.accessRole || '').toLowerCase()
  if (!key) return false
  if (CLOSER_KEYS.includes(key)) return true
  const roles = await getRoles()
  const def = (roles || []).find(r => String((r as any).key).toLowerCase() === key)
  return !!def && CLOSER_LABEL.test(String((def as any).label || ''))
}

export const CLOSE_DENIED = 'Only Accounting, the GM or Admin can close a claim. Record the decision and amount — they close it out.'
