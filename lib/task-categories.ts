// WHAT KIND OF WORK IS THIS — one definition, used by the board and by the briefs, and editable
// without a deploy.
//
// Jon, 2026-08-25, on the Today-in-Ops counters: "it should be broken out not just by Cleans,
// Maintenance, Inspections." Then 2026-08-26: "Claude can be used but not always needed." Those two
// together are the whole design. The categories ARE the shape of a day here, they change when the
// business changes — a new vendor service, a new kind of walk — and deciding one should not require
// me. So the rules are data with a code default underneath, exactly like the sidebar:
//
//   • The DEFAULTS below are the shipped behaviour and are what runs when nothing is saved.
//   • A saved config REPLACES the category list wholesale (it is a list, not a patch — you are
//     editing the taxonomy itself, and a half-merged taxonomy is worse than either version).
//   • `fallback: true` marks the one category everything unmatched lands in. Exactly one always
//     wins that job; if a saved config forgets to mark one, the last category takes it, because a
//     task with no category at all would silently vanish from every counter.
//
// RULE SEMANTICS, stated once because everything downstream depends on it:
//   – Categories are tried IN ORDER; the first match wins. Order is the whole rule set.
//   – A category matches if ANY of its rules match (OR).
//   – A rule matches if EVERY condition it names matches (AND).
//   – `name` and `dept` are case-insensitive regular expressions; `type` is an exact list.
//
// WHY ORDER MATTERS AND IS NOT COSMETIC: a glitch arrives from Breezeway as a MAINTENANCE task
// named "Guest Reported / Glitch — ...". If Maintenance were tried first, every guest-impacting
// problem in the portfolio would be filed under Maintenance and disappear from the one counter that
// exists to surface them. Name beats department here on purpose.
export type TaskCat = string

export type CatRule = {
  name?: string          // regex against the task name
  dept?: string          // regex against the department
  type?: string[]        // exact match against our derived task type
}
export type CatDef = {
  key: string
  label: string
  icon: string           // a name from CAT_ICONS; unknown names fall back to a generic glyph
  rules: CatRule[]
  fallback?: boolean
}

/** The glyphs a category may use. Names, not components, so this file stays free of React. */
export const CAT_ICONS = [
  'door', 'sparkles', 'bolt', 'wrench', 'clipboard-check', 'clipboard-list',
  'droplet', 'bug', 'hammer', 'key', 'shield', 'package', 'star', 'bed',
] as const

// ── THE SHIPPED TAXONOMY ────────────────────────────────────────────────────────────────────────
// Guest issues and glitches are ONE category (Jon, 2026-08-25: "what's the difference of guest
// issues and glitches, nothing, so combine"). The proof is in the data: Breezeway sends them as a
// single task named "Guest Reported / Glitch — ", so splitting on which half of that prefix
// somebody typed was counting one queue twice.
export const DEFAULT_CATS: CatDef[] = [
  {
    key: 'departure', label: 'Departure', icon: 'door',
    rules: [
      { type: ['departure_clean'] },
      // The separator is whatever whoever typed the task felt like: "Check-out clean", "Check out
      // clean", "Checkout Clean" all appear in the wild. [\s-]? catches all three; a bare -? caught
      // only one, and the misses landed in Cleaning — which is the number the 4pm deadline is
      // measured against, so they were invisible in the place it mattered most.
      { name: 'departure clean|turnover clean|check[\\s-]?out clean|move[\\s-]?out clean' },
    ],
  },
  {
    key: 'glitch', label: 'Glitches', icon: 'bolt',
    rules: [{ name: 'glitch|guest\\s*reported' }],
  },
  {
    key: 'hkaudit', label: 'Housekeeping audit', icon: 'clipboard-check',
    rules: [
      { name: 'housekeep\\w*\\s*audit|audit\\s*\\W*\\s*housekeep' },
      { type: ['audit'], dept: 'housekeep' },
    ],
  },
  {
    key: 'cleaning', label: 'Cleaning', icon: 'sparkles',
    rules: [{ dept: 'housekeep|clean' }, { type: ['strip', 'deep_clean'] }],
  },
  {
    key: 'inspection', label: 'Inspection', icon: 'clipboard-list',
    rules: [{ type: ['inspection', 'audit'] }, { dept: 'inspect' }, { name: 'unit check|inspect' }],
  },
  {
    key: 'maintenance', label: 'Maintenance', icon: 'wrench',
    rules: [], fallback: true,
  },
]

