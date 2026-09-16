// DELETE, SAFELY — the one place anything in the app gets deleted.
//
// Two rules, both learned from watching people be afraid of delete buttons:
//   1. A delete is REVERSIBLE for as long as anyone might notice. The row is photographed into
//      `deleted_records` before it goes, so Restore is a real button and not an apology.
//   2. A delete is not gated behind a PASSWORD. The old glitch delete demanded the admin share
//      password, which had never been set — so the honest behaviour of that button was "Delete is
//      locked", forever, with no way to find that out except pressing it. Somebody already signed
//      in as an admin does not prove who they are twice.
import 'server-only'
import { getAccess, isSuperadmin } from '@/lib/access'

export type Kind = 'glitch' | 'claim' | 'project'

const TABLE: Record<Kind, string> = { glitch: 'glitches', claim: 'claims', project: 'projects' }

/**
 * EVERY TABLE THAT HANGS OFF A PROJECT, and the column that points back at it.
 *
 * Deleting a project is the first delete in this app that takes a whole tree with it, and the row
 * itself is the least of what somebody would miss: the tasks, who they were assigned to, the
 * comments, the invoices and the files all live in other tables. A photograph that captured only
 * the `projects` row would make Restore a lie — it would bring back an empty board.
 *
 * The database would cascade most of these on delete anyway, which is exactly why they have to be
 * read BEFORE the delete and written back after. Order matters on the way back: parents first, or
 * a foreign key refuses the child.
 */
const PROJECT_CHILDREN: { table: string; col: string }[] = [
  { table: 'project_members', col: 'project_id' },
  { table: 'project_links', col: 'project_id' },
  { table: 'project_steps', col: 'project_id' },
  { table: 'project_task_assignees', col: 'project_id' },
  { table: 'project_task_homes', col: 'project_id' },
  { table: 'project_notes', col: 'project_id' },
  { table: 'project_photos', col: 'project_id' },
  { table: 'project_invoices', col: 'project_id' },
  { table: 'project_view_prefs', col: 'project_id' },
]

export type Who = { email: string; ok: boolean; reason: string }

/** Deleting is an admin move. The owner always passes; everyone else needs the admin role. */
export async function canDelete(): Promise<Who> {
  const a = await getAccess()
  const email = String(a.email || '')
  if (!email) return { email: '', ok: false, reason: 'Sign in first.' }
  if (isSuperadmin(email)) return { email, ok: true, reason: '' }
  if (a.role === 'admin') return { email, ok: true, reason: '' }
  return { email, ok: false, reason: 'Only an admin can delete. Ask Jon, or have your role changed on Users.' }
}

/**
 * WHO MAY BIN A PROJECT. Jon, 2026-09-16: "only project owner is able to do that or admin."
 *
 * Owner means a member of THIS project whose role is owner — not the app-wide admin role, and not
 * the `lead_email` field, which is a label for who is running the work rather than a permission.
 * The superadmin passes because he passes everywhere; an app admin passes because that is the
 * second half of what Jon asked for.
 */
export async function canDeleteProject(projectId: string): Promise<Who> {
  const a = await getAccess()
  const email = String(a.email || '').toLowerCase()
  if (!email) return { email: '', ok: false, reason: 'Sign in first.' }
  if (isSuperadmin(email)) return { email, ok: true, reason: '' }
  if (a.role === 'admin') return { email, ok: true, reason: '' }
  try {
    const { supabaseAdmin } = await import('@/lib/supabase-admin')
    const { data } = await supabaseAdmin().from('project_members')
      .select('role').eq('project_id', projectId).eq('email', email).maybeSingle()
    if (String((data as any)?.role || '') === 'owner') return { email, ok: true, reason: '' }
  } catch { /* fall through to the refusal */ }
  return { email, ok: false, reason: 'Only this project\'s owner or an admin can delete it.' }
}

function labelFor(kind: Kind, row: any): string {
  if (kind === 'project') return String(row.title || 'Untitled project').slice(0, 120)
  if (kind === 'claim') {
    const bits = [row.property, row.unit_no, row.guest_name, row.confirmation_code]
      .map((x: any) => String(x || '').trim()).filter(Boolean)
    return bits.length ? bits.join(', ') : 'Untitled claim'
  }
  const unit = String(row.unit || '').trim()
  const head = String(row.overview || 'Glitch').split('\n')[0].slice(0, 80)
  return unit ? unit + ' — ' + head : head
}

export type DeleteResult = { ok: boolean; trashId?: string; label?: string; error?: string }

