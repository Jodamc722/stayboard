'use client'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { Sparkles, Eye, EyeOff, Search, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react'

type Field = {
  id: string
  name: string
  type: string
  target: string
  options: string[] | null
  tracked: boolean
  is_kpi: boolean
  kpi_slug: string | null
  display_name: string | null
  display_order: number
  synced_at: string
}

type SyncStatus = {
  entity: string
  last_sync_at: string | null
  last_error: string | null
  items_synced: number
} | null

// Suggested KPI slugs Jon mentioned + a few obvious ones
const KPI_PRESETS = [
  { slug: 'sensitive_guest', label: 'Sensitive Guest', hint: 'guests flagged for extra care' },
  { slug: 'welcome_call',    label: 'Welcome Call',    hint: 'pre-arrival call completed' },
  { slug: 'verified',        label: 'Verified',        hint: 'ID/guest verification' },
  { slug: 'vip',             label: 'VIP',             hint: 'returning or high-value guests' }
]

export function CustomFieldsManager({ fields: initial, syncStatus }: { fields: Field[]; syncStatus: SyncStatus }) {
  const router = useRouter()
  const [fields, setFields] = useState(initial)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'tracked' | 'kpi' | 'untracked'>('all')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [, startTransition] = useTransition()

  const filtered = useMemo(() => {
    let rows = fields
    if (filter === 'tracked') rows = rows.filter(f => f.tracked)
    if (filter === 'kpi') rows = rows.filter(f => f.is_kpi)
    if (filter === 'untracked') rows = rows.filter(f => !f.tracked)
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      rows = rows.filter(f =>
        f.name.toLowerCase().includes(needle) ||
        (f.display_name ?? '').toLowerCase().includes(needle) ||
        (f.kpi_slug ?? '').toLowerCase().includes(needle)
      )
    }
    return rows
  }, [fields, q, filter])

  // group by target
  const grouped = useMemo(() => {
    const m = new Map<string, Field[]>()
    for (const f of filtered) {
      const k = f.target || 'reservation'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(f)
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  const trackedCount = fields.filter(f => f.tracked).length
  const kpiCount = fields.filter(f => f.is_kpi).length

  async function patch(id: string, updates: Partial<Field>) {
    // optimistic update
    setFields(prev => prev.map(f => (f.id === id ? { ...f, ...updates } : f)))
    const supabase = createClient()
    const { error } = await supabase.from('guesty_custom_fields').update(updates).eq('id', id)
    if (error) {
      alert(`Save failed: ${error.message}`)
      // roll back by re-fetching
      startTransition(() => router.refresh())
    }
  }

  async function syncNow() {
    setSyncing(true); setSyncMsg(null)
    try {
      const res = await fetch('/api/sync/guesty', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setSyncMsg({ kind: 'ok', text: `Synced ${data?.custom_fields ?? 0} custom fields` })
      startTransition(() => router.refresh())
    } catch (e: any) {
      setSyncMsg({ kind: 'err', text: e.message || 'Sync failed' })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
        <div>
          <h1 className="text-3xl font-bold text-ink tracking-tight">Custom Fields</h1>
          <p className="text-sm text-muted mt-1">
            Pick which Guesty custom fields STAYBOARD tracks. Flag the important ones as KPIs to surface them on the dashboard.
          </p>
        </div>
        <button
          onClick={syncNow}
          disabled={syncing}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium bg-ink text-white hover:bg-ink/90 disabled:opacity-60 shadow-sm"
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing…' : 'Sync from Guesty'}
        </button>
      </div>

      {/* Summary chips */}
      <div className="flex items-center gap-2 text-xs mt-3">
        <Stat label="Total" value={fields.length} />
        <Stat label="Tracked" value={trackedCount} accent="emerald" />
        <Stat label="KPI" value={kpiCount} accent="brand" />
        {syncStatus?.last_sync_at && (
          <span className="text-muted ml-1">
            · synced {timeAgo(new Date(syncStatus.last_sync_at))}
          </span>
        )}
        {syncStatus?.last_error && (
          <span className="text-rose-700 inline-flex items-center gap-1 ml-1">
            <AlertCircle size={12} /> {syncStatus.last_error.slice(0, 60)}
          </span>
        )}
      </div>

      {syncMsg && (
        <div className={`mt-3 inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-md ${
          syncMsg.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' : 'bg-rose-50 text-rose-800 ring-1 ring-rose-200'
        }`}>
          {syncMsg.kind === 'ok' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
          {syncMsg.text}
        </div>
      )}

      {/* Filter row */}
      <div className="mt-6 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search fields…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-line bg-white text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
          />
        </div>
        <div className="inline-flex p-0.5 rounded-lg bg-app">
          {([
            { key: 'all',       label: 'All' },
            { key: 'tracked',   label: 'Tracked' },
            { key: 'kpi',       label: 'KPI' },
            { key: 'untracked', label: 'Untracked' }
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${
                filter === t.key ? 'bg-white text-ink shadow-soft' : 'text-muted hover:text-ink'
              }`}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {fields.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-line bg-white p-10 text-center shadow-soft">
          <div className="text-ink font-semibold">No custom fields synced yet</div>
          <p className="text-sm text-muted mt-1 max-w-md mx-auto">
            Hit “Sync from Guesty” above. If Guesty is in 429 cooldown the next cron tick (every 15 min) will populate this list automatically.
          </p>
        </div>
      ) : grouped.length === 0 ? (
        <div className="mt-8 text-sm text-muted">No fields match those filters.</div>
      ) : (
        <div className="mt-6 space-y-6">
          {grouped.map(([target, rows]) => (
            <section key={target}>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-muted mb-2 pl-1">
                {target} fields · {rows.length}
              </div>
              <div className="bg-white rounded-2xl border border-line shadow-soft overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider font-semibold text-muted bg-app">
                      <th className="text-left px-4 py-2.5">Field</th>
                      <th className="text-left px-3 py-2.5 w-24">Type</th>
                      <th className="text-left px-3 py-2.5 w-28">Track</th>
                      <th className="text-left px-3 py-2.5 w-40">KPI</th>
                      <th className="text-left px-3 py-2.5 w-44">KPI slug</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map(f => (
                      <tr key={f.id} className="hover:bg-app/40 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div>
                              <div className="font-medium text-ink">{f.display_name || f.name}</div>
                              {f.display_name && (
                                <div className="text-[11px] text-muted">Guesty: {f.name}</div>
                              )}
                              {f.options && f.options.length > 0 && (
                                <div className="text-[11px] text-muted mt-0.5">
                                  options: {f.options.slice(0, 4).join(', ')}{f.options.length > 4 ? '…' : ''}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-xs text-muted">{f.type}</td>
                        <td className="px-3 py-3">
                          <Toggle
                            on={f.tracked}
                            onChange={v => patch(f.id, { tracked: v, ...(v ? {} : { is_kpi: false }) })}
                            labelOn="Tracked"
                            labelOff="Off"
                            iconOn={<Eye size={11} />}
                            iconOff={<EyeOff size={11} />}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <Toggle
                            on={f.is_kpi}
                            disabled={!f.tracked}
                            onChange={v => patch(f.id, { is_kpi: v, tracked: v ? true : f.tracked })}
                            labelOn="KPI"
                            labelOff="Off"
                            tone="kpi"
                            iconOn={<Sparkles size={11} />}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <KpiSlugPicker
                            value={f.kpi_slug}
                            disabled={!f.is_kpi}
                            onChange={slug => patch(f.id, { kpi_slug: slug })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Footer help */}
      <div className="mt-8 rounded-xl border border-line bg-app/60 p-4 text-xs text-muted">
        <div className="font-semibold text-ink mb-1">How this works</div>
        <ul className="space-y-1 list-disc pl-5">
          <li><b>Tracked</b> — field appears in the reservation detail view.</li>
          <li><b>KPI</b> — also rolls up to dashboard cards. Pick a slug so STAYBOARD knows which KPI it powers (e.g. <code>sensitive_guest</code>, <code>welcome_call</code>).</li>
          <li>Custom field values come straight from Guesty on every sync — no double entry.</li>
        </ul>
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: 'emerald' | 'brand' }) {
  const cls = accent === 'emerald'
    ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
    : accent === 'brand'
    ? 'bg-brand-50 text-brand-800 ring-brand-200'
    : 'bg-white text-ink ring-line'
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md ring-1 ring-inset font-medium ${cls}`}>
      <span className="text-[10px] uppercase tracking-wider opacity-70">{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  )
}

function Toggle({
  on, onChange, labelOn, labelOff, iconOn, iconOff, disabled, tone
}: {
  on: boolean
  onChange: (v: boolean) => void
  labelOn: string
  labelOff: string
  iconOn?: React.ReactNode
  iconOff?: React.ReactNode
  disabled?: boolean
  tone?: 'kpi'
}) {
  const onCls = tone === 'kpi'
    ? 'bg-brand-600 text-white hover:bg-brand-700'
    : 'bg-emerald-600 text-white hover:bg-emerald-700'
  return (
    <button
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
        disabled ? 'bg-app text-muted/50 cursor-not-allowed' : on ? onCls : 'bg-app text-muted hover:text-ink'
      }`}
    >
      {on ? iconOn : iconOff}
      {on ? labelOn : labelOff}
    </button>
  )
}

function KpiSlugPicker({
  value, disabled, onChange
}: { value: string | null; disabled?: boolean; onChange: (v: string | null) => void }) {
  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={e => onChange(e.target.value || null)}
      className={`w-full text-xs px-2 py-1.5 rounded-md border ${
        disabled ? 'bg-app border-line text-muted/50 cursor-not-allowed' : 'bg-white border-line focus:border-brand-400 outline-none'
      }`}
    >
      <option value="">{disabled ? '—' : 'Pick a slug…'}</option>
      {KPI_PRESETS.map(p => (
        <option key={p.slug} value={p.slug}>{p.label} ({p.slug})</option>
      ))}
      {value && !KPI_PRESETS.find(p => p.slug === value) && (
        <option value={value}>{value}</option>
      )}
    </select>
  )
}

function timeAgo(d: Date) {
  const m = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
