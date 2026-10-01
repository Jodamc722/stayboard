'use client'
// Tiny stale-while-revalidate cache (no deps). Keeps fetched data in a module-level map that
// persists across client navigations, so revisiting a tab shows the last data INSTANTLY and
// refreshes in the background — no full reload. Keyed by the fetch URL.
//
// 2026-09-28 audit (02 F21):
//   · ONE REQUEST PER KEY AT A TIME. Two components mounting the same key in one render both
//     fetched it; the second now waits on the first.
//   · THE NEWEST READ WINS. A poll that started before a mutation and landed after the re-read used
//     to put the pre-mutation data back in the cache; an older response is now dropped.
//   · `?date=<today>` IS THE SAME READ AS NO DATE on every route that takes one (they all default
//     to today, ET), so both spellings share one cache entry. Only the key is normalized — the URL
//     fetched is always the one the component asked for.
import { useCallback, useEffect, useRef, useState } from 'react'

type Entry = { data: any; at: number }
type Result = { ok: boolean; status: number; json: any }
const CACHE = new Map<string, Entry>()
const INFLIGHT = new Map<string, { gen: number; p: Promise<Result> }>()
const GEN = new Map<string, number>()

const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

/** The cache key for a URL: the URL itself, with a `date=` equal to today (ET) dropped. */
export function cacheKey(url: string): string {
  const q = url.indexOf('?')
  if (q < 0 || url.indexOf('date=', q) < 0) return url
  const today = 'date=' + todayET()
  const parts = url.slice(q + 1).split('&').filter(p => p !== today)
  return parts.length ? url.slice(0, q) + '?' + parts.join('&') : url.slice(0, q)
}

/** Start (or join) the read for a key. `gen` identifies which read this is. */
function fetchShared(url: string, k: string): { gen: number; p: Promise<Result> } {
  const cur = INFLIGHT.get(k)
  if (cur) return cur
  const gen = (GEN.get(k) || 0) + 1
  GEN.set(k, gen)
  const p = fetch(url).then(async res => ({ ok: res.ok, status: res.status, json: await res.json().catch(() => null) }))
  const entry = { gen, p }
  INFLIGHT.set(k, entry)
  const done = () => { if (INFLIGHT.get(k) === entry) INFLIGHT.delete(k) }
  p.then(done, done)
  return entry
}

// PERSIST (2026-10-01, Command Center load time): with `persist`, the last good answer is also kept
// in sessionStorage, so a reload or a fresh tab paints the previous read at once and refreshes
// behind it, instead of a spinner while the day is rebuilt. Same-tab only; cleared with the tab.
const PERSIST_PREFIX = 'swr:'
function readPersisted(k: string): Entry | undefined {
  try { const raw = sessionStorage.getItem(PERSIST_PREFIX + k); if (!raw) return undefined; const o = JSON.parse(raw); return o && typeof o === 'object' && 'data' in o ? { data: o.data, at: Number(o.at) || 0 } : undefined } catch { return undefined }
}
function writePersisted(k: string, e: Entry) { try { sessionStorage.setItem(PERSIST_PREFIX + k, JSON.stringify(e)) } catch { /* quota or private mode */ } }

export function useCachedFetch<T = any>(key: string | null, opts?: { ttl?: number; persist?: boolean }) {
  const ttl = opts?.ttl ?? 30_000
  const persist = !!opts?.persist
  let initial = key ? CACHE.get(cacheKey(key)) : undefined
  if (!initial && persist && key && typeof window !== 'undefined') { const p = readPersisted(cacheKey(key)); if (p) { initial = p; CACHE.set(cacheKey(key), p) } }
  const [data, setData] = useState<T | undefined>(initial?.data as T | undefined)
  const [loading, setLoading] = useState<boolean>(!initial?.data)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const revalidate = useCallback(async () => {
    if (!key) return
    const k = cacheKey(key)
    try {
      const { gen, p } = fetchShared(key, k)
      const { ok, status, json } = await p
      // Don't cache transient failures (e.g. a momentary 401 during a deploy) as if they were data —
      // that would stick a stale error on the page. Only successful responses are cached + shown.
      if (!ok || (json && json.error)) {
        if (mounted.current) setError((json && json.error) ? String(json.error) : `Request failed (${status})`)
        return
      }
      // A newer read of this key started after this one (a re-read after a mutation): it has the
      // last word, so this older answer is neither cached nor shown.
      if (gen !== GEN.get(k)) return
      const ent = { data: json, at: Date.now() }
      CACHE.set(k, ent)
      if (persist) writePersisted(k, ent)
      if (mounted.current) { setData(json); setError(null) }
    } catch (e: any) {
      if (mounted.current) setError(e?.message || String(e))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [key, persist])

  useEffect(() => {
    mounted.current = true
    if (!key) return () => { mounted.current = false }
    let ent = CACHE.get(cacheKey(key))
    if (!ent && persist) { const p = readPersisted(cacheKey(key)); if (p) { ent = p; CACHE.set(cacheKey(key), p) } }
    // A NEW KEY MUST NOT SHOW THE OLD KEY'S DATA (2026-09-09 audit). Pressing › on the date pager
    // left yesterday's rows on screen, with loading:false, under a banner reading "You are looking
    // at Thursday" — the board asserting a day it had not read yet.
    if (ent?.data) { setData(ent.data); setLoading(false) }   // instant from cache
    else { setData(undefined); setError(null); setLoading(true) }
    if (!ent || Date.now() - ent.at > ttl) revalidate()        // refresh in background if stale
    return () => { mounted.current = false }
  }, [key, ttl, revalidate])

  return { data, loading, error, refresh: revalidate }
}

// Drop a cached key (e.g. after a mutation) so the next read refetches. A read already in flight
// is let go too, so that next read starts fresh instead of joining it — and, being newer, wins.
export function invalidateCache(key: string) {
  const k = cacheKey(key)
  CACHE.delete(k)
  INFLIGHT.delete(k)
}
