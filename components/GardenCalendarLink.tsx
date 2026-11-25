'use client'
// THE CALENDAR LINK'S SWITCHBOARD (lib/garden/calendar-link) — Jon, 2026-11-24. A Botanica room booked in
// Guesty is blocked in Cloudbeds, and a room held in Cloudbeds is closed in Guesty, for the rooms listed
// here. Everything starts off: no rooms linked, no instant notifications. Each switch is a person's click.
import { useCallback, useEffect, useState } from 'react'
import { Link2, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { LeanSection, Tag } from '@/components/lean'

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : 'never'
const post = (url: string, body: any, method = 'POST') => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }))

export function GardenCalendarLink({ owner }: { owner: boolean }) {
  const [d, setD] = useState<any>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [add, setAdd] = useState('')
  const [showLog, setShowLog] = useState(false)
  const [showAudit, setShowAudit] = useState(false)
  const load = useCallback(async () => setD(await fetch('/api/garden/calendar-link', { cache: 'no-store' }).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }))), [])
  useEffect(() => { load() }, [load])
  if (!d) return <LeanSection title="Guesty ⇄ Cloudbeds calendar link"><p className="text-[12.5px] text-muted inline-flex items-center gap-2 px-1"><Loader2 size={13} className="animate-spin" /> Reading…</p></LeanSection>
  if (!d.ok) return <LeanSection title="Guesty ⇄ Cloudbeds calendar link"><p className="text-[12.5px] text-rose-700 px-1">{d.error || 'Could not read the link.'}</p></LeanSection>
  const linked: string[] = d.settings.rooms || [], N = d.notifications
  const A = d.settings.audit, C = A?.counts || {}, pending = Object.entries(d.settings.pending || {})
  const run = async (key: string, f: () => Promise<any>, done: (r: any) => string) => { setBusy(key); setMsg(''); const r = await f(); setMsg(r?.ok === false ? (r.error || r.message || 'That did not work.') : done(r)); setBusy(''); load() }
  const setRooms = (rooms: string[]) => run('link', () => post('/api/garden/calendar-link', { op: 'link', rooms }), r => `${(r.settings?.rooms || []).length} room${(r.settings?.rooms || []).length === 1 ? '' : 's'} on the link.`)
  const btn = 'text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app disabled:opacity-50'
  return (
    <LeanSection title="Guesty ⇄ Cloudbeds calendar link" right={<Tag tone={linked.length ? 'emerald' : 'slate'}>{linked.length ? `on for ${linked.length} room${linked.length === 1 ? '' : 's'}` : 'off'}</Tag>}>
      <div className="rounded-xl border border-line bg-white p-3.5 text-[12.5px] space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-36 shrink-0 text-muted">Linked rooms</span>
          {linked.length ? linked.map(r => <span key={r} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 font-semibold text-ink">{r}{owner ? <button onClick={() => setRooms(linked.filter(x => x !== r))} disabled={!!busy} aria-label={`Take room ${r} off the link`} className="text-muted hover:text-rose-700"><X size={12} /></button> : null}</span>) : <span className="text-muted">none, so nothing is written to either system</span>}
          {owner ? <span className="inline-flex items-center gap-1.5">
            <select value={add} onChange={e => setAdd(e.target.value)} aria-label="Room to link" className="text-[12px] font-semibold border border-line rounded-lg pl-2 pr-1 py-1.5 bg-white text-ink outline-none"><option value="">Add a room…</option>{(d.rooms || []).filter((r: any) => !linked.includes(r.room)).map((r: any) => <option key={r.room} value={r.room}>{r.room}{r.virtualId ? '' : ' (no virtual room)'}</option>)}</select>
            <button className={btn} disabled={!add || !!busy} onClick={() => { setRooms([...linked, add]); setAdd('') }}>Link</button>
          </span> : null}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-36 shrink-0 text-muted">Instant from Guesty</span>
          <Tag tone={N.guesty.bookings ? 'emerald' : 'slate'}>{N.guesty.bookings ? 'on' : N.guesty.connected ? 'messages only' : 'not connected'}</Tag>
          {owner && N.guesty.connected && !N.guesty.bookings ? <button className={btn} disabled={!!busy} onClick={() => run('gy', () => post('/api/garden/calendar-link', { op: 'enable_guesty_events' }), () => 'Guesty now tells Lighthouse about bookings and calendar changes.')}>Switch on bookings</button> : null}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-36 shrink-0 text-muted">Instant from Cloudbeds</span>
          <Tag tone={N.cloudbeds.subscribed ? 'emerald' : 'slate'}>{N.cloudbeds.subscribed ? `on · last ${when(N.cloudbeds.lastEventAt)}` : 'off (every 30 minutes instead)'}</Tag>
          {owner && !N.cloudbeds.subscribed ? <button className={btn} disabled={!!busy} onClick={() => run('cb', () => post('/api/garden/cloudbeds/webhook', { op: 'subscribe' }, 'PUT'), r => `Cloudbeds: ${(r.added || []).length} events switched on${(r.failed || []).length ? `, ${r.failed.length} refused` : ''}.`)}>Switch on</button> : null}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-36 shrink-0 text-muted">Looks ahead</span><span className="text-ink">{d.horizonDays} nights</span>
          {owner ? <button className={btn + ' ml-auto inline-flex items-center gap-1'} disabled={!!busy || !linked.length} onClick={() => run('refresh', () => post('/api/garden/calendar-link', { op: 'refresh' }), r => `${r.rooms} room${r.rooms === 1 ? '' : 's'} checked in ${Math.round((r.ms || 0) / 100) / 10}s · ${(r.did || []).length} change${(r.did || []).length === 1 ? '' : 's'}${(r.conflicts || []).length ? ` · ${r.conflicts.length} double booking${r.conflicts.length === 1 ? '' : 's'}` : ''}${(r.errors || []).length ? ` · ${r.errors.join('; ')}` : ''}`)}><RefreshCw size={12} className={busy === 'refresh' ? 'animate-spin' : ''} /> Refresh now</button> : null}
          <button className={btn + (owner ? '' : ' ml-auto') + ' inline-flex items-center gap-1'} onClick={() => setShowLog(v => !v)}><Link2 size={12} /> {showLog ? 'Hide' : 'Show'} activity</button>
        </div>
        {pending.length ? <div className="flex items-start gap-2 flex-wrap rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-2">
          <span className="font-semibold text-rose-800">Not syncing</span>
          <span className="min-w-0 flex-1 text-rose-800">{pending.map(([r, p]: any) => `Room ${r} (${p.tries} tr${p.tries === 1 ? 'y' : 'ies'}): ${p.error}`).join(' · ')}. Retried every five minutes; check these rooms by hand until it clears.</span>
          {owner ? <button className={btn} disabled={!!busy} onClick={() => run('retry', () => post('/api/garden/calendar-link', { op: 'retry' }), r => `${r.cleared} of ${r.tried} cleared.`)}>Retry now</button> : null}
        </div> : null}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-36 shrink-0 text-muted">Audit</span>
          {A ? <>
            <Tag tone={A.errors?.length ? 'amber' : C.double ? 'rose' : C.drift ? 'amber' : 'emerald'}>{A.errors?.length ? 'could not read everything' : C.double ? `${C.double} double-booked night${C.double === 1 ? '' : 's'}` : C.drift ? `${C.drift} night${C.drift === 1 ? '' : 's'} out of step` : 'no double bookings'}</Tag>
            <span className="text-muted">{A.rooms} rooms · {A.nights} nights · {when(A.at)}{C.guesty_open ? ` · ${C.guesty_open} nights held in Cloudbeds still open in Guesty` : ''}</span>
          </> : <span className="text-muted">not run yet</span>}
          <span className="ml-auto inline-flex items-center gap-1.5">
            {A?.items?.length ? <button className={btn} onClick={() => setShowAudit(v => !v)}>{showAudit ? 'Hide' : 'Show'} {A.items.length}</button> : null}
            {owner ? <button className={btn + ' inline-flex items-center gap-1'} disabled={!!busy} onClick={() => run('audit', () => post('/api/garden/calendar-link', { op: 'audit' }), r => `Audit: ${r.audit.rooms} rooms in ${Math.round(r.audit.ms / 100) / 10}s.`)}><ShieldCheck size={12} className={busy === 'audit' ? 'animate-pulse' : ''} /> Audit now</button> : null}
          </span>
        </div>
        {showAudit && A?.items?.length ? <div className="border-t border-line/60 pt-2 space-y-1 max-h-56 overflow-y-auto">{A.items.map((x: any, i: number) => <div key={i} className="flex gap-2"><span className="w-14 shrink-0 font-semibold text-ink">{x.room}</span><span className="w-44 shrink-0 text-muted tabular-nums">{x.from}{x.to !== x.from ? ` → ${x.to}` : ''}</span><span className={'min-w-0 ' + (x.kind === 'double' ? 'text-rose-700 font-semibold' : 'text-ink')}>{x.detail}</span></div>)}</div> : null}
        {A?.errors?.length ? <p className="text-amber-800">{A.errors.join(' · ')}</p> : null}
        {msg ? <p className="text-ink">{msg}</p> : null}
        {showLog ? ((d.settings.log || []).length ? <div className="border-t border-line/60 pt-2 space-y-1 max-h-56 overflow-y-auto">{d.settings.log.slice(0, 30).map((l: any, i: number) => <div key={i} className="flex gap-2"><span className="w-28 shrink-0 text-muted tabular-nums">{when(l.at)}</span><span className="w-14 shrink-0 font-semibold text-ink">{l.room}</span><span className={'min-w-0 ' + (/DOUBLE BOOKING/.test(l.what) ? 'text-rose-700' : 'text-ink')}>{l.what}<span className="text-muted"> · {l.by}</span></span></div>)}</div> : <p className="text-muted border-t border-line/60 pt-2">Nothing has been written yet.</p>) : null}
      </div>
    </LeanSection>
  )
}
