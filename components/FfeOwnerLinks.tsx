'use client'
// OWNER CATALOG LINKS — the team side (Jon, 2026-10-28): send an owner their catalog. One link per
// owner; they pick their property and choose (lib/ffe-owner-catalog). The table shows, per listing,
// how many choices they have saved and whether they have pressed "Send to Stay".
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, Copy, ExternalLink, Loader2, Send, X } from 'lucide-react'
import { useCachedFetch } from '@/lib/swr'

type L = { id: string; label: string; slug: string | null; chosen: number; submittedAt: string | null }
type OwnerLinkRow = { code: string; ownerId: string; ownerName: string; template: string; tier: string | null; message: string; createdAt: string; views: number; lastView: string | null; listings: L[] }
type Owner = { id: string; name: string; listings: { id: string; label: string }[] }
type Payload = { ok: boolean; links: OwnerLinkRow[]; owners: Owner[] }

const TIERS = [['standard', 'Standard'], ['midlux', 'Mid-lux'], ['luxury', 'Luxury']] as const
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')

export function FfeOwnerLinks({ templates }: { templates: { slug: string; name: string; kind: string }[] }) {
  const { data, refresh } = useCachedFetch<Payload>('/api/audit/ffe/owner-links', { ttl: 10_000, persist: false })
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [template, setTemplate] = useState('default')
  const [tier, setTier] = useState('midlux')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')
  const owners = data?.owners || []
  const hits = useMemo(() => { const s = q.trim().toLowerCase(); return (s ? owners.filter(o => o.name.toLowerCase().includes(s) || o.listings.some(l => l.label.toLowerCase().includes(s))) : owners).slice(0, 10) }, [q, owners])
  const owner = owners.find(o => o.id === ownerId)
  const url = (code: string) => `${typeof window !== 'undefined' ? window.location.origin : ''}/catalog/o/${code}`
  const copy = async (code: string) => { try { await navigator.clipboard.writeText(url(code)); setCopied(code); setTimeout(() => setCopied(''), 1800) } catch { /* no clipboard */ } }

  const create = async () => {
    setErr(''); if (!ownerId) { setErr('Pick the owner.'); return }
    setBusy(true)
    const j = await fetch('/api/audit/ffe/owner-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', ownerId, template, tier, message }) }).then(r => r.json()).catch(() => ({ ok: false }))
    setBusy(false)
    if (!j.ok) { setErr(j.error || 'That did not save.'); return }
    copy(j.code); setOpen(false); setOwnerId(''); setQ(''); setMessage(''); refresh()
  }
  const revoke = async (code: string) => {
    if (!window.confirm('Turn this link off? The owner will no longer be able to open it. Their choices stay.')) return
    await fetch('/api/audit/ffe/owner-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'revoke', code }) }).catch(() => {})
    refresh()
  }

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[17px] font-bold text-ink">Owner catalogs</h2>
          <p className="text-sm text-muted max-w-2xl">Send an owner one link. They pick their property, compare options, approve the essentials and furniture, and add links to anything else they want. Their choices become that property’s catalog.</p>
        </div>
        <button type="button" onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white text-[12.5px] font-semibold px-3 py-2"><Send className="w-3.5 h-3.5" /> Send to an owner</button>
      </div>

      {open && (
        <div className="rounded-xl border border-line bg-white shadow-soft p-4 grid gap-3 max-w-3xl">
          <div className="grid gap-1 text-[12px] font-semibold text-muted">Owner
            <input value={q} onChange={e => { setQ(e.target.value); setOwnerId('') }} placeholder="Type an owner or a property…" className="text-sm font-normal text-ink rounded-md border border-line px-2.5 py-2" />
            {!ownerId && q && (
              <div className="rounded-md border border-line bg-white max-h-56 overflow-auto">
                {hits.map(o => <button key={o.id} type="button" onClick={() => { setOwnerId(o.id); setQ(o.name) }} className="block w-full text-left px-3 py-2 text-sm font-normal hover:bg-app">{o.name} <span className="text-muted">· {o.listings.map(l => l.label).join(', ')}</span></button>)}
                {!hits.length && <div className="px-3 py-2 text-sm font-normal text-muted">No owner matches.</div>}
              </div>
            )}
            {owner && <span className="text-[12px] font-normal text-ink">{owner.listings.length} propert{owner.listings.length === 1 ? 'y' : 'ies'}: {owner.listings.map(l => l.label).join(', ')}</span>}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-[12px] font-semibold text-muted">Start from
              <select value={template} onChange={e => setTemplate(e.target.value)} className="text-sm font-normal text-ink rounded-md border border-line px-2.5 py-2 bg-white">
                {templates.map(c => <option key={c.slug} value={c.slug}>{c.name}{c.kind === 'default' ? ' (default)' : ''}</option>)}
              </select></label>
            <div className="grid gap-1 text-[12px] font-semibold text-muted">Tier they start on
              <div className="inline-flex rounded-full border border-line p-0.5 w-fit">
                {TIERS.map(([k, l]) => <button key={k} type="button" aria-pressed={tier === k} onClick={() => setTier(k)} className={'px-3 py-1.5 text-[12.5px] font-semibold rounded-full ' + (tier === k ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>{l}</button>)}
              </div>
            </div>
          </div>
          <label className="grid gap-1 text-[12px] font-semibold text-muted">Message to the owner (optional)
            <textarea rows={2} value={message} onChange={e => setMessage(e.target.value)} placeholder="e.g. Here’s everything we’ll set your home up with — approve what you like by Friday." className="text-sm font-normal text-ink rounded-md border border-line px-2.5 py-2" /></label>
          {err && <div className="text-sm text-rose-700">{err}</div>}
          <button type="button" disabled={busy} onClick={create} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white text-[12.5px] font-semibold px-3 py-2 w-fit disabled:opacity-60">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />} Create link and copy</button>
        </div>
      )}

      <div className="rounded-xl border border-line bg-white shadow-soft overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] uppercase tracking-wider text-muted border-b border-line">
            <th className="text-left px-4 py-2">Owner</th><th className="text-left px-3 py-2">Properties</th><th className="text-right px-3 py-2">Opened</th><th className="px-3 py-2" />
          </tr></thead>
          <tbody>
            {(data?.links || []).map(l => (
              <tr key={l.code} className="border-b border-line last:border-0 align-top">
                <td className="px-4 py-2.5"><div className="font-semibold text-ink">{l.ownerName || l.ownerId}</div><div className="text-[11.5px] text-muted">Sent {day(l.createdAt)} · from {l.template}</div></td>
                <td className="px-3 py-2.5">
                  <div className="grid gap-1">
                    {l.listings.map(x => (
                      <div key={x.id} className="flex items-center gap-2 text-[12.5px]">
                        {x.slug ? <Link href={`/catalogs/${x.slug}`} className="font-medium text-ink hover:underline">{x.label}</Link> : <span className="text-ink">{x.label}</span>}
                        {x.submittedAt ? <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-800 inline-flex items-center gap-1"><Check className="w-3 h-3" /> Sent {day(x.submittedAt)}</span>
                          : x.chosen ? <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-sky-50 text-sky-800">{x.chosen} choices</span>
                            : <span className="text-[11px] text-muted">not started</span>}
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right text-[12.5px] text-muted tabular-nums">{l.views}×{l.lastView ? <div className="text-[11px]">last {day(l.lastView)}</div> : null}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <button type="button" onClick={() => copy(l.code)} className="text-[12px] font-semibold text-ink border border-line rounded-lg px-2.5 py-1 hover:border-ink inline-flex items-center gap-1">{copied === l.code ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy link</>}</button>
                  <a href={`/catalog/o/${l.code}`} target="_blank" rel="noopener noreferrer" className="ml-1.5 text-[12px] font-semibold text-ink border border-line rounded-lg px-2.5 py-1 hover:border-ink inline-flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> Open</a>
                  <button type="button" onClick={() => revoke(l.code)} aria-label="Turn link off" className="ml-1.5 text-muted hover:text-rose-700 align-middle"><X className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
            {!(data?.links || []).length && <tr><td colSpan={4} className="px-4 py-6 text-sm text-muted">No owner links yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
