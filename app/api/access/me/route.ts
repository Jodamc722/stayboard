// Lightweight "who am I" for the client nav: returns the caller's role + access flags.
import { NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
export const dynamic = 'force-dynamic'
export async function GET() {
  const a = await getAccess()
  return NextResponse.json({ email: a.email, role: a.role, allowed: a.allowed, isAdmin: a.role === 'admin' })
}
