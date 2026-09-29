// TAB SETS — sidebar model, part 3: WHAT SITS TOGETHER (Jon, 2026-08-24: "we have a lot of audit,
// orders, and different tabs all over the place and we need to make it more organized").
//
// A TAB SET is ONE sidebar entry standing in for several pages that belong together. The pages keep
// their URLs, their feature keys and their per-role levels (lib/features.ts is untouched); the tab
// set only changes how they are reached: one row in the sidebar, and a tab strip at the top of
// every member page that Shell renders automatically — so no member page has to know it is in one.
//
// ── THE NAME ────────────────────────────────────────────────────────────────────────────────────
// This was called a "hub" until 2026-08-25, when Jon pointed out the word was already taken:
// "Hubs are the location of the inventory and for the assigned properties that are in this
// program" — the shelves guest orders are picked from (lib/guest-orders.ts). Two unrelated
// concepts under one word is how a codebase starts lying to the people reading it, so the sidebar
// idea gave the word back. Nothing user-facing changed; "hub" never appeared in the UI.
//
// Rules that keep this honest:
//   - A tab set shows in the sidebar if the person can see AT LEAST ONE of its tabs, and it links
//     to the first tab they can see. Tabs they cannot see are simply not drawn.
//   - The sidebar row is "active" when any tab is active, so the person always knows where they are.
//   - Old pins to a member path still render (Shell maps them to the set's icon and the tab label).
//   - The Jump-to palette lists every tab individually, so nothing becomes unsearchable.
//   - A set must EARN itself: its label has to name the job its pages share. When it stops doing
//     that, the pages go back to their own rows — that is what happened to Guest Comms.
export type TabSetTab = { to: string; label: string }
export type TabSet = { key: string; label: string; blurb: string; tabs: TabSetTab[] }

// MONEY (2026-09-03, the September audit, pass 2). Three sidebar rows — KPI board, Revenue, Direct
// Bookings — were three angles on the same question, and the KPI board had already been demoted
// from the front door. One row now. The routes and gates are untouched on purpose: `home` (the KPI
// board) is granted to every role while `revenue` is owner/admin-only, so a single merged route
// would have had to pick one gate for all three. The set draws only the tabs the person can open
// and links the row to the first of them, which is the KPI board for most people.
export const TAB_SETS: TabSet[] = [
  {
    key: 'money', label: 'Money',
    blurb: 'The business numbers, the revenue detail behind them, and the direct-booking tracker.',
    tabs: [
      // KPI BOARD HIDDEN 2026-09-09 (Jon: "the kpi board, lets hide that for now"). The page and its
      // permission key are untouched — /kpi still opens for anyone who has the URL — it just stops
      // drawing a tab. The row's identity is '/money', not '/kpi', so hiding this one resolves the
      // Money row to Revenue Center instead of making the whole row vanish. Put the line back to
      // bring it home.
      // { to: '/kpi', label: 'KPI board' },
      { to: '/revenue', label: 'Revenue Center' },
      { to: '/marketing', label: 'Direct bookings' },
    ],
  },
]

// RETIRED SETS — Quality and Orders (2026-09-03), Guest Comms, Owners and Team (2026-08-25) — each
// stopped earning its row (rule above). Their definitions and the reasons are in git history.
// /projections keeps its route, API and role gate: it is the model editor behind the report builder.

function covers(path: string, to: string): boolean {
  return path === to || path.startsWith(to + '/')
}

/** The tab set a path belongs to, if any. Longest tab path wins so /orders never captures /orders-live. */
export function tabSetForPath(path: string | null | undefined): { set: TabSet; tab: TabSetTab } | null {
  const p = String(path || '')
  let best: { set: TabSet; tab: TabSetTab } | null = null
  for (const set of TAB_SETS) for (const tab of set.tabs) {
    if (covers(p, tab.to) && (!best || tab.to.length > best.tab.to.length)) best = { set, tab }
  }
  return best
}

export function tabSetByKey(key: string): TabSet | null {
  return TAB_SETS.find(s => s.key === key) || null
}
