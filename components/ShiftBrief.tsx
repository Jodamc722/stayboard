'use client'
// THE SHIFT BRIEF PANEL (lib/shift-brief, /api/brief) — opened from the "Brief" pill beside the alerts
// bell in the floater, so it is with you on every page (Jon, 2026-10-07: "a brief feature that stays
// active, like a checklist … that they can review and close out and pass things over").
//   Mine      tick off, add a note, pass over (to a person or the incoming shift) — passed-in items
//             show who handed them over and what they said
//   Incoming  the pool the last shift left; Claim moves an item into your brief
//   Close out shift — only when nothing of yours is still open; optional post to #vr-customercareteam
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Check, X, Loader2, Plus, ArrowRightLeft, MessageSquare, Hand, ClipboardCheck, Trash2 } from 'lucide-react'
import type { BriefItem, Closeout } from '@/lib/shift-brief'

type Res = { ok: boolean; me: string; mine: BriefItem[]; pool: BriefItem[]; lastCloseout: Closeout | null; lastTeamCloseout: Closeout | null; team?: { email: string; name: string }[]; error?: string }

let state: Res | null = null
let team: { email: string; name: string }[] = []
const subs = new Set<() => void>()
const emit = () => subs.forEach(f => f())
async function load(withTeam = false) {
  try { const r = await fetch('/api/brief' + (withTeam ? '?team=1' : ''), { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (j.team) team = j.team; state = { ...(state || {} as any), ...j }; emit() } } catch { /* keep */ }
}
async function act(body: any): Promise<void> {
  const r = await fetch('/api/brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.ok === false) throw new Error(j.error || 'Could not save')
  state = { ...(state || {} as any), ...j }; emit()
}
export function useBrief(): Res | null {
  const v = useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f) } }, () => state, () => null)
  useEffect(() => {
    if (!state) load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 90_000)
    return () => clearInterval(t)
  }, [])
  return v
}
/** Open items of mine, and how many were passed to me that I haven't looked at. */
export function briefCounts(s: Res | null) {
  const open = (s?.mine || []).filter(i => i.status === 'open')
  return { open: open.length, fresh: open.filter(i => i.from && !i.seenByOwner).length, pool: (s?.pool || []).length }
}

