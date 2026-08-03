// Lightweight verification STATUS lookup for a set of reservation ids (no photos, no PII).
// Used by the internal Reservations tab to show Verify / Verified per Salato row.
// GET ?rids=id1,id2,...  ->  { ok, statuses: { <id>: { verified: true, verifiedAt } } }
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function GET(req: NextRequest) {
  try {
    const raw = str(new URL(req.url).searchParams.get('rids'))
    const rids = raw.split(',').map(s => s.trim()).filter(s => /^[a-z0-9]{6,40}$/i.test(s)).slice(0, 300)
    if (!rids.length) return NextResponse.json({ ok: true, statuses: {} })
    const db = supabaseAdmin()
    const keys = rids.map(id => 'sv:' + id)
    const { data } = await db.from('app_settings').select('key,value').in('key', keys)
    const statuses: Record<string, { verified: boolean; verifiedAt: string | null }> = {}
    for (const row of (data || []) as any[]) {
      const id = str(row.key).slice(3)
      if (row.value) { try { const j = JSON.parse(row.value); if (j && j.status === 'verified') statuses[id] = { verified: true, verifiedAt: str(j.signedAt) || null } } catch {} }
    }
    return NextResponse.json({ ok: true, statuses })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
