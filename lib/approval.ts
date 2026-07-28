// APPROVAL AUTO-LIMITS — who has to say yes to a buy.
//
// The approval ladder (none -> gm_approved -> owner_pending -> owner_approved) was manual: a
// manager clicked a button on every line. That does not scale, and it made small buys wait behind
// owner replies. A per-owner GM PRE-AUTH LIMIT fixes it: once a line has a price, anything at or
// under that owner's limit is GM-approved automatically and moves straight to Ready to buy;
// anything over it is routed to the owner instead. A limit of 0 means that owner sees everything.
//
// Owner -> unit comes from the Guesty owners map already synced to app_settings 'guesty_owners'
// (42 owners / 226 listings). A unit with no owner on file uses the portfolio default.
//
// FAIL-SAFE, not fail-open: if anything cannot be resolved the decision is owner_pending. Getting
// an extra owner approval is a nuisance; auto-approving a spend that should have been reviewed is
// not recoverable.
import 'server-only'
import { getSetting } from './app-settings'

export const APPROVAL_LIMITS_KEY = 'approval_limits'
export const GUESTY_OWNERS_KEY = 'guesty_owners'

export type ApprovalLimits = { default: number; owners: Record<string, number> }
export type OwnerRef = { id: string; name: string }
export type RouteDecision = { approval: 'gm_approved' | 'owner_pending'; limit: number; amount: number; owner: OwnerRef | null }

/** $250 is roughly a linen/kitchenware restock — small enough to be routine, big enough to matter. */
export const DEFAULT_LIMITS: ApprovalLimits = { default: 250, owners: {} }

const clampMoney = (n: any): number => {
  const v = Math.round(Number(n))
  return Number.isFinite(v) && v > 0 ? Math.min(1000000, v) : 0
}

export function mergeLimits(stored: any): ApprovalLimits {
  const out: ApprovalLimits = { default: DEFAULT_LIMITS.default, owners: {} }
  if (!stored || typeof stored !== 'object') return out
  if ((stored as any).default !== undefined) out.default = clampMoney((stored as any).default)
  const o = (stored as any).owners
  if (o && typeof o === 'object') {
    for (const k of Object.keys(o).slice(0, 500)) {
      const v = clampMoney(o[k])
      if (String(k)) out.owners[String(k)] = v
    }
  }
  return out
}

export async function getApprovalLimits(): Promise<ApprovalLimits> {
  return mergeLimits(await getSetting<any>(APPROVAL_LIMITS_KEY, null))
}

/** listingId -> owner, built from the synced Guesty owners blob. Empty map if the sync never ran. */
export async function ownerByListing(): Promise<Record<string, OwnerRef>> {
  const raw = await getSetting<any>(GUESTY_OWNERS_KEY, null)
  const list: any[] = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.owners) ? raw.owners : [])
  const out: Record<string, OwnerRef> = {}
  for (const o of list) {
    if (!o) continue
    const id = String(o.id || o._id || '')
    if (!id) continue
    const ref: OwnerRef = { id, name: String(o.name || o.ownerName || id).slice(0, 120) }
    const ids: any[] = Array.isArray(o.listingIds) ? o.listingIds : (Array.isArray(o.listings) ? o.listings : [])
    for (const l of ids) { const lid = String((l && (l._id || l.id)) || l || ''); if (lid) out[lid] = ref }
  }
  return out
}

/** The GM pre-auth ceiling for a unit: that owner's limit if set, otherwise the portfolio default. */
export function limitFor(listingId: string, limits: ApprovalLimits, owners: Record<string, OwnerRef>): { limit: number; owner: OwnerRef | null } {
  const owner = owners[String(listingId || '')] || null
  if (owner && Object.prototype.hasOwnProperty.call(limits.owners, owner.id)) return { limit: limits.owners[owner.id], owner }
  return { limit: limits.default, owner }
}

/** Decide a single line. The 'amount' is the LINE total (unit price x qty), in whole dollars. */
export function decide(listingId: string, amount: number, limits: ApprovalLimits, owners: Record<string, OwnerRef>): RouteDecision {
  const { limit, owner } = limitFor(listingId, limits, owners)
  const amt = Math.max(0, Math.round(Number(amount) || 0))
  const approval: RouteDecision['approval'] = amt > 0 && limit > 0 && amt <= limit ? 'gm_approved' : 'owner_pending'
  return { approval, limit, amount: amt, owner }
}

/** One-shot convenience for a single item — loads both settings, then decides. */
export async function routeFor(listingId: string, amount: number): Promise<RouteDecision> {
  const [limits, owners] = await Promise.all([getApprovalLimits(), ownerByListing()])
  return decide(listingId, amount, limits, owners)
}
