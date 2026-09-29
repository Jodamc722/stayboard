// EASTERN TIME FOR THE JOBS THAT SEND TO PEOPLE.
//
// Vercel cron is UTC and does not move with daylight saving. A job meant for 7:01am in New York is
// 11:01 UTC under EDT and 12:01 UTC under EST (from the first Sunday in November to the second
// Sunday in March), so a single UTC line is an hour wrong for half of every year. Each of those
// jobs is therefore scheduled at BOTH candidate UTC hours (vercel.json `1 11,12 * * *`) and, on the
// scheduler's own call only, the route asks here whether it really is that hour in New York. The
// other fire — the daylight-saving twin — returns before doing anything: no work, no receipt, no
// send. A person's "Run now", preview, test or re-send carries no bearer and is never skipped.
// /api/cron/ops-focus and /api/cron/stay-window already decide their hours the same way.
//
// Pure on purpose (no server imports), so a plain node script can prove a schedule: every hour
// across both daylight-saving edges gives exactly one run per job per Eastern day.
const TZ = 'America/New_York'
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** The New York wall clock at `now`: hour 0–23, weekday 0 (Sunday)–6, and the YYYY-MM-DD date. */
export function easternNow(now: Date = new Date()): { hour: number; dow: number; ymd: string } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' })
  const p: Record<string, string> = {}
  for (const x of f.formatToParts(now)) p[x.type] = x.value
  const h = Number(p.hour)
  // Some ICU builds print midnight as "24" under hour12:false.
  return { hour: h === 24 ? 0 : h, dow: DOW[p.weekday] ?? -1, ymd: p.year + '-' + p.month + '-' + p.day }
}

/** Is it `hour` o'clock in New York at `now` — and, when `dow` is given, that weekday (0 = Sunday)? */
export function atEasternHour(hour: number, dow?: number, now: Date = new Date()): boolean {
  const e = easternNow(now)
  return e.hour === hour && (dow === undefined || e.dow === dow)
}
