// CONSUMABLES ARE NOT ON THE OWNER'S LIST (Jon, 2026-10-28: "consumables don't matter and should not
// be on the list"). Paper goods, bath amenities and refills, cleaning products, coffee, batteries and
// bulbs are stocked by the team, so they never appear on an owner's catalog link, in the owner's
// estimate, or in the onboarding (preset) order built from a catalog. The team still sees them on the
// catalog page, in their own section.
//
// Shared by the server and the pages, so it imports nothing.
const CONSUMABLE_CATEGORIES = new Set(['Paper & consumables', 'Bath amenities', 'Cleaning supplies', 'Consumables'])
// Durable tools that were filed under "Cleaning supplies" — these stay on the list.
const DURABLE = new Set(['ess-broom', 'ess-mop', 'ess-toilet-brush', 'ess-laundry-basket'])
const CONSUMABLE_KEYS = new Set(['ess-batteries', 'ess-light-bulbs', 'ess-coffee-filters', 'ess-lint-roller', 'ess-air-freshener',
  'ess-all-purpose-cleaner', 'ess-glass-cleaner', 'ess-bathroom-cleaner', 'ess-disinfecting-wipes'])

export function isConsumable(it: { key: string; category: string }): boolean {
  if (DURABLE.has(it.key)) return false
  return /^am-\d+$/.test(it.key) || CONSUMABLE_KEYS.has(it.key) || CONSUMABLE_CATEGORIES.has(it.category)
}
