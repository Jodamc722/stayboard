// BRIEF DELIVERY — who is told when a brief fails, and the record of which brief went out today
// (2026-11-09).
//
//   • ONE ALERT ADDRESS. The owner's address was hardcoded in four files (the morning briefs, the EOD
//     recap, the Salato daily, the labor integrity email). It is now `ops_brief.alertTo` — one address
//     or a list — read here. With nothing set it is the address that was in the code, so nothing moves
//     until somebody sets it.
//   • SENT TODAY. As each morning brief goes out, its variant is stamped in app_settings
//     `ops_brief_sent` { date, sent: { <variant>: <iso> } }. Two things read it:
//       – the morning send itself: a variant already stamped today is skipped, so a scheduler retry
//         (or a person's re-send without force=1) never sends a crew or a vendor the same brief twice;
//       – the hourly watchdog: after 7:30am ET, a variant that HAS recipients and has no stamp raises
//         ONE in-app bell for the day. This is the alert that still arrives when the 7:01 function
//         died before it could send its own "did not send" email.
// Stamps and the bell are best effort and never throw: a receipt must not break a send.
import 'server-only'
import { getSetting, getSettingFresh, setSetting } from '@/lib/app-settings'

export const BRIEF_OWNER_DEFAULT = 'jon@stay-hospitality.com'
const OPS_BRIEF_KEY = 'ops_brief'
const SENT_KEY = 'ops_brief_sent'
const BELL_KEY = 'ops_brief_missing_bell'
const VENDOR_KEYS = ['botanica', 'pt', 'north']   // lib/ops-brief VENDOR_GROUPS, kept in step by hand

const emails = (v: any): string[] => {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;\s]+/) : []
  return Array.from(new Set(list.map((x: any) => String(x || '').trim().toLowerCase()).filter((x: string) => /@/.test(x))))
}

/** Who hears that a brief did not go out: `ops_brief.alertTo`, or the address the code used to carry. */
export async function briefAlertTo(cfgIn?: any): Promise<string[]> {
  let cfg = cfgIn
  if (!cfg) { try { cfg = await getSetting<any>(OPS_BRIEF_KEY, {}) } catch { cfg = {} } }
  const list = emails(cfg && cfg.alertTo)
  return list.length ? list : [BRIEF_OWNER_DEFAULT]
}

export const briefDayET = (now = new Date()): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)

type SentState = { date: string; sent: Record<string, string> }

/** The variants stamped as sent today (lower-cased keys: miami, broward, full, gm, maint, maint:<name>, vendor:<key>). */
export async function briefsSentToday(today = briefDayET()): Promise<Record<string, string>> {
  try {
    const v = await getSettingFresh<SentState | null>(SENT_KEY, null)
    return v && v.date === today && v.sent && typeof v.sent === 'object' ? { ...v.sent } : {}
  } catch { return {} }
}

/** Stamp one variant as sent today. Yesterday's stamps are dropped by the first stamp of a new day. */
export async function stampBriefSent(variant: string, today = briefDayET()): Promise<void> {
  try {
    const sent = await briefsSentToday(today)
    sent[String(variant).toLowerCase()] = new Date().toISOString()
    await setSetting(SENT_KEY, { date: today, sent } as SentState, 'ops-brief')
  } catch { /* the brief went out; the receipt is best effort */ }
}

/** Every variant that has somebody on its list, by the same keys the send stamps. */
export function briefVariantsWithRecipients(cfg: any): string[] {
  const has = (v: any) => Array.isArray(v) && v.filter(Boolean).length > 0
  const out: string[] = []
  if (has(cfg?.miami)) out.push('miami')
  if (has(cfg?.broward)) out.push('broward')
  if (has(cfg?.full)) out.push('full')
  const techs = cfg?.techs && typeof cfg.techs === 'object' ? cfg.techs : {}
  for (const name of Object.keys(techs)) if (has(techs[name]?.to)) out.push('maint:' + name.toLowerCase())
  if (has(cfg?.maint)) out.push('maint')
  const vendors = cfg?.vendors && typeof cfg.vendors === 'object' ? cfg.vendors : {}
  for (const k of VENDOR_KEYS) if (has(vendors[k])) out.push('vendor:' + k)
  if (has(cfg?.gm)) out.push('gm')
  return out
}

/**
 * The watchdog's check. After 7:30am ET, with the morning briefs switched on: any variant with
 * recipients and no stamp today → ONE in-app bell to `ops_brief.alertTo`, once a day. Not Slack, not
 * email. Returns what it found, for the watchdog's JSON.
 */
export async function checkMissingBriefs(now = new Date()): Promise<{ checked: boolean; missing: string[]; belled: boolean; why?: string }> {
  try {
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
    const [h, m] = hm.split(':').map(Number)
    const mins = ((h || 0) % 24) * 60 + (m || 0)
    if (mins < 7 * 60 + 30) return { checked: false, missing: [], belled: false, why: 'before 7:30am ET' }
    const cfg = await getSettingFresh<any>(OPS_BRIEF_KEY, {})
    if (!cfg || cfg.enabled !== true) return { checked: false, missing: [], belled: false, why: 'morning briefs are switched off' }
    const today = briefDayET(now)
    const sent = await briefsSentToday(today)
    const missing = briefVariantsWithRecipients(cfg).filter(v => !sent[v])
    if (!missing.length) return { checked: true, missing, belled: false }
    const last = await getSettingFresh<{ on?: string } | null>(BELL_KEY, null)
    if (last && last.on === today) return { checked: true, missing, belled: false, why: 'already told today' }
    const { notify } = await import('@/lib/notify')
    await notify(await briefAlertTo(cfg), {
      kind: 'system',
      title: `Morning briefs: ${missing.length} did not go out today`,
      body: `No send is recorded today for: ${missing.join(', ')}. Each has people on its list. Re-send from /api/cron/ops-brief?only=${missing.map(v => encodeURIComponent(v)).join(',')} (signed in), or check Users & admin → Settings → Morning brief.`,
      link: '/users',
    })
    await setSetting(BELL_KEY, { on: today, missing }, 'watchdog')
    return { checked: true, missing, belled: true }
  } catch (e: any) { return { checked: false, missing: [], belled: false, why: String(e?.message || e).slice(0, 160) } }
}
