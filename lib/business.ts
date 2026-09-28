// BUSINESSES — Lighthouse runs more than one company now.
//
// Jon, 2026-09-28: "Have it in the business like a drop down, don't want it a tab… a completely
// different page." So the Garden Hotel is not a row in the VR sidebar: it is a second business
// picked from a dropdown under the logo, with its own sidebar and nothing of the VR portfolio on
// it. Which business you are in is decided by the URL — everything under /garden is the hotel —
// so a link into the hotel lands in the hotel and the back button behaves.
//
// Shared by Shell (the dropdown + which nav to draw). Pure; safe on the client.
import { Hotel, ListChecks, BedDouble, PhoneCall, BarChart3, Plug, Sparkles, CalendarRange, Star, FileText, Settings } from 'lucide-react'

export type BusinessKey = 'vr' | 'garden'
export type Business = { key: BusinessKey; label: string; short: string; landing: string; prefix: string | null }

export const BUSINESSES: Business[] = [
  // The VR portfolio owns every path that is not another business's — prefix null.
  { key: 'vr',     label: 'Stay Hospitality', short: 'Vacation rentals · Guesty', landing: '/command', prefix: null },
  { key: 'garden', label: 'Garden Hotel',     short: 'Hotel · Cloudbeds',        landing: '/garden',  prefix: '/garden' },
]

export function businessForPath(path: string | null | undefined): BusinessKey {
  const p = String(path || '')
  for (const b of BUSINESSES) if (b.prefix && (p === b.prefix || p.startsWith(b.prefix + '/'))) return b.key
  return 'vr'
}
export const businessDef = (key: BusinessKey): Business => BUSINESSES.find(b => b.key === key) || BUSINESSES[0]

/**
 * The hotel's own sidebar, in the same shape as the VR board (Jon: "should look like my current
 * board — user settings, an AI agent"): Overview / Operations / Guests / Money / Settings. One
 * permission key ('garden') covers all of it; Users & admin is appended by Shell for admins.
 */
export const GARDEN_SECTIONS: { title: string; items: { to: string; label: string; Icon: any }[] }[] = [
  { title: 'Overview',   items: [{ to: '/garden',               label: 'Today',                 Icon: ListChecks }] },
  { title: 'Operations', items: [{ to: '/garden/rooms',         label: 'Rooms & cleans',        Icon: BedDouble }, { to: '/garden/schedule', label: 'Scheduler', Icon: CalendarRange }] },
  { title: 'Guests',     items: [{ to: '/garden/calls',         label: 'Calls & verifications', Icon: PhoneCall }, { to: '/garden/reviews', label: 'Reviews', Icon: Star }] },
  { title: 'Money',      items: [{ to: '/garden/reports',       label: 'Reports',               Icon: BarChart3 }, { to: '/garden/owner-reports', label: 'Owner reports', Icon: FileText }] },
  { title: 'Settings',   items: [{ to: '/garden/adam',          label: 'Adam',                  Icon: Sparkles }, { to: '/garden/settings', label: 'Settings', Icon: Settings }, { to: '/garden/setup', label: 'Cloudbeds & feeds', Icon: Plug }] },
]
export const GARDEN_NAV = GARDEN_SECTIONS.flatMap(s => s.items)
export const GARDEN_ICON = Hotel

/** Where the VR side was last, so switching back lands where you were. Device-local, best effort. */
export const LAST_VR_PATH_KEY = 'lh.lastVrPath'
