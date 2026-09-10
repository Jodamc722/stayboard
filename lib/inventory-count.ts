// COUNTING THE SHELF — the link, the sheet the counter sees, and what a submit does.
//
// Jon, 2026-09-10: "we need a better inventory management system. Should be easier to count. Should
// be an inventory link that can be managed. They add a count of each item and overwrites what we
// have in stock, it should show who did the count."
//
// Two rules decide almost everything here:
//
//   1. A BLANK IS NOT A ZERO. Only items the counter actually typed a number for are written. Count
//      the drinks today and the snacks tomorrow and nothing is harmed; forget a row and it keeps the
//      number it had rather than vanishing from the guest form.
//   2. A COUNT IS A RECORD. Every line keeps its before and after, next to the name of whoever
//      counted, so a number that looks wrong later can be traced instead of argued about.
import { randomBytes } from 'crypto'
import { supabaseAdmin } from './supabase-admin'
import { getGuestOrdersCfg, loadCatalog, listStock, setStock } from './guest-orders'

export type CountLink = { code: string; label: string | null; passcode: string | null; created_by: string | null; created_at: string; last_used_at: string | null; revoked_at: string | null }
export type CountShelf = { scope: string; label: string; items: number }
export type CountItem = { id: string; name: string; category: string; size: string | null; unit: string | null; image: string | null; onHand: number; lowAt: number; countedAt: string | null; countedBy: string | null }
export type CountLine = { itemId: string; name: string; before: number; after: number; delta: number }
export type CountRow = { id: string; scope: string; scope_label: string | null; counted_by: string; note: string | null; lines: CountLine[]; items: number; changed: number; created_at: string; link_code: string | null }

export const COUNT_CODE_RE = /^[A-Za-z0-9]{8,32}$/
export function newCountCode(): string { return randomBytes(12).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 14) || randomBytes(8).toString('hex') }

export async function linkByCode(code: string): Promise<CountLink | null> {
  if (!COUNT_CODE_RE.test(code)) return null
  const { data } = await supabaseAdmin().from('inventory_count_links').select('*').eq('code', code).limit(1)
  const l = (data || [])[0] as CountLink | undefined
  return l && !l.revoked_at ? l : null
}

/** Every shelf a counter can pick, with how many items sit on it. */
export async function shelvesFor(): Promise<CountShelf[]> {
  const [cfg, catalog, stock] = await Promise.all([getGuestOrdersCfg(), loadCatalog({ activeOnly: false }), listStock()])
  const scopes = [{ id: 'global', label: 'Global shelf' }, ...cfg.hubs.map(h => ({ id: 'hub:' + h.id, label: h.label }))]
  return scopes.map(s => ({
    scope: s.id, label: s.label,
    // "on this shelf" means counted here at least once — an item nobody has ever counted anywhere
    // would otherwise appear on every shelf and make each one look like the whole catalog.
    items: catalog.filter(c => c.track_stock && stock.some(r => r.item_id === c.id && r.scope === s.id)).length,
  }))
}

/** The sheet: everything countable on one shelf, worst-first is NOT used — shelf order is. */
export async function sheetFor(scope: string): Promise<{ label: string; items: CountItem[] }> {
  const [cfg, catalog, stock] = await Promise.all([getGuestOrdersCfg(), loadCatalog({ activeOnly: false }), listStock()])
  const hub = cfg.hubs.find(h => 'hub:' + h.id === scope)
  const label = scope === 'global' ? 'Global shelf' : (hub ? hub.label : scope)
  const items = catalog
    .filter(c => c.track_stock)
    .map(c => {
      const row = stock.find(r => r.item_id === c.id && r.scope === scope)
      if (!row) return null
      const size = c.size_value && c.size_unit ? String(Math.round(Number(c.size_value) * 100) / 100) + ' ' + c.size_unit : null
      return { id: c.id, name: c.name, category: c.category || 'Other', size, unit: c.unit_label, image: c.image_url, onHand: Number(row.on_hand) || 0, lowAt: Number(row.low_at) || 0, countedAt: row.updated_at || null, countedBy: row.updated_by || null } as CountItem
    })
    .filter(Boolean) as CountItem[]
  // Grouped the way a storeroom is walked: by category, then by name, so the sheet matches the shelf.
  items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  return { label, items }
}

/**
 * Write a count. `counts` carries ONLY the items someone typed a number for — the caller drops
 * blanks before it gets here, and this checks again, because "leave it alone" is the rule that
 * makes a partial count safe and it must not depend on the browser getting it right.
 */
export async function submitCount(opts: {
  scope: string; counter: string; note?: string; linkCode?: string | null
  counts: { itemId: string; count: number }[]
}): Promise<{ ok: boolean; error?: string; count?: CountRow }> {
  const scope = String(opts.scope || '')
  if (!/^(global|hub:[a-z0-9-]{1,40})$/.test(scope)) return { ok: false, error: 'That shelf is not one we know.' }
  const counter = String(opts.counter || '').trim().slice(0, 60)
  if (!counter) return { ok: false, error: 'Please put your name on the count.' }

  const { items: sheet } = await sheetFor(scope)
  const lines: CountLine[] = []
  for (const c of (opts.counts || []).slice(0, 400)) {
    const item = sheet.find(i => i.id === String(c?.itemId || ''))
    if (!item) continue
    const n = Number(c?.count)
    if (!Number.isFinite(n) || n < 0) continue              // a blank never reaches here; a bad one is dropped
    const after = Math.min(99999, Math.floor(n))
    lines.push({ itemId: item.id, name: item.name, before: item.onHand, after, delta: after - item.onHand })
  }
  if (!lines.length) return { ok: false, error: 'Nothing was counted yet.' }

  const failed: string[] = []
  for (const l of lines) {
    const r = await setStock(l.itemId, scope, l.after, null, counter)
    if (!r.ok) failed.push(l.name)
  }
  if (failed.length === lines.length) return { ok: false, error: 'Could not save the count. Please try again.' }

  const db = supabaseAdmin()
  const row = {
    link_code: opts.linkCode || null, scope, scope_label: (await sheetFor(scope)).label,
    counted_by: counter, note: String(opts.note || '').trim().slice(0, 600) || null,
    lines, items: lines.length, changed: lines.filter(l => l.delta !== 0).length,
  }
  const { data, error } = await db.from('inventory_counts').insert(row).select('*').limit(1)
  if (opts.linkCode) { try { await db.from('inventory_count_links').update({ last_used_at: new Date().toISOString() }).eq('code', opts.linkCode) } catch { /* cosmetic */ } }
  if (error) return { ok: false, error: error.message }
  return { ok: true, count: (data || [])[0] as CountRow }
}

export async function recentCounts(limit = 20): Promise<CountRow[]> {
  const { data } = await supabaseAdmin().from('inventory_counts').select('*').order('created_at', { ascending: false }).limit(Math.min(100, limit))
  return (data || []) as CountRow[]
}
