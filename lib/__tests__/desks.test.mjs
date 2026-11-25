// node lib/__tests__/desks.test.mjs
//
// THE DESKS ARE THE ONE MAP OF THE APP (Jon, 2026-09-29). This keeps them that way: every feature
// and every signed-in page belongs to exactly one desk, the roles grid groups match the desks, and
// the sidebar, strip and Jump box can never disagree about where a page lives. Plain node, no deps:
// lib/desks.ts and lib/features.ts have no imports, and node >= 22.18 strips their types itself.
//
// 2026-11-20 (Jon: "get rid of tabs that we do not use… think a professional webapp"): the menu is now
// Today, Eve, five headings and Settings, and a view is either a sidebar row or `jump: true` (in Jump
// and at its URL, not drawn). Section 1b pins the menu row by row; section 1c holds the rule that a
// page taken off the sidebar is still a page: same desk, same permission, still found.
import { readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..', '..')
const D = await import('../desks.ts')
const F = await import('../features.ts')
const { DESKS, deskForPath, deskPaths, menuViews } = D
const { FEATURES, GROUP_ORDER, UNGATED_PAGES, isOpenPath } = F

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)

// 1. Shape: unique keys and labels, every view has a label and a hint, Today first, Admin last.
eq('desk keys unique', new Set(DESKS.map(d => d.key)).size, DESKS.length)
eq('desk labels unique', new Set(DESKS.map(d => d.label)).size, DESKS.length)
eq('Today first', DESKS[0].key, 'today')
eq('Admin last', DESKS[DESKS.length - 1].key, 'admin')
for (const d of DESKS) {
  ok(`${d.key}: has a view`, d.views.length > 0)
  ok(`${d.key}: blurb`, typeof d.blurb === 'string' && d.blurb.length > 10)
  for (const v of d.views) ok(`${d.key} ${v.to}: label + hint`, !!v.label && !!v.hint && v.hint.length > 8)
  // The desk's own row links to its first view, so that one must be on the sidebar.
  ok(`${d.key}: first view is a sidebar row`, !d.views[0].jump)
  for (const v of d.views) {
    // A row is in the menu or it is not: the "+N more" fold is retired and must not come back.
    ok(`${d.key} ${v.to}: no "more" flag`, !('more' in v))
    ok(`${d.key} ${v.to}: jump is true or absent`, v.jump === undefined || v.jump === true)
  }
}

// 1b. THE MENU AS DRAWN (Jon, 2026-11-20). Six headings at most, every row always visible, and
// exactly these rows in this order. Changing the sidebar means changing this table on purpose.
const MENU = [
  ['Today', ['Today /command']],
  ['Eve', ['Eve /eve']],
  ['Operations', ['Ops board /plan', 'Schedule /schedule', 'Week plan /team', 'Briefs /briefs', 'Open & Close /checklist', 'Maintenance /maintenance', 'Blocked units /blocked', 'Upkeep /upkeep', 'Leadership /leadership']],
  ['Guests', ['Inbox /inbox', 'Calls /welcome-calls', 'Reservations /reservations', 'Glitches /glitches', 'Claims /claims', 'Lost & Found /lost-found', 'Reviews /reviews', 'Parking /lots', 'Front-desk notices /reservation-emails']],
  ['Properties', ['Properties /buildings', 'Guidebooks /guidebooks', 'Listing desk /admin', 'Unit setup /onboarding', 'Map /buildings/map', 'Linens /onboarding/linens']],
  // 'Onboarding cost /sales/onboarding-cost' added on purpose (Jon, 2026-11-20: "this is for sales… build it in app").
  ['Owners & sales', ['Sales /sales', 'Onboarding cost /sales/onboarding-cost', 'Owner onboarding /owner-onboarding', 'Owner reports /reports', 'Ad Studio /ads']],
  // 'Scorecards /scoreboard' added on purpose (Jon, 2026-11-20: "Everything should have a scorecard for
  // things completed and Leaderboard based on KPI"): the page the morning briefs link to.
  ['Money & team', ['Statements /owner-audit', 'Billing /billing', 'Revenue /revenue/sales', 'Team /labor', 'Scorecards /scoreboard']],
  ['Settings', ['Users & admin /users']],
]
eq('the menu, row by row', DESKS.map(d => [d.label, menuViews(d).map(v => v.label + ' ' + v.to)]), MENU)
// Today and Eve are rows without a heading; every other desk is a heading (Settings is the gear).
ok('six headings at most', DESKS.filter(d => d.key !== 'today' && d.key !== 'eve').length <= 6)
for (const d of DESKS) {
  ok(`${d.key}: draws at least one row`, menuViews(d).length > 0)
  eq(`${d.key}: menuViews is the views without jump`, menuViews(d), d.views.filter(v => !v.jump))
  eq(`${d.key}: row labels unique`, new Set(menuViews(d).map(v => v.label)).size, menuViews(d).length)
}
// The four rows Jon asked for by name stay rows of their own until he decides otherwise.
for (const p of ['/team', '/checklist', '/blocked', '/lost-found']) ok(`${p} is its own sidebar row`, deskForPath(p).view.to === p && !deskForPath(p).view.jump)

