'use client'
// THE GARDEN HOUSEKEEPING BOARD — /garden/rooms (Jon, 2026-11-10: "improve hk visibility").
//
// One look answers the housekeeping questions in the order they matter:
//   1. Clean first   rooms with a guest arriving today that are not ready yet
//   2. Checkouts     departing rooms still to turn
//   3. Stayovers     in-house rooms due a service
//   4. Ready / OOS   what is sellable, what is out
// Then every physical room as a tile, floor by floor, coloured by condition with who is in, who is
// coming, DND and the housekeeper. A tap opens the room: set clean / dirty / inspected (written to
// Cloudbeds), start or finish its task, assign it. Reads /api/garden/frontdesk; refreshes every minute.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, BedDouble, Check, Loader2, Moon, Play, RefreshCw, User, X } from 'lucide-react'
import { Tag, LeanPick, type Tone } from '@/components/lean'

const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, { cache: 'no-store', ...init }); return r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` })) }
const send = (url: string, body: any, method = 'PATCH') => j(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const dayShort = (ymd: string) => ymd ? new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
const clock = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : ''
const KIND: Record<string, string> = { clean: 'Checkout clean', stayover: 'Stayover', inspection: 'Inspection', deep_clean: 'Deep clean', maintenance: 'Maintenance' }
const TASK_TONE: Record<string, Tone> = { done: 'emerald', in_progress: 'brand', open: 'amber', cancelled: 'slate' }

type Room = {
  id: string; name: string; type: string | null; floor: string | null; condition: string | null; conditionAt: string | null
  housekeeper: string | null; comments: string | null; dnd: boolean; refused: boolean
  oos: { kind: string | null; reason: string | null; until: string | null } | null
  stay: { guest: string; out: string } | null; arriving: string | null; departing: boolean
  tasks: { id: string; kind: string; status: string; assigned_to: string | null }[]
}
type Lane = 'all' | 'first' | 'checkouts' | 'stayovers' | 'dirty' | 'ready' | 'occupied' | 'oos'

const ready = (r: Room) => r.condition === 'clean' || r.condition === 'inspected'
const isFirst = (r: Room) => !!r.arriving && !ready(r) && !r.oos
const isCheckout = (r: Room) => r.departing && !r.oos && (!ready(r) || r.tasks.some(t => t.kind === 'clean' && t.status !== 'done' && t.status !== 'cancelled'))
const isStayover = (r: Room) => !!r.stay && !r.departing && !r.oos && r.tasks.some(t => t.kind === 'stayover' && t.status !== 'done' && t.status !== 'cancelled')
const floorOf = (r: Room) => r.floor || (r.name.replace(/\D/g, '').length >= 3 ? r.name.replace(/\D/g, '').slice(0, -2) : '—')
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')

export function GardenHKBoard({ canEdit }: { canEdit: boolean }) {
  const [d, setD] = useState<any | null>(null)
  const [err, setErr] = useState('')
  const [lane, setLane] = useState<Lane>('first')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [who, setWho] = useState('')

  const load = useCallback(async () => {
    const r = await j('/api/garden/frontdesk')
    if (r?.ok) { setD(r); setErr('') } else setErr(r?.error || 'Could not load the rooms.')
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load])

  const rooms: Room[] = useMemo(() => (d?.rooms || []) as Room[], [d])
  const counts = useMemo(() => ({
    all: rooms.length, first: rooms.filter(isFirst).length, checkouts: rooms.filter(isCheckout).length, stayovers: rooms.filter(isStayover).length,
    dirty: rooms.filter(r => r.condition === 'dirty' && !r.oos).length, ready: rooms.filter(r => ready(r) && !r.oos && !r.stay).length,
    occupied: rooms.filter(r => !!r.stay).length, oos: rooms.filter(r => !!r.oos).length,
  }), [rooms])
  // Lane default: if nothing is urgent, open on checkouts, then everything.
  useEffect(() => { if (d && lane === 'first' && !counts.first) setLane(counts.checkouts ? 'checkouts' : 'all') }, [d]) // eslint-disable-line react-hooks/exhaustive-deps

  const hkNames: string[] = useMemo(() => Array.from(new Set<string>([...rooms.map(r => r.housekeeper || ''), ...(d?.tasks || []).map((t: any) => t.assigned_to || ''), ...(d?.team || []).filter((p: any) => /house|hk/i.test(p.department || '')).map((p: any) => p.name)].filter(Boolean))).sort(), [rooms, d])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rooms.filter(r => {
      if (lane === 'first' && !isFirst(r)) return false
      if (lane === 'checkouts' && !isCheckout(r)) return false
      if (lane === 'stayovers' && !isStayover(r)) return false
      if (lane === 'dirty' && !(r.condition === 'dirty' && !r.oos)) return false
      if (lane === 'ready' && !(ready(r) && !r.oos && !r.stay)) return false
      if (lane === 'occupied' && !r.stay) return false
      if (lane === 'oos' && !r.oos) return false
      if (who && r.housekeeper !== who && !r.tasks.some(t => t.assigned_to === who)) return false
      return !s || [r.name, r.type, r.housekeeper, r.stay?.guest, r.arriving, r.comments].join(' ').toLowerCase().includes(s)
    })
  }, [rooms, lane, q, who])
  const floors = useMemo(() => {
    const m = new Map<string, Room[]>()
    for (const r of shown) { const f = floorOf(r); m.set(f, [...(m.get(f) || []), r]) }
    return Array.from(m.entries()).sort((a, b) => Number(a[0]) - Number(b[0]) || a[0].localeCompare(b[0]))
  }, [shown])

  const setCond = async (r: Room, condition: string) => {
    setBusy(r.id + condition); setMsg('')
    const x = await send('/api/garden/rooms', { roomId: r.id, condition })
    setBusy(''); if (!x?.ok) setMsg(x?.error || 'Could not update the room.'); load()
  }
  const setTask = async (id: string, patch: any) => {
    setBusy(id); setMsg('')
    const x = await send('/api/garden/tasks', { id, ...patch })
    setBusy(''); if (x?.warning || x?.error) setMsg(x.warning || x.error); load()
  }

  if (err && !d) return <div className="p-6 text-[13px] text-rose-700">{err}</div>
  if (!d) return <div className="p-6 text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading rooms…</div>

  const sel = open ? rooms.find(r => r.id === open) || null : null
  const tasks = (d.tasks || []) as any[]
  const tDone = tasks.filter(t => t.status === 'done').length, tLive = tasks.filter(t => t.status !== 'cancelled').length

  const Stat = ({ k, label, sub, tone }: { k: Lane; label: string; sub: string; tone: string }) => (
    <button onClick={() => setLane(k)} className={`text-left rounded-xl border px-3 py-2 bg-white transition ${lane === k ? 'border-ink ring-1 ring-ink/20' : 'border-line hover:border-ink/30'}`}>
      <div className={`text-[22px] leading-none font-bold tabular-nums ${tone}`}>{counts[k]}</div>
      <div className="text-[12px] font-semibold text-ink mt-1">{label}</div>
      <div className="text-[10.5px] text-muted">{sub}</div>
    </button>
  )

  return (
    <div className="pb-10">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <BedDouble size={18} className="text-ink" />
        <h1 className="text-[20px] font-semibold text-ink">Rooms &amp; cleans</h1>
        <span className="text-[12px] text-muted">{d.summary.rooms} rooms · {d.summary.occupiedRooms} occupied tonight · tasks {tDone}/{tLive} done</span>
        <span className="flex-1" />
        <span className="text-[11px] text-muted">Cloudbeds {d.syncs?.housekeeping?.at ? 'synced ' + clock(d.syncs.housekeeping.at) : ''}</span>
        <button onClick={load} className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-line bg-white" title="Refresh"><RefreshCw size={14} /></button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-3">
        <Stat k="first" label="Clean first" sub="arrival today, not ready" tone={counts.first ? 'text-rose-700' : 'text-emerald-700'} />
        <Stat k="checkouts" label="Checkouts" sub="departing, to turn" tone="text-amber-700" />
        <Stat k="stayovers" label="Stayovers" sub="in house, service due" tone="text-sky-700" />
        <Stat k="dirty" label="Dirty" sub="all dirty rooms" tone="text-rose-700" />
        <Stat k="ready" label="Ready to sell" sub="vacant, clean" tone="text-emerald-700" />
        <Stat k="occupied" label="Occupied" sub="guest in tonight" tone="text-ink" />
        <Stat k="oos" label="Out of service" sub="blocked in Cloudbeds" tone="text-slate-500" />
      </div>

      {d.housekeepers?.length ? (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-3">
          {d.housekeepers.map((h: any) => {
            const tot = h.tasks || h.rooms, done = h.tasks ? h.done : h.clean
            return (
              <button key={h.name} onClick={() => setWho(w => w === h.name ? '' : h.name)} className={`shrink-0 text-left rounded-xl border bg-white px-3 py-1.5 min-w-[150px] ${who === h.name ? 'border-ink ring-1 ring-ink/20' : 'border-line'}`}>
                <div className="text-[12.5px] font-semibold text-ink truncate">{h.name}</div>
                <div className="text-[11px] text-muted tabular-nums">{done}/{tot} done{h.dirty ? <span className="text-rose-700"> · {h.dirty} dirty</span> : null}</div>
                <div className="h-1 rounded-full bg-neutral-100 mt-1"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${tot ? Math.round(done / tot * 100) : 0}%` }} /></div>
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <LeanPick<Lane> size="sm" value={lane} onPick={setLane} options={[{ v: 'all' as Lane, label: <>All rooms <span className="opacity-60 tabular-nums">{counts.all}</span></> }]} />
        {who ? <button onClick={() => setWho('')} className="inline-flex items-center gap-1 rounded-full bg-ink text-white text-[11.5px] px-2 py-0.5"><User size={11} />{who}<X size={11} /></button> : null}
        <span className="flex-1" />
        <div className="flex items-center gap-3 text-[10.5px] text-muted">
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />dirty</span>
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />clean</span>
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-sky-600" />inspected</span>
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-300" />out of service</span>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Room, guest, housekeeper" className="h-8 w-52 rounded-lg border border-line bg-white px-2.5 text-[12.5px]" />
      </div>
      {msg ? <p className="text-[12px] text-amber-700 mb-2">{msg}</p> : null}

      {!shown.length ? <div className="rounded-xl border border-line bg-white p-6 text-center text-[13px] text-muted">{lane === 'first' ? 'Every room with an arrival today is ready.' : 'No rooms in this view.'}</div> : (
        <div className="space-y-3">
          {floors.map(([f, list]) => (
            <section key={f}>
              <div className="text-[10.5px] uppercase tracking-wider text-muted font-semibold mb-1">Floor {f} · {list.length}</div>
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-1.5">
                {list.map(r => {
                  const bar = r.oos ? 'bg-slate-300' : r.condition === 'dirty' ? 'bg-rose-500' : r.condition === 'inspected' ? 'bg-sky-600' : r.condition === 'clean' ? 'bg-emerald-500' : 'bg-neutral-300'
                  const t = r.tasks.find(x => x.status === 'in_progress') || r.tasks.find(x => x.status === 'open')
                  const hk = r.housekeeper || t?.assigned_to || null
                  return (
                    <button key={r.id} onClick={() => setOpen(r.id)} className={`relative text-left rounded-lg border bg-white overflow-hidden hover:border-ink/40 ${isFirst(r) ? 'border-rose-400 ring-1 ring-rose-200' : 'border-line'} ${r.oos ? 'opacity-60' : ''}`}>
                      <div className={`h-1.5 ${bar}`} />
                      <div className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <span className="text-[14px] font-bold text-ink tabular-nums">{r.name}</span>
                          <span className="flex-1" />
                          {r.departing ? <ArrowDownRight size={13} className="text-amber-600" aria-label="departing" /> : null}
                          {r.arriving ? <ArrowUpRight size={13} className="text-emerald-600" aria-label="arriving" /> : null}
                          {r.dnd ? <Moon size={12} className="text-violet-600" aria-label="do not disturb" /> : null}
                        </div>
                        <div className="text-[10.5px] text-muted truncate">{r.oos ? (r.oos.reason || 'Out of service') : r.arriving ? '→ ' + r.arriving : r.stay ? r.stay.guest + (r.departing ? ' · out' : '') : 'vacant'}</div>
                        <div className="flex items-center gap-1 mt-0.5 min-h-[16px]">
                          {t ? <span className={`text-[9.5px] font-semibold rounded px-1 ${t.status === 'in_progress' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800'}`}>{t.kind === 'clean' ? 'C/O' : t.kind === 'stayover' ? 'S/O' : t.kind.slice(0, 4)} {t.status === 'in_progress' ? '…' : ''}</span> : r.tasks.some(x => x.status === 'done') ? <Check size={11} className="text-emerald-600" /> : null}
                          <span className="flex-1" />
                          {hk ? <span className="text-[9.5px] font-bold rounded-full bg-neutral-100 text-ink px-1.5" title={hk}>{initials(hk)}</span> : null}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {sel ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={() => setOpen(null)}>
          <div className="w-full max-w-sm h-full bg-white shadow-xl p-4 overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <h2 className="text-[20px] font-bold text-ink tabular-nums">{sel.name}</h2>
              <span className="text-[12px] text-muted truncate">{sel.type}</span>
              <span className="flex-1" />
              <button onClick={() => setOpen(null)} className="h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-neutral-100" aria-label="Close"><X size={16} /></button>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {sel.condition ? <Tag tone={sel.condition === 'dirty' ? 'rose' : sel.condition === 'inspected' ? 'sky' : 'emerald'}>{sel.condition}{sel.conditionAt ? ' · ' + clock(sel.conditionAt) : ''}</Tag> : <Tag>condition unknown</Tag>}
              {sel.oos ? <Tag tone="roseSolid">{sel.oos.reason || sel.oos.kind || 'out of service'}{sel.oos.until ? ' · until ' + dayShort(sel.oos.until) : ''}</Tag> : null}
              {sel.dnd ? <Tag tone="violet">Do not disturb</Tag> : null}
              {sel.refused ? <Tag tone="rose">Refused service</Tag> : null}
            </div>
            <dl className="mt-3 space-y-1.5 text-[13px]">
              <div className="flex gap-2"><dt className="w-24 text-muted">In the room</dt><dd className="text-ink">{sel.stay ? `${sel.stay.guest} · out ${dayShort(sel.stay.out)}` : 'Nobody tonight'}</dd></div>
              <div className="flex gap-2"><dt className="w-24 text-muted">Arriving</dt><dd className="text-ink">{sel.arriving || '—'}</dd></div>
              <div className="flex gap-2"><dt className="w-24 text-muted">Departing</dt><dd className="text-ink">{sel.departing ? 'Today' : '—'}</dd></div>
              <div className="flex gap-2"><dt className="w-24 text-muted">Housekeeper</dt><dd className="text-ink">{sel.housekeeper || '—'}</dd></div>
              {sel.comments ? <div className="flex gap-2"><dt className="w-24 text-muted">Notes</dt><dd className="text-ink">{sel.comments}</dd></div> : null}
            </dl>
            {canEdit ? (
              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1.5">Set the room · writes to Cloudbeds</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['dirty', 'clean', 'inspected'] as const).map(c => (
                    <button key={c} disabled={!!busy || sel.condition === c} onClick={() => setCond(sel, c)}
                      className={`h-9 rounded-lg text-[12.5px] font-semibold border disabled:opacity-40 ${c === 'dirty' ? 'border-rose-300 text-rose-700' : c === 'clean' ? 'border-emerald-300 text-emerald-700' : 'border-sky-300 text-sky-700'}`}>
                      {busy === sel.id + c ? <Loader2 size={13} className="animate-spin inline" /> : c[0].toUpperCase() + c.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-4">
              <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1.5">Today’s tasks</div>
              {!sel.tasks.length ? <p className="text-[12.5px] text-muted">No task for this room today.</p> : sel.tasks.map(t => (
                <div key={t.id} className="rounded-lg border border-line p-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-ink">{KIND[t.kind] || t.kind}</span>
                    <Tag tone={TASK_TONE[t.status] || 'slate'}>{t.status.replace('_', ' ')}</Tag>
                  </div>
                  {canEdit && t.status !== 'done' && t.status !== 'cancelled' ? (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <input list="garden-hk-names" defaultValue={t.assigned_to || ''} placeholder="Assign to…"
                        onBlur={e => { const v = e.target.value.trim(); if (v !== (t.assigned_to || '')) setTask(t.id, { assignedTo: v || null }) }}
                        className="flex-1 min-w-0 h-8 rounded-lg border border-line px-2 text-[12.5px]" />
                      {t.status === 'open' ? <button disabled={busy === t.id} onClick={() => setTask(t.id, { status: 'in_progress' })} className="h-8 px-2.5 rounded-lg border border-line text-[12px] font-semibold inline-flex items-center gap-1"><Play size={12} />Start</button> : null}
                      <button disabled={busy === t.id} onClick={() => setTask(t.id, { status: 'done' })} className="h-8 px-2.5 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold inline-flex items-center gap-1" title="Marks the task done and the room clean in Cloudbeds"><Check size={12} />Done</button>
                    </div>
                  ) : t.assigned_to ? <div className="text-[12px] text-muted mt-1">{t.assigned_to}</div> : null}
                </div>
              ))}
              <datalist id="garden-hk-names">{hkNames.map(n => <option key={n} value={n} />)}</datalist>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
