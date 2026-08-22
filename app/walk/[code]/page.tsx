import WalkEngine from '@/components/WalkEngine'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Guided walk', robots: { index: false, follow: false } }

// The v2 walk engine — same share code, same audit, new legs. /audit/<code> stays the classic form.
// No Shell on this route, so nothing pads it away from the notch or the home indicator by default:
// WalkEngine's own Screen carries px-safe and its fixed NavBar carries pb-safe. Adding either here
// as well would count the insets twice.
export default function WalkPage({ params }: { params: { code: string } }) {
  return <WalkEngine code={params.code} />
}
