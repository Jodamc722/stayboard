// VAULT LOG — who entered the code, what they opened, and who got it wrong. Across every item.
// Admins only: the per-item history stays with whoever manages the item (see ./grants), but the
// whole-vault view is the answer to "who has been in the vault this week", and that is an admin
// question.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { vaultWideLog, isMissingTable } from '@/lib/vault'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ ok: false, error: 'Admins only.' }, { status: 403 })
  const days = Math.max(1, Math.min(365, Number(req.nextUrl.searchParams.get('days') || 30) || 30))
  try {
    const rows = await vaultWideLog(days, 800)
    const people = Array.from(new Set(rows.map(r => String(r.email || '')).filter(Boolean))).sort()
    return NextResponse.json({ ok: true, days, rows, people })
  } catch (e: any) {
    const msg = String(e?.message || e)
    return NextResponse.json({ ok: false, needsMigration: isMissingTable(msg), error: msg.slice(0, 200) }, { status: 500 })
  }
}
