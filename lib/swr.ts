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
//
// 2026-10-02 (Jon: "it doesn't have to reload every time I go back in … it needs to be live, but I
// hate that it's constantly reloading every single thing"):
//   · EVERY READ IS REMEMBERED ON THE DEVICE (localStorage), not just the one that opted in, and not
//     just for this tab. Coming back — new tab, reload, the app reopened after lunch, a deploy in
//     between — paints the last answer at once and refreshes behind it. A spinner only appears when
//     the device has never seen that read today. A remembered answer from a previous ET day is not
//     painted (the day's lists would show yesterday as today for a beat); it is dropped.
//   · QUIETLY LIVE. While the page is visible, each read refreshes itself every `ttl` (never faster
//     than 30s), and on coming back to the tab if it is stale. Nothing flashes: the data on screen
//     stays until the newer answer replaces it. Hidden tabs do nothing.
//   · The device copy belongs to the signed-in person: Shell calls forgetAllCached() when the
//     signed-in email changes or on sign-out, so the next person never sees the last one's numbers.
import { useCallback, useEffect, useRef, useState } from 'react'

type Entry = { data: any; at: number }
type Result = { ok: boolean; status: number; json: any }
const CACHE = new Map<string, Entry>()
const INFLIGHT = new Map<string, { gen: number; p: Promise<Result> }>()
const GEN = new Map<string, number>()

const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const dayOfET = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms))

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

// DEVICE COPY. localStorage, so it survives the tab; same ET day only. Reads older than that, or
// not parseable, are dropped on sight. Writes that fail (quota, private mode) are simply skipped.
const PERSIST_PREFIX = 'swr:'
const MAX_PERSIST_BYTES = 400_000   // a single read bigger than this stays in memory only
function store(): Storage | null { try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null } }
function readPersisted(k: string): Entry | undefined {
  const s = store(); if (!s) return undefined
  try {
    const raw = s.getItem(PERSIST_PREFIX + k); if (!raw) return undefined
    const o = JSON.parse(raw)
    if (!o || typeof o !== 'object' || !('data' in o)) return undefined
    const at = Number(o.at) || 0
    if (dayOfET(at) !== todayET()) { s.removeItem(PERSIST_PREFIX + k); return undefined }
    return { data: o.data, at }
  } catch { return undefined }
}
function writePersisted(k: string, e: Entry) {
  const s = store(); if (!s) return
  try { const raw = JSON.stringify(e); if (raw.length <= MAX_PERSIST_BYTES) s.setItem(PERSIST_PREFIX + k, raw) } catch { /* quota or private mode */ }
}
function recall(k: string): Entry | undefined {
  let ent = CACHE.get(k)
  if (!ent) { const p = readPersisted(k); if (p) { ent = p; CACHE.set(k, p) } }
  return ent
}

/** Forget every remembered read — memory and device. Shell calls this when the signed-in person changes. */
export function forgetAllCached() {
  CACHE.clear(); INFLIGHT.clear()
  const s = store(); if (!s) return
  try {
    const dead: string[] = []
    for (let i = 0; i < s.length; i++) { const key = s.key(i); if (key && key.startsWith(PERSIST_PREFIX)) dead.push(key) }
    dead.forEach(key => s.removeItem(key))
  } catch { /* fine */ }
}

const MIN_LIVE = 30_000

export function useCachedFetch<T = any>(key: string | null, opts?: { ttl?: number; persist?: boolean; live?: boolean }) {
  const ttl = opts?.ttl ?? 30_000
  const persist = opts?.persist !== false
  const live = opts?.live !== false
  // First render reads memory only (the device copy is picked up in the effect, a frame later), so the
  // server and client paint the same thing and hydration never trips.
  const initial = key ? CACHE.get(cacheKey(key)) : undefined
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
    const k = cacheKey(key)
    const ent = recall(k)
    // A NEW KEY MUST NOT SHOW THE OLD KEY'S DATA (2026-09-09 audit). Pressing › on the date pager
    // left yesterday's rows on screen, with loading:false, under a banner reading "You are looking
    // at Thursday" — the board asserting a day it had not read yet.
    if (ent?.data) { setData(ent.data); setLoading(false) }   // instant from cache
    else { setData(undefined); setError(null); setLoading(true) }
    const stale = () => { const e = CACHE.get(k); return !e || Date.now() - e.at > ttl }
    if (stale()) revalidate()                                   // refresh in background if stale
    if (!live) return () => { mounted.current = false }
    // QUIETLY LIVE: a tick every ttl while the tab is visible; a catch-up when it becomes visible again.
    const every = Math.max(MIN_LIVE, ttl)
    const tick = () => { if (document.visibilityState === 'visible' && stale()) revalidate() }
    const timer = window.setInterval(tick, every)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => {
      mounted.current = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
    }
  }, [key, ttl, live, revalidate])

  return { data, loading, error, refresh: revalidate }
}

// Drop a cached key (e.g. after a mutation) so the next read refetches. A read already in flight
// is let go too, so that next read starts fresh instead of joining it — and, being newer, wins.
export function invalidateCache(key: string) {
  const k = cacheKey(key)
  CACHE.delete(k)
  INFLIGHT.delete(k)
  const s = store(); if (s) { try { s.removeItem(PERSIST_PREFIX + k) } catch { /* fine */ } }
}
