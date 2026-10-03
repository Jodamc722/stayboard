'use client'
// ID & DEPOSITS — the desk (Jon, 2026-10-03). Every arrival whose channel rule asks for an ID check
// or a security deposit, with what we hold: the ID photo and selfie the guest sent through the link
// (viewed through 10-minute signed links, every view logged), when it was captured and how; the
// deposit's amount, method, reference, proof, capture time and release date. Plus the rules
// themselves, editable per channel by an admin ("allow us to customize the rules").
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, Copy, ExternalLink, Eye, Loader2, Send, Shield, Upload, X, Undo2, Settings2, RefreshCw } from 'lucide-react'
import { Tag, Pill } from '@/components/lean'
import type { GuestCheckRow } from '@/app/api/guest-checks/route'
import { CHANNELS, DEPOSIT_METHODS, type Channel, type ChannelRule } from '@/lib/welcome-call-guide'
import { TASK_GHOST, TASK_DARK } from '@/components/task/TaskActions'

const API = '/api/guest-checks'
const fmtAt = (s?: string | null) => s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : ''
const fmtDay = (s?: string | null) => s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
const money = (n?: number | null) => n == null ? '' : '$' + Math.round(n).toLocaleString()
const methodLabel = (k?: string | null) => DEPOSIT_METHODS.find(m => m.key === (k || ''))?.label || (k || '')
const field = 'rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-brand-400'

