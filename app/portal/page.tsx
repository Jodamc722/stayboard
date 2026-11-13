// THE OWNER PORTAL SIGN-IN (/portal). Public: an owner signs in with the email on their onboarding and the password
// they created; /api/portal checks both and opens their own page.
import { OwnerPortalSignIn } from '@/components/OwnerPortalSignIn'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Owner portal · Stay Hospitality', robots: { index: false, follow: false } }
export default function PortalPage() { return <OwnerPortalSignIn /> }
