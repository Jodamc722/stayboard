'use client'
// People admin (/users → People). Each teammate has: a ROLE (member type from app_roles — Admin,
// Manager, Customer Service, Maintenance, … defined on the Roles tab) that sets which tabs they
// see and at what level (off/view/edit/full), profile details (name/title/phone), notification
// preferences, and activity (last sign-in / last seen). Role assignment is OWNER-ONLY; profile,
// prefs, passwords, disable/delete are any-admin. Legacy workspaces remain the fallback until
// migration 023 runs (the UI says so instead of breaking).
import { useEffect, useState } from 'react'
import {
  UserPlus, Shield, User as UserIcon, Check, AlertTriangle, Loader2, Ban, RotateCcw, Trash2,
  KeyRound, ChevronDown, ChevronRight, BellOff, Bell, IdCard, Clock, SlidersHorizontal, ShieldCheck
} from 'lucide-react'
import { workspaceDef, normWorkspace } from '@/lib/features'

type Row = {
  email: string; role: 'admin' | 'member'; status: 'active' | 'disabled'
  features?: Record<string, boolean> | null
  workspace?: string | null
  access_role?: string | null
  profile?: Record<string, any> | null
  prefs?: Record<string, any> | null
  invited_by: string | null; created_at: string; last_invited_at: string | null
  last_seen_at?: string | null; last_sign_in_at?: string | null
}
type RoleRow = { key: string; label: string; blurb: string; is_system: boolean }

const OWNER = 'jon@stay-hospitality.com'

