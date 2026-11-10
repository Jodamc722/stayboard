'use client'
// CLAIMS REPORT FOR PAYABLES (Jon, 2026-11-06: "we need to be able to pull report and share with
// payables"). One sheet: every claim the channel decided, what we asked, what was actually received,
// when, and whether it has reached the owner's statement — filterable, with totals, and three ways
// out: a CSV for the books, a copy that pastes straight into an email or a sheet, and print/PDF.
import { useMemo, useState } from 'react'
import { X, Download, Copy, Printer, Check } from 'lucide-react'
import { claimTitle, money, askedOf, receivedOf, type Claim } from '@/lib/claims'

type View = 'open' | 'paid' | 'denied' | 'all'
const VIEWS: { key: View; label: string }[] = [
  { key: 'open', label: 'Paid — awaiting close-out' },
  { key: 'paid', label: 'All paid (incl. closed)' },
  { key: 'denied', label: 'Denied — not paid' },
  { key: 'all', label: 'Everything decided' },
]
const OUT: Record<string, string> = { won: 'Paid in full', partial: 'Partially paid', denied: 'Denied — not paid', withdrawn: 'Withdrawn', duplicate: 'Duplicate' }
const isPaid = (c: Claim) => c.outcome === 'won' || c.outcome === 'partial'
const when = (c: Claim) => String(c.paid_on || c.decided_on || '').slice(0, 10)

