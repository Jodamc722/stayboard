'use client'
// CLEANING INVOICES (lib/clean-invoices). Upload → the lines read off the invoice → each matched to a
// clean on record → the flags first → approve or dispute. Prices are not judged here.
// Two models since 2026-11-25 (lib/clean-invoice-rules): per clean (Breezeway and the checkouts) and
// by the hour (Homebase). The same page shows both; the columns change with the model.
import { useEffect, useRef, useState } from 'react'
import { Upload, Loader2, FileText, Check, AlertTriangle, RotateCcw, Trash2, ExternalLink, ArrowLeft, Mail, Copy, RefreshCw } from 'lucide-react'
import { Tag, LeanEmpty, type Tone } from '@/components/lean'

import { VERDICT_LABEL, isOk, isFlagged } from '@/lib/clean-invoice-rules'

/** Green is fine as billed, red is a flag, amber is a flag that is usually a name or a date, grey is shown and not flagged. */
const AMBER = ['date_off', 'unknown_unit', 'unknown_person', 'hours_under']
const vt = (v: string): { label: string; tone: Tone } => ({
  label: (VERDICT_LABEL as Record<string, string>)[v] || v,
  tone: isOk(v) ? 'emerald' : AMBER.includes(v) ? 'amber' : isFlagged(v) ? 'rose' : 'slate',
})
const atStake = (l: any) => (l.risk != null ? l.risk : l.amount) || 0
const ST: Record<string, { label: string; tone: Tone }> = { review: { label: 'To review', tone: 'amber' }, approved: { label: 'Approved', tone: 'emerald' }, disputed: { label: 'Disputed', tone: 'rose' } }
const money = (n: number | null | undefined) => n == null ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = (s?: string | null) => s ? new Date(s.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'

export function CleanInvoices() {
  const [rows, setRows] = useState<any[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [vendor, setVendor] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const load = () => fetch('/api/clean-invoices', { cache: 'no-store' }).then(r => r.json()).then(j => setRows(j.invoices || [])).catch(() => setRows([]))
  useEffect(() => { load(); try { const id = new URL(location.href).searchParams.get('id'); if (id) setOpen(id) } catch {} }, [])
  const go = (id: string | null) => { setOpen(id); try { const u = new URL(location.href); id ? u.searchParams.set('id', id) : u.searchParams.delete('id'); history.replaceState(null, '', u.toString()) } catch {} ; if (!id) load() }

  const upload = async (f: File) => {
    setBusy(true); setErr('')
    const fd = new FormData(); fd.append('file', f); if (vendor.trim()) fd.append('vendor', vendor.trim())
    const j = await fetch('/api/clean-invoices', { method: 'POST', body: fd }).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }))
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
    if (!j.ok) { setErr(j.error || 'Could not read that invoice.'); return }
    setVendor(''); go(j.invoice.id)
  }

  if (open) return <InvoiceView id={open} onBack={() => go(null)} />
  return (
    <div>
      <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-[26px] leading-tight text-ink">Cleaning invoices</h1>
          <p className="text-[13px] text-muted mt-0.5">Upload a vendor’s invoice. An invoice billed per clean is checked against the cleans in Breezeway and the checkouts; one billed by the hour is checked against the hours in Homebase. Anything that doesn’t match is flagged before it’s paid.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-line bg-white p-5 flex items-center gap-3 flex-wrap"
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && !busy) upload(f) }}>
        <Upload size={18} className="text-muted" />
        <div className="flex-1 min-w-[220px]">
          <div className="text-[13.5px] font-semibold text-ink">Drop an invoice here, or choose the file</div>
          <div className="text-[12px] text-muted">PDF, photo or spreadsheet (CSV). Reading and checking takes about a minute.</div>
        </div>
        <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Vendor (optional — read from the invoice)" className="h-9 w-64 rounded-lg border border-line px-3 text-[13px]" />
        <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }} />
        <button onClick={() => fileRef.current?.click()} disabled={busy} className="h-9 px-4 rounded-lg bg-ink text-white text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <><Loader2 size={14} className="animate-spin" /> Reading & checking…</> : <><FileText size={14} /> Choose invoice</>}
        </button>
        {err ? <p className="w-full text-[12.5px] text-rose-700">{err}</p> : null}
      </div>

      <InvoiceMail onNew={load} />

      <div className="mt-5">
        {!rows ? <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
          : !rows.length ? <LeanEmpty>No invoices yet. Upload the first one above.</LeanEmpty>
          : (
          <div className="rounded-2xl border border-line bg-white overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-[10.5px] uppercase tracking-wider text-muted"><tr className="border-b border-line">{['Vendor', 'Invoice', 'Period', 'Lines', 'Matched', 'Flagged', 'Total', 'Status', 'Uploaded'].map(h => <th key={h} className={'px-3 py-2 font-semibold ' + (['Lines', 'Matched', 'Flagged', 'Total'].includes(h) ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
              <tbody>{rows.map(r => (
                <tr key={r.id} onClick={() => go(r.id)} className="border-b border-line/60 last:border-0 cursor-pointer hover:bg-app/60">
                  <td className="px-3 py-2 font-semibold text-ink">{r.vendor}<span className="ml-2 font-normal text-[11.5px] text-muted">{r.model === 'hours' ? 'by the hour' : 'per clean'}</span></td>
                  <td className="px-3 py-2 text-muted">{r.number ? '#' + r.number : '—'}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{r.periodFrom || r.periodTo ? `${day(r.periodFrom)} – ${day(r.periodTo)}` : day(r.invoiceDate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.lines}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{r.matched}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.flagged ? <span className="text-rose-700 font-semibold">{r.flagged}{r.flaggedAmount ? ` · ${money(r.flaggedAmount)}` : ''}</span> : <span className="text-muted">0</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.total)}</td>
                  <td className="px-3 py-2"><Tag tone={ST[r.status]?.tone}>{ST[r.status]?.label || r.status}</Tag></td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{day(r.uploadedAt)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// INVOICES BY EMAIL (Jon, 2026-11-23; lib/clean-invoice-mail). One line: the address to send or cc an
// invoice to, the switch, and what came in lately. Someone at Stay gets the audit back as a reply; an
// outside sender gets a short "received" note and the audit goes to Jon.
function InvoiceMail({ onNew }: { onNew: () => void }) {
  const [m, setM] = useState<any>(null)
  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState('')
  const load = () => fetch('/api/clean-invoices?mail=1', { cache: 'no-store' }).then(r => r.json()).then(j => { if (j.ok) setM(j) }).catch(() => {})
  useEffect(() => { load() }, [])
  if (!m) return null
  const post = async (op: string) => {
    setBusy(op); setMsg('')
    const j = await fetch('/api/clean-invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op }) }).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }))
    setBusy('')
    if (op === 'mail-scan') {
      const n = (j.handled || []).filter((h: any) => h.invoices?.length).length
      setMsg(j.error ? j.error : j.note ? 'Not run: ' + j.note + '.' : n ? `Read ${n} email${n === 1 ? '' : 's'}.` : 'Nothing new in the mailbox.')
      if (n) onNew()
    } else if (!j.ok) setMsg(j.error || 'That did not save.')
    load()
  }
  const copy = () => { try { navigator.clipboard.writeText(m.address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {}) } catch {} }
  const when = (s?: string | null) => s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : ''
  const seg = (on: boolean) => 'px-2.5 h-8 text-[12px] font-semibold ' + (on ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink')
  return (
    <div className="mt-3 rounded-2xl border border-line bg-white">
      <div className="px-4 py-3 flex items-center gap-x-3 gap-y-2 flex-wrap">
        <Mail size={16} className="text-muted shrink-0" />
        <div className="flex-1 min-w-[240px]">
          <div className="text-[13.5px] font-semibold text-ink">Or email it: <span className="select-all font-mono text-[13px]">{m.address}</span></div>
          <div className="text-[12px] text-muted">Send or cc an invoice (PDF, photo or CSV) and the audit comes back as a reply. A vendor who emails it gets a short “received” note; the audit goes to {m.mailbox}.</div>
        </div>
        <button onClick={copy} title="Copy the address" className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold text-ink inline-flex items-center gap-1.5 hover:bg-app">{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}</button>
        {m.canSwitch ? (
          <>
            <div className="inline-flex rounded-lg border border-line overflow-hidden" role="radiogroup" title="When on, the mailbox is checked every 10 minutes and replies go out on their own">
              <button role="radio" aria-checked={!m.on} disabled={!!busy} onClick={() => m.on && post('mail-off')} className={seg(!m.on)}>Off</button>
              <button role="radio" aria-checked={!!m.on} disabled={!!busy} onClick={() => !m.on && post('mail-on')} className={seg(!!m.on) + ' border-l border-line'}>On</button>
            </div>
            <button onClick={() => post('mail-scan')} disabled={!!busy} title="Read the mailbox once, now, whether or not the switch is on. Takes about a minute per invoice." className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold text-ink inline-flex items-center gap-1.5 hover:bg-app disabled:opacity-50">
              {busy === 'mail-scan' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {busy === 'mail-scan' ? 'Reading…' : 'Check now'}
            </button>
          </>
        ) : <Tag tone={m.on ? 'emerald' : 'slate'}>{m.on ? 'on' : 'off'}</Tag>}
      </div>
      {/* The one thing that has to be true first: Lighthouse may read the mailbox. Only the mailbox's owner can allow it. */}
      {m.ready === false ? (
        <div className="mx-4 mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 flex items-center gap-2 flex-wrap">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="flex-1 min-w-[200px]">{m.notReady || 'Lighthouse cannot read the mailbox yet.'} Nothing is read until it is allowed. Sign in to Lighthouse as {m.mailbox}, then:</span>
          <a href={'/api/google/auth?scopes=read&mailbox=' + encodeURIComponent(m.mailbox)} target="_blank" rel="noreferrer" className="h-8 px-2.5 rounded-lg bg-ink text-white text-[12px] font-semibold inline-flex items-center">Allow reading</a>
        </div>
      ) : null}
      {(msg || m.lastError || m.lastRun) ? (
        <div className="px-4 pb-2 -mt-1 text-[12px]">
          {msg ? <span className="text-ink">{msg} </span> : null}
          {m.lastError ? <span className="text-rose-700">{m.lastError} </span> : null}
          {m.lastRun ? <span className="text-muted">Last checked {when(m.lastRun)}.</span> : null}
        </div>
      ) : null}
      {(m.recent || []).length ? (
        <ul className="border-t border-line/70 divide-y divide-line/60">
          {m.recent.map((h: any) => (
            <li key={h.id} className="px-4 py-1.5 flex items-center gap-2 flex-wrap text-[12.5px]">
              <span className="text-muted whitespace-nowrap">{when(h.at)}</span>
              <span className="font-semibold text-ink">{h.from}</span>
              <span className="text-muted truncate max-w-[18rem]">{h.subject}</span>
              <span className="text-ink">{h.headline}</span>
              {h.invoices?.length ? <Tag tone={h.replied ? 'slate' : 'rose'} title={h.error || undefined}>{h.replied ? (h.team ? 'audit sent back' : 'receipt sent · audit to Jon') : 'reply failed'}</Tag> : null}
              {(h.invoices || []).map((id: string) => <a key={id} href={'/clean-invoices?id=' + id} className="text-brand-700 font-semibold hover:underline">Open</a>)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function InvoiceView({ id, onBack }: { id: string; onBack: () => void }) {
  const [d, setD] = useState<any>(null)
  const [only, setOnly] = useState<'flagged' | 'all'>('flagged')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  const [actErr, setActErr] = useState('')
  const load = () => fetch('/api/clean-invoices?id=' + encodeURIComponent(id), { cache: 'no-store' }).then(r => r.json()).then(j => { setD(j); if (j.invoice) setNote(j.invoice.note || '') })
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (body: any) => {
    setBusy(body.op + (body.n || ''))
    const j = await fetch('/api/clean-invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) }).then(r => r.json()).catch(() => ({}))
    setBusy('')
    if (body.op === 'delete') { onBack(); return }
    if (j.ok) { setActErr(''); setD((x: any) => ({ ...x, invoice: j.invoice })) }
    else setActErr(String(j.error || 'That did not work. Try again.'))
  }
  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
  if (!d.ok) return <div><button onClick={onBack} className="text-[13px] text-muted mb-3">← Back</button><LeanEmpty>{d.error}</LeanEmpty></div>
  const inv = d.invoice
  const hours = inv.model === 'hours'
  const flagged = inv.lines.filter((l: any) => isFlagged(l.verdict))
  const open = flagged.filter((l: any) => !l.resolved)
  const shown = only === 'flagged' ? flagged : inv.lines
  const billed = inv.lines.reduce((a: number, l: any) => a + (l.amount || 0), 0)
  const atRisk = open.reduce((a: number, l: any) => a + atStake(l), 0)
  const unchecked = inv.lines.filter((l: any) => l.verdict === 'unchecked').length
  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <button onClick={onBack} className="h-9 w-9 rounded-lg border border-line bg-white inline-flex items-center justify-center" aria-label="Back"><ArrowLeft size={16} /></button>
        <div className="min-w-0">
          <h1 className="text-[22px] leading-tight text-ink font-semibold">{inv.vendor}{inv.number ? <span className="text-muted font-normal"> · #{inv.number}</span> : null}</h1>
          <p className="text-[12.5px] text-muted">{inv.periodFrom || inv.periodTo ? `${day(inv.periodFrom)} – ${day(inv.periodTo)}` : `Dated ${day(inv.invoiceDate)}`} · {hours ? 'billed by the hour' : 'billed per clean'} · uploaded {day(inv.uploadedAt)}{inv.uploadedBy ? ` by ${inv.uploadedBy.split('@')[0]}` : ''} · checked {day(inv.checkedAt)}</p>
        </div>
        <Tag tone={ST[inv.status]?.tone}>{ST[inv.status]?.label}</Tag>
        <div className="flex-1" />
        {d.fileUrl ? <a href={d.fileUrl} target="_blank" rel="noopener" className="h-8 px-3 rounded-lg border border-line bg-white text-[12.5px] font-semibold inline-flex items-center gap-1.5"><ExternalLink size={13} /> Original</a> : null}
        <button onClick={() => act({ op: 'recheck' })} disabled={!!busy} title={hours ? 'Check again against the hours in Homebase now' : 'Check again against the latest cleans from Breezeway'} className="h-8 px-3 rounded-lg border border-line bg-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">{busy === 'recheck' ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Check again</button>
        {d.fileUrl ? <button onClick={() => act({ op: 'reread' })} disabled={!!busy} title="Read the original file again and check it afresh. Use it when the lines were read wrong, or an hours invoice was read as cleans." className="h-8 px-3 rounded-lg border border-line bg-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">{busy === 'reread' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Read again</button> : null}
      </div>
      {actErr ? <p className="text-[12.5px] text-rose-700 mb-3">{actErr}</p> : null}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        {[['Lines billed', String(inv.lines.length)], [hours ? 'Match Homebase' : 'Match a clean', String(inv.lines.filter((l: any) => isOk(l.verdict)).length)], ['Flagged, open', String(open.length)], ['Billed total', money(inv.total ?? billed)], ['On open flags', money(atRisk)]].map(([k, v], i) => (
          <div key={k} className={'rounded-2xl border bg-white px-4 py-3 ' + (i === 2 && open.length ? 'border-rose-200' : 'border-line')}><div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">{k}</div><div className={'text-[20px] font-semibold tabular-nums ' + (i === 2 && open.length ? 'text-rose-700' : 'text-ink')}>{v}</div></div>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <div className="inline-flex rounded-lg border border-line overflow-hidden text-[12.5px] h-8">
          {([['flagged', `Flagged (${flagged.length})`], ['all', `All lines (${inv.lines.length})`]] as const).map(([k, l]) => <button key={k} onClick={() => setOnly(k)} className={'px-3 font-semibold border-l border-line first:border-l-0 ' + (only === k ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink')}>{l}</button>)}
        </div>
      </div>
      {!shown.length ? <LeanEmpty>{only === 'flagged' ? (unchecked ? `Nothing flagged, but ${unchecked} line${unchecked === 1 ? '' : 's'} could not be checked. See All lines.` : hours ? 'Nothing flagged. Every line matches the hours in Homebase.' : 'Nothing flagged. Every line matches a finished clean.') : 'No lines read from this invoice.'}</LeanEmpty> : (
        <div className="rounded-2xl border border-line bg-white overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="text-[10.5px] uppercase tracking-wider text-muted"><tr className="border-b border-line">{(hours ? ['#', 'On the invoice', 'Hours billed', 'Amount', 'Check', 'In Homebase as', ''] : ['#', 'Date billed', 'Unit on invoice', 'Service', 'Amount', 'Check', 'Clean on record', '']).map(h => <th key={h} className={'px-3 py-2 font-semibold text-left ' + (h === 'Amount' ? 'text-right' : '')}>{h}</th>)}</tr></thead>
            <tbody>{shown.map((l: any) => (
              <tr key={l.n} className={'border-b border-line/60 last:border-0 align-top ' + (l.resolved ? 'opacity-60' : '')}>
                <td className="px-3 py-2 text-muted tabular-nums">{l.n}</td>
                {hours ? null : <td className="px-3 py-2 whitespace-nowrap">{day(l.date)}</td>}
                <td className="px-3 py-2"><div className="text-ink font-semibold">{l.unitText}</div>{!hours && l.unit && l.unit !== l.unitText ? <div className="text-muted text-[11.5px]">{l.unit}</div> : null}</td>
                <td className="px-3 py-2 text-muted">{l.service || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(l.amount)}</td>
                <td className="px-3 py-2"><Tag tone={vt(l.verdict).tone}>{vt(l.verdict).label}</Tag><div className="text-[11.5px] text-muted mt-1 max-w-[280px]">{l.why}</div>{l.resolved ? <div className="text-[11.5px] text-emerald-700 mt-1">Cleared by {String(l.resolved.by).split('@')[0]}{l.resolved.note ? `: ${l.resolved.note}` : ''}</div> : null}</td>
                <td className="px-3 py-2 text-[11.5px]">{hours ? (l.unit || <span className="text-muted">—</span>) : l.clean ? <><div>{day(l.clean.finishedAt || l.clean.date)} · {l.clean.status}</div><div className="text-muted">{l.clean.cleaner || ''}</div>{l.clean.report ? <a href={l.clean.report} target="_blank" rel="noopener" className="text-brand-700 underline">Breezeway report</a> : null}</> : <span className="text-muted">—</span>}</td>
                <td className="px-3 py-2 whitespace-nowrap">{isFlagged(l.verdict) ? (l.resolved
                  ? <button onClick={() => act({ op: 'resolve', n: l.n, clear: true })} className="text-[11.5px] text-muted underline">Undo</button>
                  : <button onClick={() => { const n = window.prompt('Why is this line OK? (optional)') ; if (n !== null) act({ op: 'resolve', n: l.n, note: n }) }} className="h-7 px-2 rounded-md border border-line bg-white text-[11.5px] font-semibold inline-flex items-center gap-1"><Check size={12} /> Clear flag</button>) : null}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}

      {inv.unbilled.length ? (
        <div className="mt-5">
          <h2 className="text-[14px] font-semibold text-ink">{hours ? 'Worked in the period, not on this invoice' : 'Cleans on record not on this invoice'} <span className="text-muted font-normal text-[12.5px]">{hours ? '— people Lighthouse has under this agency; for reference, not flagged' : '— same units, same period; for reference, not flagged'}</span></h2>
          <div className="flex flex-wrap gap-1.5 mt-2">{inv.unbilled.map((u: any) => <Tag key={u.taskId} title={(u.name || '') + (u.cleaner ? ' · ' + u.cleaner : '')}>{u.unit} · {hours ? u.name : day(u.date)}</Tag>)}</div>
        </div>
      ) : null}

      <div className="mt-6 rounded-2xl border border-line bg-white p-4">
        <div className="text-[13px] font-semibold text-ink mb-1.5">Decision</div>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Note for the record or for the vendor (what to correct)…" className="w-full rounded-lg border border-line px-3 py-2 text-[13px]" />
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <button onClick={() => act({ op: 'approve', note })} disabled={!!busy} className="h-9 px-4 rounded-lg bg-emerald-700 text-white text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"><Check size={14} /> Approve{open.length ? ` with ${open.length} open flag${open.length === 1 ? '' : 's'}` : ''}</button>
          <button onClick={() => act({ op: 'dispute', note })} disabled={!!busy} className="h-9 px-4 rounded-lg bg-rose-700 text-white text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"><AlertTriangle size={14} /> Dispute</button>
          {inv.status !== 'review' ? <button onClick={() => act({ op: 'reopen' })} className="h-9 px-3 rounded-lg border border-line bg-white text-[13px]">Reopen</button> : null}
          <div className="flex-1" />
          {inv.reviewedBy ? <span className="text-[12px] text-muted">{ST[inv.status]?.label} by {inv.reviewedBy.split('@')[0]} · {day(inv.reviewedAt)}</span> : null}
          <button onClick={() => { if (window.confirm('Delete this invoice and its check?')) act({ op: 'delete' }) }} className="h-9 w-9 rounded-lg border border-line bg-white inline-flex items-center justify-center text-muted hover:text-rose-700" aria-label="Delete"><Trash2 size={14} /></button>
        </div>
      </div>
    </div>
  )
}