function ago(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const d = new Date(iso); if (isNaN(d.getTime())) return 'never'
  const m = Math.floor((Date.now() - d.getTime()) / 60000)
  if (m < 2) return 'just now'
  if (m < 60) return `${m}m ago`
  if (m < 48 * 60) return `${Math.floor(m / 60)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function UsersAdmin({ myEmail, isOwner }: { myEmail: string; isOwner: boolean }) {
  const [rows, setRows] = useState<Row[]>([])
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [rolesReady, setRolesReady] = useState(false)   // false = pre-migration-023 (legacy mode)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState('')
  // add form
  const [email, setEmail] = useState('')
  const [addRole, setAddRole] = useState('cs')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true); setError(null)
    try {
      const [ur, rr] = await Promise.all([fetch('/api/users'), fetch('/api/roles')])
      const uj = await ur.json()
      if (!ur.ok) throw new Error(uj?.error || 'Failed to load users.')
      setRows(uj.users || [])
      try {
        const rj = await rr.json()
        if (rr.ok && Array.isArray(rj.roles) && rj.roles.length) { setRoles(rj.roles); setRolesReady(true) }
        else setRolesReady(false)
      } catch { setRolesReady(false) }
    } catch (e: any) { setError(e.message || String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function invite(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setMsg(null)
    try {
      const body: any = { email, password: password || undefined }
      if (rolesReady) { body.role = addRole === 'admin' ? 'admin' : 'member'; body.access_role = addRole }
      else body.role = 'member'
      const r = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed to add user.')
      if (j.password) setMsg(j.password.passwordSet ? `Login created for ${j.email}. Share the email + password with them securely — they can sign in right away.` : (j.password.note || `Access granted to ${j.email}.`))
      else setMsg(j.invite?.sent ? `Invite sent to ${j.email}. They'll set a password from the email.` : (j.invite?.note || `Access granted to ${j.email}.`))
      setEmail(''); setPassword(''); load()
    } catch (e: any) { setError(e.message || String(e)) } finally { setBusy(false) }
  }

  async function patch(email: string, body: any, okMsg?: string) {
    setError(null); setMsg(null)
    try {
      const r = await fetch('/api/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, ...body }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed to update.')
      if (okMsg) setMsg(okMsg)
      load()
    } catch (e: any) { setError(e.message || String(e)); load() }
  }

  async function resetPw(email: string) {
    const pw = window.prompt(`Set a new password for ${email} (min 8 characters). Share it with them securely.`)
    if (pw == null) return
    if (pw.length < 8) { setError('Password must be at least 8 characters.'); return }
    await patch(email, { password: pw }, `Password updated for ${email}. Share it with them securely.`)
  }

  async function del(email: string) {
    if (!window.confirm(`Remove ${email}? This deletes their access AND their login account. They will no longer be able to sign in. This cannot be undone.`)) return
    setError(null); setMsg(null)
    try {
      const r = await fetch('/api/users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed to delete user.')
      setMsg(`Removed ${email}.`); load()
    } catch (e: any) { setError(e.message || String(e)) }
  }

  const roleOf = (u: Row): { key: string; label: string } => {
    if (u.email === OWNER) return { key: 'admin', label: 'Owner' }
    if (rolesReady && u.access_role) {
      const r = roles.find(x => x.key === u.access_role)
      if (r) return { key: r.key, label: r.label }
    }
    if (u.role === 'admin') return { key: 'admin', label: 'Admin' }
    return { key: '', label: workspaceDef(normWorkspace(u.workspace)).label + ' (legacy)' }
  }

  const filtered = rows.filter(u => {
    if (!q.trim()) return true
    const s = q.trim().toLowerCase()
    return u.email.includes(s) || String(u.profile?.name || '').toLowerCase().includes(s) || roleOf(u).label.toLowerCase().includes(s)
  })

  return (
    <div className="space-y-5">
      <form onSubmit={invite} className="rounded-2xl border border-brand-200 bg-white p-4">
        <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5 mb-3"><UserPlus size={15} className="text-brand-600" /> Add a teammate</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[12px] font-semibold text-muted mb-1">Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@stay-hospitality.com"
              className="w-full text-sm rounded-lg border border-line bg-app px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          </div>
          {rolesReady && (
            <div>
              <label className="block text-[12px] font-semibold text-muted mb-1">Role</label>
              <select value={addRole} onChange={e => setAddRole(e.target.value)} className="text-sm rounded-lg border border-line bg-app px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200">
                {roles.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>
          )}
          <div className="min-w-[200px]">
            <label className="block text-[12px] font-semibold text-muted mb-1">Password <span className="font-normal text-muted/70">(optional)</span></label>
            <input type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="Set one, or blank to email invite" autoComplete="new-password"
              className="w-full text-sm rounded-lg border border-line bg-app px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          </div>
          <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-4 py-2 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} {password ? 'Create login' : 'Send invite'}
          </button>
        </div>
        <p className="text-[11px] text-muted mt-2">
          {rolesReady
            ? <>{roles.find(r => r.key === addRole)?.blurb || 'Pick what kind of member they are.'} Fine-tune what each role can do on the <b>Roles</b> tab.</>
            : 'Roles are not set up yet (migration 023) — new people get the legacy member access.'}
        </p>
      </form>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}
      {msg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700 flex items-center gap-2"><Check size={14} /> {msg}</div>}

      <div className="rounded-2xl border border-line bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center gap-3">
          <span className="text-sm font-bold text-ink">People with access</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, role…"
            className="ml-auto text-[12px] rounded-lg border border-line bg-app px-2.5 py-1.5 w-56 focus:outline-none focus:ring-2 focus:ring-brand-200" />
        </div>
        {loading ? (
          <div className="px-4 py-10 text-center text-sm text-muted">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted">{rows.length === 0 ? 'No users yet. Invite someone above.' : 'Nobody matches that search.'}</div>
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map(u => (
              <UserRow key={u.email} u={u} me={u.email === myEmail} isOwner={isOwner} roles={roles} rolesReady={rolesReady} roleInfo={roleOf(u)}
                expanded={open === u.email} onToggle={() => setOpen(open === u.email ? null : u.email)}
                onPatch={patch} onResetPw={() => resetPw(u.email)} onDelete={() => del(u.email)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function UserRow({ u, me, isOwner, roles, rolesReady, roleInfo, expanded, onToggle, onPatch, onResetPw, onDelete }: {
  u: Row; me: boolean; isOwner: boolean; roles: RoleRow[]; rolesReady: boolean; roleInfo: { key: string; label: string }
  expanded: boolean; onToggle: () => void
  onPatch: (email: string, body: any, okMsg?: string) => Promise<void>
  onResetPw: () => void; onDelete: () => void
}) {
  const isOwnerRow = u.email === OWNER
  const name = String(u.profile?.name || '')
  const [pName, setPName] = useState(name)
  const [pTitle, setPTitle] = useState(String(u.profile?.title || ''))
  const [pPhone, setPPhone] = useState(String(u.profile?.phone || ''))
  const [savingProfile, setSavingProfile] = useState(false)
  useEffect(() => { setPName(String(u.profile?.name || '')); setPTitle(String(u.profile?.title || '')); setPPhone(String(u.profile?.phone || '')) }, [u.email, u.profile])
  const profileDirty = pName !== String(u.profile?.name || '') || pTitle !== String(u.profile?.title || '') || pPhone !== String(u.profile?.phone || '')

  const prefs = (u.prefs && typeof u.prefs === 'object') ? u.prefs : {}
  const setPref = (k: string, v: boolean) => onPatch(u.email, { prefs: { ...prefs, [k]: v } })

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={onToggle} className="flex items-center gap-2 min-w-0 flex-1 text-left group">
          {expanded ? <ChevronDown size={14} className="text-muted flex-shrink-0" /> : <ChevronRight size={14} className="text-muted flex-shrink-0" />}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ink inline-flex items-center gap-1.5 flex-wrap">
              {u.role === 'admin' ? <Shield size={13} className="text-brand-600" /> : <UserIcon size={13} className="text-muted" />}
              <span className="group-hover:underline">{name || u.email}</span>
              {name && <span className="text-[11px] text-muted font-normal">{u.email}</span>}
              {me && <span className="text-[11px] text-muted font-normal">(you)</span>}
              <span className="text-[10px] font-semibold px-1.5 py-px rounded bg-brand-50 text-brand-700">{roleInfo.label}</span>
              {u.status === 'disabled' && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Disabled</span>}
            </div>
            <div className="text-[11px] text-muted mt-0.5 inline-flex items-center gap-1">
              <Clock size={10} /> Last sign-in {ago(u.last_sign_in_at)}{u.last_seen_at ? ` · active ${ago(u.last_seen_at)}` : ''}
              {u.profile?.title ? ` · ${u.profile.title}` : ''}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-2">
          <button onClick={onToggle}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition-colors ${expanded ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-brand-300 text-brand-700 hover:bg-brand-50'}`}>
            <SlidersHorizontal size={13} /> {expanded ? 'Close' : 'Edit'}
          </button>
          {u.status === 'active' ? (
            <button onClick={() => onPatch(u.email, { status: 'disabled' })} disabled={me || isOwnerRow} className="inline-flex items-center gap-1 text-[12px] text-rose-600 hover:text-rose-700 disabled:opacity-40"><Ban size={13} /> Disable</button>
          ) : (
            <button onClick={() => onPatch(u.email, { status: 'active' })} className="inline-flex items-center gap-1 text-[12px] text-emerald-600 hover:text-emerald-700"><RotateCcw size={13} /> Re-enable</button>
          )}
          <button onClick={onResetPw} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-brand-700"><KeyRound size={13} /> Password</button>
          <button onClick={onDelete} disabled={me || isOwnerRow} title={isOwnerRow ? 'The owner account cannot be deleted' : 'Delete user'} className="inline-flex items-center gap-1 text-[12px] text-rose-600 hover:text-rose-700 disabled:opacity-30 disabled:cursor-not-allowed"><Trash2 size={13} /> Delete</button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 ml-6 grid gap-3 lg:grid-cols-2">
          {/* Role (owner-only) */}
          <div className="rounded-xl border border-line bg-app/40 p-3 lg:col-span-2">
            <div className="text-[12px] font-bold text-ink mb-2 inline-flex items-center gap-1.5"><ShieldCheck size={13} className="text-brand-600" /> Role</div>
            {isOwnerRow ? (
              <p className="text-[12px] text-muted">The owner always has every page at full access.</p>
            ) : !rolesReady ? (
              <p className="text-[12px] text-muted">Roles aren&apos;t set up yet — run migration 023, then assign roles here. Until then this person keeps their legacy {workspaceDef(normWorkspace(u.workspace)).label} workspace access.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {roles.map(r => {
                    const active = r.key === (u.access_role || (u.role === 'admin' ? 'admin' : ''))
                    return (
                      <button key={r.key} disabled={!isOwner || me} onClick={() => onPatch(u.email, { access_role: r.key }, `${name || u.email} is now ${r.label}.`)}
                        title={r.blurb + (isOwner ? '' : ' — only the owner can change roles')}
                        className={`text-[11px] px-2.5 py-1.5 rounded-lg border font-semibold transition-colors disabled:cursor-not-allowed ${active ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-line text-muted hover:border-brand-300 disabled:opacity-50'}`}>
                        {r.label}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[10px] text-muted mt-1.5">
                  The role decides which tabs they see and what they can do there (view / edit / full) — edit the details on the <b>Roles</b> tab.
                  {!isOwner && ' Only the owner can change roles.'}
                </p>
              </>
            )}
          </div>

          {/* Profile details */}
          <div className="rounded-xl border border-line bg-app/40 p-3">
            <div className="text-[12px] font-bold text-ink mb-2 inline-flex items-center gap-1.5"><IdCard size={13} className="text-brand-600" /> Profile</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {[['Name', pName, setPName, 'Full name'], ['Title', pTitle, setPTitle, 'e.g. GM, Ops lead'], ['Phone', pPhone, setPPhone, '+1 …']].map(([lab, val, set, ph]: any) => (
                <div key={lab}>
                  <label className="block text-[11px] font-semibold text-muted mb-0.5">{lab}</label>
                  <input value={val} onChange={e => set(e.target.value)} placeholder={ph}
                    className="w-full text-[12px] rounded-lg border border-line bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                </div>
              ))}
            </div>
            {profileDirty && (
              <button onClick={async () => { setSavingProfile(true); await onPatch(u.email, { profile: { ...(u.profile || {}), name: pName.trim(), title: pTitle.trim(), phone: pPhone.trim() } }, 'Profile saved.'); setSavingProfile(false) }}
                disabled={savingProfile} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-2.5 py-1 text-[11px] font-semibold hover:bg-brand-700 disabled:opacity-50">
                {savingProfile ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save profile
              </button>
            )}
          </div>

          {/* Notification preferences */}
          <div className="rounded-xl border border-line bg-app/40 p-3">
            <div className="text-[12px] font-bold text-ink mb-2 inline-flex items-center gap-1.5"><Bell size={13} className="text-brand-600" /> Notifications</div>
            <div className="flex flex-wrap gap-1.5">
              {[['mute_all', 'All notifications'], ['mute_mention', '@Mentions'], ['mute_comment', 'Comments'], ['mute_ops_alert', 'Ops alerts (cleans running behind)']].map(([k, lab]) => {
                const mutedNow = prefs[k] === true
                return (
                  <button key={k} onClick={() => setPref(k, !mutedNow)}
                    className={`text-[11px] px-2 py-1 rounded-md border inline-flex items-center gap-1 transition-colors ${!mutedNow ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100' : 'bg-app border-line text-muted hover:bg-white'}`}>
                    {!mutedNow ? <Bell size={10} /> : <BellOff size={10} />}{lab}: {!mutedNow ? 'on' : 'muted'}
                  </button>
                )
              })}
            </div>
            <p className="text-[10px] text-muted mt-1.5">Controls the in-app bell. Muting &quot;All&quot; stops everything for this person.</p>
          </div>
        </div>
      )}
    </li>
  )
}
