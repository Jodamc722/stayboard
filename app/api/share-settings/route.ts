// Share links + shared password, for the logged-in team (Settings page).
// AUTH-GATED: only signed-in users can read or change the vendor share password.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentSharePassword, currentAdminPassword, currentMarketingPassword, currentAuditPassword } from '@/lib/shareAuth'
import { isSuperadmin } from '@/lib/access'

export const dynamic = 'force-dynamic'

const LINKS = [
  { v: 'botanica', label: 'Botanica' },
  { v: 'pt', label: 'Park Towers' },
  { v: 'amrit-capri-lucerne', label: 'Amrit / Capri / Lucerne' },
  { v: 'salato', label: 'Salato (front desk)' },
  { v: 'botanica-report', label: 'Botanica report (Margaux)', path: '/report/botanica' },
  { v: 'garden-guide', label: 'The Garden - guest guide (public)', path: '/guide/garden' },
]

// Links on their OWN password (not the vendor share password).
const MARKETING_LINKS = [
  { v: 'marketing-report', label: 'Direct bookings (marketing partners)', path: '/report/marketing' },
]

// Owner-statement audit — its own password again, because the reviewer sees owner-level money.
const AUDIT_LINKS = [
  { v: 'owner-audit', label: 'Owner statement audit (reviewers)', path: '/report/owner-audit' },
]

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const password = await currentSharePassword()
  const adminCur = await currentAdminPassword()
  const adminSet = !!adminCur
  // The admin password itself is visible ONLY to the Super Admin account (Jon).
  const marketing = await currentMarketingPassword()
  const audit = await currentAuditPassword()
  const payload: Record<string, any> = { ok: true, password, adminSet, links: LINKS, marketingLinks: MARKETING_LINKS, marketingSet: !!marketing, marketingPassword: marketing, auditLinks: AUDIT_LINKS, auditSet: !!audit, auditPassword: audit }
  if (isSuperadmin(user.email)) payload.adminPassword = adminCur
  return NextResponse.json(payload)
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
    // MARKETING password (row id=3) — the partner-facing direct-booking report only
    if (body.marketingPassword !== undefined) {
      const mp = String(body.marketingPassword || '').trim()
      if (mp.length < 4) return NextResponse.json({ ok: false, error: 'Marketing password must be at least 4 characters.' }, { status: 400 })
      const { error } = await db.from('share_settings').upsert({ id: 3, password: mp, updated_at: new Date().toISOString() })
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, marketingSet: true, marketingPassword: mp })
    }
    // AUDIT password (row id=4) — the owner-statement audit share link only
    if (body.auditPassword !== undefined) {
      const ap = String(body.auditPassword || '').trim()
      if (ap.length < 4) return NextResponse.json({ ok: false, error: 'Audit password must be at least 4 characters.' }, { status: 400 })
      const { error } = await db.from('share_settings').upsert({ id: 4, password: ap, updated_at: new Date().toISOString() })
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, auditSet: true, auditPassword: ap })
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
