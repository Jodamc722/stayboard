// Labor settings moved into Users & admin → App settings (September audit, pass 2).
import { redirect } from 'next/navigation'
export const dynamic = 'force-dynamic'
export default function LaborSettingsRedirect() { redirect('/users?tab=settings&panel=labor-settings') }
