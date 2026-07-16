import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { featureForPath, featureEnabled, firstEnabled } from './lib/features'

type CookieToSet = { name: string; value: string; options: CookieOptions }

const SUPERADMIN = 'jon@stay-hospitality.com'

// Allowlist check via Supabase REST with the service key. FAIL-OPEN: any error, a missing table, or an
// empty allowlist (no active members yet) returns true so nobody is ever locked out by accident.
const _memberCache = new Map<string, { at: number; val: { allowed: boolean; features: Record<string, any> | null } }>()
const _MEMBER_TTL = 60_000
async function getMember(email: string): Promise<{ allowed: boolean; features: Record<string, any> | null }> {
  const _c = _memberCache.get(email)
  if (_c && Date.now() - _c.at < _MEMBER_TTL) return _c.val
  const _v = await getMemberRaw(email)
  _memberCache.set(email, { at: Date.now(), val: _v })
  return _v
}
async function getMemberRaw(email: string): Promise<{ allowed: boolean; features: Record<string, any> | null }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY1 || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return { allowed: true, features: null }
  try {
    const headers = { apikey: key, Authorization: `Bearer ${key}` }
    const r = await fetch(`${url}/rest/v1/app_users?select=status,features&email=eq.${encodeURIComponent(email)}`, { headers, signal: AbortSignal.timeout(2500) })
    if (!r.ok) return { allowed: true, features: null }
    const rows = await r.json().catch(() => null)
    if (!Array.isArray(rows)) return { allowed: true, features: null }
    if (rows.length > 0) return { allowed: rows[0]?.status === 'active', features: (rows[0]?.features && typeof rows[0].features === 'object') ? rows[0].features : null }
    // No row for this user. Allow only if the allowlist is still empty (pre-setup); otherwise deny.
    const r2 = await fetch(`${url}/rest/v1/app_users?select=email&status=eq.active&limit=1`, { headers, signal: AbortSignal.timeout(2500) })
    if (!r2.ok) return { allowed: true, features: null }
    const any = await r2.json().catch(() => null)
    return { allowed: !Array.isArray(any) || any.length === 0, features: null }
  } catch { return { allowed: true, features: null } }
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
  const user: any = await Promise.race([supabase.auth.getUser().then((r: any) => (r && r.data && r.data.user) || null).catch(() => null), new Promise<any>((res) => setTimeout(() => res(null), 2500))])

  const path = request.nextUrl.pathname
  const isOpenPath = path.startsWith('/login') || path.startsWith('/auth') || path.startsWith('/signup') || path === '/no-access' || path.startsWith('/api') || path.startsWith('/g/') || path.startsWith('/audit/') || path.startsWith('/vendor/') || path.startsWith('/salato/share') || path === '/manifest.json' || path.startsWith('/favicon') || path === '/robots.txt'

  // Lock the whole app behind auth: any visitor without a session on a non-public path is sent to /login.
  // The public guest guidebook (/g/) stays open, so a shared book link can never expose the app itself.
  if (!user && !isOpenPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }
  if (user && !isOpenPath) {
    const email = String(user.email || '').toLowerCase()
    if (email && email !== SUPERADMIN) {
      const { allowed, features } = await getMember(email)
      if (!allowed) {
        const url = request.nextUrl.clone()
        url.pathname = '/no-access'
        url.search = ''
        return NextResponse.redirect(url)
      }
      // Per-user page access: if this path maps to a feature the user has turned OFF, bounce them to
      // their first allowed page. Fail-open (no features -> everything allowed). Owner never reaches here.
      const feat = featureForPath(path)
      if (feat && !featureEnabled(features, feat.key)) {
        const url = request.nextUrl.clone()
        url.pathname = firstEnabled(features)
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
