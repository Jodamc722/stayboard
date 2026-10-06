// THE BULLETIN BOARD on Today (Jon, 2026-10-06) — replaces the week Scoreboard strip. Rules live in
// lib/bulletin.ts. GET → { posts (board), haveTo (reminders), canPost, me, reviews?, people? };
// POST { action, … } → the updated board.
//   Leaders (admins and the owner) post, edit, pin, delete; anyone signed in reacts, replies and
//   ticks a reminder done. Leaders also get the last three weeks of 5★ guest reviews to pin, and the
//   active staff list for Employee of the month / shout-outs.
// Storage: one JSON value in app_settings ('bulletin_board'). Writes read the row fresh (never the
// 60s settings cache) so two people reacting a minute apart don't undo each other.
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireVrUser } from '@/lib/vr-gate'
import { isSuperadmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { setSetting } from '@/lib/app-settings'
import { ratingToStars } from '@/lib/optimize-score'
import {
  type Board, type Post, boardPosts, haveToPosts, etDay, makePost, editPost, toggleReaction, prune, MAX_REPLIES,
} from '@/lib/bulletin'

export const dynamic = 'force-dynamic'
const KEY = 'bulletin_board'

async function readBoard(): Promise<Board> {
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', KEY).limit(1)
    const raw = (data as any)?.[0]?.value
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw
    return { posts: Array.isArray(j?.posts) ? j.posts : [] }
  } catch { return { posts: [] } }
}

const isLeader = (a: any) => isSuperadmin(a.email) || a.role === 'admin'
const nameOf = (a: any) => String(a.profile?.name || (a.email ? String(a.email).split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'Someone'))

function view(board: Board, me: string, canPost: boolean) {
  const today = etDay()
  return { ok: true, today, me, canPost, posts: boardPosts(board.posts, today), haveTo: haveToPosts(board.posts, today) }
}

/** 5★ reviews from the last 21 days with something worth reading — for leaders to pin. */
async function goodReviews(pinned: Set<string>) {
  const db = supabaseAdmin()
  const since = new Date(Date.now() - 21 * 86400000).toISOString()
  const { data } = await db.from('guesty_reviews').select('id,listing_id,rating,content,channel,guest_name,created_at')
    .eq('excluded_from_score', false).is('removed_at', null).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(400)
  const rows = ((data || []) as any[]).filter(r => (ratingToStars(Number(r.rating)) || 0) >= 4.8 && String(r.content || '').trim().length >= 40 && !pinned.has(String(r.id)))
  const ids = Array.from(new Set(rows.map(r => String(r.listing_id)))).slice(0, 200)
  const names: Record<string, string> = {}
  if (ids.length) {
    const { data: ls } = await db.from('guesty_listings').select('id,nickname,title').in('id', ids)
    for (const l of (ls || []) as any[]) names[String(l.id)] = String(l.nickname || l.title || '')
  }
  return rows.slice(0, 30).map(r => ({
    id: String(r.id), unit: names[String(r.listing_id)] || 'Unit', guest: String(r.guest_name || '').split(/\s+/)[0] || 'Guest',
    stars: Math.round((ratingToStars(Number(r.rating)) || 5) * 10) / 10, channel: String(r.channel || ''),
    date: String(r.created_at).slice(0, 10), text: String(r.content || '').trim().slice(0, 1200),
  }))
}

async function people(): Promise<string[]> {
  try {
    const { data } = await supabaseAdmin().from('staff').select('name,active').order('name')
    return ((data || []) as any[]).filter(s => s.active !== false && s.name).map(s => String(s.name))
  } catch { return [] }
}

export async function GET() {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const a = gate.access
  const board = await readBoard()
  const canPost = isLeader(a)
  const out: any = view(board, String(a.email || ''), canPost)
  if (canPost) {
    const pinned = new Set(board.posts.map(p => p.review?.id).filter(Boolean) as string[])
    const [reviews, ppl] = await Promise.all([goodReviews(pinned).catch(() => []), people()])
    out.reviews = reviews; out.people = ppl
  }
  return NextResponse.json(out)
}

export async function POST(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const a = gate.access
  const me = String(a.email || '')
  const leader = isLeader(a)
  const b = await req.json().catch(() => ({} as any))
  const action = String(b?.action || '')
  const board = await readBoard()
  const today = etDay()
  const nowIso = new Date().toISOString()
  const idx = board.posts.findIndex(p => p.id === String(b?.id || ''))
  const post: Post | null = idx >= 0 ? board.posts[idx] : null
  const deny = (m: string, s = 403) => NextResponse.json({ ok: false, error: m }, { status: s })
  const put = (p: Post) => { board.posts[idx] = p }

  if (action === 'create') {
    if (!leader) return deny('Only leaders can post to the board.')
    const p = makePost(b?.post, { name: nameOf(a), email: me }, today, randomUUID(), nowIso)
    if (!p) return deny('Say something first.', 400)
    board.posts.unshift(p)
  } else {
    if (!post) return deny('That post is gone.', 404)
    if (action === 'edit') { if (!leader) return deny('Only leaders can edit posts.'); put(editPost(post, b?.post || {})) }
    else if (action === 'delete') { if (!leader && post.byEmail !== me) return deny('Only leaders can take posts down.'); board.posts.splice(idx, 1) }
    else if (action === 'react') put(toggleReaction(post, String(b?.emoji || ''), me))
    else if (action === 'done') { if (post.kind !== 'reminder') return deny('Not a reminder.', 400); put({ ...post, doneAt: nowIso, doneBy: nameOf(a) }) }
    else if (action === 'undone') put({ ...post, doneAt: null, doneBy: null })
    else if (action === 'reply') {
      const text = String(b?.text || '').trim().slice(0, 500)
      if (!text) return deny('Write something first.', 400)
      put({ ...post, replies: [...(post.replies || []), { id: randomUUID(), by: nameOf(a), text, at: nowIso }].slice(-MAX_REPLIES) })
    } else if (action === 'unreply') {
      const r = (post.replies || []).find(x => x.id === String(b?.replyId || ''))
      if (!r) return deny('That reply is gone.', 404)
      if (!leader && r.by !== nameOf(a)) return deny('Only the writer or a leader can remove a reply.')
      put({ ...post, replies: (post.replies || []).filter(x => x.id !== r.id) })
    } else return deny('Unknown action.', 400)
  }

  board.posts = prune(board.posts, today)
  const saved = await setSetting(KEY, board, me)
  if (!saved.ok) return NextResponse.json({ ok: false, error: 'Could not save: ' + saved.error }, { status: 500 })
  return NextResponse.json(view(board, me, leader))
}
