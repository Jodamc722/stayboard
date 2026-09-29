// Server-side Supabase client used by the sync route + token cache.
//
// Uses the SERVICE-ROLE key so server-side reads and syncs bypass RLS and can write to the guesty_*
// tables. This file is server-only — the key never reaches the browser.
//
// NO ANON-KEY FALLBACK (2026-09-28 audit, B-14). It used to fall back to the public anon key, which
// turned a missing service key into a server quietly running as an anonymous visitor: RLS-protected
// reads came back empty instead of failing. Without a service key this now throws, loudly.
import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _admin: SupabaseClient<any, any, any> | null = null

export function supabaseAdmin(): SupabaseClient<any, any, any> {
  if (_admin) return _admin
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY1 ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Supabase env vars not set (NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)')
  _admin = createClient<any, any, any>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    // Next.js caches library fetch() calls in its Data Cache, which can serve
    // hours-stale rows to server-rendered pages (owner share links). Force
    // every Supabase request to bypass the cache.
    global: { fetch: (input: any, init?: any) => fetch(input, { ...(init || {}), cache: 'no-store' }) }
  })
  return _admin
}
