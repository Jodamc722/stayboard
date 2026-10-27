// THE APPROVED CATALOG (Jon, 2026-10-20): per-property furniture catalog with a decision on every
// item — which option(s) the team may buy when something needs replacing.
//
// Two halves, kept apart on purpose:
//   • The CATALOG is a JSON file per property, built from the sourcing sheet: each item with its
//     photo, the HostGPO member price through Article, the Amazon listing from the sheet, and a
//     City Home (delivered & set up) or Wayfair (chairs and sofas; flat-pack) match. Rebuild the
//     file when the sheet changes; it never changes from the page.
//   • The DECISIONS live in ffe_approved_decisions: approved sources, "not for this property", and
//     a note, one row per item. That is the part that turns the catalog into the replacement list.
import 'server-only'
import { randomBytes } from 'crypto'
import { supabaseAdmin } from './supabase-admin'
import catalog17West from './ffe-approved-catalog-17west.json'

export type OptionSrc = 'host' | 'amz' | 'ch' | 'wf'
export type CatalogOption = {
  src: OptionSrc; vendor: string; name: string; url: string | null; price: number | null
  each?: string; image: string | null; chips: string[]; fit: 'cover' | 'contain'
}
export type CatalogItem = {
  key: string; section: 'compare' | 'vendor' | 'amenity'; category: string; name: string; options: CatalogOption[]
}
export type Catalog = {
  property: string; title: string; sourceSheet: string; asOf: string
  items: CatalogItem[]; misc: Record<string, string[]>
}
export type Decision = { approved: OptionSrc[]; rejected: boolean; note: string; updatedBy: string | null; updatedAt: string | null }

const CATALOGS: Record<string, Catalog> = { '17-west': catalog17West as Catalog }

export function getCatalog(property: string): Catalog | null {
  return CATALOGS[property] || null
}

export async function readDecisions(property: string): Promise<Record<string, Decision>> {
  const out: Record<string, Decision> = {}
  try {
    const { data, error } = await supabaseAdmin()
      .from('ffe_approved_decisions')
      .select('item_key, approved, rejected, note, updated_by, updated_at')
      .eq('property', property)
    if (error) return out   // fails open: the table may not exist yet
    for (const r of data || []) {
      out[String(r.item_key)] = {
        approved: Array.isArray(r.approved) ? (r.approved as OptionSrc[]) : [],
        rejected: !!r.rejected,
        note: typeof r.note === 'string' ? r.note : '',
        updatedBy: r.updated_by || null,
        updatedAt: r.updated_at || null,
      }
    }
  } catch { /* fail open */ }
  return out
}

const SRCS: OptionSrc[] = ['host', 'amz', 'ch', 'wf']

export async function writeDecision(property: string, itemKey: string, d: { approved: unknown; rejected: unknown; note: unknown }, who: string) {
  const cat = getCatalog(property)
  if (!cat) return { ok: false, error: 'Unknown catalog.' }
  const item = cat.items.find(i => i.key === itemKey)
  if (!item) return { ok: false, error: 'Unknown item.' }
  const allowed = new Set(item.options.filter(o => o.price != null).map(o => o.src))
  const approved = (Array.isArray(d.approved) ? d.approved : [])
    .filter((s): s is OptionSrc => SRCS.includes(s as OptionSrc) && allowed.has(s as OptionSrc))
  const rejected = !!d.rejected && approved.length === 0
  const note = typeof d.note === 'string' ? d.note.slice(0, 1000) : ''
  const { error } = await supabaseAdmin().from('ffe_approved_decisions').upsert({
    property, item_key: itemKey, approved, rejected, note: note || null, updated_by: who || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'property,item_key' })
  if (error) return { ok: false, error: error.message }
  return { ok: true, decision: { approved, rejected, note, updatedBy: who || null, updatedAt: new Date().toISOString() } as Decision }
}

// ---------- share link ----------

export async function getShare(property: string): Promise<{ code: string; views: number } | null> {
  try {
    const { data } = await supabaseAdmin().from('ffe_catalog_shares').select('code, views').eq('property', property).limit(1)
    const r = (data || [])[0]
    return r ? { code: String(r.code), views: Number(r.views || 0) } : null
  } catch { return null }
}

/** Create the property's share code, or replace it (which revokes the old link). */
export async function setShare(property: string, who: string, regenerate: boolean) {
  if (!getCatalog(property)) return { ok: false, error: 'Unknown catalog.' }
  const have = await getShare(property)
  if (have && !regenerate) return { ok: true, code: have.code }
  const code = randomBytes(8).toString('hex')
  const { error } = await supabaseAdmin().from('ffe_catalog_shares')
    .upsert({ property, code, created_by: who || null, created_at: new Date().toISOString(), views: 0, last_view: null }, { onConflict: 'property' })
  if (error) return { ok: false, error: error.message }
  return { ok: true, code }
}

/** Resolve a public code to the APPROVED catalog only — the replacement list, nothing else.
 *  Items without an approved option are dropped, so are unapproved options, rejected items, and who
 *  approved what (staff emails never leave the building). Notes stay: "order 2 per unit" is part of
 *  the instruction. `count` bumps the view counter — the page passes true once per open; the API does not. */
export async function readShared(code: string, count = false): Promise<{ catalog: Catalog; decisions: Record<string, Decision> } | null> {
  if (!/^[0-9a-f]{16}$/i.test(code)) return null
  const db = supabaseAdmin()
  const { data } = await db.from('ffe_catalog_shares').select('property, views').eq('code', code).limit(1)
  const r = (data || [])[0]
  if (!r) return null
  const full = getCatalog(String(r.property))
  if (!full) return null
  if (count) db.from('ffe_catalog_shares').update({ views: Number(r.views || 0) + 1, last_view: new Date().toISOString() }).eq('code', code).then(() => {}, () => {})
  const all = await readDecisions(String(r.property))
  const decisions: Record<string, Decision> = {}
  const items: CatalogItem[] = []
  for (const it of full.items) {
    const d = all[it.key]
    if (!d || d.rejected || !d.approved.length) continue
    const options = it.options.filter(o => d.approved.includes(o.src))
    if (!options.length) continue
    items.push({ ...it, options })
    decisions[it.key] = { approved: d.approved, rejected: false, note: d.note, updatedBy: null, updatedAt: null }
  }
  return { catalog: { ...full, items, misc: {} }, decisions }
}
