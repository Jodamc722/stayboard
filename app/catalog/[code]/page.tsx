// PUBLIC approved catalog (Jon, 2026-10-27): the read-only replacement list for one property,
// opened from a share link — no sign-in, robots noindex. The code is checked by the API on load.
import { notFound } from 'next/navigation'
import { readShared } from '@/lib/ffe-approved-catalog'
import { FfeApprovedCatalog } from '@/components/FfeApprovedCatalog'

export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false }, title: 'Approved catalog — Stay Hospitality' }

export default async function PublicCatalogPage({ params }: { params: { code: string } }) {
  const code = String(params.code || '')
  const r = await readShared(code, true)
  if (!r) notFound()
  return (
    <main className="min-h-screen bg-app text-ink">
      <div className="max-w-[1180px] mx-auto px-4 py-8">
        <header className="mb-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold">Stay Hospitality · {r.mode === 'select' ? 'Choose your furnishings' : 'Approved catalog'}</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">{r.catalog.title}</h1>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            {r.mode === 'select'
              ? 'For each item, tap "Choose this" on the option you want for your property. Your choices save as you go; the Stay team orders from them, now and whenever something needs replacing.'
              : 'The furniture and amenities approved for this property, with the vendor and price for each. When something needs replacing, these are the approved options.'}
          </p>
        </header>
        <FfeApprovedCatalog property={r.catalog.property} publicCode={code} />
      </div>
    </main>
  )
}
