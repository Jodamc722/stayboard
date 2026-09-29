// HOTEL MEMBERSHIP — add, change or remove a login's hotel role (and, for the owner or a VR admin,
// their VR role). Shared by /api/garden/people (the Users & admin console) and /api/garden/team.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { isSuperadmin, type Access } from '../access'

const clean = (v: any) => String(v ?? '').trim().toLowerCase()
export type MemberResult = { ok: true; email: string; login?: any; note?: string } | { ok: false; status: number; error: string }

export async function upsertMember(b: { email: string; garden_role?: string | null; vr_role?: string | null; name?: string; password?: string }, actor: Access, origin: string): Promise<MemberResult> {
  const db = supabaseAdmin()
  const by = actor.email || null
  const canVr = isSuperadmin(actor.email) || actor.role === 'admin'
  const E = (status: number, error: string): MemberResult => ({ ok: false, status, error })
    const email = clean(b?.email)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return E(400, 'A valid email is required.')
    if (isSuperadmin(email)) return E(400, 'The owner is always the hotel GM.')
    const { data: role } = await db.from('garden_roles').select('key').eq('key', String(b?.garden_role || '')).maybeSingle()
    if (!role) return E(400, 'Pick a hotel role.')
    const { data: ex } = await db.from('app_users').select('email,businesses,role,profile').eq('email', email).maybeSingle()
    let businesses: string[] = Array.isArray((ex as any)?.businesses) ? (ex as any).businesses : ex ? ['vr'] : []
    businesses = businesses.filter(x => x !== 'garden').concat('garden')
    let vrPatch: any = {}
    if (b?.vr_role !== undefined) {
      if (!canVr) return E(403, 'Only the owner or a VR admin can change access to the vacation-rental side.')
      const want = String(b.vr_role || '')
      if ((ex as any)?.role === 'admin' && !isSuperadmin(actor.email)) return E(403, 'Only the owner can change a VR admin.')
      if (!want) { businesses = businesses.filter(x => x !== 'vr'); vrPatch = { role: 'member', access_role: null } }
      else {
        if (want === 'admin' && !isSuperadmin(actor.email)) return E(403, 'Only the owner can make someone a VR admin.')
        const { data: vr } = await db.from('app_roles').select('key').eq('key', want).maybeSingle()
        if (!vr) return E(400, 'Unknown VR role.')
        businesses = Array.from(new Set([...businesses, 'vr']))
        vrPatch = { access_role: want, role: want === 'admin' ? 'admin' : 'member' }
      }
    } else if (!ex) businesses = ['garden']   // a new login made here is hotel-only unless a VR role is given
    const row: any = { email, garden_role: role.key, businesses, status: 'active', ...vrPatch }
    if (!ex) Object.assign(row, { role: row.role || 'member', invited_by: by, last_invited_at: new Date().toISOString() })
    if (b?.name) row.profile = { ...((ex as any)?.profile || {}), name: String(b.name).slice(0, 80) }
    const { error } = await db.from('app_users').upsert(row, { onConflict: 'email' })
    if (error) return E(500, error.message)
    // A new login: set the password now, or send the invite email.
    let login: any = null
    const password = typeof b?.password === 'string' ? b.password : ''
    if (password && password.length < 8) return { ok: true, email, note: 'Saved, but the password must be at least 8 characters — not set.' }
    try {
      if (password) {
        const { error: cErr } = await (db as any).auth.admin.createUser({ email, password, email_confirm: true })
        login = cErr ? { passwordSet: false, note: /registered|exists/i.test(cErr.message || '') ? 'They already have a Lighthouse login — same password as before.' : cErr.message } : { passwordSet: true }
      } else if (!ex) {
        const redirectTo = `${origin}/auth/callback`
        const { error: iErr } = await (db as any).auth.admin.inviteUserByEmail(email, { redirectTo })
        login = iErr ? { invited: false, note: /registered|exists/i.test(iErr.message || '') ? 'They already have a Lighthouse login.' : iErr.message } : { invited: true }
      }
    } catch (e: any) { login = { note: String(e?.message || e) } }
  return { ok: true, email, login }
}

export async function removeMember(b: { email: string }): Promise<MemberResult> {
  const db = supabaseAdmin()
    const email = clean(b?.email)
    if (isSuperadmin(email)) return { ok: false, status: 400, error: 'The owner cannot be removed.' }
    const { data: ex } = await db.from('app_users').select('businesses').eq('email', email).maybeSingle()
    if (!ex) return { ok: false, status: 404, error: 'Not found.' }
    const businesses = (Array.isArray((ex as any).businesses) ? (ex as any).businesses : ['vr']).filter((x: string) => x !== 'garden')
    // Hotel-only people lose their login entirely; hybrid people keep the VR side.
    const patch: any = { garden_role: null, businesses }
    if (!businesses.length) patch.status = 'disabled'
    const { error } = await db.from('app_users').update(patch).eq('email', email)
    return error ? { ok: false, status: 500, error: error.message } : { ok: true, email }
}
