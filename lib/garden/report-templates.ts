// GARDEN HOTEL REPORT TEMPLATES — which sections an owner report carries, in what order, with
// what copy, on which theme. Three ship; every one is editable and new ones can be added.
//
// Jon, 2026-09-28: "Owner reports will be similar to the same format as the other one I've created:
// same styling, same format, same look, same feel, but customized and editable to fit the hotel
// reporting style they prefer. We'll come up with designs, but use a lot of design templates, and
// we'll create the datasets." So a hotel report IS an owner_reports row — the same page
// (/r/<code>), the same themes, editor, share link and PPTX export — built from the hotel's
// datasets (lib/garden/report-datasets) through one of these templates.
//
// SECTIONS map onto what components/ReportView already draws:
//   verdict    the derived "The Month" page          snapshot   the big-number cards
//   listings   by room type (the "by listing" table)  byMonth    month cards (2+ months only)
//   ahead      on the books, next three months        voices     reviews: quotes + themes
//   projects   the work done, by week                 sources    a custom section: channel mix
//   operations a custom section: cleans, calls, verifications
// Cards are picked from CARD_KEYS. Copy is overridable per template. Stored overrides live in
// app_settings garden_report_templates; a template with the same key as a shipped one replaces it.
import 'server-only'
import { getSetting, setSetting } from '../app-settings'

export const TEMPLATES_KEY = 'garden_report_templates'
export type SectionKey = 'verdict' | 'snapshot' | 'listings' | 'byMonth' | 'ahead' | 'voices' | 'projects' | 'sources' | 'operations'
export const SECTIONS: { key: SectionKey; label: string; what: string }[] = [
  { key: 'verdict', label: 'The month', what: 'One page: the headline numbers and what moved, derived from the rest.' },
  { key: 'snapshot', label: 'Snapshot', what: 'The four big numbers you choose below.' },
  { key: 'listings', label: 'By room type', what: 'Occupancy, ADR, RevPAR and revenue per room type.' },
  { key: 'byMonth', label: 'By month', what: 'One card per calendar month (only when the period spans more than one).' },
  { key: 'ahead', label: 'On the books', what: 'The next three months as they stand.' },
  { key: 'voices', label: 'Guest voices', what: 'Review quotes and the themes behind them.' },
  { key: 'projects', label: 'The work', what: 'Cleans, inspections and maintenance by week.' },
  { key: 'sources', label: 'Where guests came from', what: 'Booking channels: arrivals, nights, revenue share.' },
  { key: 'operations', label: 'Front desk & housekeeping', what: 'Welcome calls, calls reached, verifications, cleans done.' },
]
export const CARD_KEYS: { key: string; label: string; what: string }[] = [
  { key: 'occupancy', label: 'Occupancy', what: 'Room-nights sold over rooms × nights.' },
  { key: 'adr', label: 'ADR', what: 'Booked revenue per room-night sold.' },
  { key: 'revpar', label: 'RevPAR', what: 'Booked revenue per available room-night.' },
  { key: 'revenue', label: 'Booked revenue', what: 'As Cloudbeds totals it, prorated to the period.' },
  { key: 'arrivals', label: 'Arrivals', what: 'Bookings that arrived in the period.' },
  { key: 'roomNights', label: 'Room-nights', what: 'Room-nights sold.' },
  { key: 'reviews', label: 'Review average', what: 'Average rating on a 5 scale, with the count.' },
  { key: 'welcome', label: 'Welcome calls', what: 'Completed of due.' },
  { key: 'cleans', label: 'Cleans done', what: 'Departure cleans and stayovers finished.' },
  { key: 'onbooks', label: 'Next month on the books', what: 'Occupancy already booked for the month after the period.' },
]
export type ReportTemplate = {
  key: string; name: string; blurb: string; theme: string; font?: string
  sections: SectionKey[]
  cards: string[]
  copy: { heroEyebrow: string; heroDateLabel: string; preparedFor: string; snapshotHeadline: string; snapshotSubtitle: string; listingsHeadline: string; aheadHeadline: string; voicesHeadline: string; projectsHeadline: string; sourcesHeadline: string; operationsHeadline: string }
  shipped?: boolean
}

