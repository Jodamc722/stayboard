'use client'
// FILING POLICY — the rules the board runs on, editable in the app.
//
// These are somebody else's rules and they move: Airbnb, Vrbo, Booking and Expedia change their
// windows and caps whenever they like, and the deposit we take is our own call and not yet settled.
// Hardcoding them would mean a deploy every time a platform sends an email. So the researched
// defaults live in code and anything typed here overrides them.
//
// The numbers as researched 2026-08-04:
//   Airbnb       14 days from the responsible guest's checkout (AirCover / Resolution Center)
//   Vrbo         14 days to file — but the deposit is released back to the guest in up to 14 days
//   Expedia      Expedia Group points back at Vrbo's deposit mechanics
//   Booking.com  14 days; Damage Programme recovery capped around €250 whatever you set
//   Direct       no platform window at all — we hold the card
import { useState, useEffect, useCallback } from 'react'
import { X, Loader2, Check, RotateCcw, CalendarClock } from 'lucide-react'
import type { ChannelPolicy } from '@/lib/claims'

type Table = Record<string, ChannelPolicy>

export function ClaimPolicyPanel({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [policy, setPolicy] = useState<Table | null>(null)
  const [defaults, setDefaults] = useState<Table>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/claims/policy', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Could not load the policy.'); return }
      setPolicy(j.policy || {}); setDefaults(j.defaults || {})
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [])
  useEffect(() => { load() }, [load])

  const set = (ch: string, field: keyof ChannelPolicy, value: any) => {
    setPolicy(p => p ? { ...p, [ch]: { ...p[ch], [field]: value } } : p)
    setSaved(false)
  }

  const save = async () => {
    if (!policy) return
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/claims/policy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ policy }) })
      const j = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Could not save.'); return }
      setPolicy(j.policy || policy); setSaved(true)
      if (onSaved) onSaved()
      setTimeout(() => setSaved(false), 4000)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(false) }
  }

  const reset = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/claims/policy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ policy: {} }) })
      const j = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Could not reset.'); return }
      setPolicy(j.policy || defaults); setSaved(true)
      if (onSaved) onSaved()
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(false) }
  }

  const rows = policy ? Object.keys(policy) : []

  return (
    <div className="rounded-2xl border border-line bg-white p-4 mb-4">
      <div className="flex items-center gap-2 mb-1">
        <CalendarClock size={14} className="text-muted" />
        <span className="text-sm font-semibold text-ink">Filing policy by channel</span>
        <button onClick={onClose} className="ml-auto text-muted hover:text-ink"><X size={15} /></button>
      </div>
      <p className="text-[12px] text-muted mb-3">
        <span className="font-medium text-ink">Window</span> is the channel&rsquo;s hard cutoff, in days after checkout &mdash; miss it and the claim is worth nothing.{' '}
        <span className="font-medium text-ink">Target</span> is the day we intend to file, and it is what every card counts down to.
      </p>

      {err && <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 mb-2">{err}</div>}
      {!policy && <div className="text-[12px] text-muted py-3 text-center">Loading…</div>}

      {policy && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                  <th className="py-1 pr-3 font-semibold">Channel</th>
                  <th className="py-1 pr-3 font-semibold">Window</th>
                  <th className="py-1 pr-3 font-semibold">Target</th>
                  <th className="py-1 pr-3 font-semibold">Deposit</th>
                  <th className="py-1 pr-3 font-semibold">Filed where</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(ch => {
                  const p = policy[ch]
                  const d = defaults[ch]
                  const changed = d && (p.windowDays !== d.windowDays || p.targetDays !== d.targetDays || p.deposit !== d.deposit)
                  return (
                    <tr key={ch} className="align-top">
                      <td className="py-2 pr-3">
                        <div className="font-semibold text-ink">{ch}</div>
                        {changed && <div className="text-[10px] text-amber-700">edited</div>}
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          value={p.windowDays === null ? '' : String(p.windowDays)}
                          onChange={e => set(ch, 'windowDays', e.target.value.trim() === '' ? null : Number(e.target.value.replace(/[^0-9]/g, '')))}
                          placeholder="none" inputMode="numeric"
                          className="w-16 border border-line rounded-lg px-2 py-1 bg-white tabular-nums" />
                        <span className="text-muted ml-1">d</span>
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          value={String(p.targetDays ?? '')}
                          onChange={e => set(ch, 'targetDays', Number(e.target.value.replace(/[^0-9]/g, '') || 0))}
                          inputMode="numeric"
                          className="w-16 border border-line rounded-lg px-2 py-1 bg-white tabular-nums" />
                        <span className="text-muted ml-1">d</span>
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          value={p.deposit === null || p.deposit === undefined ? '' : String(p.deposit)}
                          onChange={e => set(ch, 'deposit', e.target.value.trim() === '' ? null : Number(e.target.value.replace(/[^0-9.]/g, '')))}
                          placeholder="none" inputMode="decimal"
                          className="w-20 border border-line rounded-lg px-2 py-1 bg-white tabular-nums" />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          value={p.route || ''} onChange={e => set(ch, 'route', e.target.value)}
                          className="w-full min-w-[170px] border border-line rounded-lg px-2 py-1 bg-white" />
                        {p.note && <div className="text-[11px] text-muted mt-0.5 max-w-[320px]">{p.note}</div>}
                        {p.capNote && <div className="text-[11px] text-amber-800 mt-0.5 max-w-[320px]">{p.capNote}</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <button onClick={save} disabled={busy} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40 inline-flex items-center gap-1.5">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save policy
            </button>
            <button onClick={reset} disabled={busy} className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1.5">
              <RotateCcw size={12} /> Back to researched defaults
            </button>
            {saved && <span className="text-[12px] text-emerald-700 font-medium inline-flex items-center gap-1"><Check size={12} /> Saved</span>}
          </div>
          <p className="text-[11px] text-muted mt-2">
            Changing a policy re-dates every future claim on that channel. Claims already open keep their dates unless you edit them,
            and a due date you set by hand is never moved automatically.
          </p>
        </>
      )}
    </div>
  )
}
