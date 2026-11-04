// CLOUDBEDS → LIGHTHOUSE IN REAL TIME. Cloudbeds posts an event (a booking, a cancellation, a
// payment, a room turning dirty) to /api/garden/cloudbeds/webhook; Lighthouse runs the incremental
// sync for it, at most once a minute however many events land together. The 20-minute poll stays as
// the safety net. Subscribing is one button on Cloudbeds & feeds (postWebhook, API v1.3).
import 'server-only'
import { randomBytes } from 'crypto'
import { getSetting, setSetting } from '../app-settings'
import { cbGetV, cbPostV } from './cloudbeds'

export const WEBHOOK_EVENTS: [string, string][] = [
  ['reservation', 'created'], ['reservation', 'status_changed'], ['reservation', 'dates_changed'], ['reservation', 'accommodation_changed'],
  ['reservation', 'deleted'], ['reservation', 'notes_changed'], ['guest', 'details_changed'],
  ['accounting', 'transaction'], ['housekeeping', 'room_condition_changed'], ['roomblock', 'created'], ['roomblock', 'removed'],
]
type Hook = { token: string; lastEventAt?: string | null; lastSyncAt?: string | null; events?: number }

export async function hookState(): Promise<Hook> {
  const h = await getSetting<Hook | null>('garden_cb_webhook', null).catch(() => null)
  if (h?.token) return h
  const fresh = { token: randomBytes(18).toString('hex'), events: 0 }
  await setSetting('garden_cb_webhook', fresh, 'realtime')
  return fresh
}

/** Subscribe every event Lighthouse uses; returns what Cloudbeds now has on file. */
export async function subscribe(origin: string): Promise<{ added: string[]; failed: string[]; existing: number }> {
  const h = await hookState()
  const url = `${origin}/api/garden/cloudbeds/webhook`
  const have = await cbGetV<any[]>('v1.3', 'getWebhooks').catch(() => ({ data: [] as any[] }))
  const list = Array.isArray(have.data) ? have.data : []
  const already = new Set(list.filter((w: any) => String(w?.subscriptionData?.endpoint || w?.endpointUrl || w?.url || '').startsWith(url)).map((w: any) => `${w?.event?.entity || w?.object}/${w?.event?.action || w?.action}`))
  const added: string[] = [], failed: string[] = []
  for (const [object, action] of WEBHOOK_EVENTS) {
    const k = `${object}/${action}`
    if (already.has(k)) continue
    try { await cbPostV('v1.3', 'postWebhook', { endpointUrl: url, object, action, authHeaderName: 'X-Garden-Token', authHeaderValue: h.token }); added.push(k) }
    catch (e: any) { failed.push(`${k}: ${String(e?.message || e).replace(/^Cloudbeds \w+: /, '').slice(0, 80)}`) }
  }
  return { added, failed, existing: already.size }
}

/** A Cloudbeds event arrived: note it, and sync if the last event-driven sync was over a minute ago. */
export async function onEvent(): Promise<{ synced: boolean }> {
  const h = await hookState()
  const now = Date.now()
  const due = !h.lastSyncAt || now - Date.parse(h.lastSyncAt) > 60_000
  await setSetting('garden_cb_webhook', { ...h, lastEventAt: new Date(now).toISOString(), events: (h.events || 0) + 1, ...(due ? { lastSyncAt: new Date(now).toISOString() } : {}) }, 'realtime')
  if (!due) return { synced: false }
  const { syncGarden } = await import('./sync')
  await syncGarden()
  return { synced: true }
}
