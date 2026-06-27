'use client'
import { useEffect, useState } from 'react'
import { UserPlus, Shield, User as UserIcon, Check, AlertTriangle, Loader2, Ban, RotateCcw } from 'lucide-react'

type Row = { email: string; role: 'admin' | 'member'; status: 'active' | 'disabled'; invited_by: string | null; created_at: string; last_invited_at: string | null }

export function UsersAdmin({ myEmail }: { myEmail: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
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
      const r = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, role }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed to invite.')
      setMsg(j.invite?.sent ? `Invite sent to ${j.email}. They'll set a password from the email.` : (j.invite?.note || `Access granted to ${j.email}.`))
      setEmail(''); setRole('member'); load()
    } catch (e: any) { setError(e.message || String(e)) } finally { setBusy(false) }
  }

  async function patch(email: string, patch: { role?: 'admin' | 'member'; status?: 'active' | 'disabled' }) {
    setError(null); setMsg(null)
    try {
      const r = await fetch('/api/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, ...patch }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed to update.')
      load()
    } catch (e: any) { setError(e.message || String(e)) }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={invite} className="rounded-2xl border border-brand-200 bg-white p-4">
        <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5 mb-3"><UserPlus size={15} className="text-brand-600" /> Invite a teammate</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[12px] font-semibold text-muted mb-1">Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@stay-hospitality.com"
              className="w-full text-sm rounded-lg border border-line bg-app px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-muted mb-1">Role</label>
            <select value={role} onChange={e => setRole(e.target.value as any)} className="text-sm rounded-lg border border-line bg-app px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200">
              <option value="member">Member — full app</option>
              <option value="admin">Admin — full app + manage users</option>
            </select>
          </div>
          <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-4 py-2 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} Send invite
          </button>
        </div>
        <p className="text-[11px] text-muted mt-2">They get an email to set their own password, then sign in with email + password. Access is granted immediately even before they accept.</p>
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
            {rows.map(u => {
              const me = u.email === myEmail
              return (
                <li key={u.email} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">
                      {u.role === 'admin' ? <Shield size={13} className="text-brand-600" /> : <UserIcon size={13} className="text-muted" />}
                      {u.email}{me && <span className="text-[11px] text-muted font-normal">(you)</span>}
                      {u.status === 'disabled' && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Disabled</span>}
                    </div>
                    <div className="text-[11px] text-muted mt-0.5">{u.role === 'admin' ? 'Admin' : 'Member'}{u.invited_by ? ` · invited by ${u.invited_by}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select value={u.role} disabled={me} onChange={e => patch(u.email, { role: e.target.value as any })}
                      className="text-[12px] rounded-lg border border-line bg-app px-2 py-1 disabled:opacity-50">
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    {u.status === 'active' ? (
                      <button onClick={() => patch(u.email, { status: 'disabled' })} disabled={me} className="inline-flex items-center gap-1 text-[12px] text-rose-600 hover:text-rose-700 disabled:opacity-40"><Ban size={13} /> Disable</button>
                    ) : (
                      <button onClick={() => patch(u.email, { status: 'active' })} className="inline-flex items-center gap-1 text-[12px] text-emerald-600 hover:text-emerald-700"><RotateCcw size={13} /> Re-enable</button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
