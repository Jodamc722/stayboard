// Share links + shared password, for the logged-in team (Settings page).
// AUTH-GATED: only signed-in users can read or change the vendor share password.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentSharePassword, currentAdminPassword } from '@/lib/shareAuth'

export const dynamic = 'force-dynamic'

const LINKS = [
  { v: 'botanica', label: 'Botanica' },
  { v: 'pt', label: 'Park Towers' },
  { v: 'amrit-capri-lucerne', label: 'Amrit / Capri / Lucerne' },
  { v: 'salato', label: 'Salato (front desk)' },
  { v: 'botanica-report', label: 'Botanica report (Margaux)', path: '/report/botanica' },
]

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const password = await currentSharePassword()
  const adminSet = !!(await currentAdminPassword())
  return NextResponse.json({ ok: true, password, adminSet, links: LINKS })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))
    const db = supabaseAdmin()
    // ADMIN password (row id=2) — gates destructive actions like Delete
    if (body.adminPassword !== undefined) {
      const ap = String(body.adminPassword || '').trim()
      if (ap.length < 4) return NextResponse.json({ ok: false, error: 'Admin password must be at least 4 characters.' }, { status: 400 })
      const { error } = await db.from('share_settings').upsert({ id: 2, password: ap, updated_at: new Date().toISOString() })
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, adminSet: true })
    }
    const password = String(body.password || '').trim()
    if (password.length < 4) return NextResponse.json({ ok: false, error: 'Password must be at least 4 characters.' }, { status: 400 })
    const { error } = await db.from('share_settings').upsert({ id: 1, password, updated_at: new Date().toISOString() })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, password })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
