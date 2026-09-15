'use client'
// WHAT A VENDOR SEES.
//
// Jon, 2026-09-15: "can we please work on public board for just that."
//
// Designed for the actual reader: a plumber or a pest tech, on a phone, one-handed, possibly in a
// stairwell with one bar. That drives every decision here —
//
//   • One column, big touch targets, no board metaphor. A kanban on a phone is a puzzle.
//   • The next visit is the whole screen; everything else is below it.
//   • Two taps to do the only things that matter: "I'll be there" and "It's done".
//   • Every action says what it did, out loud, because on a bad connection the honest question is
//     "did that go through" and a silent success is indistinguishable from a silent failure.
//
// It shows only this vendor's jobs. There is no navigation to anywhere else, because there is
// nowhere else — as far as this page is concerned, the rest of the company does not exist.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Loader2, Check, CalendarDays, Clock, MapPin, Camera, Send, ChevronDown, ChevronRight,
  CheckCircle2, AlertTriangle, Receipt, Phone, RefreshCw,
} from 'lucide-react'

type Job = {
  id: string; title: string; detail: string | null; unit: string | null
  visit_on: string | null; visit_window: string | null; est_minutes: number | null; due_on: string | null
  status: string; done: boolean; confirmed: boolean; proposed_on: string | null
  photos: { id: string; url: string; caption: string | null; created_at: string }[]
  messages: { body: string; author: string | null; created_at: string }[]
  invoices: { id: string; amount_cents: number; number: string | null; status: string; created_at: string }[]
}
type Vendor = { key: string; label: string; contact_name: string | null; phone: string | null; email: string | null; trade: string | null }