export const DEFAULT_TEMPLATES: ReportTemplate[] = [
  {
    key: 'owner-monthly', name: 'Owner monthly', blurb: 'The full month for the owner: the verdict, the numbers, room types, what is on the books, what guests said, and the work done.', theme: 'garden',
    sections: ['verdict', 'snapshot', 'listings', 'sources', 'ahead', 'voices', 'operations', 'projects'],
    cards: ['occupancy', 'adr', 'revpar', 'revenue'],
    copy: { heroEyebrow: 'MONTHLY REVIEW', heroDateLabel: 'OWNER REVIEW', preparedFor: 'Prepared for the owners of {hotel}', snapshotHeadline: 'The month at a glance.', snapshotSubtitle: '{period} · {rooms} rooms · booked revenue as Cloudbeds totals it', listingsHeadline: 'By room type.', aheadHeadline: 'What is already on the books.', voicesHeadline: 'What guests said.', projectsHeadline: 'The work behind the month.', sourcesHeadline: 'Where guests came from.', operationsHeadline: 'The front desk and housekeeping.' },
    shipped: true,
  },
  {
    key: 'board-summary', name: 'Board summary', blurb: 'Two pages: the verdict and four numbers, then the channel mix. For a partner who wants the shape of the month, not the detail.', theme: 'garden',
    sections: ['verdict', 'snapshot', 'sources', 'ahead'],
    cards: ['revenue', 'occupancy', 'adr', 'onbooks'],
    copy: { heroEyebrow: 'SUMMARY', heroDateLabel: 'BOARD SUMMARY', preparedFor: 'Prepared for the partners of {hotel}', snapshotHeadline: 'The month in four numbers.', snapshotSubtitle: '{period} · {rooms} rooms', listingsHeadline: 'By room type.', aheadHeadline: 'On the books.', voicesHeadline: 'What guests said.', projectsHeadline: 'The work.', sourcesHeadline: 'Channel mix.', operationsHeadline: 'Operations.' },
    shipped: true,
  },
  {
    key: 'ops-monthly', name: 'Operations monthly', blurb: 'For the GM: cleans, calls, verifications and reviews first; the money second.', theme: 'garden',
    sections: ['snapshot', 'operations', 'voices', 'projects', 'listings'],
    cards: ['cleans', 'welcome', 'reviews', 'occupancy'],
    copy: { heroEyebrow: 'OPERATIONS', heroDateLabel: 'OPERATIONS REVIEW', preparedFor: 'Prepared for the team at {hotel}', snapshotHeadline: 'How the month ran.', snapshotSubtitle: '{period} · {rooms} rooms', listingsHeadline: 'By room type.', aheadHeadline: 'On the books.', voicesHeadline: 'What guests said.', projectsHeadline: 'What got done, by week.', sourcesHeadline: 'Where guests came from.', operationsHeadline: 'The desk and the floor.' },
    shipped: true,
  },
]

export async function listTemplates(): Promise<ReportTemplate[]> {
  const saved = await getSetting<any>(TEMPLATES_KEY, null).catch(() => null)
  const custom: ReportTemplate[] = Array.isArray(saved?.templates) ? saved.templates : []
  const byKey: Record<string, ReportTemplate> = {}
  for (const t of DEFAULT_TEMPLATES) byKey[t.key] = { ...t, shipped: true }
  for (const t of custom) if (t && t.key) byKey[t.key] = { ...(byKey[t.key] || {}), ...t, shipped: !!byKey[t.key] }
  const hidden: string[] = Array.isArray(saved?.hidden) ? saved.hidden : []
  return Object.values(byKey).filter(t => !hidden.includes(t.key))
}
export async function saveTemplate(t: ReportTemplate, by: string): Promise<void> {
  const saved = await getSetting<any>(TEMPLATES_KEY, null).catch(() => null)
  const custom: ReportTemplate[] = Array.isArray(saved?.templates) ? saved.templates : []
  const rest = custom.filter(x => x.key !== t.key)
  const clean: ReportTemplate = { key: String(t.key).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40), name: String(t.name || '').slice(0, 80), blurb: String(t.blurb || '').slice(0, 300), theme: String(t.theme || 'garden'), font: String(t.font || 'garden'), sections: (Array.isArray(t.sections) ? t.sections : []).filter(s => SECTIONS.some(x => x.key === s)) as SectionKey[], cards: (Array.isArray(t.cards) ? t.cards : []).filter(c => CARD_KEYS.some(x => x.key === c)).slice(0, 4), copy: { ...DEFAULT_TEMPLATES[0].copy, ...(t.copy || {}) } }
  await setSetting(TEMPLATES_KEY, { ...(saved || {}), templates: [...rest, clean], hidden: (saved?.hidden || []).filter((k: string) => k !== clean.key) }, by)
}
export async function resetTemplate(key: string, by: string): Promise<void> {
  const saved = await getSetting<any>(TEMPLATES_KEY, null).catch(() => null)
  const custom: ReportTemplate[] = Array.isArray(saved?.templates) ? saved.templates : []
  const shipped = DEFAULT_TEMPLATES.some(t => t.key === key)
  await setSetting(TEMPLATES_KEY, { ...(saved || {}), templates: custom.filter(x => x.key !== key), hidden: shipped ? (saved?.hidden || []) : [...(saved?.hidden || []), key] }, by)
}
