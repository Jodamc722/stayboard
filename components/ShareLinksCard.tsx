'use client'
import { useEffect, useState } from 'react'
import { Link2 } from 'lucide-react'

export function ShareLinksCard() {
  const [adminSet, setAdminSet] = useState(false)
  const [adminCurrent, setAdminCurrent] = useState('')  // only ever sent to the Super Admin
  const [showAdminPw, setShowAdminPw] = useState(false)
  const [adminDraft, setAdminDraft] = useState('')
  const [adminMsg, setAdminMsg] = useState('')
  const [adminErr, setAdminErr] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)
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
  // The share-link rows that used to live on this card (vendor boards, marketing, audit, Botanica)
  // are on /links now, one passcode each. Listed here so the card still answers "where are they".
  const [moved, setMoved] = useState<{ code: string; title: string; path: string; status: string }[]>([])

  useEffect(() => {
    fetch('/api/share-settings', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j.ok) { setAdminSet(!!j.adminSet); setAdminCurrent(j.adminPassword || ''); setRpSet(!!j.rulesSet); setRpCurrent(j.rulesPassword || ''); setRpDraft(j.rulesPassword || ''); setVcSet(!!j.vaultSet); setVcCurrent(j.vaultCode || '') } })
      .catch(() => {})
    fetch('/api/share-links?lite=1', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j.ok) setMoved((j.links || []).filter((l: any) => ['vendor-board', 'marketing', 'owner-audit', 'botanica', 'day-sheet', 'delivery', 'orders-live', 'salato-desk'].indexOf(l.kind) >= 0).map((l: any) => ({ code: l.code, title: l.title || l.code, path: l.path, status: l.status }))) })
      .catch(() => {})
  }, [])

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


  return (
    <div className="rounded-2xl border border-line bg-white p-5 mt-6">
      <div className="flex items-center gap-2 mb-1"><Link2 size={16} className="text-muted" /><h2 className="font-semibold text-ink">Share links &amp; security</h2></div>
      {/* ONE PLACE FOR EVERY SHARE LINK (2026-09-18). The vendor / marketing / audit / Botanica
          passwords that used to be set here are gone: each of those pages is now a row on /links
          with its own passcode, expiry and revoke. This card points there and keeps only the
          in-app credentials that are not share links. */}
      <p className="text-sm text-muted mb-3">
        Every shareable page — vendor boards, the day sheet, the marketing and audit reports, the Botanica report,
        scheduler links, field boards, custom reports — lives on the <a href="/links" className="font-semibold text-brand-700 underline">Share Links</a> page,
        each with its <b>own</b> passcode. Set, rotate or turn one off there; the old shared team password no longer opens anything.
      </p>
      {moved.length > 0 && (
        <div className="rounded-xl border border-line divide-y divide-line mb-4">
          {moved.map(l => (
            <div key={l.code} className="flex flex-wrap items-center gap-2 gap-y-1 px-3 py-2 text-sm">
              <span className="font-medium text-ink flex-1 min-w-0 truncate">{l.title}</span>
              <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' + (l.status === 'live' ? 'bg-emerald-50 text-emerald-700' : l.status === 'unset' ? 'bg-amber-100 text-amber-800' : 'bg-app text-muted')}>
                {l.status === 'unset' ? 'no passcode yet' : l.status}
              </span>
              <a href={'/links?q=' + encodeURIComponent(l.code)} className="text-xs px-2 py-1 rounded-lg border border-line hover:bg-app">Manage</a>
            </div>
          ))}
        </div>
      )}
      <div className="border-t border-line pt-4">
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
        <p className="text-xs text-muted mt-0.5 mb-1">Signing in shows the shelf (names, usernames, hints). Entering it opens a <b>one-minute window</b>; inside that window revealing is still a click per item, and every click is recorded with the person&rsquo;s name in the vault log. Wrong codes are recorded too, and eight in fifteen minutes locks that person out. Downloading the whole vault as a CSV always asks again. {vcSet ? 'Currently SET.' : 'Not set yet \u2014 nothing in the vault can be revealed until you set one.'}</p>
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
