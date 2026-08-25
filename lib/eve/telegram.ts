// The bridge between a Telegram chat and Eve: who is talking, are they allowed, and what did we
// say to each other five minutes ago.
//
// lib/telegram.ts knows the Telegram API. lib/eve/run.ts is the brain. This file is the part that
// decides whether the brain answers at all — and it is deliberately the most suspicious code in the
// feature, because it is the only place in Lighthouse where a stranger can start a conversation.
//
// THE RULES, IN ORDER:
//   1. A Telegram user id is a stranger until a human in Lighthouse says otherwise.
//   2. Approving a stranger means BINDING them to a Lighthouse user. Permissions — pages, money,
//      everything — come from that user's role, not from anything Telegram told us. Change their
//      role at /users and their Eve changes with it; deactivate them and Eve stops answering.
//   3. In a group, the ROOM is approved separately from the PEOPLE, and both must pass. The room
//      keeps the bot out of chats nobody vetted; the person keeps the answer honest, because the
//      permissions that apply are those of whoever typed — not of the room, and not of the owner.
//   4. Nothing that arrives over Telegram can change any of the above. Approval is a click in the
//      app by someone who is signed in. Slack and Telegram get told; they never get to decide.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { accessForEmail } from '@/lib/access'
import type { Access } from '@/lib/access'
import { canUseEve } from './run'
import { displayName, type TgUser, type TgChat } from '@/lib/telegram'

export type ContactStatus = 'pending' | 'approved' | 'blocked'

export type TelegramContact = {
  id: string
  tg_user_id: string
  username: string | null
  first_name: string | null
  last_name: string | null
  status: ContactStatus
  email: string | null
  dm_chat_id: string | null
  first_message: string | null
  note: string | null
  approved_by: string | null
  approved_at: string | null
  msg_count: number
  last_seen_at: string | null
  created_at: string
}

export type TelegramRoom = {
  id: string
  chat_id: string
  title: string | null
  kind: string
  status: ContactStatus
  added_by: string | null
  added_by_name: string | null
  approved_by: string | null
  approved_at: string | null
  msg_count: number
  last_seen_at: string | null
  created_at: string
}

const db = () => supabaseAdmin()
const nowISO = () => new Date().toISOString()

// ---- Replay guard --------------------------------------------------------------------------------

/**
 * Claim an update. Telegram redelivers anything the webhook does not acknowledge fast enough, and a
 * real Eve answer takes 15-40 seconds — so redelivery is NORMAL, not an edge case. The primary key
 * on telegram_updates is the lock: exactly one caller gets `true`.
 */
export async function claimUpdate(updateId: number, chatId?: string | number | null): Promise<boolean> {
  try {
    const { error } = await db().from('telegram_updates').insert({ update_id: updateId, chat_id: chatId != null ? String(chatId) : null })
    if (error) return false
    return true
  } catch { return false }
}

/** Housekeeping: the guard only needs a day of history. Cheap, and keeps the table from growing forever. */
export async function pruneUpdates(): Promise<void> {
  try {
    await db().from('telegram_updates').delete().lt('received_at', new Date(Date.now() - 36 * 3600_000).toISOString())
  } catch { /* never worth failing a message over */ }
}

// ---- People --------------------------------------------------------------------------------------

/**
 * Find this Telegram user, creating a PENDING row the first time we see them. The row is the
 * request: it is what shows up in Lighthouse waiting to be approved. Creating it grants nothing.
 */
export async function seeContact(from: TgUser, opts: { dmChatId?: string | number | null; text?: string } = {}): Promise<TelegramContact | null> {
  const tgId = String(from?.id || '')
  if (!tgId) return null
  const patch: any = {
    tg_user_id: tgId,
    username: from.username || null,
    first_name: from.first_name || null,
    last_name: from.last_name || null,
    last_seen_at: nowISO(),
    updated_at: nowISO(),
  }
  if (opts.dmChatId != null) patch.dm_chat_id = String(opts.dmChatId)
  try {
    const { data: existing } = await db().from('telegram_contacts').select('*').eq('tg_user_id', tgId).maybeSingle()
    if (existing) {
      // Never write status/email here — only an approval in the app moves those.
      const { data } = await db().from('telegram_contacts')
        .update({ ...patch, msg_count: ((existing as any).msg_count || 0) + 1 })
        .eq('tg_user_id', tgId).select('*').maybeSingle()
      return (data || existing) as any as TelegramContact
    }
    const { data } = await db().from('telegram_contacts').insert({
      ...patch, status: 'pending', msg_count: 1,
      first_message: String(opts.text || '').slice(0, 500) || null,
    }).select('*').maybeSingle()
    return (data as any) || null
  } catch { return null }
}

