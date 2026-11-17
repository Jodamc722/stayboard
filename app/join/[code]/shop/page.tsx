// THE SHOPPING LIST for an owner's order. Public: the key in the link is the pass, checked by /api/join/<code>/shop.
import { OwnerShop } from '@/components/OwnerShop'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Shopping list · Stay Hospitality', robots: { index: false, follow: false } }
export default function ShopPage({ params, searchParams }: { params: { code: string }; searchParams: { k?: string } }) {
  return <OwnerShop code={String(params.code || '')} k={String(searchParams?.k || '')} />
}
