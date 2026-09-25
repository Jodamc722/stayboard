'use client'
// YOUR API KEYS (Jon, 2026-09-25: "a read API key only, for user, on app").
//
// A key is you, read-only: it can pull what you can see in Lighthouse through /api/v1 and nothing
// else. The plaintext is shown exactly once, here, with a copy button; after that only the first
// twelve characters are ever displayed. Revoking is immediate.
import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Copy, Check, Plus, Loader2, Trash2, AlertTriangle } from 'lucide-react'

type Row = { id: string; label: string; prefix: string; created_at: string; last_used_at: string | null; use_count: number; revoked_at: string | null }
type Endpoint = { path: string; feature: string; what: string; params?: string }

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : 'never'

export function ApiKeysPanel({ email, base, endpoints }: { email: string; base: string; endpoints: Endpoint[] }) {
  const [keys, setKeys] = useState<Row[]>([])
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [fresh, setFresh] = useState<{ key: string; label: string } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => { fetch('/api/api-keys', { cache: 'no-store' }).then(r => r.json()).then(j => setKeys(j?.keys || [])).catch(() => {}) }, [])
  useEffect(() => { load() }, [load])
  const copy = async (what: string, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(c => c === what ? null : c), 1500) } catch { /* ignore */ } }
  const make = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) })
      const j = await r.json()
      if (!r.ok || !j.ok) setErr(j.error || 'Could not create the key.')
      else { setFresh({ key: j.key, label }); setLabel(''); load() }
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  const revoke = async (id: string) => {
    setBusy(true)
    await fetch('/api/api-keys', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {})
    setBusy(false); load()
  }
  const example = fresh ? fresh.key : 'lh_your_key'
  const curl = `curl -H "Authorization: Bearer ${example}" "${base}/api/v1/arrivals?date=${new Date().toISOString().slice(0, 10)}"`
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-ink tracking-tight inline-flex items-center gap-2"><KeyRound size={20} className="text-brand-600" /> API keys</h1>
        <p className="text-[13px] text-muted mt-1">A key is you, read-only. It can pull what <b className="text-ink">{email}</b> can see in Lighthouse — the same pages, the same limits — and it can never change anything.</p>
      </header>

      {fresh && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-2">
          <p className="text-[13px] font-bold text-emerald-900 inline-flex items-center gap-1.5"><AlertTriangle size={14} /> Copy this key now — it will not be shown again.</p>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-[13px] font-mono bg-white border border-emerald-200 rounded-lg px-3 py-2 break-all select-all">{fresh.key}</code>
            <button onClick={() => copy('key', fresh.key)} className="inline-flex items-center gap-1 rounded-lg bg-ink text-white px-3 py-2 text-[12.5px] font-semibold">{copied === 'key' ? <Check size={13} /> : <Copy size={13} />} {copied === 'key' ? 'Copied' : 'Copy key'}</button>
          </div>
          <button onClick={() => setFresh(null)} className="text-[12px] text-muted hover:text-ink">I have saved it</button>
        </div>
      )}

      <section className="rounded-2xl border border-line bg-white">
        <div className="px-4 py-2.5 border-b border-line flex items-center gap-2 flex-wrap">
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="What is this key for? e.g. Revenue app, Claude, Zapier"
            className="flex-1 min-w-[220px] rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] focus:outline-none focus:border-ink" />
          <button onClick={make} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} New key</button>
        </div>
        {err && <p className="px-4 py-2 text-[12.5px] text-rose-700">{err}</p>}
        {keys.length === 0 ? <p className="px-4 py-6 text-[13px] text-muted">No keys yet.</p> : (
          <ul className="divide-y divide-line/70">
            {keys.map(k => (
              <li key={k.id} className={'px-4 py-2.5 flex items-center gap-3 flex-wrap ' + (k.revoked_at ? 'opacity-50' : '')}>
                <code className="text-[12.5px] font-mono text-ink">{k.prefix}…</code>
                <span className="text-[13px] font-semibold text-ink">{k.label || 'Untitled key'}</span>
                <span className="text-[12px] text-muted">made {when(k.created_at)} · last used {when(k.last_used_at)}{k.use_count ? ` · ${k.use_count} calls` : ''}</span>
                <span className="ml-auto">
                  {k.revoked_at ? <span className="text-[11.5px] font-semibold text-muted">Revoked {when(k.revoked_at)}</span>
                    : <button onClick={() => revoke(k.id)} disabled={busy} className="inline-flex items-center gap-1 text-[12px] font-semibold text-rose-700 hover:text-rose-800"><Trash2 size={12} /> Revoke</button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-white">
        <div className="px-4 py-2.5 border-b border-line"><h2 className="text-[13.5px] font-bold text-ink">How to use it</h2></div>
        <div className="px-4 py-3 space-y-3 text-[13px] text-ink">
          <p>Send the key on every request as <code className="font-mono text-[12px] bg-app px-1.5 py-0.5 rounded">Authorization: Bearer lh_…</code> (or <code className="font-mono text-[12px] bg-app px-1.5 py-0.5 rounded">X-API-Key</code>). All endpoints are GET and answer JSON: <code className="font-mono text-[12px]">{'{ ok, count, data }'}</code>.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[12px] font-mono bg-app border border-line rounded-lg px-3 py-2 break-all">{curl}</code>
            <button onClick={() => copy('curl', curl)} className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold">{copied === 'curl' ? <Check size={12} /> : <Copy size={12} />}</button>
          </div>
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-muted"><th className="py-1 pr-3">Endpoint</th><th className="py-1 pr-3">Returns</th><th className="py-1">Parameters</th></tr></thead>
            <tbody className="divide-y divide-line/60">
              {endpoints.map(e => (
                <tr key={e.path}><td className="py-1.5 pr-3 font-mono text-[12px] whitespace-nowrap">{e.path}</td><td className="py-1.5 pr-3 text-ink">{e.what}</td><td className="py-1.5 text-muted">{e.params || '—'}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="text-[12px] text-muted">A key only reads the pages your role can open; an endpoint you cannot see in the sidebar answers 403. Five live keys per person. Revoke one the moment it leaves your hands.</p>
        </div>
      </section>
    </div>
  )
}