const fmtDay = (ymd: string | null) => {
  if (!ymd) return ''
  const d = new Date(ymd + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
}
const fmtShort = (ymd: string | null) => {
  if (!ymd) return ''
  return new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
const mins = (m: number | null) => {
  if (!m) return null
  if (m < 60) return m + ' min'
  const h = m / 60
  return (Number.isInteger(h) ? h : h.toFixed(1)) + (h === 1 ? ' hr' : ' hrs')
}
const daysFrom = (ymd: string | null, today: string) =>
  ymd ? Math.round((Date.parse(ymd + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000) : null
const money = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function VendorJobsView({ token }: { token: string }) {
  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [today, setToday] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/public/vendor-jobs?token=' + encodeURIComponent(token), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || j?.error) throw new Error(j?.error || 'Could not load your jobs.')
      setVendor(j.vendor); setJobs(j.jobs || []); setToday(j.today || '')
    } catch (e: any) { setErr(String(e?.message || e)); setJobs([]) }
  }, [token])
  useEffect(() => { load() }, [load])

  // Every write says what it did. On a phone with one bar, silence is the worst possible answer.
  const act = useCallback(async (body: any, confirmation: string) => {
    setBusy(true); setErr(null); setSaid(null)
    try {
      const r = await fetch('/api/public/vendor-jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, token }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) throw new Error(j?.error || 'That did not go through. Please try again.')
      if (j.jobs) setJobs(j.jobs)
      setSaid(confirmation)
      setTimeout(() => setSaid(null), 4000)
      return true
    } catch (e: any) { setErr(String(e?.message || e)); return false } finally { setBusy(false) }
  }, [token])

  if (jobs === null) {
    return <div className="min-h-screen grid place-items-center bg-slate-50">
      <p className="text-slate-500 text-[14px] inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading your jobs…</p>
    </div>
  }
  if (err && !vendor) {
    return <div className="min-h-screen grid place-items-center bg-slate-50 px-6">
      <div className="max-w-sm text-center">
        <AlertTriangle size={28} className="mx-auto text-amber-500" />
        <p className="mt-3 text-[15px] font-semibold text-slate-900">{err}</p>
      </div>
    </div>
  }

  const open = jobs.filter(j => !j.done)
  const next = open.filter(j => j.visit_on).sort((a, b) => String(a.visit_on).localeCompare(String(b.visit_on)))[0] || null
  const rest = open.filter(j => j.id !== next?.id)

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-20">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Stay Hospitality</p>
            <h1 className="text-[17px] font-bold leading-tight truncate">{vendor?.label || 'Your jobs'}</h1>
          </div>
          <button onClick={load} disabled={busy} className="shrink-0 text-slate-400 hover:text-slate-700 p-1" title="Refresh">
            <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      {said && (
        <div className="sticky top-[57px] z-20 bg-emerald-600 text-white px-4 py-2 text-[13.5px] font-semibold">
          <div className="max-w-xl mx-auto inline-flex items-center gap-2"><CheckCircle2 size={15} /> {said}</div>
        </div>
      )}
      {err && (
        <div className="sticky top-[57px] z-20 bg-rose-600 text-white px-4 py-2 text-[13.5px] font-semibold">
          <div className="max-w-xl mx-auto">{err}</div>
        </div>
      )}

      <main className="max-w-xl mx-auto px-4 py-4 space-y-4 pb-20">
        {open.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center">
            <CheckCircle2 size={28} className="mx-auto text-emerald-500" />
            <p className="mt-3 text-[15px] font-semibold">Nothing open right now.</p>
            <p className="mt-1 text-[13px] text-slate-500">We will text you when there is something new.</p>
          </div>
        )}

        {/* THE NEXT VISIT GETS THE WHOLE SCREEN. It is the only thing most people open this for. */}
        {next && <JobCard job={next} today={today} busy={busy} act={act} token={token} onPhoto={load} hero />}

        {rest.length > 0 && (
          <>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 px-1 pt-2">
              Also on your list ({rest.length})
            </p>
            {rest.map(j => (
              <div key={j.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <button onClick={() => setOpenId(openId === j.id ? null : j.id)} className="w-full px-4 py-3 text-left flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold leading-snug">{j.title}</p>
                    <p className="text-[12.5px] text-slate-500 truncate">
                      {[j.unit, j.visit_on ? fmtShort(j.visit_on) : 'No date yet'].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {openId === j.id ? <ChevronDown size={16} className="text-slate-400 shrink-0" /> : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
                </button>
                {openId === j.id && <div className="border-t border-slate-200"><JobBody job={j} today={today} busy={busy} act={act} token={token} onPhoto={load} /></div>}
              </div>
            ))}
          </>
        )}

        <p className="text-[12px] text-slate-500 text-center pt-4">
          Questions? Reply on a job above and it reaches the team.
          {vendor?.phone && <><br />We have you as {vendor.phone}.</>}
        </p>
      </main>
    </div>
  )
}

function JobCard({ job, today, busy, act, token, onPhoto, hero }: {
  job: Job; today: string; busy: boolean; act: (b: any, c: string) => Promise<boolean>; token: string; onPhoto: () => void; hero?: boolean
}) {
  const d = daysFrom(job.visit_on, today)
  const when = d === null ? 'No date yet' : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d < 0 ? `${-d} day${d === -1 ? '' : 's'} ago` : `In ${d} days`
  const late = d !== null && d < 0
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className={'px-4 py-3 ' + (late ? 'bg-rose-600 text-white' : d === 0 ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white')}>
        <p className="text-[11px] uppercase tracking-wider font-bold opacity-80">{hero ? 'Next visit' : 'Visit'}</p>
        <p className="text-[19px] font-bold leading-tight">{when}</p>
        {job.visit_on && <p className="text-[13px] opacity-90">{fmtDay(job.visit_on)}{job.visit_window ? ' · ' + job.visit_window : ''}</p>}
      </div>
      <JobBody job={job} today={today} busy={busy} act={act} token={token} onPhoto={onPhoto} />
    </div>
  )
}

function JobBody({ job, today, busy, act, token, onPhoto }: {
  job: Job; today: string; busy: boolean; act: (b: any, c: string) => Promise<boolean>; token: string; onPhoto: () => void
}) {
  const [mode, setMode] = useState<null | 'propose' | 'done' | 'invoice' | 'ask'>(null)
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [amount, setAmount] = useState('')
  const [number, setNumber] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const upload = async (files: FileList | null) => {
    if (!files || !files.length) return
    setUploading(true)
    try {
      for (const f of Array.from(files).slice(0, 6)) {
        const fd = new FormData()
        fd.append('file', f); fd.append('vendorToken', token); fd.append('taskId', job.id); fd.append('phase', job.done ? 'after' : 'during')
        await fetch('/api/projects/photo', { method: 'POST', body: fd })
      }
      onPhoto()
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const Btn = ({ onClick, children, tone = 'plain', wide }: any) => (
    <button onClick={onClick} disabled={busy}
      className={'rounded-xl px-3 py-2.5 text-[13.5px] font-bold disabled:opacity-40 inline-flex items-center justify-center gap-1.5 ' +
        (wide ? 'w-full ' : '') +
        (tone === 'go' ? 'bg-emerald-600 text-white' : tone === 'dark' ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700')}>
      {children}
    </button>
  )

  return (
    <div className="px-4 py-3 space-y-3">
      <div>
        <p className="text-[15px] font-semibold leading-snug">{job.title}</p>
        {job.unit && <p className="text-[13px] text-slate-600 mt-0.5 inline-flex items-center gap-1"><MapPin size={12} />{job.unit}</p>}
      </div>

      {job.detail && <p className="text-[13.5px] text-slate-700 leading-relaxed whitespace-pre-wrap">{job.detail}</p>}

      <div className="flex items-center gap-3 flex-wrap text-[12.5px] text-slate-600">
        {job.est_minutes && <span className="inline-flex items-center gap-1"><Clock size={12} />About {mins(job.est_minutes)} on site</span>}
        {job.due_on && <span className="inline-flex items-center gap-1"><CalendarDays size={12} />Finish by {fmtShort(job.due_on)}</span>}
      </div>

      {job.done ? (
        <p className="text-[13.5px] font-semibold text-emerald-700 inline-flex items-center gap-1.5"><CheckCircle2 size={15} /> Marked finished — thank you.</p>
      ) : (
        <>
          {/* THE TWO TAPS THAT MATTER. Everything else on this page is secondary to these. */}
          {job.visit_on && !job.confirmed && !job.proposed_on && (
            <div className="grid grid-cols-2 gap-2">
              <Btn tone="go" onClick={() => act({ action: 'confirm', jobId: job.id }, 'Thanks — we have told the team you are coming.')}>
                <Check size={15} /> I&apos;ll be there
              </Btn>
              <Btn onClick={() => setMode(mode === 'propose' ? null : 'propose')}>Another day</Btn>
            </div>
          )}
          {job.confirmed && (
            <p className="text-[13px] font-semibold text-emerald-700 inline-flex items-center gap-1.5"><CheckCircle2 size={14} /> You confirmed this visit.</p>
          )}
          {job.proposed_on && (
            <p className="text-[13px] font-semibold text-amber-700 inline-flex items-center gap-1.5">
              <Clock size={14} /> You asked for {fmtShort(job.proposed_on)} — we will confirm.
            </p>
          )}

          {mode === 'propose' && (
            <div className="rounded-xl border border-slate-200 p-3 space-y-2">
              <p className="text-[12.5px] text-slate-600">What day works? We will confirm before telling the building.</p>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-[14px]" />
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Anything we should know (optional)"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-[14px]" />
              <Btn wide tone="dark" onClick={async () => { if (await act({ action: 'propose', jobId: job.id, date, note }, 'Sent — we will come back to you.')) { setMode(null); setNote(''); setDate('') } }}>
                Send it
              </Btn>
            </div>
          )}

          <Btn wide tone="go" onClick={() => setMode(mode === 'done' ? null : 'done')}><Check size={15} /> Mark it finished</Btn>

          {mode === 'done' && (
            <div className="rounded-xl border border-slate-200 p-3 space-y-2">
              <p className="text-[12.5px] text-slate-600">What did you do? This goes straight to the team.</p>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="Replaced the flush valve, tested, no leaks."
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-[14px]" />
              <Btn wide tone="go" onClick={async () => { if (await act({ action: 'done', jobId: job.id, note }, 'Marked finished — thank you.')) { setMode(null); setNote('') } }}>
                Finished
              </Btn>
            </div>
          )}
        </>
      )}

      {/* PHOTOS — proof the work happened, taken where it happened. */}
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-[13px] font-bold text-slate-700 inline-flex items-center gap-1.5 disabled:opacity-40">
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />} Add photos
          </button>
          {job.photos.length > 0 && <span className="text-[12.5px] text-slate-500">{job.photos.length} added</span>}
          <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={e => upload(e.target.files)} />
        </div>
        {job.photos.length > 0 && (
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {job.photos.map(ph => (
              <a key={ph.id} href={ph.url} target="_blank" rel="noreferrer" className="shrink-0">
                <img src={ph.url} alt={ph.caption || 'Photo'} className="w-20 h-20 object-cover rounded-lg border border-slate-200" />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* THE BILL. It arrives as received, never approved — that is not the payee's call. */}
      <div>
        <button onClick={() => setMode(mode === 'invoice' ? null : 'invoice')}
          className="text-[13px] font-bold text-slate-700 inline-flex items-center gap-1.5">
          <Receipt size={14} /> Send your invoice
        </button>
        {job.invoices.length > 0 && (
          <p className="text-[12.5px] text-slate-500 mt-1">
            {job.invoices.map(i => `${money(i.amount_cents)} — ${i.status}`).join(' · ')}
          </p>
        )}
        {mode === 'invoice' && (
          <div className="mt-2 rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount"
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-[14px] font-semibold" />
              <input value={number} onChange={e => setNumber(e.target.value)} placeholder="Invoice #"
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-[14px]" />
            </div>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="What it covers"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-[14px]" />
            <Btn wide tone="dark" onClick={async () => { if (await act({ action: 'invoice', jobId: job.id, amount, number, note }, 'Invoice received — thank you.')) { setMode(null); setAmount(''); setNumber(''); setNote('') } }}>
              Send it
            </Btn>
            <p className="text-[11.5px] text-slate-500">You can also photograph the invoice with Add photos above.</p>
          </div>
        )}
      </div>

      {/* MESSAGES — only this job, only this vendor. */}
      {job.messages.length > 0 && (
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
          {job.messages.slice(-6).map((m, i) => (
            <div key={i}>
              <p className="text-[11px] font-semibold text-slate-500">{m.author || 'Stay Hospitality'}</p>
              <p className="text-[13px] text-slate-800 whitespace-pre-wrap">{m.body}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input value={mode === 'ask' ? note : ''} onFocus={() => setMode('ask')} onChange={e => { setMode('ask'); setNote(e.target.value) }}
          placeholder="Message the team…" className="flex-1 min-w-0 rounded-xl border border-slate-300 px-3 py-2.5 text-[14px]" />
        <button onClick={async () => { if (await act({ action: 'comment', jobId: job.id, body: note }, 'Sent.')) { setNote(''); setMode(null) } }}
          disabled={busy || mode !== 'ask' || !note.trim()}
          className="shrink-0 rounded-xl bg-slate-900 text-white px-3 py-2.5 disabled:opacity-30"><Send size={15} /></button>
      </div>
    </div>
  )
}
