'use client'
// Connected apps. Answers one question at a glance: is this actually wired up, and is it working?
//
// The reason this page exists: the review sync died on 2026-07-31 and stayed dead for four days.
// The watchdog caught it immediately and posted to Slack — but Slack was never connected, so the
// alert went nowhere and the only symptom was a page that looked a bit empty. Connection state was
// invisible, so nobody could see the smoke detector had no battery. Now it is on a page.
import { useCallback, useEffect, useState } from 'react'
import {
  Plug, Check, AlertTriangle, Loader2, RefreshCw, ChevronDown, Slack, Mail, Activity,
} from 'lucide-react'

type Setup = { envVar: string; steps: string[] } | null
type Integration = { key: string; label: string; connected: boolean; summary: string; uses: string[]; setup: Setup }
type Feed = { key: string; label: string; ageMin: number | null; limitMin: number; error: string | null; healthy: boolean }
type Data = { ok: boolean; owner: boolean; integrations: Integration[]; feeds: Feed[] }

const ICON: Record<string, any> = { slack: Slack, email: Mail }

function age(m: number | null): string {
  if (m == null) return 'never'
  if (m < 2) return 'just now'
  if (m < 90) return m + ' min ago'
  if (m < 60 * 48) return Math.round(m / 60) + ' h ago'
  return Math.round(m / 1440) + ' d ago'
}

export function IntegrationsAdmin() {
  const [d, setD] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/settings/integrations', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Could not load integrations.')
      setD(j)
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (err) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50/50 px-4 py-3 text-[13px] text-rose-700 flex items-center gap-2">
        <AlertTriangle size={14} /> {err}
      </div>
    )
  }
  if (!d) {
    return (
      <div className="rounded-2xl border border-line bg-white px-4 py-3 text-[13px] text-muted flex items-center gap-2">
        <Loader2 size={14} className="animate-spin" /> Checking connections…
      </div>
    )
  }

  const down = d.feeds.filter(f => !f.healthy)

  return (
    <div className="space-y-5">
      {/* ── Connected apps ─────────────────────────────────────── */}
      <div className="rounded-2xl border border-line bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2">
          <Plug size={15} className="text-brand-600" />
          <span className="text-sm font-bold text-ink">Connected apps</span>
          <button onClick={load} disabled={busy}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-muted hover:border-brand-300 disabled:opacity-40">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
          </button>
        </div>

        <div className="p-4 space-y-3">
          {d.integrations.map(it => {
            const Icon = ICON[it.key] || Plug
            const isOpen = open === it.key
            return (
              <div key={it.key}
                className={`rounded-xl border overflow-hidden ${it.connected ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40'}`}>
                <div className="px-3.5 py-3 flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${it.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    <Icon size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-bold text-ink">{it.label}</span>
                      <span className={`lh-chip text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${it.connected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                        {it.connected ? 'Connected' : 'Not connected'}
                      </span>
                    </div>
                    <p className={`text-[12px] mt-1 ${it.connected ? 'text-emerald-800' : 'text-amber-800'}`}>{it.summary}</p>

                    <button onClick={() => setOpen(isOpen ? null : it.key)}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-muted hover:text-ink">
                      <ChevronDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      {isOpen ? 'Hide details' : it.connected ? "What uses this" : 'What it unlocks & how to connect'}
                    </button>

                    {isOpen && (
                      <div className="mt-2.5 space-y-3">
                        <div>
                          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted mb-1">
                            {it.connected ? 'Currently routing here' : 'Waiting on this'}
                          </div>
                          <ul className="space-y-1">
                            {it.uses.map((u, i) => (
                              <li key={i} className="text-[12px] text-ink flex items-start gap-1.5">
                                <span className="text-muted mt-0.5">·</span>{u}
                              </li>
                            ))}
                          </ul>
                        </div>

                        {it.setup && !it.connected && (
                          <div className="rounded-lg border border-line bg-white p-3">
                            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted mb-1.5">
                              Setup · sets <code className="text-ink font-mono">{it.setup.envVar}</code>
                            </div>
                            <ol className="space-y-1.5">
                              {it.setup.steps.map((s, i) => (
                                <li key={i} className="text-[12px] text-ink flex items-start gap-2">
                                  <span className="w-4 h-4 rounded bg-app text-muted text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                                  <span>{s}</span>
                                </li>
                              ))}
                            </ol>
                            <p className="text-[11px] text-muted mt-2.5 pt-2.5 border-t border-line">
                              Secrets are set in Vercel, never typed into this app — nothing here can read them back.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Live feeds ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-line bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2">
          <Activity size={15} className={down.length ? 'text-rose-500' : 'text-emerald-600'} />
          <span className="text-sm font-bold text-ink">Data feeds</span>
          {down.length > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-800">
              {down.length} down
            </span>
          )}
        </div>
        <div className="divide-y divide-line">
          {d.feeds.length === 0 && <div className="px-4 py-3 text-[12px] text-muted">No feed status recorded yet.</div>}
          {d.feeds.map(f => (
            <div key={f.key} className="px-4 py-2.5 flex items-start gap-3">
              <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${f.healthy ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-ink">{f.label}</span>
                  <span className="text-[11px] text-muted tabular-nums">updated {age(f.ageMin)}</span>
                </div>
                {f.error && (
                  <p className="text-[11px] text-rose-700 mt-1 font-mono break-all">{f.error}</p>
                )}
              </div>
              {f.healthy
                ? <Check size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                : <AlertTriangle size={14} className="text-rose-600 flex-shrink-0 mt-0.5" />}
            </div>
          ))}
        </div>
        <div className="px-4 py-2.5 border-t border-line bg-app/40 text-[11px] text-muted">
          A feed going quiet is how the review outage hid for four days. If anything here is red and Slack is
          connected, you will hear about it within 30 minutes instead.
        </div>
      </div>
    </div>
  )
}
