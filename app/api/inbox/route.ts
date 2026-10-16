// THE INBOX (Jon, 2026-10-16: "we should have an inbox system / process for managing all this.
// Almost like an inbox").
//
// Everything addressed to ME, in one list, each item OPEN until I deal with it:
//   n:<id>  app_notifications   — tags, replies, assignments, Eve's asks (every lib/notify caller)
//   p:<id>  project_notifications — the project boards' own bell (assigned, mentioned, comment, due)
//   h:<id>  handoff alerts       — the ones addressed to me that are still open
// GET  ?tab=open|snoozed|done   → { items, counts }
// POST { action: 'done'|'open'|'snooze'|'readAll', ids: [...], until? }
// A reply is not here: the page posts to /api/comments with the item's entity, exactly as a
// comment box would, so the thread, Breezeway and Guesty rules are the same ones.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/access'
import { readAlerts } from '@/lib/handoff-store'
import { isOpen, isFor, hasFired } from '@/lib/handoff'

export const dynamic = 'force-dynamic'
const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

export type InboxItem = {
  id: string
  source: 'app' | 'project' | 'handoff'
  kind: string
  title: string
  body: string | null
  link: string | null
  actor: string | null
  at: string
  read: boolean
  status: 'open' | 'snoozed' | 'done'
  snoozedUntil: string | null
  /** Reply in place goes to this app_comments thread. */
  entity: { type: string; id: string } | null
  /** The last few lines of that thread, newest last, so a reply can be written without opening it. */
  thread?: { by: string; body: string; at: string }[]
}

const FULL = 'id,kind,title,body,link,actor_email,read,created_at,status,snoozed_until,done_at,entity_type,entity_id'
const LEGACY = 'id,kind,title,body,link,actor_email,read,created_at'

export async function GET(req: NextRequest) {
  const gate = await requireUser()
  if (!gate.ok) return gate.res
  const me = gate.access.user.email.toLowerCase()
  const role = gate.access.role === 'admin' ? 'admin' : (gate.access as any).accessRole || null
  const tab = (new URL(req.url).searchParams.get('tab') || 'open') as 'open' | 'snoozed' | 'done'
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  let degraded = false

  // ── app_notifications ────────────────────────────────────────────────────────────────────────
  let rows: any[] = []
  {
    let r: any = await db.from('app_notifications').select(FULL).eq('user_email', me).order('created_at', { ascending: false }).limit(400)
    if (r.error && /status|snoozed_until|entity_type|schema cache/i.test(r.error.message)) {
      degraded = true
      r = await db.from('app_notifications').select(LEGACY).eq('user_email', me).order('created_at', { ascending: false }).limit(400)
    }
    if (r.error) return NextResponse.json({ ok: false, error: r.error.message }, { status: 500 })
    rows = (r.data as any[]) || []
  }
  const statusOf = (r: any): InboxItem['status'] => {
    if (degraded) return r.read ? 'done' : 'open'
    if (r.status === 'snoozed') return r.snoozed_until && r.snoozed_until <= now ? 'open' : 'snoozed'
    return r.status === 'done' ? 'done' : 'open'
  }
  const items: InboxItem[] = rows.map(r => ({
    id: 'n:' + r.id, source: 'app', kind: str(r.kind), title: str(r.title), body: r.body || null, link: r.link || null, actor: r.actor_email || null,
    at: str(r.created_at), read: !!r.read, status: statusOf(r), snoozedUntil: r.snoozed_until || null,
    entity: r.entity_type && r.entity_id ? { type: str(r.entity_type), id: str(r.entity_id) } : null,
  }))

  // ── project_notifications ────────────────────────────────────────────────────────────────────
  try {
    const { data } = await db.from('project_notifications').select('id,type,title,body,url,actor,created_at,read_at').eq('email', me).order('created_at', { ascending: false }).limit(200)
    for (const r of ((data || []) as any[])) items.push({
      id: 'p:' + r.id, source: 'project', kind: r.type === 'mentioned' ? 'mention' : str(r.type), title: str(r.title), body: r.body || null, link: r.url || null, actor: r.actor || null,
      at: str(r.created_at), read: !!r.read_at, status: r.read_at ? 'done' : 'open', snoozedUntil: null, entity: null,
    })
  } catch { /* no projects tables */ }

  // ── handoff alerts addressed to me, still open ──────────────────────────────────────────────
  try {
    const alerts = await readAlerts()
    for (const a of alerts) {
      if (!isOpen(a) || !hasFired(a) || !isFor(a, { email: me, role })) continue
      if (a.audience.kind === 'everyone' && !(a.recipients || []).some(r => r.email === me)) continue   // the floater carries broadcast alerts
      const acked = !!(a.acks || {})[me]
      items.push({
        id: 'h:' + a.id, source: 'handoff', kind: 'alert', title: (a.by ? a.by + ' · ' : '') + a.title, body: a.body || null, link: '/command?alert=' + encodeURIComponent(a.id), actor: a.byEmail || null,
        at: a.firedAt || a.at, read: !!(a.read || {})[me], status: acked ? 'done' : 'open', snoozedUntil: null, entity: null,
      })
    }
  } catch { /* fine */ }

  // ── the thread tail for anything replyable, so the inbox can answer in place ────────────────
  const want = items.filter(i => i.entity && i.status !== 'done').slice(0, 40)
  if (want.length) {
    try {
      const keys = Array.from(new Set(want.map(i => i.entity!.type + '|' + i.entity!.id)))
      const types = Array.from(new Set(want.map(i => i.entity!.type)))
      const { data } = await db.from('app_comments').select('entity_type,entity_id,author_email,body,created_at').in('entity_type', types).in('entity_id', Array.from(new Set(want.map(i => i.entity!.id)))).order('created_at', { ascending: false }).limit(400)
      const by: Record<string, { by: string; body: string; at: string }[]> = {}
      for (const c of ((data || []) as any[])) {
        const k = str(c.entity_type) + '|' + str(c.entity_id)
        if (!keys.includes(k)) continue
        ;(by[k] = by[k] || []).push({ by: str(c.author_email).split('@')[0], body: str(c.body), at: str(c.created_at) })
      }
      for (const i of want) i.thread = (by[i.entity!.type + '|' + i.entity!.id] || []).slice(0, 4).reverse()
    } catch { /* no thread */ }
  }

  items.sort((a, b) => b.at.localeCompare(a.at))
  const counts = { open: 0, unread: 0, snoozed: 0, done: 0 }
  for (const i of items) { counts[i.status]++; if (i.status === 'open' && !i.read) counts.unread++ }
  const shown = items.filter(i => i.status === tab).slice(0, tab === 'done' ? 100 : 200)
  return NextResponse.json({ ok: true, me, tab, items: shown, counts, degraded })
}

