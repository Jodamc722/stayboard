// THE NEED LIST CALCULATOR (Jon, 2026-11-10: "should be a simple list, with recommended items. Almost
// like anyone can use the link to generate what they need"). One standing link, no client, no code:
// /kit/list. Anyone enters bedrooms, bathrooms, guests and the kitchen (yes / no, and which appliances)
// and gets every item the home needs — must-have and recommended, with counts — like the linen
// calculator. The home's details ride in the address (?bd=2&ba=2&g=6&k=1&no=oven), so a filled-in list
// can be shared as a link. Public through the /kit/ prefix; nothing is stored.
import { NeedListCalculator } from '@/components/NeedListCalculator'

export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false }, title: 'What your home needs — Stay Hospitality' }

export default function NeedListPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const one = (k: string) => { const v = searchParams?.[k]; return Array.isArray(v) ? v[0] : v }
  return <NeedListCalculator initial={{ bd: one('bd'), ba: one('ba'), g: one('g'), k: one('k'), no: one('no'), opt: one('opt') }} />
}
