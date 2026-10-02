// node lib/eve/__tests__/reminders-time.test.mjs — South Florida wall time → instant, across DST.
// etLocalToUtc lives in a server-only module; the pure part is re-implemented here from the same source
// via a tiny extraction so the conversion itself is what is tested.
import fs from 'node:fs'
const src = fs.readFileSync(new URL('../reminders.ts', import.meta.url), 'utf8')
const body = src.slice(src.indexOf('export function etLocalToUtc'), src.indexOf('export function fmtET'))
const fn = new Function('ET', body.replace('export function etLocalToUtc', 'return function etLocalToUtc').replace(/: Date \| null|: string/g, '').replace(/\[y, mo, d, h, mi\]/, '[y, mo, d, h, mi]'))('America/New_York')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log('  FAIL  ' + n + '  ' + x) } }
ok('EDT: 11:00 ET = 15:00Z', fn('2026-10-01 11:00').toISOString() === '2026-10-01T15:00:00.000Z', fn('2026-10-01 11:00').toISOString())
ok('EST: 11:00 ET = 16:00Z', fn('2026-12-15 11:00').toISOString() === '2026-12-15T16:00:00.000Z', fn('2026-12-15 11:00').toISOString())
ok('midnight rolls the date', fn('2026-10-01 23:30').toISOString() === '2026-10-02T03:30:00.000Z')
ok('T separator works', fn('2026-10-01T09:05').toISOString() === '2026-10-01T13:05:00.000Z')
ok('garbage → null', fn('eleven') === null)
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
