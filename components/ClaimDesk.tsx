'use client'
// THE CLAIM DESK — the guided process, one claim at a time.
//
// A claim is not a form, it is a sequence: attach it to the stay, evidence every item, write it
// up, get it approved, file it, chase it, bank it, adjust the owner. The desk walks that sequence
// and refuses to let a claim move forward while the evidence that gets claims denied is missing.
// The gates are shown as a checklist rather than as an error on submit, because "what is still
// missing" is the question the person filing actually has.
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Loader2, Plus, Trash2, Upload, X, ExternalLink, Check, AlertTriangle,
  CalendarClock, ShieldAlert, FileText, Camera, DollarSign, CheckCircle2, Circle, RotateCcw,
} from 'lucide-react'
import CommentThread from '@/components/CommentThread'
import { DeleteButton } from '@/components/DeleteControl'
import {
  STAGES, OUTCOMES, WAITING, CHANNELS, CONDITIONS, money, num, itemsTotal, daysUntil, gatesFor,
  claimTitle, urgencyOf, type Claim, type ClaimItem, type Stage,
} from '@/lib/claims'

type Props = { id: string }

/** A stored attachment is a private storage path; reading it goes back through our own route. */
function fileHref(v?: string | null): string {
  const s = String(v || '')
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  return '/api/claims/file?path=' + encodeURIComponent(s)
}
function isImage(v?: string | null): boolean { return /\.(jpe?g|png|gif|webp|heic)$/i.test(String(v || '')) }

async function toB64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 8192)) as any)
  }
  return btoa(bin)
}

