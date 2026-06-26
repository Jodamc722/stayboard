import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

type CookieToSet = { name: string; value: string; options: CookieOptions }

const SUPERADMIN = 'jon@stay-hospitality.com'

// Allowlist check via Supabase REST with the service key. FAIL-OPEN: any error, a missing table, or an
// empty allowlist (no active members yet) returns true so nobody is ever locked out by accident.
async function isAllowed(email: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY1 || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return true
  try {
    const headers = { apikey: key, Authorization: `Bearer ${key}` }
    const r = await fetch(`${url}/rest/v1/app_users?select=status&email=eq.${encodeURIComponent(email)}`, { headers })
    if (!r.ok) return true
    const rows = await r.json().catch(() => null)
    if (!Array.isArray(rows)) return true
    if (rows.length > 0) return rows[0]?.status === 'active'
    // No row for this user. Allow only if the allowlist is still empty (pre-setup); otherwise deny.
    const r2 = await fetch(`${url}/rest/v1/app_users?select=email&status=eq.active&limit=1`, { headers })
    if (!r2.ok) return true
    const any = await r2.json().catch(() => null)
    return !Array.isArray(any) || any.length === 0
  } catch { return true }
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(toSet: CookieToSet[]) {
          toSet.forEach((c) => request.cookies.set(c.name, c.value))
          response = NextResponse.next({ request })
          toSet.forEach((c) => response.cookies.set(c.name, c.value, c.options))
        }
      }
    }
  )
  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isOpenPath = path.startsWith('/login') || path.startsWith('/auth') || path === '/no-access' || path.startsWith('/api')
  if (user && !isOpenPath) {
    const email = String(user.email || '').toLowerCase()
    if (email && email !== SUPERADMIN) {
      const ok = await isAllowed(email)
      if (!ok) {
        const url = request.nextUrl.clone()
        url.pathname = '/no-access'
        url.search = ''
        return NextResponse.redirect(url)
      }
    }
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/public).*)']
}
