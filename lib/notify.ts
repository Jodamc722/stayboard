// System-wide in-app notifications. Any feature can call notify() to drop rows into
// app_notifications; the Shell bell polls /api/notifications and shows them everywhere.
// Respects per-user notification preferences (app_users.prefs, migration 013):
//   prefs.mute_all === true          -> no notifications at all
//   prefs['mute_' + kind] === true   -> that kind muted (e.g. mute_mention, mute_comment)
// FAIL-OPEN: any error reading prefs just sends the notification.
import { supabaseAdmin } from '@/lib/supabase-admin'

const DAILY_CAP = 4
const UNCAPPED = new Set(['mention', 'comment'])

export type NotifyEntity = { type: string; id: string }
export async function notify(recipients: string[], n: { kind: string; title: string; body?: string; link?: string; actor?: string; entity?: NotifyEntity | null }) {
  const db = supabaseAdmin()
  let emails = Array.from(new Set(recipients.map(r => String(r || '').trim().toLowerCase()).filter(Boolean)))
    .filter(r => r !== String(n.actor || '').toLowerCase())
  if (!emails.length) return { ok: true, sent: 0 }
  try {
    const { data } = await db.from('app_users').select('email, prefs').in('email', emails)
    if (Array.isArray(data)) {
      const muted = new Set(
        data.filter((u: any) => u?.prefs && typeof u.prefs === 'object' && (u.prefs.mute_all === true || u.prefs['mute_' + n.kind] === true))
          .map((u: any) => String(u.email || '').toLowerCase())
      )
      emails = emails.filter(e => !muted.has(e))
    }
  } catch { /* fail-open: send */ }
  // A DAILY CEILING PER KIND (Eve audit 2026-10-10): 31 unread in the owner's bell, 25 of the last 30
  // the same kind. Automated kinds stop at DAILY_CAP rows per person per day; a mention or a comment
  // is a person talking to a person and is never capped.
  if (!UNCAPPED.has(n.kind)) {
    try {
      const dayStart = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) + 'T04:00:00Z').toISOString()
      const { data } = await db.from('app_notifications').select('user_email').eq('kind', n.kind).gte('created_at', dayStart).in('user_email', emails).limit(2000)
      const count: Record<string, number> = {}
      for (const r of ((data || []) as any[])) count[String(r.user_email).toLowerCase()] = (count[String(r.user_email).toLowerCase()] || 0) + 1
      emails = emails.filter(e => (count[e] || 0) < DAILY_CAP)
    } catch { /* fail-open: send */ }
  }
  const base = emails.map(user_email => ({ user_email, actor_email: n.actor || null, kind: n.kind, title: n.title.slice(0, 200), body: (n.body || '').slice(0, 500) || null, link: n.link || null }))
  if (!base.length) return { ok: true, sent: 0 }
  // THE INBOX COLUMNS (migration 155): the thread the row came from, so Inbox can reply in place.
  // Until the migration runs the insert is retried without them — a bell row beats no row.
  const rows = n.entity ? base.map(r => ({ ...r, entity_type: String(n.entity!.type).slice(0, 40), entity_id: String(n.entity!.id).slice(0, 120) })) : base
  let { error } = await db.from('app_notifications').insert(rows)
  if (error && n.entity && /entity_type|entity_id|schema cache/i.test(error.message)) ({ error } = await db.from('app_notifications').insert(base))
  return { ok: !error, sent: rows.length, error: error ? error.message : undefined }
}
