import { redirect } from 'next/navigation'
// The 17 West page moved under /ffe/catalogs when catalogs became per-property (2026-10-27).
export const dynamic = 'force-dynamic'
export default function Ffe17WestRedirect() { redirect('/ffe/catalogs/17-west') }
