// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
// The adx modules import each other without file extensions (as the rest of the app does). Node needs the extension,
// so the tests add ".ts" to extensionless relative imports before loading. Nothing else is changed.
import { registerHooks } from 'node:module'
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) { try { return nextResolve(specifier + '.ts', context) } catch { /* fall through */ } }
    return nextResolve(specifier, context)
  },
})
export function suite(name) {
  let pass = 0, fail = 0
  const ok = (label, cond, detail) => { if (cond) pass++; else { fail++; console.log(`  FAIL  ${label}${detail !== undefined ? '\n        ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`) } }
  const eq = (label, got, want) => ok(label, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)
  const done = () => { console.log(`${name}: ${pass} passed, ${fail} failed`); if (fail) process.exit(1) }
  return { ok, eq, done }
}
