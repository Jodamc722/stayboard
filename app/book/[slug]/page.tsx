// A booking link's public page (lib/booking): pick a day, pick a time, confirm. /book/<type>, or
// /book/<type>?o=<owner's onboarding code> when it is shared with an owner.
import type { Metadata } from 'next'
import { BookingPage } from '@/components/BookingPage'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Book a time · Stay Hospitality', robots: { index: false, follow: false } }

export default function Page({ params, searchParams }: { params: { slug: string }; searchParams: { o?: string } }) {
  return <BookingPage slug={params.slug} owner={typeof searchParams?.o === 'string' ? searchParams.o : ''} />
}
