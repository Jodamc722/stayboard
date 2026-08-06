'use client'
import { useEffect, useState } from 'react'

// App-settings card: who receives the Salato verification completion email (details + ID/selfie/
// signature images + PDF record), and which mailbox it sends FROM. The email goes out through the
// team's Google connection (Gmail), so the "Send from" address must be a teammate who has connected
// Google with the Gmail permission (same grant the Morning Ops Brief uses). No mail vendor, no DNS.
// Saved to app_settings via /api/settings/salato-verify-email.
export function SalatoVerifyEmailAdmin() {
  const [emails, setEmails] = useState('')
  const [cc, setCc] = useState('')
  const [from, setFrom] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [valid, setValid] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    fetch('/api/settings/salato-verify-email', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j && j.ok) { setEmails(j.emails || ''); setCc(j.cc || ''); setFrom(j.from || ''); setEnabled(j.enabled !== false); setValid(j.valid || []) } else setMsg(j?.error || 'Could not load') })
      .catch(e => setMsg(String(e?.message || e)))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/settings/salato-verify-email', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emails, cc, enabled, from }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setMsg(j?.error || 'Could not save'); setBusy(false); return }
      setValid(j.valid || []); if (j.from) setFrom(j.from)
      setMsg('Saved' + (j.valid && j.valid.length ? ' — ' + j.valid.length + ' recipient' + (j.valid.length === 1 ? '' : 's') : ''))
    } catch (e: any) { setMsg(String(e?.message || e)) }
    setBusy(false)
  }

  if (loading) return <div className="text-sm text-muted">Loading…</div>

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">When a guest finishes Salato ID verification, email these recipients the guest details, the ID &amp; selfie &amp; signature images, and a PDF record of the initialed house rules.</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        <span>Send verification emails</span>
      </label>
      <div>
        <label className="block text-xs font-semibold text-muted mb-1">Recipient email(s)</label>
        <textarea value={emails} onChange={e => setEmails(e.target.value)} rows={2} placeholder="salato@stay-hospitality.com, frontdesk@stay-hospitality.com"
          className="w-full text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600/40" />
        <div className="text-[11px] text-muted mt-1">Separate multiple addresses with commas.{valid.length ? ' Currently: ' + valid.join(', ') : ''}</div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted mb-1">CC</label>
        <textarea value={cc} onChange={e => setCc(e.target.value)} rows={2} placeholder="manager@salatoresidences.com"
          className="w-full text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600/40" />
        <div className="text-[11px] text-muted mt-1">Carbon-copied on every verification email. Separate multiple addresses with commas.</div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted mb-1">Send from</label>
        <input value={from} onChange={e => setFrom(e.target.value)} placeholder="jon@stay-hospitality.com"
          className="w-full text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600/40" />
        <div className="text-[11px] text-muted mt-1">Must be a teammate who has connected Google with the Gmail permission (the same grant used by the Morning Ops Brief). The email is sent from this mailbox.</div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy} className="rounded-lg bg-brand-600 text-white text-sm font-semibold px-4 py-2 disabled:opacity-40 hover:bg-brand-700 transition-colors">{busy ? 'Saving…' : 'Save'}</button>
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>
    </div>
  )
}
