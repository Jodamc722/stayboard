// Everything the Telegram panel in Users & admin needs, and the only place approvals can happen.
//
// GET  — is the bot configured, is the webhook pointed at us, who is waiting, who is approved.
// POST — connect / disconnect the webhook, approve / block a contact, approve / block a room.
//
// APPROVAL IS ADMIN-ONLY AND LIVES HERE. Not in Slack, not behind a token in a message, not on a
// /approve/<token> page. Approving a Telegram contact hands a person a live line into operations
// data, so it takes a Lighthouse login and it is attributed to the email that clicked it.
import { NextRequest, NextResponse } from 'next/server'
import { eveGate } from '../../agent/route'
import { isSuperadmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { botConfigured, webhookSecret, getMe, getWebhookInfo, setWebhook, deleteWebhook, redact } from '@/lib/telegram'
import { listContacts, listRooms, approveContact, blockContact, setRoomStatus } from '@/lib/eve/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const WEBHOOK_PATH = '/api/telegram/webhook'

function originOf(req: NextRequest): string {
  return String(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '') || new URL(req.url).origin
}

export async function GET(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res

  const configured = botConfigured()
  const hasSecret = !!webhookSecret()
  const [meRes, hookRes, contacts, rooms] = await Promise.all([
    configured ? getMe() : Promise.resolve({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not set in Vercel.' } as any),
    configured ? getWebhookInfo() : Promise.resolve({ ok: false } as any),
    listContacts(),
    listRooms(),
  ])

  // The people a contact can be bound to. Only active users — binding to a deactivated account
  // would produce a contact that is "approved" and can never get an answer.
  let users: { email: string; name: string; role: string }[] = []
  try {
    const { data } = await supabaseAdmin().from('app_users').select('email,role,profile,status').eq('status', 'active').order('email').limit(300)
    users = ((data as any[]) || []).map(u => ({
      email: String(u.email || ''), role: String(u.role || 'member'),
      name: String(u?.profile?.name || '') || String(u.email || '').split('@')[0],
    }))
  } catch { /* the dropdown degrades to typing an email */ }

  const want = originOf(req) + WEBHOOK_PATH
  const url = hookRes?.ok ? String(hookRes.result?.url || '') : ''
  return NextResponse.json({
    bot: {
      configured, hasSecret,
      username: meRes?.ok ? meRes.result?.username || null : null,
      name: meRes?.ok ? meRes.result?.first_name || null : null,
      error: meRes?.ok ? null : redact(meRes?.error || ''),
      // BotFather's privacy setting decides whether she can even see a group @mention.
      canJoinGroups: meRes?.ok ? meRes.result?.can_join_groups ?? null : null,
      readsAllGroupMessages: meRes?.ok ? meRes.result?.can_read_all_group_messages ?? null : null,
    },
    webhook: {
      url, wanted: want, connected: !!url && url === want,
      pendingUpdates: hookRes?.ok ? hookRes.result?.pending_update_count ?? null : null,
      lastError: hookRes?.ok ? (hookRes.result?.last_error_message || null) : null,
      lastErrorAt: hookRes?.ok && hookRes.result?.last_error_date ? new Date(hookRes.result.last_error_date * 1000).toISOString() : null,
    },
    contacts, rooms, users,
  })
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const access = gate.access
  if (!(isSuperadmin(access.email) || access.role === 'admin')) {
    return NextResponse.json({ error: 'forbidden', message: 'Only an admin can approve Telegram contacts.' }, { status: 403 })
  }
  const by = String(access.email || 'unknown')
  const body = await req.json().catch(() => ({} as any))
  const action = String(body?.action || '')

  if (action === 'connect') {
    if (!botConfigured()) return NextResponse.json({ error: 'Set TELEGRAM_BOT_TOKEN in Vercel first.' }, { status: 400 })
    const secret = webhookSecret()
    if (!secret) return NextResponse.json({ error: 'Set TELEGRAM_WEBHOOK_SECRET in Vercel first — it is what proves a call really came from Telegram.' }, { status: 400 })
    if (secret.length < 16) return NextResponse.json({ error: 'TELEGRAM_WEBHOOK_SECRET is too short to be worth having. Use 32+ random characters.' }, { status: 400 })
    const r = await setWebhook(originOf(req) + WEBHOOK_PATH, secret)
    if (!r.ok) return NextResponse.json({ error: redact(r.error || 'setWebhook failed') }, { status: 502 })
    return NextResponse.json({ ok: true, url: originOf(req) + WEBHOOK_PATH })
  }

  if (action === 'disconnect') {
    const r = await deleteWebhook()
    if (!r.ok) return NextResponse.json({ error: redact(r.error || 'deleteWebhook failed') }, { status: 502 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'approve') {
    const r = await approveContact(String(body?.tgUserId || ''), String(body?.email || ''), by)
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 })
  }
  if (action === 'block') {
    const r = await blockContact(String(body?.tgUserId || ''), by)
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 })
  }
  if (action === 'room') {
    const status = String(body?.status || '')
    if (status !== 'approved' && status !== 'blocked' && status !== 'pending') {
      return NextResponse.json({ error: 'status must be approved, blocked or pending' }, { status: 400 })
    }
    const r = await setRoomStatus(String(body?.chatId || ''), status as any, by)
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 })
  }

  return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 })
}
