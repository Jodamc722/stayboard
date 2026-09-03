// Custom Fields moved into Users & admin → App settings (September audit, pass 2).
import { redirect } from 'next/navigation'
export const dynamic = 'force-dynamic'
export default function CustomFieldsRedirect() { redirect('/users?tab=settings&panel=custom-fields') }
