// Old guest-thread link (/messages/<conversation>) → the guest inbox's thread. Routes swapped 2026-10-16.
import { redirect } from 'next/navigation'
export const dynamic = 'force-dynamic'
export default function OldThread({ params }: { params: { id: string } }) { redirect('/inbox/' + encodeURIComponent(params.id)) }
