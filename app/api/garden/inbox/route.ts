// THE GARDEN HOTEL'S UNIFIED INBOX (lib/garden/inbox). Threads, calls, voicemails, reviews and desk
// calls in one stream, each linked to its Cloudbeds reservation when one matches.
//   GET  [?source=&channel=&status=&q=&needs_reply=1&sort=newest|oldest_unanswered|arrival]
//        → { items, counts, channels, staff, ingest? }            (messages view)
//   GET  ?item=<t:|c:|r:|d:id>  → { detail }                        (messages view)
//   POST { op: 'read', item, unread? } | { op: 'status', item, status } | { op: 'assign', item, assigned_to }
//        { op: 'reply', item, body }   — logs an outbound message on a thread; sends nothing
//        { op: 'note', item, body }    — an internal note on any item
//        { op: 'rotate_token' }        — a new ingest token (the old one stops working)   (messages edit)
import { NextRequest, NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { gAtLeast } from '@/lib/garden/pages'
import { applyInboxOp, filterItems, inboxStaff, inboxToken, loadInboxDetail, loadInboxItems, rotateInboxToken, SOURCE_GROUPS, type InboxItem } from '@/lib/garden/inbox'
import { cloudbedsConfigured } from '@/lib/garden/cloudbeds'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function originOf(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  return host ? `${proto}://${host}` : req.nextUrl.origin
}

function countBy(items: InboxItem[]) {
  const source: Record<string, number> = { all: items.length }
  for (const [g, list] of Object.entries(SOURCE_GROUPS)) source[g] = items.filter(i => list.includes(i.source)).length
  const channel: Record<string, number> = {}
  for (const i of items) channel[i.channel] = (channel[i.channel] || 0) + 1
  const status: Record<string, number> = { all: items.length, open: 0, waiting: 0, closed: 0 }
  for (const i of items) status[i.status] = (status[i.status] || 0) + 1
  return { source, channel, status, needsReply: items.filter(i => i.needs_reply).length, unread: items.filter(i => i.unread > 0).length }
}

export async function GET(req: NextRequest) {
  const gate = await requireGarden('messages', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const canEdit = gAtLeast(gate.access.garden?.levels?.messages, 'edit')
  try {
    const itemId = sp.get('item')
    if (itemId) {
      const detail = await loadInboxDetail(itemId)
      if (!detail) return NextResponse.json({ ok: false, error: 'That conversation was not found.' }, { status: 404 })
      return NextResponse.json({ ok: true, detail })
    }
    const [{ items, missing, live }, staff] = await Promise.all([loadInboxItems(), inboxStaff()])
    const filtered = filterItems(items, { source: sp.get('source'), channel: sp.get('channel'), status: sp.get('status'), q: sp.get('q'), needsReply: sp.get('needs_reply') === '1', sort: sp.get('sort') })
    const channels = Array.from(new Set(items.map(i => i.channel))).sort((a, b) => (a === 'Unmatched' ? 1 : b === 'Unmatched' ? -1 : a.localeCompare(b)))
    // Editors get the ingest address (the token is created the first time an editor opens the page).
    const token = canEdit ? await inboxToken(gate.access.email || null) : null
    const ingest = canEdit && token ? { url: `${originOf(req)}/api/garden/inbox/ingest`, header: 'X-Garden-Token', token } : null
    return NextResponse.json({
      ok: true, items: filtered, total: items.length, counts: countBy(items), channels, staff, ingest, missing, live,
      connected: cloudbedsConfigured(), me: gate.access.email || null, canEdit,
      canReview: gAtLeast(gate.access.garden?.levels?.reviews, 'edit'),
    })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireGarden('messages', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const by = gate.access.email || null
  if (b?.op === 'rotate_token') {
    const token = await rotateInboxToken(by)
    return token ? NextResponse.json({ ok: true, token }) : NextResponse.json({ ok: false, error: 'Could not save the new token.' }, { status: 500 })
  }
  if (!['read', 'status', 'assign', 'reply', 'note'].includes(String(b?.op || ''))) return NextResponse.json({ ok: false, error: 'unknown op' }, { status: 400 })
  if (!b?.item) return NextResponse.json({ ok: false, error: 'item required' }, { status: 400 })
  try {
    const r = await applyInboxOp(b, by)
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status || 400 })
    return NextResponse.json({ ok: true, item: r.item || null })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 }) }
}