/**
 * Photograph the row (and its children) into the graveyard, then delete it for real.
 * Deleting for real is deliberate: see the note at the top of migration 019.
 */
export async function trashRecord(db: any, kind: Kind, id: string, by: string): Promise<DeleteResult> {
  const table = TABLE[kind]
  if (!table) return { ok: false, error: 'Unknown record type.' }

  const { data: row, error: readErr } = await db.from(table).select('*').eq('id', id).maybeSingle()
  if (readErr) return { ok: false, error: readErr.message }
  if (!row) return { ok: false, error: 'That record is already gone.' }

  let children: any[] = []
  if (kind === 'claim') {
    const { data: items } = await db.from('claim_items').select('*').eq('claim_id', id)
    children = Array.isArray(items) ? items : []
  }
  if (kind === 'project') {
    // Shaped as {table, rows} so restore knows where each pile goes without guessing from columns.
    for (const c of PROJECT_CHILDREN) {
      try {
        const { data } = await db.from(c.table).select('*').eq(c.col, id).limit(5000)
        if (Array.isArray(data) && data.length) children.push({ table: c.table, rows: data })
      } catch { /* a table that does not exist yet simply contributes nothing */ }
    }
  }

  const label = labelFor(kind, row)
  // The photograph goes in FIRST. If this insert fails we have not deleted anything, which is the
  // right way round to fail.
  const { data: shot, error: shotErr } = await db.from('deleted_records')
    .insert({ kind, record_id: String(id), label, payload: row, children, deleted_by: by })
    .select('id').single()
  if (shotErr || !shot) return { ok: false, error: (shotErr && shotErr.message) || 'Could not save a copy, so nothing was deleted.' }

  const { error: delErr } = await db.from(table).delete().eq('id', id)
  if (delErr) {
    // Roll the photograph back rather than leaving a ghost in the trash for a row that still exists.
    try { await db.from('deleted_records').delete().eq('id', (shot as any).id) } catch { /* best effort */ }
    return { ok: false, error: delErr.message }
  }
  return { ok: true, trashId: String((shot as any).id), label }
}

export type RestoreResult = { ok: boolean; kind?: Kind; recordId?: string; label?: string; error?: string }

/** Put it back exactly as it was, children and all. */
export async function restoreRecord(db: any, trashId: string, by: string): Promise<RestoreResult> {
  const { data: shot } = await db.from('deleted_records').select('*').eq('id', trashId).maybeSingle()
  if (!shot) return { ok: false, error: 'Nothing in the trash with that id.' }
  if ((shot as any).restored_at) return { ok: false, error: 'That one has already been restored.' }
  const kind = String((shot as any).kind) as Kind
  const table = TABLE[kind]
  if (!table) return { ok: false, error: 'Unknown record type.' }

  const payload = (shot as any).payload
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'The saved copy is unreadable.' }

  const { error } = await db.from(table).upsert(payload, { onConflict: 'id' })
  if (error) return { ok: false, error: error.message }

  const children = Array.isArray((shot as any).children) ? (shot as any).children : []
  if (kind === 'claim' && children.length) {
    try { await db.from('claim_items').upsert(children, { onConflict: 'id' }) } catch { /* the claim itself is back either way */ }
  }
  if (kind === 'project' && children.length) {
    // PROJECT_CHILDREN order, not the stored order: project_steps must exist before a row that
    // references a task, or the foreign key refuses it. Each pile is attempted on its own so one
    // failure returns nine-tenths of a board rather than none of it.
    const byTable: Record<string, any[]> = {}
    for (const c of children) if (c && c.table && Array.isArray(c.rows)) byTable[String(c.table)] = c.rows
    const failed: string[] = []
    for (const c of PROJECT_CHILDREN) {
      const rows = byTable[c.table]
      if (!rows || !rows.length) continue
      try {
        const { error: cErr } = await db.from(c.table).upsert(rows, { onConflict: 'id' })
        if (cErr) failed.push(c.table)
      } catch { failed.push(c.table) }
    }
    if (failed.length) {
      await db.from('deleted_records').update({ restored_at: new Date().toISOString(), restored_by: by }).eq('id', trashId)
      return { ok: true, kind, recordId: String((shot as any).record_id), label: String((shot as any).label || ''),
        error: `The board is back, but some of it did not restore: ${failed.join(', ')}.` }
    }
  }

  await db.from('deleted_records').update({ restored_at: new Date().toISOString(), restored_by: by }).eq('id', trashId)
  return { ok: true, kind, recordId: String((shot as any).record_id), label: String((shot as any).label || '') }
}
