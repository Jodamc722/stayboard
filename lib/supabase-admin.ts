// Server-side Supabase client used by the sync route + token cache.
//
// Uses the SERVICE-ROLE key when available so server-side syncs bypass RLS and
// can write to the guesty_* tables. Falls back to the anon key only if no
// service-role key is configured. This file is server-only — the key never
// reaches the browser.
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
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env vars not set')
  _admin = createClient<any, any, any>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  return _admin
}
