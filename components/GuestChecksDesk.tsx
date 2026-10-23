'use client'
// ID & DEPOSITS — the desk (Jon, 2026-10-03). Every arrival whose channel rule asks for an ID check
// or a security deposit, with what we hold: the ID photo and selfie the guest sent through the link
// (viewed through 10-minute signed links, every view logged), when it was captured and how; the
// deposit's amount, method, reference, proof, capture time and release date. Plus the rules
// themselves, editable per channel by an admin ("allow us to customize the rules").
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, ExternalLink, Eye, Loader2, Shield, Upload, X, Undo2, Settings2, RefreshCw, ChevronDown, Image as ImageIcon } from 'lucide-react'
import { StayPanel } from '@/components/StayPanel'
import { Tag, Pill } from '@/components/lean'
import type { GuestCheckRow } from '@/app/api/guest-checks/route'
import { CHANNELS, DEPOSIT_METHODS, type Channel, type ChannelRule } from '@/lib/welcome-call-guide'
import { TASK_GHOST, TASK_DARK } from '@/components/task/TaskActions'
import { IdTag, IdCheckWhy, IdActions, ByHandStrip, fmtAt } from '@/components/IdCheckBits'

const API = '/api/guest-checks'
const fmtDay = (s?: string | null) => s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
const money = (n?: number | null) => n == null ? '' : '$' + Math.round(n).toLocaleString()
const methodLabel = (k?: string | null) => DEPOSIT_METHODS.find(m => m.key === (k || ''))?.label || (k || '')
const field = 'rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-brand-400'

