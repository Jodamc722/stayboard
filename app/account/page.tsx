// MY ACCOUNT (Jon, 2026-11-20): every person's own Google connection and their own booking links. Login only, no
// role setting: it is each person's own page (lib/features UNGATED_PAGES).
import { Shell } from '@/components/Shell'
import { MyAccount } from '@/components/MyAccount'
export const dynamic = 'force-dynamic'
export default function AccountPage() { return <Shell><MyAccount /></Shell> }
