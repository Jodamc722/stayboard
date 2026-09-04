'use client'
// TEAM SCHEDULE LINKS — the desk (Jon, 2026-09-03). Mint a link per market, watch submissions come
// in, send notes back. Reviewing the actual picks happens on /schedule, where they show as staged.
import { useEffect, useMemo, useState } from 'react'
import { Plus, Copy, Check, ExternalLink, Loader2, Ban, Link2, MessageSquare, ChevronDown, Mail, KeyRound } from 'lucide-react'

type Lnk = { id: string; code: string; market: string; label: string | null; passcode: string | null; created_at: string; revoked_at: string | null }
type Sub = { id: string; link_code: string; market: string; week_start: string; week_end: string; submitted_by: string | null; note: string | null; snapshot: any[]; status: string; feedback: string | null; reviewed_at: string | null; emailed_at: string | null; created_at: string }

const BTN = 'inline-flex items-center gap-1.5 rounded-xl font-bold text-[13px] min-h-[38px] px-3.5 disabled:opacity-50'
const INPUT = 'rounded-xl border border-line bg-white px-3 py-2.5 text-[14px] focus:outline-none focus:border-ink'
const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const fmtD = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export function ScheduleLinksDesk() {
  const [links, setLinks] = useState<Lnk[]>([])
  const [subs, setSubs] = useState<Sub[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [market, setMarket] = useState('Miami')
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async () => {
    try { const r = await fetch('/api/schedule/links', { cache: 'no-store' }); const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || 'Could not load'); setLinks(j.links); setSubs(j.submissions); setErr('') } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])
  const post = async (body: any) => { setBusy(true); try { const r = await fetch('/api/schedule/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || 'failed'); await load(); return j } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(false) } }
  const active = links.filter(l => !l.revoked_at)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <div className="space-y-5">
      {err && <p className="text-[13px] text-rose-600 font-semibold">{err}</p>}
      <section className="rounded-2xl border border-line bg-white p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-bold text-ink">Links</span>
          <span className="text-[12.5px] text-muted">one per market for the team leads · an "All markets" link is the ops review view (every market, sortable by day / area / building / cleaner / market)</span>
        </div>
        <div className="mt-3 space-y-2">
          {loading && <div className="text-[13px] text-muted"><Loader2 size={14} className="animate-spin inline mr-1" /> Loading…</div>}
          {!loading && !active.length && <div className="text-[13px] text-muted">No links yet.</div>}
          {active.map(l => <LinkRow key={l.id} l={l} origin={origin} onPasscode={(pc) => post({ action: 'passcode', id: l.id, passcode: pc })} onRevoke={() => { if (confirm('Revoke the ' + l.market + ' link? The team will lose access until you make a new one.')) post({ action: 'revoke', id: l.id }) }} />)}
        </div>
        <div className="mt-4 pt-3 border-t border-line flex items-center gap-2 flex-wrap">
          <select value={market} onChange={e => setMarket(e.target.value)} className={INPUT}>{['Miami', 'Broward', 'North', 'All'].map(m => <option key={m} value={m}>{m === 'All' ? 'All markets (ops review)' : m}</option>)}</select>
          <input value={passcode} onChange={e => setPasscode(e.target.value)} placeholder="Passcode (optional)" className={INPUT + ' w-44'} />
          <button disabled={busy} onClick={async () => { await post({ action: 'create', market, passcode }); setPasscode('') }} className={BTN + ' bg-ink text-white'}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} New {market === 'All' ? 'ops review' : market} link</button>
          <span className="text-[12px] text-muted">A passcode is a second lock if the link gets forwarded; without one the link alone opens it.</span>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2">
          <span className="text-[14px] font-bold text-ink">Submissions</span>
          <span className="text-[12.5px] text-muted">{subs.filter(s => s.status !== 'reviewed').length} waiting for review · teams submit the next day each evening, or a whole week</span>
        </div>
        {!subs.length && <div className="px-4 py-8 text-center text-[13px] text-muted">Nothing submitted yet. When a team presses Submit you get an email and it shows here.</div>}
        <div className="divide-y divide-line">{subs.map(s => <SubRow key={s.id} s={s} busy={busy} onFeedback={(fb) => post({ action: 'feedback', id: s.id, feedback: fb })} onReviewed={() => post({ action: 'reviewed', id: s.id })} />)}</div>
      </section>
    </div>
  )
}

