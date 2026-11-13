// THE DESKS — the one map of the app (Jon, 2026-09-29).
//
// "Break it down into simple tabs… data need to all connect and pull from one centralized truth
// source." Then: "I want this app to be primary ops, guest experience, listing optimization, owner
// reporting and onboarding, review management, team management and operational KPI management",
// built so the team sees the work and Eve can learn it and, in time, run it.
//
// So the app is Today, Eve, and seven desks, one per job, plus an Admin desk behind a gear. Each desk
// owns its pages ("views"). The sidebar lists every page under its desk's heading (2026-09-30: no
// strip across the top — "pages are buried"), the roles grid groups permissions by desk, the Jump box searches views, and Eve's
// map of the app reads the same list. Nothing else keeps its own copy of the nav.
//
// Rules that keep this honest (lib/__tests__/desks.test.mjs enforces them on every test run):
//   - Every feature path in lib/features.ts belongs to exactly one desk (a view, a `match` of a
//     view, or an `also` path), and its `group` there is that desk's label.
//   - No path belongs to two desks.
//   - A view is drawn only if the person can open it; a desk shows only if one of its views does.
//
// Permissions do NOT live here. Who may open a page is still the feature key and its level
// (lib/features.ts, enforced by middleware and every API route). Moving a view between desks
// changes where it is found, never who can open it.
//
// No JSX and no imports, so plain-node tests and the build census can read it. Icons are chosen
// in components/Shell.tsx by desk key.

export type DeskView = {
  to: string
  label: string
  /** Hover text for the tab: what you do there, in a line. */
  hint: string
  /** Secondary: rarely opened (usage audit 2026-11-09) — behind the desk's "+N more" line in the sidebar.
   *  Still in Jump (⌘K), and always shown while you are on it. */
  more?: boolean
  /** Other paths that light this tab up (sub-pages, old URLs, redirects). */
  match?: string[]
}

export type Desk = {
  key: string
  label: string
  /** One line for the sidebar hover and the Jump box. */
  blurb: string
  views: DeskView[]
  /** Paths that belong to the desk without a tab of their own (parked or redirect pages). */
  also?: string[]
}

