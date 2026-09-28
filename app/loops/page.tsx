// Open loops moved inside Eve (Jon, 2026-09-28: "remove open loops and combine it with eve"). The
// route stays so Slack links and old pins still land; the 'loops' key still gates the API.
import { redirect } from 'next/navigation'
export const dynamic = 'force-dynamic'
export default function LoopsRedirect() { redirect('/eve?tab=loops') }
