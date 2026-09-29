// BUSINESSES — Lighthouse runs more than one company now.
//
// Jon, 2026-09-28: "Have it in the business like a drop down, don't want it a tab… a completely
// different page." So the Garden Hotel is not a row in the VR sidebar: it is a second business
// picked from a dropdown under the logo, with its own sidebar and nothing of the VR portfolio on
// it. Which business you are in is decided by the URL — everything under /garden is the hotel —
// so a link into the hotel lands in the hotel and the back button behaves.
//
// Shared by Shell (the dropdown + which nav to draw). Pure; safe on the client.
import { Hotel, ListChecks, BedDouble, PhoneCall, BarChart3, Plug, Sparkles, CalendarRange, CalendarDays, Star, FileText, Settings, MessageSquare, CreditCard, Users, BookOpen, UserCog } from 'lucide-react'

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

import { GARDEN_PAGE_DEFS, type GardenPageDef } from './garden/pages'
export * from './garden/pages'
const GARDEN_ICONS: Record<string, any> = { today: ListChecks, rooms: BedDouble, schedule: CalendarRange, calls: PhoneCall, messages: MessageSquare, reviews: Star, calendar: CalendarDays, payments: CreditCard, reports: BarChart3, 'owner-reports': FileText, staff: Users, handbook: BookOpen, adam: Sparkles, settings: Settings, setup: Plug, users: UserCog }
export type GardenPage = GardenPageDef & { Icon: any }
export const GARDEN_PAGES: GardenPage[] = GARDEN_PAGE_DEFS.map(d => ({ ...d, Icon: GARDEN_ICONS[d.key] || ListChecks }))
const SECTION_ORDER = ['Overview', 'Operations', 'Guests', 'Money', 'Settings']   // 'Admin' pages live inside Users & admin
export const GARDEN_SECTIONS: { title: string; items: GardenPage[] }[] = SECTION_ORDER.map(title => ({ title, items: GARDEN_PAGES.filter(p => p.section === title) }))

export const GARDEN_NAV = GARDEN_PAGES
export const GARDEN_ICON = Hotel

/** Where the VR side was last, so switching back lands where you were. Device-local, best effort. */
export const LAST_VR_PATH_KEY = 'lh.lastVrPath'