export function GuestChecksDesk({ embed }: { embed?: boolean }) {
  const [days, setDays] = useState(7)
  const [data, setData] = useState<{ ok?: boolean; today?: string; rows?: GuestCheckRow[]; needed?: number; done?: number; toCheck?: number; toVerify?: number; toRead?: number; releaseDue?: number; canEdit?: boolean; isAdmin?: boolean; rules?: Record<Channel, ChannelRule>; buildingAmounts?: Record<string, number>; error?: string; schema158?: boolean } | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [only, setOnly] = useState<'open' | 'all' | 'release'>('open')
  const [rulesOpen, setRulesOpen] = useState(false)
  const [depFor, setDepFor] = useState<string | null>(null)
  const [byHandFor, setByHandFor] = useState<string | null>(null)
  const [viewer, setViewer] = useState<{ url: string; title: string; isPdf?: boolean } | null>(null)
  const [detailsFor, setDetailsFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { const j = await fetch(API + '?days=' + days, { cache: 'no-store' }).then(r => r.json()); setData(j); if (!j.ok) setErr(j.error || 'Could not load.') } catch (e: any) { setErr(String(e?.message || e)) }
  }, [days])
  useEffect(() => { load() }, [load])
  // THE SWEEP (2026-10-21): photos verified before anything read them get read now, three per load,
  // until none are left. Once per desk open; the server only ever reads a row once.
  const swept = useRef(false)
  useEffect(() => {
    if (!data?.ok || swept.current || !data.toRead || !data.canEdit) return
    swept.current = true
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sweep: true }) }).then(r => r.json())
      .then(j => { if (j?.ok && j.checked) { setMsg(`Read ${j.checked} ID photo${j.checked === 1 ? '' : 's'} against the booking name` + (j.flagged ? ` — ${j.flagged} flagged to check` : ' — all match') + '.'); load() } })
      .catch(() => {})
  }, [data, load])

  // THE THREAD SWEEP (2026-10-23): pull the Guesty threads of the next arrivals still missing their
  // ID / selfie, so a guest who replied to the booking email with their photo shows up here. Once per open.
  const threaded = useRef(false)
  useEffect(() => {
    if (!data?.ok || threaded.current || !data.canEdit) return
    threaded.current = true
    const soon = (data.rows || []).filter(r => r.needId && !r.checklist?.complete && !r.threadPhotos?.length && !r.hasIdPhoto && r.checkIn <= addDaysYmd(data.today || '', 3)).map(r => r.reservationId).slice(0, 8)
    if (!soon.length) return
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadSweep: true, ids: soon }) }).then(r => r.json())
      .then(j => { if (j?.ok && j.pulled) load() }).catch(() => {})
  }, [data, load])
  const pullThread = async (r: GuestCheckRow) => {
    setBusy(r.reservationId); setErr(''); setMsg('')
    try {
      const j = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: r.reservationId, pullThread: true }) }).then(x => x.json())
      if (!j.ok) throw new Error(j.error || 'Could not read the thread.')
      setMsg(j.noThread ? 'No message thread for this booking in Guesty yet.' : 'Read ' + r.guest + '\'s thread from Guesty.')
      await load()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }

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

  const recheck = async (r: GuestCheckRow) => {
    setBusy(r.reservationId); setErr(''); setMsg('')
    try {
      const j = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: r.reservationId, recheck: true }) }).then(x => x.json())
      if (!j.ok) throw new Error(j.error || 'Could not read the ID.')
      setMsg(j.status === 'verified' ? `Read the ID — ${j.verdict?.nameOnId || 'the name'} matches the booking.` : `Read the ID — flagged to check: ${(j.verdict?.reasons || []).join('; ')}`)
      await load()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }

  const rows = data?.rows || []
  const today = data?.today || ''
  // A flagged photo is open work: a person still has to look (Jon: "flag to check").
  // OPEN = TO VERIFY: anything short of the ID, the selfie and the deposit this channel asks for.
  const isOpen = (r: GuestCheckRow) => r.checklist ? !r.checklist.complete : ((r.needId && (r.idStatus === 'pending' || r.idStatus === 'check')) || (r.needDeposit && r.depositStatus === 'pending' && !r.depositScheduled))
  const releaseDue = (r: GuestCheckRow) => r.depositStatus === 'captured' && !!r.depositReleaseDue && r.depositReleaseDue <= today
  const shown = useMemo(() => rows.filter(r => only === 'all' ? true : only === 'release' ? releaseDue(r) || (r.depositStatus === 'captured' && r.checkOut <= today) : isOpen(r) || releaseDue(r)), [rows, only, today])
  const nOpen = rows.filter(isOpen).length, nRelease = rows.filter(releaseDue).length
  const can = !!data?.canEdit

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Pill tone={nOpen ? 'amber' : 'emerald'} title="Arrivals still missing the ID, the selfie or the deposit their channel asks for">{nOpen} to verify</Pill>
        {!!data?.toCheck && <Pill tone="rose" title="ID photos on file that a person has to look at — the name did not match the booking, or could not be read">{data.toCheck} to check</Pill>}
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
      {rulesOpen && data?.rules && <RulesPanel rules={data.rules} buildings={data.buildingAmounts || {}} onSaved={() => { load() }} />}
      {err && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{err}</p>}
      {msg && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">{msg}</p>}
      {data?.ok && data.schema158 === false && data.isAdmin && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">Migration 158 (guest_checks: the ID reading) has not been run in Supabase yet — flags still work, but WHY a photo was flagged is not kept until it runs.</p>}
      {!data && <div className="rounded-2xl border border-line bg-white p-8 text-center text-[13px] text-muted">Loading…</div>}
      {data && shown.length === 0 && <div className="rounded-2xl border border-line bg-white p-8 text-center text-[13px] text-muted">{only === 'open' ? 'Nothing owed — every ID check and deposit in the window is done.' : 'Nothing here.'}</div>}
      {shown.length > 0 && (
        <div className="rounded-2xl border border-line bg-white divide-y divide-line overflow-hidden">
          {shown.map(r => {
            const idOpen = r.needId && (r.idStatus === 'pending' || r.idStatus === 'check'), depOpen = r.needDeposit && r.depositStatus === 'pending' && !r.depositScheduled
            const b = busy === r.reservationId
            return (
              <div key={r.reservationId} className={'px-3 sm:px-4 py-3 ' + ((idOpen || depOpen) && r.today ? 'bg-rose-50/40' : '')}>
                <div className="flex items-start gap-2 flex-wrap">
                  <div className="min-w-0 grow basis-56">
                    <div className="text-[13.5px] font-bold text-ink truncate">{r.guest} <span className="font-semibold text-muted">· {r.unit}</span></div>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <Tag>{r.channel}</Tag>
                      <Tag tone={r.today ? 'amber' : r.inHouse ? 'sky' : 'slate'}>{r.today ? 'arrives today' : r.inHouse ? 'in-house · out ' + fmtDay(r.checkOut) : r.checkIn < today ? 'left ' + fmtDay(r.checkOut) : 'arrives ' + fmtDay(r.checkIn)}</Tag>
                      <Checklist r={r} />
                      <IdTag r={r} />
                      {r.needDeposit && (r.depositStatus === 'captured'
                        ? <Tag tone={releaseDue(r) ? 'rose' : 'emerald'} title={(r.depositAuto ? 'A security deposit on the booking in Guesty — read off the booking, not typed here' : 'Captured ' + fmtAt(r.depositCapturedAt) + (r.depositCapturedBy ? ' by ' + r.depositCapturedBy.split('@')[0] : ''))}>deposit {money(r.depositAmount) || 'held'}{r.depositAuto ? ' · Guesty' : r.depositMethod ? ' · ' + methodLabel(r.depositMethod) : ''} · {fmtAt(r.depositCapturedAt)}{r.depositReleaseDue ? (releaseDue(r) ? ' · RELEASE DUE ' : ' · release ') + fmtDay(r.depositReleaseDue) : ''}</Tag>
                        : r.depositStatus === 'released' ? <Tag tone="slate">deposit released {fmtAt(r.depositReleasedAt)}</Tag>
                        : r.depositStatus === 'claimed' ? <Tag tone="violet">deposit claimed</Tag>
                        : r.depositStatus === 'waived' ? <Tag>deposit waived</Tag>
                        : r.depositScheduled ? <Tag tone="sky" title={'Guesty places the hold on the card' + (r.depositScheduled.due ? ' on ' + fmtAt(r.depositScheduled.due) : ' before arrival') + ' — nothing to do unless it fails'}>deposit scheduled in Guesty · {money(r.depositScheduled.amount)}{r.depositScheduled.due ? ' · ' + fmtDay(r.depositScheduled.due.slice(0, 10)) : ''}</Tag>
                        : <Tag tone="amber">deposit to collect{r.depositDue ? ' · ' + money(r.depositDue) : ''}{r.rule.depositMethod ? ' · ' + methodLabel(r.rule.depositMethod) : ''}</Tag>)}
                    </div>
                    {(r.note || r.depositRef || r.idName) && <div className="mt-1 text-[11.5px] text-muted truncate">{[r.idName ? 'ID: ' + r.idName : '', r.depositRef && !r.depositAuto ? 'ref ' + r.depositRef : '', r.note].filter(Boolean).join(' · ')}</div>}
                    <IdCheckWhy r={r} />
                    {r.threadPhotos?.length ? (
                      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap text-[11.5px]">
                        <span className="text-muted">On the thread:</span>
                        {r.threadPhotos.map((p, i) => p.url
                          ? <button key={i} onClick={() => setViewer({ url: p.url as string, title: r.guest + ' — photo sent ' + fmtAt(p.at), isPdf: /pdf/.test(p.type) })} className={TASK_GHOST}><ImageIcon size={12} /> {p.type || 'photo'} · {fmtAt(p.at)}</button>
                          : <Tag key={i}>{p.type || 'photo'} · {fmtAt(p.at)}</Tag>)}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <IdActions r={r} canEdit={can} busy={b} ghost={TASK_GHOST} dark={TASK_DARK}
                      onPatch={(patch, ok) => post(r.reservationId, patch, ok)} onSendLink={() => sendLink(r)} onCopyLink={() => copyLink(r)}
                      onView={which => view(r.reservationId, which, r.guest + (which === 'id' ? ' — ID' : ' — selfie'))} onRecheck={() => recheck(r)}
                      byHand={byHandFor === r.reservationId} setByHand={v => setByHandFor(v ? r.reservationId : null)} />
                    {r.hasDepositProof && <button onClick={() => view(r.reservationId, 'proof', r.guest + ' — deposit proof')} className={TASK_GHOST}><Eye size={12} /> Proof</button>}
                    {r.salatoVerified && <Link href="/vault" className={TASK_GHOST} title="Salato verification record (Vault → Records)"><Shield size={12} /> Record</Link>}
                    {can && depOpen && <button onClick={() => setDepFor(depFor === r.reservationId ? null : r.reservationId)} className={TASK_DARK}><Check size={12} /> Deposit captured</button>}
                    {can && r.depositStatus === 'captured' && <button onClick={() => post(r.reservationId, { deposit_status: 'released' }, 'Deposit marked released.')} disabled={b} className={releaseDue(r) ? TASK_DARK : TASK_GHOST} title="The hold was released / refunded"><Undo2 size={12} /> Released</button>}
                    {can && r.depositStatus === 'captured' && <button onClick={() => post(r.reservationId, { deposit_status: 'claimed' }, 'Deposit marked claimed — open a claim on the Claims desk.')} disabled={b} className={TASK_GHOST} title="We kept some or all of it for damage">Claimed</button>}
                    {can && r.depositStatus === 'captured' && (
                      <label className={TASK_GHOST + ' cursor-pointer'} title="Attach the hold / authorization screenshot or receipt"><Upload size={12} /><input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { uploadProof(r.reservationId, e.target.files?.[0]); e.target.value = '' }} /></label>
                    )}
                    {can && depOpen && <button onClick={() => post(r.reservationId, { deposit_status: 'waived' }, 'Deposit waived for this stay.')} disabled={b} className={TASK_GHOST} title="No deposit for this stay">Waive deposit</button>}
                    {can && r.needId && !r.checklist?.complete && <button onClick={() => pullThread(r)} disabled={b} className={TASK_GHOST} title="Read this booking's message thread from Guesty now — picks up a selfie or ID the guest replied with"><RefreshCw size={12} /> Thread</button>}
                    <button onClick={() => setDetailsFor(detailsFor === r.reservationId ? null : r.reservationId)} className={TASK_GHOST + (detailsFor === r.reservationId ? ' !bg-ink !text-white' : '')} title="The whole booking — guest, money, payments, calls, messages, tasks"><ChevronDown size={12} className={detailsFor === r.reservationId ? 'rotate-180' : ''} /> Details</button>
                    <a href={r.guestyUrl} target="_blank" rel="noreferrer" className={TASK_GHOST} title="Open this reservation in Guesty"><ExternalLink size={12} /> Guesty</a>
                  </div>
                </div>
                {detailsFor === r.reservationId && (
                  <div className="mt-2.5 flex flex-col gap-2">
                    <StayPanel reservationId={r.reservationId} />
                    <div className="flex items-center gap-2 text-[12px]">
                      <Link href={'/reservations/' + encodeURIComponent(r.reservationId)} prefetch={false} className={TASK_GHOST}><ExternalLink size={12} /> Full booking page</Link>
                      <a href={r.guestyUrl} target="_blank" rel="noreferrer" className={TASK_GHOST}><ExternalLink size={12} /> Open in Guesty</a>
                    </div>
                  </div>
                )}
                {byHandFor === r.reservationId && can && (
                  <ByHandStrip r={r} busy={b} ghost={TASK_GHOST} dark={TASK_DARK} field={field} onClose={() => setByHandFor(null)}
                    onPatch={async (patch, ok) => { await post(r.reservationId, patch, ok); setByHandFor(null) }} />
                )}
                {depFor === r.reservationId && can && (
                  <DepositForm r={r} busy={b} onCancel={() => setDepFor(null)} onSave={async (p) => { await post(r.reservationId, { deposit_status: 'captured', ...p }, 'Deposit captured — ' + (p.deposit_amount ? money(Number(p.deposit_amount)) : 'held') + '.'); setDepFor(null) }} />
                )}
              </div>
            )
          })}
        </div>
      )}
      {!embed && <p className="text-[11.5px] text-muted px-1">The guest's link captures a photo of their ID and a selfie; the ID is read and its name held against the booking — a match is verified, anything else is flagged to check. The “verified” field on the booking in Guesty counts here too, and a card hold in Guesty counts as the deposit. “Verified by hand” closes an ID check nothing picked up. A deposit's release date is check-out plus the channel rule's days unless you type one.</p>}
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
  const [amount, setAmount] = useState(r.depositAmount != null ? String(r.depositAmount) : (r.depositDue ? String(r.depositDue) : ''))
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
function RulesPanel({ rules, buildings, onSaved }: { rules: Record<Channel, ChannelRule>; buildings: Record<string, number>; onSaved: () => void }) {
  const [draft, setDraft] = useState<Record<Channel, ChannelRule>>(() => JSON.parse(JSON.stringify(rules)))
  const [bld, setBld] = useState<{ name: string; amount: string }[]>(() => Object.entries(buildings).map(([name, amount]) => ({ name, amount: String(amount) })))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const set = (ch: Channel, k: keyof ChannelRule, v: any) => setDraft(d => ({ ...d, [ch]: { ...d[ch], [k]: v } }))
  const save = async () => {
    setBusy(true); setMsg('')
    try { const j = await fetch(API + '/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: { ...draft, _buildings: Object.fromEntries(bld.filter(b => b.name.trim() && Number(b.amount) > 0).map(b => [b.name.trim(), Number(b.amount)])) } }) }).then(r => r.json()); if (!j.ok) throw new Error(j.error || 'Could not save.'); setMsg('Rules saved — the desk and the call scripts use them from now.'); onSaved() }
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
      {/* Per-building amounts beat the channel amount (Jon, 2026-10-03: $350 everywhere, Salato $500). */}
      <div className="mt-3 border-t border-line pt-3">
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <span className="text-[12.5px] font-bold text-ink">Deposit amount by building</span>
          <span className="text-[11.5px] text-muted">beats the channel amount above · "Salato" matches every Salato unit · other names match the building on the listing</span>
          <span className="grow" />
          <button type="button" onClick={() => setBld(b => [...b, { name: '', amount: '' }])} className={TASK_GHOST}>+ Building</button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {bld.map((b, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white p-1">
              <input value={b.name} onChange={e => setBld(x => x.map((y, j) => j === i ? { ...y, name: e.target.value } : y))} placeholder="Building" className={field + ' w-32 py-1 border-0'} />
              <span className="text-[12px] text-muted">$</span>
              <input value={b.amount} onChange={e => setBld(x => x.map((y, j) => j === i ? { ...y, amount: e.target.value.replace(/[^\d]/g, '') } : y))} inputMode="numeric" placeholder="500" className={field + ' w-16 py-1 border-0'} />
              <button type="button" onClick={() => setBld(x => x.filter((_, j) => j !== i))} className="px-1 text-muted hover:text-rose-600" aria-label="Remove"><X size={12} /></button>
            </span>
          ))}
          {bld.length === 0 && <span className="text-[12px] text-muted">None — every stay uses its channel amount.</span>}
        </div>
      </div>
    </div>
  )
}

function addDaysYmd(ymd: string, n: number): string {
  if (!ymd) return '9999-12-31'
  const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}

/** ID · Selfie · Deposit — what we hold for each and where it came from; "To verify" until all are in. */
function Checklist({ r }: { r: GuestCheckRow }) {
  const c = r.checklist
  if (!c) return null
  const item = (label: string, it: { ok: boolean; how: string }, need: boolean) => !need ? null : (
    <span title={label + ': ' + it.how} className={'inline-flex items-center gap-0.5 text-[10.5px] font-semibold px-1.5 py-[3px] rounded-md ' + (it.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>
      {it.ok ? <Check size={10} /> : <X size={10} />}{label}
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1">
      <span className={'text-[10.5px] font-bold px-1.5 py-[3px] rounded-md ' + (c.complete ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-900')}>{c.complete ? 'Verified' : 'To verify'}</span>
      {item('ID', c.id, r.needId)}
      {item('Selfie', c.selfie, r.needId)}
      {item(r.depositDue ? '$' + r.depositDue : 'Deposit', c.deposit, r.needDeposit)}
    </span>
  )
}
