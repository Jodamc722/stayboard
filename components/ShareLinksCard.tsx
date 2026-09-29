'use client'
import { useEffect, useState } from 'react'
import { Link2 } from 'lucide-react'

// Set or not, and when it last changed. The value itself never comes back from the server
// (2026-09-28 audit, B-9) — to change one, type a new one.
type CredState = { set: boolean; changedAt: string | null }
const UNSET: CredState = { set: false, changedAt: null }

function readState(j: any, key: 'admin' | 'rules' | 'vault', legacyFlag: string): CredState {
  const s = j && j[key]
  if (s && typeof s === 'object') return { set: !!s.set, changedAt: s.changedAt ? String(s.changedAt) : null }
  return { set: !!(j && j[legacyFlag]), changedAt: null }
}

function changedLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return ' · changed ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
}

function StateTag({ s }: { s: CredState }) {
  return s.set
    ? <span title="Stored hashed — nobody, including the owner, can read it back." className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">Set{changedLabel(s.changedAt)}</span>
    : <span title="Nothing is set yet." className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Not set</span>
}

export function ShareLinksCard() {
  const [admin, setAdmin] = useState<CredState>(UNSET)
  const [canSetAdmin, setCanSetAdmin] = useState(false)   // only the owner may change it (the API enforces this too)
  const [adminDraft, setAdminDraft] = useState('')
  const [adminMsg, setAdminMsg] = useState('')
  const [adminErr, setAdminErr] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)
  // Salato rules-editing password — lets front-desk staff (no app login) edit the Salato rules.
  const [rules, setRules] = useState<CredState>(UNSET)
  const [rpDraft, setRpDraft] = useState('')
  const [rpMsg, setRpMsg] = useState('')
  const [rpErr, setRpErr] = useState('')
  const [rpBusy, setRpBusy] = useState(false)
  // Vault code — asked on EVERY reveal in the vault; every entry is logged against the person.
  const [vault, setVault] = useState<CredState>(UNSET)
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
      .then(j => { if (j.ok) { setAdmin(readState(j, 'admin', 'adminSet')); setRules(readState(j, 'rules', 'rulesSet')); setVault(readState(j, 'vault', 'vaultSet')); setCanSetAdmin(!!j.canSetAdmin) } })
      .catch(() => {})
    fetch('/api/share-links?lite=1', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j.ok) setMoved((j.links || []).filter((l: any) => ['vendor-board', 'marketing', 'owner-audit', 'botanica', 'day-sheet', 'delivery', 'orders-live', 'salato-desk'].indexOf(l.kind) >= 0).map((l: any) => ({ code: l.code, title: l.title || l.code, path: l.path, status: l.status }))) })
      .catch(() => {})
  }, [])

  const saved = (j: any, key: 'admin' | 'rules' | 'vault'): CredState => {
    const s = j && j[key]
    return { set: true, changedAt: s && s.changedAt ? String(s.changedAt) : new Date().toISOString() }
  }

  const saveAdmin = async () => {
    setAdminBusy(true); setAdminErr(''); setAdminMsg('')
    try {
      const r = await fetch('/api/share-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminPassword: adminDraft.trim() }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setAdminErr(j.error || 'Could not save'); setAdminBusy(false); return }
      setAdmin(saved(j, 'admin')); setAdminDraft(''); setAdminMsg('Admin password saved. Deleting a clean from the scheduler now requires it.')
    } catch (e: any) { setAdminErr(String(e?.message || e)) }
    setAdminBusy(false)
  }

  const saveRp = async () => {
    setRpBusy(true); setRpErr(''); setRpMsg('')
    try {
      const r = await fetch('/api/share-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rulesPassword: rpDraft.trim() }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setRpErr(j.error || 'Could not save'); setRpBusy(false); return }
      setRules(saved(j, 'rules')); setRpDraft(''); setRpMsg('Rules password saved. Front-desk staff can use it to edit the Salato rules from the share link.')
    } catch (e: any) { setRpErr(String(e?.message || e)) }
    setRpBusy(false)
  }

  const saveVc = async () => {
    setVcBusy(true); setVcErr(''); setVcMsg('')
    try {
      const r = await fetch('/api/share-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vaultCode: vcDraft.trim() }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setVcErr(j.error || 'Could not save'); setVcBusy(false); return }
      const wasSet = vault.set
      setVault(saved(j, 'vault')); setVcDraft('')
      setVcMsg(wasSet ? 'Vault code changed. The next reveal, by anyone, needs the new code.' : 'Vault code set. Every reveal in the vault now asks for it and records who entered it.')
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
      <p className="text-[11px] text-muted mb-3">The three below are stored hashed: nobody, including the owner, can read one back. Five wrong tries from one place locks that place out for 15 minutes.</p>
      <div className="border-t border-line pt-4">
        <div className="flex flex-wrap items-center gap-2"><label className="text-xs uppercase tracking-wide text-muted">Salato rules editing &mdash; separate password</label><StateTag s={rules} /></div>
        <p className="text-xs text-muted mt-0.5 mb-2">Lets front-desk staff who don&rsquo;t sign into the app edit the Salato house &amp; building rules from the share link. Signed-in Lighthouse users don&rsquo;t need it. {rules.set ? '' : 'Until one is set, only signed-in users can edit rules.'}</p>
        <div className="flex gap-2 mt-1 max-w-md">
          <input type="password" autoComplete="new-password" value={rpDraft} onChange={e => setRpDraft(e.target.value)} placeholder={rules.set ? 'New rules password' : 'Create rules password'} className="flex-1 text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          <button onClick={saveRp} disabled={rpBusy || rpDraft.trim().length < 4} className="text-sm font-medium px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-40">{rpBusy ? 'Saving…' : rules.set ? 'Change' : 'Set'}</button>
        </div>
        {rpMsg && <div className="text-xs text-emerald-700 mt-2">{rpMsg}</div>}
        {rpErr && <div className="text-xs text-red-600 mt-2">{rpErr}</div>}
      </div>
      <div className="border-t border-line pt-4 mt-4">
        <div className="flex flex-wrap items-center gap-2"><label className="text-xs uppercase tracking-wide text-muted">Vault code &mdash; the second lock on the vault</label><StateTag s={vault} /></div>
        <p className="text-xs text-muted mt-0.5 mb-1">Signing in shows the shelf (names, usernames, hints). Entering it opens a <b>one-minute window</b>; inside that window revealing is still a click per item, and every click is recorded with the person&rsquo;s name in the vault log. Wrong codes are recorded too, and eight in fifteen minutes locks that person out. Downloading the whole vault as a CSV always asks again. {vault.set ? '' : 'Nothing in the vault can be revealed until one is set.'}</p>
        <div className="flex gap-2 mt-1 max-w-md">
          <input type="password" autoComplete="new-password" value={vcDraft} onChange={e => setVcDraft(e.target.value)} placeholder={vault.set ? 'New vault code' : 'Create vault code'} className="flex-1 text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          <button onClick={saveVc} disabled={vcBusy || vcDraft.trim().length < 4} className="text-sm font-medium px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-40">{vcBusy ? 'Saving…' : vault.set ? 'Change' : 'Set'}</button>
        </div>
        {vcMsg && <div className="text-xs text-emerald-700 mt-2">{vcMsg}</div>}
        {vcErr && <div className="text-xs text-red-600 mt-2">{vcErr}</div>}
      </div>
      <div className="border-t border-line pt-4 mt-4">
        <div className="flex flex-wrap items-center gap-2"><label className="text-xs uppercase tracking-wide text-muted">Admin password &mdash; destructive actions</label><StateTag s={admin} /></div>
        <p className="text-xs text-muted mt-0.5 mb-1">Required to delete ANY task or record, anywhere in the app. {admin.set ? '' : 'Delete is locked until one is set.'} {canSetAdmin ? '' : 'Only the owner can change it.'}</p>
        <div className="flex gap-2 mt-1 max-w-md">
          <input type="password" autoComplete="new-password" value={adminDraft} onChange={e => setAdminDraft(e.target.value)} disabled={!canSetAdmin} title={canSetAdmin ? undefined : 'Only the owner can change the admin password.'} placeholder={admin.set ? 'New admin password' : 'Create admin password'} className="flex-1 text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-50" />
          <button onClick={saveAdmin} disabled={!canSetAdmin || adminBusy || adminDraft.trim().length < 4} title={canSetAdmin ? undefined : 'Only the owner can change the admin password.'} className="text-sm font-medium px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-40">{adminBusy ? 'Saving…' : admin.set ? 'Change' : 'Set'}</button>
        </div>
        {adminMsg && <div className="text-xs text-emerald-700 mt-2">{adminMsg}</div>}
        {adminErr && <div className="text-xs text-red-600 mt-2">{adminErr}</div>}
      </div>
    </div>
  )
}
