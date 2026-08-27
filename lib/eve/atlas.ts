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
import { FEATURES } from '@/lib/features'
import { DOMAINS } from './registry'

// What each page is for, one line each, keyed by feature key. A page missing here still appears
// in the atlas (label + path from the registry) — it just carries no explanation until someone
// writes one. Keep these to a single clause; the atlas rides in every prompt.
const PAGE_NOTES: Record<string, string> = {
  command: 'the daily control room — health, arrivals, money and alerts in one screen',
  home: 'landing page with the day at a glance',
  reservations: 'every booking, searchable; the source of truth mirrored from Guesty',
  'reservation-emails': 'front-desk notices to buildings — auto-drafted daily into support@ Drafts with the registration form attached; config lives in Users & admin → Settings → Front-desk notices',
  messages: 'guest message threads from all channels',
  reviews: 'every review with AI reply drafting; the reply voice is tuned in Settings',
  'welcome-calls': 'VIP/new-arrival call list for the guest experience team',
  guidebooks: 'per-property guest guidebooks',
  claims: 'damage/incident claims tracking with daily sweep',
  faq: 'per-property answers the team gives guests',
  guests: 'the guest directory — profiles, history, VIP flags',
  salato: 'Salato building front desk: its own share/verify flow for arrivals',
  plan: 'Today in Ops — the operational day: exceptions, pushes to Breezeway, acknowledgements',
  schedule: 'the turnover scheduler — cleans, assignments, same-day turns',
  forecast: 'the weekly schedule ahead',
  glitches: 'things broken in units — tracked to resolution',
  audits: 'periodic property audit runs',
  inspections: 'inspection checklists; auto-created for big/VIP/owner arrivals when Task automation is on',
  orders: 'purchasing pipeline with must/recommended/nice tiers and export',
  requests: 'internal work requests',
  blocked: 'units blocked out of service and why',
  projects: 'longer-running property projects',
  ffe: 'FF&E room-by-room audit, catalog and replacement ordering',
  vault: 'credentials vault (owner-gated reveals)',
  'share-links': 'live shareable data links — reservations, ADR, cleaning, verification — with passwords',
  buildings: 'the property/building registry and rollups',
  listings: 'every listing with channel config',
  optimize: 'ranked list of what to fix across the portfolio; the optimizer itself is on each listing page (/listings/<id>)',
  health: 'listing health & channel connection status',
  patterns: 'building-level performance patterns',
  revenue: 'revenue center — pricing, pacing, pickup',
  marketing: 'marketing assets and campaigns',
  billing: 'billing, maintenance and payroll rollups',
  reports: 'the report builder (send-to-Drive lives here)',
  'owner-audit': 'owner statement audit against reservations',
  cleaners: 'housekeeping roster and assignments',
  labor: 'labor hours and timecards from Homebase',
  'labor-dashboard': 'labor cost dashboards',
  'custom-fields': 'Guesty custom-field mapping',
  'labor-settings': 'labor rules and pay settings',
  integrations: 'connected systems — Guesty, Breezeway, Slack, Google, Homebase',
  eve: 'retired as a page — Eve is the floating bubble on every screen; her memory/voice/direction live in Users & admin → Settings → Eve',
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
  const pages = Object.keys(byGroup).map(g => g.toUpperCase() + '\n' + byGroup[g].join('\n')).join('\n')
  const tools = DOMAINS.map(d => `- ${d.label} (${d.tools.length} tools): ${d.blurb}`).join('\n')
  _cache = 'THE APP (Lighthouse) — you know every page. When someone asks where to do something, '
    + 'point them at the page (and the Settings fold if it is a setting). Users & admin (/users) '
    + 'holds Settings: task automation, front-desk notices, Slack rules, approval limits, review '
    + 'voice, share links, staffing, PAR levels — and your own memory/voice/direction under "Eve".\n'
    + pages
    + '\n\nYOUR TOOL DOMAINS — open a domain to gain its tools for the rest of the conversation:\n'
    + tools
  return _cache
}