export const DESKS: Desk[] = [
  {
    key: 'today', label: 'Today',
    blurb: 'The day on one page: what to decide, fix and clear across every desk, and what is yours.',
    views: [
      { to: '/command', label: 'Today', hint: 'The day on one page: decide, fix, clear, and what is yours' },
      { to: '/messages', label: 'Messages', hint: 'Internal — what teammates said to you: tags, replies, assignments, alerts — open until you deal with it' },
    ],
  },
  {
    // Eve is her own tab (Jon, 2026-09-30: "I think Eve should be its own individual tab").
    key: 'eve', label: 'Eve',
    blurb: 'What Eve needs from a person, the loops she is keeping tabs on, her questions and expectation notes.',
    views: [
      { to: '/eve', label: 'Eve', hint: 'What Eve needs from a person, her open loops, questions and expectation notes', match: ['/loops'] },
    ],
  },
  {
    key: 'operations', label: 'Operations',
    blurb: 'The field: today’s board, the cleaning schedule, Open & Close, maintenance and the Leadership board.',
    views: [
      { to: '/plan', label: 'Today board', hint: 'Every unit’s work today against the 4pm deadline; assign and add tasks' },
      // Upkeep (Jon, 2026-10-03): the recurring programs — PM, deep cleans, A/C filters and coils, batteries, inspections, FF&E — late / due soon / on track, per unit.
      { to: '/upkeep', label: 'Upkeep', hint: 'PM audits, deep cleans, A/C filters & coils, batteries, inspections, FF&E — what is late, due soon and on track, per unit' },
      { to: '/schedule', label: 'Schedule', hint: 'Turnovers by day: stage, assign and push to Breezeway' },
      // Scheduling sits together (Jon, 2026-09-30: "Scheduler — all the scheduling features").
      { to: '/team', label: 'Week plan', hint: 'Who works which day, by trade and market, with the 14-day forecast', more: true },
      // Open & Close (Jon, 2026-10-19): the opening and closing roadmap — gates with their real rows, carry-over, handover, print sheet.
      { to: '/checklist', label: 'Open & Close', hint: 'Opening and closing roadmap: who is in, every clean has a person, extensions, arrivals, glitches — sign off, carry to tomorrow, print', more: true },
      { to: '/maintenance', label: 'Maintenance', hint: 'Work orders, open Breezeway maintenance and glitches in one aged list', match: ['/requests'] },
      { to: '/leadership', label: 'Leadership', hint: 'Everyone’s work on one screen — projects, tasks, vendor follow-ups, misc; filter by owner, property, due; meeting notes become tasks you approve one by one', match: ['/projects'] },
      { to: '/blocked', label: 'Blocked units', hint: 'Units off the calendar right now, longest first, with the block note', more: true },
    ],
  },
  {
    key: 'guests', label: 'Guest Experience',
    blurb: 'Every guest touch: the inbox, calls, glitches, claims, lost & found, reservations, guest orders and guidebooks.',
    views: [
      { to: '/inbox', label: 'Inbox', hint: 'Guest inbox — Guesty and Talkroute threads, who is waiting on a reply, and sentiment' },
      { to: '/welcome-calls', label: 'Calls', hint: 'Calls owed today: welcome, recovery and post-checkout' },
      { to: '/glitches', label: 'Glitches', hint: 'Guest-reported problems: fix, refund advice, vendor, history and patterns', match: ['/refunds'] },
      { to: '/claims', label: 'Claims', hint: 'Damage claims with the filing countdown per channel' },
      { to: '/lost-found', label: 'Lost & Found', hint: 'Items found in units, read from the lost-and-found Slack channel: attach the stay, contact the guest, ship or close' },
      { to: '/reservations', label: 'Reservations', hint: 'Arriving, departing, in-house and upcoming bookings' },
      { to: '/guest-orders', label: 'Guest orders', hint: 'Pre-arrival orders, links, catalog, stock and coupons', more: true },
      { to: '/guidebooks', label: 'Guidebooks', hint: 'Guest guidebooks by building: build, fix and push to Guesty' },
      // Parking (Jon, 2026-10-26): the lots we sell and enforce ourselves — Eden first.
      { to: '/lots', label: 'Parking', hint: 'Our lots: the calendar of spots, who is parked where, the staff link, and the cars that should not be there' },
      { to: '/reservation-emails', label: 'Front-desk notices', hint: 'Arrival notices for buildings with a front desk', more: true },
      { to: '/faq', label: 'Property FAQ', hint: 'Per-unit knowledge: facts, FAQs, how-tos and key details', more: true },
    ],
    // /front-desk lost its tab (Jon, 2026-10-02: "it feels like a double") — its arrival cards live on
    // Today now; the page still answers for the link from that lane.
    also: ['/salato', '/front-desk'],
  },
  {
    key: 'reviews', label: 'Reviews',
    blurb: 'Review management: the reply queue, units and buildings that need attention, and the fixes reviews ask for.',
    views: [
      { to: '/reviews', label: 'Reviews', hint: 'Reply, see failing units and buildings, and the jobs feedback created' },
    ],
  },
  {
    key: 'listings', label: 'Listings',
    blurb: 'Listing optimization: properties and units, health and fix-next, copy, and channels.',
    views: [
      { to: '/buildings', label: 'Properties', hint: 'Buildings and units: health, fix next, copy and photos; unit pages open from here', match: ['/listings', '/optimize', '/health'] },
      { to: '/buildings/map', label: 'Map', hint: 'Every property on a real map: buildings, their units, and the homes being onboarded' },
      { to: '/channels', label: 'Channels', hint: 'Which listing is live on which channel, and what broke' },
    ],
  },
  {
    // SALES & MARKETING (Jon, 2026-11-11: "move Ad Studio to the sales and marketing section"). One
    // section for winning owners and filling the calendar: sales decks and the projections library,
    // Ad Studio, the direct-booking numbers, the guest email list, guest profiles and the photo library.
    // (Marketing was its own section from 2026-11-10; Sales from 2026-11-11.)
    key: 'sales', label: 'Sales & Marketing',
    blurb: 'Sales decks and building packages, the projections library, Ad Studio, direct bookings, the guest email list, guest profiles and the photo library.',
    views: [
      { to: '/sales', label: 'Sales decks', hint: 'Proposals and building packages: floor-plan rental comparisons, comps, the agent partner program; keynote and magazine from one link' },
      // OWNER ONBOARDING (Jon, 2026-11-12: "the owner onboarding link should be under sales, post signature").
      { to: '/owner-onboarding', label: 'Owner onboarding', hint: 'After the agreement is signed: the owner’s link and intro email, then their home, supplies, W-9 and ACH, the timeline and the handoff to accounting' },
      { to: '/sales/projections', label: 'Projections library', hint: 'Every building’s floor plans and rental projections, edited in one place; new decks start from them' },
      { to: '/ads', label: 'Ad Studio', hint: 'Video ads: write from a brief, edit scenes on a timeline, add the voice and music, export for any platform' },
      { to: '/marketing', label: 'Direct bookings', hint: 'Direct bookings by the date they were made, vs the period before and last year; the partner share link' },
      { to: '/photos', label: 'Photos', hint: 'The photo library: every property and unit photo, full size — view, pick, download as a ZIP' },
      { to: '/contacts', label: 'Email list', hint: 'Past guests as a mailing list: filters, export, Mailchimp', more: true },
      { to: '/guests', label: 'Guests', hint: 'Guest directory and profiles (VIP, tags, notes)', more: true },
    ],
  },
  {
    key: 'owners', label: 'Owners',
    blurb: 'Owner onboarding and inventory, linens, quality walks, purchasing, owner reports and projections.',
    views: [
      { to: '/onboarding', match: ['/onboarding/quick'], label: 'Onboarding', hint: 'New-unit inventory links: rooms, counts, photos and the buy list' },
      { to: '/onboarding/linens', label: 'Linens', hint: 'Your linen standard, and the linen order for any set of units' },
      { to: '/audits', label: 'Quality', hint: 'Unit walks and what they found, dispatched to Breezeway', more: true },
      { to: '/orders', label: 'Purchasing', hint: 'Buying desk: approve, buy, receive and install', more: true },
      // Catalog (Jon, 2026-10-27): the default onboarding catalog and one per property — approved replacement lists with links.
      { to: '/catalogs', match: ['/catalog'], label: 'Catalog', hint: 'Approved furniture and amenity catalogs per property, with the links to buy from; build one from a listing’s photos', more: true },
      { to: '/reports', label: 'Owner reports', hint: 'Owner reviews, projections and onboarding decks (sales decks are on the Sales tab)' },
      { to: '/projections', label: 'Projections', hint: 'Next season’s owner revenue model behind the projection decks', more: true },
    ],
    also: ['/ffe'],
  },
  {
    key: 'team', label: 'Team',
    blurb: 'Team management: hours and labor, each cleaner’s record, training and the inspection scoreboard.',
    views: [
      { to: '/labor', label: 'Labor', hint: 'Payroll against cleans: cost per clean, people, days and the dashboard' },
      { to: '/cleaners', label: 'Cleaners', hint: 'Each cleaner’s last 90 days: pace, same-day rate and quality', more: true },
      // Training (Jon, 2026-10-26): how-to videos and FAQs, English and Spanish, assigned to people.
      { to: '/training', label: 'Training', hint: 'How-to videos and FAQs for the team, in English and Spanish — assign them, see who finished', more: true },
      // Team scoreboard (Jon, 2026-11-06: "a scoreboard for our team, a way to organize the feedback, read
      // the inspection and be able to share the inspection reports with the girls"). Gated by training.
      { to: '/training/scoreboard', label: 'Scoreboard', hint: 'Housekeepers ranked by inspection score, reports to send every 5 inspections, feedback to follow up, every inspection to read', match: ['/scoreboard'] },
    ],
  },
  {
    // THE MONEY PAGES TOGETHER (Jon, 2026-09-30: "owner statement audits are kind of like financials
    // or billables, so making sure that it's just clear and visible").
    key: 'kpis', label: 'Financials',
    blurb: 'The money pages: owner statements, billable hours, revenue, direct bookings and the Revenue App.',
    views: [
      { to: '/owner-audit', label: 'Statement review', hint: 'Owner statements checked against bookings — review, approve, sign off' },
      { to: '/billing', label: 'Billable hours', hint: 'Owner billables: ops review, then final review, then export' },
      { to: '/clean-invoices', label: 'Cleaning invoices', hint: 'Upload a vendor cleaning invoice — every line checked against the cleans on record, mismatches flagged before it is paid' },
      { to: '/revenue/sales', label: 'Sales', hint: 'Booked today, this week and this month vs last year; channel mix; units behind pace; cancellations' },
      { to: '/revenue', label: 'Revenue', hint: 'Revenue, occupancy, ADR and RevPAR by building and unit, with the checks behind them', more: true },
      { to: '/revenue-app', label: 'Revenue App', hint: 'The Revenue App, where budgets and forecasting live', more: true },
    ],
    // The KPI board stays parked (Jon, 2026-09-09: "hide that for now") until it is rebuilt on the
    // shared numbers; it still belongs here.
    also: ['/kpi'],
  },
  {
    key: 'admin', label: 'Admin',
    blurb: 'The admin desk — listings, channels, reviews, photos and blocks that need an administrator — plus people and roles, settings, system health, share links, the vault and API keys.',
    views: [
      // The administrator's working page comes first (Jon, 2026-10-26: "a full admin dashboard page
      // that directs our administrator").
      { to: '/admin', label: 'Admin desk', hint: 'What needs an administrator today: listings not for sale or not connected, reply owed, optimization and photo work, blocked units — and the review report' },
      { to: '/brain', label: 'Business brain', hint: 'Which apartments need a decision, what keeps failing, owners, and data gaps', more: true },
      { to: '/users', label: 'Users & admin', hint: 'People, roles and every setting' },
      { to: '/system-health', label: 'Health', hint: 'Is everything working: syncs, feeds and the daily self-audit', more: true },
      { to: '/links', label: 'Share links', hint: 'Every share link and passcode in one list', more: true },
      { to: '/vault', label: 'Vault', hint: 'Credentials and paperwork, revealed after unlock', more: true },
      { to: '/api-keys', label: 'API keys', hint: 'Your personal read-only keys for the API', more: true },
    ],
    also: ['/integrations', '/settings/labor', '/stay-window'],
  },
]

