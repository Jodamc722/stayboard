// lib/homebase.ts
// Homebase public API client for the Morning Ops Brief.
//
// Setup (Vercel → Settings → Environment Variables):
//   HOMEBASE_API_KEY        - from Homebase Settings → API (never commit this)
//   HOMEBASE_LOCATION_UUID  - optional; if unset we resolve the first location
//
// The public API lives under app.joinhomebase.com/api/public and expects:
//   Authorization: Bearer <key>
//   Accept: application/vnd.homebase-v1+json
// Field names in responses vary slightly between accounts, so every accessor
// below is tolerant — it probes multiple key spellings and degrades to null
// rather than throwing.

const BASE = process.env.HOMEBASE_BASE_URL || 'https://app.joinhomebase.com/api/public'

type Json = any

async function hb(path: string): Promise<Json> {
  const key = process.env.HOMEBASE_API_KEY || process.env['Homebase_Secret_id']
  if (!key) throw new Error('HOMEBASE_API_KEY is not set')
  const r = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/vnd.homebase-v1+json',
    },
    cache: 'no-store',
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`Homebase ${r.status} on ${path}: ${body.slice(0, 200)}`)
  }
  return r.json()
}

function arr(d: Json): Json[] {
  if (Array.isArray(d)) return d
  for (const k of ['data', 'shifts', 'employees', 'locations', 'results', 'timecards'])
    if (Array.isArray(d?.[k])) return d[k]
  return []
}

const pick = (o: Json, ...keys: string[]) => {
  for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]
  return null
}

export async function getLocationUuid(): Promise<string> {
  const fixed = process.env.HOMEBASE_LOCATION_UUID
  if (fixed) return fixed
  const locs = arr(await hb('/locations'))
  const uuid = pick(locs[0] || {}, 'uuid', 'id', 'location_uuid')
  if (!uuid) throw new Error('No Homebase locations visible to this API key')
  return String(uuid)
}

// Employee names for the location - used to tell in-house staff from outside vendors
// (billing crew split) and anywhere else we need the roster.
export async function getEmployeeNames(): Promise<string[]> {
  const loc = await getLocationUuid()
  const raw = arr(await hb('/locations/' + loc + '/employees'))
  const out: string[] = []
  for (const e of raw) {
    const first = pick(e, 'first_name', 'firstName')
    const last = pick(e, 'last_name', 'lastName')
    const n = (String(first || '') + ' ' + String(last || '')).trim()
    if (n) out.push(n)
  }
  return out
}

export type Shift = {
  name: string
  role: string | null
  department: string | null
  startAt: string | null   // ISO
  endAt: string | null
  label: string            // "8:00 AM – 5:30 PM"
  open: boolean            // unfilled/open shift
  wageRate?: number | null
  scheduledCost?: number | null   // Homebase labor.scheduled_costs — forecast payroll for this shift
}

function fmt(t: string | null, tz: string): string {
  if (!t) return '?'
  try {
    return new Date(t).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: tz,
    })
  } catch { return '?' }
}

/** All shifts for one calendar day (YYYY-MM-DD), sorted by start time. */
export async function getShifts(date: string, tz = 'America/New_York'): Promise<Shift[]> {
  const loc = await getLocationUuid()
  const raw = arr(await hb(
    `/locations/${loc}/shifts?start_date=${date}&end_date=${date}&with_note=true`
  ))
  const shifts = raw.map((s: Json): Shift => {
    const first = pick(s, 'first_name', 'firstName')
    const last = pick(s, 'last_name', 'lastName')
    const nested = pick(s, 'employee', 'user') || {}
    const name =
      [first, last].filter(Boolean).join(' ') ||
      pick(nested, 'name', 'full_name') ||
      [pick(nested, 'first_name'), pick(nested, 'last_name')].filter(Boolean).join(' ') ||
      ''
    const startAt = pick(s, 'start_at', 'starts_at', 'start_time', 'startAt')
    const endAt = pick(s, 'end_at', 'ends_at', 'end_time', 'endAt')
    return {
      name: name || 'Open shift',
      role: pick(s, 'role', 'position', 'job_role'),
      department: pick(s, 'department', 'team'),
      startAt, endAt,
      label: `${fmt(startAt, tz)} – ${fmt(endAt, tz)}`,
      open: !name,
      wageRate: Number.isFinite(Number(s.wage_rate)) ? Number(s.wage_rate) : null,
      scheduledCost: s.labor && Number.isFinite(Number((s.labor as any).scheduled_costs)) ? Number((s.labor as any).scheduled_costs) : null,
    }
  })
  return shifts.sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)))
}

