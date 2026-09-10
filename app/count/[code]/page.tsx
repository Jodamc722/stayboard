import { InventoryCount } from '@/components/InventoryCount'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Stock count — Stay Hospitality' }

export default function CountPage({ params }: { params: { code: string } }) {
  return <InventoryCount code={params.code} />
}
