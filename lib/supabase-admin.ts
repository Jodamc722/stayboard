// Server-side Supabase client using the service_role key.
// BYPASSES Row Level Security. Never import this from a Client Component.
import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Use `any` for the generated Database type since we haven't generated types yet.
// All queries are still validated against Postgres at runtime.
let _admin: SupabaseClient<any, any, any> | null = null

export function supabaseAdmin(): SupabaseClient<any, any, any> {
  if (_admin) return _admin
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase admin env vars not set')
  _admin = createClient<any, any, any>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  return _admin
}
