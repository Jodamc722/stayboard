// THE SIDEBAR IS DATA NOW, NOT CODE.
//
// Jon reorganised the nav three times in one week — Guidebooks out of a tab set, Guest Orders out
// of Orders, the whole Guest Comms row dissolved, Projections retired, Team flattened — and every
// one of those was a code change, a build and a deploy for what is a two-minute opinion about where
// something belongs. "Claude can be used but not always needed" (2026-08-26). Moving a tab is the
// clearest case of *not needed*.
//
// ── HOW IT WORKS ────────────────────────────────────────────────────────────────────────────────
// The code still owns the DEFAULT sidebar (components/Shell.tsx). This file holds a thin OVERRIDE
// saved in app_settings, and merges the two. That direction matters:
//
//   • A page added in code appears immediately, without anyone touching the override.
//   • The override only ever says "this one is called X / lives in section Y / sits at position Z /
//     is hidden" — it never lists the full nav, so it cannot go stale and hide a new page.
//   • Anything the override mentions that no longer exists is ignored, so deleting a page in code
//     does not leave a ghost row behind.
//   • Clearing the override restores the shipped sidebar exactly.
//
// WHAT IT DELIBERATELY CANNOT DO: change what anyone is allowed to see. Visibility is decided by
// role levels against the feature key for a path (lib/features.ts) and enforced by middleware and
// every API route. Hiding a row here is cosmetic — it takes a page off YOUR sidebar, it does not
// revoke access to it, and the Jump-to palette still finds it. Anything else would make this a
// security control wearing a layout control's clothes.
export const NAV_LAYOUT_KEY = 'nav_layout'

export type NavItemOverride = {
  label?: string        // rename the row
  section?: string      // move it to another section (an unknown title creates that section)
  order?: number        // position within its section; lower first
  hidden?: boolean      // off this sidebar — NOT a permission
}

export type NavLayout = {
  /** Section titles in the order they should appear. Titles missing here keep their code order, after these. */
  sections?: string[]
  /** Keyed by the item's path, e.g. '/plan'. */
  items?: Record<string, NavItemOverride>
  updatedAt?: string
  updatedBy?: string | null
}

const isObj = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v)

/** Accept only what we understand, so a hand-edited row can never break the sidebar. */
export function normNavLayout(raw: any): NavLayout {
  if (!isObj(raw)) return {}
  const out: NavLayout = {}
  if (Array.isArray(raw.sections)) {
    out.sections = raw.sections.map((s: any) => String(s || '').trim()).filter(Boolean).slice(0, 24)
  }
  if (isObj(raw.items)) {
    const items: Record<string, NavItemOverride> = {}
    for (const k of Object.keys(raw.items).slice(0, 200)) {
      const path = String(k || '').trim()
      if (!path.startsWith('/')) continue
      const v = raw.items[k]
      if (!isObj(v)) continue
      const o: NavItemOverride = {}
      if (typeof v.label === 'string' && v.label.trim()) o.label = v.label.trim().slice(0, 40)
      if (typeof v.section === 'string' && v.section.trim()) o.section = v.section.trim().slice(0, 32)
      const n = Number(v.order)
      if (Number.isFinite(n)) o.order = Math.max(0, Math.min(999, Math.round(n)))
      if (v.hidden === true) o.hidden = true
      if (Object.keys(o).length) items[path] = o
    }
    out.items = items
  }
  if (typeof raw.updatedAt === 'string') out.updatedAt = raw.updatedAt
  if (typeof raw.updatedBy === 'string') out.updatedBy = raw.updatedBy
  return out
}

type Sec<I> = { title: string; items: I[] }

/**
 * Merge an override over the code defaults. Generic over the item type so Shell can pass its own
 * NavItem (icons and all) and get the same shape back — this file stays free of JSX and of any
 * knowledge of what an item contains beyond `to` and `label`.
 */
export function applyNavLayout<I extends { to: string; label: string }>(
  defaults: Sec<I>[],
  layout: NavLayout | null | undefined,
): Sec<I>[] {
  const L = normNavLayout(layout)
  const ov = L.items || {}

  // 1. Flatten, remembering where each item started, so anything unmentioned keeps its place.
  type Row = { item: I; section: string; order: number }
  const rows: Row[] = []
  defaults.forEach((sec, si) => sec.items.forEach((item, ii) => {
    const o = ov[item.to] || {}
    if (o.hidden) return
    rows.push({
      item: o.label ? ({ ...item, label: o.label } as I) : item,
      section: o.section || sec.title,
      // Untouched rows keep a stable, well-spaced position (section index × 1000 + index × 10) so
      // a single moved item can be slotted between two others without renumbering everything.
      order: o.order != null ? o.order : si * 1000 + ii * 10,
    })
  }))

  // 2. Regroup.
  const bySection = new Map<string, Row[]>()
  for (const r of rows) {
    if (!bySection.has(r.section)) bySection.set(r.section, [])
    bySection.get(r.section)!.push(r)
  }

  // 3. Section order: the override's list first, then any section it did not mention, in code order.
  const wanted = (L.sections || []).filter(t => bySection.has(t))
  const rest = Array.from(bySection.keys()).filter(t => wanted.indexOf(t) < 0)
  const restInCodeOrder = defaults.map(s => s.title).filter(t => rest.indexOf(t) >= 0)
    .concat(rest.filter(t => defaults.every(s => s.title !== t)))   // sections invented by the override

  return wanted.concat(restInCodeOrder).map(title => ({
    title,
    items: (bySection.get(title) || []).slice().sort((a, b) => a.order - b.order).map(r => r.item),
  })).filter(s => s.items.length > 0)
}
