// THE REVENUE REPORT BY LINK (Jon, 2026-11-23: "How do I get a shareable link with passcode to share
// with the Rev team").
//
// One row in share_links — code and kind 'garden-revenue' — opens /report/garden-revenue: the same
// Revenue report as Garden → Reports (period, side, filters, views, in-depth report), read-only. It
// never opens without a passcode. The passcode is minted from the Share button on the report itself
// (or on Share Links), shown once, and stored only as a hash; minting a new one ends the old one.
//
// WHAT THE LINK DOES NOT CARRY: guest names. A revenue team reads rooms, dates, channels and money;
// the booking list and the balances list go out with the reservation number in place of the name,
// and a row cannot be opened into the full reservation (notes, contact details, ID on file).
import 'server-only'
import { randomInt } from 'crypto'
import { supabaseAdmin } from '../supabase-admin'
import { getLink } from '../share-links-server'
import { storablePasscode } from '../passcode-gate'
import { hintOf } from '../share-links'

export const REV_LINK = 'garden-revenue'
export const REV_PATH = '/report/garden-revenue'
const TITLE = 'Garden — revenue report'

/** The link row, made on first use with NO passcode (so it opens for nobody until one is minted). */
export async function ensureRevLink(who: string | null) {
  const have = await getLink(REV_LINK)
  if (have) return have
  await supabaseAdmin().from('share_links').insert({
    code: REV_LINK, kind: REV_LINK, title: TITLE, label: TITLE, audience: 'partner', scope: {},
    passcode_hash: null, passcode_hint: null, open: false, expires_at: null,
    notes: 'The Garden revenue report for the revenue team: period, Garden / Botanica / whole property, filters, booking window, length of stay, channels. No guest names.',
    created_by: who, updated_at: new Date().toISOString(),
  })
  return getLink(REV_LINK)
}

// No 0/O, 1/l/I: it gets read out and typed.
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789'
const word = (n: number) => Array.from({ length: n }, () => ALPHA[randomInt(ALPHA.length)]).join('')

/** A new passcode for the link. Returned once, here; only its hash is kept. The old one stops working. */
export async function mintRevPasscode(who: string | null): Promise<{ passcode: string; path: string }> {
  const link = await ensureRevLink(who)
  if (!link) throw new Error('Could not create the link.')
  const passcode = `garden-${word(4)}-${word(4)}`
  const { error } = await supabaseAdmin().from('share_links').update({ passcode_hash: storablePasscode(passcode), passcode_hint: hintOf(passcode), open: false, revoked_at: null, updated_at: new Date().toISOString() }).eq('id', link.id)
  if (error) throw new Error(error.message)
  return { passcode, path: REV_PATH }
}

/** Turn the link off: nobody outside gets in until a new passcode is minted. */
export async function closeRevLink(): Promise<void> {
  const link = await getLink(REV_LINK)
  if (link) await supabaseAdmin().from('share_links').update({ passcode_hash: null, passcode_hint: null, open: false, updated_at: new Date().toISOString() }).eq('id', link.id)
}

export async function revLinkStatus(): Promise<{ path: string; hasPasscode: boolean; hint: string | null; uses: number; lastUsedAt: string | null }> {
  const link = await getLink(REV_LINK)
  return { path: REV_PATH, hasPasscode: !!link?.passcode_hash && !link?.revoked_at, hint: link?.passcode_hint || null, uses: Number(link?.uses || 0), lastUsedAt: link?.last_used_at || null }
}

/**
 * REFRESH (Jon, 2026-11-23: "have a refresh button"). Reads bookings and room state from Cloudbeds now
 * (the quick sync) and then the amounts. Cloudbeds is not asked more than once every three minutes,
 * however many people press it: inside that window the answer is "already fresh".
 */
export async function refreshFromCloudbeds(): Promise<{ ok: boolean; fresh?: boolean; syncAt: string | null; error?: string }> {
  const db = supabaseAdmin()
  const at = async () => { const { data } = await db.from('garden_sync_status').select('last_sync_at').eq('entity', 'reservations').maybeSingle(); return (data as any)?.last_sync_at || null }
  const last = await at()
  if (last && Date.now() - Date.parse(last) < 3 * 60000) return { ok: true, fresh: true, syncAt: last }
  try {
    const { syncGarden } = await import('./sync')
    await syncGarden({ quick: true })
    const { pullTotals } = await import('./res-detail')
    await pullTotals(120, 365, true).catch(() => null)
    return { ok: true, syncAt: await at() }
  } catch (e: any) { return { ok: false, syncAt: last, error: String(e?.message || e).slice(0, 200) } }
}

/** The report as the link sees it: the same numbers, no guest names. */
export function forLink<T extends Record<string, any>>(d: T): T {
  const out: any = { ...d, shared: true }
  if (Array.isArray(out.bookings)) out.bookings = out.bookings.map((b: any) => ({ ...b, guest: null }))
  if (Array.isArray(out.owed)) out.owed = out.owed.map((b: any) => ({ ...b, guest: null }))
  return out
}
