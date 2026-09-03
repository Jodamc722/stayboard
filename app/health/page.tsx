// /health moved into Properties (September audit, pass 2): the Health Score is the fourth view on
// /buildings. Old bookmarks and the "All →" link on the KPI board land here and go straight through.
import { redirect } from 'next/navigation'
export const dynamic = 'force-dynamic'
export default function HealthRedirect() { redirect('/buildings?v=health') }
