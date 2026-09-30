// THE APP ATLAS — Eve's working knowledge of Lighthouse itself (Jon, 2026-08-19: "she needs to
// study all the tools, read and learn and update constantly").
//
// Before this, Eve knew the BUSINESS (ops, money, quality, labor, guests) but not the PRODUCT:
// asked "where do I set up auto-inspections?" she had nothing. The atlas gives her every page in
// the app with what it is for, plus a live census of her own tool domains — and both are DERIVED,
// not hand-frozen: the page list comes from the features registry and the tool census from the
// tool registry, so a new page or a new tool is in her head on the next deploy with zero upkeep.
// The one hand-written part is the one only a human can write: what each page is FOR.
import 'server-only'
import { FEATURES, GROUP_ORDER } from '@/lib/features'
import { DOMAINS } from './registry'

// What each page is for, one line each, keyed by feature key. A page missing here still appears
// in the atlas (label + path from the registry) — it just carries no explanation until someone
// writes one. Keep these to a single clause; the atlas rides in every prompt.
const PAGE_NOTES: Record<string, string> = {
  // TODAY
  command: 'Command — the ranked day: Decide, Fix, Clear and Yours rows, one tap each, plus the week scoreboard strip',
  eve: 'Eve\'s tab — what needs a person, what she did today, the open loops she is keeping tabs on, the questions only a person can answer, and her expectation notes for CS; people talk to her in the floating bubble on every page; her memory, voice and agent mode live in Admin → People & settings → Settings → Eve',
  loops: 'not a page of its own — the Open loops tab on Eve (/loops redirects there)',
  // OPERATIONS
  plan: 'Today board — every unit\'s work today against the 4pm deadline: assign, add tasks, staffing, vacant units, PM due; the printable day sheet is its day-sheet icon',
  schedule: 'the cleaning schedule — turnovers by day, bulk assign, add cleans and push to Breezeway, with the capacity check and schedule suggester',
  checklist: 'the standing daily checklist in time bands; whoever ticks an item is recorded',
  maintenance: 'one aged list of work orders, open Breezeway maintenance and open glitches, with a building heat grid and unbilled closed work',
  requests: 'the work-order list behind Maintenance (open a work order from Maintenance to approve it)',
  blocked: 'units blocked off the Guesty calendar right now, longest first, with the block note',
  projects: 'work bigger than a task — renovations, rollouts, building onboarding — with tasks, comments and files',
  // GUEST EXPERIENCE
  messages: 'the inbox — Guesty and Talkroute threads, who is waiting on a reply (1-hour rule), and sentiment',
  'welcome-calls': 'the Calls desk — calls owed today: mandatory luxury/big-group welcome calls, bad-review recovery and post-checkout calls, with a caller scoreboard',
  glitches: 'guest-reported problems tracked to resolution — refund advice, evidence, vendor, history, building patterns and trends',
  refunds: 'the refund playbook — remediation ladder, clocks, matrix, sign-off tiers and training cases (linked from Glitches)',
  claims: 'damage claims with the 14-day filing countdown and each channel\'s filing policy',
  reservations: 'arriving, departing, in-house and upcoming bookings mirrored from Guesty; a row opens the booking page',
  'guest-orders': 'pre-arrival guest orders — approve, charge, push; order links, catalog, stock per hub and coupons',
  guidebooks: 'guest guidebooks by building — build, bulk fix, emergency info and push to Guesty',
  'reservation-emails': 'front-desk notices to buildings — auto-drafted daily into support@ Drafts with the registration form attached; config lives in Admin → People & settings → Settings → Front-desk notices',
  faq: 'per-unit knowledge — facts, FAQs, how-tos and key details; door codes stay masked unless the viewer is set to Direct',
  guests: 'the guest directory — profiles, history, VIP flags, tags and notes',
  contacts: 'the guest list as a mailing list — filters, export and the Mailchimp push',
  salato: 'not a page any more — which units the Salato board, verification and daily email cover is set in Admin → People & settings → Settings → Salato front-desk units; the front desk works from the Salato share board (/salato/share)',
  // REVIEWS
  reviews: 'review management — the reply queue (drafts on demand), failing units and buildings, all reviews, and the jobs made from complaints (Actions tab)',
  // LISTINGS
  buildings: 'Properties — buildings and units with occupancy/ADR/RevPAR, Health Score, Fix next, bulk copy and photos; unit pages (/listings/<id>) open from here',
  listings: 'unit pages (/listings/<id>) — fixes, optimizer, photos, hero, amenities, reviews, tasks, audit, FAQ and guidebook for one unit; /listings itself opens Properties',
  optimize: 'the Fix next view on Properties (/optimize redirects there); the optimizer itself is on each unit page',
  health: 'the Health Score view on Properties (/health redirects there)',
  channels: 'which listing is live on which channel — matrix, not connected, inactive — and the check that finds breaks',
  // OWNERS
  onboarding: 'new-unit onboarding — an inventory link per unit (rooms, counts, photos), the unit check against the standard and the buy list; the Linens page (/onboarding/linens) holds the linen standard and the linen order for any set of units',
  audits: 'Quality — unit walk links and what they found, one Breezeway task per fix or clean',
  orders: 'Purchasing — the buying desk for audit replace/add lines: approve, buy, receive, install task',
  ffe: 'the older FF&E walk, catalog and furniture orders (off the nav; onboarding purchase orders still open here)',
  reports: 'owner reports — owner reviews, projection and onboarding decks, sent as /r links',
  billing: 'billable hours — owner billables from Breezeway in two review stages (ops, then final), then export',
  'owner-audit': 'owner statement audit — statements checked against reservations, with a worklist and prep view',
  projections: 'next season\'s owner revenue model behind the projection decks, editable by month',
  // TEAM
  'team-schedule': 'Week plan — who works which day by trade and market, the housekeeping-day assignment and the 14-day staffing forecast',
  labor: 'labor from Homebase punches against departure cleans — cost per clean, people, days and data health',
  'labor-dashboard': 'the day/week/month labor dashboard behind the daily labor email (the Dashboard switch on Labor)',
  cleaners: 'each cleaner\'s last 90 days of departure cleans — pace, same-day rate and quality tier',
  // KPIS
  revenue: 'Revenue — revenue, occupancy, ADR and RevPAR by building and unit, pacing and the $-ranked checks',
  marketing: 'direct bookings tracked by the date they were made',
  'revenue-app': 'the boss\'s Revenue App inside Lighthouse — where budgets and forecasting live',
  home: 'the KPI board, parked (off the nav) until it is rebuilt on the shared numbers',
  // ADMIN
  'system-health': 'Health — the daily self-audit\'s findings: syncs, pipeline gaps and number checks',
  'share-links': 'every share link and passcode in one list — reservations, ADR, cleaning, verification boards',
  vault: 'credentials and paperwork, revealed after unlock (owner-gated)',
  'api-keys': 'personal read-only API keys for /api/v1',
  'labor-settings': 'labor rules and pay settings (a panel in Admin → People & settings)',
  integrations: 'connected systems — Guesty, Breezeway, Slack, email, Homebase (a panel in Admin → People & settings)',
}

