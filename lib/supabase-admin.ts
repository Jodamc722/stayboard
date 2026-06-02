// Server-side Supabase client used by the sync route + token cache.
//
// Originally this used the service_role key; we now use the anon key with
// permissive write RLS on guesty_* tables. The sync route is gated by user auth,
// so only logged-in users can write through this client.
import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _admin: SupabaseClient<any, any, any> | null = null

export function supabaseAdmin(): SupabaseClient<any, any, any> {
  if (_admin) return _admin
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env vars not set')
  _admin = createClient<any, any, any>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  return _admin
}
