'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { SyncNowButton } from '@/components/SyncNowButton'

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
  confirmed:   'bg-blue-50 text-blue-700 ring-blue-600/20',
  checked_in:  'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  checked_out: 'bg-slate-100 text-slate-600 ring-slate-300',
  cancelled:   'bg-rose-50 text-rose-700 ring-rose-600/20',
  inquiry:     'bg-amber-50 text-amber-700 ring-amber-600/20',
  reserved:    'bg-indigo-50 text-indigo-700 ring-indigo-600/20'
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
      <header className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reservations</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {lastSync ? <>Last synced {timeAgo(new Date(lastSync))} · </> : null}
            <strong className="text-slate-700">{totalSynced || (upcoming.length + past.length)}</strong> total ·
            <strong className="text-slate-700 ml-1">{upcoming.length}</strong> current/upcoming
          </p>
        </div>
        <SyncNowButton />
      </header>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 mb-5 flex flex-wrap items-center gap-2">
        <div className="inline-flex p-0.5 rounded-lg bg-slate-100">
          {[
            { v: 'upcoming' as const, l: `Upcoming · ${upcoming.length}` },
            { v: 'past'     as const, l: `Past · ${past.length}` },
            { v: 'all'      as const, l: 'All' }
          ].map(t => (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              className={`text-xs px-2.5 py-1.5 rounded-md font-medium transition ${tab === t.v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
            >{t.l}</button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[220px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M9 17a8 8 0 100-16 8 8 0 000 16zm9 1l-4-4"/></svg>
          </span>
          <input
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search guest or unit…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition"
          />
        </div>

        {allSources.length > 1 && (
          <select
            value={src ?? ''}
            onChange={e => setSrc(e.target.value || null)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 focus:border-brand-500 outline-none cursor-pointer"
          >
            <option value="">All sources</option>
            {allSources.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
        )}

        {(q || src) && (
          <button onClick={() => { setQ(''); setSrc(null) }} className="text-xs text-slate-500 hover:text-slate-900 px-2 py-1">Clear</button>
        )}

        <span className="ml-auto text-xs text-slate-400">{rows.length} shown</span>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
          {totalSynced === 0
            ? <>No reservations cached yet. Click <strong>Sync now</strong> above.</>
            : 'No reservations match the current filters.'}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50/50">
              <tr>
                {['Guest', 'Property', 'Dates', 'Nights', 'Status', 'Flags', 'Source', 'Total'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50/50 transition">
                  <td className="px-4 py-2.5 text-sm">
                    <Link href={`/reservations/${r.id}`} className="font-medium text-slate-900 hover:text-brand-600">{r.guest_name || 'Unknown'}</Link>
                    {r.guest_email && <div className="text-[10px] text-slate-400 truncate max-w-[14rem]">{r.guest_email}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-700">{r.listing_name || '—'}</td>
                  <td className="px-4 py-2.5 text-sm text-slate-600 whitespace-nowrap">
                    {fmtRange(r.check_in, r.check_out)}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-600">{r.nights ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${STATUS_STYLES[r.status || ''] || 'bg-slate-50 text-slate-500 ring-slate-200'}`}>
                      {(r.status || '—').replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs"><FlagChips fields={r.custom_fields ?? []} /></td>
                  <td className="px-4 py-2.5 text-[10px] text-slate-500 uppercase tracking-wide font-medium whitespace-nowrap">{r.source || '—'}</td>
                  <td className="px-4 py-2.5 text-sm font-medium text-slate-900 text-right whitespace-nowrap">{fmtMoney(r.money_total, r.money_currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function FlagChips({ fields }: { fields: any[] }) {
  if (!Array.isArray(fields) || fields.length === 0) return <span className="text-slate-300">—</span>
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
  if (visible.length === 0) return <span className="text-slate-300">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map(v => {
        const cls = v.tone === 'rose'  ? 'bg-rose-50 text-rose-700 ring-rose-600/20'
                  : v.tone === 'amber' ? 'bg-amber-50 text-amber-700 ring-amber-600/20'
                  :                      'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
        return <span key={v.label} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ring-inset ${cls}`}>{v.label}</span>
      })}
    </div>
  )
}

function fmtRange(ci?: string | null, co?: string | null) {
  if (!ci) return '—'
  const a = new Date(ci), b = co ? new Date(co) : null
  const sameYear = b && a.getFullYear() === b.getFullYear()
  const left  = a.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: '2-digit' })
  const right = b ? b.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) : ''
  return right ? `${left} → ${right}` : left
}

function fmtMoney(v: number | string | null | undefined, currency?: string | null) {
  if (v == null || v === '') return '—'
  const n = Number(v); if (isNaN(n)) return '—'
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