export function PayablesReport({ claims, onClose }: { claims: Claim[]; onClose: () => void }) {
  const [view, setView] = useState<View>('open')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [copied, setCopied] = useState(false)

  const rows = useMemo(() => claims.filter(c => {
    if (!c.outcome) return false
    if (view === 'open' && !(isPaid(c) && c.stage !== 'closed')) return false
    if (view === 'paid' && !isPaid(c)) return false
    if (view === 'denied' && c.outcome !== 'denied') return false
    const d = when(c)
    if (from && (!d || d < from)) return false
    if (to && (!d || d > to)) return false
    return true
  }).sort((a, b) => when(b).localeCompare(when(a))), [claims, view, from, to])
  // A date range can only keep claims that HAVE a date — say how many it left out, never silently.
  const undated = useMemo(() => (from || to) ? claims.filter(c => {
    if (!c.outcome || when(c)) return false
    if (view === 'open') return isPaid(c) && c.stage !== 'closed'
    if (view === 'paid') return isPaid(c)
    if (view === 'denied') return c.outcome === 'denied'
    return true
  }).length : 0, [claims, view, from, to])

  // ONE SET OF SUMS (lib/claims): "received" is money on claims the channel PAID — a claim later
  // changed to denied, withdrawn or duplicate no longer counts whatever amount is still on it. A
  // partly paid claim counts once, at what was received; the rest is "not recovered", never owed.
  const sought = rows.reduce((t, c) => t + askedOf(c), 0)
  const received = rows.reduce((t, c) => t + receivedOf(c), 0)
  const toOwner = rows.filter(c => isPaid(c) && !c.owner_adjusted).reduce((t, c) => t + receivedOf(c), 0)
  const unverified = rows.filter(c => isPaid(c) && !c.payment_verified).reduce((t, c) => t + receivedOf(c), 0)
  const short = rows.filter(isPaid).reduce((t, c) => t + Math.max(0, askedOf(c) - receivedOf(c)), 0)

  const table = () => {
    const head = ['Property', 'Unit', 'Guest', 'Channel', 'Confirmation', 'Channel case #', 'Decision', 'Asked', 'Received', 'Paid on', 'Money in verified', 'Owner adjusted', 'Status', 'Lighthouse link']
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const body = rows.map(c => [
      c.property || '', c.unit_no || '', c.guest_name || '', c.channel || '', c.confirmation_code || '', c.channel_case_id || '',
      OUT[String(c.outcome)] || '', askedOf(c).toFixed(2), receivedOf(c).toFixed(2),
      when(c), c.payment_verified ? 'Yes' : 'No', c.owner_adjusted ? 'Yes' : 'No', c.stage === 'closed' ? 'Closed' : 'Open', origin + '/claims?claim=' + c.id,
    ])
    return { head, body }
  }
  const label = VIEWS.find(v => v.key === view)!.label + (from || to ? ' · ' + (from || '…') + ' to ' + (to || '…') : '')

  const csv = () => {
    const { head, body } = table()
    const esc = (v: string) => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
    const text = [head, ...body].map(r => r.map(esc).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
    a.download = 'claims-payables-' + new Date().toISOString().slice(0, 10) + '.csv'
    document.body.appendChild(a); a.click(); a.remove()
  }
  const copy = async () => {
    const { head, body } = table()
    const summary = 'Damage claims — ' + label + '\n' + rows.length + ' claim(s) · asked ' + money(sought) + ' · received ' + money(received) + (toOwner ? ' · ' + money(toOwner) + ' still to allocate to owners' : '') + '\n\n'
    const text = summary + [head.slice(0, 13), ...body.map(r => r.slice(0, 13))].map(r => r.join('\t')).join('\n')
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { window.alert('Copy failed — use Download CSV instead.') }
  }

  const btn = 'inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border'
  return (
    <div className="fixed inset-0 z-50 bg-ink/40 flex items-start justify-center p-3 overflow-auto print:static print:bg-white print:p-0" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-6xl bg-white rounded-2xl border border-line shadow-xl my-6 print:my-0 print:border-0 print:shadow-none">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-bold text-ink">Claims report for payables</span>
          <span className="text-[12px] text-muted">{label}</span>
          <button onClick={onClose} className="ml-auto text-muted hover:text-ink print:hidden"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap print:hidden">
            <select value={view} onChange={e => setView(e.target.value as View)} className="text-[12.5px] border border-line rounded-lg px-2 py-1.5 bg-white">
              {VIEWS.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
            <span className="text-[12px] text-muted">Paid / decided from</span>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="text-[12.5px] border border-line rounded-lg px-2 py-1" />
            <span className="text-[12px] text-muted">to</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="text-[12.5px] border border-line rounded-lg px-2 py-1" />
            <span className="ml-auto flex gap-1.5">
              <button onClick={csv} disabled={!rows.length} className={btn + ' border-ink bg-ink text-white disabled:opacity-40'}><Download size={13} /> Download CSV</button>
              <button onClick={copy} disabled={!rows.length} className={btn + ' border-line bg-white text-ink disabled:opacity-40'}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy for email'}</button>
              <button onClick={() => window.print()} disabled={!rows.length} className={btn + ' border-line bg-white text-ink disabled:opacity-40'}><Printer size={13} /> Print / PDF</button>
            </span>
          </div>
          <div className="flex gap-4 flex-wrap text-[13px]">
            <span><b className="tabular-nums">{rows.length}</b> <span className="text-muted">claims</span></span>
            <span><b className="tabular-nums">{money(sought)}</b> <span className="text-muted">asked</span></span>
            <span><b className="tabular-nums text-emerald-700">{money(received)}</b> <span className="text-muted">received</span></span>
            {toOwner > 0 && <span><b className="tabular-nums text-amber-700">{money(toOwner)}</b> <span className="text-muted">received, not yet on the owner statement</span></span>}
            {unverified > 0 && <span title="Marked paid, but nobody has ticked Money in — the payment has not been confirmed in the account"><b className="tabular-nums text-amber-700">{money(unverified)}</b> <span className="text-muted">marked paid, not yet verified in the account</span></span>}
            {short > 0 && <span title="On paid claims: asked minus received. The channel paid less than we asked — this is not owed to anyone"><b className="tabular-nums">{money(short)}</b> <span className="text-muted">asked but not paid</span></span>}
            {undated > 0 && <span className="text-amber-700">{undated} claim{undated === 1 ? ' has' : 's have'} no paid / decided date and {undated === 1 ? 'is' : 'are'} left out of this date range</span>}
          </div>
          {rows.length === 0 ? <p className="text-[13px] text-muted py-6 text-center">No claims match.</p> : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-[12.5px]">
                <thead className="bg-app text-muted text-[11px] uppercase tracking-wide">
                  <tr>{['Claim', 'Channel', 'Conf. / case', 'Decision', 'Asked', 'Received', 'Paid on', 'Money in', 'Owner adj.', 'Status'].map(h => <th key={h} className="text-left font-semibold px-2.5 py-2 whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map(c => (
                    <tr key={c.id}>
                      <td className="px-2.5 py-1.5 font-semibold text-ink">{claimTitle(c)}</td>
                      <td className="px-2.5 py-1.5">{c.channel || '—'}</td>
                      <td className="px-2.5 py-1.5 font-mono text-[11.5px]">{c.confirmation_code || '—'}{c.channel_case_id ? ' / ' + c.channel_case_id : ''}</td>
                      <td className={'px-2.5 py-1.5 whitespace-nowrap ' + (c.outcome === 'denied' ? 'text-rose-700' : isPaid(c) ? 'text-emerald-700' : 'text-muted')}>{OUT[String(c.outcome)] || '—'}</td>
                      <td className="px-2.5 py-1.5 tabular-nums">{money(askedOf(c))}</td>
                      <td className="px-2.5 py-1.5 tabular-nums font-semibold">{money(receivedOf(c))}</td>
                      <td className="px-2.5 py-1.5 tabular-nums whitespace-nowrap">{when(c) || '—'}</td>
                      <td className="px-2.5 py-1.5">{c.payment_verified ? 'Yes' : 'No'}</td>
                      <td className="px-2.5 py-1.5">{c.owner_adjusted ? 'Yes' : 'No'}</td>
                      <td className="px-2.5 py-1.5">{c.stage === 'closed' ? 'Closed' : 'Open'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