export async function listContacts(status?: ContactStatus): Promise<TelegramContact[]> {
  try {
    let q = db().from('telegram_contacts').select('*').order('updated_at', { ascending: false }).limit(200)
    if (status) q = q.eq('status', status)
    const { data } = await q
    return (data as any) || []
  } catch { return [] }
}

/**
 * Approve a contact AND bind them to a Lighthouse user. The email is not optional and is not a
 * label: it is the whole permission story. We verify it resolves to an active user who is allowed
 * to use Eve before we say yes, so a typo fails here rather than silently in a chat later.
 */
export async function approveContact(tgUserId: string, email: string, by: string): Promise<{ ok: boolean; error?: string }> {
  const e = String(email || '').toLowerCase().trim()
  if (!e) return { ok: false, error: 'Pick which Lighthouse user this contact acts as.' }
  const access = await accessForEmail(e)
  if (!access) return { ok: false, error: `${e} is not an active Lighthouse user.` }
  if (!canUseEve(access)) return { ok: false, error: `${e} is not allowed to use Eve. Switch Eve on for their role at /users → Roles first.` }
  try {
    const { error } = await db().from('telegram_contacts').update({
      status: 'approved', email: e, approved_by: by, approved_at: nowISO(),
      blocked_by: null, blocked_at: null, updated_at: nowISO(),
    }).eq('tg_user_id', String(tgUserId))
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (er: any) { return { ok: false, error: String(er?.message || er) } }
}

export async function blockContact(tgUserId: string, by: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await db().from('telegram_contacts').update({
      status: 'blocked', blocked_by: by, blocked_at: nowISO(), updated_at: nowISO(),
    }).eq('tg_user_id', String(tgUserId))
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}

// ---- Rooms ---------------------------------------------------------------------------------------

export async function seeRoom(chat: TgChat, addedBy?: TgUser | null): Promise<TelegramRoom | null> {
  const chatId = String(chat?.id || '')
  if (!chatId) return null
  const patch: any = {
    chat_id: chatId, title: chat.title || null, kind: chat.type || 'group',
    last_seen_at: nowISO(), updated_at: nowISO(),
  }
  try {
    const { data: existing } = await db().from('telegram_rooms').select('*').eq('chat_id', chatId).maybeSingle()
    if (existing) {
      const { data } = await db().from('telegram_rooms')
        .update({ ...patch, msg_count: ((existing as any).msg_count || 0) + 1 })
        .eq('chat_id', chatId).select('*').maybeSingle()
      return (data || existing) as any
    }
    const { data } = await db().from('telegram_rooms').insert({
      ...patch, status: 'pending', msg_count: 1,
      added_by: addedBy ? String(addedBy.id) : null,
      added_by_name: addedBy ? displayName(addedBy) : null,
    }).select('*').maybeSingle()
    return (data as any) || null
  } catch { return null }
}

export async function listRooms(): Promise<TelegramRoom[]> {
  try {
    const { data } = await db().from('telegram_rooms').select('*').order('updated_at', { ascending: false }).limit(200)
    return (data as any) || []
  } catch { return [] }
}

export async function setRoomStatus(chatId: string, status: ContactStatus, by: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const patch: any = { status, updated_at: nowISO() }
    if (status === 'approved') { patch.approved_by = by; patch.approved_at = nowISO() }
    const { error } = await db().from('telegram_rooms').update(patch).eq('chat_id', String(chatId))
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}

// ---- The decision --------------------------------------------------------------------------------

export type Verdict =
  | { allow: true; contact: TelegramContact; access: Access; room: TelegramRoom | null }
  | { allow: false; reason: 'pending' | 'blocked' | 'room_pending' | 'room_blocked' | 'unlinked' | 'no_eve' | 'unknown'; contact: TelegramContact | null; room: TelegramRoom | null; message: string }

const PENDING_MSG = `I don't know you yet, so I can't answer anything.

I've put you in Lighthouse as a pending contact — an admin approves you there and picks which Lighthouse user you speak as. Once that's done, ask me again.`

const BLOCKED_MSG = `I'm not able to talk to you.`

const ROOM_PENDING_MSG = `I'm not switched on for this group yet.

Someone with Lighthouse access has to approve the room under Users & admin → Settings → Eve → Telegram. Until then I'll stay quiet in here.`

/**
 * The gate. Everything above assembles the facts; this decides. Note what is NOT consulted: the
 * person's Telegram name, whether they claim to be someone, or which room they are standing in.
 */
export async function decide(from: TgUser, chat: TgChat, text: string): Promise<Verdict> {
  const isGroup = chat.type === 'group' || chat.type === 'supergroup'
  const room = isGroup ? await seeRoom(chat) : null

  // The ROOM is judged before anyone in it is even written down. An unvetted group must not be able
  // to fill the approval queue with names — that would turn the one screen a human has to read into
  // something worth ignoring.
  if (isGroup) {
    if (!room) return { allow: false, reason: 'unknown', contact: null, room: null, message: 'Something went wrong reading this group.' }
    if (room.status === 'blocked') return { allow: false, reason: 'room_blocked', contact: null, room, message: BLOCKED_MSG }
    if (room.status !== 'approved') return { allow: false, reason: 'room_pending', contact: null, room, message: ROOM_PENDING_MSG }
  }

  const contact = await seeContact(from, { dmChatId: isGroup ? null : chat.id, text })

  if (!contact) return { allow: false, reason: 'unknown', contact: null, room, message: 'Something went wrong reading your account.' }
  if (contact.status === 'blocked') return { allow: false, reason: 'blocked', contact, room, message: BLOCKED_MSG }
  if (contact.status !== 'approved') return { allow: false, reason: 'pending', contact, room, message: PENDING_MSG }
  if (!contact.email) return { allow: false, reason: 'unlinked', contact, room, message: 'You are approved but not linked to a Lighthouse user yet, so I have no idea what you are allowed to see. An admin can finish that at Users & admin → Settings → Eve → Telegram.' }

  const access = await accessForEmail(contact.email)
  if (!access) {
    return { allow: false, reason: 'unlinked', contact, room, message: `Your Lighthouse account (${contact.email}) is not active any more, so I can't answer.` }
  }
  if (!canUseEve(access)) {
    return { allow: false, reason: 'no_eve', contact, room, message: 'Your Lighthouse role does not have Eve switched on. Ask Jon.' }
  }
  return { allow: true, contact, access, room }
}

// ---- The thread ----------------------------------------------------------------------------------

// A chat app has no "new conversation" button, so a thread that never ends would drag this morning's
// context into tonight's question — and pay for it on every turn. Thirty minutes of silence starts
// a fresh one, /new starts one on demand, and only the last few turns are ever replayed.
const THREAD_IDLE_MS = 30 * 60_000
const THREAD_TURNS = 8

export async function recordMessage(chatId: string | number, tgUserId: string | null, role: 'user' | 'assistant', text: string, eveChatId?: string | null): Promise<void> {
  try {
    await db().from('telegram_messages').insert({
      chat_id: String(chatId), tg_user_id: tgUserId ? String(tgUserId) : null,
      role, text: String(text || '').slice(0, 6000), eve_chat_id: eveChatId || null,
    })
  } catch { /* a lost transcript line is not worth losing the answer over */ }
}

/** The recent back-and-forth for this chat, oldest first, ready to prepend to the new question. */
export async function threadFor(chatId: string | number): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  try {
    const { data } = await db().from('telegram_messages')
      .select('role,text,created_at')
      .eq('chat_id', String(chatId))
      .order('created_at', { ascending: false })
      .limit(THREAD_TURNS * 2)
    const rows = ((data as any[]) || [])
    if (!rows.length) return []
    const newest = new Date(rows[0].created_at).getTime()
    if (Date.now() - newest > THREAD_IDLE_MS) return []
    return rows.reverse().slice(-THREAD_TURNS * 2).map(r => ({ role: r.role === 'assistant' ? 'assistant' as const : 'user' as const, content: String(r.text || '') }))
  } catch { return [] }
}

/** /new — forget the thread in this chat. The transcript is dropped, her durable memory is not. */
export async function resetThread(chatId: string | number): Promise<void> {
  try { await db().from('telegram_messages').delete().eq('chat_id', String(chatId)) } catch { /* ignore */ }
}

/**
 * A cheap ceiling on how much one chat can spend. Not a security control — the approval is — but a
 * runaway loop or a bored group can otherwise put a real Anthropic bill on the card overnight.
 */
export async function overRate(chatId: string | number, maxPerHour = 40): Promise<boolean> {
  try {
    const { count } = await db().from('telegram_messages')
      .select('id', { count: 'exact', head: true })
      .eq('chat_id', String(chatId)).eq('role', 'user')
      .gte('created_at', new Date(Date.now() - 3600_000).toISOString())
    return (count || 0) >= maxPerHour
  } catch { return false }
}
