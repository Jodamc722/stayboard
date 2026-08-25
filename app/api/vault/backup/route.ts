// VAULT BACKUPS — list the automatic snapshots, and mint the human CSV copy.
//
//   GET            → admins: the snapshot list (names, sizes, when) — metadata only.
//   POST {code}    → SUPER ADMIN + vault code: the whole vault as a CSV, passwords in clear,
//                    as a file download. Logged as 'export'. The same columns the importer reads.
//   POST {code, snapshot} → SUPER ADMIN + code: one automatic snapshot, opened and returned as CSV.
//
// The decrypted CSV is the one artifact in this app that holds every password at once. That is
// why it is owner-only, code-gated, logged, and never cached.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ITEMS, logAccess, checkVaultCode, codeFrom, codeEntered, vaultKeyReady } from '@/lib/vault'
import { listSnapshots, readSnapshot, itemsToCsv, snapshotVault } from '@/lib/vault-backup'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ipOf = (req: NextRequest) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null

export async function GET() {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ ok: false, error: 'Admins only.' }, { status: 403 })
  try {
    const snapshots = await listSnapshots()
    return NextResponse.json({ ok: true, snapshots, keyReady: vaultKeyReady(), canExport: isSuperadmin(access.email) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const me = String(access.email || '')
  const b = await req.json().catch(() => ({} as any))

  // "Snapshot now" — any admin, no code: it writes nothing readable, only a sealed copy.
  if (b.action === 'snapshot') {
    if (access.role !== 'admin') return NextResponse.json({ ok: false, error: 'Admins only.' }, { status: 403 })
    const path = await snapshotVault('manual', me)
    return NextResponse.json({ ok: !!path, path, error: path ? undefined : 'Could not write a snapshot (is VAULT_KEY set?).' })
  }

  if (!isSuperadmin(access.email)) return NextResponse.json({ ok: false, error: 'Only the Super Admin can download the vault in clear.' }, { status: 403 })
  const gate = await checkVaultCode({ code: codeFrom(req, b), email: me, ip: ipOf(req), purpose: 'export' })
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error, codeUnset: !!gate.codeUnset, wrongCode: !!gate.wrongCode }, { status: gate.status })
  if (!vaultKeyReady()) return NextResponse.json({ ok: false, error: 'VAULT_KEY is not set on the server, so nothing can be decrypted.' }, { status: 503 })

  try {
    let rows: any[] = []
    let label = 'live'
    if (b.snapshot) {
      const snap = await readSnapshot(String(b.snapshot))
      if (!snap) return NextResponse.json({ ok: false, error: 'That snapshot could not be opened.' }, { status: 404 })
      rows = Array.isArray(snap.items) ? snap.items : []
      label = String(b.snapshot).replace(/\.json\.enc$/, '')
    } else {
      const { data, error } = await supabaseAdmin().from(ITEMS).select('*').is('deleted_at', null).order('category').order('title').limit(5000)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      rows = (data || []) as any[]
    }
    // Log BEFORE answering, like reveal: the export happened even if the download is abandoned.
    await logAccess({ itemId: null, email: me, action: 'export', detail: codeEntered(label + ' · ' + rows.length + ' items'), ip: ipOf(req) })
    const csv = itemsToCsv(rows)
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="stay-vault-backup-' + stamp + '.csv"',
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