// 1c. A HIDDEN VIEW IS STILL A VIEW. Off the sidebar means off the sidebar and nothing else: the page
// still resolves to itself in its own desk (so the Jump box, the page name in the top strip and Eve's
// atlas all still know it), and no view was lost on the way.
const allViews = DESKS.flatMap(d => d.views.map(v => ({ d, v })))
const jumpViews = allViews.filter(x => x.v.jump)
for (const { d, v } of jumpViews) {
  const hit = deskForPath(v.to)
  ok(`${v.to} (jump) resolves to itself`, !!hit && hit.view === v, hit && hit.view ? `got ${hit.view.to}` : 'no view')
  ok(`${v.to} (jump) stays in its desk`, !!hit && hit.desk.key === d.key)
}
eq('view paths unique', new Set(allViews.map(x => x.v.to)).size, allViews.length)
// Every page that had a row or a "+N more" line before 2026-11-20 is still a view today.
const WAS_A_VIEW = ['/command', '/messages', '/eve', '/plan', '/upkeep', '/schedule', '/team', '/checklist', '/maintenance', '/leadership', '/blocked',
  '/inbox', '/welcome-calls', '/glitches', '/claims', '/lost-found', '/reservations', '/guest-orders', '/guidebooks', '/lots', '/reservation-emails', '/faq',
  '/reviews', '/buildings', '/buildings/map', '/channels', '/sales', '/owner-onboarding', '/sales/projections', '/ads', '/marketing', '/photos', '/contacts', '/guests',
  '/onboarding', '/onboarding/linens', '/audits', '/orders', '/catalogs', '/reports', '/projections', '/labor', '/cleaners', '/training', '/training/scoreboard',
  '/owner-audit', '/billing', '/clean-invoices', '/revenue/sales', '/revenue', '/revenue-app', '/admin', '/brain', '/users', '/system-health', '/links', '/vault', '/api-keys']
eq('58 pages were views before', WAS_A_VIEW.length, 58)
for (const p of WAS_A_VIEW) ok(`${p} is still a view`, allViews.some(x => x.v.to === p))
// The pages nobody opened in the 30-day read are the ones that left the sidebar (not deleted, not moved).
for (const p of ['/links', '/sales/projections', '/catalogs', '/guests', '/contacts', '/marketing', '/revenue-app', '/projections', '/brain', '/orders', '/system-health', '/training', '/guest-orders', '/revenue', '/cleaners', '/audits']) {
  const x = allViews.find(y => y.v.to === p)
  ok(`${p} is off the sidebar and still in Jump`, !!x && x.v.jump === true)
}

// 2. No path claimed by two desks.
const owner = {}
for (const d of DESKS) for (const p of deskPaths(d)) {
  ok(`path ${p} claimed once`, !owner[p] || owner[p] === d.key, `also claimed by ${owner[p]}`)
  owner[p] = d.key
}

// 3. The roles grid groups ARE the desks, in sidebar order (plus the Garden Hotel's own group).
eq('GROUP_ORDER = desk labels + Garden Hotel', GROUP_ORDER, DESKS.map(d => d.label).concat(['Garden Hotel']))

