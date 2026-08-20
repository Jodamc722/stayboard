// Lighthouse self-audit — static code checks.
//
// Runs from a plain clone with ZERO secrets and ZERO npm dependencies, so the twice-daily
// auditor can execute it anywhere. Every check answers one question: "is a thing that used to
// work quietly not working any more?" Nothing here mutates the repo.
//
// A finding is { id, sev, area, title, detail, where[] }. `sev` is 'red' | 'amber' | 'note'.
// `id` must be STABLE across runs — the runner diffs today's ids against a baseline so Jon only
// hears about what is NEW or WORSE, never the standing backlog.

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.env.AUDIT_ROOT || process.cwd()
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const has = (p) => fs.existsSync(path.join(ROOT, p))

function walk(dir, out = []) {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return out
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next' && e.name !== '.git') walk(rel, out) }
    else out.push(rel)
  }
  return out
}
const SRC = () => walk('app').concat(walk('lib'), walk('components')).filter(f => /\.(ts|tsx|mjs)$/.test(f))
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length

// ─────────────────────────────────────────────────────────────────────────────
// 1. CRON WIRING
// Two failure modes have actually bitten this app: a cron path with a query string (Vercel
// silently never fires it) and a cron route that exists but was never added to vercel.json.
// Both look exactly like "the feature just doesn't happen".
// ─────────────────────────────────────────────────────────────────────────────
function cronWiring() {
  const out = []
  if (!has('vercel.json')) return out
  const crons = (JSON.parse(rd('vercel.json')).crons || [])
  const paths = crons.map(c => c.path)

  for (const c of crons) {
    if (c.path.includes('?')) {
      out.push({ id: `cron-querystring:${c.path}`, sev: 'red', area: 'Crons',
        title: `Cron never fires: ${c.path}`,
        detail: 'Vercel cron paths with a query string are silently never invoked. Move the parameter into the route as a default, or point the cron at a paramless path.',
        where: [`vercel.json — schedule "${c.schedule}"`] })
    }
    const file = 'app' + c.path.split('?')[0] + '/route.ts'
    if (!has(file)) {
      out.push({ id: `cron-missing-route:${c.path}`, sev: 'red', area: 'Crons',
        title: `Cron points at a route that does not exist: ${c.path}`,
        detail: 'Every run 404s. Either the route was deleted/renamed or the path is a typo.',
        where: [`vercel.json`, `expected ${file}`] })
    }
  }
  for (const f of walk('app/api/cron')) {
    if (path.basename(f) !== 'route.ts') continue
    const route = '/api/cron/' + path.dirname(f).replace(/^app\/api\/cron\/?/, '')
    if (!paths.some(p => p.split('?')[0] === route)) {
      out.push({ id: `cron-orphan:${route}`, sev: 'amber', area: 'Crons',
        title: `Cron route is never scheduled: ${route}`,
        detail: 'The code exists and is maintained but nothing calls it. Either schedule it in vercel.json or delete it so it stops reading as live.',
        where: [f] })
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. CRON AUTH
// The house pattern is `if (secret) { ...check... }` — safe when CRON_SECRET is set, wide open
// when it isn't. A cron route with no CRON_SECRET reference at all is open no matter what.
// ─────────────────────────────────────────────────────────────────────────────
function cronAuth() {
  const out = []
  for (const f of walk('app/api/cron')) {
    if (path.basename(f) !== 'route.ts') continue
    const src = rd(f)
    if (!/CRON_SECRET/.test(src)) {
      const writes = /\.(upsert|insert|update|delete)\(/.test(src)
      out.push({ id: `cron-unauthed:${f}`, sev: writes ? 'red' : 'amber', area: 'Security',
        title: `Cron route has no CRON_SECRET check: ${'/' + f.replace(/^app\//, '').replace(/\/route\.ts$/, '')}`,
        detail: writes
          ? 'Anyone on the internet can trigger this and it writes to the database.'
          : 'Anyone on the internet can trigger this. Read-only, but it burns function time and leaks internals.',
        where: [f] })
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. <Shell> COMPLIANCE
// app/layout.tsx renders only {children}; there is no nested layout. A gated page that forgets
// <Shell> ships with zero navigation and is effectively invisible — that is how /links and
// /guests shipped unnoticed. Ground truth for "should have Shell" is lib/features.ts.
// ─────────────────────────────────────────────────────────────────────────────
// Pages that are correctly navigation-free. Each one needs a reason, because the cost of a
// wrong entry here is a real bug going unreported forever — and the cost of leaving one out is
// a false alarm, which is worse than useless: it teaches whoever reads the report to skim it.
const SHELL_EXEMPT = [
  'app/guidebooks/[id]/page.tsx',      // documented in-file: outside Shell so print/PDF is clean
  'app/plan/print/page.tsx',           // print view
  'app/reports/complaints/page.tsx',   // print-oriented owner report
  'app/salato/page.tsx',               // Salato front-desk board, reached by its own link
  'app/audits/review/[code]/page.tsx', // share-code review page — the link IS the key
  'app/welcome/password/page.tsx',     // where a magic link lands someone with no password yet;
                                       // mid-auth there is nothing to navigate to
]
function shellCompliance() {
  const out = []
  if (!has('lib/features.ts')) return out
  const feat = rd('lib/features.ts')
  const arr = (name) => {
    const m = feat.match(new RegExp(name + '\\s*(?::[^=]*)?=\\s*\\[([\\s\\S]*?)\\]'))
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : []
  }
  const openExact = arr('OPEN_EXACT'), openPrefix = arr('OPEN_PREFIXES')
  if (!openPrefix.length) {
    return [{ id: 'shell-registry-unreadable', sev: 'amber', area: 'Nav',
      title: 'Could not read OPEN_PREFIXES from lib/features.ts',
      detail: 'The Shell check cannot run. Someone renamed or restructured the public-route registry.', where: ['lib/features.ts'] }]
  }
  for (const f of walk('app')) {
    if (path.basename(f) !== 'page.tsx') continue
    if (SHELL_EXEMPT.includes(f)) continue
    const route = '/' + path.dirname(f).replace(/^app\/?/, '')
    const routeN = route === '/' ? '/' : route.replace(/\/$/, '')
    if (openExact.includes(routeN)) continue
    if (openPrefix.some(p => routeN.startsWith(p) || (routeN + '/').startsWith(p))) continue
    const src = rd(f)
    if (/redirect\(/.test(src) && src.length < 900) continue // redirect-only stub
    if (!/\bShell\b/.test(src)) {
      out.push({ id: `no-shell:${f}`, sev: 'red', area: 'Nav',
        title: `Page ships with no navigation: ${routeN}`,
        detail: 'This page does not wrap itself in <Shell>, and app/layout.tsx supplies no nav. Users land on a bare page with no way back — in practice the feature is invisible.',
        where: [f] })
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. POSTGREST 1000-ROW CAP
// .limit(1000) is exactly the PostgREST default cap, so a truncated result is indistinguishable
// from a complete one. Every number computed off one of these is quietly capped.
// ─────────────────────────────────────────────────────────────────────────────
function rowCap() {
  const out = []
  for (const f of SRC()) {
    const src = rd(f)
    for (const m of src.matchAll(/\.limit\(1000\)/g)) {
      out.push({ id: `row-cap:${f}:${lineOf(src, m.index)}`, sev: 'amber', area: 'Data',
        title: `Query capped at exactly 1000 rows`,
        detail: 'PostgREST returns at most 1000 rows by default, so this cannot tell "there were 1000" from "there were more and you got 1000". Page it, or raise the cap and assert you did not hit it.',
        where: [`${f}:${lineOf(src, m.index)}`] })
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. SWALLOWED WRITE FAILURES
// An empty catch around a mirror write means the UI reports success while the board silently
// diverges from Breezeway. Comment-only catches are deliberate and are not flagged.
// ─────────────────────────────────────────────────────────────────────────────
function swallowedWrites() {
  const out = []
  for (const f of SRC()) {
    const src = rd(f)
    for (const m of src.matchAll(/catch\s*(?:\([^)]*\))?\s*\{\s*\}/g)) {
      const ln = lineOf(src, m.index)
      const before = src.slice(Math.max(0, m.index - 600), m.index)
      if (!/\.(upsert|insert|update|delete)\(/.test(before)) continue
      out.push({ id: `swallowed-write:${f}:${ln}`, sev: 'amber', area: 'Data',
        title: `Database write failure is swallowed silently`,
        detail: 'An empty catch sits directly after a write. If the write fails the caller still reports success and the mirror drifts out of sync with no trace.',
        where: [`${f}:${ln}`] })
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. HOOKS AFTER AN EARLY RETURN (React #310)
// A useEffect that sits below a conditional return in the component body crashes the page the
// first time that branch is taken. Anchored to the exported component, not the whole file.
// ─────────────────────────────────────────────────────────────────────────────
function hooksAfterReturn() {
  const out = []
  for (const f of walk('app').concat(walk('components'))) {
    if (!/\.tsx$/.test(f)) continue
    const src = rd(f)
    const start = src.search(/export\s+default\s+function\s+\w+/)
    if (start < 0) continue
    // Stop at the next top-level declaration so a sibling component in the same file cannot
    // be mistaken for a hook inside this one. That false positive is what makes naive versions
    // of this check untrustworthy, and an untrusted check gets ignored.
    const after = src.slice(start + 10)
    const endRel = after.search(/\n(?:export\s|function\s|const\s|async\s+function\s|class\s)/)
    const body = endRel < 0 ? src.slice(start) : src.slice(start, start + 10 + endRel)
    // Component-level only: exactly two spaces of indent.
    const ret = body.search(/\n {2}(?:if\s*\([^)]*\)\s*)?return[\s(<;]/)
    if (ret < 0) continue
    const hook = body.slice(ret).search(/\n {2}(?:const [^\n]*=\s*)?use(Effect|State|Memo|Callback|Ref)\s*\(/)
    if (hook < 0) continue
    out.push({ id: `hook-after-return:${f}`, sev: 'red', area: 'Runtime',
      title: `React hook declared after an early return`,
      detail: 'React throws error #310 ("rendered fewer hooks than expected") and the page white-screens the first time that early return is taken. Every hook must sit above the first return.',
      where: [`${f}:${lineOf(src, start + ret)} — return here, hook at :${lineOf(src, start + ret + hook)}`] })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. DUPLICATE EXPORTED HELPERS WITH DIFFERENT SIGNATURES
// Two exported buildingOf() in lib/ with incompatible arguments is a live import-the-wrong-one
// hazard — the kind that produces numbers that are wrong but plausible.
// ─────────────────────────────────────────────────────────────────────────────
const WATCHED_HELPERS = ['buildingOf', 'todayET', 'addDays', 'isDepartureCleanName', 'defaultRooms', 'money', 'ymd', 'pageAll']
function duplicateHelpers() {
  const out = []
  for (const name of WATCHED_HELPERS) {
    const hits = []
    for (const f of walk('lib')) {
      if (!/\.ts$/.test(f)) continue
      const src = rd(f)
      const m = src.match(new RegExp('export\\s+(?:async\\s+)?(?:function|const)\\s+' + name + '\\b[^\\n]*'))
      if (m) hits.push({ f, sig: m[0].trim().slice(0, 110), line: lineOf(src, m.index) })
    }
    if (hits.length > 1) {
      out.push({ id: `dup-helper:${name}`, sev: 'amber', area: 'Correctness',
        title: `${hits.length} exported \`${name}\` in lib/ — importing the wrong one is silent`,
        detail: 'Same name, different behaviour, no type error at the import site. Pick one canonical definition and have the others re-export it.',
        where: hits.map(h => `${h.f}:${h.line} — ${h.sig}`) })
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. PUBLIC STORAGE BUCKETS
// Buckets are auto-created at request time. A bucket that holds anything guest-identifying must
// be signed, not public.
// ─────────────────────────────────────────────────────────────────────────────
const BUCKET_MUST_BE_PRIVATE = ['glitch-photos', 'glitch-files', 'claim-files', 'reservation-docs', 'vault', 'salato-verify']
function buckets() {
  const out = []
  const seen = new Map()
  for (const f of SRC()) {
    const src = rd(f)
    for (const m of src.matchAll(/\.storage\s*\n?\s*\.from\(\s*['"]([^'"]+)['"]/g)) {
      const b = m[1]
      const near = src.slice(m.index, m.index + 2500)
      const pub = /getPublicUrl\(/.test(near)
      const cur = seen.get(b) || { pub: false, where: [] }
      cur.pub = cur.pub || pub
      cur.where.push(`${f}:${lineOf(src, m.index)}`)
      seen.set(b, cur)
    }
  }
  for (const [b, v] of seen) {
    if (v.pub && BUCKET_MUST_BE_PRIVATE.includes(b)) {
      out.push({ id: `public-bucket:${b}`, sev: 'red', area: 'Security',
        title: `Bucket "${b}" is served with public URLs`,
        detail: 'This bucket holds guest-identifying or financial material and must be read through createSignedUrl with a short TTL, never getPublicUrl.',
        where: v.where.slice(0, 6) })
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. RLS REGISTER
// A migration that creates a table without enabling row level security leaves it readable by
// the anon key. Reported once per table; the runner's baseline keeps the standing backlog quiet.
// ─────────────────────────────────────────────────────────────────────────────
function rlsRegister() {
  const out = []
  const dir = 'supabase/migrations'
  if (!has(dir)) return out
  const enabled = new Set()
  const created = new Map()
  for (const f of fs.readdirSync(path.join(ROOT, dir)).sort()) {
    if (!f.endsWith('.sql')) continue
    const src = rd(path.join(dir, f))
    for (const m of src.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi)) created.set(m[1], f)
    for (const m of src.matchAll(/alter\s+table\s+(?:public\.)?([a-z0-9_]+)\s+enable\s+row\s+level\s+security/gi)) enabled.add(m[1])
  }
  for (const [t, f] of created) {
    if (!enabled.has(t)) {
      out.push({ id: `no-rls:${t}`, sev: 'amber', area: 'Security',
        title: `Table \`${t}\` was created without row level security`,
        detail: 'Without RLS the table is reachable with the public anon key from any browser. Confirm against pg_class.relrowsecurity — a later migration may have fixed it.',
        where: [`${dir}/${f}`] })
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. TABLES THE CODE READS THAT NO MIGRATION CREATES
// Schema that exists only in production has no review, no history, and nothing would catch a
// drop. Informational, but the list should never grow.
// ─────────────────────────────────────────────────────────────────────────────
function schemaDrift() {
  const dir = 'supabase/migrations'
  if (!has(dir)) return []
  const created = new Set()
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    if (!f.endsWith('.sql')) continue
    for (const m of rd(path.join(dir, f)).matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi)) created.add(m[1])
  }
  const used = new Set()
  for (const f of SRC()) for (const m of rd(f).matchAll(/\.from\(\s*['"]([a-z0-9_]+)['"]\s*\)/g)) used.add(m[1])
  const missing = [...used].filter(t => !created.has(t)).sort()
  if (!missing.length) return []
  return [{ id: 'schema-drift', sev: 'note', area: 'Data',
    title: `${missing.length} tables are read by the app but created by no migration in the repo`,
    detail: 'These exist only in production. Nothing in review or CI would catch one being dropped or renamed. Count should never grow.',
    where: [missing.join(', ')] }]
}

export const STATIC_CHECKS = [
  ['Cron wiring', cronWiring],
  ['Cron auth', cronAuth],
  ['Shell compliance', shellCompliance],
  ['Row cap', rowCap],
  ['Swallowed writes', swallowedWrites],
  ['Hooks after return', hooksAfterReturn],
  ['Duplicate helpers', duplicateHelpers],
  ['Storage buckets', buckets],
  ['RLS register', rlsRegister],
  ['Schema drift', schemaDrift],
]

export function runStatic() {
  const findings = []
  const errors = []
  for (const [name, fn] of STATIC_CHECKS) {
    try { findings.push(...fn()) }
    catch (e) { errors.push({ check: name, error: String(e && e.message || e) }) }
  }
  return { findings, errors }
}
