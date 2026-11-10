// THE LEADERSHIP BOARD API (Jon, 2026-11-06). One standalone board, one flat table (lib/board).
//   GET                                      → lanes, items (open + done ≤60d), proposals, people, properties, importable
//   POST { action: 'add', lane, title, details?, assignees?, due?, priority?, property?, vendor? }
//   POST { action: 'set', id, ...patch }     → any field; status 'done' | 'open' completes / reopens
//   POST { action: 'delete', id }
//   POST { action: 'propose', text, source? } → AI reads the notes, returns proposals (saved)
//   POST { action: 'approve', id, ...edits }  → one proposal becomes one item
//   POST { action: 'skip', id }
//   POST { action: 'import' }                 → the open tasks of the old Projects boards, once
// Comments go through /api/comments with type 'board' (so they land in Messages); photos through
// /api/leadership/photo.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readBoard, addItem, setItem, deleteItem, proposeFromNotes, settleProposal, openProposal, isAssignee, importFromProjects, BoardNotReady, LANES, type Lane } from '@/lib/board'
import { rosterForPicker } from '@/lib/mentions'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const MIGRATION_HINT = 'The board table is not there yet — run supabase/migrations/176_board.sql in the Supabase SQL editor, then reload.'

export async function GET() {
  const gate = await requireLevel('leadership', 'view')
  if (!gate.ok) return gate.res
  const me = gate.access.user.email.toLowerCase()
  try {
    const canEdit = gate.access.role === 'admin' || ['edit', 'full'].includes(String(gate.access.levels['leadership'] || ''))
    const data = await readBoard({ countImportable: canEdit })
    return NextResponse.json({ ok: true, me, ...data, canEdit })
  } catch (e: any) {
    if (e instanceof BoardNotReady) return NextResponse.json({ ok: false, needsMigration: true, error: MIGRATION_HINT }, { status: 503 })
    return NextResponse.json({ ok: false, error: str(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // Anyone who can SEE the board gets this far; what they may do is decided just below.
  const gate = await requireLevel('leadership', 'view')
  if (!gate.ok) return gate.res
  const me = gate.access.user.email.toLowerCase()
  const myName = str(gate.access.profile?.name) || null
  const canEdit = gate.access.role === 'admin' || ['edit', 'full'].includes(String(gate.access.levels['leadership'] || ''))
  const b = await req.json().catch(() => ({} as any))
  const action = str(b.action)
  const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status })
  try {
    // VIEW-ONLY (approved 2026-11-09): a person may mark THEIR OWN row done, or reopen it — nothing
    // else. Only the status is taken from the request; every other field sent along is ignored.
    if (!canEdit) {
      const status = str(b.status)
      if (action !== 'set' || (status !== 'done' && status !== 'open')) return bad('You can view this board, and mark your own tasks done. Ask an admin for edit access to change anything else.', 403)
      if (!(await isAssignee(str(b.id), me))) return bad('Only the people a task is assigned to can mark it done.', 403)
      const r = await setItem(me, myName, str(b.id), { status })
      return 'error' in r ? bad(r.error) : NextResponse.json({ ok: true })
    }
    if (action === 'add') {
      const r = await addItem(me, myName, b)
      return 'error' in r ? bad(r.error) : NextResponse.json({ ok: true, id: r.id })
    }
    if (action === 'set') {
      const r = await setItem(me, myName, str(b.id), b)
      return 'error' in r ? bad(r.error) : NextResponse.json({ ok: true })
    }
    if (action === 'delete') {
      const r = await deleteItem(str(b.id))
      return 'error' in r ? bad(r.error) : NextResponse.json({ ok: true })
    }
    if (action === 'propose') {
      const people = (await rosterForPicker()).map(p => ({ name: p.name, email: p.email }))
      const r = await proposeFromNotes(str(b.text), me, people, str(b.source) || 'notes')
      return r.ok ? NextResponse.json({ ok: true, proposals: r.proposals }) : bad(r.error)
    }
    if (action === 'approve') {
      const id = str(b.id)
      // Read fresh and only while still open: an approved line stays in the list for a week, and a
      // second tap (or a second leader) used to turn it into a second task.
      const cur = await openProposal(id)
      if (!cur) return bad('That one was already approved or skipped.', 409)
      const lane: Lane = (LANES as readonly string[]).includes(str(b.lane)) ? str(b.lane) as Lane : cur.lane
      const r = await addItem(me, myName, {
        lane, title: b.title !== undefined ? b.title : cur.title, details: b.details !== undefined ? b.details : cur.details,
        assignees: Array.isArray(b.assignees) ? b.assignees : (cur.assignee ? [cur.assignee] : []),
        due: b.due !== undefined ? b.due : cur.due, priority: b.priority !== undefined ? b.priority : cur.priority,
        property: b.property !== undefined ? b.property : cur.property, source: 'notes', source_ref: 'proposal:' + id,
      })
      // source_ref is unique on the table, so two approvals racing each other make ONE task: the
      // loser lands here, and the proposal is settled either way.
      if ('error' in r) {
        if (/duplicate key|unique/i.test(r.error)) { await settleProposal(id, 'approved', me); return NextResponse.json({ ok: true, already: true }) }
        return bad(r.error)
      }
      await settleProposal(id, 'approved', me, r.id)
      return NextResponse.json({ ok: true, id: r.id })
    }
    if (action === 'skip') { await settleProposal(str(b.id), 'skipped', me); return NextResponse.json({ ok: true }) }
    if (action === 'import') { const r = await importFromProjects(me); return NextResponse.json({ ok: true, ...r }) }
    return bad('Bad action.')
  } catch (e: any) {
    if (e instanceof BoardNotReady || /board_items/.test(str(e?.message))) return NextResponse.json({ ok: false, needsMigration: true, error: MIGRATION_HINT }, { status: 503 })
    return NextResponse.json({ ok: false, error: str(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
