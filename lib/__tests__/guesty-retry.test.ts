// HOW LONG TO WAIT WHEN GUESTY SAYS SLOW DOWN.
// Run: npx tsx lib/__tests__/guesty-retry.test.ts
import { retryDelay, isRateLimited } from '../guesty-retry'

let failed = 0
const eq = (why: string, got: any, want: any) => { if (got !== want) { console.log(`FAIL ${why}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); failed++ } }
const CAP = 8000
const NOW = Date.parse('2026-09-17T15:23:00Z')

// Guesty says how long. We listen — a server that names a number knows better than our arithmetic.
eq('retry-after seconds',        retryDelay('30', 1, CAP, NOW), 8000)   // capped
eq('retry-after 2s',             retryDelay('2', 1, CAP, NOW), 2000)
eq('retry-after 0',              retryDelay('0', 3, CAP, NOW), 0)
eq('retry-after as a date',      retryDelay('Thu, 17 Sep 2026 15:23:03 GMT', 1, CAP, NOW), 3000)
eq('a date already past',        retryDelay('Thu, 17 Sep 2026 15:22:00 GMT', 1, CAP, NOW), 0)

// No header: back off, and grow.
eq('no header, first attempt',   retryDelay(null, 1, CAP, NOW), 1000)
eq('no header, second',          retryDelay(null, 2, CAP, NOW), 2000)
eq('no header, third',           retryDelay(null, 3, CAP, NOW), 4000)
eq('no header, capped',          retryDelay(null, 9, CAP, NOW), 8000)
eq('jitter is added',            retryDelay(null, 1, CAP, NOW, 250), 1250)

// Junk in the header must not be taken as "wait zero" — that would hammer a server asking for calm.
eq('unparseable header',         retryDelay('soon', 2, CAP, NOW), 2000)
eq('empty header',               retryDelay('', 2, CAP, NOW), 2000)
eq('negative seconds',           retryDelay('-5', 2, CAP, NOW), 2000)

eq('429 is the rate limit',      isRateLimited(429), true)
eq('503 is not',                 isRateLimited(503), false)

console.log(failed ? `\n${failed} retry check(s) failed.` : '\nAll Guesty retry checks passed.')
process.exit(failed ? 1 : 0)
