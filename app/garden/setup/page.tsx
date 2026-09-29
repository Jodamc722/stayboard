// Moved into Garden Hotel → Users & admin (the same console as the VR side, 2026-09-29).
import { redirect } from 'next/navigation'
export default function Moved() { redirect('/garden/users?tab=settings&panel=feeds') }
