// THE OWNER CATALOG (Jon, 2026-10-28): the link the team sends an owner — their properties, then
// each property's essentials, furniture and their own requests. No sign-in; the code is checked on
// every call by /api/public/owner-catalog. robots noindex.
import { notFound } from 'next/navigation'
import { ownerHome } from '@/lib/ffe-owner-catalog'
import { OwnerCatalog } from '@/components/OwnerCatalog'

export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false }, title: 'Your furnishing catalog — Stay Hospitality' }

export default async function OwnerCatalogPage({ params }: { params: { code: string } }) {
  const code = String(params.code || '')
  if (!(await ownerHome(code, true))) notFound()
  return <OwnerCatalog code={code} />
}
