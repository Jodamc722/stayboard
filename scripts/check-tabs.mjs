// BUILD-TIME TAB CENSUS (2026-08-06, Jon's rule: every new tab must surface in user settings).
// Runs from next.config.mjs on every `next build` and `next dev`, locally and on Vercel.
//
// It walks app/**/page.tsx and requires every route to be one of:
//   1. covered by a FEATURES entry in lib/features.ts  → it has a per-role permission setting
//   2. listed in OPEN_EXACT / OPEN_PREFIXES            → deliberately public (share links, auth)
//   3. listed in UNGATED_PAGES                         → login-only, deliberately no role setting
// A page that is none of these FAILS THE BUILD with instructions. That is the point: a new tab
// cannot ship without someone deciding where it sits in /users → Roles.
//
// This file reads lib/features.ts as TEXT (no TS import from an .mjs), so keep those arrays as
// plain single-quoted string literals — the regexes below depend on it.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function stringsIn(src, arrayName) {
  const m = src.match(new RegExp(arrayName + '\\s*(?::[^=]*)?=\\s*\\[([\\s\\S]*?)\\]'))
  if (!m) throw new Error(`check-tabs: could not find ${arrayName} in lib/features.ts — was it renamed?`)
  return Array.from(m[1].matchAll(/'([^']+)'/g)).map(x => x[1])
}

function walkPages(dir, prefix, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkPages(p, prefix + '/' + name, out)
    else if (name === 'page.tsx' || name === 'page.ts' || name === 'page.jsx') out.push(prefix || '/')
  }
  return out
}

export function checkTabs() {
  const feat = readFileSync(join(ROOT, 'lib', 'features.ts'), 'utf8')
  // FEATURES paths: every `path: '...'` in the file belongs to a Feature entry.
  const featurePaths = Array.from(feat.matchAll(/path:\s*'([^']+)'/g)).map(x => x[1])
  const openExact = stringsIn(feat, 'OPEN_EXACT')
  const openPrefixes = stringsIn(feat, 'OPEN_PREFIXES')
  const ungated = stringsIn(feat, 'UNGATED_PAGES')

  const routes = walkPages(join(ROOT, 'app'), '', [])
    .filter(r => !r.startsWith('/api'))
    // A dynamic segment matches like any concrete value would: /g/[id] tests as /g/_id.
    .map(r => r.replace(/\[[^\]]+\]/g, '_'))

  const coveredBy = (route, p) => p === '/' ? route === '/' : (route === p || route.startsWith(p + '/'))
  const missing = routes.filter(route =>
    !featurePaths.some(p => coveredBy(route, p)) &&
    !ungated.some(p => coveredBy(route, p)) &&
    openExact.indexOf(route) < 0 &&
    !openPrefixes.some(p => route.startsWith(p))
  )

  if (missing.length > 0) {
    throw new Error(
      `\n\n[check-tabs] ${missing.length} page(s) have no user-settings decision:\n` +
      missing.map(r => `  - ${r}`).join('\n') +
      `\n\nEvery tab must be one of (in lib/features.ts):\n` +
      `  1. a FEATURES entry (key/label/path/group) → gets a per-role level in /users → Roles\n` +
      `  2. OPEN_EXACT / OPEN_PREFIXES → deliberately public (share links)\n` +
      `  3. UNGATED_PAGES → login-only, deliberately no role setting\n` +
      `Register the page, then build again. This is what keeps /users → Roles complete.\n`
    )
  }

  // Softer signal: a gated tab that isn't in the sidebar is reachable only by URL (the old
  // Listings oddity). Warn, don't fail — some tabs are deliberately parked pending nav sign-off.
  try {
    const shell = readFileSync(join(ROOT, 'components', 'Shell.tsx'), 'utf8')
    const navPaths = Array.from(shell.matchAll(/to:\s*'([^']+)'/g)).map(x => x[1])
    const offNav = featurePaths.filter(p => navPaths.indexOf(p) < 0)
    if (offNav.length > 0) console.warn(`[check-tabs] gated but not in the sidebar (URL-only): ${offNav.join(', ')}`)
  } catch { /* nav drift warning is best-effort */ }

  console.log(`[check-tabs] ok — ${routes.length} pages, all accounted for in user settings`)
}
