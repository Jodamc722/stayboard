// BULK-EDITING THE LISTING SECTIONS THAT ARE NOT REALLY ABOUT THE UNIT.
//
// Jon, 2026-09-16: "add a feature that allows us to bulk edit additional notes: getting around and
// about the location... across multiple listings at the property level", then the rule that decides
// this whole file: "Neighborhood, getting around, and guest access should be only capable at the
// property level, and at the entire portfolio level you should be able to edit the other notes
// section", and "At the portfolio level, you should be able to select only properties, not
// individual listings."
//
// WHY THE SCOPE IS A PROPERTY OF THE SECTION AND NOT A CHOICE ON A SCREEN. Three of these sections
// describe a place, not a home. Guest access is the lobby, the fob and the elevator. Neighborhood is
// the block. Getting around is the rideshare corner and the walk to the beach. Every unit in a tower
// shares all three and none of them can be true for unit 2201 and false for 2202 — so they belong to
// the building and may only be written a building at a time. Other notes is the house's boilerplate,
// the same sentence everywhere, so it is written across properties. Put the rule in code and a badly
// built screen cannot break it.
//
// WHAT THE PORTFOLIO LOOKED LIKE THE DAY THIS WAS WRITTEN — the reason it is worth building:
//
//   Elser     32 units    7 different "getting around" texts   11 different "neighborhood"
//   Eden      29 units   27                                    29   (essentially all different)
//   17WEST    26 units   11                                    11   and 15 units blank on both
//   Rustic    24 units   12                                    12
//   Waves     18 units    4                                     5
//   Botanica  15 units    2                                     4
//
// One building, one block, one lobby — and eleven descriptions of it. Nobody chose that; it is what
// happens when the only way to edit is one listing at a time.
//
// SELECTION IS THE SAFETY VALVE. Jon chose "replace everything selected": the text you approve wins
// on every unit you ticked, no per-field merging and no clever appending. That is only safe if the
// picker shows what is about to be overwritten and if nothing is ever selected on the person's
// behalf beyond the building they opened — so this module also builds the plan the UI shows, and a
// section whose text is already identical is not written at all.

export type BulkScope = 'property' | 'portfolio'
export type BulkSectionKey = 'access' | 'neighborhood' | 'transit' | 'notes'

export type BulkSection = {
  key: BulkSectionKey
  label: string                 // the words on the screen, matching Guesty's own section list
  /**
   * The levels this section may be bulk edited from. Three of them describe a building and are
   * property-only. Other notes is editable at BOTH — Jon, 2026-09-16: "make sure that 'Other things
   * to note' is on that list too, because right now I only see three." A property can have its own
   * note (the pool is closed through November) and the house can have boilerplate that reads the
   * same everywhere; neither cancels the other, so the section belongs at both levels and the level
   * you are standing on decides which listings it reaches.
   */
  scopes: BulkScope[]
  hint: string
  rows: number
  max: number
}

// Guesty's publicDescription keys. The labels are Guesty's own, so what a person edits here reads
// the same as what they see in Guesty.
export const BULK_SECTIONS: BulkSection[] = [
  {
    key: 'access', label: 'Guest access', scopes: ['property'], rows: 5, max: 2000,
    hint: 'Lobby entry, fob or code, elevator, which floors, amenity access — the parts every unit in the building shares.',
  },
  {
    key: 'neighborhood', label: 'Neighborhood', scopes: ['property'], rows: 6, max: 2000,
    hint: 'The block: what is walkable, what the area is actually like, the beach or the water if there is one.',
  },
  {
    key: 'transit', label: 'Getting around', scopes: ['property'], rows: 5, max: 2000,
    hint: 'Rideshare pickup, parking, transit, the airport run, what you can reach on foot.',
  },
  {
    key: 'notes', label: 'Other notes', scopes: ['property', 'portfolio'], rows: 5, max: 2000,
    hint: 'Anything else a guest should know. Set it for one property, or across properties when it reads the same everywhere.',
  },
]

const BY_KEY = new Map(BULK_SECTIONS.map(s => [s.key, s]))

export function sectionOf(key: string): BulkSection | null { return BY_KEY.get(key as BulkSectionKey) || null }
export function scopesOf(key: string): BulkScope[] { return BY_KEY.get(key as BulkSectionKey)?.scopes || [] }
export function allowedAt(key: string, scope: BulkScope): boolean { return scopesOf(key).indexOf(scope) >= 0 }
export function sectionsForScope(scope: BulkScope): BulkSection[] { return BULK_SECTIONS.filter(s => allowedAt(s.key, scope)) }

/** One listing as the picker sees it: what it is, where it is, and what it says today. */
export type CopyTarget = {
  id: string
  name: string
  building: string
  current: Partial<Record<BulkSectionKey, string>>
}

export type PlanAction = 'write' | 'same'
export type PlanRow = {
  id: string
  name: string
  building: string
  section: BulkSectionKey
  before: string
  after: string
  action: PlanAction
}

