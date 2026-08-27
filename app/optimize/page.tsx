// THE ROUTE THAT DID NOT EXIST.
//
// lib/features.ts has registered `{ key: 'optimize', label: 'Listing Optimizer', path: '/optimize' }`
// for months, and app/optimize/ was never created. Three consequences, none of them visible from
// inside the app:
//
//   • Middleware gated it as a real feature, let an authorised user through, and Next.js 404'd.
//   • It appeared as a togglable permission row in /users -> Roles, so admins have been granting
//     and revoking access to a page that does not exist.
//   • EVE RECOMMENDED IT. She builds her app map from FEATURES (lib/eve/atlas.ts), so her prompt
//     carried "- Listing Optimizer (/optimize): listing content optimizer" on every request. Ask
//     her where to optimize a listing and she sent you to a 404.
//
// The optimizer is per-listing and always has been: it lives on /listings/[id]. Rather than delete
// the feature key — which would take the permission row and Eve's knowledge of the tool with it —
// this makes the promise true. Portfolio-wide "what to fix, ranked by points" already exists on
// /buildings, so that is where this lands.
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function OptimizeIndex() {
  redirect('/buildings?view=fix')
}
