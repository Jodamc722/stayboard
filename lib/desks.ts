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
  /** Secondary: listed under "More" on the strip instead of inline. */
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
    blurb: 'The field: today’s board, the cleaning schedule, the daily checklist, maintenance and projects.',
    views: [
      { to: '/plan', label: 'Today board', hint: 'Every unit’s work today against the 4pm deadline; assign and add tasks' },
      // Upkeep (Jon, 2026-10-03): the recurring programs — PM, deep cleans, A/C filters and coils, batteries, inspections, FF&E — late / due soon / on track, per unit.
      { to: '/upkeep', label: 'Upkeep', hint: 'PM audits, deep cleans, A/C filters & coils, batteries, inspections, FF&E — what is late, due soon and on track, per unit' },
      { to: '/schedule', label: 'Schedule', hint: 'Turnovers by day: stage, assign and push to Breezeway' },
      // Scheduling sits together (Jon, 2026-09-30: "Scheduler — all the scheduling features").
      { to: '/team', label: 'Week plan', hint: 'Who works which day, by trade and market, with the 14-day forecast' },
      { to: '/checklist', label: 'Checklist', hint: 'The standing daily list, ticked by whoever does it' },
      { to: '/maintenance', label: 'Maintenance', hint: 'Work orders, open Breezeway maintenance and glitches in one aged list', match: ['/requests'] },
      { to: '/projects', label: 'Projects', hint: 'Work that is bigger than a task: renovations, rollouts, building onboarding', match: ['/projects/plan'] },
      { to: '/blocked', label: 'Blocked units', hint: 'Units off the calendar right now, longest first, with the block note', more: true },
    ],
  },
  {
    key: 'guests', label: 'Guest Experience',
    blurb: 'Every guest touch: the inbox, calls, glitches, claims, reservations, guest orders and guidebooks.',
    views: [
      { to: '/messages', label: 'Inbox', hint: 'Guesty and Talkroute threads, who is waiting on a reply, and sentiment' },
      { to: '/welcome-calls', label: 'Calls', hint: 'Calls owed today: welcome, recovery and post-checkout' },
      { to: '/glitches', label: 'Glitches', hint: 'Guest-reported problems: fix, refund advice, vendor, history and patterns', match: ['/refunds'] },
      { to: '/claims', label: 'Claims', hint: 'Damage claims with the filing countdown per channel' },
      { to: '/reservations', label: 'Reservations', hint: 'Arriving, departing, in-house and upcoming bookings' },
      { to: '/guest-orders', label: 'Guest orders', hint: 'Pre-arrival orders, links, catalog, stock and coupons' },
      { to: '/guidebooks', label: 'Guidebooks', hint: 'Guest guidebooks by building: build, fix and push to Guesty' },
      { to: '/reservation-emails', label: 'Front-desk notices', hint: 'Arrival notices for buildings with a front desk', more: true },
      { to: '/faq', label: 'Property FAQ', hint: 'Per-unit knowledge: facts, FAQs, how-tos and key details', more: true },
      { to: '/guests', label: 'Guests', hint: 'Guest directory and profiles (VIP, tags, notes)', more: true },
      { to: '/contacts', label: 'Contacts', hint: 'The guest list as a mailing list: filters, export, Mailchimp', more: true },
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
    blurb: 'Listing optimization: properties and units, health and fix-next, photos and copy, and channels.',
    views: [
      { to: '/buildings', label: 'Properties', hint: 'Buildings and units: health, fix next, copy and photos; unit pages open from here', match: ['/listings', '/optimize', '/health'] },
      { to: '/channels', label: 'Channels', hint: 'Which listing is live on which channel, and what broke' },
    ],
  },
  {
    key: 'owners', label: 'Owners',
    blurb: 'Owner onboarding and inventory, linens, quality walks, purchasing and owner reports.',
    views: [
      { to: '/onboarding', match: ['/onboarding/quick'], label: 'Onboarding', hint: 'New-unit inventory links: rooms, counts, photos and the buy list' },
      { to: '/onboarding/linens', label: 'Linens', hint: 'Your linen standard, and the linen order for any set of units' },
      { to: '/audits', label: 'Quality', hint: 'Unit walks and what they found, dispatched to Breezeway' },
      { to: '/orders', label: 'Purchasing', hint: 'Buying desk: approve, buy, receive and install' },
      { to: '/reports', label: 'Owner reports', hint: 'Owner reviews, projections and onboarding decks' },
      { to: '/projections', label: 'Projections', hint: 'Next season’s owner revenue model behind the projection decks', more: true },
    ],
    also: ['/ffe'],
  },
  {
    key: 'team', label: 'Team',
    blurb: 'Team management: hours and labor, and each cleaner’s record.',
    views: [
      { to: '/labor', label: 'Labor', hint: 'Payroll against cleans: cost per clean, people, days and the dashboard' },
      { to: '/cleaners', label: 'Cleaners', hint: 'Each cleaner’s last 90 days: pace, same-day rate and quality' },
    ],
  },
  {
    // THE MONEY PAGES TOGETHER (Jon, 2026-09-30: "owner statement audits are kind of like financials
    // or billables, so making sure that it's just clear and visible").
    key: 'kpis', label: 'Financials',
    blurb: 'The money pages: owner statements, billable hours, revenue, direct bookings and the Revenue App.',
    views: [
      { to: '/owner-audit', label: 'Statements', hint: 'Owner statements checked against reservations' },
      { to: '/billing', label: 'Billable hours', hint: 'Owner billables: ops review, then final review, then export' },
      { to: '/revenue', label: 'Revenue', hint: 'Revenue, occupancy, ADR and RevPAR by building and unit, with the checks behind them' },
      { to: '/marketing', label: 'Direct bookings', hint: 'Direct bookings by the date they were made' },
      { to: '/revenue-app', label: 'Revenue App', hint: 'The Revenue App, where budgets and forecasting live' },
    ],
    // The KPI board stays parked (Jon, 2026-09-09: "hide that for now") until it is rebuilt on the
    // shared numbers; it still belongs here.
    also: ['/kpi'],
  },
  {
    key: 'admin', label: 'Admin',
    blurb: 'People and roles, settings, system health, share links, the vault and API keys.',
    views: [
      { to: '/users', label: 'Users & admin', hint: 'People, roles and every setting' },
      { to: '/system-health', label: 'Health', hint: 'Is everything working: syncs, feeds and the daily self-audit' },
      { to: '/links', label: 'Share links', hint: 'Every share link and passcode in one list' },
      { to: '/vault', label: 'Vault', hint: 'Credentials and paperwork, revealed after unlock' },
      { to: '/api-keys', label: 'API keys', hint: 'Your personal read-only keys for the API' },
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