export const TASK_CATS_KEY = 'task_categories'

const isObj = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v)
const safeRe = (src: any): RegExp | null => {
  const s = String(src == null ? '' : src).trim()
  if (!s) return null
  // A bad pattern typed into the editor must never take the board down — it just never matches,
  // and the editor's tester shows the operator that it is not doing anything.
  try { return new RegExp(s, 'i') } catch { return null }
}

/** Accept a saved config only if it is usable; otherwise fall back to the shipped taxonomy. */
export function resolveCats(saved: any): CatDef[] {
  if (!Array.isArray(saved) || !saved.length) return DEFAULT_CATS
  const out: CatDef[] = []
  for (const c of saved.slice(0, 24)) {
    if (!isObj(c)) continue
    const key = String(c.key || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24)
    const label = String(c.label || '').trim().slice(0, 32)
    if (!key || !label) continue
    const rules: CatRule[] = []
    for (const r of (Array.isArray(c.rules) ? c.rules.slice(0, 12) : [])) {
      if (!isObj(r)) continue
      const rule: CatRule = {}
      if (typeof r.name === 'string' && r.name.trim()) rule.name = r.name.trim().slice(0, 300)
      if (typeof r.dept === 'string' && r.dept.trim()) rule.dept = r.dept.trim().slice(0, 120)
      if (Array.isArray(r.type)) {
        const t = r.type.map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 12)
        if (t.length) rule.type = t
      }
      if (Object.keys(rule).length) rules.push(rule)
    }
    out.push({
      key, label,
      icon: (CAT_ICONS as readonly string[]).indexOf(String(c.icon)) >= 0 ? String(c.icon) : 'wrench',
      rules, fallback: c.fallback === true,
    })
  }
  if (!out.length) return DEFAULT_CATS
  // Exactly one fallback, always. Without it a task that matches nothing has no category, and a
  // task with no category is one that quietly stops being counted anywhere.
  if (!out.some(c => c.fallback)) out[out.length - 1].fallback = true
  else { let seen = false; for (const c of out) { if (c.fallback) { if (seen) c.fallback = false; seen = true } } }
  return out
}

/** Which category a task belongs to, against a given taxonomy. First match wins. */
export function catOfTaskWith(cats: CatDef[], t: { name?: string | null; dept?: string | null; type?: string | null }): string {
  const n = String(t.name || '')
  const dept = String(t.dept || '')
  const type = String(t.type || '')
  for (const c of cats) {
    for (const r of c.rules) {
      if (r.name) { const re = safeRe(r.name); if (!re || !re.test(n)) continue }
      if (r.dept) { const re = safeRe(r.dept); if (!re || !re.test(dept)) continue }
      if (r.type && r.type.indexOf(type) < 0) continue
      if (!r.name && !r.dept && !r.type) continue     // an empty rule matches nothing, not everything
      return c.key
    }
  }
  const fb = cats.find(c => c.fallback) || cats[cats.length - 1]
  return fb ? fb.key : 'maintenance'
}

/** The shipped taxonomy, for callers with no saved config in hand. */
export function catOfTask(t: { name?: string | null; dept?: string | null; type?: string | null }): string {
  return catOfTaskWith(DEFAULT_CATS, t)
}

export const CAT_ORDER: string[] = DEFAULT_CATS.map(c => c.key)
export const CAT_LABEL: Record<string, string> = DEFAULT_CATS.reduce((m, c) => { m[c.key] = c.label; return m }, {} as Record<string, string>)

/** Finished / in progress / not started, from whatever a Breezeway row happens to carry. */
export function stateOfTask(t: { status?: any; started_at?: any; finished_at?: any }): 'done' | 'running' | 'open' {
  const s = String(t.status == null ? '' : t.status).toLowerCase()
  if (/complete|finish|close|approv/.test(s) || t.finished_at) return 'done'
  if (/progress|started/.test(s) || t.started_at) return 'running'
  return 'open'
}
