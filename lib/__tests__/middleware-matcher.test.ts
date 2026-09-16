// THE MIDDLEWARE MATCHER IS AN AUTH BOUNDARY, SO IT GETS A TEST.
//
// On 2026-09-16 a one-line widening of this pattern — meant to stop /stay-logo.png redirecting to
// login on owner share links — took the gate off every path ending in an image or font extension,
// nested ones included. Signed out, /claims/abc.png answered 200 with the whole app shell for six
// hours on both production domains, across all 34 dynamic page routes.
//
// It was a correct-looking change that passed tsc, passed next build, and broke authentication,
// which is exactly the class of thing a type checker cannot see. This test reads the REAL matcher
// out of middleware.ts — not a copy, because a copy drifts and would have passed that day too —
// compiles it the way Next.js does, and asserts which paths the middleware runs on.
//
// Run: npx tsx lib/__tests__/middleware-matcher.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0, fail = 0
function ok(name: string, cond: boolean, extra?: any) {
  if (cond) { pass++; return }
  fail++
  console.log('FAIL  ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''))
}

// Pull the live pattern out of the source. If this ever fails to find it, that is itself the
// finding — somebody restructured the export and this test stopped guarding anything.
const src = readFileSync(join(process.cwd(), 'middleware.ts'), 'utf8')
const m = src.match(/matcher:\s*\[\s*'([^']+)'\s*\]/)
if (!m) { console.log('FAILED — could not find the matcher in middleware.ts'); process.exit(1) }
const pattern = m[1].replace(/\\\\/g, '\\')

// Next.js compiles a matcher string to a full-anchored regex.
const re = new RegExp('^' + pattern + '$')
/** True when the middleware — and therefore the auth gate — runs on this path. */
const gated = (p: string) => re.test(p)

// ---- what MUST stay gated ------------------------------------------------------------------------
const MUST_GATE = [
  '/claims/abc', '/claims/abc.png', '/claims/abc.jpg', '/claims/abc.svg', '/claims/abc.webp',
  '/messages/abc.png', '/reservations/abc.png', '/buildings/abc.png', '/listings/abc.png',
  '/requests/abc.png', '/guidebooks/abc.png', '/g/abc.png',
  '/owner-audit', '/vault', '/buildings', '/command-center',
  '/a/b/c/deep.woff2',                 // any depth, any font
  '/owner/statements.svg',
  '/reports/2026/september.jpeg',
  '/claims/abc.PNG',                   // the extension list is case-insensitive; the gate must be too
]
for (const p of MUST_GATE) ok('gated: ' + p, gated(p))

// ---- what MUST stay public -----------------------------------------------------------------------
// Every one of these is a real file in public/ or a Next.js internal. public/ is flat; if that ever
// changes, the new asset belongs in the matcher by name, not by loosening the pattern.
const MUST_PASS = [
  '/stay-logo.png',                    // the mark on every owner deck and report — the whole reason
  '/icon-180.png', '/icon-192.png', '/icon-512.png',
  '/favicon.ico', '/manifest.json',
  '/_next/static/chunks/main.js', '/_next/image',
  '/api/cron/ops-focus',               // route handlers do their own auth
]
for (const p of MUST_PASS) ok('public: ' + p, !gated(p))

// ---- the shape of the bug, stated as a rule -------------------------------------------------------
// An extension exemption that is not anchored to a root-level filename takes the gate off the app.
ok('a nested path is never exempted by its extension',
  ['/x/y.png', '/x/y/z.svg', '/one/two/three/four.ico'].every(gated))
ok('a root-level asset is exempted', !gated('/anything-at-all.png'))
ok('a root-level path with no extension is gated', gated('/anything-at-all'))
// A dot in a path segment is not an extension at the root.
ok('a nested dotted path is gated', gated('/unit/2201.a/photo.png'))

console.log((fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed')
if (fail) process.exit(1)
