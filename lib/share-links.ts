// ONE LINK MODEL (Jon, 2026-09-18: "individual password per link"). See migration 101.
//
// Every shareable page is a row in share_links: a KIND (which page the code opens), an AUDIENCE
// (who it is for), a SCOPE (what the page shows), and its own passcode — an scrypt hash, never the
// cleartext. This file is the vocabulary and the row-level helpers; the gate (cookie, lockout,
// login) is lib/passcode-gate.ts, and the hub API is app/api/share-links.
//
// The types here are safe to import from client components; the server-only helpers live at the
// bottom and are exported from lib/share-links-server.ts.

export const LINK_KINDS = [
  'vendor-board', 'scheduler', 'field-board', 'parking', 'day-sheet', 'delivery', 'orders-live', 'salato-desk',
  'marketing', 'owner-audit', 'botanica', 'owner-report', 'guidebook', 'guide', 'order-form', 'count', 'custom-page',
] as const
export type LinkKind = typeof LINK_KINDS[number]
export const AUDIENCES = ['crew', 'vendor', 'owner', 'guest', 'partner', 'internal'] as const
export type Audience = typeof AUDIENCES[number]

/** Kinds the hub can CREATE (the rest are minted by their own tabs, or are one-per-page fixtures). */
export const CREATABLE_KINDS: LinkKind[] = ['vendor-board', 'scheduler', 'field-board', 'parking', 'day-sheet', 'delivery', 'orders-live', 'marketing', 'owner-audit', 'botanica', 'custom-page']

/** Kinds whose link never expires by nature — the crew boards. Everything else is "generated". */
export const STANDING_KINDS: LinkKind[] = ['vendor-board', 'scheduler', 'field-board', 'parking', 'day-sheet', 'delivery', 'orders-live', 'salato-desk', 'marketing', 'owner-audit', 'botanica']

export const KIND_LABEL: Record<LinkKind, string> = {
  'vendor-board': 'Vendor cleaning board', scheduler: 'Team scheduler', 'field-board': 'Live field board', parking: 'Parking board',
  'day-sheet': 'Day sheet', delivery: 'Delivery log', 'orders-live': 'Guest orders — live', 'salato-desk': 'Salato desk board',
  marketing: 'Direct bookings report', 'owner-audit': 'Owner statement audit', botanica: 'Botanica report',
  'owner-report': 'Owner report', guidebook: 'Guidebook', guide: 'Guest guide page', 'order-form': 'Order form', count: 'Inventory count', 'custom-page': 'Custom report',
}
export const AUDIENCE_LABEL: Record<Audience, string> = {
  crew: 'Our crew', vendor: 'Vendors', owner: 'Owners', guest: 'Guests', partner: 'Partners & front desks', internal: 'Internal / reviewers',
}

/** What a scope can say. Every field optional; each kind reads the ones that mean something to it. */
export type LinkScope = {
  scopeType?: 'portfolio' | 'market' | 'building' | 'owner' | 'listing'
  scopeIds?: string[]
  vendor?: string           // vendor-board: botanica | pt | amrit-capri-lucerne | salato
  market?: string           // scheduler / day-sheet: Miami | Broward | North | All
  buildings?: string[]      // vendor-board / day-sheet: limit to these building names
  viewOnly?: boolean        // scheduler: read-only link
  sections?: Record<string, boolean>
  showMoney?: boolean
  guestNames?: boolean
  windowDays?: number
  from?: string             // marketing: date range the report may show
  to?: string
}

export type ShareLinkRow = {
  id: string; code: string; kind: LinkKind | string; title: string | null; label?: string | null
  audience: Audience | string; scope: LinkScope; passcode_hash: string | null; passcode_hint: string | null
  open: boolean; expires_at: string | null; revoked_at: string | null; created_by: string | null; created_at: string
  last_used_at: string | null; uses: number; notes: string | null; updated_at?: string
  // legacy columns, still read by the custom report / field board / parking builders
  scope_type?: string; scope_ids?: string[]; sections?: Record<string, boolean>; show_money?: boolean; guest_names?: boolean; window_days?: number
}