// 4. Every feature belongs to a desk, and its group is that desk's label.
for (const f of FEATURES) {
  if (f.group === 'Garden Hotel') { ok(`${f.key}: garden stays out of the desks`, deskForPath(f.path) === null); continue }
  const hit = deskForPath(f.path)
  ok(`${f.key} (${f.path}) belongs to a desk`, !!hit)
  if (hit) eq(`${f.key} group = its desk`, f.group, hit.desk.label)
}

// 5. Every view is a page someone can be granted: covered by a feature or the ungated list.
const featureCovers = (p) => FEATURES.some(f => p === f.path || p.startsWith(f.path + '/')) || UNGATED_PAGES.includes(p)
for (const d of DESKS) for (const v of d.views) ok(`${v.to} is a permissioned page`, featureCovers(v.to))

// 6. Every signed-in VR page on disk belongs to a desk (nothing is orphaned from the structure).
function walk(dir, prefix, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, prefix + '/' + name, out)
    else if (name === 'page.tsx' || name === 'page.ts') out.push(prefix || '/')
  }
  return out
}
const LOOSE = ['/', '/welcome/password', '/doorcode', '/account']   // not places: a redirect, a sign-in detour, a one-time link, each person's own account page
const pages = walk(join(ROOT, 'app'), '', [])
  .map(r => r.replace(/\[[^\]]+\]/g, '_x'))
  .filter(r => !r.startsWith('/api') && !r.startsWith('/garden') && !isOpenPath(r) && !LOOSE.some(l => r === l || r.startsWith(l + '/')))
for (const r of pages) ok(`page ${r} belongs to a desk`, !!deskForPath(r))

// 7. The lookups people rely on.
eq('/plan → Operations · Ops board', [deskForPath('/plan').desk.key, deskForPath('/plan').view.label], ['operations', 'Ops board'])
eq('/plan/print stays on Ops board', deskForPath('/plan/print').view.to, '/plan')
eq('/onboarding/linens is its own view', deskForPath('/onboarding/linens').view.label, 'Linens')
eq('/onboarding → Unit setup', deskForPath('/onboarding').view.label, 'Unit setup')
eq('/onboarding/quick lights Unit setup', deskForPath('/onboarding/quick').view.to, '/onboarding')
eq('/admin → Properties · Listing desk', [deskForPath('/admin').desk.key, deskForPath('/admin').view.label], ['properties', 'Listing desk'])
eq('/reviews → Guests', deskForPath('/reviews').desk.key, 'guests')
eq('/revenue/sales is the Revenue row', [deskForPath('/revenue/sales').desk.key, deskForPath('/revenue/sales').view.label], ['money', 'Revenue'])
eq('/revenue is the Revenue Center, not the row', [deskForPath('/revenue').view.to, deskForPath('/revenue').view.jump], ['/revenue', true])
eq('/revenue/reconcile stays with the Revenue Center', deskForPath('/revenue/reconcile').view.to, '/revenue')
eq('/users → Settings', [deskForPath('/users').desk.key, deskForPath('/users').desk.label], ['admin', 'Settings'])
eq('/vault → Settings, off the sidebar', [deskForPath('/vault').desk.key, deskForPath('/vault').view.jump], ['admin', true])
eq('/messages → Today, off the sidebar', [deskForPath('/messages').desk.key, deskForPath('/messages').view.jump], ['today', true])
eq('/listings/abc lights Properties', deskForPath('/listings/abc').view.to, '/buildings')
eq('/labor/dashboard stays on Labor', deskForPath('/labor/dashboard').view.to, '/labor')
eq('/refunds lights Glitches', deskForPath('/refunds').view.to, '/glitches')
eq('/loops lights Eve', deskForPath('/loops').view.to, '/eve')
eq('/kpi is parked under Money & team, no tab', [deskForPath('/kpi').desk.key, deskForPath('/kpi').view], ['money', null])
eq('/scoreboard is the Scorecards row', [deskForPath('/scoreboard').desk.key, deskForPath('/scoreboard').view.label, !!deskForPath('/scoreboard').view.jump], ['money', 'Scorecards', false])
eq('/training/scoreboard is still its own view', deskForPath('/training/scoreboard').view.to, '/training/scoreboard')
eq('/orders-live is not /orders', deskForPath('/orders-live'), null)
eq('/garden is not a desk', deskForPath('/garden'), null)
eq('empty path', deskForPath(''), null)

console.log(`desks: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
