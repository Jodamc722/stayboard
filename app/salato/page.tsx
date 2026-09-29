// /salato — the bare front-desk page is gone (2026-09-28 audit). It had no navigation and nothing
// linked to it; its reservation tabs were superseded by the share board at /salato/share, and its
// one live job — choosing which units the Salato board, verification and daily email cover — moved
// to Users & admin → Settings → Salato front-desk units. The path stays as a redirect because the
// `salato` role key in lib/features.ts still names it: Eve's app atlas is built from that registry,
// and she must never send anyone to a 404.
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function SalatoPage() {
  redirect('/users?tab=settings&panel=salato-units')
}
