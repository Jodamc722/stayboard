import { PhotoLibraryShare } from '@/components/PhotoLibraryShare'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Photo library — Stay Hospitality', robots: { index: false, follow: false } }

export default function LibraryLinkPage({ params }: { params: { code: string } }) {
  return <PhotoLibraryShare code={params.code} />
}
