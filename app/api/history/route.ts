// OUR STORY — the year in numbers and the living timeline (Jon, 2026-11-26). Feature key `history`.
//   GET ?year=2026[&refresh=1]     the year-to-date snapshot (lib/history, cached three hours) + the timeline
//   POST { action }  (edit)
//     event.save { date, title, note, kind, id? } · event.remove { id } (moves to Taken off, never deletes)
//     event.restore { id? } (one entry, or all) · photo.sign { id, filename } · photo.done { id, path } · photo.remove { id, path }
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { yearStats } from '@/lib/history'
import { timeline, saveEvent, removeEvent, restoreEvent, signPhotoUpload, attachPhoto, detachPhoto } from '@/lib/history-timeline'

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
    return NextResponse.json({ ...stats, timeline: tl.events, takenOff: tl.takenOff, canEdit: edit.ok })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('history', 'edit')
  if (!gate.ok) return gate.res
  const by = String((gate as any).access?.profile?.name || (gate as any).access?.email || 'someone')
  const body = await req.json().catch(() => ({} as any))
  const id = String(body?.id || '')
  let r: any
  switch (String(body?.action || '')) {
    case 'event.save': r = await saveEvent(body, by); break
    case 'event.remove': r = await removeEvent(id, by); break
    case 'event.restore': r = await restoreEvent(id || null, by); break
    case 'photo.sign': r = await signPhotoUpload(id, String(body.filename || '')); break
    case 'photo.done': r = await attachPhoto(id, String(body.path || ''), by); break
    case 'photo.remove': r = await detachPhoto(id, String(body.path || ''), by); break
    default: r = { ok: false, error: 'Unknown action.' }
  }
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
