// THE ESTIMATE'S INVENTORY LIST (Jon, 2026-11-21: "use inventory calculator for estimates… should look like
// the onboarding calculator but giving estimates to the sales team"). The list is the need list calculator's
// own (/kit/list): lib/need-list.ts counts the pieces for the unit, lib/need-buy.ts turns them into what is
// bought (sets, packs, singles). This file only reshapes those buy lines into the rows lib/onboard-estimate.ts
// prices, so the estimator can never count differently from the calculator. Isomorphic.
import { NEED_ITEMS, needList } from './need-list'
import { BUY_SETS, ITEM_BUY, buyList } from './need-buy'
import { PRICE_BOOK, SUPPLIED_KEYS, kitSizeOf, type BuyRow, type EstInput, type EstTier } from './onboard-estimate'

const RANK: Record<EstTier, number> = { must: 0, recommended: 1, optional: 2 }

/** What to buy for this unit, as the calculator buys it. Optional extras only when the unit asks for them. */
export function buyRowsFor(i: EstInput): BuyRow[] {
  const lines = needList(kitSizeOf(i)).filter(l => l.tier !== 'optional' || i.optional)
  const byKey = new Map(lines.map(l => [l.item.key, l] as const))
  return buyList(lines).map(b => {
    let tier: EstTier = 'optional', icon = b.key
    if (b.kind === 'set') {
      // A set is as needed as the most-needed thing it is bought for.
      const core = (BUY_SETS.find(s => s.key === b.key)?.core || []).filter(k => byKey.has(k))
      for (const k of core) { const t = byKey.get(k)!.tier; if (RANK[t] < RANK[tier]) tier = t }
      icon = core[0] || icon
    } else tier = byKey.get(b.key)?.tier || 'recommended'
    const detail = b.kind === 'set' && b.contents ? b.contents.map(c => `${c.per} ${c.name.toLowerCase()}`).join(', ') : undefined
    return { key: b.key, kind: b.kind, name: b.name.replace(/ \(beyond the set\)$/, ''), group: b.group, qty: b.qty, pieces: b.pieces, tier, detail, icon }
  })
}

/** Every line the price book prices, named the way the list names it, in list order: for the price editor. */
export function priceBookLines(): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = BUY_SETS.filter(s => PRICE_BOOK[s.key]).map(s => ({ key: s.key, label: s.name }))
  for (const it of NEED_ITEMS) {
    if (!PRICE_BOOK[it.key] || SUPPLIED_KEYS.includes(it.key)) continue
    const b = ITEM_BUY[it.key]
    out.push({ key: it.key, label: it.name + (b?.pack && b.pack > 1 ? ', ' + (b.packName || 'set of ' + b.pack) : '') })
  }
  return out
}
