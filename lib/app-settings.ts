// Shared reader/writer for the `app_settings` key/value table.
//
// The table predates this file and is already used for 'banner_overrides', 'guesty_owners',
// 'owner_edit_password' and 'review_voice'. Its `value` column is TEXT, so structured settings are
// stored as a JSON string — always go through here rather than reimplementing the parse.
//
// FAIL-OPEN: every read swallows errors and returns the caller's fallback, so a missing table, a
// bad row, or a transient DB blip can never take a page down. Service-role only.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { mergePresets, type OpsPresets } from './ops-presets'

export const OPS_PRESETS_KEY = 'ops_presets'

// Small in-process cache. Settings change rarely and are read on hot paths (every scheduler load),
// so a short TTL keeps the DB out of the critical path without making saves feel stale.
const TTL_MS = 60_000
const _cache = new Map<string, { at: number; val: any }>()

/** Raw setting read. Returns `fallback` on any error, missing row, or unparseable value. */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.val as T
  let val: any = fallback
  try {
    const { data, error } = await supabaseAdmin().from('app_settings').select('value').eq('key', key).limit(1)
    if (!error && Array.isArray(data) && data[0]) {
      const raw = (data[0] as any).value
      if (raw && typeof raw === 'object') val = raw
      else if (typeof raw === 'string' && raw) {
        try { const j = JSON.parse(raw); if (j && typeof j === 'object') val = j } catch { /* not json — keep fallback */ }
      }
    }
  } catch { /* fail-open */ }
  _cache.set(key, { at: Date.now(), val })
  return val as T
}

/** Write a setting. Stored as a JSON string because `value` is TEXT. */
export async function setSetting(key: string, value: any, updatedBy?: string | null): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabaseAdmin().from('app_settings').upsert(
      { key, value: JSON.stringify(value), updated_by: updatedBy || null, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
    if (error) return { ok: false, error: error.message }
    _cache.delete(key)   // next read is fresh
    return { ok: true }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}

/**
 * The operating presets (vendor cleaning, roster, timing, building groups), with stored overrides
 * merged over the hardcoded defaults. Safe to call on any hot path.
 */
export async function getOpsPresets(): Promise<OpsPresets> {
  const stored = await getSetting<any>(OPS_PRESETS_KEY, null)
  const presets = mergePresets(stored)
  // THE VENDOR REGISTRY RIDES IN (migration 062; Jon, 2026-09-01: "an option to add different
  // vendors"). Vendors added on /users merge into vendorBuildings here, so every classifier that
  // already reads presets — the engine, the briefs, the boards — picks them up with no call-site
  // changes. Buildings become word-boundary terms; a key collision defers to the stored preset.
  try {
    const { getVendors } = await import('./staffing')
    const have = new Set(presets.vendorBuildings.map(v => v.id))
    for (const v of await getVendors()) {
      if (!v.buildings.length || have.has('vendor:' + v.key)) continue
      presets.vendorBuildings.push({
        id: 'vendor:' + v.key, label: v.label,
        terms: [], wordTerms: v.buildings,
        enabled: true, untracked: false, noBreezeway: false,
      })
    }
  } catch { /* registry table absent — presets alone still stand */ }
  return presets
}
