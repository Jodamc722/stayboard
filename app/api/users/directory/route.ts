// WHO CAN BE ASSIGNED (Jon, 2026-09-22: "assignee should just be users in the app").
//
// The glitch assignee picker used to list every Breezeway person — 120+ housekeepers and techs,
// most of whom never open Lighthouse. Assignment is an office job: someone who will see the card,
// get the notification and follow it through. So the picker lists active app users only.
//
// Readable by any signed-in user with access (the admin-only /api/users carries far more). Returns
// name and email, nothing else.
import { NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!access.allowed) return NextResponse.json({ error: 'no-access' }, { status: 403 })
  const { data, error } = await supabaseAdmin().from('app_users').select('email,status,profile').limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const users = ((data as any[]) || [])
    .filter(u => u && u.email && String(u.status || 'active') === 'active')
    .map(u => {
      const email = String(u.email).toLowerCase()
      const p = u.profile && typeof u.profile === 'object' ? u.profile : {}
      const name = String(p.name || p.full_name || '').trim()
      return { email, name: name || email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json({ ok: true, users })
}
