import type { Metadata } from 'next'
import { DirectBooking } from '@/components/DirectBooking'

// BOOK DIRECT — the public booking page (Jon, 2026-10-13: "a webpage where people can book direct with
// us, optimized for speed, ease, and verification of ID and selfie, and have it book"). No login.
// Everything happens in components/DirectBooking against /api/public/book.
export const metadata: Metadata = {
  title: 'Book direct · Stay Hospitality',
  description: 'Book your stay directly with Stay Hospitality — best rate, instant confirmation.',
  robots: { index: true, follow: true },
}

export default function BookPage() {
  return <DirectBooking />
}
