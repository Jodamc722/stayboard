'use client'
// THE GARDEN HOTEL DESK — the five tabs behind the Garden Hotel row, drawn with the lean kit.
//
// Jon, 2026-09-28: "a separate tab or business… connect to Cloudbeds… track and manage operations
// and cleans, build reports from calls and verifications, basically mirroring what we built for the
// VR." This is the skeleton: every tab reads real garden_* rows and works end to end (a clean can be
// created, started and finished; a call and a verification logged; a report drawn for a range), and
// every tab says plainly when Cloudbeds is not connected yet so nobody mistakes an empty day for a
// quiet one. Tabs: today | rooms | calls | reports | setup (the strip itself comes from lib/tabsets).
import { useCallback, useEffect, useState } from 'react'
import { Hotel, RefreshCw, Loader2, Check, Play, Plus, Phone, ShieldCheck, Undo2, X, Plug, KeyRound } from 'lucide-react'
import { LeanHead, LeanTabs, LeanList, LeanRow, LeanSection, LeanEmpty, Tag, Pill, IconBtn, type Tone } from '@/components/lean'
import { GardenCallDesk } from '@/components/GardenOps'

type View = 'today' | 'rooms' | 'calls' | 'reports' | 'setup'
const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, { cache: 'no-store', ...init }); return r.json() }
const post = (url: string, body: any, method = 'POST') => j(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const dayLabel = (ymd: string) => ymd ? new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const KIND_LABEL: Record<string, string> = { clean: 'Departure clean', stayover: 'Stayover', inspection: 'Inspection', deep_clean: 'Deep clean', maintenance: 'Maintenance' }
const HK_TONE: Record<string, Tone> = { clean: 'emerald', inspected: 'brand', dirty: 'rose' }
const STATUS_TONE: Record<string, Tone> = { confirmed: 'emerald', checked_in: 'brand', not_confirmed: 'amber', checked_out: 'slate', canceled: 'rose', no_show: 'rose' }

export function GardenDesk({ view, canEdit, owner }: { view: View; canEdit: boolean; owner: boolean }) {
  const [data, setData] = useState<any | null>(null)
  const [err, setErr] = useState('')
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    setErr('')
    const q = view === 'reports' && range ? `&from=${range.from}&to=${range.to}` : ''
    const r = await j(`/api/garden?view=${view === 'setup' ? 'status' : view}${q}`).catch(e => ({ ok: false, error: String(e?.message || e) }))
    if (!r?.ok) { setErr(r?.error || 'Could not load.'); setData(r || null); return }
    setData(r)
  }, [view, range])
  useEffect(() => { load() }, [load])

  const syncNow = async (full = false) => {
    setBusy(true); setNote('')
    const r = await post('/api/garden', { action: 'sync', full }).catch(e => ({ ok: false, errors: [String(e?.message || e)] }))
    setNote(!r.connected ? 'Cloudbeds is not connected yet — see Setup.' : r.errors?.length ? r.errors.join(' · ') : `Synced: ${r.rooms ?? 0} rooms · ${r.reservations ?? 0} reservations · ${r.housekeeping ?? 0} room statuses · ${r.cleans ?? 0} new cleans`)
    setBusy(false); load()
  }

  const notReady = err && /does not exist|relation|schema cache/i.test(err)
  const header = (
    <LeanHead title={view === 'today' ? 'Garden Hotel' : view === 'rooms' ? 'Rooms & cleans' : view === 'calls' ? 'Calls & verifications' : view === 'reports' ? 'Garden Hotel reports' : 'Garden Hotel setup'} icon={<Hotel size={20} className="text-brand-600" />}>
      {data?.ok && view === 'today' ? (<>
        <Pill tone="emerald" title="Arrivals today">{data.arrivals.length} in</Pill>
        <Pill tone="amber" title="Departures today">{data.departures.length} out</Pill>
        <Pill title="In house right now">{data.inHouse} in house</Pill>
        {data.occupancy != null ? <Pill tone="brand" title="Rooms in use today over all rooms">{data.occupancy}% occ</Pill> : null}
        <Pill tone={data.tasksOpen ? 'rose' : 'slate'} title="Cleans and tasks still open today">{data.tasksOpen} open</Pill>
      </>) : null}
      {canEdit ? <IconBtn title={busy ? 'Syncing…' : 'Sync from Cloudbeds now'} onClick={() => syncNow(false)} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}</IconBtn> : null}
    </LeanHead>
  )

  if (notReady) return <>{header}<LeanEmpty>The Garden Hotel tables are not in the database yet — run migration 115_garden_hotel.sql, then reload.</LeanEmpty></>
  if (err && !data?.ok) return <>{header}<LeanEmpty>{err}</LeanEmpty></>
  if (!data) return <>{header}<p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p></>

  return (
    <>
      {header}
      {note ? <p className="text-[12px] text-muted mb-2">{note}</p> : null}
      {view === 'today' ? <Today d={data} canEdit={canEdit} reload={load} /> : null}
      {view === 'rooms' ? <Rooms d={data} canEdit={canEdit} reload={load} /> : null}
      {view === 'calls' ? <Calls d={data} canEdit={canEdit} reload={load} /> : null}
      {view === 'reports' ? <Reports d={data} range={range} setRange={setRange} /> : null}
      {view === 'setup' ? <Setup d={data} owner={owner} canEdit={canEdit} onSync={syncNow} busy={busy} /> : null}
    </>
  )
}

