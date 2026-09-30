// node lib/__tests__/desks.test.mjs
//
// THE DESKS ARE THE ONE MAP OF THE APP (Jon, 2026-09-29). This keeps them that way: every feature
// and every signed-in page belongs to exactly one desk, the roles grid groups match the desks, and
// the sidebar, strip and Jump box can never disagree about where a page lives. Plain node, no deps:
// lib/desks.ts and lib/features.ts have no imports, and node >= 22.18 strips their types itself.
import { readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..', '..')
const D = await import('../desks.ts')
const F = await import('../features.ts')
const { DESKS, deskForPath, deskPaths } = D
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
  ok(`${d.key}: first view is not under More`, !d.views[0].more)
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
const LOOSE = ['/', '/welcome/password', '/doorcode']   // not places: a redirect, a sign-in detour, a one-time link
const pages = walk(join(ROOT, 'app'), '', [])
  .map(r => r.replace(/\[[^\]]+\]/g, '_x'))
  .filter(r => !r.startsWith('/api') && !r.startsWith('/garden') && !isOpenPath(r) && !LOOSE.some(l => r === l || r.startsWith(l + '/')))
for (const r of pages) ok(`page ${r} belongs to a desk`, !!deskForPath(r))

// 7. The lookups people rely on.
eq('/plan → Operations · Today board', [deskForPath('/plan').desk.key, deskForPath('/plan').view.label], ['operations', 'Today board'])
eq('/plan/print stays on Today board', deskForPath('/plan/print').view.to, '/plan')
eq('/onboarding/linens is its own tab', deskForPath('/onboarding/linens').view.label, 'Linens')
eq('/onboarding → Onboarding', deskForPath('/onboarding').view.label, 'Onboarding')
eq('/listings/abc lights Properties', deskForPath('/listings/abc').view.to, '/buildings')
eq('/labor/dashboard stays on Labor', deskForPath('/labor/dashboard').view.to, '/labor')
eq('/refunds lights Glitches', deskForPath('/refunds').view.to, '/glitches')
eq('/loops lights Eve', deskForPath('/loops').view.to, '/eve')
eq('/kpi is parked under KPIs, no tab', [deskForPath('/kpi').desk.key, deskForPath('/kpi').view], ['kpis', null])
eq('/orders-live is not /orders', deskForPath('/orders-live'), null)
eq('/garden is not a desk', deskForPath('/garden'), null)
eq('empty path', deskForPath(''), null)

console.log(`desks: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
