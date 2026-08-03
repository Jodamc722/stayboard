import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { featureForPath, pageAllowed, firstEnabled } from './lib/features'

type CookieToSet = { name: string; value: string; options: CookieOptions }

const SUPERADMIN = 'jon@stay-hospitality.com'

// Allowlist check via Supabase REST with the service key. FAIL-OPEN: any error, a missing table, or an
// empty allowlist (no active members yet) returns true so nobody is ever locked out by accident.
type Member = { allowed: boolean; features: Record<string, any> | null; workspace: string | null; role: string | null }
const _memberCache = new Map<string, { at: number; val: Member }>()
const _MEMBER_TTL = 60_000
async function getMember(email: string): Promise<Member> {
  const _c = _memberCache.get(email)
  if (_c && Date.now() - _c.at < _MEMBER_TTL) return _c.val
  const _v = await getMemberRaw(email)
  _memberCache.set(email, { at: Date.now(), val: _v })
  return _v
}
async function getMemberRaw(email: string): Promise<Member> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY1 || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return { allowed: true, features: null, workspace: null, role: null }
  try {
    const headers = { apikey: key, Authorization: `Bearer ${key}` }
    // select=* so optional columns (workspace, migration 013) are read when present and absent otherwise.
    const r = await fetch(`${url}/rest/v1/app_users?select=*&email=eq.${encodeURIComponent(email)}`, { headers, signal: AbortSignal.timeout(2500) })
    // Activity trail: stamp last_seen_at, fire-and-forget. Runs at most once per member-cache TTL
    // (60s) per edge instance; silently a no-op before migration 013 adds the column.
    fetch(`${url}/rest/v1/app_users?email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(2500),
    }).catch(() => {})
    if (!r.ok) return { allowed: true, features: null, workspace: null, role: null }
    const rows = await r.json().catch(() => null)
    if (!Array.isArray(rows)) return { allowed: true, features: null, workspace: null, role: null }
    if (rows.length > 0) {
      const row = rows[0] || {}
      return {
        allowed: row.status === 'active',
        features: (row.features && typeof row.features === 'object') ? row.features : null,
        workspace: typeof row.workspace === 'string' ? row.workspace : null,
        role: typeof row.role === 'string' ? row.role : null,
      }
    }
    // No row for this user. Allow only if the allowlist is still empty (pre-setup); otherwise deny.
    const r2 = await fetch(`${url}/rest/v1/app_users?select=email&status=eq.active&limit=1`, { headers, signal: AbortSignal.timeout(2500) })
    if (!r2.ok) return { allowed: true, features: null, workspace: null, role: null }
    const any = await r2.json().catch(() => null)
    return { allowed: !Array.isArray(any) || any.length === 0, features: null, workspace: null, role: null }
  } catch { return { allowed: true, features: null, workspace: null, role: null } }
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
  const isOpenPath = path.startsWith('/login') || path.startsWith('/auth') || path.startsWith('/signup') || path === '/no-access' || path.startsWith('/api') || path.startsWith('/g/') || path === '/day' || path.startsWith('/day/') || path.startsWith('/guide/') || path.startsWith('/r/') || path.startsWith('/audit/') || path.startsWith('/walk/') || path.startsWith('/field/') || path.startsWith('/approve/') || path.startsWith('/new-order') || path.startsWith('/vendor/') || path.startsWith('/delivery') || path.startsWith('/owner-orders') || path.startsWith('/salato/share') || path.startsWith('/salato/verify') || path.startsWith('/report/') || path === '/manifest.json' || path.startsWith('/favicon') || path === '/robots.txt'

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
      const { allowed, features, workspace, role } = await getMember(email)
      if (!allowed) {
        const url = request.nextUrl.clone()
        url.pathname = '/no-access'
        url.search = ''
        return NextResponse.redirect(url)
      }
      // Workspace + per-user page access: a page must be in the user's workspace bundle AND not
      // toggled off for them individually. Admins have the 'admin' workspace (all pages).
      // Fail-open (no workspace column yet -> gm -> everything). Owner never reaches here.
      const ws = role === 'admin' ? 'admin' : workspace
      const feat = featureForPath(path)
      if (feat && !pageAllowed(ws, features, feat.key)) {
        const url = request.nextUrl.clone()
        url.pathname = firstEnabled(features, ws)
        url.search = ''
        return NextResponse.redirect(url)
      }
    }
  }
  return response
}

export const config = {
  // /api is excluded entirely: the middleware already declared /api an open path and ignored its
  // own auth result there, so every API call was paying a wasted network auth round-trip (and the
  // 2.5s worst-case stall) for nothing. Route handlers do their own auth.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|icon-192.png|icon-512.png|icon-180.png|api/).*)']
}
