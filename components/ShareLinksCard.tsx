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
  // Salato rules-editing password — lets front-desk staff (no app login) edit the Salato rules.
  const [rpSet, setRpSet] = useState(false)
  const [rpCurrent, setRpCurrent] = useState('')
  const [rpDraft, setRpDraft] = useState('')
  const [rpMsg, setRpMsg] = useState('')
  const [rpErr, setRpErr] = useState('')
  const [rpBusy, setRpBusy] = useState(false)
  // Vault code — asked on EVERY reveal in the vault; every entry is logged against the person.
  const [vcSet, setVcSet] = useState(false)
  const [vcCurrent, setVcCurrent] = useState('')   // only ever sent to the Super Admin
  const [showVc, setShowVc] = useState(false)
  const [vcDraft, setVcDraft] = useState('')
  const [vcMsg, setVcMsg] = useState('')
  const [vcErr, setVcErr] = useState('')
  const [vcBusy, setVcBusy] = useState(false)

  useEffect(() => { setOrigin(window.location.origin) }, [])
  useEffect(() => {
    fetch('/api/share-settings', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j.ok) { setLinks(j.links || []); setPassword(j.password || ''); setDraft(j.password || ''); setAdminSet(!!j.adminSet); setAdminCurrent(j.adminPassword || ''); setMktLinks(j.marketingLinks || []); setMktSet(!!j.marketingSet); setMktCurrent(j.marketingPassword || ''); setMktDraft(j.marketingPassword || ''); setOaLinks(j.auditLinks || []); setOaSet(!!j.auditSet); setOaCurrent(j.auditPassword || ''); setOaDraft(j.auditPassword || ''); setRpSet(!!j.rulesSet); setRpCurrent(j.rulesPassword || ''); setRpDraft(j.rulesPassword || ''); setVcSet(!!j.vaultSet); setVcCurrent(j.vaultCode || '') } })
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

  const saveRp = async () => {
    setRpBusy(true); setRpErr(''); setRpMsg('')
    try {
      const r = await fetch('/api/share-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rulesPassword: rpDraft.trim() }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setRpErr(j.error || 'Could not save'); setRpBusy(false); return }
      setRpSet(true); setRpCurrent(j.rulesPassword || rpDraft.trim()); setRpMsg('Rules password saved. Front-desk staff can use it to edit the Salato rules from the share link.')
    } catch (e: any) { setRpErr(String(e?.message || e)) }
    setRpBusy(false)
  }

  const saveVc = async () => {
    setVcBusy(true); setVcErr(''); setVcMsg('')
    try {
      const r = await fetch('/api/share-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vaultCode: vcDraft.trim() }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setVcErr(j.error || 'Could not save'); setVcBusy(false); return }
      setVcSet(true); if (j.vaultCode) setVcCurrent(j.vaultCode); setVcDraft('')
      setVcMsg(vcSet ? 'Vault code changed. The next reveal, by anyone, needs the new code.' : 'Vault code set. Every reveal in the vault now asks for it and records who entered it.')
    } catch (e: any) { setVcErr(String(e?.message || e)) }
    setVcBusy(false)
  }

  const copy = (v: string, url: string) => { try { navigator.clipboard.writeText(url); setCopied(v); setTimeout(() => setCopied(''), 1500) } catch {} }

  return (
    <div className="rounded-2xl border border-line bg-white p-5 mt-6">
      <div className="flex items-center gap-2 mb-1"><Link2 size={16} className="text-muted" /><h2 className="font-semibold text-ink">Vendor share links</h2></div>
      <p className="text-sm text-muted mb-4">Send these to vendors and the front desk. They open without a Lighthouse login — one shared password protects all of them.</p>
      {/* Each row is label · URL · Copy. On a phone the 176px label plus the Copy button left about
          90 pixels for the URL, so every link read "https://…". The label now takes the first line
          and the URL and Copy share the second. */}
      <div className="space-y-2 mb-5">
        {links.map(l => { const href = l.path || '/vendor/' + l.v; const url = origin + href; return (
          <div key={l.v} className="flex flex-wrap items-center gap-2 gap-y-1 text-sm">
            <span className="w-full sm:w-44 shrink-0 font-medium text-ink">{l.label}</span>
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
            <div key={l.v} className="flex flex-wrap items-center gap-2 gap-y-1 text-sm">
              <span className="w-full sm:w-44 shrink-0 font-medium text-ink">{l.label}</span>
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
            <div key={l.v} className="flex flex-wrap items-center gap-2 gap-y-1 text-sm">
              <span className="w-full sm:w-44 shrink-0 font-medium text-ink">{l.label}</span>
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
        <label className="text-xs uppercase tracking-wide text-muted">Salato rules editing &mdash; separate password</label>
        <p className="text-xs text-muted mt-0.5 mb-2">Lets front-desk staff who don&rsquo;t sign into the app edit the Salato house &amp; building rules from the share link. Signed-in Stayboard users don&rsquo;t need it. {rpSet ? 'Currently SET.' : 'Not set yet — only signed-in users can edit rules until you set one.'}</p>
        <div className="flex gap-2 mt-1 max-w-md">
          <input value={rpDraft} onChange={e => setRpDraft(e.target.value)} placeholder={rpSet ? 'Rules password' : 'Create rules password'} className="flex-1 text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          <button onClick={saveRp} disabled={rpBusy || rpDraft.trim().length < 4 || rpDraft.trim() === rpCurrent} className="text-sm font-medium px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-40">{rpBusy ? 'Saving…' : rpSet ? 'Update' : 'Set'}</button>
        </div>
        {rpMsg && <div className="text-xs text-emerald-700 mt-2">{rpMsg}</div>}
        {rpErr && <div className="text-xs text-red-600 mt-2">{rpErr}</div>}
      </div>
      <div className="border-t border-line pt-4 mt-4">
        <label className="text-xs uppercase tracking-wide text-muted">Vault code &mdash; the second lock on the vault</label>
        <p className="text-xs text-muted mt-0.5 mb-1">Signing in shows the shelf (names, usernames, hints). Revealing or copying a password, opening a stored document, importing or downloading a backup asks for this code <b>every time</b>, and each entry &mdash; right or wrong &mdash; is recorded with the person&rsquo;s name in the vault log. {vcSet ? 'Currently SET.' : 'Not set yet \u2014 nothing in the vault can be revealed until you set one.'}</p>
        {vcCurrent && (
          <div className="flex flex-wrap items-center gap-2 gap-y-1 mb-2 text-sm">
            <span className="text-muted">Current code:</span>
            <code className="px-2 py-1 rounded-md bg-app border border-line font-mono text-ink">{showVc ? vcCurrent : '\u2022'.repeat(Math.min(vcCurrent.length, 12))}</code>
            <button onClick={() => setShowVc(!showVc)} className="text-xs font-medium text-brand-700 hover:underline">{showVc ? 'Hide' : 'Show'}</button>
            <span className="text-[11px] text-muted">Visible only to the Super Admin account.</span>
          </div>
        )}
        <div className="flex gap-2 mt-1 max-w-md">
          <input type="password" autoComplete="new-password" value={vcDraft} onChange={e => setVcDraft(e.target.value)} placeholder={vcSet ? 'New vault code' : 'Create vault code'} className="flex-1 text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          <button onClick={saveVc} disabled={vcBusy || vcDraft.trim().length < 4} className="text-sm font-medium px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-40">{vcBusy ? 'Saving\u2026' : vcSet ? 'Change' : 'Set'}</button>
        </div>
        {vcMsg && <div className="text-xs text-emerald-700 mt-2">{vcMsg}</div>}
        {vcErr && <div className="text-xs text-red-600 mt-2">{vcErr}</div>}
      </div>
      <div className="border-t border-line pt-4 mt-4">
        <label className="text-xs uppercase tracking-wide text-muted">Admin password &mdash; destructive actions</label>
        <p className="text-xs text-muted mt-0.5 mb-1">Required to delete ANY task or record, anywhere in the app. {adminSet ? 'Currently SET.' : 'Not set yet \u2014 Delete is locked until you set one.'}</p>
        {adminCurrent && (
          <div className="flex flex-wrap items-center gap-2 gap-y-1 mb-2 text-sm">
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
