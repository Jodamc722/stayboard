'use client'
import { useMemo, useState } from 'react'
import {
  Search, Sparkles, Wand2, Copy, Check, Building2, BedDouble, Bath, Users,
  AlertTriangle, ListChecks, Info,
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

type Section = { label: string; text: string }
type Suggestion = {
  platform: 'airbnb' | 'vrbo' | 'expedia' | 'booking'
  platformLabel: string
  mode: 'copy' | 'structured'
  titleField: string
  titleMax: number
  descField: string
  descMax: number
  title: string
  description: string
  sections: Section[]
  bullets: string[]
  checklist: string[]
  rationale: string
  warnings: string[]
}

type PlatformKey = 'airbnb' | 'vrbo' | 'expedia' | 'booking'
const PLATFORMS: { key: PlatformKey; label: string }[] = [
  { key: 'airbnb', label: 'Airbnb' },
  { key: 'vrbo', label: 'Vrbo' },
  { key: 'expedia', label: 'Expedia' },
  { key: 'booking', label: 'Booking.com' },
]

// Honest, per-platform context shown under the picker.
const PLATFORM_NOTE: Record<PlatformKey, string> = {
  airbnb: 'Title capped at 50 characters; the description summary at 500. I also draft Airbnb’s “The space”, “Guest access” and “Neighborhood” sections.',
  vrbo: 'Headline 20–80 characters; description 400–10,000. No URLs, phone, email or addresses — Vrbo rejects them.',
  expedia: 'For a Guesty-connected manager, your Expedia listing is your Vrbo listing (syndicated via Expedia’s network), so it follows Vrbo’s rules.',
  booking: 'Booking.com auto-generates descriptions from structured fields — you can’t push prose. So I optimize the property name and give you a content-completeness checklist instead.',
}

function nameOf(l: Listing) {
  return l.title || l.nickname || l.building || l.unit || 'Untitled listing'
}

export function OptimizeClient({ listings }: { listings: Listing[] }) {
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [platform, setPlatform] = useState<PlatformKey>('airbnb')
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

  function choosePlatform(p: PlatformKey) {
    setPlatform(p)
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
        body: JSON.stringify({ listingId: selected.id, platform }),
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
              Choose any active listing, then a target OTA. I&apos;ll write copy tuned to that platform&apos;s real rules — using only the listing&apos;s real data.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Current listing card + platform picker */}
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

              {/* Target OTA picker */}
              <div className="mt-4 pt-4 border-t border-line">
                <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2">Target OTA</div>
                <div className="inline-flex flex-wrap gap-1.5">
                  {PLATFORMS.map(p => {
                    const active = p.key === platform
                    return (
                      <button
                        key={p.key}
                        onClick={() => choosePlatform(p.key)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${active ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-muted border-line hover:text-ink hover:border-brand-200'}`}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[12px] text-muted mt-2 flex items-start gap-1.5 max-w-2xl">
                  <Info size={13} className="mt-0.5 flex-shrink-0" /> {PLATFORM_NOTE[platform]}
                </p>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2">
                <AlertTriangle size={14} /> {error}
              </div>
            )}

            {busy && !suggestion && (
              <div className="rounded-2xl border border-line bg-white px-4 py-12 text-center text-sm text-muted">
                Optimizing for {PLATFORMS.find(p => p.key === platform)?.label}…
              </div>
            )}

            {suggestion && <SuggestionView s={suggestion} before={nameOf(selected)} copied={copied} onCopy={copy} />}
          </div>
        )}
      </div>
    </div>
  )
}

function SuggestionView({ s, before, copied, onCopy }: {
  s: Suggestion; before: string; copied: string | null; onCopy: (l: string, t: string) => void
}) {
  const titleOver = s.title.length > s.titleMax
  return (
    <div className="space-y-4">
      {/* Warnings */}
      {s.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800">
          <div className="font-semibold flex items-center gap-1.5 mb-1"><AlertTriangle size={14} /> Before you publish</div>
          <ul className="space-y-0.5">
            {s.warnings.map((w, i) => <li key={i} className="flex items-start gap-1.5"><span className="mt-0.5">•</span> {w}</li>)}
          </ul>
        </div>
      )}

      {/* Title before/after */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-line bg-white p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1.5">Before</div>
          <div className="text-sm text-ink break-words">{before}</div>
        </div>
        <div className="rounded-2xl border border-brand-200 bg-brand-50/40 p-4">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[11px] uppercase tracking-wider text-brand-700 font-semibold inline-flex items-center gap-1">
              <Sparkles size={11} /> {s.platformLabel} {s.titleField.toLowerCase()}
            </div>
            <CopyBtn label="title" text={s.title} copied={copied} onCopy={onCopy} />
          </div>
          <div className="text-sm font-semibold text-ink break-words">{s.title || '—'}</div>
          <div className={`text-[11px] mt-1 ${titleOver ? 'text-rose-600 font-semibold' : 'text-muted'}`}>
            {s.title.length} / {s.titleMax} chars{titleOver ? ' · over limit' : ''}
          </div>
        </div>
      </div>

      {/* Description (copy mode) */}
      {s.mode === 'copy' && (
        <div className="rounded-2xl border border-brand-200 bg-white p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase tracking-wider text-brand-700 font-semibold inline-flex items-center gap-1">
              <Sparkles size={11} /> {s.platformLabel} {s.descField.toLowerCase()}
            </div>
            <CopyBtn label="description" text={s.description} copied={copied} onCopy={onCopy} />
          </div>
          <div className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{s.description || '—'}</div>
          {s.descMax > 0 && (
            <div className={`text-[11px] mt-2 ${s.description.length > s.descMax ? 'text-rose-600 font-semibold' : 'text-muted'}`}>
              {s.description.length} / {s.descMax} chars
            </div>
          )}
        </div>
      )}

      {/* Airbnb structured sections */}
      {s.sections.length > 0 && (
        <div className="grid grid-cols-1 gap-3">
          {s.sections.map((sec, i) => (
            <div key={i} className="rounded-2xl border border-line bg-white p-4">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">{sec.label}</div>
                <CopyBtn label={`sec-${i}`} text={sec.text} copied={copied} onCopy={onCopy} />
              </div>
              <div className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{sec.text}</div>
            </div>
          ))}
        </div>
      )}

      {/* Booking.com content checklist (structured mode) */}
      {s.mode === 'structured' && s.checklist.length > 0 && (
        <div className="rounded-2xl border border-brand-200 bg-white p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase tracking-wider text-brand-700 font-semibold inline-flex items-center gap-1">
              <ListChecks size={12} /> Content-completeness checklist
            </div>
            <CopyBtn label="checklist" text={s.checklist.map(b => `• ${b}`).join('\n')} copied={copied} onCopy={onCopy} />
          </div>
          <ul className="space-y-1.5">
            {s.checklist.map((b, i) => (
              <li key={i} className="text-sm text-ink flex items-start gap-2">
                <span className="mt-0.5 text-brand-600 flex-shrink-0"><Check size={14} /></span> {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Highlight bullets */}
      {s.bullets.length > 0 && (
        <div className="rounded-2xl border border-line bg-white p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">Highlight bullets</div>
            <CopyBtn label="bullets" text={s.bullets.map(b => `• ${b}`).join('\n')} copied={copied} onCopy={onCopy} />
          </div>
          <ul className="space-y-1">
            {s.bullets.map((b, i) => (
              <li key={i} className="text-sm text-ink flex items-start gap-1.5">
                <span className="text-brand-600 mt-0.5">▸</span> {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Rationale */}
      {s.rationale && (
        <div className="rounded-xl border border-line bg-app/50 px-4 py-3 text-[12px] text-muted">
          <span className="font-semibold text-ink">Why this is stronger: </span>{s.rationale}
        </div>
      )}
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