function LinkRow({ l, origin, onPasscode, onRevoke }: { l: Lnk; origin: string; onPasscode: (pc: string) => Promise<any>; onRevoke: () => void }) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [pc, setPc] = useState(l.passcode || '')
  const url = origin + '/scheduler/' + l.code
  return (
    <div className="flex items-center gap-2 flex-wrap rounded-xl border border-line px-3 py-2">
      <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-ink text-white">{l.market}</span>
      <span className="text-[13px] font-semibold text-ink">{l.label || l.market + ' team schedule'}</span>
      <code className="text-[12px] text-muted truncate max-w-[340px]">{url}</code>
      {editing ? (
        <span className="inline-flex items-center gap-1"><input value={pc} onChange={e => setPc(e.target.value)} className={INPUT + ' w-36 py-1.5 text-[13px]'} placeholder="Passcode (blank = none)" autoFocus onKeyDown={async e => { if (e.key === 'Enter') { await onPasscode(pc); setEditing(false) } if (e.key === 'Escape') setEditing(false) }} /><button onClick={async () => { await onPasscode(pc); setEditing(false) }} className={BTN + ' bg-ink text-white min-h-[32px] px-2.5 text-[12px]'}>Save</button></span>
      ) : (
        <button onClick={() => setEditing(true)} className="text-[11.5px] text-muted inline-flex items-center gap-1 hover:text-ink"><KeyRound size={11} /> {l.passcode ? <>passcode <b className="text-ink">{l.passcode}</b></> : 'no passcode — add one'}</button>
      )}
      <span className="ml-auto flex items-center gap-1.5">
        <button onClick={async () => { try { await navigator.clipboard.writeText(url + (l.passcode ? '  (passcode: ' + l.passcode + ')' : '')); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {} }} className={BTN + ' border border-line bg-white text-ink'}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy link'}</button>
        <a href={'/scheduler/' + l.code} target="_blank" rel="noreferrer" className={BTN + ' border border-line bg-white text-ink'}>Open <ExternalLink size={13} /></a>
        <button onClick={onRevoke} className="w-9 h-9 rounded-lg border border-line bg-white text-muted grid place-items-center" aria-label="Revoke"><Ban size={14} /></button>
      </span>
    </div>
  )
}

function SubRow({ s, busy, onFeedback, onReviewed }: { s: Sub; busy: boolean; onFeedback: (fb: string) => Promise<any>; onReviewed: () => Promise<any> }) {
  const [open, setOpen] = useState(false)
  const [fb, setFb] = useState(s.feedback || '')
  const snap: any[] = Array.isArray(s.snapshot) ? s.snapshot : []
  const unassigned = snap.filter(x => !x.cleaner).length
  const byDay = useMemo(() => { const m: Record<string, any[]> = {}; for (const x of snap) (m[x.date] = m[x.date] || []).push(x); return Object.keys(m).sort().map(d => ({ date: d, rows: m[d] })) }, [snap])
  return (
    <div className="px-4 py-3">
      <button onClick={() => setOpen(o => !o)} className="w-full text-left flex items-center gap-2 flex-wrap">
        <ChevronDown size={14} className={'text-muted transition-transform ' + (open ? '' : '-rotate-90')} />
        <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-ink text-white">{s.market}</span>
        <span className="text-[14px] font-bold text-ink">{s.week_start === s.week_end ? new Date(s.week_start + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Week of ' + fmtD(s.week_start)}</span>
        <span className="text-[12.5px] text-muted">{fmt(s.created_at)}{s.submitted_by ? ' · by ' + s.submitted_by : ''} · {snap.length} cleans · <span className={unassigned ? 'text-amber-700 font-semibold' : 'text-emerald-700 font-semibold'}>{unassigned ? unassigned + ' unassigned' : 'all assigned'}</span></span>
        <span className={'ml-auto text-[11px] font-bold uppercase px-2 py-0.5 rounded ' + (s.status === 'reviewed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800')}>{s.status === 'reviewed' ? 'Reviewed' : 'To review'}</span>
        {s.emailed_at && <Mail size={12} className="text-muted" />}
      </button>
      {s.note && <div className="mt-2 ml-6 rounded-lg bg-brand-50 border border-brand-200 px-3 py-2 text-[13px] text-brand-950"><b>Team note:</b> {s.note}</div>}
      {open && (
        <div className="mt-3 ml-6 space-y-3">
          <div className="rounded-xl border border-line overflow-hidden text-[13px]">
            {byDay.map(d => (
              <div key={d.date}>
                <div className="px-3 py-1.5 bg-ink/5 font-bold text-ink text-[12px]">{d.rows[0]?.dow} {fmtD(d.date)} · {d.rows.length}</div>
                {d.rows.map((x: any, i: number) => <div key={i} className="px-3 py-1.5 flex items-center gap-2 border-t border-line"><span className="flex-1 text-ink">{x.unit}{x.sameDayTurn ? <span className="ml-1.5 text-[10px] font-bold uppercase text-amber-800">same-day</span> : null}</span><span className="text-muted text-[12px]">{x.checkOutTime ? 'out ' + x.checkOutTime : ''}</span><span className={'font-semibold ' + (x.cleaner ? 'text-emerald-800' : 'text-rose-700')}>{x.cleaner || 'unassigned'}</span></div>)}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[12.5px]"><a href={'/schedule?date=' + s.week_start} className="font-semibold text-brand-700 inline-flex items-center gap-1"><Link2 size={13} /> Open this week on the Scheduler</a><span className="text-muted">— the team's picks are there as staged; push to Breezeway from the board.</span></div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1 inline-flex items-center gap-1"><MessageSquare size={12} /> Notes back to the team</label>
            <textarea value={fb} onChange={e => setFb(e.target.value)} rows={3} className={INPUT + ' w-full'} placeholder="What to change, who to swap, what looked good. The team sees this the next time they open their link." />
            <div className="flex gap-2 mt-2">
              <button disabled={busy || !fb.trim()} onClick={() => onFeedback(fb)} className={BTN + ' bg-ink text-white'}>{busy ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />} Send notes & mark reviewed</button>
              {s.status !== 'reviewed' && <button disabled={busy} onClick={onReviewed} className={BTN + ' border border-line bg-white text-ink'}><Check size={14} /> Looks good — mark reviewed</button>}
              {s.reviewed_at && <span className="text-[12px] text-muted self-center">reviewed {fmt(s.reviewed_at)}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
