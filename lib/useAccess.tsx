'use client'
// Client-side access hook (roles + levels, migration 023). Pages call this to render read-only
// when the caller's level on their feature is 'view' — e.g.:
//   const acc = useAccess()
//   const canEdit = acc.atLeast('glitches', 'edit')   // hide action buttons when false
//   const canFull = acc.atLeast('claims', 'full')     // hide delete/settings when false
// The hook is a convenience for the UI only — the SERVER is the real gate (requireLevel in the
// mutation APIs). While loading (or on fetch failure) it reports full access, so nothing flickers
// off for admins and a broken /api/access/me can never brick a page (fail-open, like everything).
import { useEffect, useState } from 'react'

export type ClientAccess = {
  loading: boolean
  email: string | null
  isAdmin: boolean
  isOwner: boolean
  accessRole: string | null
  levels: Record<string, string>
  level: (featureKey: string) => string
  atLeast: (featureKey: string, need: 'view' | 'edit' | 'full') => boolean
}

const RANK: Record<string, number> = { off: 0, view: 1, edit: 2, full: 3 }

let _cache: any = null
let _cacheAt = 0

export function useAccess(): ClientAccess {
  const [me, setMe] = useState<any>(_cache)
  useEffect(() => {
    if (_cache && Date.now() - _cacheAt < 60_000) { setMe(_cache); return }
    fetch('/api/access/me').then(r => r.json()).then(j => { _cache = j; _cacheAt = Date.now(); setMe(j) }).catch(() => {})
  }, [])
  const levels: Record<string, string> = (me?.levels && typeof me.levels === 'object') ? me.levels : {}
  const level = (key: string) => {
    if (!me) return 'full'                       // still loading → fail-open
    if (me.isOwner || me.isAdmin) return 'full'
    const l = levels[key]
    return l == null ? 'full' : l                // no level known (pre-migration) → legacy behavior
  }
  return {
    loading: !me,
    email: me?.email ?? null,
    isAdmin: !!me?.isAdmin,
    isOwner: !!me?.isOwner,
    accessRole: me?.accessRole ?? null,
    levels,
    level,
    atLeast: (key, need) => (RANK[level(key)] ?? 3) >= (RANK[need] ?? 0),
  }
}
