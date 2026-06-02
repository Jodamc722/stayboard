// Server-side Supabase client using the service_role key.
// BYPASSES Row Level Security. Never import this from a Client Component.
import 'server-only'
import { createClient } from '@supabase/supabase-js'

let _admin: ReturnType<typeof createClient> | null = null

export function supabaseAdmin() {
  if (_admin) return _admin
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase admin env vars not set')
  _admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  return _admin
}