let _cache: string | null = null

/** The atlas text for the system prompt. Built once per server instance — it only changes on deploy. */
export function appAtlas(): string {
  if (_cache) return _cache
  const byGroup: Record<string, string[]> = {}
  for (const f of FEATURES) {
    const note = PAGE_NOTES[f.key]
    const line = `- ${f.label} (${f.path})${note ? ': ' + note : ''}`
    ;(byGroup[f.group] = byGroup[f.group] || []).push(line)
  }
  // Desk order (GROUP_ORDER mirrors lib/desks.ts), then anything unexpected at the end.
  const order = GROUP_ORDER.filter(g => byGroup[g]).concat(Object.keys(byGroup).filter(g => GROUP_ORDER.indexOf(g) < 0))
  const pages = order.map(g => g.toUpperCase() + '\n' + byGroup[g].join('\n')).join('\n')
  const tools = DOMAINS.map(d => `- ${d.label} (${d.tools.length} tools): ${d.blurb}`).join('\n')
  _cache = 'THE APP (Lighthouse) — you know every page. Lighthouse is organized as Today plus seven '
    + 'desks — Operations, Guest Experience, Reviews, Listings, Owners, Team, KPIs — and Admin behind '
    + 'a gear; a desk\'s pages run across the top of each page. When someone asks where to do '
    + 'something, name the desk and the page (and the Settings panel if it is a setting). Admin → '
    + 'People & settings (/users) holds Settings: task automation, front-desk notices, Slack rules, approval limits, review '
    + 'voice, share links, staffing, PAR levels, Guesty custom fields, Salato front-desk units — and '
    + 'your own memory/voice/direction under "Eve".\n'
    + pages
    + '\n\nYOUR TOOL DOMAINS — open a domain to gain its tools for the rest of the conversation:\n'
    + tools
  return _cache
}
