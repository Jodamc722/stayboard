// VACANT UNITS — the Today in Ops tab (Jon, 2026-09-22: "Maybe have a vacant unit tab, where our team
// can assign tasks / make suggestions if applicable").
//
// POST { vacants: [{ listingId, unit, market, nextArrival, leftToday, openTasks }], today }
//   → the same list, each with lib/vacant-work's ranked "best use of this window" (the engine the
//     daily briefs already print), plus the team's own suggestions on that unit.
// The board already knows which units are empty (it is in /api/ops-today), so the client hands the
// list over rather than this route rebuilding the whole day.
//
// PUT { listingId, text } adds a team suggestion; PUT { listingId, removeAt } clears one.
// Team suggestions live in app_settings 'vacant_suggestions' — a note, not a task. Turning one into
// work is the Add task button, which goes through the normal sheet and Breezeway.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { vacantWork, type VacantUnit } from '@/lib/vacant-work'
import { getSetting, setSetting } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const KEY = 'vacant_suggestions'
type TeamNote = { text: string; by: string; at: string }
type Notes = Record<string, TeamNote[]>

function daysBetween(a: string, b: string): number {
  const x = Date.parse(a + 'T12:00:00Z'), y = Date.parse(b + 'T12:00:00Z')
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 86400000) : 0
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('plan', 'view')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const today = typeof body?.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : new Date().toISOString().slice(0, 10)
  const list: any[] = Array.isArray(body?.vacants) ? body.vacants.slice(0, 400) : []
  const input: VacantUnit[] = list.filter(v => v && v.listingId).map(v => ({
    listingId: String(v.listingId), unit: String(v.unit || ''), market: v.market || null,
    nextArrival: v.nextArrival || null,
    daysUntilArrival: v.nextArrival ? Math.max(0, daysBetween(today, String(v.nextArrival).slice(0, 10))) : null,
  }))
  let work: any[] = []
  let engineError: string | null = null
  try { work = await vacantWork(input, today) } catch (e: any) { engineError = String(e?.message || e).slice(0, 160) }
  const notes = await getSetting<Notes>(KEY, {})
  const byId: Record<string, any> = {}
  for (const w of work) byId[String(w.listingId)] = w
  const units = input.map(v => {
    const w = byId[v.listingId]
    return {
      listingId: v.listingId,
      windowDays: w ? w.windowDays : (v.daysUntilArrival ?? 999),
      suggestions: w ? w.suggestions : [],
      notes: (notes[v.listingId] || []).slice(-10),
    }
  })
  return NextResponse.json({ ok: true, units, engineError })
}

export async function PUT(req: NextRequest) {
  const gate = await requireLevel('plan', 'edit')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const listingId = String(body?.listingId || '')
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
  const notes = await getSetting<Notes>(KEY, {})
  const cur = (notes[listingId] || []).slice()
  if (typeof body?.removeAt === 'string') {
    notes[listingId] = cur.filter(n => n.at !== body.removeAt)
  } else {
    const text = String(body?.text || '').trim().slice(0, 400)
    if (!text) return NextResponse.json({ error: 'Type a suggestion first.' }, { status: 400 })
    const email = String(gate.access.email || '')
    const by = (email.split('@')[0] || email || 'team').replace(/^./, c => c.toUpperCase())
    cur.push({ text, by, at: new Date().toISOString() })
    notes[listingId] = cur.slice(-20)
  }
  if (!notes[listingId].length) delete notes[listingId]
  const r = await setSetting(KEY, notes, String(gate.access.email || ''))
  if (!r.ok) return NextResponse.json({ error: r.error || 'Could not save.' }, { status: 500 })
  return NextResponse.json({ ok: true, notes: notes[listingId] || [] })
}