export type LinkStatus = 'live' | 'expiring' | 'expired' | 'revoked' | 'unset'

/** Where a link of this kind opens. */
export function pathFor(kind: string, code: string): string {
  switch (kind) {
    case 'vendor-board': return '/vendor/' + code
    case 'scheduler': return '/scheduler/' + code
    case 'field-board': return '/board/' + code
    case 'parking': return '/parking/' + code
    case 'day-sheet': return '/day'
    case 'delivery': return '/delivery'
    case 'orders-live': return '/orders-live'
    case 'salato-desk': return '/salato/share'
    case 'marketing': return '/report/marketing'
    case 'owner-audit': return '/report/owner-audit'
    case 'botanica': return '/report/botanica'
    case 'owner-report': return '/r/' + code
    case 'guidebook': return '/g/' + code
    case 'guide': return '/guide/' + code
    case 'order-form': return code === 'new-order' ? '/new-order' : '/owner-orders'
    case 'count': return '/count/' + code
    default: return '/share/' + code
  }
}

/** A FIXED page (one row per page, on a short readable code) versus a code-per-row page. Fixed
 *  pages cannot be minted twice: a second "day sheet" link would need a second page. */
export const FIXED_CODE_KINDS: string[] = ['day-sheet', 'delivery', 'orders-live', 'salato-desk', 'marketing', 'owner-audit', 'botanica', 'order-form']

export function linkStatus(l: Pick<ShareLinkRow, 'revoked_at' | 'expires_at' | 'open' | 'passcode_hash'>, now = Date.now()): LinkStatus {
  if (l.revoked_at) return 'revoked'
  if (l.expires_at) {
    const t = new Date(l.expires_at).getTime()
    if (t <= now) return 'expired'
    if (t - now < 3 * 86400000) return 'expiring'
  }
  if (!l.open && !l.passcode_hash) return 'unset'
  return 'live'
}

/** Live enough to open: not revoked, not expired. (Whether it also needs a passcode is the gate's business.) */
export function linkUsable(l: { revoked_at?: string | null; expires_at?: string | null }, now = Date.now()): boolean {
  if (l.revoked_at) return false
  if (l.expires_at && new Date(l.expires_at).getTime() <= now) return false
  return true
}

export const VENDOR_LABEL: Record<string, string> = {
  botanica: 'Botanica', pt: 'Park Towers', 'amrit-capri-lucerne': 'Amrit / Capri / Lucerne', salato: 'Salato',
}

const SECTION_WORDS: Record<string, string> = {
  reservations: 'reservations', revenue: 'revenue & ADR', marketing: 'booking sources', audience: 'audience counts', contacts: 'contact list',
  cleaning: 'cleaning & tasks', verification: 'guest verification', notes: 'reservation notes', team: 'weekly cleaning planner', team_maint: 'weekly maintenance planner',
  today: 'today\'s priorities', units: 'units in ops', crew: 'crew on shift', cleans: 'cleans today', verify: 'arrivals', vacant: 'vacant units',
  work: 'work today', issues: 'issues', requests: 'guest orders & requests', add: 'can add jobs', parking: 'parking QR codes',
}

/**
 * The human sentence for a row: "Broward cleaners · today's turns · no guest names". Built from
 * kind + scope so the hub never has to know each page. `names` resolves owner / listing ids.
 */
