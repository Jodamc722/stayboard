// CHANNEL CONNECTIONS — the client-safe vocabulary (Jon, 2026-09-18: "a report or data set that
// shows our listings and whether we are connected to channels... need to identify listings not
// connected").
//
// No server imports here. The page, the Command Center row, the Eve tool and the check itself all
// read THIS list, so "which channels do we count" is decided exactly once. Keys are Guesty's own
// `raw.integrations[].platform` values, version suffix included — see lib/ota-links.ts for why
// 'homeaway2' is not 'vrbo' and 'airbnb2' is not 'airbnb'.
export type ChannelKey =
  | 'airbnb2' | 'bookingCom' | 'homeaway2' | 'expedia'
  | 'googleVacationRentals' | 'hopper' | 'bluegroundNestpick' | 'whimstay' | 'homesVillasByMarriott'

export type ChannelDef = {
  key: ChannelKey
  label: string
  /** A MAJOR channel is one a listing cannot afford to be off. Only these drive the per-listing verdict and the alerts. */
  major: boolean
  /** Reservation `source` spellings that belong to this channel (lowercased, matched with startsWith). */
  sources: string[]
}

// Major first, in the order the matrix draws them. The four majors carry essentially all the
// booking volume; the rest are distribution we hold but do not depend on.
export const CHANNELS: ChannelDef[] = [
  { key: 'airbnb2', label: 'Airbnb', major: true, sources: ['airbnb'] },
  { key: 'bookingCom', label: 'Booking.com', major: true, sources: ['booking'] },
  { key: 'homeaway2', label: 'Vrbo', major: true, sources: ['vrbo', 'homeaway'] },
  // Expedia is a network: Hotels.com, Orbitz, Travelocity and the affiliate feed all book through it.
  { key: 'expedia', label: 'Expedia', major: true, sources: ['expedia', 'hotels.com', 'orbitz', 'travelocity', 'ebookers', 'cheaptickets'] },
  { key: 'googleVacationRentals', label: 'Google VR', major: false, sources: ['google'] },
  { key: 'hopper', label: 'Hopper', major: false, sources: ['hopper'] },
  { key: 'bluegroundNestpick', label: 'Blueground', major: false, sources: ['blueground', 'nestpick'] },
  { key: 'whimstay', label: 'Whimstay', major: false, sources: ['whimstay'] },
  { key: 'homesVillasByMarriott', label: 'Marriott HVMI', major: false, sources: ['marriott', 'homes & villas', 'homesvillas'] },
]
export const MAJOR_KEYS: ChannelKey[] = CHANNELS.filter(c => c.major).map(c => c.key)
export const CHANNEL_LABEL: Record<string, string> = CHANNELS.reduce((m, c) => { m[c.key] = c.label; return m }, {} as Record<string, string>)

/**
 * One cell's verdict. Ordered worst → best, so "the worst cell" is `min` by index and a transition
 * "gets worse" when the index falls.
 *
 *   suspended     airbnb2 approvalStatus says suspended / rejected / pending — the listing is up but Airbnb is not selling it
 *   failed        Guesty's own sync to the channel reports FAILED
 *   disconnected  the integration exists but the channel says DISCONNECTED
 *   missing       no integration at all on this channel
 *   unknown       a status value this code has never seen — shown verbatim, never assumed fine
 *   stale         connected and COMPLETED, but no booking from it in 90 days on a MAJOR channel while the listing books elsewhere
 *   live          COMPLETED with a public URL
 */
export type CellVerdict = 'suspended' | 'failed' | 'disconnected' | 'missing' | 'unknown' | 'stale' | 'live'
export const VERDICT_ORDER: CellVerdict[] = ['suspended', 'failed', 'disconnected', 'missing', 'unknown', 'stale', 'live']
export const VERDICT_LABEL: Record<CellVerdict, string> = {
  suspended: 'Suspended', failed: 'Failed', disconnected: 'Disconnected', missing: 'Not connected',
  unknown: 'Unknown', stale: 'No bookings', live: 'Live',
}
/** Which verdicts are worth a person's time. `stale` and `unknown` are shown, not alerted. */
export const PROBLEM_VERDICTS: CellVerdict[] = ['suspended', 'failed', 'disconnected', 'missing']
export function verdictRank(v: CellVerdict): number { const i = VERDICT_ORDER.indexOf(v); return i < 0 ? VERDICT_ORDER.length : i }
export function worstOf(list: CellVerdict[]): CellVerdict {
  let best: CellVerdict = 'live'
  for (const v of list) if (verdictRank(v) < verdictRank(best)) best = v
  return best
}
export function isProblem(v: CellVerdict): boolean { return PROBLEM_VERDICTS.indexOf(v) >= 0 }

export type Cell = {
  connected: boolean
  /** The channel's own status string, as Guesty stores it (COMPLETED / FAILED / DISCONNECTED / …), or null when there is no integration. */
  status: string | null
  /** airbnb2 only: whatever approvalStatus exposed, flattened to text. Null elsewhere. */
  approval: string | null
  syncCategory: string | null
  url: string | null
  lastBookingAt: string | null
  bookings90d: number
  verdict: CellVerdict
}

export type ListingHealth = {
  id: string
  name: string
  building: string
  market: string
  active: boolean
  status: string
  cells: Record<string, Cell>
  /** Worst cell across the MAJOR channels. */
  verdict: CellVerdict
  /** Major channels this listing is not live on, by key — the "not connected" list. */
  missingMajor: ChannelKey[]
  bookings90d: number
}

export type ChannelTotals = Record<string, Record<CellVerdict, number>>

export type ChannelHealth = {
  at: string
  listings: ListingHealth[]
  inactive: ListingHealth[]
  /** Per channel, per verdict, ACTIVE listings only. */
  totals: ChannelTotals
  /** Status strings seen per channel with a count, so an unknown value is visible rather than buried. */
  statusesSeen: Record<string, Record<string, number>>
  channels: ChannelDef[]
}

export const emptyTotals = (): Record<CellVerdict, number> => ({ suspended: 0, failed: 0, disconnected: 0, missing: 0, unknown: 0, stale: 0, live: 0 })
