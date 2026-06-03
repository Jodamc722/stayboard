'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { SyncNowButton } from '@/components/SyncNowButton'
import { Search, X } from 'lucide-react'

type R = {
  id: string
  listing_name: string | null
  guest_name: string | null
  guest_email: string | null
  check_in: string | null
  check_out: string | null
  nights: number | null
  status: string | null
  source: string | null
  money_total: number | string | null
  money_paid: number | string | null
  money_currency: string | null
  custom_fields: any
}

const STATUS_STYLES: Record<string, string> = {
  confirmed:   'bg-blue-50 text-blue-700 ring-blue-200',
  checked_in:  'bg-emerald-50 text-emerald-700 ring-emerald-200',
  checked_out: 'bg-slate-100 text-slate-600 ring-slate-200',
  cancelled:   'bg-rose-50 text-rose-700 ring-rose-200',
  inquiry:     'bg-amber-50 text-amber-700 ring-amber-200',
  reserved:    'bg-indigo-50 text-indigo-700 ring-indigo-200'
}

const SOURCE_LABEL: Record<string, string> = {
  airbnb: 'Airbnb', airbnb2: 'Airbnb', vrbo: 'VRBO',
  'booking.com': 'Booking', booking: 'Booking',
  direct: 'Direct', expedia: 'Expedia', other: 'Other'
}

