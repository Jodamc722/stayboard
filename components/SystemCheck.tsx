'use client'
// SYSTEM CHECK — the panel that tells you why a setting is not doing anything.
//
// Every other panel on this page assumes the feature behind it works. This is the one that checks.
// Green rows are collapsed by default: a wall of "fine" teaches nothing, and the point of the
// screen is the two rows that are not fine.
import { useEffect, useState } from 'react'
import { RefreshCw, CheckCircle2, AlertTriangle, Loader2, ChevronDown } from 'lucide-react'

type Check = { key: string; label: string; ok: boolean; area: string; breaks: string; fix: string }

export function SystemCheck() {
  const [data, setData] = useState<{ checks: Check[]; healthy: number; total: number } | null>(null)
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState('')
  const [showOk, setShowOk] = useState(false)

  const load = () => {
    setBusy(true); setErr('')
    fetch('/api/settings/system-check', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j?.error) throw new Error(j.error); setData(j) })
      .catch(e => setErr(String(e?.message || e)))
      .finally(() => setBusy(false))
  }
  useEffect(load, [])

  const checks = data?.checks || []
  const bad = checks.filter(c => !c.ok)
  const good = checks.filter(c => c.ok)

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <p className="text-[13px] text-muted flex-1 min-w-[220px]">
          Whether the things these settings depend on are actually running. Nothing here shows a key or a password &mdash; only whether one is present.
        </p>
        <button onClick={load} disabled={busy}
          className="text-[12px] font-bold px-2.5 py-1.5 rounded-lg border border-line bg-white hover:border-ink/30 inline-flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Re-check
        </button>
      </div>

      {err && <p className="text-[12.5px] text-rose-600 font-semibold mb-3">{err}</p>}
      {busy && !data && <p className="text-[13px] text-muted">Checking&hellip;</p>}

      {data && (
        <>
          <div className={'rounded-xl border px-3.5 py-2.5 mb-3 ' + (bad.length ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50')}>
            <p className="text-[13.5px] font-bold text-ink">
              {bad.length
                ? bad.length + ' thing' + (bad.length === 1 ? '' : 's') + ' need attention'
                : 'Everything checked is working.'}
            </p>
            <p className="text-[12px] text-muted mt-0.5">{data.healthy} of {data.total} checks passing.</p>
          </div>

          {bad.map(c => (
            <div key={c.key} className="rounded-xl border border-rose-200 bg-white p-3 mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <AlertTriangle size={14} className="text-rose-600 shrink-0" />
                <span className="text-[13px] font-bold text-ink">{c.label}</span>
                <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-md bg-app text-muted border border-line">{c.area}</span>
              </div>
              <p className="text-[12.5px] text-ink mt-1.5"><b>What stops working:</b> {c.breaks}</p>
              <p className="text-[12.5px] text-muted mt-1"><b>How to fix it:</b> {c.fix}</p>
            </div>
          ))}

          {good.length > 0 && (
            <div className="rounded-xl border border-line bg-white overflow-hidden">
              <button onClick={() => setShowOk(s => !s)} className="w-full px-3.5 py-2.5 flex items-center gap-2 text-left hover:bg-app/50">
                <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                <span className="text-[13px] font-semibold text-ink">{good.length} working</span>
                <ChevronDown size={14} className={'ml-auto text-muted transition-transform ' + (showOk ? 'rotate-180' : '')} />
              </button>
              {showOk && (
                <div className="border-t border-line divide-y divide-line">
                  {good.map(c => (
                    <div key={c.key} className="px-3.5 py-2 flex items-center gap-2 flex-wrap">
                      <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                      <span className="text-[12.5px] text-ink">{c.label}</span>
                      <span className="text-[10.5px] text-muted ml-auto">{c.area}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
