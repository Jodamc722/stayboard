// THE LEADERSHIP BOARD API (Jon, 2026-11-06). The read is one call; edits to an existing item go
// straight to the project engine (/api/projects/<board>/ taskSet · comment · photo), so the
// notifications, reminders and @tags are the same ones every board has.
//   GET                                   → board, lanes, items, real projects, open AI proposals, people
//   POST { action: 'add', lane, title, details?, assignees?, due?, priority? }
//   POST { action: 'propose', text, source? }   → AI reads the notes, returns proposals (saved)
//   POST { action: 'approve', id, ...edits }    → one proposal becomes one item
//   POST { action: 'skip', id }
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readLeadership, addLeadershipItem, proposeFromNotes, settleProposal, ensureLeadershipBoard, LANES, type Lane } from '@/lib/leadership'
import { rosterForPicker } from '@/lib/mentions'
import { getSetting } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

export async function GET() {
  const gate = await requireLevel('leadership', 'view')
  if (!gate.ok) return gate.res
  const me = gate.access.user.email.toLowerCase()
  try {
    const viewer = { email: me, superadmin: gate.access.role === 'admin' }
    const [data, people] = await Promise.all([readLeadership(viewer, gate.access.profile?.name || null), rosterForPicker()])
    return NextResponse.json({ ok: true, me, ...data, people, canEdit: gate.access.role === 'admin' || ['edit', 'full'].includes(String(gate.access.levels['leadership'] || '')) })
  } catch (e: any) { return NextResponse.json({ ok: false, error: str(e?.message || e).slice(0, 200) }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('leadership', 'edit')
  if (!gate.ok) return gate.res
  const me = gate.access.user.email.toLowerCase()
  const b = await req.json().catch(() => ({} as any))
  const action = str(b.action)
  try {
    const board = await ensureLeadershipBoard(me, gate.access.profile?.name || null)
    if (action === 'add') {
      const r = await addLeadershipItem(board.id, me, { lane: b.lane, title: b.title, details: b.details, assignees: Array.isArray(b.assignees) ? b.assignees.map(String) : [], due: b.due || null, priority: b.priority })
      return 'error' in r ? NextResponse.json({ ok: false, error: r.error }, { status: 400 }) : NextResponse.json({ ok: true, id: r.id })
    }
    if (action === 'propose') {
      const people = (await rosterForPicker()).map(p => ({ name: p.name, email: p.email }))
      const r = await proposeFromNotes(str(b.text), me, people, str(b.source) || 'notes')
      return r.ok ? NextResponse.json({ ok: true, proposals: r.proposals }) : NextResponse.json({ ok: false, error: r.error }, { status: 400 })
    }
    if (action === 'approve') {
      const id = str(b.id)
      const cur = (await getSetting<any[]>('leadership_proposals', [])).find(x => x.id === id)
      if (!cur) return NextResponse.json({ ok: false, error: 'That proposal is gone — reload.' }, { status: 404 })
      const lane: Lane = (LANES as readonly string[]).includes(str(b.lane)) ? str(b.lane) as Lane : cur.lane
      const r = await addLeadershipItem(board.id, me, {
        lane, title: b.title !== undefined ? str(b.title) : cur.title, details: b.details !== undefined ? str(b.details) : cur.details,
        assignees: Array.isArray(b.assignees) ? b.assignees.map(String) : (cur.assignee ? [cur.assignee] : []),
        due: b.due !== undefined ? (b.due || null) : cur.due, priority: b.priority !== undefined ? str(b.priority) : cur.priority,
      })
      if ('error' in r) return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
      await settleProposal(id, 'approved', me, r.id)
      return NextResponse.json({ ok: true, id: r.id })
    }
    if (action === 'skip') { await settleProposal(str(b.id), 'skipped', me); return NextResponse.json({ ok: true }) }
    return NextResponse.json({ ok: false, error: 'Bad action.' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ ok: false, error: str(e?.message || e).slice(0, 200) }, { status: 500 }) }
}
