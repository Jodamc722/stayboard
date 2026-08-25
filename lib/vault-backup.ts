// VAULT BACKUPS — an automatic copy after EVERY change (Jon, 2026-08-25: "auto save to a file
// when any updates are made, for backup").
//
// SERVER ONLY (node:crypto via ./vault, VAULT_KEY).
//
// Two shapes, one reason:
//   SNAPSHOT — written automatically after every create / edit / delete / upload / import /
//              share change. The whole vault (items + grants) as JSON, sealed with VAULT_KEY
//              (AES-256-GCM), dropped in the PRIVATE 'vault' bucket under backups/. Secrets stay
//              encrypted inside it twice over — the snapshot is exactly as safe as the table.
//   CSV      — the human copy, minted on demand for the Super Admin with the vault code, logged
//              as 'export'. Same columns the importer reads, so a backup is also a restore.
//
// Snapshots are best-effort: a backup failure never blocks the change that triggered it.
import { supabaseAdmin } from './supabase-admin'
import { ITEMS, GRANTS, VAULT_BUCKET, encryptSecret, decryptSecret, vaultKeyReady, logAccess } from './vault'

export const BACKUP_PREFIX = 'backups/'
const KEEP = 60                       // newest snapshots kept; older ones are pruned

/** Columns of the CSV backup — and, by design, of the CSV import. */
export const CSV_COLUMNS = ['category', 'title', 'username', 'password', 'url', 'building', 'unit', 'notes', 'tags', 'kind', 'expires_on', 'owner', 'updated_at'] as const

async function ensureBucket(sb: ReturnType<typeof supabaseAdmin>) {
  const { data } = await sb.storage.getBucket(VAULT_BUCKET)
  if (data) return
  const { error } = await sb.storage.createBucket(VAULT_BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message || '')) throw new Error('storage bucket: ' + error.message)
}

/**
 * Write one sealed snapshot of the whole vault. Call AFTER the change has landed.
 * Returns the object path, or null when it could not be written (never throws).
 */
export async function snapshotVault(trigger: string, by: string): Promise<string | null> {
  try {
    if (!vaultKeyReady()) return null          // nothing to seal with — the vault itself refuses secrets too
    const db = supabaseAdmin()
    const [items, grants] = await Promise.all([
      db.from(ITEMS).select('*').is('deleted_at', null).order('updated_at', { ascending: false }).limit(5000),
      db.from(GRANTS).select('*').limit(20000),
    ])
    if (items.error) return null
    const payload = {
      version: 1,
      at: new Date().toISOString(),
      trigger: String(trigger).slice(0, 80),
      by: String(by || '').toLowerCase().slice(0, 200),
      items: items.data || [],
      grants: grants.data || [],
    }
    const sealed = encryptSecret(JSON.stringify(payload))
    await ensureBucket(db)
    // Lexically sortable name: newest last, so listing + pruning is a sort, not a parse.
    const stamp = payload.at.replace(/[:.]/g, '-')
    const path = BACKUP_PREFIX + 'vault-' + stamp + '.json.enc'
    const up = await db.storage.from(VAULT_BUCKET).upload(path, Buffer.from(sealed, 'utf8'), { contentType: 'text/plain', upsert: false })
    if (up.error) return null
    await logAccess({ itemId: null, email: by, action: 'backup', detail: trigger + ' → ' + path.slice(BACKUP_PREFIX.length) + ' · ' + payload.items.length + ' items' })
    await prune(db)
    return path
  } catch { return null }
}

async function prune(db: ReturnType<typeof supabaseAdmin>) {
  try {
    const all = await listSnapshots(db)
    const old = all.slice(KEEP).map(s => BACKUP_PREFIX + s.name)
    if (old.length) await db.storage.from(VAULT_BUCKET).remove(old)
  } catch { /* pruning is housekeeping */ }
}

/** Newest first. */
export async function listSnapshots(db = supabaseAdmin()): Promise<{ name: string; bytes: number; at: string }[]> {
  const { data } = await db.storage.from(VAULT_BUCKET).list(BACKUP_PREFIX.replace(/\/$/, ''), { limit: 1000, sortBy: { column: 'name', order: 'desc' } })
  return ((data || []) as any[])
    .filter(o => /\.json\.enc$/.test(String(o.name)))
    .map(o => ({ name: String(o.name), bytes: Number(o.metadata?.size || 0), at: String(o.created_at || o.updated_at || '') }))
    .sort((a, b) => (a.name < b.name ? 1 : -1))
}

