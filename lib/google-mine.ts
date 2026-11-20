// WHAT A PERSON'S OWN GOOGLE CONNECTION CAN DO (Jon, 2026-11-20: "link their Google accounts which allows them to
// connect emails. So if Nick connects his email he can send emails from the app, he can also set up his cal links").
// Reads the permissions Google actually granted on the stored connection: a person can untick boxes on the consent
// screen, and then sending or the calendar quietly fails. Server-only; the token never leaves.
import 'server-only'
import { accessTokenFor } from './gmail-send'

export type MyGoogle = { email: string; connected: boolean; mail: boolean; calendar: boolean; error?: string }
export async function myGoogle(email: string): Promise<MyGoogle> {
  const e = String(email || '').trim().toLowerCase()
  const t = await accessTokenFor(e)
  if (!t.token) return { email: e, connected: false, mail: false, calendar: false, ...(/No Google connection/i.test(t.error || '') ? {} : { error: t.error }) }
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(t.token), { cache: 'no-store' })
    const d: any = await r.json().catch(() => ({}))
    const scopes = String(d?.scope || '').split(/\s+/)
    const has = (s: string) => scopes.indexOf('https://www.googleapis.com/auth/' + s) >= 0
    return { email: e, connected: true, mail: has('gmail.send') || has('gmail.compose'), calendar: has('calendar.events') && (has('calendar.freebusy') || has('calendar.readonly') || has('calendar')) }
  } catch (err: any) { return { email: e, connected: true, mail: false, calendar: false, error: String(err?.message || err).slice(0, 160) } }
}
