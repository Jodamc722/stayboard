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
import { requireAdmin } from '@/lib/access'
import { listThoughts, readSeen, isUnseen, markSeen, doThought, dismissThought, askNextTime, allObserving, unseenCount } from '@/lib/eve/thoughts'
import { getAgentSettings } from '@/lib/eve/agent-mode'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

export async function GET(req: NextRequest) {
  const gate = await requireAdmin('admin')
  if (!gate.ok) return gate.res
  const email = str(gate.access.email).toLowerCase()
  const sp = new URL(req.url).searchParams
  const settings = await getAgentSettings()
  const observing = allObserving(settings)
  if (sp.get('count')) {
    return NextResponse.json({ ok: true, unseen: await unseenCount(email), allObserving: observing, enabled: settings.enabled })
  }
  const since = str(sp.get('since')).trim()
  const source = str(sp.get('source')).trim()
  const status = sp.get('status') === 'all' ? 'all' : 'open'
  const limit = Math.min(500, Number(sp.get('limit')) || 200)
  const [rows, seen] = await Promise.all([
    listThoughts({ since: since && Number.isFinite(Date.parse(since)) ? new Date(since).toISOString() : undefined, source: source || undefined, status, limit }),
    readSeen(email),
  ])
  let thoughts = rows.map(t => ({ ...t, unseen: t.status === 'open' && isUnseen(t, seen) }))
  if (sp.get('unseen')) thoughts = thoughts.filter(t => t.unseen)
  return NextResponse.json({ ok: true, thoughts, unseen: await unseenCount(email), allObserving: observing, enabled: settings.enabled, rungs: settings.rungs })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin('admin')
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
