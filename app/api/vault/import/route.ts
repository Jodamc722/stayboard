// VAULT IMPORT — many logins in one go, from a CSV (the Asana "Login Credentials" export, cleaned;
// or a CSV backup this app produced — same columns, so a backup is a restore).
//
// Admins only. Jon 2026-08-25: no vault code on import — an import WRITES entries and never reveals
// one, so the code (which guards reading) stays on reveal/copy/open/export; the import itself is
// role-gated and written to the log. Every row lands encrypted exactly as if typed by hand, owned
// by the importer (deny-by-default sharing still applies — share from the item afterwards).
// A row whose title + username already exists (not deleted) is skipped, so re-running an import
// never doubles the shelf. One 'import' audit row + one sealed snapshot per run.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ITEMS, CATEGORY_IDS, encryptSecret, maskHint, vaultKeyReady, logAccess, isMissingTable } from '@/lib/vault'
import { csvToImportRows, snapshotVault } from '@/lib/vault-backup'
import { pageRows } from '@/lib/db-page'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ipOf = (req: NextRequest) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
const lower = (s: any) => String(s || '').trim().toLowerCase()

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isVrLogin(access)) return hotelOnlyRes()
  if (access.role !== 'admin') return NextResponse.json({ ok: false, error: 'Only an admin can import into the vault.' }, { status: 403 })
  const me = String(access.email || '')

  const b = await req.json().catch(() => ({} as any))
  const csv = typeof b.csv === 'string' ? b.csv : ''
  if (!csv.trim()) return NextResponse.json({ ok: false, error: 'No CSV was sent.' }, { status: 400 })
  if (csv.length > 4 * 1024 * 1024) return NextResponse.json({ ok: false, error: 'That file is larger than 4 MB.' }, { status: 400 })

  const { rows, problems } = csvToImportRows(csv)
  if (!rows.length) return NextResponse.json({ ok: false, error: problems[0] || 'Nothing to import.', problems }, { status: 400 })
  if (rows.some(r => r.kind === 'secret') && !vaultKeyReady()) {
    return NextResponse.json({ ok: false, error: 'VAULT_KEY is not set on the server, so passwords cannot be stored yet.' }, { status: 503 })
  }
  // Preview mode: parse and report, write nothing. The UI shows this before the real run.
  if (b.dryRun) return NextResponse.json({ ok: true, dryRun: true, total: rows.length, problems, rows: rows.map(r => ({ category: r.category, title: r.title, username: r.username, kind: r.kind, hasPassword: !!r.password })) })

  try {
    const db = supabaseAdmin()
    // Paged (was one read capped at 1,000): the "already there" check has to see every entry, or a
    // re-run import past 1,000 items would double the shelf. A short read imports nothing.
    const existing = await pageRows<any>((lo, hi) => db.from(ITEMS).select('id, title, username').is('deleted_at', null).order('id').range(lo, hi))
    if (existing.truncated) {
      // Say why when the database says why (a missing table still reads as "run the migration").
      const { error } = await db.from(ITEMS).select('id').limit(1)
      const msg = error ? error.message : 'Could not read every existing entry, so nothing was imported — try again.'
      return NextResponse.json({ ok: false, needsMigration: error ? isMissingTable(error.message) : false, error: msg }, { status: 500 })
    }
    const seen = new Set(existing.rows.map(r => lower(r.title) + '|' + lower(r.username)))

    const toInsert: any[] = []
    let skipped = 0
    for (const r of rows) {
      const key = lower(r.title) + '|' + lower(r.username)
      if (seen.has(key)) { skipped++; continue }
      seen.add(key)
      const row: any = {
        kind: r.kind,
        category: CATEGORY_IDS.includes(r.category) ? r.category : 'company',
        title: r.title,
        description: r.notes || null,
        property_id: r.building || null,
        unit_no: r.unit || null,
        username: r.username || null,
        url: r.url || null,
        expires_on: /^\d{4}-\d{2}-\d{2}$/.test(r.expires_on) ? r.expires_on : null,
        tags: r.tags,
        owner_email: me,
        created_by: me,
      }
      if (r.password) { row.secret_cipher = encryptSecret(r.password); row.secret_hint = maskHint(r.password) }
      toInsert.push(row)
    }

    let created = 0
    for (let i = 0; i < toInsert.length; i += 100) {
      const chunk = toInsert.slice(i, i + 100)
      const ins = await db.from(ITEMS).insert(chunk).select('id')
      if (ins.error) return NextResponse.json({ ok: false, error: ins.error.message, created, skipped, problems }, { status: 500 })
      created += (ins.data || []).length
    }

    await logAccess({ itemId: null, email: me, action: 'import', detail: created + ' created, ' + skipped + ' already there', ip: ipOf(req) })
    await snapshotVault('import', me)
    return NextResponse.json({ ok: true, created, skipped, total: rows.length, problems })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
