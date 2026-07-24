// System-wide in-app notifications. Any feature can call notify() to drop rows into
// app_notifications; the Shell bell polls /api/notifications and shows them everywhere.
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function notify(recipients: string[], n: { kind: string; title: string; body?: string; link?: string; actor?: string }) {
  const db = supabaseAdmin()
  const rows = Array.from(new Set(recipients.map(r => String(r || '').trim().toLowerCase()).filter(Boolean)))
    .filter(r => r !== String(n.actor || '').toLowerCase())
    .map(user_email => ({ user_email, actor_email: n.actor || null, kind: n.kind, title: n.title.slice(0, 200), body: (n.body || '').slice(0, 500) || null, link: n.link || null }))
  if (!rows.length) return { ok: true, sent: 0 }
  const { error } = await db.from('app_notifications').insert(rows)
  return { ok: !error, sent: rows.length, error: error ? error.message : undefined }
}