export function ReservationsView({
  upcoming, past, lastSync, totalSynced
}: { upcoming: R[]; past: R[]; lastSync: string | null; totalSynced: number }) {
  const [tab, setTab] = useState<'upcoming' | 'past' | 'all'>('upcoming')
  const [q, setQ]     = useState('')
  const [src, setSrc] = useState<string | null>(null)

  const source = (tab === 'past' ? past : tab === 'upcoming' ? upcoming : [...upcoming, ...past])

  const allSources = useMemo(() => {
    const s = new Set<string>()
    ;[...upcoming, ...past].forEach(r => r.source && s.add(r.source))
    return Array.from(s).sort()
  }, [upcoming, past])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return source.filter(r => {
      if (src && r.source !== src) return false
      if (needle) {
        const hay = `${r.guest_name ?? ''} ${r.guest_email ?? ''} ${r.listing_name ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [source, q, src])

  return (
    <>
      <header className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-ink tracking-tight">Reservations</h1>
          <p className="text-sm text-muted mt-1">
            {lastSync ? <>Last synced {timeAgo(new Date(lastSync))} · </> : null}
            <strong className="text-ink/80">{totalSynced || (upcoming.length + past.length)}</strong> total ·
            <strong className="text-ink/80 ml-1">{upcoming.length}</strong> upcoming
          </p>
        </div>
        <SyncNowButton />
      </header>

      <div className="bg-white rounded-2xl border border-line shadow-soft p-2 mb-5 flex flex-wrap items-center gap-2">
        <Segmented value={tab} onChange={setTab} options={[
          { v: 'upcoming', l: `Upcoming · ${upcoming.length}` },
          { v: 'past',     l: `Past · ${past.length}` },
          { v: 'all',      l: 'All' }
        ]} />

        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/70 pointer-events-none" />
          <input
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search guest, email, unit…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-line focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition bg-white"
          />
        </div>

        {allSources.length > 1 && (
          <select
            value={src ?? ''}
            onChange={e => setSrc(e.target.value || null)}
            className="text-xs px-2.5 py-2 rounded-lg border border-line bg-white text-ink focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none cursor-pointer"
          >
            <option value="">All sources</option>
            {allSources.map(s => <option key={s} value={s}>{SOURCE_LABEL[s] || s.toUpperCase()}</option>)}
          </select>
        )}

        {(q || src) && (
          <button onClick={() => { setQ(''); setSrc(null) }} className="text-xs text-muted hover:text-ink px-2 py-1 inline-flex items-center gap-1">
            <X size={11} /> Clear
          </button>
        )}

        <span className="ml-auto text-xs text-muted pr-2">{rows.length} shown</span>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-line p-16 text-center text-muted shadow-soft">
          {totalSynced === 0
            ? <>No reservations cached yet. Click <strong>Sync now</strong> above.</>
            : 'No reservations match the current filters.'}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-line shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-app">
                <tr>
                  {['Guest', 'Property', 'Dates', 'Nights', 'Status', 'Flags', 'Source', 'Total'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted uppercase tracking-[0.08em]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-app/50 transition-colors group">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={r.guest_name} />
                        <div className="min-w-0">
                          <Link href={`/reservations/${r.id}`} className="font-medium text-ink hover:text-brand-700 text-sm">{r.guest_name || 'Unknown'}</Link>
                          {r.guest_email && <div className="text-[11px] text-muted truncate max-w-[14rem]">{r.guest_email}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-ink/80">{r.listing_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-ink/70 whitespace-nowrap">{fmtRange(r.check_in, r.check_out)}</td>
                    <td className="px-4 py-3 text-sm text-ink/70 tabular-nums">{r.nights ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${STATUS_STYLES[r.status || ''] || 'bg-slate-50 text-slate-500 ring-slate-200'}`}>
                        {(r.status || '—').replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs"><FlagChips fields={r.custom_fields ?? []} /></td>
                    <td className="px-4 py-3 text-[11px] text-muted uppercase tracking-wide font-medium whitespace-nowrap">{SOURCE_LABEL[r.source || ''] || r.source || '—'}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-ink text-right whitespace-nowrap tabular-nums">{fmtMoney(r.money_total, r.money_currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  return (
    <div className="inline-flex p-0.5 rounded-lg bg-app">
      {options.map(o => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${value === o.v ? 'bg-white text-ink shadow-soft' : 'text-muted hover:text-ink'}`}
        >{o.l}</button>
      ))}
    </div>
  )
}

function Avatar({ name }: { name: string | null }) {
  const init = (name || 'G').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
  let h = 0
  for (const c of (name || 'G')) h = (h * 31 + c.charCodeAt(0)) % 360
  const bg = `hsl(${h}, 55%, 93%)`
  const fg = `hsl(${h}, 45%, 30%)`
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0" style={{ background: bg, color: fg }}>
      {init}
    </div>
  )
}

function FlagChips({ fields }: { fields: any[] }) {
  if (!Array.isArray(fields) || fields.length === 0) return <span className="text-line">—</span>
  const find = (slug: string) => fields.find((f: any) => (f.fieldName || f.name || '').toLowerCase().includes(slug))
  const truthy = (v: any) => v === true || v === 'true' || (typeof v === 'string' && v.trim().length > 0)
  const welcome   = find('welcome')
  const verified  = find('verified')
  const sensitive = find('sensitive')
  const risk      = find('risk')
  const idsub     = find('id submit')
  const visible: { tone: 'green' | 'rose' | 'amber'; label: string }[] = []
  if (welcome   && truthy(welcome.value))   visible.push({ tone: 'green', label: 'Welcome' })
  if (verified  && truthy(verified.value))  visible.push({ tone: 'green', label: 'Verified' })
  if (idsub     && truthy(idsub.value))     visible.push({ tone: 'green', label: 'ID' })
  if (sensitive && truthy(sensitive.value)) visible.push({ tone: 'rose',  label: 'Sensitive' })
  if (risk && String(risk.value).toLowerCase() === 'high')   visible.push({ tone: 'rose',  label: 'High risk' })
  if (risk && String(risk.value).toLowerCase() === 'medium') visible.push({ tone: 'amber', label: 'Med risk' })
  if (visible.length === 0) return <span className="text-line">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map(v => {
        const cls = v.tone === 'rose'  ? 'bg-rose-50 text-rose-700 ring-rose-200'
                  : v.tone === 'amber' ? 'bg-amber-50 text-amber-700 ring-amber-200'
                  :                      'bg-emerald-50 text-emerald-700 ring-emerald-200'
        return <span key={v.label} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ring-inset ${cls}`}>{v.label}</span>
      })}
    </div>
  )
}

function fmtRange(ci?: string | null, co?: string | null) {
  if (!ci) return '—'
  const a = new Date(ci), b = co ? new Date(co) : null
  const thisYear = new Date().getFullYear()
  const sameYear = b ? a.getFullYear() === b.getFullYear() : false
  const showYear = !sameYear || a.getFullYear() !== thisYear
  const opts: Intl.DateTimeFormatOptions = showYear
    ? { month: 'short', day: 'numeric', year: '2-digit' }
    : { month: 'short', day: 'numeric' }
  const left  = a.toLocaleDateString(undefined, opts)
  const right = b ? b.toLocaleDateString(undefined, opts) : ''
  return right ? `${left} → ${right}` : left
}

function fmtMoney(v: number | string | null | undefined, currency?: string | null) {
  if (v == null || v === '') return <span className="text-line">—</span> as any
  const n = Number(v); if (isNaN(n)) return <span className="text-line">—</span> as any
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n)
  } catch {
    return `$${n.toLocaleString()}`
  }
}

function timeAgo(d: Date) {
  const m = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
