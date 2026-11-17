// WHICH TABLES ARE MISSING (audit, 2026-11-16). Migrations here are hand-run SQL (see
// supabase/migrations/README.md), so a file can sit in the repo for weeks without its table existing:
// `area_facts` was never created, and every listing draft silently re-measured its drive times.
// Nothing reported it because the code that reads a missing table is written to carry on.
//
// Admin only. Send the table names; it answers which ones the database does not have. It returns no rows.
//   POST /api/health/tables { tables: string[] }
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({} as any))
  const names: string[] = Array.from(new Set((Array.isArray(b?.tables) ? b.tables : []).map((t: any) => String(t)).filter((t: string) => /^[a-z_][a-z_0-9]{0,62}$/.test(t)))).slice(0, 400) as string[]
  if (!names.length) return NextResponse.json({ ok: false, error: 'tables is required.' }, { status: 400 })
  const db = supabaseAdmin()
  const missing: string[] = [], other: { table: string; error: string }[] = []
  // Small batches: the answer matters more than the speed, and this is run by hand.
  for (let i = 0; i < names.length; i += 12) {
    await Promise.all(names.slice(i, i + 12).map(async t => {
      try {
        // Not a HEAD request: a missing table answers a HEAD with no body, and so with no error to read.
        const { error } = await db.from(t).select('*').limit(1)
        if (!error) return
        if (/could not find the table|does not exist|schema cache/i.test(error.message || '')) missing.push(t)
        else other.push({ table: t, error: String(error.message || '').slice(0, 160) })
      } catch (e: any) { other.push({ table: t, error: String(e?.message || e).slice(0, 160) }) }
    }))
  }
  return NextResponse.json({ ok: true, checked: names.length, missing: missing.sort(), other })
}
