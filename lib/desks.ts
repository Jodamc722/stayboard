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
//
// 2026-11-20: the seven desks became five headings (Operations, Guests, Properties, Owners & sales,
// Money & team) with Today and Eve above them and Settings behind the gear. The rules above did not
// change; what changed is that a view is now either a sidebar row or `jump: true` (see DeskView).

export type DeskView = {
  to: string
  label: string
  /** Hover text for the tab: what you do there, in a line. */
  hint: string
  /** Off the sidebar (2026-11-20): reachable by Jump (⌘K), by links and by its URL, with the same
   *  permissions as before, but not drawn as a row. A row is either in the menu or it is not: this
   *  replaced `more` (the "+N more" line of 2026-11-09), which folded rows instead of deciding. */
  jump?: boolean
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

// 2026-11-20 (Jon: "get rid of tabs that we do not use… think a professional webapp")
//
// From the full app audit: "We need a full audit of the app, want to clean it up, get rid of tabs that
// we do not use, consolidate them or rebuild them", "organized and easy to use". The sidebar had grown
// to 58 rows in 11 groups, 21 of them behind "+N more". PHASE 1 (this change) regroups, relabels and
// hides; it merges no page, changes no route, adds no redirect and touches no permission.
//   - The menu is Today and Eve, five headings with 28 rows between them, and Settings behind the gear:
//     31 rows, every one of them always visible. No "+N more", nothing folded (Jon, 2026-09-30: "hate
//     the drop downs", "pages are buried").
//   - The other 27 pages are `jump: true`: off the sidebar, still in Jump (⌘K), still at their URL,
//     still gated by the same feature key. The 30-day usage read behind the choice: nobody on the team
//     opened /links, /sales/projections, /catalogs, /guests, /contacts, /marketing, /revenue-app,
//     /projections, /brain, /orders, /system-health, /training, /guest-orders, /front-desk, /revenue,
//     /cleaners or /audits. To put a page back on the menu, delete its `jump: true`.
//   - Week plan, Open & Close, Blocked units and Lost & Found stay as rows of their own: Jon asked for
//     each by name, and merging them is a decision he has not made.
//   - A row is called what the person looks for: /plan is "Ops board" (it said "Today board" beside a
//     page called Today), Reviews sits with Guests, the listing administrator's page (/admin) and
//     new-unit setup (/onboarding) sit with Properties, Labor is the Team row beside the money pages.
export const DESKS: Desk[] = [
  {
    key: 'today', label: 'Today',
    blurb: 'The day on one page: what to decide, fix and clear across every desk, and what is yours.',
    views: [
      { to: '/command', label: 'Today', hint: 'The day on one page: decide, fix, clear, and what is yours' },
      // Messages was never a row of its own up here: it is the Messages line with its badge at the foot of the sidebar.
      { to: '/messages', label: 'Messages', hint: 'Internal — what teammates said to you: tags, replies, assignments, alerts — open until you deal with it', jump: true },
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
    blurb: 'The field: the ops board, the cleaning schedule and week plan, Open & Close, maintenance, blocked units, upkeep and Tasks & Projects.',
    views: [
      { to: '/plan', label: 'Ops board', hint: 'Every unit’s work today against the 4pm deadline; assign and add tasks' },
      { to: '/schedule', label: 'Schedule', hint: 'Turnovers by day: stage, assign and push to Breezeway' },
      // Scheduling sits together (Jon, 2026-09-30: "Scheduler — all the scheduling features").
      { to: '/team', label: 'Week plan', hint: 'Who works which day, by trade and market, with the 14-day forecast' },
      // Open & Close (Jon, 2026-10-19): the opening and closing roadmap — gates with their real rows, carry-over, handover, print sheet.
      // Briefs (Jon, 2026-11-25: "Need market plans… This should be in ops" · "We should have a briefs page").
      { to: '/briefs', label: 'Briefs', hint: 'The morning plan for Ops, Broward, Miami, North and Customer Care: top priorities, the schedule, arrivals, VIPs, cleans, cleans not assigned, glitches, claims. Add a note or change it before it goes out' },
      { to: '/checklist', label: 'Open & Close', hint: 'Opening and closing roadmap: who is in, every clean has a person, extensions, arrivals, glitches — sign off, carry to tomorrow, print' },
      { to: '/maintenance', label: 'Maintenance', hint: 'Work orders, open Breezeway maintenance and glitches in one aged list', match: ['/requests'] },
      { to: '/blocked', label: 'Blocked units', hint: 'Units off the calendar right now, longest first, with the block note' },
      // Upkeep (Jon, 2026-10-03): the recurring programs — PM, deep cleans, A/C filters and coils, batteries, inspections, FF&E — late / due soon / on track, per unit.
      { to: '/upkeep', label: 'Upkeep', hint: 'PM audits, deep cleans, A/C filters & coils, batteries, inspections, FF&E — what is late, due soon and on track, per unit' },
      // Renamed and rebuilt 2026-11-25 (Jon: "revamp that… let's rename it too"): it was "Leadership" at /leadership.
      { to: '/tasks', label: 'Tasks & Projects', hint: 'Tasks, projects, vendors and future projects, plus the listings that are offline; who, when and how urgent; group by due date, person or property', match: ['/projects', '/leadership'] },
      { to: '/audits', label: 'Quality', hint: 'Unit walks and what they found, dispatched to Breezeway', jump: true },
    ],
  },
  {
    key: 'guests', label: 'Guests',
    blurb: 'Every guest touch: the inbox, calls, reservations, glitches, claims, lost & found, reviews and parking.',
    views: [
      { to: '/inbox', label: 'Inbox', hint: 'Guest inbox — Guesty and Talkroute threads, who is waiting on a reply, and sentiment' },
      { to: '/welcome-calls', label: 'Calls', hint: 'Calls owed today: welcome, recovery and post-checkout' },
      { to: '/reservations', label: 'Reservations', hint: 'Arriving, departing, in-house and upcoming bookings' },
      { to: '/glitches', label: 'Glitches', hint: 'Guest-reported problems: fix, refund advice, vendor, history and patterns', match: ['/refunds'] },
      { to: '/claims', label: 'Claims', hint: 'Damage claims with the filing countdown per channel' },
      { to: '/lost-found', label: 'Lost & Found', hint: 'Items found in units, read from the lost-and-found Slack channel: attach the stay, contact the guest, ship or close' },
      { to: '/reviews', label: 'Reviews', hint: 'Reply, see failing units and buildings, and the jobs feedback created' },
      // Parking (Jon, 2026-10-26): the lots we sell and enforce ourselves — Eden first.
      { to: '/lots', label: 'Parking', hint: 'Our lots: the calendar of spots, who is parked where, the staff link, and the cars that should not be there' },
      // Kept on the menu (2026-11-20): 12 team opens by 3 people in 30 days. Used, so not hidden.
      { to: '/reservation-emails', label: 'Front-desk notices', hint: 'Arrival notices for buildings with a front desk' },
      { to: '/faq', label: 'Property FAQ', hint: 'Per-unit knowledge: facts, FAQs, how-tos and key details', jump: true },
      { to: '/guest-orders', label: 'Guest orders', hint: 'Pre-arrival orders, links, catalog, stock and coupons', jump: true },
      { to: '/guests', label: 'Guests', hint: 'Guest directory and profiles (VIP, tags, notes)', jump: true },
      { to: '/contacts', label: 'Email list', hint: 'Past guests as a mailing list: filters, export, Mailchimp', jump: true },
    ],
    // /front-desk lost its tab (Jon, 2026-10-02: "it feels like a double") — its arrival cards live on
    // Today now; the page still answers for the link from that lane.
    also: ['/salato', '/front-desk'],
  },
  {
    key: 'properties', label: 'Properties',
    blurb: 'The buildings and units: health and fix-next, copy and photos, guidebooks, the listing administrator’s desk and new-unit setup.',
    views: [
      { to: '/buildings', label: 'Properties', hint: 'Buildings and units: health, fix next, copy and photos; unit pages open from here', match: ['/listings', '/optimize', '/health'] },
      { to: '/guidebooks', label: 'Guidebooks', hint: 'Guest guidebooks by building: build, fix and push to Guesty' },
      // The administrator's working page (Jon, 2026-10-26: "a full admin dashboard page that directs our
      // administrator"). It is listing work, so it is a Properties row; Settings is the gear.
      { to: '/admin', label: 'Listing desk', hint: 'What needs an administrator today: listings not for sale or not connected, reply owed, optimization and photo work, blocked units — and the review report' },
      { to: '/onboarding', match: ['/onboarding/quick'], label: 'Unit setup', hint: 'New-unit inventory links: rooms, counts, photos and the buy list' },
      // Back on the menu the same morning (Jon, 2026-11-20: "map can't find… should be in properties").
      { to: '/buildings/map', label: 'Map', hint: 'Every property on a real map: buildings, their units, and the homes being onboarded' },
      { to: '/channels', label: 'Channels', hint: 'Which listing is live on which channel, and what broke', jump: true },
      { to: '/photos', label: 'Photos', hint: 'The photo library: every property and unit photo, full size — view, pick, download as a ZIP', jump: true },
      // Kept on the menu (2026-11-20): Jon asked for Linens as a tab for Roberto (2026-11-05) and it is in use.
      { to: '/onboarding/linens', label: 'Linens', hint: 'Your linen standard, and the linen order for any set of units' },
      // Catalog (Jon, 2026-10-27): the default onboarding catalog and one per property — approved replacement lists with links.
      { to: '/catalogs', match: ['/catalog'], label: 'Catalog', hint: 'Approved furniture and amenity catalogs per property, with the links to buy from; build one from a listing’s photos', jump: true },
      { to: '/orders', label: 'Purchasing', hint: 'Buying desk: approve, buy, receive and install', jump: true },
    ],
    also: ['/ffe'],
  },
  {
    // SALES & MARKETING (Jon, 2026-11-11: "move Ad Studio to the sales and marketing section"). One
    // section for winning owners and filling the calendar: sales decks and the projections library,
    // Ad Studio, the direct-booking numbers, the guest email list, guest profiles and the photo library.
    // (Marketing was its own section from 2026-11-10; Sales from 2026-11-11.)
    // 2026-11-20: Owner reports joined it and the heading became "Owners & sales": winning an owner,
    // onboarding them and reporting to them, in that order.
    key: 'owners', label: 'Owners & sales',
    blurb: 'Winning owners and keeping them: sales decks and building packages, owner onboarding, owner reports and Ad Studio.',
    views: [
      { to: '/sales', label: 'Sales', hint: 'Proposals and building packages: floor-plan rental comparisons, comps, the agent partner program; keynote and magazine from one link' },
      // ONBOARDING COST (Jon, 2026-11-20: "build a cheat sheet for average onboarding cost… this is for sales… build it in app").
      { to: '/sales/onboarding-cost', label: 'Onboarding cost', hint: 'What a new unit costs to get guest-ready: linen at par, the onboarding clean and inventory, from the unit’s beds, kitchen and appliances' },
      // OWNER ONBOARDING (Jon, 2026-11-12: "the owner onboarding link should be under sales, post signature").
      { to: '/owner-onboarding', label: 'Owner onboarding', hint: 'After the agreement is signed: the owner’s link and intro email, then their home, supplies, W-9 and ACH, the timeline and the handoff to accounting' },
      { to: '/reports', label: 'Owner reports', hint: 'Owner reviews, projections and onboarding decks (sales decks are on the Sales tab)' },
      { to: '/ads', label: 'Ad Studio', hint: 'Video ads: write from a brief, edit scenes on a timeline, add the voice and music, export for any platform' },
      { to: '/sales/projections', label: 'Projections library', hint: 'Every building’s floor plans and rental projections, edited in one place; new decks start from them', jump: true },
      { to: '/projections', label: 'Projections', hint: 'Next season’s owner revenue model behind the projection decks', jump: true },
      { to: '/marketing', label: 'Direct bookings', hint: 'Direct bookings by the date they were made, vs the period before and last year; the partner share link', jump: true },
    ],
  },
  {
    // THE MONEY PAGES TOGETHER (Jon, 2026-09-30: "owner statement audits are kind of like financials
    // or billables, so making sure that it's just clear and visible").
    // 2026-11-20: payroll and the people it pays sit beside them, so the heading is "Money & team".
    key: 'money', label: 'Money & team',
    blurb: 'The money pages and the team behind them: owner statements, billable hours, revenue, labor and the team scorecards.',
    views: [
      { to: '/owner-audit', label: 'Statements', hint: 'Owner statements checked against bookings — review, approve, sign off' },
      { to: '/billing', label: 'Billing', hint: 'Owner billables: ops review, then final review, then export' },
      // The Revenue row is the page the team opens: the booked-revenue report at /revenue/sales. The older
      // Revenue Center (/revenue) had no opens in the 30-day read and is in Jump.
      { to: '/revenue/sales', label: 'Revenue', hint: 'Booked today, this week and this month vs last year; channel mix; units behind pace; cancellations' },
      { to: '/labor', label: 'Team', hint: 'Payroll against cleans: cost per clean, people, days and the dashboard' },
      // SCORECARDS (Jon, 2026-11-20: "Everything should have a scorecard for things completed and
      // Leaderboard based on KPI"). A row, not a Jump page: it is the page the morning briefs link to.
      { to: '/scoreboard', label: 'Scorecards', hint: 'What each team completed yesterday and in the last 7 days, and the people ranked on the team KPI: admin, guest support, housekeeping, maintenance, inspections, reviews' },
      { to: '/clean-invoices', label: 'Cleaning invoices', hint: 'Upload a vendor cleaning invoice — every line checked against the cleans on record, mismatches flagged before it is paid', jump: true },
      { to: '/revenue', label: 'Revenue Center', hint: 'Revenue, occupancy, ADR and RevPAR by building and unit, with the checks behind them', jump: true },
      { to: '/revenue-app', label: 'Revenue App', hint: 'The Revenue App, where budgets and forecasting live', jump: true },
      { to: '/cleaners', label: 'Cleaners', hint: 'Each cleaner’s last 90 days: pace, same-day rate and quality', jump: true },
      // Training (Jon, 2026-10-26): how-to videos and FAQs, English and Spanish, assigned to people.
      { to: '/training', label: 'Training', hint: 'How-to videos and FAQs for the team, in English and Spanish — assign them, see who finished', jump: true },
      // Team scoreboard (Jon, 2026-11-06: "a scoreboard for our team, a way to organize the feedback, read
      // the inspection and be able to share the inspection reports with the girls"). Gated by training.
      { to: '/training/scoreboard', label: 'Inspection scoreboard', hint: 'Housekeepers ranked by inspection score, reports to send every 5 inspections, feedback to follow up, every inspection to read', jump: true },
    ],
    // The KPI board stays parked (Jon, 2026-09-09: "hide that for now") until it is rebuilt on the
    // shared numbers; it still belongs here.
    also: ['/kpi'],
  },
  {
    // SETTINGS, BEHIND THE GEAR. The key stays `admin`; the one row is Users & admin (/users), which
    // holds people, roles and every setting. The other admin pages are in Jump.
    key: 'admin', label: 'Settings',
    blurb: 'People and roles and every setting — plus, from Jump, the business brain, system health, share links, the vault and API keys.',
    views: [
      { to: '/users', label: 'Users & admin', hint: 'People, roles and every setting' },
      { to: '/brain', label: 'Business brain', hint: 'Which apartments need a decision, what keeps failing, owners, and data gaps', jump: true },
      { to: '/system-health', label: 'Health', hint: 'Is everything working: syncs, feeds and the daily self-audit', jump: true },
      { to: '/links', label: 'Share links', hint: 'Every share link and passcode in one list', jump: true },
      { to: '/vault', label: 'Vault', hint: 'Credentials and paperwork, revealed after unlock', jump: true },
      { to: '/api-keys', label: 'API keys', hint: 'Your personal read-only keys for the API', jump: true },
    ],
    also: ['/integrations', '/settings/labor', '/stay-window'],
  },
]

/** The rows the sidebar draws for a desk: its views that are not Jump-only. */
export function menuViews(desk: Desk): DeskView[] {
  return desk.views.filter(v => !v.jump)
}

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
