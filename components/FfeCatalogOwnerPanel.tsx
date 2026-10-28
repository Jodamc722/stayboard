'use client'
// THE OWNER PANEL on a property catalog (Jon, 2026-10-28): "share a link, assign to the owner, and
// they pick their catalog — that way it helps with ordering, and if we need to replace things we know
// what is approved by the owner, to match their taste and style."
//   1. Assign — the owner and which of their properties this catalog is for (from Guesty).
//   2. Share — their link (copy / open as the owner). It opens this catalog for that property.
//   3. What they approved — choices, their own links, sent date and their note. The Approved list
//      tab is the replacement list; "Owner's picks" there narrows it to what they chose.
import { useMemo, useState } from 'react'
import { Check, Copy, ExternalLink, Link2, Loader2, UserRound } from 'lucide-react'
import { useCachedFetch } from '@/lib/swr'

type Panel = { kind: 'default' | 'property'; ownerId: string | null; ownerName: string | null; listing: { id: string; label: string } | null; tier: string | null
  submittedAt: string | null; ownerNote: string; link: { code: string; views: number; lastView: string | null; createdAt: string } | null
  counts: { picked: number; included: number; skipped: number; ownLinks: number } }
type Owner = { id: string; name: string; listings: { id: string; label: string }[] }
type Payload = { ok: boolean; panel: Panel; owners: Owner[]; error?: string }
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')

export function FfeCatalogOwnerPanel({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const { data, refresh } = useCachedFetch<Payload>(`/api/audit/ffe/owner-links?slug=${encodeURIComponent(slug)}`, { ttl: 10_000, persist: false })
  const [editing, setEditing] = useState(false)
  const [q, setQ] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [listingId, setListingId] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const owners = data?.owners || []
  const hits = useMemo(() => { const s = q.trim().toLowerCase(); return (s ? owners.filter(o => o.name.toLowerCase().includes(s) || o.listings.some(l => l.label.toLowerCase().includes(s))) : owners).slice(0, 8) }, [q, owners])
  const owner = owners.find(o => o.id === ownerId)
  const p = data?.panel
  if (!p || p.kind === 'default') return null

  const post = async (body: any) => {
    setBusy(true); setMsg('')
    const j = await fetch('/api/audit/ffe/owner-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, ...body }) }).then(r => r.json()).catch(() => ({ ok: false }))
    setBusy(false)
    if (!j.ok) setMsg(j.error || 'That did not save.')
    return j
  }
  const assign = async () => {
    if (!ownerId || !listingId) { setMsg('Pick the owner and the property.'); return }
    const j = await post({ action: 'assign', ownerId, listingId })
    if (j.ok) { setEditing(false); refresh() }
  }
  const share = async () => {
    const j = p.link ? { ok: true, code: p.link.code } : await post({ action: 'linkFor' })
    if (!j.ok) return
    try { await navigator.clipboard.writeText(`${window.location.origin}/catalog/o/${j.code}`); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setMsg(`${window.location.origin}/catalog/o/${j.code}`) }
    if (!p.link) refresh()
  }
  const assigned = !!(p.ownerId && p.listing)

  return (
    <section className="rounded-xl border border-line bg-white shadow-soft p-4 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-sky-50 text-sky-800 grid place-items-center shrink-0"><UserRound className="w-4 h-4" /></div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">Owner</div>
            {assigned
              ? <div className="text-[15px] font-bold text-ink">{p.ownerName} <span className="font-normal text-muted">· {p.listing!.label}</span></div>
              : <div className="text-[15px] font-semibold text-ink">Not assigned yet</div>}
            <div className="text-[12.5px] text-muted mt-0.5">
              {!assigned ? 'Assign the owner and their property, then share their link — they hand-pick their items, and what they approve is what we order and replace with.'
                : p.submittedAt ? <span className="text-emerald-800 font-semibold inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Owner sent their selections {day(p.submittedAt)}</span>
                  : p.link ? (p.link.views ? `Link opened ${p.link.views}× · last ${day(p.link.lastView)} · not sent yet` : `Link created ${day(p.link.createdAt)} · not opened yet`)
                    : 'No link shared yet.'}
            </div>
          </div>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {assigned && <button type="button" disabled={busy} onClick={share} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white text-[12.5px] font-semibold px-3 py-2 disabled:opacity-60">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Link copied' : p.link ? 'Copy owner link' : 'Create & copy owner link'}</button>}
            {assigned && p.link && <a href={`/catalog/o/${p.link.code}?listing=${encodeURIComponent(p.listing!.id)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-line text-[12.5px] font-semibold px-3 py-2 hover:border-ink"><ExternalLink className="w-3.5 h-3.5" /> See it as the owner</a>}
            <button type="button" onClick={() => setEditing(e => !e)} className="inline-flex items-center gap-1.5 rounded-lg border border-line text-[12.5px] font-semibold px-3 py-2 hover:border-ink"><Link2 className="w-3.5 h-3.5" /> {assigned ? 'Change owner' : 'Assign to owner'}</button>
          </div>
        )}
      </div>

      {assigned && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
          {[[p.counts.picked, 'products the owner picked'], [p.counts.ownLinks, 'links the owner added'], [p.counts.included, 'essentials they kept or added'], [p.counts.skipped, 'marked not needed']].map(([n, l]) => (
            <div key={String(l)} className="rounded-lg bg-app border border-line px-3 py-2"><div className="text-[18px] font-bold tabular-nums text-ink">{n}</div><div className="text-[11.5px] text-muted">{l}</div></div>
          ))}
        </div>
      )}
      {p.ownerNote && <div className="mt-3 rounded-lg bg-sky-50 text-sky-900 text-[13px] px-3 py-2 whitespace-pre-line"><b>Owner’s note:</b> {p.ownerNote}</div>}

      {editing && canEdit && (
        <div className="mt-4 grid gap-3 border-t border-line pt-4">
          <div className="grid gap-1 text-[12px] font-semibold text-muted">Owner
            <input value={q} onChange={e => { setQ(e.target.value); setOwnerId(''); setListingId('') }} placeholder="Type an owner or a property…" className="text-sm font-normal text-ink rounded-md border border-line px-2.5 py-2" />
            {!ownerId && q && <div className="rounded-md border border-line bg-white max-h-52 overflow-auto">
              {hits.map(o => <button key={o.id} type="button" onClick={() => { setOwnerId(o.id); setQ(o.name); setListingId(o.listings.length === 1 ? o.listings[0].id : '') }} className="block w-full text-left px-3 py-2 text-sm font-normal hover:bg-app">{o.name} <span className="text-muted">· {o.listings.map(l => l.label).join(', ')}</span></button>)}
              {!hits.length && <div className="px-3 py-2 text-sm font-normal text-muted">No owner matches.</div>}
            </div>}
          </div>
          {owner && <label className="grid gap-1 text-[12px] font-semibold text-muted">Property
            <select value={listingId} onChange={e => setListingId(e.target.value)} className="text-sm font-normal text-ink rounded-md border border-line px-2.5 py-2 bg-white">
              <option value="">Choose…</option>
              {owner.listings.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select></label>}
          <button type="button" disabled={busy} onClick={assign} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white text-[12.5px] font-semibold px-3 py-2 w-fit disabled:opacity-60">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Assign</button>
        </div>
      )}
      {msg && <div className="mt-3 text-sm text-rose-700 break-all">{msg}</div>}
    </section>
  )
}
