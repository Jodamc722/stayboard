import WalkEngine from '@/components/WalkEngine'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Guided walk', robots: { index: false, follow: false } }

// The v2 walk engine — same share code, same audit, new legs. /audit/<code> stays the classic form.
export default function WalkPage({ params }: { params: { code: string } }) {
  return <WalkEngine code={params.code} />
}
