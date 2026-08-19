// PUBLIC share-link page — renders whatever live sections the link's row allows, nothing else.
// The page itself is a thin shell; the data comes from /api/share/[code] on every load, so what
// the holder sees is always current and always exactly what the link is configured to show.
import { SharedView } from '@/components/SharedView'

export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false }, title: 'Shared — Stay Hospitality' }

export default function SharePage({ params }: { params: { code: string } }) {
  return <SharedView code={String(params.code || '')} />
}