// ---- Today -------------------------------------------------------------------------------------
function ResRow({ r, extra, children }: { r: any; extra?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <LeanRow name={r.guest_name || 'Guest'} meta={`${(r.room_names || []).join(', ') || 'no room'} · ${dayLabel(r.check_in)} → ${dayLabel(r.check_out)} · ${r.nights ?? '?'}n${r.source ? ` · ${r.source}` : ''}`}
      tags={<><Tag tone={STATUS_TONE[r.status] || 'slate'}>{String(r.status || '').replace('_', ' ')}</Tag>{Number(r.balance) > 0 ? <Tag tone="amber" title="Balance due">${Math.round(Number(r.balance))} due</Tag> : null}{extra}</>}>
      {children}
    </LeanRow>
  )
}

function Today({ d, canEdit, reload }: { d: any; canEdit: boolean; reload: () => void }) {
  const [tab, setTab] = useState<'day' | 'tasks' | 'desk'>('day')
  return (
    <>
      <LeanTabs value={tab} onChange={setTab} tabs={[{ key: 'day', label: 'The day', n: d.arrivals.length + d.departures.length }, { key: 'tasks', label: 'Cleans & tasks', n: d.tasks.length }, { key: 'desk', label: 'Front desk to-do', n: d.callsDue.length + d.verifyDue.length }]}
        right={<span className="text-[12px] text-muted">{dayLabel(d.date)} · {d.rooms} rooms · <span title="Room condition from Cloudbeds">{d.hk.clean} clean · {d.hk.inspected} inspected · {d.hk.dirty} dirty{d.hk.unknown ? ` · ${d.hk.unknown} unknown` : ''}</span></span>} />
      {tab === 'day' ? (<>
        <LeanSection title="Arrivals" n={d.arrivals.length}>{d.arrivals.length ? <LeanList>{d.arrivals.map((r: any) => <ResRow key={r.id} r={r} />)}</LeanList> : <LeanEmpty>No arrivals today{d.rooms ? '' : ' — nothing synced from Cloudbeds yet'}.</LeanEmpty>}</LeanSection>
        <LeanSection title="Departures" n={d.departures.length}>{d.departures.length ? <LeanList>{d.departures.map((r: any) => <ResRow key={r.id} r={r} />)}</LeanList> : <LeanEmpty>No departures today.</LeanEmpty>}</LeanSection>
      </>) : null}
      {tab === 'tasks' ? <TaskList tasks={d.tasks} canEdit={canEdit} reload={reload} date={d.date} /> : null}
      {tab === 'desk' ? (<>
        <LeanSection title="Pre-arrival calls due" n={d.callsDue.length}>
          {d.callsDue.length ? <LeanList>{d.callsDue.map((r: any) => <ResRow key={r.id} r={r} extra={r.attempted ? <Tag tone="amber">tried</Tag> : <Tag tone="rose">not called</Tag>} />)}</LeanList> : <LeanEmpty>Everyone arriving in the next two days has been reached.</LeanEmpty>}
        </LeanSection>
        <LeanSection title="Verifications pending" n={d.verifyDue.length}>
          {d.verifyDue.length ? <LeanList>{d.verifyDue.map((r: any) => <ResRow key={r.id} r={r} extra={<><Tag tone={r.have.includes('id') ? 'emerald' : 'rose'}>ID</Tag><Tag tone={r.have.includes('card') ? 'emerald' : 'rose'}>card</Tag></>} />)}</LeanList> : <LeanEmpty>ID and card are on file for everyone arriving soon.</LeanEmpty>}
        </LeanSection>
        <p className="text-[12px] text-muted px-1">Log calls and verifications on the Calls & verifications tab.</p>
      </>) : null}
    </>
  )
}

