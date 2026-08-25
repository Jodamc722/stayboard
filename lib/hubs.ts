// HUBS — sidebar model, part 3: WHAT SITS TOGETHER (Jon, 2026-08-24: "we have a lot of audit,
// orders, and different tabs all over the place and we need to make it more organized").
//
// A hub is ONE sidebar entry standing in for several pages that belong together. The pages keep
// their URLs, their feature keys and their per-role levels (lib/features.ts is untouched); the hub
// only changes how they are reached: one row in the sidebar, and a tab strip at the top of every
// member page that Shell renders automatically — so no member page has to know it is in a hub.
//
// Rules that keep this honest:
//   - A hub shows in the sidebar if the person can see AT LEAST ONE of its tabs, and it links to
//     the first tab they can see. Tabs they cannot see are simply not drawn.
//   - The sidebar row is "active" when any tab is active, so the person always knows where they are.
//   - Old pins to a member path still render (Shell maps them to the hub's icon and the tab label).
//   - The Jump-to palette lists every tab individually, so nothing becomes unsearchable.
export type HubTab = { to: string; label: string }
export type Hub = { key: string; label: string; blurb: string; tabs: HubTab[] }

export const HUBS: Hub[] = [
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
    blurb: 'What needs buying, fixing or delivering — purchasing from audits, field work orders, guest pre-arrival orders, and building projects.',
    tabs: [
      { to: '/orders', label: 'Purchasing' },
      { to: '/requests', label: 'Work Orders' },
      { to: '/guest-orders', label: 'Guest Orders' },
      { to: '/projects', label: 'Projects' },
    ],
  },
  {
    key: 'guest-comms', label: 'Guest Comms',
    // Guidebooks left this hub on 2026-08-25 (Jon: "move guidebooks back to an individual tab").
    // It is a thing you go to and work in, not a tab you pass on the way to a notice — and burying
    // it behind another page's URL made it feel gone. It has its own sidebar row again.
    blurb: 'What the guest and the building are told — front-desk notices and the property FAQ Eve answers from.',
    tabs: [
      { to: '/reservation-emails', label: 'Front-Desk Notices' },
      { to: '/faq', label: 'Property FAQ' },
    ],
  },
  {
    key: 'owners', label: 'Owners',
    // Owner Statement Audit left this hub on 2026-08-25 (Jon: "its own standalone tab"). It is
    // the board somebody sits in front of for an hour with Guesty open — not a page you tab past
    // on the way to a report — so it gets its own sidebar row in Money.
    blurb: 'Everything that goes to an owner — monthly reports and next-season projections.',
    tabs: [
      { to: '/reports', label: 'Owner Reports' },
      { to: '/projections', label: 'Projections' },
    ],
  },
  {
    key: 'team', label: 'Team',
    blurb: 'Who is working, who cleans what, and what the hours cost.',
    tabs: [
      { to: '/team', label: 'Weekly Planner' },
      { to: '/cleaners', label: 'Cleaners' },
      { to: '/labor', label: 'Labor' },
    ],
  },
]

function covers(path: string, to: string): boolean {
  return path === to || path.startsWith(to + '/')
}

/** The hub a path belongs to, if any. Longest tab path wins so /orders never captures /orders-live. */
export function hubForPath(path: string | null | undefined): { hub: Hub; tab: HubTab } | null {
  const p = String(path || '')
  let best: { hub: Hub; tab: HubTab } | null = null
  for (const hub of HUBS) for (const tab of hub.tabs) {
    if (covers(p, tab.to) && (!best || tab.to.length > best.tab.to.length)) best = { hub, tab }
  }
  return best
}

export function hubByKey(key: string): Hub | null {
  return HUBS.find(h => h.key === key) || null
}