export function describeLink(l: Pick<ShareLinkRow, 'kind' | 'scope' | 'audience'>, names?: { owners?: Record<string, string>; listings?: Record<string, string> }): string {
  const s: LinkScope = l.scope || {}
  const parts: string[] = []
  const who = (ids: string[] | undefined, map?: Record<string, string>) => (ids || []).map(id => (map && map[id]) || id).slice(0, 4).join(', ') + ((ids || []).length > 4 ? ` +${(ids || []).length - 4}` : '')
  const scopeWords = () => {
    if (s.scopeType === 'market') return who(s.scopeIds) + ' market'
    if (s.scopeType === 'building') return who(s.scopeIds)
    if (s.scopeType === 'owner') return (names?.owners ? who(s.scopeIds, names.owners) : who(s.scopeIds)) + ' (owner)'
    if (s.scopeType === 'listing') return who(s.scopeIds, names?.listings)
    return 'whole portfolio'
  }
  switch (l.kind) {
    case 'vendor-board':
      parts.push((VENDOR_LABEL[String(s.vendor)] || String(s.vendor || 'vendor')) + ' crew')
      parts.push(s.buildings && s.buildings.length ? s.buildings.join(', ') + ' only' : 'today & tomorrow\'s turns')
      parts.push(s.vendor === 'salato' ? 'guest names for the desk' : 'no guest names')
      break
    case 'scheduler':
      parts.push((s.market || 'All') + (s.market === 'All' ? ' markets' : ' team'))
      parts.push(s.viewOnly ? 'view only' : 'can assign cleaners & submit the week')
      break
    case 'field-board': {
      parts.push(scopeWords())
      const keys = Object.keys(s.sections || {}).filter(k => s.sections && s.sections[k])
      parts.push(keys.map(k => SECTION_WORDS[k] || k).slice(0, 4).join(', ') + (keys.length > 4 ? ` +${keys.length - 4}` : ''))
      break
    }
    case 'parking': parts.push(scopeWords()); parts.push('upcoming stays + QR upload'); break
    case 'day-sheet': parts.push(s.market ? s.market + ' crew' : 'every market'); parts.push('arrivals, departures, cleans, who clocked in'); break
    case 'delivery': parts.push('today\'s deliveries at the buildings'); break
    case 'orders-live': parts.push('today\'s guest orders by building'); parts.push('tap to mark delivered'); break
    case 'salato-desk': parts.push('Salato occupancy'); parts.push('ID photo viewer'); break
    case 'marketing':
      parts.push('direct vs OTA by month')
      parts.push(s.from || s.to ? `${s.from || 'start'} → ${s.to || 'today'}` : 'any month')
      parts.push(s.showMoney === false ? 'counts only, no dollars' : 'with revenue')
      break
    case 'owner-audit': parts.push('monthly statement review'); parts.push('owner-level money'); break
    case 'botanica': parts.push('Botanica occupancy, ADR & revenue since opening'); break
    case 'owner-report': parts.push('one owner report'); break
    case 'guidebook': parts.push('one guidebook'); break
    case 'guide': parts.push('guest guide page'); break
    case 'order-form': parts.push('open form, no passcode'); break
    case 'count': parts.push('inventory count sheet'); break
    default: {
      parts.push(scopeWords())
      const keys = Object.keys(s.sections || {}).filter(k => s.sections && s.sections[k])
      parts.push(keys.map(k => SECTION_WORDS[k] || k).slice(0, 4).join(', ') + (keys.length > 4 ? ` +${keys.length - 4}` : '') || 'no sections')
      parts.push(s.showMoney ? 'dollars on' : 'no dollars')
      parts.push(s.guestNames ? 'full guest names' : 'no guest names')
      if (s.windowDays) parts.push(s.windowDays + 'd window')
    }
  }
  return parts.filter(Boolean).join(' · ')
}

/** Last two characters, for the hub after the reveal. Never more. */
export function hintOf(pw: string): string { const s = String(pw || ''); return s.length >= 4 ? '••' + s.slice(-2) : '••' }

/**
 * DOLLARS OFF FOR THIS LINK. A link with scope.showMoney === false hands out counts and nights but
 * no money: every numeric field whose name says money becomes null, recursively. Used by the
 * marketing report so a partner link can be built "counts only" without a second report page.
 */
const MONEY_KEY = /(^|[^a-z])(rev|revenue|accom|value|fare|money|adr|amount|amt|total|payout|price|paid|balance|cleaning)($|[^a-z])|Rev$|Revenue$|Value$|Adr$|Amount$|Amt$|Total$|Paid$|Balance$/
export function stripMoney<T>(v: T, depth = 0): T {
  if (depth > 8 || v == null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(x => stripMoney(x, depth + 1)) as any
  const out: any = {}
  for (const k of Object.keys(v as any)) {
    const x = (v as any)[k]
    if (typeof x === 'number' && MONEY_KEY.test(k)) out[k] = null
    else out[k] = stripMoney(x, depth + 1)
  }
  return out
}
