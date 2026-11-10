// SAVED REPLIES FOR THE GUEST INBOX (lib/saved-replies).
//   GET    /api/messages/saved                      the built-in set, then the team's own
//   POST   /api/messages/saved { title, body }      add one (edit on Messages)
//   DELETE /api/messages/saved?id=<id>              remove one of the team's own (edit on Messages)
// Stored in app_settings `inbox_saved_replies`. Nothing here sends anything.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { getSettingFresh, setSetting } from '@/lib/app-settings'
import { BUILT_IN_REPLIES, type SavedReply } from '@/lib/saved-replies'

export const dynamic = 'force-dynamic'

const KEY = 'inbox_saved_replies'
const MAX = 60
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

async function own(): Promise<SavedReply[]> {
  const v = await getSettingFresh<{ items?: SavedReply[] }>(KEY, {}).catch(() => ({} as { items?: SavedReply[] }))
  return Array.isArray(v?.items) ? v.items.filter(x => x && x.id && x.title && x.body) : []
}

export async function GET() {
  const gate = await requireLevel('messages', 'view')
  if (!gate.ok) return gate.res
  return NextResponse.json({ ok: true, replies: BUILT_IN_REPLIES.concat(await own()) })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('messages', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({} as any))
  const title = str(b?.title).trim().slice(0, 60)
  const body = str(b?.body).trim().slice(0, 2000)
  if (!title || !body) return NextResponse.json({ ok: false, error: 'A saved reply needs a name and some text.' }, { status: 400 })
  const items = await own()
  if (items.length >= MAX) return NextResponse.json({ ok: false, error: `There are already ${MAX} saved replies — remove one first.` }, { status: 400 })
  const by = str(gate.access.email) || null
  const item: SavedReply = { id: 'c:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title, body, by }
  const w = await setSetting(KEY, { items: items.concat([item]) }, by)
  if (!w.ok) return NextResponse.json({ ok: false, error: w.error || 'Could not save that.' }, { status: 500 })
  return NextResponse.json({ ok: true, replies: BUILT_IN_REPLIES.concat(items, [item]) })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireLevel('messages', 'edit')
  if (!gate.ok) return gate.res
  const id = str(req.nextUrl.searchParams.get('id'))
  if (!id || id.indexOf('c:') !== 0) return NextResponse.json({ ok: false, error: 'Only the team’s own saved replies can be removed.' }, { status: 400 })
  const items = (await own()).filter(x => x.id !== id)
  const w = await setSetting(KEY, { items }, str(gate.access.email) || null)
  if (!w.ok) return NextResponse.json({ ok: false, error: w.error || 'Could not remove that.' }, { status: 500 })
  return NextResponse.json({ ok: true, replies: BUILT_IN_REPLIES.concat(items) })
}
