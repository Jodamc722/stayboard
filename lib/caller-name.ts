// WHO MADE THE CALL (Jon, 2026-09-22: "Who completed should be based on user logged in").
// A call marked by hand is credited to the signed-in account, never to a name typed in a box. Talkroute's
// automatic closes carry their own caller (the device map), so this is only the manual path.
export async function signedInName(sb: any, email: string): Promise<string> {
  const e = String(email || '').toLowerCase()
  try {
    const { data } = await sb.from('app_users').select('profile').eq('email', e).maybeSingle()
    const p: any = data?.profile
    const n = String((p && typeof p === 'object' && (p.name || p.full_name)) || '').trim()
    if (n) return n.slice(0, 80)
  } catch { /* fall back to the address */ }
  const local = e.split('@')[0] || e
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'Unknown'
}
