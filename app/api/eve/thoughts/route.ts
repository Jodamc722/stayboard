// WHAT SHE IS THINKING (2026-09-21) — the feed behind Settings → Eve → Thinking and the Command
// Center's "Eve is thinking about N things" line. See lib/eve/thoughts.ts.
//
//   GET  ?since=<iso> ?source=watch|watch:<key>|chat|review|ask ?unseen=1 ?status=all ?limit=N
//        → { thoughts, unseen, allObserving, enabled }   (admins)
//   GET  ?count=1  → { unseen, allObserving }             (admins; the badges)
//   POST { op: 'do' | 'dismiss' | 'seen' | 'ask_next_time', id?, ids?, reason? }
//        do            runs the prepared action once, as this person's yes (welded actions included)
//        dismiss       closes it; `reason` becomes a weight-8 memory from Jon
//        seen          marks ids seen, or everything when no ids are given
//        ask_next_time raises that watch's rung override to 2
import { NextRequest, NextResponse } from 'next/server'
import { requireVrAdmin } from '@/lib/vr-gate'
import { listThoughts, readSeen, isUnseen, markSeen, doThought, dismissThought, askNextTime, allObserving, unseenCount } from '@/lib/eve/thoughts'
import { getAgentSettings } from '@/lib/eve/agent-mode'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

export async function GET(req: NextRequest) {
  const gate = await requireVrAdmin('admin')
  if (!gate.ok) return gate.res
  const email = str(gate.access.email).toLowerCase()
  const sp = new URL(req.url).searchParams
  // Started now, awaited with the reads below: the settings used to be read alone, first.
  const settingsP = getAgentSettings()
  if (sp.get('count')) {
    const [settings, unseen] = await Promise.all([settingsP, unseenCount(email)])
    return NextResponse.json({ ok: true, unseen, allObserving: allObserving(settings), enabled: settings.enabled })
  }
  const since = str(sp.get('since')).trim()
  const source = str(sp.get('source')).trim()
  const status = sp.get('status') === 'all' ? 'all' : 'open'
  const limit = Math.min(500, Number(sp.get('limit')) || 200)
  const sinceIso = since && Number.isFinite(Date.parse(since)) ? new Date(since).toISOString() : undefined
  // ONE PASS (2026-11-09 audit): the page was read, then unseenCount read the open thoughts and the
  // seen marks a second time. The unseen number is counted over the same open list unseenCount uses
  // (the newest 300) — and when the page asked for IS that list, it is cut from it, not read again.
  const plainOpen = status === 'open' && !sinceIso && !source
  const [settings, openAll, seen, filtered] = await Promise.all([
    settingsP,
    listThoughts({ status: 'open', limit: Math.max(300, plainOpen ? limit : 0) }),
    readSeen(email),
    plainOpen ? Promise.resolve(null) : listThoughts({ since: sinceIso, source: source || undefined, status, limit }),
  ])
  const rows = filtered || openAll.slice(0, limit)
  const unseen = openAll.slice(0, 300).filter(t => isUnseen(t, seen)).length
  let thoughts = rows.map(t => ({ ...t, unseen: t.status === 'open' && isUnseen(t, seen) }))
  if (sp.get('unseen')) thoughts = thoughts.filter(t => t.unseen)
  return NextResponse.json({ ok: true, thoughts, unseen, allObserving: allObserving(settings), enabled: settings.enabled, rungs: settings.rungs })
}

export async function POST(req: NextRequest) {
  const gate = await requireVrAdmin('admin')
  if (!gate.ok) return gate.res
  const by = str(gate.access.email).toLowerCase() || 'admin'
  const body = await req.json().catch(() => ({} as any))
  const op = str(body?.op)
  const id = str(body?.id).trim()
  if (op === 'seen') {
    const ids = Array.isArray(body?.ids) ? body.ids.map(str).filter(Boolean) : (id ? [id] : [])
    const r = await markSeen(by, ids)
    return NextResponse.json({ ok: r.ok, unseen: await unseenCount(by) })
  }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (op === 'do') {
    const r = await doThought(id, by)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  if (op === 'dismiss') {
    const r = await dismissThought(id, by, body?.reason ? str(body.reason) : undefined)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  if (op === 'ask_next_time') {
    const r = await askNextTime(id, by)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  return NextResponse.json({ error: 'op must be do, dismiss, seen or ask_next_time' }, { status: 400 })
}
