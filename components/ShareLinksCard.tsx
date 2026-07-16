'use client'
import { useEffect, useState } from 'react'
import { Link2 } from 'lucide-react'

type ShareLink = { v: string; label: string }

export function ShareLinksCard() {
  const [links, setLinks] = useState<ShareLink[]>([])
  const [password, setPassword] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => { setOrigin(window.location.origin) }, [])
  useEffect(() => {
    fetch('/api/share-settings', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j.ok) { setLinks(j.links || []); setPassword(j.password || ''); setDraft(j.password || '') } })
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

  const copy = (v: string, url: string) => { try { navigator.clipboard.writeText(url); setCopied(v); setTimeout(() => setCopied(''), 1500) } catch {} }

  return (
    <div className="rounded-2xl border border-line bg-white p-5 mt-6">
      <div className="flex items-center gap-2 mb-1"><Link2 size={16} className="text-muted" /><h2 className="font-semibold text-ink">Vendor share links</h2></div>
      <p className="text-sm text-muted mb-4">Send these to vendors and the front desk. They open without a StayBoard login — one shared password protects all of them.</p>
      <div className="space-y-2 mb-5">
        {links.map(l => { const url = origin + '/vendor/' + l.v; return (
          <div key={l.v} className="flex items-center gap-2 text-sm">
            <span className="w-44 shrink-0 font-medium text-ink">{l.label}</span>
            <a href={'/vendor/' + l.v} target="_blank" rel="noreferrer" className="flex-1 truncate text-brand-600 hover:underline">{url}</a>
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
    </div>
  )
}
