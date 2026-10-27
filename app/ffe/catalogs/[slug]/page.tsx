import { redirect } from 'next/navigation'
export const dynamic = 'force-dynamic'
export default function FfeCatalogRedirect({ params }: { params: { slug: string } }) { redirect(`/catalogs/${encodeURIComponent(String(params.slug || ''))}`) }
