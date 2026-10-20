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
