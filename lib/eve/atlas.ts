// THE APP ATLAS — WHERE DATA LIVES (owner, 2026-11-10: "You need to know where to find data … if the
// team asks you can answer it quickly").
//
// One compact map, in every prompt: for each desk, its pages (name, path, what you do there) and the
// tool drawer that answers questions about it. It is DERIVED, not hand-frozen: the pages and their
// one-line hints come from lib/desks.ts (the same list the sidebar and the Jump box read) and the
// drawers from the tool registry, so a new page or a new tool is in her head on the next deploy with
// zero upkeep. The only hand-written parts are the desk → drawer pairing (one short table) and the
// few settings that live in a panel rather than on a page.
//
// It replaced (2026-11-10) a per-feature list with a hand-written note for every page — longer, and
// drifting from the sidebar. Pages outside the desks (Garden Hotel) are left out on purpose: that is
// Adam's business, not Eve's.
import 'server-only'
import { DESKS } from '@/lib/desks'
import { DOMAINS } from './registry'

/** Which tool drawer answers questions about a desk's pages. Keys are lib/desks.ts desk keys. */
const DESK_TOOLS: Record<string, string[]> = {
  operations: ['ops', 'labor'], guests: ['guests', 'property'], reviews: ['quality'], listings: ['quality', 'property'],
  marketing: ['money'], owners: ['money', 'quality'], team: ['labor'], kpis: ['money'], admin: ['system'],
}

/** Where a setting lives when it is a panel, not a page. */
const SETTINGS = [
  'Admin → Users & admin (/users) → Settings holds: task automation, front-desk notices, Slack rules, approval limits, review voice, share links, staffing and Ops presets (roster, growth buffer, vendor buildings), PAR levels, Guesty custom fields, Salato front-desk units, labor rules and integrations',
  'Settings → Eve: your memory, voice, direction, agent mode, Reports routing, the OTA playbook (each channel\'s refund / cancellation / extras process) and the operating model',
  'Clean rates (the KPI hours per clean): Schedule → Rates',
]

let _cache: string | null = null

/** The atlas text for the system prompt. Built once per server instance — it only changes on deploy. */
export function appAtlas(): string {
  if (_cache) return _cache
  const blurbOf: Record<string, string> = {}
  for (const d of DOMAINS) blurbOf[d.key] = d.label
  const desks = DESKS.map(desk => {
    const tools = (DESK_TOOLS[desk.key] || []).filter(k => blurbOf[k])
    const views = desk.views.map(v => `${v.label} ${v.to} — ${v.hint}`).join('; ')
    return `- ${desk.label.toUpperCase()}${tools.length ? ` [tools: ${tools.join(', ')}]` : ''}: ${views}`
  }).join('\n')
  const drawers = DOMAINS.map(d => `- ${d.key} (${d.label}, ${d.tools.length} tools)`).join('\n')
  _cache = 'WHERE TO FIND IT (Lighthouse). Answer from a tool, then point the person to the page where they can see or fix it — '
    + 'by desk and page name ("Operations → Schedule → Next 7 days"). Anything the app already tracks on its own page '
    + '(channel connections, door codes, arrival instructions, listing health, review feeds, audit findings) you report '
    + 'and point to; you do not chase why it is unresolved.\n'
    + desks
    + '\nSETTINGS: ' + SETTINGS.join('. ') + '.'
    + '\nALWAYS-ON ANSWERS: guest and policy questions — faq_search, house_rules, guest_guidebook, doc_search; '
    + 'staffing next week — schedule_plan; one unit or building — unit_360 / building_360.'
    + '\nTOOL DRAWERS (open_domain):\n'
    + drawers
  return _cache
}