const when = (iso?: string | null) => { if (!iso) return ''; const d = new Date(iso); return d.toLocaleString('en-US', d.toDateString() === new Date().toDateString() ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' }) }

export function BriefPanel({ onClose }: { onClose: () => void }) {
  const s = useBrief()
  const [tab, setTab] = useState<'mine' | 'pool' | 'close'>('mine')
  const [text, setText] = useState('')
  const [unit, setUnit] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { load(true); act({ action: 'seen' }).catch(() => {}) }, [])
  const run = async (k: string, body: any) => { setBusy(k); setErr(''); try { await act(body) } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy('') } }
  if (!s) return <div className="p-6 text-center"><Loader2 size={16} className="animate-spin inline text-muted" /></div>
  const c = briefCounts(s)
  const tabCls = (on: boolean) => 'text-[12.5px] font-semibold px-2.5 h-8 rounded-lg ' + (on ? 'bg-ink text-white' : 'text-muted hover:text-ink')
  return (
    <div>
      <div className="px-4 pt-3.5 pb-2.5 border-b border-line">
        <div className="flex items-center gap-2">
          <h2 className="lh-display text-[20px] leading-none text-ink flex-1">Shift brief</h2>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-ink hover:bg-slate-100"><X size={15} /></button>
        </div>
        <div className="flex gap-1 mt-2.5">
          <button onClick={() => setTab('mine')} className={tabCls(tab === 'mine')}>Mine{c.open ? ' · ' + c.open : ''}</button>
          <button onClick={() => setTab('pool')} className={tabCls(tab === 'pool')}>Incoming{c.pool ? ' · ' + c.pool : ''}</button>
          <button onClick={() => setTab('close')} className={tabCls(tab === 'close')}>Close out shift</button>
        </div>
      </div>
      {err && <p className="px-4 pt-2 text-[12px] text-rose-700">{err}</p>}

      {tab === 'mine' && (
        <div className="px-4 py-3">
          <form onSubmit={e => { e.preventDefault(); if (!text.trim()) return; run('add', { action: 'add', item: { text, unit } }).then(() => { setText(''); setUnit('') }) }} className="flex gap-1.5">
            <input value={text} onChange={e => setText(e.target.value)} placeholder="Add something to keep on top of…" className="flex-1 min-w-0 text-[13px] rounded-lg border border-line px-2.5 py-2 focus:outline-none focus:border-ink/40" />
            <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="Unit" className="w-[76px] text-[13px] rounded-lg border border-line px-2 py-2 focus:outline-none focus:border-ink/40" />
            <button disabled={!text.trim() || !!busy} className="rounded-lg bg-ink text-white px-2.5 disabled:opacity-40" aria-label="Add">{busy === 'add' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} />}</button>
          </form>
          {!s.mine.length && <p className="text-[12.5px] text-muted py-5 text-center">Nothing on your brief. Add what you need to keep on top of, or claim something from Incoming.</p>}
          <ul className="mt-2.5 space-y-1.5">{s.mine.map(i => <Row key={i.id} i={i} busy={busy} run={run} />)}</ul>
        </div>
      )}

      {tab === 'pool' && (
        <div className="px-4 py-3">
          {s.lastTeamCloseout && s.lastTeamCloseout.byEmail !== s.me && <p className="text-[12px] text-muted mb-2">Last close-out: {s.lastTeamCloseout.by}, {when(s.lastTeamCloseout.at)}{s.lastTeamCloseout.note ? ' — “' + s.lastTeamCloseout.note + '”' : ''}</p>}
          {!s.pool.length && <p className="text-[12.5px] text-muted py-5 text-center">Nothing waiting for the incoming shift.</p>}
          <ul className="space-y-1.5">
            {s.pool.map(i => (
              <li key={i.id} className="rounded-xl border border-line px-3 py-2">
                <div className="text-[13px] text-ink">{i.text}{i.unit ? <span className="text-muted"> · {i.unit}</span> : null}</div>
                {i.from && <div className="text-[11.5px] text-muted mt-0.5">from {i.from}{i.passNote ? ': “' + i.passNote + '”' : ''} · {when(i.history[i.history.length - 1]?.at)}</div>}
                <button disabled={!!busy} onClick={() => run('c' + i.id, { action: 'claim', id: i.id })} className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-ink text-white px-2.5 h-7 text-[12px] font-semibold disabled:opacity-40">{busy === 'c' + i.id ? <Loader2 size={12} className="animate-spin" /> : <Hand size={12} />} I&apos;ve got it</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'close' && <CloseOut s={s} busy={busy} run={run} onDone={() => setTab('mine')} />}
    </div>
  )
}

function Row({ i, busy, run }: { i: BriefItem; busy: string; run: (k: string, b: any) => Promise<void> }) {
  const [mode, setMode] = useState<null | 'pass' | 'note'>(null)
  const [to, setTo] = useState('pool')
  const [note, setNote] = useState('')
  const done = i.status === 'done'
  const notes = i.history.filter(h => h.what === 'note')
  const fresh = !!i.from && !i.seenByOwner && !done
  return (
    <li className={'rounded-xl border px-3 py-2 ' + (fresh ? 'border-amber-300 bg-amber-50/40' : 'border-line')}>
      <div className="flex items-start gap-2.5">
        <button onClick={() => run('t' + i.id, { action: 'tick', id: i.id })} aria-label={done ? 'Mark not done' : 'Mark done'}
          className={'mt-0.5 w-[18px] h-[18px] shrink-0 rounded-full border-2 flex items-center justify-center ' + (done ? 'border-emerald-600 bg-emerald-600' : 'border-slate-300 hover:border-ink')}>
          {done && <Check size={11} className="text-white" strokeWidth={3} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className={'text-[13px] ' + (done ? 'line-through text-muted' : 'text-ink')}>{i.text}{i.unit ? <span className="text-muted"> · {i.unit}</span> : null}</div>
          {i.from && !done && <div className="text-[11.5px] text-amber-800 mt-0.5">from {i.from}{i.passNote ? ': “' + i.passNote + '”' : ''}</div>}
          {notes.slice(-2).map((h, k) => <div key={k} className="text-[11.5px] text-muted mt-0.5">{h.by}: {h.note}</div>)}
          {done && i.doneBy && <div className="text-[11px] text-muted">done {when(i.doneAt)}</div>}
        </div>
        {!done && (
          <div className="flex gap-0.5 shrink-0">
            <button onClick={() => setMode(m => m === 'note' ? null : 'note')} title="Add a note" className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-ink hover:bg-slate-100"><MessageSquare size={13} /></button>
            <button onClick={() => { setMode(m => m === 'pass' ? null : 'pass'); if (!team.length) load(true) }} title="Pass it over" className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-ink hover:bg-slate-100"><ArrowRightLeft size={13} /></button>
            <button onClick={() => run('r' + i.id, { action: 'remove', id: i.id })} title="Remove (added by mistake)" className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-rose-600 hover:bg-slate-100"><Trash2 size={13} /></button>
          </div>
        )}
      </div>
      {mode === 'note' && (
        <form onSubmit={e => { e.preventDefault(); if (note.trim()) run('n' + i.id, { action: 'note', id: i.id, note }).then(() => { setNote(''); setMode(null) }) }} className="flex gap-1.5 mt-2">
          <input autoFocus value={note} onChange={e => setNote(e.target.value)} placeholder="Where it stands…" className="flex-1 min-w-0 text-[12.5px] rounded-lg border border-line px-2.5 py-1.5" />
          <button className="rounded-lg bg-ink text-white px-2.5 text-[12px] font-semibold">Save</button>
        </form>
      )}
      {mode === 'pass' && (
        <form onSubmit={e => { e.preventDefault(); run('p' + i.id, { action: 'pass', id: i.id, to, note }).then(() => setMode(null)) }} className="mt-2 space-y-1.5">
          <select value={to} onChange={e => setTo(e.target.value)} className="w-full text-[12.5px] rounded-lg border border-line px-2 py-1.5 bg-white">
            <option value="pool">The incoming shift (anyone can claim it)</option>
            {team.map(t => <option key={t.email} value={t.email}>{t.name}</option>)}
          </select>
          <div className="flex gap-1.5">
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="What they need to know…" className="flex-1 min-w-0 text-[12.5px] rounded-lg border border-line px-2.5 py-1.5" />
            <button disabled={!!busy} className="rounded-lg bg-ink text-white px-2.5 text-[12px] font-semibold inline-flex items-center gap-1">{busy === 'p' + i.id ? <Loader2 size={12} className="animate-spin" /> : <ArrowRightLeft size={12} />} Pass</button>
          </div>
        </form>
      )}
    </li>
  )
}

function CloseOut({ s, busy, run, onDone }: { s: Res; busy: string; run: (k: string, b: any) => Promise<void>; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [slack, setSlack] = useState(true)
  const open = s.mine.filter(i => i.status === 'open')
  const done = s.mine.filter(i => i.status === 'done')
  return (
    <div className="px-4 py-3 space-y-3">
      {open.length > 0 ? (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5">
          <div className="text-[13px] font-semibold text-amber-900">{open.length} still open</div>
          <p className="text-[12px] text-amber-900/80">Tick each one off, or pass it to someone or the incoming shift, before you close out.</p>
          <ul className="mt-2 space-y-1.5">{open.map(i => <Row key={i.id} i={i} busy={busy} run={run} />)}</ul>
        </div>
      ) : (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2.5 text-[13px] text-emerald-900 inline-flex items-center gap-2 w-full"><ClipboardCheck size={15} /> Everything is done or passed over.</div>
      )}
      {done.length > 0 && <div><div className="text-[12px] text-muted mb-1">Done this shift</div><ul className="text-[12.5px] text-ink space-y-0.5">{done.map(i => <li key={i.id}>✓ {i.text}</li>)}</ul></div>}
      <label className="block"><span className="text-[12px] text-muted">Note for the next shift (optional)</span><textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="w-full text-[13px] rounded-lg border border-line px-2.5 py-2 focus:outline-none focus:border-ink/40" /></label>
      <label className="text-[12.5px] text-ink inline-flex items-center gap-1.5"><input type="checkbox" checked={slack} onChange={e => setSlack(e.target.checked)} /> Post the close-out to #vr-customercareteam</label>
      <div className="flex justify-end">
        <button disabled={open.length > 0 || !!busy} onClick={() => run('close', { action: 'closeout', note, slack }).then(onDone)} className="rounded-lg bg-ink text-white px-4 h-9 text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-40">{busy === 'close' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Close out my shift</button>
      </div>
      {s.lastCloseout && <p className="text-[11.5px] text-muted">Your last close-out: {when(s.lastCloseout.at)} · {s.lastCloseout.done.length} done, {s.lastCloseout.passed.length} passed over.</p>}
    </div>
  )
}
