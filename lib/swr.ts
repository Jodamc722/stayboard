'use client'
// Tiny stale-while-revalidate cache (no deps). Keeps fetched data in a module-level map that
// persists across client navigations, so revisiting a tab shows the last data INSTANTLY and
// refreshes in the background — no full reload. Keyed by the fetch URL.
import { useCallback, useEffect, useRef, useState } from 'react'

type Entry = { data: any; at: number }
const CACHE = new Map<string, Entry>()

export function useCachedFetch<T = any>(key: string | null, opts?: { ttl?: number }) {
  const ttl = opts?.ttl ?? 30_000
  const initial = key ? CACHE.get(key) : undefined
  const [data, setData] = useState<T | undefined>(initial?.data as T | undefined)
  const [loading, setLoading] = useState<boolean>(!initial?.data)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const revalidate = useCallback(async () => {
    if (!key) return
    try {
      const res = await fetch(key)
      const json = await res.json()
      CACHE.set(key, { data: json, at: Date.now() })
      if (mounted.current) { setData(json); setError(json?.error ?? null) }
    } catch (e: any) {
      if (mounted.current) setError(e?.message || Stringe(e)))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [key])

  useEffect(() => {
    mounted.current = true
    if (!key) return () => { mounted.current = false }
    const ent = CACHE.get(key)
    if (ent?.data) { setData(ent.data); setLoading(false) }   // instant from cache
    if (!ent || Date.now() - ent.at > ttl) revalidate()        // refresh in background if stale
    return () => { mounted.current = false }
  }, [key, ttl, revalidate])

  return { data, loading, error, refresh: revalidate }
}

// Drop a cached key (e.g. after a mutation) so the next read refetches.
export function invalidateCache(key: string) { CACHE.delete(key) }