function covers(path: string, p: string): boolean {
  return path === p || path.startsWith(p + '/')
}

/**
 * The desk and view a path belongs to. The longest matching path wins, so /onboarding/linens can be
 * its own view without /onboarding swallowing it, and /labor/dashboard stays on the Labor tab.
 * `view` is null for an `also` path (the desk owns it, no tab lights up).
 */
export function deskForPath(path: string | null | undefined): { desk: Desk; view: DeskView | null } | null {
  const p = String(path || '')
  if (!p) return null
  let best: { desk: Desk; view: DeskView | null; len: number } | null = null
  for (const desk of DESKS) {
    for (const view of desk.views) {
      for (const m of [view.to].concat(view.match || [])) {
        if (covers(p, m) && (!best || m.length > best.len)) best = { desk, view, len: m.length }
      }
    }
    for (const a of desk.also || []) {
      if (covers(p, a) && (!best || a.length > best.len)) best = { desk, view: null, len: a.length }
    }
  }
  return best ? { desk: best.desk, view: best.view } : null
}

/** Every path a desk claims, for the tests and the build census. */
export function deskPaths(desk: Desk): string[] {
  const out: string[] = []
  for (const v of desk.views) { out.push(v.to); for (const m of v.match || []) out.push(m) }
  for (const a of desk.also || []) out.push(a)
  return out
}
