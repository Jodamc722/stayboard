// WHO CAN APPROVE A CLAIM (Jon, 2026-10-21: "the claims recommend to file needs to be a drop down
// with a flag / notification"). The dropdown on "Recommend to file" lists the people who approve
// claims: admins, plus anyone whose role holds Claims at FULL — the same people the claims cron
// nudges (app/api/cron/claims claimsApprovers), so the list and the nudges never disagree.
import 'server-only'
import { getRoles, resolveLevels } from '@/lib/access'

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

export type Reviewer = { email: string; name: string }

export async function claimReviewers(db: any): Promise<Reviewer[]> {
  const { data, error } = await db.from('app_users').select('*').eq('status', 'active')
  if (error) return []
  const roles = await getRoles()
  const out: Reviewer[] = []
  for (const u of (data || []) as any[]) {
    const email = str(u.email).toLowerCase()
    if (!email) continue
    const ok = u.role === 'admin' || resolveLevels(u, roles).levels['claims'] === 'full'
    if (ok) out.push({ email, name: str(u.full_name || u.name || u.display_name).trim() || email.split('@')[0] })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