// ---- Tasks (shared by Today and Rooms) --------------------------------------------------------
function TaskList({ tasks, canEdit, reload, date, roomId, roomName, compact }: { tasks: any[]; canEdit: boolean; reload: () => void; date: string; roomId?: string; roomName?: string; compact?: boolean }) {
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState('clean')
  const [who, setWho] = useState('')
  const [txt, setTxt] = useState('')
  const [warn, setWarn] = useState('')
  const set = async (t: any, status: string) => { const r = await post('/api/garden/tasks', { id: t.id, status }, 'PATCH'); setWarn(r?.warning || r?.error || ''); reload() }
  const add = async () => { await post('/api/garden/tasks', { roomId, roomName, date, kind, assignedTo: who || undefined, note: txt || undefined }); setAdding(false); setTxt(''); reload() }
  return (
    <LeanSection title={compact ? 'Tasks' : 'Cleans & tasks'} n={tasks.length} right={canEdit ? <button onClick={() => setAdding(a => !a)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700"><Plus size={12} /> Add</button> : null}>
      {adding ? (
        <div className="rounded-xl border border-line bg-white p-3 mb-2 flex items-center gap-2 flex-wrap text-[12.5px]">
          <select value={kind} onChange={e => setKind(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1.5">{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input value={who} onChange={e => setWho(e.target.value)} placeholder="Who" className="rounded-lg border border-line bg-white px-2 py-1.5 w-32" />
          <input value={txt} onChange={e => setTxt(e.target.value)} placeholder={roomName ? `Note for ${roomName}` : 'Room / note'} className="rounded-lg border border-line bg-white px-2 py-1.5 flex-1 min-w-[10rem]" />
          <button onClick={add} className="rounded-lg bg-ink text-white px-3 py-1.5 font-semibold">Create</button>
          <button onClick={() => setAdding(false)} className="text-muted"><X size={14} /></button>
        </div>
      ) : null}
      {warn ? <p className="text-[12px] text-amber-700 mb-1 px-1">{warn}</p> : null}
      {tasks.length ? (
        <LeanList>
          {tasks.map(t => (
            <LeanRow key={t.id}
              lead={canEdit && t.status !== 'done' && t.status !== 'cancelled' ? (
                t.status === 'open' ? <IconBtn title="Start" onClick={() => set(t, 'in_progress')}><Play size={14} /></IconBtn> : <IconBtn title="Finish (marks the room clean in Cloudbeds)" tone="ok" onClick={() => set(t, 'done')}><Check size={14} /></IconBtn>
              ) : undefined}
              name={compact ? KIND_LABEL[t.kind] || t.kind : `${t.room_name || 'No room'} · ${KIND_LABEL[t.kind] || t.kind}`}
              meta={`${t.assigned_to ? t.assigned_to + ' · ' : ''}${t.note || ''}${t.finished_at ? ' · done ' + when(t.finished_at) : ''}`}
              tags={<><Tag tone={t.status === 'done' ? 'emerald' : t.status === 'in_progress' ? 'brand' : t.status === 'cancelled' ? 'slate' : 'amber'}>{String(t.status).replace('_', ' ')}</Tag>{t.source === 'auto' ? <Tag title="Created from the Cloudbeds reservation">auto</Tag> : null}{t.priority ? <Tag tone="violet">{t.priority}</Tag> : null}</>}
              actions={canEdit ? (t.status === 'done' ? <IconBtn title="Reopen" onClick={() => set(t, 'open')}><Undo2 size={14} /></IconBtn> : t.status !== 'cancelled' ? <IconBtn title="Cancel" tone="bad" onClick={() => set(t, 'cancelled')}><X size={14} /></IconBtn> : undefined) : undefined}
            />
          ))}
        </LeanList>
      ) : <LeanEmpty>No tasks{compact ? '' : ' today'}. Departure cleans and stayovers are created from Cloudbeds reservations on every sync.</LeanEmpty>}
    </LeanSection>
  )
}

// ---- Rooms -------------------------------------------------------------------------------------
function Rooms({ d, canEdit, reload }: { d: any; canEdit: boolean; reload: () => void }) {
  const [filter, setFilter] = useState<'all' | 'dirty' | 'occupied' | 'turning'>('all')
  const rooms: any[] = d.rooms.filter((r: any) => filter === 'all' ? true : filter === 'dirty' ? r.hk_status === 'dirty' : filter === 'occupied' ? !!r.stay : r.tasks.some((t: any) => t.kind === 'clean' && t.status !== 'done'))
  return (
    <>
      <LeanTabs value={filter} onChange={setFilter} tabs={[{ key: 'all', label: 'All rooms', n: d.rooms.length }, { key: 'turning', label: 'Turning', n: d.rooms.filter((r: any) => r.tasks.some((t: any) => t.kind === 'clean' && t.status !== 'done')).length }, { key: 'dirty', label: 'Dirty', n: d.rooms.filter((r: any) => r.hk_status === 'dirty').length }, { key: 'occupied', label: 'Occupied', n: d.rooms.filter((r: any) => r.stay).length }]} />
      {rooms.length ? (
        <LeanList>
          {rooms.map(r => (
            <LeanRow key={r.id} name={r.name} meta={`${r.room_type || ''}${r.floor ? ` · floor ${r.floor}` : ''}${r.stay ? ` · ${r.stay.guest} until ${dayLabel(r.stay.out)}` : r.next ? ` · next ${r.next.guest} ${dayLabel(r.next.in)}` : ' · empty'}`}
              tags={<>{r.hk_status ? <Tag tone={HK_TONE[r.hk_status] || 'slate'}>{r.hk_status}</Tag> : <Tag>no status</Tag>}{r.occupied ? <Tag tone="brand">occupied</Tag> : null}{r.status !== 'active' ? <Tag tone="rose">{r.status}</Tag> : null}{r.tasks.filter((t: any) => t.status !== 'done').length ? <Tag tone="amber">{r.tasks.filter((t: any) => t.status !== 'done').length} open</Tag> : null}</>}>
              <TaskList tasks={r.tasks} canEdit={canEdit} reload={reload} date={d.date} roomId={r.id} roomName={r.name} compact />
            </LeanRow>
          ))}
        </LeanList>
      ) : <LeanEmpty>{d.rooms.length ? 'Nothing in this view.' : 'No rooms yet — connect Cloudbeds on the Setup tab and sync.'}</LeanEmpty>}
      {d.orphanTasks?.length ? <div className="mt-4"><TaskList tasks={d.orphanTasks} canEdit={canEdit} reload={reload} date={d.date} /></div> : null}
    </>
  )
}

// ---- Calls & verifications ---------------------------------------------------------------------
function Calls({ d, canEdit, reload }: { d: any; canEdit: boolean; reload: () => void }) {
  const [tab, setTab] = useState<'desk' | 'due' | 'all' | 'log'>('desk')
  const due = d.upcoming.filter((r: any) => !r.reached || r.idStatus === 'pending' || r.cardStatus === 'pending')
  const list = tab === 'due' ? due : d.upcoming
  return (
    <>
      <LeanTabs value={tab} onChange={setTab} tabs={[{ key: 'desk', label: 'Welcome calls & the desk' }, { key: 'due', label: 'Needs a call or a check', n: due.length }, { key: 'all', label: 'Arriving this week', n: d.upcoming.length }, { key: 'log', label: 'Call log', n: d.recent.length }]} />
      {tab === 'desk' ? <GardenCallDesk canEdit={canEdit} onLogged={reload} /> : null}
      {tab !== 'log' && tab !== 'desk' ? (list.length ? (
        <LeanList>
          {list.map((r: any) => (
            <LeanRow key={r.id} name={r.guest_name || 'Guest'} meta={`${(r.room_names || []).join(', ') || 'no room'} · ${dayLabel(r.check_in)} · ${r.nights ?? '?'}n${r.guest_phone ? ` · ${r.guest_phone}` : ''}${r.source ? ` · ${r.source}` : ''}`}
              tags={<><Tag tone={r.reached ? 'emerald' : r.attempts ? 'amber' : 'rose'}>{r.reached ? 'reached' : r.attempts ? `${r.attempts} tried` : 'not called'}</Tag><Tag tone={r.idStatus === 'passed' || r.idStatus === 'waived' ? 'emerald' : r.idStatus === 'failed' ? 'rose' : 'slate'}>ID {r.idStatus}</Tag><Tag tone={r.cardStatus === 'passed' || r.cardStatus === 'waived' ? 'emerald' : r.cardStatus === 'failed' ? 'rose' : 'slate'}>card {r.cardStatus}</Tag>{Number(r.balance) > 0 ? <Tag tone="amber">${Math.round(Number(r.balance))} due</Tag> : null}</>}
              lead={r.guest_phone && canEdit ? <IconBtn title={`Call ${r.guest_phone}`} href={`tel:${r.guest_phone}`} tone="brand"><Phone size={14} /></IconBtn> : undefined}>
              {canEdit ? <LogForms r={r} reload={reload} /> : null}
              {r.calls.length ? <ul className="text-[12px] text-muted space-y-0.5">{r.calls.map((c: any) => <li key={c.id}>{when(c.called_at)} · {c.kind.replace('_', ' ')} · <b className="text-ink">{c.outcome.replace('_', ' ')}</b>{c.called_by ? ` · ${c.called_by}` : ''}{c.note ? ` — ${c.note}` : ''}</li>)}</ul> : <p className="text-[12px] text-muted">No calls logged.</p>}
            </LeanRow>
          ))}
        </LeanList>
      ) : <LeanEmpty>{d.upcoming.length ? 'Everyone arriving this week is called and verified.' : 'No arrivals in the next week — or nothing synced from Cloudbeds yet.'}</LeanEmpty>) : null}
      {tab === 'log' ? (d.recent.length ? (
        <LeanList>{d.recent.map((c: any) => <LeanRow key={c.id} name={c.guest_name || c.reservation_id || 'Call'} meta={`${when(c.called_at)} · ${c.kind.replace('_', ' ')}${c.called_by ? ` · ${c.called_by}` : ''}${c.note ? ` — ${c.note}` : ''}`} tags={<Tag tone={c.outcome === 'reached' ? 'emerald' : c.outcome === 'declined' || c.outcome === 'wrong_number' ? 'rose' : 'amber'}>{c.outcome.replace('_', ' ')}</Tag>} />)}</LeanList>
      ) : <LeanEmpty>No calls logged yet.</LeanEmpty>) : null}
    </>
  )
}

function LogForms({ r, reload }: { r: any; reload: () => void }) {
  const [kind, setKind] = useState('pre_arrival')
  const [outcome, setOutcome] = useState('reached')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const logCall = async () => { setBusy(true); await post('/api/garden/calls', { type: 'call', reservationId: r.id, guestName: r.guest_name, kind, outcome, note: note || undefined }); setNote(''); setBusy(false); reload() }
  const verify = async (vk: string, status: string) => { await post('/api/garden/calls', { type: 'verification', reservationId: r.id, kind: vk, status }); reload() }
  return (
    <div className="flex items-center gap-2 flex-wrap text-[12px]">
      <select value={kind} onChange={e => setKind(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1"><option value="pre_arrival">Pre-arrival</option><option value="welcome">Welcome</option><option value="verification">Verification</option><option value="post_stay">Post-stay</option><option value="other">Other</option></select>
      <select value={outcome} onChange={e => setOutcome(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1"><option value="reached">Reached</option><option value="voicemail">Voicemail</option><option value="no_answer">No answer</option><option value="wrong_number">Wrong number</option><option value="declined">Declined</option></select>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note" className="rounded-lg border border-line bg-white px-2 py-1 flex-1 min-w-[8rem]" />
      <button onClick={logCall} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-ink text-white px-2.5 py-1 font-semibold disabled:opacity-50"><Phone size={12} /> Log call</button>
      <span className="text-muted">·</span>
      {(['id', 'card'] as const).map(vk => (
        <span key={vk} className="inline-flex items-center gap-1">
          <ShieldCheck size={12} className="text-muted" /><span className="uppercase font-semibold text-muted">{vk}</span>
          <button onClick={() => verify(vk, 'passed')} className="rounded-md border border-emerald-200 text-emerald-700 px-1.5 py-0.5">pass</button>
          <button onClick={() => verify(vk, 'failed')} className="rounded-md border border-rose-200 text-rose-700 px-1.5 py-0.5">fail</button>
          <button onClick={() => verify(vk, 'waived')} className="rounded-md border border-line text-muted px-1.5 py-0.5">waive</button>
        </span>
      ))}
    </div>
  )
}

// ---- Reports -----------------------------------------------------------------------------------
function Reports({ d, range, setRange }: { d: any; range: { from: string; to: string } | null; setRange: (r: { from: string; to: string }) => void }) {
  const [from, setFrom] = useState(d.from), [to, setTo] = useState(d.to)
  const Stat = ({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) => (
    <div className="rounded-2xl border border-line bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-wider text-muted font-semibold">{label}</div><div className="text-2xl font-bold text-ink tabular-nums mt-0.5">{value}</div>{sub ? <div className="text-[12px] text-muted">{sub}</div> : null}</div>
  )
  const cleans = Object.entries(d.cleans || {}) as [string, { total: number; done: number }][]
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap mb-3 text-[12.5px]">
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1.5" />
        <span className="text-muted">→</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1.5" />
        <button onClick={() => setRange({ from, to })} className="rounded-lg bg-ink text-white px-3 py-1.5 font-semibold">Run</button>
        <span className="text-muted">{d.days} days · {d.rooms} rooms{range ? '' : ' · last 30 days'}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <Stat label="Occupancy" value={d.occupancy != null ? `${d.occupancy}%` : '—'} sub={`${d.roomNights} room-nights`} />
        <Stat label="Arrivals" value={d.arrivals} sub={Object.entries(d.bySource || {}).map(([k, v]) => `${k} ${v}`).join(' · ') || 'no bookings in range'} />
        <Stat label="Booked revenue" value={d.revenueBooked ? `$${d.revenueBooked.toLocaleString()}` : '—'} sub={d.adr ? `ADR $${d.adr}` : 'as Cloudbeds totals it'} />
        <Stat label="Calls" value={d.calls.total} sub={d.calls.total ? `${Math.round((d.calls.reached / d.calls.total) * 100)}% reached` : 'none logged'} />
      </div>
      <LeanSection title="Cleans & tasks">
        {cleans.length ? <LeanList>{cleans.map(([k, v]) => <LeanRow key={k} name={KIND_LABEL[k] || k} meta={`${v.done} of ${v.total} done`} tags={<Tag tone={v.total && v.done === v.total ? 'emerald' : 'amber'}>{v.total ? Math.round((v.done / v.total) * 100) : 0}%</Tag>} />)}</LeanList> : <LeanEmpty>No tasks in this range.</LeanEmpty>}
      </LeanSection>
      <LeanSection title="Verifications">
        <LeanList>
          <LeanRow name="Checks done" meta={`${d.verifications.passed} passed · ${d.verifications.failed} failed`} tags={<Tag tone={d.verifications.failed ? 'rose' : 'emerald'}>{d.verifications.total}</Tag>} />
          {Object.entries(d.calls.byKind || {}).map(([k, v]) => <LeanRow key={k} name={`${String(k).replace('_', ' ')} calls`} tags={<Tag>{v as number}</Tag>} />)}
        </LeanList>
      </LeanSection>
    </>
  )
}

// ---- Setup -------------------------------------------------------------------------------------
const FEED_LABEL: Record<string, string> = { rooms: 'Rooms', reservations: 'Reservations', housekeeping: 'Room status (housekeeping)', calendar: 'Multi-calendar (availability & rates)', channels: 'Channels (calendar sync)', payments: 'Payments', messages: 'Guest messaging', homebase_staff: 'Homebase — people', homebase_timecards: 'Homebase — timecards' }
function Setup({ d, owner, canEdit, onSync, busy }: { d: any; owner: boolean; canEdit: boolean; onSync: (full: boolean) => void; busy: boolean }) {
  const [test, setTest] = useState<any | null>(null)
  const runTest = async () => { setTest({ busy: true }); setTest(await post('/api/garden', { action: 'test' })) }
  const connected = d.mode !== 'none'
  return (
    <>
      <LeanSection title="Cloudbeds connection">
        <LeanList>
          <LeanRow lead={<span className={`w-8 h-8 rounded-lg inline-flex items-center justify-center ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}><Plug size={15} /></span>}
            name="Cloudbeds" meta={connected ? `${d.mode === 'api_key' ? 'property API key' : 'OAuth app'}${d.propertyId ? ` · property ${d.propertyId}` : ' · no CLOUDBEDS_PROPERTY_ID'}` : 'Not connected — nothing is being read from the hotel yet.'}
            tags={<Tag tone={connected ? 'emerald' : 'rose'}>{connected ? 'connected' : 'not connected'}</Tag>}
            actions={canEdit && connected ? <><IconBtn title="Test the key (asks Cloudbeds for the hotel name)" onClick={runTest}><KeyRound size={14} /></IconBtn><IconBtn title={busy ? 'Syncing…' : 'Full sync now'} onClick={() => onSync(true)} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}</IconBtn></> : undefined}>
            {test ? <p className="text-[12.5px]">{test.busy ? 'Asking Cloudbeds…' : test.ok ? <>Cloudbeds answered: <b>{test.hotel?.name}</b>{test.hotel?.city ? `, ${test.hotel.city}` : ''}{test.hotel?.rooms != null ? ` · ${test.hotel.rooms} rooms` : ''} (property {test.hotel?.id})</> : <span className="text-rose-700">{test.error}</span>}</p> : null}
            {owner ? (
              <div className="text-[12.5px] text-ink/85 space-y-1">
                <p className="font-semibold">To connect (owner):</p>
                <ol className="list-decimal pl-5 space-y-0.5">
                  <li>Cloudbeds → Settings (gear) → <b>API Credentials</b> (or Marketplace → Cloudbeds API) → create an <b>API key</b> with read access to reservations, rooms, housekeeping, rates/availability, payments and guests, plus housekeeping write.</li>
                  <li>Vercel → Environment Variables → add <code>CLOUDBEDS_API_KEY</code> and <code>CLOUDBEDS_PROPERTY_ID</code> (the hotel&apos;s property ID from the same screen) → Production → redeploy.</li>
                  <li>Come back here → Test the key → Full sync. Rooms, reservations, room statuses, the multi-calendar, channels and payments land in the Garden Hotel tables; cleans are created from departures.</li>
                </ol>
                <p className="text-muted">Partner-app (OAuth) route instead: <code>CLOUDBEDS_CLIENT_ID</code>, <code>CLOUDBEDS_CLIENT_SECRET</code>, <code>CLOUDBEDS_REFRESH_TOKEN</code>. Other systems (phones, payments, locks) plug in next to this one the same way — their own file under lib/garden, their own feed row below.</p>
              </div>
            ) : <p className="text-[12px] text-muted">An owner connects the key in Vercel; this tab then shows the feeds.</p>}
          </LeanRow>
        </LeanList>
      </LeanSection>
      <LeanSection title="Feeds" right={<span className="text-muted">{d.rooms} rooms · {d.reservations} reservations in the mirror</span>}>
        <LeanList>
          {d.feeds.map((f: any) => (
            <LeanRow key={f.entity} name={FEED_LABEL[f.entity] || f.entity}
              meta={f.lastSyncAt ? `last ${when(f.lastSyncAt)}${f.count != null ? ` · ${f.count} rows` : ''}` : 'never synced'}
              tags={<Tag tone={f.error ? 'rose' : f.ageMin != null && f.ageMin <= 60 ? 'emerald' : 'amber'}>{f.error ? 'error' : f.ageMin != null ? `${f.ageMin}m ago` : 'never'}</Tag>}>
              {f.error ? <p className="text-[12px] text-rose-700">{f.error}</p> : <p className="text-[12px] text-muted">{f.entity.startsWith('homebase') ? 'Homebase — set up in Users & admin → Settings → Homebase (labor). ' : 'Cloudbeds. '}Every 30 minutes with the task mirror; Sync now on any tab pulls at once.</p>}
            </LeanRow>
          ))}
        </LeanList>
      </LeanSection>
      <LeanSection title="What this is">
        <p className="text-[12.5px] text-muted px-1">The Garden Hotel&apos;s own tables (garden_rooms, garden_reservations, garden_tasks, garden_calls, garden_verifications) — separate from the VR portfolio. Cloudbeds is the property system of record; cleans, calls and checks are tracked here and a finished clean is written back to Cloudbeds as the room status. Reports come from these tables only.</p>
      </LeanSection>
    </>
  )
}
