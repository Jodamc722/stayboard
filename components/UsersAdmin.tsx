'use client'
// Admin console — people & access. Each teammate has: a ROLE (admin/member), a WORKSPACE preset
// (Ops / Customer Service / GM / Data / Admin) that defines which pages they see and where they
// land, optional per-page overrides on top (owner-only), profile details (name/title/phone),
// notification preferences, and activity (last sign-in / last seen). Workspace + page overrides
// are owner-only; everything else any admin can manage.
import { useEffect, useState } from 'react'
import {
  UserPlus, Shield, User as UserIcon, Check, AlertTriangle, Loader2, Ban, RotateCcw, Trash2,
  KeyRound, ChevronDown, ChevronRight, LayoutGrid, BellOff, Bell, IdCard, Clock, SlidersHorizontal
} from 'lucide-react'
import { FEATURES, WORKSPACES, workspaceDef, workspaceAllows, normWorkspace, type Workspace } from '@/lib/features'

type Row = {
  email: string; role: 'admin' | 'member'; status: 'active' | 'disabled'
  features?: Record<string, boolean> | null
  workspace?: string | null
  profile?: Record<string, any> | null
  prefs?: Record<string, any> | null
  invited_by: string | null; created_at: string; last_invited_at: string | null
  last_seen_at?: string | null; last_sign_in_at?: string | null
}

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  // add form
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [ws, setWs] = useState<Workspace>('ops')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/users'); const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Failed to load users.')
      setRows(j.users || [])
    } catch (e: any) { setError(e.message || String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function invite(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setMsg(null)
    try {
      const r = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, role, workspace: role === 'admin' ? undefined : ws, password: password || undefined }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed to add user.')
      if (j.password) setMsg(j.password.passwordSet ? `Login created for ${j.email}. Share the email + password with them securely — they can sign in right away.` : (j.password.note || `Access granted to ${j.email}.`))
      else setMsg(j.invite?.sent ? `Invite sent to ${j.email}. They'll set a password from the email.` : (j.invite?.note || `Access granted to ${j.email}.`))
      setEmail(''); setRole('member'); setWs('ops'); setPassword(''); load()
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
          <div>
            <label className="block text-[12px] font-semibold text-muted mb-1">Role</label>
            <select value={role} onChange={e => setRole(e.target.value as any)} className="text-sm rounded-lg border border-line bg-app px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200">
              <option value="member">Member</option>
              <option value="admin">Admin — full app + manage users</option>
            </select>
          </div>
          {role === 'member' && (
            <div>
              <label className="block text-[12px] font-semibold text-muted mb-1">Workspace</label>
              <select value={ws} onChange={e => setWs(normWorkspace(e.target.value))} className="text-sm rounded-lg border border-line bg-app px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200">
                {WORKSPACES.filter(w => w.key !== 'admin').map(w => <option key={w.key} value={w.key}>{w.label}</option>)}
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
          {role === 'member' ? <>They&apos;ll see the <b>{workspaceDef(ws).label}</b> workspace: {workspaceDef(ws).blurb.toLowerCase()}. You can fine-tune pages after adding them.</>
            : 'Admins see every page and can manage users.'}
        </p>
      </form>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}
      {msg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700 flex items-center gap-2"><Check size={14} /> {msg}</div>}

      <div className="rounded-2xl border border-line bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-line text-sm font-bold text-ink">People with access</div>
        {loading ? (
          <div className="px-4 py-10 text-center text-sm text-muted">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted">No users yet. Invite someone above. <span className="block mt-1 text-[12px]">(If this looks wrong, the <code>app_users</code> table may not be set up yet.)</span></div>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map(u => (
              <UserRow key={u.email} u={u} me={u.email === myEmail} isOwner={isOwner}
                expanded={open === u.email} onToggle={() => setOpen(open === u.email ? null : u.email)}
                onPatch={patch} onResetPw={() => resetPw(u.email)} onDelete={() => del(u.email)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function UserRow({ u, me, isOwner, expanded, onToggle, onPatch, onResetPw, onDelete }: {
  u: Row; me: boolean; isOwner: boolean; expanded: boolean; onToggle: () => void
  onPatch: (email: string, body: any, okMsg?: string) => Promise<void>
  onResetPw: () => void; onDelete: () => void
}) {
  const isOwnerRow = u.email === OWNER
  const wsKey: Workspace = u.role === 'admin' ? 'admin' : normWorkspace(u.workspace)
  const wsDef = workspaceDef(wsKey)
  const name = String(u.profile?.name || '')
  // local profile edit state
  const [pName, setPName] = useState(name)
  const [pTitle, setPTitle] = useState(String(u.profile?.title || ''))
  const [pPhone, setPPhone] = useState(String(u.profile?.phone || ''))
  const [savingProfile, setSavingProfile] = useState(false)
  useEffect(() => { setPName(String(u.profile?.name || '')); setPTitle(String(u.profile?.title || '')); setPPhone(String(u.profile?.phone || '')) }, [u.email, u.profile])
  const profileDirty = pName !== String(u.profile?.name || '') || pTitle !== String(u.profile?.title || '') || pPhone !== String(u.profile?.phone || '')

  const prefs = (u.prefs && typeof u.prefs === 'object') ? u.prefs : {}
  const setPref = (k: string, v: boolean) => onPatch(u.email, { prefs: { ...prefs, [k]: v } })
  const setFeature = (key: string, enabled: boolean) => onPatch(u.email, { features: { ...(u.features || {}), [key]: enabled } })

  const bundlePages = FEATURES.filter(f => workspaceAllows(wsKey, f.key))
  const activeCount = bundlePages.filter(f => (u.features?.[f.key]) !== false).length

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
              <span className="text-[10px] font-semibold px-1.5 py-px rounded bg-brand-50 text-brand-700">{wsDef.label}</span>
              {u.status === 'disabled' && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Disabled</span>}
            </div>
            <div className="text-[11px] text-muted mt-0.5 inline-flex items-center gap-1">
              <Clock size={10} /> Last sign-in {ago(u.last_sign_in_at)}{u.last_seen_at ? ` · active ${ago(u.last_seen_at)}` : ''}
              {u.profile?.title ? ` · ${u.profile.title}` : ''}
              {!isOwnerRow && u.role !== 'admin' ? ` · ${activeCount}/${bundlePages.length} pages` : ''}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-2">
          {/* The profile / workspace / page-access panels live behind this button. It is the primary
              action on the row, so it reads as a real button rather than a bare chevron. */}
          <button onClick={onToggle}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition-colors ${expanded ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-brand-300 text-brand-700 hover:bg-brand-50'}`}>
            <SlidersHorizontal size={13} /> {expanded ? 'Close' : 'Edit access'}
          </button>
          <select value={u.role} disabled={me || isOwnerRow} onChange={e => onPatch(u.email, { role: e.target.value })}
            className="text-[12px] rounded-lg border border-line bg-app px-2 py-1 disabled:opacity-50">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
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
              {[['mute_all', 'All notifications'], ['mute_mention', '@Mentions'], ['mute_comment', 'Comments']].map(([k, lab]) => {
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

          {/* Workspace + page access (owner-only editing) */}
          <div className="rounded-xl border border-line bg-app/40 p-3 lg:col-span-2">
            <div className="text-[12px] font-bold text-ink mb-2 inline-flex items-center gap-1.5"><LayoutGrid size={13} className="text-brand-600" /> Workspace &amp; page access</div>
            {isOwnerRow ? (
              <p className="text-[12px] text-muted">The owner always has every page.</p>
            ) : u.role === 'admin' ? (
              <p className="text-[12px] text-muted">Admins have the Admin workspace — every page, plus user management. Switch their role to Member to scope their pages.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {WORKSPACES.filter(w => w.key !== 'admin').map(w => {
                    const active = w.key === wsKey
                    return (
                      <button key={w.key} disabled={!isOwner} onClick={() => onPatch(u.email, { workspace: w.key }, `Workspace set to ${w.label}.`)}
                        title={w.blurb + (isOwner ? '' : ' — only the owner can change this')}
                        className={`text-[11px] px-2.5 py-1.5 rounded-lg border font-semibold transition-colors disabled:cursor-not-allowed ${active ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-line text-muted hover:border-brand-300 disabled:opacity-50'}`}>
                        {w.label}
                      </button>
                    )
                  })}
                  <span className="text-[11px] text-muted self-center ml-1">Lands on <code className="text-[10px]">{wsDef.landing}</code> · {activeCount}/{bundlePages.length} pages on</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {bundlePages.map(fe => {
                    const on = (u.features?.[fe.key]) !== false
                    return (
                      <button key={fe.key} disabled={!isOwner} onClick={() => setFeature(fe.key, !on)}
                        className={`text-[11px] px-2 py-1 rounded-md border transition-colors disabled:cursor-not-allowed ${on ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100' : 'bg-app border-line text-muted hover:bg-white'}`}>
                        {on ? <Check size={10} className="inline -mt-0.5 mr-0.5" /> : <Ban size={10} className="inline -mt-0.5 mr-0.5" />}{fe.label}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[10px] text-muted mt-1.5">
                  The workspace sets which pages exist for them; green toggles fine-tune within it. Hidden pages disappear from their menu and are blocked if they type the URL.
                  {!isOwner && ' Only the owner can change workspaces and page access.'}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  )
}
