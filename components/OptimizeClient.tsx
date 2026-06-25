'use client'
import { useMemo, useState } from 'react'
import {
  Search, Sparkles, Wand2, Copy, Check, Building2, BedDouble, Bath, Users, AlertTriangle,
} from 'lucide-react'

type Listing = {
  id: string
  title: string | null
  nickname: string | null
  building: string | null
  unit: string | null
  room_type: string | null
  address_city: string | null
  bedrooms: number | null
  bathrooms: number | null
  max_occupancy: number | null
  amenities: any
  status: string | null
}

type Suggestion = {
  title: string
  description: string
  bullets: string[]
  rationale: string
}

function nameOf(l: Listing) {
  return l.title || l.nickname || l.building || l.unit || 'Untitled listing'
}

export function OptimizeClient({ listings }: { listings: Listing[] }) {
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const selected = useMemo(
    () => listings.find(l => l.id === selectedId) || null,
    [listings, selectedId]
  )

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return listings.slice(0, 200)
    return listings.filter(l =>
      nameOf(l).toLowerCase().includes(s) ||
      (l.building || '').toLowerCase().includes(s) ||
      (l.unit || '').toLowerCase().includes(s) ||
      (l.address_city || '').toLowerCase().includes(s)
    ).slice(0, 200)
  }, [listings, q])

  function pick(l: Listing) {
    setSelectedId(l.id)
    setSuggestion(null)
    setError(null)
  }

  async function optimize() {
    if (!selected || busy) return
    setBusy(true); setError(null); setSuggestion(null)
    try {
      const res = await fetch('/api/optimize-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: selected.id }),
      })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      setSuggestion(d.suggestion as Suggestion)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(c => (c === label ? null : c)), 1500)
    } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
      {/* Listing picker */}
      <div className="rounded-2xl border border-line bg-white overflow-hidden flex flex-col max-h-[72vh]">
        <div className="px-3 py-3 border-b border-line">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search listings…"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-line bg-white text-sm focus:outline-none focus:border-brand-500"
            />
          </div>
          <div className="text-[11px] text-muted mt-2">{filtered.length} of {listings.length} active</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted">No listings match.</div>
          ) : filtered.map(l => {
            const active = l.id === selectedId
            return (
              <button
                key={l.id}
                onClick={() => pick(l)}
                className={`w-full text-left px-4 py-2.5 border-b border-line last:border-0 transition-colors ${active ? 'bg-brand-50' : 'hover:bg-app'}`}
              >
                <div className={`text-sm font-medium truncate ${active ? 'text-brand-700' : 'text-ink'}`}>{nameOf(l)}</div>
                <div className="text-[11px] text-muted truncate">
                  {l.building || 'Unassigned'}{l.unit ? ` · ${l.unit}` : ''}{l.address_city ? ` · ${l.address_city}` : ''}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Detail / suggestion */}
      <div className="min-w-0">
        {!selected ? (
          <div className="rounded-2xl border border-line bg-white px-6 py-20 text-center">
            <span className="inline-flex w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 items-center justify-center text-white shadow-soft">
              <Wand2 size={22} />
            </span>
            <h3 className="mt-4 text-lg font-bold text-ink tracking-tight">Pick a listing to optimize</h3>
            <p className="mt-1.5 text-sm text-muted max-w-md mx-auto">
              Choose any active listing on the left. I&apos;ll suggest an OTA-optimized title and description using only that listing&apos;s real data.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Current listing card */}
            <div className="rounded-2xl border border-line bg-white p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">Current title</div>
                  <div className="text-lg font-bold text-ink mt-0.5 break-words">{nameOf(selected)}</div>
                  <div className="text-[12px] text-muted mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    <span className="inline-flex items-center gap-1"><Building2 size={12} />{selected.building || 'Unassigned'}{selected.unit ? ` · ${selected.unit}` : ''}</span>
                    {selected.bedrooms != null && <span className="inline-flex items-center gap-1"><BedDouble size={12} />{selected.bedrooms} bd</span>}
                    {selected.bathrooms != null && <span className="inline-flex items-center gap-1"><Bath size={12} />{selected.bathrooms} ba</span>}
                    {selected.max_occupancy != null && <span className="inline-flex items-center gap-1"><Users size={12} />sleeps {selected.max_occupancy}</span>}
                  </div>
                </div>
                <button
                  onClick={optimize}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 flex-shrink-0"
                >
                  {busy ? <Sparkles size={15} className="animate-pulse" /> : <Wand2 size={15} />}
                  {busy ? 'Optimizing…' : 'Optimize with AI'}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2">
                <AlertTriangle size={14} /> {error}
              </div>
            )}

            {busy && !suggestion && (
              <div className="rounded-2xl border border-line bg-white px-4 py-12 text-center text-sm text-muted">
                Writing an OTA-optimized title &amp; description…
              </div>
            )}

            {suggestion && (
              <div className="space-y-4">
                {/* Title before/after */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-line bg-white p-4">
                    <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1.5">Before</div>
                    <div className="text-sm text-ink break-words">{nameOf(selected)}</div>
                  </div>
                  <div className="rounded-2xl border border-brand-200 bg-brand-50/40 p-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="text-[11px] uppercase tracking-wider text-brand-700 font-semibold inline-flex items-center gap-1"><Sparkles size={11} /> Optimized title</div>
                      <CopyBtn label="title" text={suggestion.title} copied={copied} onCopy={copy} />
                    </div>
                    <div className="text-sm font-semibold text-ink break-words">{suggestion.title || '—'}</div>
                    <div className="text-[11px] text-muted mt-1">{suggestion.title.length} chars</div>
                  </div>
                </div>

                {/* Description */}
                <div className="rounded-2xl border border-brand-200 bg-white p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] uppercase tracking-wider text-brand-700 font-semibold inline-flex items-center gap-1"><Sparkles size={11} /> Optimized description</div>
                    <CopyBtn label="description" text={suggestion.description} copied={copied} onCopy={copy} />
                  </div>
                  <div className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{suggestion.description || '—'}</div>
                </div>

                {/* Bullets */}
                {suggestion.bullets.length > 0 && (
                  <div className="rounded-2xl border border-line bg-white p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">Highlight bullets</div>
                      <CopyBtn label="bullets" text={suggestion.bullets.map(b => `• ${b}`).join('\n')} copied={copied} onCopy={copy} />
                    </div>
                    <ul className="space-y-1">
                      {suggestion.bullets.map((b, i) => (
                        <li key={i} className="text-sm text-ink flex items-start gap-1.5">
                          <span className="text-brand-600 mt-0.5">▸</span> {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Rationale */}
                {suggestion.rationale && (
                  <div className="rounded-xl border border-line bg-app/50 px-4 py-3 text-[12px] text-muted">
                    <span className="font-semibold text-ink">Why this is stronger: </span>{suggestion.rationale}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function CopyBtn({ label, text, copied, onCopy }: {
  label: string
  text: string
  copied: string | null
  onCopy: (label: string, text: string) => void
}) {
  const done = copied === label
  return (
    <button
      onClick={() => onCopy(label, text)}
      disabled={!text}
      className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-lg px-2.5 py-1 transition-colors disabled:opacity-50"
    >
      {done ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
    </button>
  )
}
