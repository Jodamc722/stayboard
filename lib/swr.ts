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
      const json = await res.json().catch(() => null)
      // Don't cache transient failures (e.g. a momentary 401 during a deploy) as if they were data —
      // that would stick a stale error on the page. Only successful responses are cached + shown.
      if (!res.ok || (json && json.error)) {
        if (mounted.current) setError((json && json.error) ? String(json.error) : `Request failed (${res.status})`)
        return
      }
      CACHE.set(key, { data: json, at: Date.now() })
      if (mounted.current) { setData(json); setError(null) }
    } catch (e: any) {
      if (mounted.current) setError(e?.message || String(e))
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
