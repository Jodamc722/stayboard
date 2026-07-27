'use client'
// Client-side access to the ops presets (vendor cleaning, roster, timing, building groups).
//
// Returns the hardcoded defaults immediately so nothing ever renders empty or flickers, then swaps
// in the saved settings once /api/settings/ops responds. The result is cached at module scope, so
// several components on one page share a single request.
import { useEffect, useState } from 'react'
import { DEFAULT_PRESETS, mergePresets, type OpsPresets } from './ops-presets'

let _cache: OpsPresets | null = null
let _inflight: Promise<OpsPresets> | null = null

/** Clear the cache after saving, so the page reflects new settings without a reload. */
export function clearOpsPresetsCache() { _cache = null; _inflight = null }

export function useOpsPresets(): OpsPresets {
  const [presets, setPresets] = useState<OpsPresets>(() => _cache || DEFAULT_PRESETS)

  useEffect(() => {
    if (_cache) { setPresets(_cache); return }
    if (!_inflight) {
      _inflight = fetch('/api/settings/ops', { cache: 'no-store' })
        .then(r => r.json())
        .then(j => { const m = mergePresets(j?.presets); _cache = m; return m })
        .catch(() => DEFAULT_PRESETS)   // fail-open: keep today's behaviour
    }
    let alive = true
    _inflight.then(v => { if (alive) setPresets(v) })
    return () => { alive = false }
  }, [])

  return presets
}
