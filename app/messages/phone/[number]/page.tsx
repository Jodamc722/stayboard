// Old phone-thread link (/messages/phone/<number>) → the guest inbox's phone thread. Routes swapped 2026-10-16.
import { redirect } from 'next/navigation'
export const dynamic = 'force-dynamic'
export default function OldPhoneThread({ params }: { params: { number: string } }) { redirect('/inbox/phone/' + encodeURIComponent(params.number)) }
