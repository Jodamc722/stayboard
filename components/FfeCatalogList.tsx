'use client'
// THE CATALOG LIST (Jon, 2026-10-27): "we should be able to build custom catalogs for our units…
// a default catalog for onboarding". One row per catalog — the default first, then each
// property's — with how far its review has got, and one panel to start a new one:
//   • from a catalog (the default, or any other) — a plain copy to review, or
//   • from a listing's photos — pick the listing and a tier (standard / mid-lux / luxury) and the
//     AI proposes the option that fits the look for every item, plus anything the photos show that
//     the catalog is missing. Proposals arrive as suggestions; approving is still a click.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BookOpenCheck, Loader2, Plus, Sparkles, Star } from 'lucide-react'
import { useCachedFetch } from '@/lib/swr'

type Cat = { slug: string; name: string; kind: 'default' | 'property'; basedOn: string | null; suppliers: string[]; items: number; approved: number; createdAt: string | null }
type Listing = { id: string; label: string; photos: number }
type Tier = { key: string; label: string; blurb: string }
type Payload = { ok: boolean; catalogs: Cat[]; listings: Listing[]; tiers: Tier[] }

export function FfeCatalogList() {
  const router = useRouter()
  const { data, loading, error, refresh } = useCachedFetch<Payload>('/api/audit/ffe/catalogs', { ttl: 10_000, persist: false })
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'copy' | 'photos'>('photos')
  const [name, setName] = useState('')
  const [from, setFrom] = useState('default')
  const [listingQ, setListingQ] = useState('')
  const [listingId, setListingId] = useState('')
  const [tier, setTier] = useState('midlux')
  const [busy, setBusy] = useState<string>('')
  const [err, setErr] = useState('')

  const listings: Listing[] = data?.listings || []
  const hits = useMemo(() => {
    const q = listingQ.trim().toLowerCase()
    return (q ? listings.filter(l => l.label.toLowerCase().includes(q)) : listings).slice(0, 12)
  }, [listingQ, listings])
  useEffect(() => { if (!name && listingId) { const l = listings.find(x => x.id === listingId); if (l) setName(l.label.split(' · ')[0]) } }, [listingId, listings, name])

  const submit = async () => {
    setErr('')
    if (!name.trim()) { setErr('Give the catalog a name.'); return }
    if (mode === 'photos' && !listingId) { setErr('Pick the listing to read the photos from.'); return }
    setBusy(mode === 'photos' ? 'Reading the listing photos and building the catalog… about 30 seconds.' : 'Creating…')
    try {
      const r = await fetch('/api/audit/ffe/catalogs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'photos' ? { action: 'generate', name, listingId, tier, from } : { action: 'create', name, from }) })
      const j = await r.json().catch(() => ({}))
      if (!j.ok && !j.slug) { setErr(j.error || 'That did not save.'); setBusy(''); return }
      if (j.error) setErr(j.error)
      refresh()
      router.push(`/ffe/catalogs/${j.slug}`)
    } catch { setErr('That did not save.'); setBusy('') }
  }

  if (loading && !data) return <div className="text-sm text-muted inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading catalogs…</div>
  if (error && !data) return <div className="text-sm text-rose-700">{error}</div>
  const cats: Cat[] = data?.catalogs || []

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted max-w-2xl">The default is what every onboarding starts from. A property catalog is a copy of it, reviewed for that unit; its approved list is what the team may buy when something needs replacing.</p>
        <button type="button" onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white text-[12.5px] font-semibold px-3 py-2"><Plus className="w-3.5 h-3.5" /> New catalog</button>
      </div>

      {open && (
        <div className="rounded-xl border border-line bg-white shadow-soft p-4 grid gap-4 max-w-3xl">
          <div className="inline-flex rounded-full border border-line p-0.5 w-fit">
            {([['photos', 'From a listing’s photos'], ['copy', 'Plain copy']] as const).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)} className={'px-3 py-1.5 text-[12.5px] font-semibold rounded-full ' + (mode === k ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>{label}</button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-[12px] font-semibold text-muted">Name
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Salato 302" className="text-sm font-normal text-ink rounded-md border border-line px-2.5 py-2" /></label>
            <label className="grid gap-1 text-[12px] font-semibold text-muted">Start from
              <select value={from} onChange={e => setFrom(e.target.value)} className="text-sm font-normal text-ink rounded-md border border-line px-2.5 py-2 bg-white">
                {cats.map(c => <option key={c.slug} value={c.slug}>{c.name}{c.kind === 'default' ? ' (default)' : ''}</option>)}
              </select></label>
          </div>
          {mode === 'photos' && (
            <>
              <div className="grid gap-1 text-[12px] font-semibold text-muted">Listing
                <input value={listingQ} onChange={e => { setListingQ(e.target.value); setListingId('') }} placeholder="Type to search listings…" className="text-sm font-normal text-ink rounded-md border border-line px-2.5 py-2" />
                {!listingId && listingQ && (
                  <div className="rounded-md border border-line bg-white max-h-56 overflow-auto">
                    {hits.length === 0 && <div className="px-3 py-2 text-sm font-normal text-muted">No listing matches.</div>}
                    {hits.map(l => <button key={l.id} type="button" onClick={() => { setListingId(l.id); setListingQ(l.label) }} className="block w-full text-left px-3 py-2 text-sm font-normal hover:bg-app">{l.label} <span className="text-muted">· {l.photos} photos</span></button>)}
                  </div>
                )}
                {listingId && <span className="text-[11.5px] font-medium text-emerald-700">Selected</span>}
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {(data?.tiers || []).map(t => (
                  <button key={t.key} type="button" aria-pressed={tier === t.key} onClick={() => setTier(t.key)}
                    className={'text-left rounded-lg border p-3 ' + (tier === t.key ? 'border-ink bg-app' : 'border-line hover:border-ink')}>
                    <div className="text-sm font-bold text-ink flex items-center gap-1.5">{t.key === 'luxury' && <Star className="w-3.5 h-3.5" />}{t.label}</div>
                    <div className="text-[12px] text-muted mt-1">{t.blurb}</div>
                  </button>
                ))}
              </div>
            </>
          )}
          {err && <div className="text-sm text-rose-700">{err}</div>}
          <div className="flex items-center gap-3">
            <button type="button" disabled={!!busy} onClick={submit} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white text-[12.5px] font-semibold px-3 py-2 disabled:opacity-60">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : mode === 'photos' ? <Sparkles className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              {mode === 'photos' ? 'Generate catalog' : 'Create catalog'}
            </button>
            <span className="text-xs text-muted">{busy}</span>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-line bg-white shadow-soft overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] uppercase tracking-wider text-muted border-b border-line">
            <th className="text-left px-4 py-2">Catalog</th><th className="text-left px-3 py-2">Based on</th><th className="text-right px-3 py-2">Items</th><th className="text-right px-3 py-2">Approved</th><th className="text-left px-3 py-2">Suppliers</th><th className="px-3 py-2" />
          </tr></thead>
          <tbody>
            {cats.map(c => (
              <tr key={c.slug} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 font-semibold text-ink"><Link href={`/ffe/catalogs/${c.slug}`} className="hover:underline inline-flex items-center gap-1.5">{c.kind === 'default' ? <BookOpenCheck className="w-3.5 h-3.5 text-brand-700" /> : null}{c.name}</Link>
                  {c.kind === 'default' && <span className="ml-2 text-[10.5px] font-semibold uppercase tracking-wider text-brand-700 bg-brand-50 rounded-full px-2 py-0.5">Default</span>}</td>
                <td className="px-3 py-2.5 text-muted">{c.basedOn || '—'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{c.items}</td>
                <td className="px-3 py-2.5 text-right tabular-nums"><span className={c.approved ? 'text-emerald-700 font-semibold' : 'text-muted'}>{c.approved}</span><span className="text-muted"> / {c.items}</span></td>
                <td className="px-3 py-2.5 text-muted text-[12px]">{c.suppliers.length ? `${c.suppliers.length} selected` : 'All'}</td>
                <td className="px-3 py-2.5 text-right"><Link href={`/ffe/catalogs/${c.slug}`} className="text-[12px] font-semibold text-ink border border-line rounded-lg px-2.5 py-1 hover:border-ink">Open</Link></td>
              </tr>
            ))}
            {cats.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-sm text-muted">No catalogs yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