export async function POST(req: NextRequest) {
  const gate = await requireUser()
  if (!gate.ok) return gate.res
  const me = gate.access.user.email.toLowerCase()
  const b = await req.json().catch(() => ({} as any))
  const action = str(b.action)
  const ids: string[] = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 100) : []
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const n = ids.filter(i => i.startsWith('n:')).map(i => i.slice(2))
  const p = ids.filter(i => i.startsWith('p:')).map(i => i.slice(2))
  const h = ids.filter(i => i.startsWith('h:')).map(i => i.slice(2))
  const soft = async (q: PromiseLike<{ error: any }>) => { const { error } = await q; if (error && !/status|snoozed_until|done_at|schema cache/i.test(error.message)) throw new Error(error.message) ; return !error }

  try {
    if (action === 'readAll') {
      await soft(db.from('app_notifications').update({ read: true }).eq('user_email', me).eq('read', false))
      await db.from('project_notifications').update({ read_at: now }).eq('email', me).is('read_at', null)
      return NextResponse.json({ ok: true })
    }
    if (!ids.length) return NextResponse.json({ ok: false, error: 'ids required' }, { status: 400 })
    if (action === 'read') {
      if (n.length) await soft(db.from('app_notifications').update({ read: true }).eq('user_email', me).in('id', n))
      if (p.length) await db.from('project_notifications').update({ read_at: now }).eq('email', me).in('id', p).is('read_at', null)
      return NextResponse.json({ ok: true })
    }
    if (action === 'done') {
      if (n.length) {
        const full = await soft(db.from('app_notifications').update({ read: true, status: 'done', done_at: now, snoozed_until: null }).eq('user_email', me).in('id', n))
        if (!full) await db.from('app_notifications').update({ read: true }).eq('user_email', me).in('id', n)
      }
      if (p.length) await db.from('project_notifications').update({ read_at: now }).eq('email', me).in('id', p).is('read_at', null)
      if (h.length) {
        // "Got it" on the alert, the same as the floater's button.
        const { readAlerts: read, writeAlerts } = await import('@/lib/handoff-store')
        const { mark } = await import('@/lib/handoff')
        const name = str(gate.access.profile?.name) || me.split('@')[0]
        const all = await read()
        const next = all.map(a => h.includes(a.id) ? { ...mark(a, me, name, 'ack', now), acks: { ...(a.acks || {}), [me]: now }, ackNames: { ...(a.ackNames || {}), [me]: name } } : a)
        await writeAlerts(next)
      }
      return NextResponse.json({ ok: true })
    }
    if (action === 'open') {
      if (n.length) await soft(db.from('app_notifications').update({ status: 'open', done_at: null, snoozed_until: null }).eq('user_email', me).in('id', n))
      if (p.length) await db.from('project_notifications').update({ read_at: null }).eq('email', me).in('id', p)
      return NextResponse.json({ ok: true })
    }
    if (action === 'snooze') {
      const until = str(b.until) && !isNaN(Date.parse(b.until)) ? new Date(b.until).toISOString() : new Date(Date.now() + 3600_000).toISOString()
      if (n.length) {
        const full = await soft(db.from('app_notifications').update({ read: true, status: 'snoozed', snoozed_until: until }).eq('user_email', me).in('id', n))
        if (!full) return NextResponse.json({ ok: false, error: 'Snooze needs migration 155 — run it in Supabase.' }, { status: 409 })
      }
      return NextResponse.json({ ok: true, until })
    }
    return NextResponse.json({ ok: false, error: 'Bad action.' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ ok: false, error: str(e?.message || e).slice(0, 200) }, { status: 500 }) }
}
