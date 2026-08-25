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

export const TAB_SETS: TabSet[] = [
  {
    key: 'quality', label: 'Quality',
    blurb: 'Every walk of a unit in one place — annual/spot audits, pre-arrival inspections, and the FF&E furniture audit.',
    tabs: [
      { to: '/audits', label: 'Audits' },
      { to: '/inspections', label: 'Inspections' },
      { to: '/ffe', label: 'FF&E' },
    ],
  },
  {
    key: 'orders', label: 'Orders',
    // Guest Orders left on 2026-08-25 (Jon: "Guest orders stand alone"). Everything else here is
    // US spending money on a unit; a guest order is a GUEST spending money on their own stay. It
    // reads as the same word and is a different business, so it sits with Guests now.
    // Jon, same day: "orders can be one but can filter" — Purchasing already filters by stage,
    // owner and building on the page itself, so these three stay behind one sidebar row.
    blurb: 'What needs buying, fixing or building — purchasing from audits, field work orders, and building projects.',
    tabs: [
      { to: '/orders', label: 'Purchasing' },
      { to: '/requests', label: 'Work Orders' },
      { to: '/projects', label: 'Projects' },
    ],
  },
  // GUEST COMMS IS GONE (Jon, 2026-08-25: "just make it easier, if it does not make sense then
  // move"). Guidebooks left it first, and what remained was a row called something you could not
  // click, standing in front of two pages that are not the same job: Front-Desk Notices is a daily
  // send, Property FAQ is reference material Eve reads. A label that names none of its contents is
  // the thing that makes a sidebar hard to learn. Both are their own rows now.
  // THE OWNERS SET IS RETIRED (Jon, 2026-08-25: "remove the projections tab, in the owner reports
  // it should have a projection builder"). Projections stopped being somewhere you GO: the numbers
  // belong to the report you are building, so the builder lives inside Owner Reports and the model
  // editor is reached from there. Owner Statement Audit had already left on the same grounds, and
  // a set of one is just a row wearing a costume — so /reports is a plain row again.
  //
  // /projections keeps its route, its API and its role gate. It is the model editor behind the
  // builder, not dead code, and it is where the deeper work lands when Eric's app connects.
  // THE TEAM SET IS RETIRED (Jon, 2026-08-25: "just make it easier"). A section titled Team,
  // holding one row titled Team, holding three pages, was three levels of chrome for three pages —
  // and the row's label taught you nothing the section had not already said. Weekly Planner,
  // Cleaners and Labor are their own rows now. Nothing else about them moved.
]

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
