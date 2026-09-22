'use client'
// TRAIN THE REFUND ADVISOR (Jon, 2026-09-22). Two things teach it: house guidance in plain English,
// and real glitches saved as precedent with what we paid and why. Everyone with money access can
// read this; admins and glitch-board leads can change it. The advisor reads all of it on every
// recommendation. See lib/refund-training.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Trash2, GraduationCap } from 'lucide-react'

type Case = {
  id: string; glitchId: string; unit: string; category: string; channel: string
  nights: number; nightly: number; what: string; recommended: number | null; paid: number
  lesson: string; savedBy: string; savedAt: string
}

const money = (n: number | null | undefined) => n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString()

export function RefundTraining({ compact }: { compact?: boolean }) {
  const [d, setD] = useState<{ guidance: string; cases: Case[]; canTrain: boolean; updatedBy?: string; updatedAt?: string } | null>(null)
  const [err, setErr] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/glitches/training', { cache: 'no-store' }).then(x => x.json())
      if (!r?.ok) { setErr(r?.message || r?.error || 'Could not load the training.'); return }
      setD(r); setText(r.guidance || ''); setErr('')
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (body: any, ok: string) => {
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/glitches/training', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(x => x.json())
      if (!r?.ok) { setMsg(r?.message || r?.error || 'Could not save.'); setBusy(false); return }
      setD(r); setText(r.guidance || ''); setMsg(ok)
    } catch (e: any) { setMsg(String(e?.message || e)) }
    setBusy(false)
  }

  if (err) return <p className="text-[13px] text-rose-700">{err}</p>
  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Loading…</p>
  const edit = d.canTrain

  return (
    <div className="space-y-4">
      {!compact ? (
        <p className="text-[13px] text-muted">
          What you write here is read by the refund advisor on every glitch. It steers how a case is
          classified — severity, where in the band, how to read the fix — and the policy still does the
          arithmetic, so the same facts always give the same number.
          {edit ? '' : ' Only an admin or a glitch-board lead can change it.'}
        </p>
      ) : null}

      <section className="rounded-xl ring-1 ring-line bg-white px-3.5 py-3">
        <p className="text-[11px] uppercase tracking-wider font-bold text-muted">House guidance</p>
        <p className="text-[12px] text-muted mt-0.5">Plain rules, one per line. e.g. “A lockout fixed inside an hour is an apology, not money.” “Vrbo guests escalate fast — lean to the top of the band.”</p>
        <textarea value={text} onChange={e => setText(e.target.value)} disabled={!edit} rows={compact ? 6 : 9}
          placeholder={edit ? 'Write the rules the team actually follows…' : 'Nothing written yet.'}
          className="mt-2 w-full text-[13px] leading-relaxed border border-line rounded-lg px-2.5 py-2 bg-white disabled:bg-app" />
        {edit ? (
          <div className="flex items-center gap-2 mt-1.5">
            <button onClick={() => post({ op: 'guidance', text }, 'Guidance saved — the next recommendation reads it.')} disabled={busy || text === (d.guidance || '')}
              className="text-[12.5px] font-bold px-3 h-9 rounded-xl bg-ink text-white disabled:bg-line disabled:text-faint">
              {busy ? 'Saving…' : 'Save guidance'}
            </button>
            {d.updatedBy ? <span className="text-[11.5px] text-muted">Last changed by {String(d.updatedBy).split('@')[0]}{d.updatedAt ? ' · ' + new Date(d.updatedAt).toLocaleDateString() : ''}</span> : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-xl ring-1 ring-line bg-white px-3.5 py-3">
        <p className="text-[11px] uppercase tracking-wider font-bold text-muted">Saved cases ({d.cases.length})</p>
        <p className="text-[12px] text-muted mt-0.5">Real glitches kept as precedent. Save one from a glitch’s Money tab (“Teach the advisor”). The advisor sees the closest ones — same category first.</p>
        {d.cases.length === 0 ? (
          <p className="text-[12.5px] text-muted mt-2">None yet.</p>
        ) : (
          <div className="mt-2 divide-y divide-line">
            {d.cases.map(c => <CaseRow key={c.id} c={c} edit={edit} busy={busy}
              onSave={(patch) => post({ op: 'update-case', id: c.id, ...patch }, 'Case updated.')}
              onDelete={() => { if (window.confirm('Remove this case from the training?')) post({ op: 'delete-case', id: c.id }, 'Case removed.') }} />)}
          </div>
        )}
      </section>
      {msg ? <p className="text-[12px] font-semibold text-emerald-700">{msg}</p> : null}
    </div>
  )
}

function CaseRow({ c, edit, busy, onSave, onDelete }: { c: Case; edit: boolean; busy: boolean; onSave: (p: any) => void; onDelete: () => void }) {
  const [lesson, setLesson] = useState(c.lesson)
  const [paid, setPaid] = useState(String(c.paid))
  const dirty = lesson !== c.lesson || paid !== String(c.paid)
  const pct = c.nightly && c.nights ? Math.round((c.paid / (c.nightly * c.nights)) * 100) : null
  return (
    <div className="py-2.5">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] font-bold text-ink">{c.unit || 'Unit'} · {c.category || 'uncategorised'}{c.channel ? ' · ' + c.channel : ''}{c.nights ? ' · ' + c.nights + ' nights' : ''}</p>
          <p className="text-[12.5px] text-ink/85 mt-0.5">{c.what}</p>
          <p className="text-[12px] text-muted mt-0.5">
            Paid <b className="text-ink">{money(c.paid)}</b>{pct != null ? ' (' + pct + '% of the stay)' : ''}
            {c.recommended != null ? ' · advisor had said ' + money(c.recommended) : ''}
            {' · saved by ' + String(c.savedBy || '').split('@')[0]}
          </p>
        </div>
        {edit ? <button onClick={onDelete} title="Remove" className="text-muted hover:text-rose-700 p-1"><Trash2 size={14} /></button> : null}
      </div>
      {edit ? (
        <div className="mt-1.5 flex items-start gap-1.5 flex-wrap">
          <input value={paid} onChange={e => setPaid(e.target.value)} inputMode="decimal" className="text-[12px] border border-line rounded px-2 py-1.5 w-24" />
          <textarea value={lesson} onChange={e => setLesson(e.target.value)} rows={2} placeholder="The lesson — why this is the right number"
            className="text-[12px] border border-line rounded px-2 py-1.5 flex-1 min-w-[200px]" />
          {dirty ? <button onClick={() => onSave({ lesson, paid })} disabled={busy} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-ink text-white">Save</button> : null}
        </div>
      ) : c.lesson ? <p className="text-[12px] text-ink mt-1"><span className="font-semibold">Lesson:</span> {c.lesson}</p> : null}
    </div>
  )
}

/** The small form on a glitch: save this case as precedent. */
export function TeachFromGlitch({ glitchId, paidDefault, onDone }: { glitchId: string; paidDefault: number | null; onDone?: () => void }) {
  const [paid, setPaid] = useState(paidDefault != null ? String(paidDefault) : '')
  const [lesson, setLesson] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const save = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/glitches/training', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'save-case', glitchId, paid, lesson }) }).then(x => x.json())
      if (!r?.ok) { setMsg(r?.message || r?.error || 'Could not save.'); setBusy(false); return }
      setMsg('Saved. The advisor will use this case as precedent.'); setLesson(''); onDone?.()
    } catch (e: any) { setMsg(String(e?.message || e)) }
    setBusy(false)
  }
  return (
    <section className="rounded-xl ring-1 ring-violet-200 bg-violet-50/60 px-3.5 py-3">
      <p className="text-[12.5px] font-bold text-violet-900 inline-flex items-center gap-1.5"><GraduationCap size={14} /> Teach the advisor</p>
      <p className="text-[12px] text-violet-900/80 mt-0.5">Save this glitch as precedent: what the right amount was, and why. The advisor reads it on similar cases.</p>
      <div className="mt-2 flex items-start gap-1.5 flex-wrap">
        <input value={paid} onChange={e => setPaid(e.target.value)} inputMode="decimal" placeholder="Right amount $" className="text-[12px] border border-violet-200 rounded px-2 py-1.5 w-28 bg-white" />
        <textarea value={lesson} onChange={e => setLesson(e.target.value)} rows={2} placeholder="Why — e.g. “fixed in 3 hours with a portable unit; the stay was fine, $0 was right”"
          className="text-[12px] border border-violet-200 rounded px-2 py-1.5 flex-1 min-w-[200px] bg-white" />
        <button onClick={save} disabled={busy || !paid.trim() || !lesson.trim()} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-violet-700 text-white disabled:opacity-40">
          {busy ? 'Saving…' : 'Save case'}
        </button>
      </div>
      {msg ? <p className="text-[12px] font-semibold text-violet-900 mt-1">{msg}</p> : null}
    </section>
  )
}
