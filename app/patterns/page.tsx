import { redirect } from 'next/navigation'

// Nav diet 2026-08-11 (Jon): Building Patterns lives inside Guest Issues now
// (/glitches → Patterns tab). This route stays only so old links keep working.
export const dynamic = 'force-dynamic'

export default function PatternsPage() {
  redirect('/glitches')
}