export type BulkPlan = {
  rows: PlanRow[]
  writes: number          // sections that will actually be sent to Guesty
  unchanged: number       // already identical — deliberately not written
  listings: number        // listings that will receive at least one write
}

export const norm = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\r\n/g, '\n').trim()

/**
 * What this edit would do, listing by listing and section by section.
 *
 * A section whose text already matches is marked 'same' and never sent: pushing identical copy to
 * Guesty burns rate limit, stamps a modification date on a listing nobody changed, and makes the
 * result screen lie about how much work was done.
 */
export function planBulk(targets: CopyTarget[], edits: Partial<Record<BulkSectionKey, string>>): BulkPlan {
  const rows: PlanRow[] = []
  const touched = new Set<string>()
  let writes = 0, unchanged = 0

  const active = (Object.keys(edits) as BulkSectionKey[])
    .filter(k => BY_KEY.has(k))
    .filter(k => norm(edits[k]).length > 0)

  for (const t of targets) {
    for (const k of active) {
      const after = norm(edits[k])
      const before = norm(t.current?.[k])
      const action: PlanAction = before === after ? 'same' : 'write'
      if (action === 'write') { writes++; touched.add(t.id) } else unchanged++
      rows.push({ id: t.id, name: t.name, building: t.building, section: k, before, after, action })
    }
  }
  return { rows, writes, unchanged, listings: touched.size }
}

/**
 * THE RULE, ENFORCED. Returns a human sentence when a request breaks the scope Jon set, or null
 * when it is allowed. Called by the API before anything reaches Guesty, so the constraint survives
 * a rebuilt screen, a stale tab, or someone posting to the endpoint directly.
 *
 * `rosterByBuilding` is how many listings each touched building actually has — the portfolio rule
 * ("properties, not individual listings") cannot be checked without it.
 */
export function scopeError(
  sectionKeys: string[],
  targets: CopyTarget[],
  rosterByBuilding: Record<string, number>,
  scope: BulkScope = 'property',
): string | null {
  if (!targets.length) return 'Nothing selected.'
  // Name the bad key back rather than saying "no section" — a caller that sent 'title' has a bug
  // worth reading, and a silent "nothing to do" hides it.
  const unknown = sectionKeys.find(k => !BY_KEY.has(k as BulkSectionKey))
  if (unknown) return 'That section cannot be bulk edited: ' + unknown
  const keys = sectionKeys.filter(k => BY_KEY.has(k as BulkSectionKey)) as BulkSectionKey[]
  if (!keys.length) return 'No editable section named.'

  // A section that does not live at this level is refused by name. Guest access, Neighborhood and
  // Getting around describe one building; there is no honest way to write them across the portfolio.
  const wrongLevel = keys.filter(k => !allowedAt(k, scope))
  if (wrongLevel.length) {
    return wrongLevel.map(k => BY_KEY.get(k)!.label).join(', ')
      + (wrongLevel.length === 1 ? ' can' : ' can')
      + ' only be set one property at a time — open the property and edit it there.'
  }

  const buildings = Array.from(new Set(targets.map(t => norm(t.building))))
  if (buildings.some(b => !b)) return 'Some selected listings have no property set, so they cannot be bulk edited. Set the building in Guesty first.'

  if (scope === 'property') {
    // One building at a time. Inside it you pick units freely — that is the level where picking
    // units is offered.
    if (buildings.length > 1) {
      return 'A property edit reaches one property — this selection spans ' + buildings.length + '.'
    }
    return null
  }

  // Portfolio. The unit of selection up here is the property, so a partial building means somebody
  // picked units, which is the thing that is not offered at this level.
  for (const b of buildings) {
    const have = targets.filter(t => norm(t.building) === b).length
    const roster = rosterByBuilding[b]
    if (typeof roster === 'number' && have < roster) {
      return 'At the portfolio level whole properties are selected, not individual units — ' + b
        + ' has ' + roster + ' listings and only ' + have + ' are selected.'
    }
  }
  return null
}

/** Too long for Guesty, or empty. Returns a sentence per offending section, or an empty array. */
export function lengthErrors(edits: Partial<Record<BulkSectionKey, string>>): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(edits) as [BulkSectionKey, string][]) {
    const sec = BY_KEY.get(k)
    if (!sec) continue
    const n = norm(v)
    if (n.length > sec.max) out.push(sec.label + ' is ' + n.length + ' characters — the limit is ' + sec.max + '.')
  }
  return out
}

/** Which units have drifted off the property's saved standard, so the panel can say so. */
export function driftFrom(
  standard: Partial<Record<BulkSectionKey, string>>,
  targets: CopyTarget[],
): { id: string; name: string; sections: BulkSectionKey[] }[] {
  const keys = (Object.keys(standard) as BulkSectionKey[]).filter(k => BY_KEY.has(k) && norm(standard[k]))
  if (!keys.length) return []
  const out: { id: string; name: string; sections: BulkSectionKey[] }[] = []
  for (const t of targets) {
    const off = keys.filter(k => norm(t.current?.[k]) !== norm(standard[k]))
    if (off.length) out.push({ id: t.id, name: t.name, sections: off })
  }
  return out
}
