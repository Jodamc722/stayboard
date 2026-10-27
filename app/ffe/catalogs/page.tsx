import { redirect } from 'next/navigation'
// Catalogs got their own sidebar entry at /catalogs (Jon, 2026-10-27).
export const dynamic = 'force-dynamic'
export default function FfeCatalogsRedirect() { redirect('/catalogs') }