export function GuestChecksDesk({ embed }: { embed?: boolean }) {
  const [days, setDays] = useState(7)
  const [data, setData] = useState<{ ok?: boolean; today?: string; rows?: GuestCheckRow[]; needed?: number; done?: number; releaseDue?: number; canEdit?: boolean; isAdmin?: boolean; rules?: Record<Channel, ChannelRule>; error?: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [only, setOnly] = useState<'open' | 'all' | 'release'>('open')
  const [rulesOpen, setRulesOpen] = useState(false)
  const [depFor, setDepFor] = useState<string | null>(null)
  const [viewer, setViewer] = useState<{ url: string; title: string; isPdf?: boolean } | null>(null)

  const load = useCallback(async () => {
    try { const j = await fetch(API + '?days=' + days, { cache: 'no-store' }).then(r => r.json()); setData(j); if (!j.ok) setErr(j.error || 'Could not load.') } catch (e: any) { setErr(String(e?.message || e)) }
  }, [days])
  useEffect(() => { load() }, [load])

  const post = async (rid: string, patch: Record<string, any>, ok?: string) => {
    setBusy(rid); setErr(''); setMsg('')
    try {
      const j = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: rid, ...patch }) }).then(r => r.json())
      if (!j.ok) throw new Error(j.error || 'Could not save.')
      if (ok) setMsg(ok); await load()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  const view = async (rid: string, which: 'id' | 'selfie' | 'proof', title: string) => {
    setErr('')
    try {
      const j = await fetch(API + '/photo?rid=' + encodeURIComponent(rid) + '&which=' + which, { cache: 'no-store' }).then(r => r.json())
      if (!j.ok) throw new Error(j.error || 'Nothing on file.')
      setViewer({ url: j.url, title, isPdf: /\.pdf(\?|$)/i.test(j.url) })
    } catch (e: any) { setErr(String(e?.message || e)) }
  }
  const sendLink = async (r: GuestCheckRow) => {
    setBusy(r.reservationId); setErr(''); setMsg('')
    try {
      const j = await fetch(API + '/send-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: r.reservationId }) }).then(x => x.json())
      if (j.ok) { setMsg('Link sent to ' + r.guest + ' on their ' + r.channel + ' thread.'); await load() }
      else if (j.noThread && j.url) { await copyLink(r, j.url); setErr('No message thread for this booking yet — the link is copied, send it by text or email.') }
      else throw new Error(j.error || 'Could not send.')
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  const copyLink = async (r: GuestCheckRow, url?: string) => {
    const u = url || r.verifyUrl || ''
    if (!u) return
    try { await navigator.clipboard.writeText(u); setMsg('Verification link copied for ' + r.guest + '.') } catch { window.prompt('Copy the link:', u) }
    await post(r.reservationId, { link_sent_via: 'copied' })
  }
  const uploadProof = async (rid: string, f: File | undefined) => {
    if (!f) return
    setBusy(rid); setErr('')
    try {
      const fd = new FormData(); fd.append('file', f); fd.append('reservationId', rid)
      const j = await fetch(API + '/proof', { method: 'POST', body: fd }).then(r => r.json())
      if (!j.ok) throw new Error(j.error || 'Upload failed.')
      setMsg('Proof attached.'); await load()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }

  const rows = data?.rows || []
  const today = data?.today || ''
  const isOpen = (r: GuestCheckRow) => (r.needId && r.idStatus === 'pending') || (r.needDeposit && r.depositStatus === 'pending')
  const releaseDue = (r: GuestCheckRow) => r.depositStatus === 'captured' && !!r.depositReleaseDue && r.depositReleaseDue <= today
  const shown = useMemo(() => rows.filter(r => only === 'all' ? true : only === 'release' ? releaseDue(r) || (r.depositStatus === 'captured' && r.checkOut <= today) : isOpen(r) || releaseDue(r)), [rows, only, today])
  const nOpen = rows.filter(isOpen).length, nRelease = rows.filter(releaseDue).length
  const can = !!data?.canEdit

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Pill tone={nOpen ? 'amber' : 'emerald'} title="ID checks and deposits still owed on arrivals in the window">{nOpen} open</Pill>
        <Pill tone={nRelease ? 'rose' : 'slate'} title="Deposits held past their release date">{nRelease} to release</Pill>
        <Pill title="Checks done against checks owed">{data?.done ?? 0} of {data?.needed ?? 0} done</Pill>
        <span className="grow" />
        <div className="inline-flex rounded-lg border border-line overflow-hidden text-[12px]">
          {([['open', 'Open'], ['release', 'Deposits held'], ['all', 'All']] as const).map(([k, l]) => <button key={k} onClick={() => setOnly(k)} className={'px-2.5 py-1 font-semibold border-l border-line first:border-l-0 ' + (only === k ? 'bg-ink text-white' : 'bg-white text-muted')}>{l}</button>)}
        </div>
        <select value={days} onChange={e => setDays(Number(e.target.value))} className={field + ' py-1 text-[12px]'}>
          {[7, 14, 30].map(n => <option key={n} value={n}>next {n} days</option>)}
        </select>
        {data?.isAdmin && <button onClick={() => setRulesOpen(o => !o)} className={TASK_GHOST + (rulesOpen ? ' !bg-ink !text-white' : '')} title="Which channels need an ID check or a deposit, how much, how it is collected"><Settings2 size={13} /> Rules</button>}
        <button onClick={load} className={TASK_GHOST} title="Reload"><RefreshCw size={13} /></button>
      </div>
      {rulesOpen && data?.rules && <RulesPanel rules={data.rules} onSaved={() => { load() }} />}
      {err && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{err}</p>}
      {msg && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">{msg}</p>}
      {!data && <div className="rounded-2xl border border-line bg-white p-8 text-center text-[13px] text-muted">Loading…</div>}
      {data && shown.length === 0 && <div className="rounded-2xl border border-line bg-white p-8 text-center text-[13px] text-muted">{only === 'open' ? 'Nothing owed — every ID check and deposit in the window is done.' : 'Nothing here.'}</div>}
      {shown.length > 0 && (
        <div className="rounded-2xl border border-line bg-white divide-y divide-line overflow-hidden">
          {shown.map(r => {
            const idOpen = r.needId && r.idStatus === 'pending', depOpen = r.needDeposit && r.depositStatus === 'pending'
            const b = busy === r.reservationId
            return (
              <div key={r.reservationId} className={'px-3 sm:px-4 py-3 ' + ((idOpen || depOpen) && r.today ? 'bg-rose-50/40' : '')}>
                <div className="flex items-start gap-2 flex-wrap">
                  <div className="min-w-0 grow basis-56">
                    <div className="text-[13.5px] font-bold text-ink truncate">{r.guest} <span className="font-semibold text-muted">· {r.unit}</span></div>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <Tag>{r.channel}</Tag>
                      <Tag tone={r.today ? 'amber' : r.inHouse ? 'sky' : 'slate'}>{r.today ? 'arrives today' : r.inHouse ? 'in-house · out ' + fmtDay(r.checkOut) : r.checkIn < today ? 'left ' + fmtDay(r.checkOut) : 'arrives ' + fmtDay(r.checkIn)}</Tag>
                      {r.needId && (r.idStatus === 'verified'
                        ? <Tag tone="emerald" title={'Captured ' + fmtAt(r.idCapturedAt) + (r.idName ? ' · ' + r.idName : '')}>ID verified · {r.idMethod === 'link' ? 'guest link' : r.idMethod === 'salato' ? 'Salato iPad' : 'by the desk'} · {fmtAt(r.idCapturedAt) || '—'}</Tag>
                        : r.idStatus === 'waived' ? <Tag>ID waived</Tag>
                        : <Tag tone="amber">{r.idLinkSentAt ? 'link sent ' + fmtAt(r.idLinkSentAt) + (r.idLinkSentVia === 'guesty' ? ' on ' + r.channel : ' (copied)') + ' · waiting' : 'ID to verify'}</Tag>)}
                      {r.needDeposit && (r.depositStatus === 'captured'
                        ? <Tag tone={releaseDue(r) ? 'rose' : 'emerald'} title={'Captured ' + fmtAt(r.depositCapturedAt) + (r.depositCapturedBy ? ' by ' + r.depositCapturedBy.split('@')[0] : '')}>deposit {money(r.depositAmount) || 'held'}{r.depositMethod ? ' · ' + methodLabel(r.depositMethod) : ''} · {fmtAt(r.depositCapturedAt)}{r.depositReleaseDue ? (releaseDue(r) ? ' · RELEASE DUE ' : ' · release ') + fmtDay(r.depositReleaseDue) : ''}</Tag>
                        : r.depositStatus === 'released' ? <Tag tone="slate">deposit released {fmtAt(r.depositReleasedAt)}</Tag>
                        : r.depositStatus === 'claimed' ? <Tag tone="violet">deposit claimed</Tag>
                        : r.depositStatus === 'waived' ? <Tag>deposit waived</Tag>
                        : <Tag tone="amber">deposit to collect{r.rule.depositAmount ? ' · ' + money(r.rule.depositAmount) : ''}{r.rule.depositMethod ? ' · ' + methodLabel(r.rule.depositMethod) : ''}</Tag>)}
                    </div>
                    {(r.note || r.depositRef || r.idName) && <div className="mt-1 text-[11.5px] text-muted truncate">{[r.idName ? 'ID: ' + r.idName : '', r.depositRef ? 'ref ' + r.depositRef : '', r.note].filter(Boolean).join(' · ')}</div>}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {r.hasIdPhoto && <button onClick={() => view(r.reservationId, 'id', r.guest + ' — ID')} className={TASK_GHOST} title="Opens a 10-minute link; the view is logged"><Eye size={12} /> ID</button>}
                    {r.hasSelfie && <button onClick={() => view(r.reservationId, 'selfie', r.guest + ' — selfie')} className={TASK_GHOST} title="Opens a 10-minute link; the view is logged"><Eye size={12} /> Selfie</button>}
                    {r.hasDepositProof && <button onClick={() => view(r.reservationId, 'proof', r.guest + ' — deposit proof')} className={TASK_GHOST}><Eye size={12} /> Proof</button>}
                    {r.salatoVerified && <Link href="/vault" className={TASK_GHOST} title="Salato verification record (Vault → Records)"><Shield size={12} /> Record</Link>}
                    {can && idOpen && <button onClick={() => sendLink(r)} disabled={b} className={TASK_DARK} title="Message the guest the verification link on their booking thread">{b ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} {r.idLinkSentAt ? 'Send again' : 'Send ID link'}</button>}
                    {can && idOpen && r.verifyUrl && <button onClick={() => copyLink(r)} disabled={b} className={TASK_GHOST} title="Copy the link to send by text or email"><Copy size={12} /></button>}
                    {can && idOpen && <button onClick={() => { const n = window.prompt('Name as it reads on the ID (seen in person):', r.guest); if (n === null) return; post(r.reservationId, { id_status: 'verified', id_method: 'manual', id_name: n }, 'ID marked verified.') }} disabled={b} className={TASK_GHOST} title="Checked in person, no photo"><Check size={12} /> Seen it</button>}
                    {can && depOpen && <button onClick={() => setDepFor(depFor === r.reservationId ? null : r.reservationId)} className={TASK_DARK}><Check size={12} /> Deposit captured</button>}
                    {can && r.depositStatus === 'captured' && <button onClick={() => post(r.reservationId, { deposit_status: 'released' }, 'Deposit marked released.')} disabled={b} className={releaseDue(r) ? TASK_DARK : TASK_GHOST} title="The hold was released / refunded"><Undo2 size={12} /> Released</button>}
                    {can && r.depositStatus === 'captured' && <button onClick={() => post(r.reservationId, { deposit_status: 'claimed' }, 'Deposit marked claimed — open a claim on the Claims desk.')} disabled={b} className={TASK_GHOST} title="We kept some or all of it for damage">Claimed</button>}
                    {can && r.depositStatus === 'captured' && (
                      <label className={TASK_GHOST + ' cursor-pointer'} title="Attach the hold / authorization screenshot or receipt"><Upload size={12} /><input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { uploadProof(r.reservationId, e.target.files?.[0]); e.target.value = '' }} /></label>
                    )}
                    {can && (idOpen || depOpen) && <button onClick={() => post(r.reservationId, idOpen ? { id_status: 'waived' } : { deposit_status: 'waived' }, 'Waived.')} disabled={b} className={TASK_GHOST} title={idOpen ? 'No ID check for this stay' : 'No deposit for this stay'}>Waive</button>}
                    {can && (r.idStatus !== 'pending' && r.needId && !r.salatoVerified) && <button onClick={() => post(r.reservationId, { id_status: 'pending' }, 'ID reopened.')} disabled={b} className={TASK_GHOST} title="Reopen the ID check (keeps the photos on file)"><X size={12} /></button>}
                    <Link href={'/reservations/' + encodeURIComponent(r.reservationId)} prefetch={false} className={TASK_GHOST} title="Open the booking"><ExternalLink size={12} /></Link>
                  </div>
                </div>
                {depFor === r.reservationId && can && (
                  <DepositForm r={r} busy={b} onCancel={() => setDepFor(null)} onSave={async (p) => { await post(r.reservationId, { deposit_status: 'captured', ...p }, 'Deposit captured — ' + (p.deposit_amount ? money(Number(p.deposit_amount)) : 'held') + '.'); setDepFor(null) }} />
                )}
              </div>
            )
          })}
        </div>
      )}
      {!embed && <p className="text-[11.5px] text-muted px-1">The guest's link captures a photo of their ID and a selfie on their phone (private bucket, 10-minute signed views, each view logged). "Seen it" is for an ID checked in person. A deposit's release date is check-out plus the channel rule's days unless you type one.</p>}
      {viewer && (
        <div className="fixed inset-0 z-[80] bg-ink/70 flex items-center justify-center p-3" onClick={() => setViewer(null)}>
          <div className="max-w-3xl w-full rounded-2xl bg-white p-3 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2"><span className="text-[13px] font-bold text-ink">{viewer.title}</span><span className="text-[11px] text-muted">· this view is logged · link dies in 10 min</span><span className="grow" /><a href={viewer.url} target="_blank" rel="noreferrer" className={TASK_GHOST}><ExternalLink size={12} /></a><button onClick={() => setViewer(null)} className={TASK_GHOST}><X size={12} /></button></div>
            {viewer.isPdf ? <iframe src={viewer.url} className="w-full h-[70vh] rounded-xl border border-line" /> : <img src={viewer.url} alt="" className="max-h-[75vh] w-auto mx-auto rounded-xl" />}
          </div>
        </div>
      )}
    </div>
  )
}

function DepositForm({ r, busy, onSave, onCancel }: { r: GuestCheckRow; busy: boolean; onSave: (p: Record<string, any>) => void; onCancel: () => void }) {
  const [amount, setAmount] = useState(r.depositAmount != null ? String(r.depositAmount) : (r.rule.depositAmount ? String(r.rule.depositAmount) : ''))
  const [method, setMethod] = useState(r.depositMethod || r.rule.depositMethod || '')
  const [ref, setRef] = useState(r.depositRef || '')
  const [due, setDue] = useState(r.depositReleaseDue || '')
  const [when, setWhen] = useState('')
  return (
    <form onSubmit={e => { e.preventDefault(); onSave({ deposit_amount: amount, deposit_method: method, deposit_ref: ref, deposit_release_due: due || undefined, deposit_captured_at: when ? new Date(when).toISOString() : undefined }) }}
      className="mt-2 ml-0 sm:ml-1 flex items-end gap-2 flex-wrap rounded-xl border border-line bg-app/50 p-2.5">
      <label className="text-[11px] font-semibold text-muted">Amount<br /><input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="500" className={field + ' w-24'} /></label>
      <label className="text-[11px] font-semibold text-muted">How<br /><select value={method} onChange={e => setMethod(e.target.value)} className={field}>{DEPOSIT_METHODS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select></label>
      <label className="text-[11px] font-semibold text-muted">Reference<br /><input value={ref} onChange={e => setRef(e.target.value)} placeholder="hold / auth id" className={field + ' w-36'} /></label>
      <label className="text-[11px] font-semibold text-muted">Captured<br /><input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} className={field} title="Leave empty for now" /></label>
      <label className="text-[11px] font-semibold text-muted">Release on<br /><input type="date" value={due} onChange={e => setDue(e.target.value)} className={field} title={'Empty = check-out + ' + r.rule.releaseDays + ' days'} /></label>
      <button type="submit" disabled={busy} className={TASK_DARK}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save</button>
      <button type="button" onClick={onCancel} className={TASK_GHOST}>Cancel</button>
    </form>
  )
}

/** The rules, one row per channel. Admins edit; saves on Save. */
function RulesPanel({ rules, onSaved }: { rules: Record<Channel, ChannelRule>; onSaved: () => void }) {
  const [draft, setDraft] = useState<Record<Channel, ChannelRule>>(() => JSON.parse(JSON.stringify(rules)))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const set = (ch: Channel, k: keyof ChannelRule, v: any) => setDraft(d => ({ ...d, [ch]: { ...d[ch], [k]: v } }))
  const save = async () => {
    setBusy(true); setMsg('')
    try { const j = await fetch(API + '/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: draft }) }).then(r => r.json()); if (!j.ok) throw new Error(j.error || 'Could not save.'); setMsg('Rules saved — the desk and the call scripts use them from now.'); onSaved() }
    catch (e: any) { setMsg(String(e?.message || e)) }
    setBusy(false)
  }
  return (
    <div className="rounded-2xl border border-line bg-white p-3 sm:p-4">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-[13px] font-bold text-ink">Rules by channel</span>
        <span className="text-[11.5px] text-muted">what we ask for before an arrival, and how a deposit is taken and returned</span>
        <span className="grow" />
        <button onClick={save} disabled={busy} className={TASK_DARK}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save rules</button>
      </div>
      {msg && <p className="text-[12.5px] font-semibold text-emerald-800 mb-2">{msg}</p>}
      <div className="lh-hscroll overflow-x-auto">
        <table className="min-w-[760px] w-full text-[12.5px]">
          <thead><tr className="text-left text-[10.5px] uppercase tracking-wide text-muted"><th className="py-1 pr-2">Channel</th><th className="py-1 pr-2">Verify ID</th><th className="py-1 pr-2">Deposit</th><th className="py-1 pr-2">Amount</th><th className="py-1 pr-2">How</th><th className="py-1 pr-2">Release after</th><th className="py-1 pr-2">Platform pays us</th><th className="py-1">Note for the desk</th></tr></thead>
          <tbody>
            {CHANNELS.map(ch => { const r = draft[ch]; return (
              <tr key={ch} className="border-t border-line">
                <td className="py-1.5 pr-2 font-semibold text-ink whitespace-nowrap">{ch}</td>
                <td className="py-1.5 pr-2"><input type="checkbox" checked={r.verify} onChange={e => set(ch, 'verify', e.target.checked)} /></td>
                <td className="py-1.5 pr-2"><input type="checkbox" checked={r.deposit} onChange={e => set(ch, 'deposit', e.target.checked)} /></td>
                <td className="py-1.5 pr-2"><input value={r.depositAmount || ''} onChange={e => set(ch, 'depositAmount', Number(e.target.value.replace(/[^\d]/g, '')) || 0)} inputMode="numeric" placeholder="per listing" disabled={!r.deposit} className={field + ' w-24 py-1'} /></td>
                <td className="py-1.5 pr-2"><select value={r.depositMethod} onChange={e => set(ch, 'depositMethod', e.target.value)} disabled={!r.deposit} className={field + ' py-1'}>{DEPOSIT_METHODS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select></td>
                <td className="py-1.5 pr-2 whitespace-nowrap"><input value={r.releaseDays} onChange={e => set(ch, 'releaseDays', Number(e.target.value.replace(/[^\d]/g, '')) || 0)} inputMode="numeric" disabled={!r.deposit} className={field + ' w-14 py-1'} /> days</td>
                <td className="py-1.5 pr-2"><input type="checkbox" checked={r.merchantOfRecord} onChange={e => set(ch, 'merchantOfRecord', e.target.checked)} title="The platform collects the stay payment" /></td>
                <td className="py-1.5"><input value={r.note} onChange={e => set(ch, 'note', e.target.value)} className={field + ' w-full min-w-[220px] py-1'} /></td>
              </tr>
            ) })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