/** Open one snapshot (server side only; the caller has already checked the code + Super Admin). */
export async function readSnapshot(name: string): Promise<any | null> {
  const safe = String(name || '').replace(/[^A-Za-z0-9._-]/g, '')
  if (!safe) return null
  const db = supabaseAdmin()
  const dl = await db.storage.from(VAULT_BUCKET).download(BACKUP_PREFIX + safe)
  if (dl.error || !dl.data) return null
  const sealed = Buffer.from(await dl.data.arrayBuffer()).toString('utf8')
  try { return JSON.parse(decryptSecret(sealed)) } catch { return null }
}

// ── CSV ────────────────────────────────────────────────────────────────────────────────────────

function csvCell(v: any): string {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** The human backup. DECRYPTS every secret — only ever called after Super Admin + vault code. */
export function itemsToCsv(rows: any[]): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const r of rows) {
    let password = ''
    if (r.secret_cipher) { try { password = decryptSecret(String(r.secret_cipher)) } catch { password = '(unreadable — stored under a different VAULT_KEY)' } }
    lines.push([
      r.category, r.title, r.username, password, r.url, r.property_id, r.unit_no, r.description,
      Array.isArray(r.tags) ? r.tags.join(',') : '', r.kind, r.expires_on, r.owner_email, r.updated_at,
    ].map(csvCell).join(','))
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}

/** RFC-4180-ish parser: quoted fields, doubled quotes, CR/LF inside quotes. Returns rows of cells. */
export function parseCsv(text: string): string[][] {
  const src = String(text || '').replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(x => x.trim() !== ''))
}

export type ImportRow = {
  category: string; title: string; username: string; password: string; url: string
  building: string; unit: string; notes: string; tags: string[]; kind: 'secret' | 'file' | 'note'; expires_on: string
}

/** Header-driven: columns may come in any order; unknown columns are ignored. */
export function csvToImportRows(text: string): { rows: ImportRow[]; problems: string[] } {
  const grid = parseCsv(text)
  const problems: string[] = []
  if (!grid.length) return { rows: [], problems: ['The file is empty.'] }
  const head = grid[0].map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''))
  const idx = (names: string[]) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i } return -1 }
  const col = {
    category: idx(['category', 'shelf', 'section']),
    title: idx(['title', 'name', 'service', 'account']),
    username: idx(['username', 'user', 'login', 'email']),
    password: idx(['password', 'secret', 'code', 'pw']),
    url: idx(['url', 'link', 'website']),
    building: idx(['building', 'property', 'property_id']),
    unit: idx(['unit', 'unit_no']),
    notes: idx(['notes', 'description', 'note']),
    tags: idx(['tags']),
    kind: idx(['kind', 'type']),
    expires_on: idx(['expires_on', 'expires', 'expiry']),
  }
  if (col.title < 0) return { rows: [], problems: ['No "title" column. The header row needs at least: title, username, password.'] }
  const rows: ImportRow[] = []
  const get = (r: string[], i: number) => (i >= 0 && i < r.length ? String(r[i] || '').trim() : '')
  grid.slice(1).forEach((r, n) => {
    const title = get(r, col.title).slice(0, 160)
    if (!title) { problems.push('Row ' + (n + 2) + ': no title — skipped.'); return }
    const password = get(r, col.password)
    let kind = get(r, col.kind).toLowerCase() as ImportRow['kind']
    if (!['secret', 'file', 'note'].includes(kind)) kind = password ? 'secret' : 'note'
    if (kind === 'secret' && !password) { problems.push('Row ' + (n + 2) + ' (' + title + '): no password — stored as a note.'); kind = 'note' }
    rows.push({
      category: get(r, col.category).toLowerCase().slice(0, 40) || 'company',
      title, username: get(r, col.username).slice(0, 200), password: password.slice(0, 4000),
      url: get(r, col.url).slice(0, 500), building: get(r, col.building).slice(0, 60), unit: get(r, col.unit).slice(0, 40),
      notes: get(r, col.notes).slice(0, 4000),
      tags: get(r, col.tags).split(/[,;|]/).map(t => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12),
      kind, expires_on: get(r, col.expires_on).slice(0, 10),
    })
  })
  return { rows, problems }
}

