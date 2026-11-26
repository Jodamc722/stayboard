// OUR STORY — the year in numbers and the living timeline (Jon, 2026-11-26). Feature key `history`.
//   GET ?year=2026[&refresh=1]     the year-to-date snapshot (lib/history, cached three hours) + the timeline
//   POST { action }  (edit)        event.save { date, title, note, kind, id? } · event.remove { id } · event.restore
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { yearStats } from '@/lib/history'
import { timeline, saveEvent, removeEvent, restoreHidden } from '@/lib/history-timeline'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const gate = await requireLevel('history', 'view')
  if (!gate.ok) return gate.res
  const sp = new URL(req.url).searchParams
  const now = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric' }).format(new Date()))
  const year = Math.min(now, Math.max(2024, Number(sp.get('year')) || now))
  try {
    const [stats, tl, edit] = await Promise.all([yearStats(year, sp.get('refresh') === '1'), timeline(), requireLevel('history', 'edit')])
    return NextResponse.json({ ...stats, timeline: tl.events, hiddenEvents: tl.hidden, canEdit: edit.ok })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('history', 'edit')
  if (!gate.ok) return gate.res
  const by = String((gate as any).access?.profile?.name || (gate as any).access?.email || 'someone')
  const body = await req.json().catch(() => ({} as any))
  const r = body?.action === 'event.save' ? await saveEvent(body, by)
    : body?.action === 'event.remove' ? await removeEvent(String(body.id || ''), by)
    : body?.action === 'event.restore' ? await restoreHidden(by)
    : { ok: false, error: 'Unknown action.' }
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