// ---------------------------------------------------------------------------
// Cross-check: cleaning board vs who is actually scheduled.
// Names come from two systems typed by two sets of humans, so match loosely:
// case-insensitive, first name + first letter of last name when present.
// ---------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

// Small edit distance for typo tolerance ('Rodiguez' vs 'Rodriguez',
// 'Yunisleydi' vs 'Yunisleidy'). Names come from two systems typed by hand.
function editDist(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev: number[] = []
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

const nearWord = (x: string, y: string): boolean => {
  if (x === y) return true
  if (x.length < 4 || y.length < 4) return false
  return editDist(x, y) <= (Math.min(x.length, y.length) >= 6 ? 2 : 1)
}

// Same person if first names match (exact or a typo apart) and last names agree
// (same word, a typo apart, or at least the same initial). Tolerates double
// spaces, accents, and swapped first/last order.
export function nameMatches(a: string, b: string): boolean {
  const A = norm(a).split(/\s+/).filter(Boolean)
  const B = norm(b).split(/\s+/).filter(Boolean)
  if (!A.length || !B.length) return false
  if (A.join(' ') === B.join(' ')) return true
  const af = A[0], bf = B[0]
  const al = A.length > 1 ? A[A.length - 1] : ''
  const bl = B.length > 1 ? B[B.length - 1] : ''
  const firstOk = nearWord(af, bf)
  if (firstOk && (!al || !bl)) return true            // only a first name on one side
  const lastOk = !!al && !!bl && (nearWord(al, bl) || al[0] === bl[0])
  if (firstOk && lastOk) return true
  // swapped order ('Perez Yunisleidy')
  return !!al && !!bl && nearWord(af, bl) && nearWord(al, bf)
}

// Roster-aware last-ditch match: an external (Breezeway) name whose FIRST name
// matches exactly ONE person on the Homebase roster counts as that person, even
// when the last names disagree - catches married/maiden-name drift between the
// two systems ('Shaany Espinoza' vs 'Shaany Christian'). Ambiguous first names
// (two Marias) never match this way. Returns the roster name, or null.
export function nameMatchesRoster(external: string, roster: string[]): string | null {
  for (const r of roster) if (nameMatches(external, r)) return r
  const ef = norm(external).split(/\s+/).filter(Boolean)[0]
  if (!ef || ef.length < 4) return null
  const hits: string[] = []
  for (const r of roster) {
    const rf = norm(r).split(/\s+/).filter(Boolean)[0]
    if (rf && nearWord(ef, rf) && hits.indexOf(r) < 0) hits.push(r)
  }
  return hits.length === 1 ? hits[0] : null
}

export type StaffingCheck = {
  onShift: Shift[]
  /** Cleaners with a clean on the board today but no Homebase shift. */
  assignedNotScheduled: { cleaner: string; units: string[] }[]
  /** People on shift (role ~ cleaner) with no clean assigned — free capacity. */
  scheduledNoAssignment: Shift[]
}

export function crossCheck(
  shifts: Shift[],
  cleans: { unit: string; cleaner: string | null }[],
): StaffingCheck {
  const cleanersOnBoard = new Map<string, string[]>()
  for (const c of cleans) {
    if (!c.cleaner) continue
    const key = c.cleaner
    cleanersOnBoard.set(key, [...(cleanersOnBoard.get(key) || []), c.unit])
  }

  const assignedNotScheduled = Array.from(cleanersOnBoard.entries())
    .filter(([cleaner]) => !shifts.some(s => !s.open && nameMatches(s.name, cleaner)))
    .map(([cleaner, units]) => ({ cleaner, units }))

  const looksLikeCleaner = (s: Shift) =>
    !s.role || /clean|housekeep|turn/i.test(`${s.role} ${s.department}`)

  const scheduledNoAssignment = shifts.filter(s =>
    !s.open &&
    looksLikeCleaner(s) &&
    !Array.from(cleanersOnBoard.keys()).some(c => nameMatches(s.name, c))
  )

  return { onShift: shifts, assignedNotScheduled, scheduledNoAssignment }
}
