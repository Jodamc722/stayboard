// Integrations moved into Users & admin → App settings (September audit, pass 2). The middleware
// gate on this path (`integrations` key) still runs before the redirect, so nobody who could not
// open the old page is sent to the console.
import { redirect } from 'next/navigation'
export const dynamic = 'force-dynamic'
export default function IntegrationsRedirect() { redirect('/users?tab=settings&panel=integrations') }
