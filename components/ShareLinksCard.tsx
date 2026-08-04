'use client'
import { useEffect, useState } from 'react'
import { Link2 } from 'lucide-react'

type ShareLink = { v: string; label: string; path?: string }

export function ShareLinksCard() {
  const [links, setLinks] = useState<ShareLink[]>([])
  const [password, setPassword] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState('')
  const [adminSet, setAdminSet] = useState(false)
  const [adminCurrent, setAdminCurrent] = useState('')  // only ever sent to the Super Admin
  const [showAdminPw, setShowAdminPw] = useState(false)
  const [adminDraft, setAdminDraft] = useState('')
  const [adminMsg, setAdminMsg] = useState('')
  const [adminErr, setAdminErr] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)
  // Marketing partner link — its own password so an agency gets booking numbers, never the ops boards.
  const [mktLinks, setMktLinks] = useState<ShareLink[]>([])
  const [mktSet, setMktSet] = useState(false)
  const [mktCurrent, setMktCurrent] = useState('')
  const [mktDraft, setMktDraft] = useState('')
  const [mktMsg, setMktMsg] = useState('')
  const [mktErr, setMktErr] = useState('')
  const [mktBusy, setMktBusy] = useState(false)
  // Owner-audit reviewer link — its own password: the reviewer sees owner-level money, nothing else.
  const [oaLinks, setOaLinks] = useState<ShareLink[]>([])
  const [oaSet, setOaSet] = useState(false)
  const [oaCurrent, setOaCurrent] = useState('')
  const [oaDraft, setOaDraft] = useState('')
  const [oaMsg, setOaMsg] = useState('')
  const [oaErr, setOaErr] = useState('')
  const [oaBusy, setOaBusy] = useState(false)

  useEffect(() => { setOrigin(window.location.origin) }, [])
  useEffect(() => {
    fetch('/api/share-settings', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j.ok) { setLinks(j.links || []); setPassword(j.password || ''); setDraft(j.password || ''); setAdminSet(!!j.adminSet); setAdminCurrent(j.adminPassword || ''); setMktLinks(j.marketingLinks || []); setMktSet(!!j.marketingSet); setMktCurrent(j.marketingPassword || ''); setMktDraft(j.marketingPassword || ''); setOaLinks(j.auditLinks || []); setOaSet(!!j.auditSet); setOaCurrent(j.auditPassword || ''); setOaDraft(j.auditPassword || '') } })
      .catch(() => {})
  }, [])

  const save = async () => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/share-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: draft.trim() }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not save'); setBusy(false); return }
      setPassword(j.password); setMsg('Password updated. Anyone using the old one will be asked to sign in again.')
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  const saveAdmin = async () => {
    setAdminBusy(true); setAdminErr(''); setAdminMsg('')
    try {
      const r = await fetch('/api/share-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminPassword: adminDraft.trim() }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setAdminErr(j.error || 'Could not save'); setAdminBusy(false); return }
      setAdminSet(true); setAdminDraft(''); setAdminMsg('Admin password saved. Deleting a clean from the scheduler now requires it.')
    } catch (e: any) { setAdminErr(String(e?.message || e)) }
    setAdminBusy(false)
  }

  const saveMkt = async () => {
    setMktBusy(true); setMktErr(''); setMktMsg('')
    try {
      const r = await fetch('/api/share-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marketingPassword: mktDraft.trim() }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setMktErr(j.error || 'Could not save'); setMktBusy(false); return }
      setMktSet(true); setMktCurrent(j.marketingPassword || mktDraft.trim()); setMktMsg('Marketing password saved. Send it with the link above.')
    } catch (e: any) { setMktErr(String(e?.message || e)) }
    setMktBusy(false)
  }

  const saveOa = async () => {
    setOaBusy(true); setOaErr(''); setOaMsg('')
    try {
      const r = await fetch('/api/share-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auditPassword: oaDraft.trim() }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setOaErr(j.error || 'Could not save'); setOaBusy(false); return }
      setOaSet(true); setOaCurrent(j.auditPassword || oaDraft.trim()); setOaMsg('Audit password saved. Send it with the link above.')
    } catch (e: any) { setOaErr(String(e?.message || e)) }
    setOaBusy(false)
  }

  const copy = (v: string, url: string) => { try { navigator.clipboard.writeText(url); setCopied(v); setTimeout(() => setCopied(''), 1500) } catch {} }

  return (
    <div className="rounded-2xl border border-line bg-white p-5 mt-6">
      <div className="flex items-center gap-2 mb-1"><Link2 size={16} className="text-muted" /><h2 className="font-semibold text-ink">Vendor share links</h2></div>
      <p className="text-sm text-muted mb-4">Send these to vendors and the front desk. They open without a Lighthouse login — one shared password protects all of them.</p>
      <div className="space-y-2 mb-5">
        {links.map(l => { const href = l.path || '/vendor/' + l.v; const url = origin + href; return (
          <div key={l.v} className="flex items-center gap-2 text-sm">
            <span className="w-44 shrink-0 font-medium text-ink">{l.label}</span>
            <a href={href} target="_blank" rel="noreferrer" className="flex-1 truncate text-brand-600 hover:underline">{url}</a>
            <button onClick={() => copy(l.v, url)} className="text-xs px-2 py-1 rounded-lg border border-line hover:bg-app">{copied === l.v ? 'Copied' : 'Copy'}</button>
          </div>
        )})}
        {links.length === 0 && <div className="text-sm text-muted">Loading links…</div>}
      </div>
      <div className="border-t border-line pt-4">
        <label className="text-xs uppercase tracking-wide text-muted">Shared password</label>
        <div className="flex gap-2 mt-1 max-w-md">
          <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Password" className="flex-1 text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          <button onClick={save} disabled={busy || draft.trim().length < 4 || draft === password} className="text-sm font-medium px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-40">{busy ? 'Saving…' : 'Update'}</button>
        </div>
        {msg && <div className="text-xs text-emerald-700 mt-2">{msg}</div>}
        {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
      </div>
      <div className="border-t border-line pt-4 mt-4">
        <label className="text-xs uppercase tracking-wide text-muted">Marketing partner link &mdash; separate password</label>
        <p className="text-xs text-muted mt-0.5 mb-2">Direct-booking performance for marketing partners. Booking numbers only &mdash; guest names are shortened and this password does not open any ops board. {mktSet ? 'Currently SET.' : 'Not set yet — the link stays locked until you set one.'}</p>
        <div className="space-y-2 mb-3">
          {mktLinks.map(l => { const href = l.path || '/report/' + l.v; const url = origin + href; return (
            <div key={l.v} className="flex items-center gap-2 text-sm">
              <span className="w-44 shrink-0 font-medium text-ink">{l.label}</span>
              <a href={href} target="_blank" rel="noreferrer" className="flex-1 truncate text-brand-600 hover:underline">{url}</a>
              <button onClick={() => copy(l.v, url)} className="text-xs px-2 py-1 rounded-lg border border-line hover:bg-app">{copied === l.v ? 'Copied' : 'Copy'}</button>
            </div>
          )})}
        </div>
        <div className="flex gap-2 mt-1 max-w-md">
          <input value={mktDraft} onChange={e => setMktDraft(e.target.value)} placeholder={mktSet ? 'Marketing password' : 'Create marketing password'} className="flex-1 text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          <button onClick={saveMkt} disabled={mktBusy || mktDraft.trim().length < 4 || mktDraft.trim() === mktCurrent} className="text-sm font-medium px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-40">{mktBusy ? 'Saving…' : mktSet ? 'Update' : 'Set'}</button>
        </div>
        {mktMsg && <div className="text-xs text-emerald-700 mt-2">{mktMsg}</div>}
        {mktErr && <div className="text-xs text-red-600 mt-2">{mktErr}</div>}
      </div>
      <div className="border-t border-line pt-4 mt-4">
        <label className="text-xs uppercase tracking-wide text-muted">Owner statement audit &mdash; separate password</label>
        <p className="text-xs text-muted mt-0.5 mb-2">The monthly statement review board. Reviewers on this link can mark rows and comment but see nothing else in the app. {oaSet ? 'Currently SET.' : 'Not set yet — the link stays locked until you set one.'}</p>
        <div className="space-y-2 mb-3">
          {oaLinks.map(l => { const href = l.path || '/report/' + l.v; const url = origin + href; return (
            <div key={l.v} className="flex items-center gap-2 text-sm">
              <span className="w-44 shrink-0 font-medium text-ink">{l.label}</span>
              <a href={href} target="_blank" rel="noreferrer" className="flex-1 truncate text-brand-600 hover:underline">{url}</a>
              <button onClick={() => copy(l.v, url)} className="text-xs px-2 py-1 rounded-lg border border-line hover:bg-app">{copied === l.v ? 'Copied' : 'Copy'}</button>
            </div>
          )})}
        </div>
        <div className="flex gap-2 mt-1 max-w-md">
          <input value={oaDraft} onChange={e => setOaDraft(e.target.value)} placeholder={oaSet ? 'Audit password' : 'Create audit password'} className="flex-1 text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          <button onClick={saveOa} disabled={oaBusy || oaDraft.trim().length < 4 || oaDraft.trim() === oaCurrent} className="text-sm font-medium px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-40">{oaBusy ? 'Saving…' : oaSet ? 'Update' : 'Set'}</button>
        </div>
        {oaMsg && <div className="text-xs text-emerald-700 mt-2">{oaMsg}</div>}
        {oaErr && <div className="text-xs text-red-600 mt-2">{oaErr}</div>}
      </div>
      <div className="border-t border-line pt-4 mt-4">
        <label className="text-xs uppercase tracking-wide text-muted">Admin password &mdash; destructive actions</label>
        <p className="text-xs text-muted mt-0.5 mb-1">Required to delete ANY task or record, anywhere in the app. {adminSet ? 'Currently SET.' : 'Not set yet \u2014 Delete is locked until you set one.'}</p>
        {adminCurrent && (
          <div className="flex items-center gap-2 mb-2 text-sm">
            <span className="text-muted">Current password:</span>
            <code className="px-2 py-1 rounded-md bg-app border border-line font-mono text-ink">{showAdminPw ? adminCurrent : '\u2022'.repeat(Math.min(adminCurrent.length, 12))}</code>
            <button onClick={() => setShowAdminPw(!showAdminPw)} className="text-xs font-medium text-brand-700 hover:underline">{showAdminPw ? 'Hide' : 'Show'}</button>
            <span className="text-[11px] text-muted">Visible only to the Super Admin account.</span>
          </div>
        )}
        <div className="flex gap-2 mt-1 max-w-md">
          <input type="password" value={adminDraft} onChange={e => setAdminDraft(e.target.value)} placeholder={adminSet ? 'New admin password' : 'Create admin password'} className="flex-1 text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          <button onClick={saveAdmin} disabled={adminBusy || adminDraft.trim().length < 4} className="text-sm font-medium px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-40">{adminBusy ? 'Saving\u2026' : adminSet ? 'Change' : 'Set'}</button>
        </div>
        {adminMsg && <div className="text-xs text-emerald-700 mt-2">{adminMsg}</div>}
        {adminErr && <div className="text-xs text-red-600 mt-2">{adminErr}</div>}
      </div>
    </div>
  )
}