export function ClaimDesk({ id }: Props) {
  const router = useRouter()
  const [claim, setClaim] = useState<Claim | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState<{ key: string; label: string; detail?: string }[] | null>(null)
  const [flash, setFlash] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/claims/' + id, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Could not load this claim.'); return }
      setClaim(j.claim)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [id])
  useEffect(() => { load() }, [load])

  const patch = useCallback(async (body: Record<string, any>, opts?: { silent?: boolean }) => {
    setBusy(true); setErr(''); setBlocked(null)
    try {
      const r = await fetch('/api/claims/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (r.status === 409 && Array.isArray(j.gates)) { setBlocked(j.gates); return false }
      if (!r.ok || j.ok === false) { setErr(j.error || 'Save failed.'); return false }
      if (j.claim) setClaim(j.claim)
      if (j.note && j.note.ok === false) setErr('Saved, but the reservation note did not go to Guesty: ' + (j.note.error || 'unknown'))
      else if (j.note && j.note.ok === true && !opts?.silent) { setFlash('Note written onto the reservation in Guesty.'); setTimeout(() => setFlash(''), 4000) }
      return true
    } catch (e: any) { setErr(String(e?.message || e)); return false } finally { setBusy(false) }
  }, [id])

  if (loading) return <div className="text-sm text-muted py-16 text-center">Loading claim…</div>
  if (!claim) return <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err || 'Claim not found.'}</div>

  const items = claim.items || []
  const gates = gatesFor(claim, items)
  const failing = gates.filter(g => !g.ok)
  const total = num(claim.amount_sought) || itemsTotal(items)
  const d = daysUntil(claim.deadline_on)
  const u = urgencyOf(claim)
  const stageIndex = STAGES.findIndex(s => s.key === claim.stage)

  return (
    <>
      <Link href="/claims" className="text-xs text-muted hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={12} /> All claims</Link>

      <header className="mt-3 mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-muted flex items-center gap-1.5"><ShieldAlert size={12} /> Claim</div>
          <h1 className="text-2xl font-bold text-ink mt-1 break-words">{claimTitle(claim)}</h1>
          <p className="text-sm text-muted mt-0.5">
            {claim.check_in} to {claim.check_out} · {claim.channel}
            {claim.guesty_url && <> · <a href={claim.guesty_url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline inline-flex items-center gap-1">Guesty <ExternalLink size={10} /></a></>}
            {claim.reservation_id && <> · <Link href={'/reservations/' + claim.reservation_id} className="text-brand-600 hover:underline">Reservation</Link></>}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-ink tabular-nums">{money(total)}</div>
          <div className="text-[11px] uppercase text-muted">sought</div>
          {claim.amount_paid != null && <div className="text-sm font-semibold text-emerald-700 tabular-nums mt-0.5">{money(claim.amount_paid)} recovered</div>}
        </div>
      </header>

      {/* THE CLOCK. Loudest thing on the page while it still matters. */}
      {u !== 'none' && (
        <div className={'rounded-2xl border p-3 mb-4 flex items-center gap-2 ' + (u === 'expired' || u === 'critical' ? 'border-rose-300 bg-rose-50 text-rose-900' : u === 'soon' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800')}>
          <CalendarClock size={16} />
          <span className="font-semibold text-sm">
            {d === null ? 'No checkout date, so no filing deadline could be worked out.'
              : d < 0 ? 'The filing window closed on ' + claim.deadline_on + ' — ' + Math.abs(d) + ' day(s) ago.'
              : d === 0 ? 'Last day to file: ' + claim.deadline_on + '.'
              : 'File by ' + claim.deadline_on + ' — ' + d + ' day(s) left.'}
          </span>
          <span className="text-[11px] opacity-80 ml-auto">Channels close damage claims 14 days after checkout.</span>
        </div>
      )}

      {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">{err}</div>}
      {flash && <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3 flex items-center gap-2"><Check size={14} />{flash}</div>}

      {/* Stage stepper */}
      <div className="flex items-center gap-1 flex-wrap mb-5">
        {STAGES.map((s, i) => (
          <span key={s.key} className={'text-[11px] font-semibold px-2 py-1 rounded-lg border ' + (i === stageIndex ? 'bg-ink text-white border-ink' : i < stageIndex ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-muted border-line')}>
            {i < stageIndex ? '✓ ' : ''}{s.label}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          <StepStay claim={claim} patch={patch} busy={busy} />
          <StepItems claimId={id} items={items} onItems={(next: ClaimItem[]) => setClaim(c => c ? { ...c, items: next } : c)} setErr={setErr} />
          <StepWriteUp claim={claim} items={items} patch={patch} busy={busy} />
          <StepFile claim={claim} gates={gates} failing={failing} blocked={blocked} patch={patch} busy={busy} />
          {(claim.stage === 'submitted' || claim.stage === 'decided' || claim.stage === 'settle' || claim.stage === 'closed') && (
            <StepOutcome claim={claim} patch={patch} busy={busy} />
          )}
          <section className="rounded-2xl border border-line bg-white p-4">
            <h2 className="text-sm font-semibold text-ink mb-2">Discussion</h2>
            <CommentThread type="claim" id={id} label={claimTitle(claim)} link={'/claims/' + id} reservationId={claim.reservation_id || undefined} />
          </section>
        </div>

        <div className="space-y-4">
          <Rail claim={claim} items={items} gates={gates} patch={patch} busy={busy} onDelete={async () => {
            try {
              const r = await fetch('/api/claims/' + id, { method: 'DELETE' })
              const j = await r.json()
              if (!r.ok || j.ok === false) return j.error || 'Delete failed'
              // Straight back to the board, where "Recently deleted" can put it back.
              router.push('/claims')
              return null
            } catch (e: any) { return String(e?.message || e) }
          }} />
        </div>
      </div>
    </>
  )
}

// ── step 1: the stay ───────────────────────────────────────────────────────
function StepStay({ claim, patch, busy }: { claim: Claim; patch: (b: any) => Promise<boolean>; busy: boolean }) {
  const [discovered, setDiscovered] = useState(claim.discovered_on || '')
  const [channel, setChannel] = useState(claim.channel || '')
  useEffect(() => { setDiscovered(claim.discovered_on || ''); setChannel(claim.channel || '') }, [claim.discovered_on, claim.channel])
  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <StepHead n={1} title="The stay" done={!!claim.reservation_id} />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
        <Fact label="Guest" value={claim.guest_name} />
        <Fact label="Property" value={claim.property} />
        <Fact label="Unit" value={claim.unit_no} />
        <Fact label="Confirmation" value={claim.confirmation_code} mono />
        <Fact label="Check-in" value={claim.check_in} />
        <Fact label="Checkout" value={claim.check_out} />
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted">Damage discovered</span>
          <input type="date" value={discovered} onChange={e => setDiscovered(e.target.value)} onBlur={() => { if (discovered !== (claim.discovered_on || '')) patch({ discovered_on: discovered }) }}
            className="mt-1 w-full text-sm border border-line rounded-lg px-2 py-1.5 bg-white" />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted">Channel to claim against</span>
          <select value={channel} onChange={e => { setChannel(e.target.value); patch({ channel: e.target.value }) }} disabled={busy}
            className="mt-1 w-full text-sm border border-line rounded-lg px-2 py-1.5 bg-white">
            <option value="">Choose…</option>
            {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
            {channel && CHANNELS.indexOf(channel) < 0 && <option value={channel}>{channel}</option>}
          </select>
        </label>
      </div>
      <p className="text-[11px] text-muted mt-2">Guest, unit, dates and confirmation code come off the booking and are not editable here — if one is wrong, the claim is on the wrong stay.</p>
    </section>
  )
}

// ── step 2: the evidence ───────────────────────────────────────────────────
function StepItems({ claimId, items, onItems, setErr }: { claimId: string; items: ClaimItem[]; onItems: (i: ClaimItem[]) => void; setErr: (s: string) => void }) {
  const [busy, setBusy] = useState(false)
  const add = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/claims/' + claimId + '/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: '' }) })
      const j = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Could not add the item.'); return }
      onItems(j.items || [])
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(false) }
  }
  const complete = items.filter(i => String(i.description || '').trim() && (num(i.cost) || 0) > 0 && Array.isArray(i.photo_urls) && i.photo_urls.length > 0).length
  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <StepHead n={2} title="The items" done={items.length > 0 && complete === items.length}
        note={items.length ? complete + ' of ' + items.length + ' fully evidenced · ' + money(itemsTotal(items)) : undefined} />
      <p className="text-[12px] text-muted mt-1">Every damaged or stolen thing gets its own entry. A bundled claim is the claim that gets denied.</p>
      <div className="mt-3 space-y-3">
        {items.map((it, i) => (
          <ItemCard key={String(it.id || i)} claimId={claimId} item={it} index={i} onItems={onItems} setErr={setErr} />
        ))}
      </div>
      <button onClick={add} disabled={busy} className="mt-3 text-sm font-semibold px-3 py-1.5 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1.5 disabled:opacity-40">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add an item
      </button>
    </section>
  )
}

function ItemCard({ claimId, item, index, onItems, setErr }: { claimId: string; item: ClaimItem; index: number; onItems: (i: ClaimItem[]) => void; setErr: (s: string) => void }) {
  const [v, setV] = useState<ClaimItem>(item)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState('')
  const photoRef = useRef<HTMLInputElement | null>(null)
  const receiptRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => { setV(item) }, [item])

  const save = async (over?: Partial<ClaimItem>) => {
    const body = { ...v, ...(over || {}), itemId: item.id }
    setBusy(true)
    try {
      const r = await fetch('/api/claims/' + claimId + '/items', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Could not save the item.'); return }
      onItems(j.items || [])
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!window.confirm('Remove this item from the claim?')) return
    setBusy(true)
    try {
      const r = await fetch('/api/claims/' + claimId + '/items?itemId=' + encodeURIComponent(String(item.id)), { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Could not remove the item.'); return }
      onItems(j.items || [])
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(false) }
  }

  const upload = async (files: FileList | null, kind: 'photo' | 'receipt') => {
    if (!files || !files.length) return
    setUploading(kind); setErr('')
    try {
      const paths: string[] = []
      for (let i = 0; i < files.length && i < 10; i++) {
        const f = files[i]
        const b64 = await toB64(f)
        const r = await fetch('/api/claims/file', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ b64, filename: f.name, contentType: f.type || 'application/octet-stream', claimId }),
        })
        const j = await r.json()
        if (!r.ok || j.ok === false) { setErr(j.error || 'Upload failed.'); break }
        paths.push(String(j.path))
      }
      if (!paths.length) return
      if (kind === 'receipt') await save({ receipt_url: paths[0] })
      else await save({ photo_urls: (Array.isArray(v.photo_urls) ? v.photo_urls : []).concat(paths) })
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setUploading('') }
  }

  const photos = Array.isArray(v.photo_urls) ? v.photo_urls : []
  const ok = String(v.description || '').trim() && (num(v.cost) || 0) > 0 && photos.length > 0 && String(v.replacement_url || '').trim() && String(v.condition_prior || '').trim() && String(v.age_text || '').trim()

  return (
    <div className={'rounded-xl border p-3 ' + (ok ? 'border-emerald-200 bg-emerald-50/30' : 'border-line bg-app/30')}>
      <div className="flex items-center gap-2 mb-2">
        <span className={'text-[11px] font-bold px-1.5 py-0.5 rounded ' + (ok ? 'bg-emerald-600 text-white' : 'bg-ink text-white')}>Item {index + 1}</span>
        {ok ? <span className="text-[11px] text-emerald-700 font-medium inline-flex items-center gap-1"><Check size={11} /> Complete</span>
          : <span className="text-[11px] text-muted">Needs description, condition, age, cost, replacement link and a photo</span>}
        <button onClick={remove} disabled={busy} className="ml-auto text-muted hover:text-rose-700"><Trash2 size={14} /></button>
      </div>

      <textarea value={v.description || ''} onChange={e => setV({ ...v, description: e.target.value })} onBlur={() => save()}
        rows={2} placeholder="What was damaged or taken, and how? Be specific and factual."
        className="w-full text-sm border border-line rounded-lg px-2 py-1.5 bg-white" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-muted">Condition before</span>
          <select value={v.condition_prior || ''} onChange={e => { const nv = { ...v, condition_prior: e.target.value }; setV(nv); save(nv) }}
            className="mt-0.5 w-full text-sm border border-line rounded-lg px-2 py-1.5 bg-white">
            <option value="">Choose…</option>
            {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-muted">Age</span>
          <input value={v.age_text || ''} onChange={e => setV({ ...v, age_text: e.target.value })} onBlur={() => save()}
            placeholder="2 years" className="mt-0.5 w-full text-sm border border-line rounded-lg px-2 py-1.5 bg-white" />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-muted">Cost</span>
          <input value={v.cost == null ? '' : String(v.cost)} onChange={e => setV({ ...v, cost: e.target.value as any })} onBlur={() => save()}
            inputMode="decimal" placeholder="0.00" className="mt-0.5 w-full text-sm border border-line rounded-lg px-2 py-1.5 bg-white tabular-nums" />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-muted">Police report</span>
          <select value={v.police_report ? 'yes' : 'no'} onChange={e => { const nv = { ...v, police_report: e.target.value === 'yes' }; setV(nv); save(nv) }}
            className="mt-0.5 w-full text-sm border border-line rounded-lg px-2 py-1.5 bg-white">
            <option value="no">No</option>
            <option value="yes">Yes / will file</option>
          </select>
        </label>
      </div>

      <label className="block mt-2">
        <span className="text-[10px] uppercase tracking-wide text-muted">Link to a like-kind replacement</span>
        <input value={v.replacement_url || ''} onChange={e => setV({ ...v, replacement_url: e.target.value })} onBlur={() => save()}
          placeholder="https://…" className="mt-0.5 w-full text-sm border border-line rounded-lg px-2 py-1.5 bg-white" />
      </label>

      <div className="flex items-center gap-2 flex-wrap mt-2">
        <input ref={photoRef} type="file" accept="image/*" multiple className="hidden" onChange={e => upload(e.target.files, 'photo')} />
        <button onClick={() => photoRef.current?.click()} disabled={!!uploading} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1.5 disabled:opacity-40">
          {uploading === 'photo' ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />} Damage photos
        </button>
        <input ref={receiptRef} type="file" className="hidden" onChange={e => upload(e.target.files, 'receipt')} />
        <button onClick={() => receiptRef.current?.click()} disabled={!!uploading} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1.5 disabled:opacity-40">
          {uploading === 'receipt' ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Receipt or quote
        </button>
        {v.receipt_url && (
          <a href={fileHref(v.receipt_url)} target="_blank" rel="noreferrer" className="text-[12px] text-brand-600 hover:underline inline-flex items-center gap-1">
            <FileText size={11} /> Receipt attached
          </a>
        )}
        {v.receipt_url && <button onClick={() => save({ receipt_url: null })} className="text-muted hover:text-rose-700"><X size={12} /></button>}
      </div>

      {photos.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mt-2">
          {photos.map((p, i) => (
            <span key={p + i} className="relative group">
              <a href={fileHref(p)} target="_blank" rel="noreferrer">
                {isImage(p)
                  ? <img src={fileHref(p)} alt="" className="w-16 h-16 object-cover rounded-lg border border-line" />
                  : <span className="w-16 h-16 rounded-lg border border-line bg-white flex items-center justify-center"><FileText size={16} className="text-muted" /></span>}
              </a>
              <button onClick={() => save({ photo_urls: photos.filter((_, j) => j !== i) })}
                className="absolute -top-1 -right-1 bg-white border border-line rounded-full p-0.5 text-muted hover:text-rose-700 opacity-0 group-hover:opacity-100">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── step 3: the write-up ───────────────────────────────────────────────────
function StepWriteUp({ claim, items, patch, busy }: { claim: Claim; items: ClaimItem[]; patch: (b: any) => Promise<boolean>; busy: boolean }) {
  const [summary, setSummary] = useState(claim.summary || '')
  const [amount, setAmount] = useState(claim.amount_sought == null ? '' : String(claim.amount_sought))
  useEffect(() => { setSummary(claim.summary || '') }, [claim.summary])
  useEffect(() => { setAmount(claim.amount_sought == null ? '' : String(claim.amount_sought)) }, [claim.amount_sought])
  const sum = itemsTotal(items)
  const typed = num(amount)
  const mismatch = typed !== null && Math.abs(typed - sum) > 0.5 && sum > 0
  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <StepHead n={3} title="The write-up" done={String(claim.summary || '').trim().length >= 40 && !!claim.guest_called} />
      <label className="block mt-3">
        <span className="text-[11px] uppercase tracking-wide text-muted">Summary sent to the channel</span>
        <textarea value={summary} onChange={e => setSummary(e.target.value)} onBlur={() => { if (summary !== (claim.summary || '')) patch({ summary }) }}
          rows={5} placeholder="Most significant issue first. Professional and objective."
          className="mt-1 w-full text-sm border border-line rounded-lg px-2 py-1.5 bg-white" />
      </label>
      <p className="text-[11px] text-muted mt-1">
        Lead with the most significant issue. Keep it factual — no personal attacks, no opinions. Do not claim for minor infractions
        (an overstay under two hours, or smoking evidenced by smell alone); a weak line in the write-up weakens the whole claim.
      </p>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted">Total sought</span>
          <input value={amount} onChange={e => setAmount(e.target.value)} onBlur={() => patch({ amount_sought: amount })} inputMode="decimal"
            placeholder={sum ? String(sum) : '0.00'} className="mt-1 w-full text-sm border border-line rounded-lg px-2 py-1.5 bg-white tabular-nums" />
          <span className="text-[11px] text-muted">Items add up to {money(sum)}.{' '}
            {mismatch && <button onClick={() => { setAmount(String(sum)); patch({ amount_sought: sum }) }} className="text-brand-600 font-semibold hover:underline">Use {money(sum)}</button>}
          </span>
        </label>
        <div>
          <span className="text-[11px] uppercase tracking-wide text-muted">Before filing</span>
          <button onClick={() => patch({ guest_called: !claim.guest_called })} disabled={busy}
            className={'mt-1 w-full text-left text-sm rounded-lg border px-2.5 py-2 inline-flex items-center gap-2 ' + (claim.guest_called ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900')}>
            {claim.guest_called ? <CheckCircle2 size={15} /> : <Circle size={15} />}
            <span className="font-medium">The guest was called</span>
          </button>
          <span className="text-[11px] text-muted">Airbnb requires the guest to be contacted before a claim is filed.</span>
        </div>
      </div>
      {mismatch && <div className="mt-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">The total you typed does not match the items ({money(sum)}). A number that does not add up is the first thing an adjuster spots.</div>}
    </section>
  )
}

// ── step 4: file it ────────────────────────────────────────────────────────
function StepFile({ claim, gates, failing, blocked, patch, busy }: {
  claim: Claim; gates: { key: string; label: string; ok: boolean; detail?: string }[]
  failing: { key: string; label: string; ok: boolean; detail?: string }[]
  blocked: { key: string; label: string; detail?: string }[] | null
  patch: (b: any) => Promise<boolean>; busy: boolean
}) {
  const [caseId, setCaseId] = useState(claim.channel_case_id || '')
  useEffect(() => { setCaseId(claim.channel_case_id || '') }, [claim.channel_case_id])
  const stage = claim.stage
  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <StepHead n={4} title="File it" done={stage === 'submitted' || stage === 'decided' || stage === 'settle' || stage === 'closed'} />

      <div className="mt-3 grid md:grid-cols-2 gap-x-4 gap-y-1">
        {gates.map(g => (
          <div key={g.key} className="flex items-start gap-2 text-[12px] py-0.5">
            {g.ok ? <CheckCircle2 size={14} className="text-emerald-600 mt-px shrink-0" /> : <AlertTriangle size={14} className="text-amber-600 mt-px shrink-0" />}
            <span className={g.ok ? 'text-muted' : 'text-ink font-medium'}>
              {g.label}
              {!g.ok && g.detail && <span className="block text-[11px] text-muted font-normal">{g.detail}</span>}
            </span>
          </div>
        ))}
      </div>

      {blocked && blocked.length > 0 && (
        <div className="mt-3 text-[12px] text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-2">
          Blocked: {blocked.map(g => g.label).join(' · ')}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        {stage === 'draft' && (
          <button onClick={() => patch({ stage: 'review' })} disabled={busy} className="text-sm font-semibold px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-40">
            Send for review
          </button>
        )}
        {stage === 'review' && (<>
          <button onClick={() => patch({ stage: 'ready' })} disabled={busy || failing.length > 0} className="text-sm font-semibold px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-40">
            Approve to file
          </button>
          <button onClick={() => patch({ stage: 'draft' })} disabled={busy} className="text-sm font-medium px-3 py-2 rounded-lg border border-line bg-white hover:bg-app">
            Send back to draft
          </button>
          {failing.length > 0 && <span className="text-[12px] text-amber-800">{failing.length} thing(s) still missing.</span>}
        </>)}
        {stage === 'ready' && (<>
          <input value={caseId} onChange={e => setCaseId(e.target.value)} placeholder="Channel case / claim ref (optional)"
            className="text-sm border border-line rounded-lg px-2 py-2 bg-white w-64" />
          <button onClick={() => patch({ stage: 'submitted', channel_case_id: caseId })} disabled={busy} className="text-sm font-semibold px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-40">
            Mark as submitted
          </button>
          <span className="text-[12px] text-muted">Writes a note onto the reservation in Guesty.</span>
        </>)}
        {(stage === 'submitted' || stage === 'decided' || stage === 'settle' || stage === 'closed') && (
          <span className="text-[12px] text-emerald-700 font-medium inline-flex items-center gap-1"><Check size={13} /> Filed{claim.submitted_on ? ' on ' + claim.submitted_on : ''}{claim.channel_case_id ? ' · case ' + claim.channel_case_id : ''}</span>
        )}
        {failing.length > 0 && (stage === 'draft' || stage === 'review' || stage === 'ready') && (
          <button onClick={() => { if (window.confirm('File this claim with ' + failing.length + ' evidence gate(s) unmet? It is recorded that the checklist was overridden.')) patch({ stage: stage === 'draft' ? 'review' : 'ready', force: true }) }}
            disabled={busy} className="text-[12px] text-muted hover:text-ink underline decoration-dotted ml-auto">
            Override the checklist
          </button>
        )}
      </div>
    </section>
  )
}

// ── step 5: what happened ──────────────────────────────────────────────────
function StepOutcome({ claim, patch, busy }: { claim: Claim; patch: (b: any) => Promise<boolean>; busy: boolean }) {
  const [paid, setPaid] = useState(claim.amount_paid == null ? '' : String(claim.amount_paid))
  useEffect(() => { setPaid(claim.amount_paid == null ? '' : String(claim.amount_paid)) }, [claim.amount_paid])
  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <StepHead n={5} title="What happened" done={claim.stage === 'closed'} />

      {claim.stage === 'submitted' && (
        <div className="mt-3">
          <span className="text-[11px] uppercase tracking-wide text-muted">Waiting on</span>
          <div className="flex gap-1.5 mt-1 flex-wrap">
            {WAITING.map(w => (
              <button key={w.key} onClick={() => patch({ waiting_on: w.key })} disabled={busy}
                className={'text-[12px] font-medium px-2.5 py-1.5 rounded-lg border ' + (claim.waiting_on === w.key ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:bg-app')}>
                {w.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-3 mt-3">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted">Decision</span>
          <select value={claim.outcome || ''} onChange={e => patch({ outcome: e.target.value, stage: e.target.value && claim.stage === 'submitted' ? 'decided' : claim.stage })} disabled={busy}
            className="mt-1 w-full text-sm border border-line rounded-lg px-2 py-1.5 bg-white">
            <option value="">Not decided yet</option>
            {OUTCOMES.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted">Amount actually paid</span>
          <input value={paid} onChange={e => setPaid(e.target.value)} onBlur={() => patch({ amount_paid: paid })} inputMode="decimal"
            placeholder="0.00" className="mt-1 w-full text-sm border border-line rounded-lg px-2 py-1.5 bg-white tabular-nums" />
        </label>
      </div>

      {(claim.stage === 'decided' || claim.stage === 'settle' || claim.stage === 'closed') && (
        <div className="mt-4 grid md:grid-cols-2 gap-2">
          <Toggle on={!!claim.payment_verified} busy={busy} label="Payment verified in the account" hint="Money actually landed — not just approved." onClick={() => patch({ payment_verified: !claim.payment_verified })} />
          <Toggle on={!!claim.owner_adjusted} busy={busy} label="Owner / PMC statement adjusted" hint="The recovery is reflected on the owner's books." onClick={() => patch({ owner_adjusted: !claim.owner_adjusted })} />
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        {claim.stage === 'decided' && (
          <button onClick={() => patch({ stage: 'settle' })} disabled={busy} className="text-sm font-semibold px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-40">
            Move to money &amp; owner
          </button>
        )}
        {claim.stage === 'settle' && (
          <button onClick={() => patch({ stage: 'closed' })} disabled={busy} className="text-sm font-semibold px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-40">
            Close the claim
          </button>
        )}
        {claim.stage === 'closed' && (
          <button onClick={() => patch({ stage: 'settle' })} disabled={busy} className="text-sm font-medium px-3 py-2 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1.5">
            <RotateCcw size={13} /> Reopen
          </button>
        )}
      </div>
    </section>
  )
}

// ── the rail ───────────────────────────────────────────────────────────────
function Rail({ claim, items, gates, patch, busy, onDelete }: {
  claim: Claim; items: ClaimItem[]; gates: { key: string; ok: boolean }[]
  patch: (b: any) => Promise<boolean>; busy: boolean; onDelete: () => Promise<string | null>
}) {
  const done = gates.filter(g => g.ok).length
  const hist = Array.isArray(claim.history) ? claim.history.slice().reverse().slice(0, 12) : []
  const [notes, setNotes] = useState(claim.notes || '')
  useEffect(() => { setNotes(claim.notes || '') }, [claim.notes])
  return (
    <>
      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-ink mb-2">At a glance</h2>
        <div className="space-y-1.5 text-[13px]">
          <RailRow label="Stage" value={(STAGES.find(s => s.key === claim.stage) || STAGES[0]).label} />
          <RailRow label="Evidence" value={done + ' of ' + gates.length} />
          <RailRow label="Items" value={String(items.length)} />
          <RailRow label="Sought" value={money(num(claim.amount_sought) || itemsTotal(items))} />
          <RailRow label="Paid" value={claim.amount_paid == null ? '—' : money(claim.amount_paid)} />
          <RailRow label="Discovered" value={claim.discovered_on || '—'} />
          <RailRow label="File by" value={claim.deadline_on || '—'} />
          <RailRow label="Submitted" value={claim.submitted_on || '—'} />
          <RailRow label="Decided" value={claim.decided_on || '—'} />
          <RailRow label="Owner" value={claim.assignee_email || '—'} />
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-ink mb-1">Reservation note</h2>
        {claim.note_synced_at ? (
          <p className="text-[12px] text-emerald-700 inline-flex items-center gap-1"><Check size={12} /> Written onto the booking in Guesty.</p>
        ) : claim.note_sync_error ? (
          <p className="text-[12px] text-rose-700">Last write failed: {claim.note_sync_error}</p>
        ) : (
          <p className="text-[12px] text-muted">A stamped line lands on the Guesty reservation when this claim is submitted, decided, paid or closed.</p>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-ink mb-2">Internal notes</h2>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} onBlur={() => { if (notes !== (claim.notes || '')) patch({ notes }) }}
          rows={4} placeholder="Anything the next person needs to know. Never sent anywhere."
          className="w-full text-sm border border-line rounded-lg px-2 py-1.5 bg-white" />
      </section>

      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-ink mb-2">Trail</h2>
        {hist.length === 0 && <p className="text-[12px] text-muted">Nothing yet.</p>}
        <div className="space-y-1.5">
          {hist.map((h: any, i: number) => (
            <div key={i} className="text-[11px] text-muted">
              <span className="text-ink font-medium">{String(h.by || 'team').split('@')[0]}</span>{' '}
              {h.action === 'stage' ? ('moved ' + String(h.from || '?') + ' to ' + String(h.to || '?') + (h.forced ? ' (checklist overridden)' : '')) : String(h.action || 'edit')}
              {' · '}{String(h.at || '').slice(0, 16).replace('T', ' ')}
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-col items-stretch gap-1">
        <DeleteButton label="Delete this claim" onDelete={onDelete} className="justify-center" />
        <span className="text-[11px] text-muted text-center">Recoverable from &ldquo;Recently deleted&rdquo; on the board.</span>
      </div>
    </>
  )
}

// ── small parts ────────────────────────────────────────────────────────────
function StepHead({ n, title, done, note }: { n: number; title: string; done?: boolean; note?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={'w-6 h-6 rounded-full text-[12px] font-bold flex items-center justify-center shrink-0 ' + (done ? 'bg-emerald-600 text-white' : 'bg-ink text-white')}>
        {done ? '✓' : n}
      </span>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {note && <span className="ml-auto text-[11px] text-muted">{note}</span>}
    </div>
  )
}
function Fact({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={'text-[13px] text-ink ' + (mono ? 'font-mono' : '')}>{value || '—'}</div>
    </div>
  )
}
function RailRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-baseline justify-between gap-3"><span className="text-muted">{label}</span><span className="text-ink font-medium text-right">{value}</span></div>
}
function Toggle({ on, label, hint, onClick, busy }: { on: boolean; label: string; hint: string; onClick: () => void; busy: boolean }) {
  return (
    <button onClick={onClick} disabled={busy} className={'text-left rounded-lg border px-2.5 py-2 ' + (on ? 'border-emerald-300 bg-emerald-50' : 'border-line bg-white hover:bg-app')}>
      <span className="text-[13px] font-medium text-ink inline-flex items-center gap-2">
        {on ? <CheckCircle2 size={15} className="text-emerald-600" /> : <Circle size={15} className="text-muted" />}{label}
      </span>
      <span className="block text-[11px] text-muted mt-0.5 pl-[23px]">{hint}</span>
    </button>
  )
}
