'use client'
// THE GARDEN HOTEL TODAY PAGE — the front desk's command page (Jon, GM: "Today page is more for front
// desk… view the day operations, tasks, completions, who is working, unpaid, id verifications, etc."
// and "should also show all tasks from Cloudbeds operation management").
//
// One read (GET /api/garden/frontdesk → lib/garden/frontdesk). A header strip with the day in
// numbers, then tabs — Arrivals · Departures · In-house · Unpaid · Verifications · Housekeeping &
// tasks · Team — each a dense table, one line per guest / room / person. The tab is kept in ?tab=.
// Cloudbeds has no task API: the "operations" view is the per-room housekeeping detail it does
// expose (condition, housekeeper, comments, DND, refused service, blocks) plus our garden_tasks.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Hotel, RefreshCw, Loader2, Search, Check, Play, X, Phone, FileText } from 'lucide-react'
import { ResDrawer } from '@/components/GardenResDetail'
import { LeanHead, LeanTabs, LeanEmpty, LeanPick, Tag, IconBtn, type Tone } from '@/components/lean'

type TabKey = 'arrivals' | 'departures' | 'inhouse' | 'unpaid' | 'verify' | 'hk' | 'team'
const TABS: TabKey[] = ['arrivals', 'departures', 'inhouse', 'unpaid', 'verify', 'hk', 'team']

const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, { cache: 'no-store', ...init }); return r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` })) }
const post = (url: string, body: any, method = 'POST') => j(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const dayShort = (ymd: string) => ymd ? new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'
const dayLong = (ymd: string) => ymd ? new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : ''
const clock = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : '—'
const hhmm = (t: string | null | undefined) => { if (!t) return '—'; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')}${h < 12 ? 'a' : 'p'}` }
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
const ago = (iso: string | null) => { if (!iso) return 'never'; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago` }
const label = (s: string | null | undefined) => String(s || '').replace(/_/g, ' ')

const STATUS_TONE: Record<string, Tone> = { confirmed: 'emerald', checked_in: 'brand', not_confirmed: 'amber', checked_out: 'slate', canceled: 'rose', no_show: 'rose' }
const COND_TONE: Record<string, Tone> = { clean: 'emerald', inspected: 'brand', dirty: 'rose' }
const TASK_TONE: Record<string, Tone> = { done: 'emerald', in_progress: 'brand', open: 'amber', cancelled: 'slate' }
const KIND_LABEL: Record<string, string> = { clean: 'Departure clean', stayover: 'Stayover', inspection: 'Inspection', deep_clean: 'Deep clean', maintenance: 'Maintenance' }
const DEPT_LABEL: Record<string, string> = { front_desk: 'Front desk', housekeeping: 'Housekeeping', maintenance: 'Maintenance', management: 'Management', manager: 'Management', other: 'Other' }
const STATE: Record<string, { t: string; tone: Tone }> = { on: { t: 'clocked in', tone: 'emerald' }, done: { t: 'clocked out', tone: 'slate' }, due: { t: 'not in yet', tone: 'amber' }, late: { t: 'late', tone: 'rose' }, unscheduled: { t: 'not scheduled', tone: 'violet' } }

export function GardenFrontDesk({ canEdit, canVerify, canTasks }: { canEdit: boolean; canVerify: boolean; canTasks: boolean }) {
  const [d, setD] = useState<any | null>(null)
  const [err, setErr] = useState('')
  const [tab, setTabState] = useState<TabKey>('arrivals')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [now, setNow] = useState<Date | null>(null)

  // ?tab= remembered (read on mount — no useSearchParams, so no Suspense boundary needed).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as TabKey | null
    if (t && TABS.includes(t)) setTabState(t)
  }, [])
  const setTab = (t: TabKey) => {
    setTabState(t)
    try { const u = new URL(window.location.href); u.searchParams.set('tab', t); window.history.replaceState(null, '', u.toString()) } catch { /* ignore */ }
  }

  const load = useCallback(async () => {
    const r = await j('/api/garden/frontdesk').catch(e => ({ ok: false, error: String(e?.message || e) }))
    if (!r?.ok) { setErr(r?.message || r?.error || 'Could not load.'); return }
    setErr(''); setD(r)
  }, [])
  useEffect(() => { load(); const i = setInterval(load, 120000); return () => clearInterval(i) }, [load])
  useEffect(() => { setNow(new Date()); const i = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(i) }, [])

  const syncNow = async () => {
    setBusy(true); setNote('')
    const r = await post('/api/garden', { action: 'sync' }).catch(e => ({ errors: [String(e?.message || e)] }))
    setNote(r?.connected === false ? 'Cloudbeds is not connected yet — see Setup.' : r?.errors?.length ? r.errors.join(' · ') : 'Synced from Cloudbeds.')
    setBusy(false); load()
  }

  const timeStr = now ? now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : ''
  const syncAt = d?.syncs?.reservations?.at || d?.syncs?.rooms?.at || null
  const header = (
    <LeanHead title="Garden Hotel · Today" icon={<Hotel size={20} className="text-brand-600" />}
      sub={d ? <>{dayLong(d.date)} · <span className="tabular-nums font-semibold text-ink">{timeStr}</span> ET · <span title="Last Cloudbeds reservation sync">Cloudbeds {ago(syncAt)}</span></> : null}>
      <IconBtn title="Reload" onClick={load}><RefreshCw size={14} /></IconBtn>
      {canEdit ? (
        <button onClick={syncNow} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3 h-8 text-[12.5px] font-bold disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sync Cloudbeds
        </button>
      ) : null}
    </LeanHead>
  )

  if (err && !d) {
    const notReady = /does not exist|relation|schema cache/i.test(err)
    return <>{header}<LeanEmpty>{notReady ? 'The Garden Hotel tables are not in the database yet — run the garden migrations, then reload.' : err}</LeanEmpty></>
  }
  if (!d) return <>{header}<p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading the day…</p></>

  const s = d.summary
  const tabs: { key: TabKey; label: string; n?: number }[] = [
    { key: 'arrivals', label: 'Arrivals', n: d.arrivals.length },
    { key: 'departures', label: 'Departures', n: d.departures.length },
    { key: 'inhouse', label: 'In-house', n: d.inHouse.length },
    { key: 'unpaid', label: 'Unpaid', n: d.unpaid.length },
    { key: 'verify', label: 'Verifications', n: d.verifications.length },
    { key: 'hk', label: 'Housekeeping & tasks', n: s.tasks.total - s.tasks.done || undefined },
    { key: 'team', label: 'Team', n: d.team.length },
  ]

  return (
    <>
      {header}
      {note ? <p className="text-[12px] text-muted mb-2">{note}</p> : null}
      {err ? <p className="text-[12px] text-rose-700 mb-2">Last refresh failed: {err}</p> : null}

      {/* THE STRIP — the day in numbers; each tile opens its tab. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-1.5 mb-3">
        <Tile label="Arrivals" on={tab === 'arrivals'} onClick={() => setTab('arrivals')} value={`${s.arrivals.done}/${s.arrivals.total}`} sub="checked in" tone={s.arrivals.total && s.arrivals.done === s.arrivals.total ? 'emerald' : undefined} />
        <Tile label="Departures" on={tab === 'departures'} onClick={() => setTab('departures')} value={`${s.departures.done}/${s.departures.total}`} sub="checked out" tone={s.departures.total && s.departures.done === s.departures.total ? 'emerald' : undefined} />
        <Tile label="In-house" on={tab === 'inhouse'} onClick={() => setTab('inhouse')} value={s.inHouse} sub={s.occupancy != null ? `${s.occupancy}% occ · ${s.occupiedRooms}/${s.rooms}` : 'no rooms synced'} />
        <Tile label="Unpaid" on={tab === 'unpaid'} onClick={() => setTab('unpaid')} value={s.unpaid.count ? usd(Math.round(s.unpaid.total)) : '$0'} sub={`${s.unpaid.count} guest${s.unpaid.count === 1 ? '' : 's'} w/ balance`} tone={s.unpaid.count ? 'amber' : undefined} />
        <Tile label="ID / card due" on={tab === 'verify'} onClick={() => setTab('verify')} value={s.verificationsDue} sub={`${s.verificationsDueToday} arriving today`} tone={s.verificationsDueToday ? 'rose' : s.verificationsDue ? 'amber' : undefined} />
        <Tile label="Rooms" on={tab === 'hk'} onClick={() => setTab('hk')} value={<span className="text-[15px]"><span className="text-rose-700">{s.hk.dirty}</span><span className="text-muted font-normal"> / </span><span className="text-emerald-700">{s.hk.clean}</span><span className="text-muted font-normal"> / </span><span className="text-brand-700">{s.hk.inspected}</span></span>} sub={`dirty/clean/insp · ${s.hk.oos} OOS`} />
        <Tile label="Tasks done" on={tab === 'hk'} onClick={() => setTab('hk')} value={`${s.tasks.done}/${s.tasks.total}`} sub={s.tasks.inProgress ? `${s.tasks.inProgress} in progress` : 'today'} tone={s.tasks.total && s.tasks.done === s.tasks.total ? 'emerald' : undefined} />
        <Tile label="Team" on={tab === 'team'} onClick={() => setTab('team')} value={`${s.team.on}/${s.team.scheduled}`} sub={s.team.late ? `${s.team.late} late` : 'clocked in / sched.'} tone={s.team.late ? 'rose' : undefined} />
      </div>

      <LeanTabs value={tab} onChange={setTab} tabs={tabs}
        right={<label className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2 h-8 w-full sm:w-56">
          <Search size={13} className="text-muted shrink-0" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Guest, room, source, person…" className="flex-1 min-w-0 bg-transparent text-[12.5px] focus:outline-none" />
          {q ? <button onClick={() => setQ('')} aria-label="Clear search" className="text-muted hover:text-ink"><X size={12} /></button> : null}
        </label>} />

      {tab === 'arrivals' ? <Guests rows={d.arrivals} q={q} mode="arrival" empty="No arrivals today." /> : null}
      {tab === 'departures' ? <Guests rows={d.departures} q={q} mode="departure" empty="No departures today." /> : null}
      {tab === 'inhouse' ? <Guests rows={d.inHouse} q={q} mode="inhouse" empty="Nobody in house right now." /> : null}
      {tab === 'unpaid' ? <Guests rows={d.unpaid} q={q} mode="unpaid" empty="No open balances among arriving, in-house or departing guests." /> : null}
      {tab === 'verify' ? <Verifications rows={d.verifications} q={q} canVerify={canVerify} reload={load} today={d.date} /> : null}
      {tab === 'hk' ? <Housekeeping d={d} q={q} canTasks={canTasks} reload={load} /> : null}
      {tab === 'team' ? <Team d={d} q={q} /> : null}
    </>
  )
}

// ---- pieces ------------------------------------------------------------------------------------

// GUEST READINESS (Jon, 2026-11-11: "track paid bookings, verified virtually, pre-arrival check-in
// pending"). Paid = nothing owed (or the desk marked it prepaid / pre-auth). Verified = ID and card
// both passed, on file or waived — the virtual check, before the guest is at the desk. Pre-arrival
// check-in = Operto self check-in finished.
const OKV = ['passed', 'on_file', 'waived']
export const isPaid = (g: any) => g.balance <= 0 || (g.noteTags || []).some((t: any) => t.key === 'prepaid')
export const isVerified = (g: any) => OKV.includes(g.id_status) && OKV.includes(g.card_status)
export const checkinState = (g: any): 'done' | 'started' | 'pending' | 'none' => !g.operto ? 'none' : g.operto.checkin === 'done' ? 'done' : g.operto.checkin === 'started' ? 'started' : 'pending'
type Ready = '' | 'unpaid' | 'unverified' | 'checkin'
function Readiness({ rows, value, onPick }: { rows: any[]; value: Ready; onPick: (r: Ready) => void }) {
  const live = rows.filter(g => !g.done)
  const paid = live.filter(isPaid).length, ver = live.filter(isVerified).length
  const ci = live.filter(g => checkinState(g) === 'done').length, ciKnown = live.filter(g => checkinState(g) !== 'none').length
  const chip = (k: Ready, labelTxt: string, ok: number, of: number, sub: string) => (
    <button onClick={() => onPick(value === k ? '' : k)} className={`text-left rounded-xl border bg-white px-3 py-1.5 min-w-[9rem] ${value === k ? 'border-brand-400 ring-1 ring-brand-200' : 'border-line'}`} title={value === k ? 'Show everyone' : 'Show only the ones not done'}>
      <div className="text-[10.5px] uppercase tracking-wider text-muted font-semibold">{labelTxt}</div>
      <div className={`text-[16px] font-semibold tabular-nums ${of && ok === of ? 'text-emerald-700' : ok < of ? 'text-amber-700' : 'text-ink'}`}>{ok}/{of}</div>
      <div className="text-[11px] text-muted">{sub}</div>
    </button>
  )
  if (!live.length) return null
  return (
    <div className="flex gap-1.5 flex-wrap mb-2">
      {chip('unpaid', 'Paid', paid, live.length, live.length - paid ? `${live.length - paid} still owe` : 'all paid')}
      {chip('unverified', 'Verified virtually', ver, live.length, live.length - ver ? `${live.length - ver} ID / card to check` : 'all verified')}
      {chip('checkin', 'Pre-arrival check-in', ci, ciKnown || live.length, ciKnown ? (ciKnown - ci ? `${ciKnown - ci} pending` : 'all done') : 'no Operto link')}
    </div>
  )
}
const readyHit = (g: any, r: Ready) => r === 'unpaid' ? !isPaid(g) : r === 'unverified' ? !isVerified(g) : r === 'checkin' ? checkinState(g) !== 'done' : true
function Tile({ label: l, value, sub, tone, on, onClick }: { label: string; value: ReactNode; sub?: string; tone?: 'emerald' | 'amber' | 'rose'; on?: boolean; onClick?: () => void }) {
  const t = tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : tone === 'rose' ? 'text-rose-700' : 'text-ink'
  return (
    <button onClick={onClick} className={`text-left rounded-2xl border bg-white px-3 py-2 min-w-0 hover:border-ink/30 ${on ? 'border-brand-400 ring-1 ring-brand-200' : 'border-line'}`}>
      <div className="text-[10.5px] uppercase tracking-wider text-muted font-semibold truncate">{l}</div>
      <div className={`text-[18px] leading-tight font-bold tabular-nums ${t}`}>{value}</div>
      {sub ? <div className="text-[11px] text-muted truncate">{sub}</div> : null}
    </button>
  )
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-white overflow-x-auto mb-4">
      <table className="w-full text-[12.5px]">
        <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted border-b border-line bg-app/60">{head.map((h, i) => <th key={i} className="px-3 py-1.5 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line/70">{children}</tbody>
      </table>
    </div>
  )
}
const Td = ({ children, className = '', title }: { children?: ReactNode; className?: string; title?: string }) => <td title={title} className={`px-3 py-1.5 whitespace-nowrap align-middle ${className}`}>{children}</td>

const verTone = (v: string): Tone => v === 'passed' || v === 'waived' || v === 'on_file' ? 'emerald' : v === 'failed' ? 'rose' : 'slate'
const Ver = ({ k, v, title }: { k: string; v: string; title?: string }) => <Tag tone={verTone(v)} title={title || `${k} ${v.replace('_', ' ')}`}>{k} {v === 'passed' ? '✓' : v === 'on_file' ? 'on file' : v === 'waived' ? 'waived' : v === 'failed' ? '✗' : '…'}</Tag>
// The desk's notes read into tags (lib/garden/notes-read); the full notes on hover.
const NoteTags = ({ g }: { g: any }) => !g.noteTags?.length ? (g.notes?.length ? <span className="text-muted" title={g.notes.join('\n\n')}>note</span> : <span className="text-muted">—</span>) : <span className="inline-flex items-center gap-1" title={g.notes.join('\n\n')}>{g.noteTags.slice(0, 4).map((t: any) => <Tag key={t.key} tone={t.tone} title={t.detail || undefined}>{t.label}</Tag>)}{g.noteTags.length > 4 ? <span className="text-muted text-[11px]">+{g.noteTags.length - 4}</span> : null}</span>
// Operto: the door code and whether self check-in is done.
const Code = ({ g }: { g: any }) => !g.operto ? <span className="text-muted">—</span> : <span className="inline-flex items-center gap-1">{g.operto.code ? <span className="font-mono text-[12px] text-ink" title={g.operto.codeUsedAt ? `First used ${g.operto.codeUsedAt}` : 'Not used yet'}>{g.operto.code}</span> : null}{g.operto.checkin ? <Tag tone={g.operto.checkin === 'done' ? 'emerald' : g.operto.checkin === 'started' ? 'amber' : 'slate'}>{g.operto.checkin === 'done' ? 'self check-in ✓' : g.operto.checkin === 'started' ? 'check-in started' : 'not started'}</Tag> : null}{g.operto.codeUsedAt ? <Tag tone="brand">used</Tag> : null}</span>
const CallTag = ({ g }: { g: any }) => <Tag tone={g.call === 'reached' ? 'emerald' : g.call === 'tried' ? 'amber' : 'slate'} title={g.lastCallAt ? `Last call ${clock(g.lastCallAt)}` : 'No welcome / pre-arrival call logged'}>{g.call === 'reached' ? 'reached' : g.call === 'tried' ? `${g.callAttempts} tried` : 'not called'}</Tag>

const matchGuest = (g: any, q: string) => !q || [g.guest, g.rooms.join(' '), g.source, g.phone, g.email, g.id].join(' ').toLowerCase().includes(q.toLowerCase())

function Guests({ rows, q, mode, empty }: { rows: any[]; q: string; mode: 'arrival' | 'departure' | 'inhouse' | 'unpaid'; empty: string }) {
  const [ready, setReady] = useState<Ready>('')
  const [open, setOpen] = useState<any | null>(null)
  const list = rows.filter(g => matchGuest(g, q) && readyHit(g, ready))
  if (!rows.length) return <LeanEmpty>{empty}</LeanEmpty>
  const strip = mode === 'arrival' || mode === 'inhouse' ? <Readiness rows={rows} value={ready} onPick={setReady} /> : null
  if (!list.length) return <>{strip}<LeanEmpty>{ready ? 'Everyone here is done on that.' : `No guest matches “${q}”.`}</LeanEmpty></>
  const ordered = mode === 'unpaid' ? list : [...list].sort((a, b) => Number(a.done) - Number(b.done) || (a.rooms[0] || '').localeCompare(b.rooms[0] || '', undefined, { numeric: true }))
  return (<>
    {strip}
    <ResDrawer id={open?.id || null} title={open ? `${open.guest} · ${open.rooms.join(', ') || 'unassigned'}` : ''} onClose={() => setOpen(null)} />
    <Table head={['Guest', 'Room', mode === 'departure' ? 'Stay' : 'Dates', 'Nts', 'Source', 'Paid', 'ID', 'Card', 'Check-in', 'Call', 'Notes', mode === 'unpaid' ? 'When' : 'Status', '']}>
      {ordered.map(g => (
        <tr key={g.id} className={g.done ? 'opacity-60' : ''}>
          <Td className="font-semibold text-ink max-w-[14rem] truncate" title={[g.guest, g.phone, g.email].filter(Boolean).join(' · ')}>
            <span className="inline-flex items-center gap-1.5">{g.phone ? <a href={`tel:${g.phone}`} aria-label={`Call ${g.guest}`} className="text-muted hover:text-brand-700"><Phone size={12} /></a> : null}<button onClick={() => setOpen(g)} className="hover:underline font-semibold" title="Full reservation — notes, vouchers, folio, payments">{g.guest}</button></span>
            {(g.adults || g.children) ? <span className="ml-1 text-muted font-normal">· {g.adults || 0}{g.children ? `+${g.children}` : ''}</span> : null}
          </Td>
          <Td className="tabular-nums">{g.rooms.join(', ') || <span className="text-rose-700">unassigned</span>}</Td>
          <Td className="text-muted tabular-nums">{dayShort(g.checkIn)} → {dayShort(g.checkOut)}</Td>
          <Td className="tabular-nums text-muted">{g.nights ?? '—'}</Td>
          <Td className="text-muted max-w-[9rem] truncate" title={g.source || ''}>{g.source || 'Direct'}</Td>
          <Td className="tabular-nums">{g.balance > 0 && !isPaid(g) ? <span className="font-semibold text-amber-700">{usd(g.balance)} owed</span> : <Tag tone="emerald" title={g.balance > 0 ? `Marked prepaid in the notes · Cloudbeds still shows ${usd(g.balance)}` : 'Nothing owed'}>paid ✓</Tag>}</Td>
          <Td><Ver k="ID" v={g.id_status} title={g.id_status === 'on_file' ? `ID on file${g.idType ? ' · ' + g.idType : ''}` : undefined} /></Td>
          <Td><Ver k="card" v={g.card_status} /></Td>
          <Td><Code g={g} /></Td>
          <Td><CallTag g={g} /></Td>
          <Td className="max-w-[18rem]"><NoteTags g={g} /></Td>
          <Td>{mode === 'unpaid' ? <Tag tone={g.when === 'departing' ? 'rose' : g.when === 'arriving' ? 'amber' : 'brand'}>{g.when}</Tag> : <Tag tone={STATUS_TONE[g.status] || 'slate'}>{label(g.status)}</Tag>}</Td>
          <Td><button onClick={() => setOpen(g)} className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] font-semibold text-muted hover:text-ink" title="Full reservation"><FileText size={11} /> details</button></Td>
        </tr>
      ))}
    </Table>
  </>)
}

function Verifications({ rows, q, canVerify, reload, today }: { rows: any[]; q: string; canVerify: boolean; reload: () => void; today: string }) {
  const [busy, setBusy] = useState<string>('')
  const [msg, setMsg] = useState('')
  const list = rows.filter(g => matchGuest(g, q))
  const mark = async (g: any, kind: 'id' | 'card', status: 'passed' | 'waived' | 'failed') => {
    setBusy(`${g.id}:${kind}`); setMsg('')
    const r = await post('/api/garden/calls', { type: 'verification', reservationId: g.id, kind, status })
    if (!r?.ok) setMsg(r?.message || r?.error || 'Could not save.')
    setBusy(''); reload()
  }
  if (!rows.length) return <LeanEmpty>ID and card are on file for everyone arriving today through the next two days.</LeanEmpty>
  if (!list.length) return <LeanEmpty>No guest matches “{q}”.</LeanEmpty>
  const Btns = ({ g, kind }: { g: any; kind: 'id' | 'card' }) => {
    const v = kind === 'id' ? g.id_status : g.card_status
    if (!canVerify || v === 'passed' || v === 'waived' || v === 'on_file') return <Ver k={kind === 'id' ? 'ID' : 'card'} v={v} title={v === 'on_file' && kind === 'id' && g.idType ? `ID on file · ${g.idType}` : undefined} />
    const b = busy === `${g.id}:${kind}`
    return (
      <span className="inline-flex items-center gap-1">
        <Ver k={kind === 'id' ? 'ID' : 'card'} v={v} />
        <button disabled={b} onClick={() => mark(g, kind, 'passed')} className="rounded-md border border-emerald-200 text-emerald-700 px-1.5 py-0.5 text-[11px] font-semibold disabled:opacity-50">pass</button>
        <button disabled={b} onClick={() => mark(g, kind, 'waived')} className="rounded-md border border-line text-muted px-1.5 py-0.5 text-[11px] font-semibold disabled:opacity-50">waive</button>
        <button disabled={b} onClick={() => { if (window.confirm(`Mark ${kind === 'id' ? 'the ID' : 'the card'} FAILED for ${g.guest}?`)) mark(g, kind, 'failed') }} className="rounded-md border border-rose-200 text-rose-700 px-1.5 py-0.5 text-[11px] font-semibold disabled:opacity-50">fail</button>
      </span>
    )
  }
  return (
    <>
      {msg ? <p className="text-[12px] text-rose-700 mb-1 px-1">{msg}</p> : null}
      {!canVerify ? <p className="text-[12px] text-muted mb-1.5 px-1">Read-only — marking a check needs edit access on Calls.</p> : null}
      <Table head={['Arrives', 'Guest', 'Room', 'Source', 'Balance', 'ID', 'Card', 'Code', 'Call', 'Notes', 'Status']}>
        {list.map(g => (
          <tr key={g.id}>
            <Td className={`tabular-nums font-semibold ${g.checkIn === today ? 'text-rose-700' : 'text-muted'}`}>{g.checkIn === today ? 'Today' : dayShort(g.checkIn)}</Td>
            <Td className="font-semibold text-ink max-w-[14rem] truncate" title={[g.phone, g.email].filter(Boolean).join(' · ')}><a href={`/garden/guests?res=${encodeURIComponent(g.id)}`} className="hover:underline">{g.guest}</a></Td>
            <Td className="tabular-nums">{g.rooms.join(', ') || '—'}</Td>
            <Td className="text-muted max-w-[9rem] truncate">{g.source || 'Direct'}</Td>
            <Td className={`tabular-nums ${g.balance > 0 ? 'text-amber-700 font-semibold' : 'text-muted'}`}>{g.balance > 0 ? usd(g.balance) : '—'}</Td>
            <Td><Btns g={g} kind="id" /></Td>
            <Td><Btns g={g} kind="card" /></Td>
            <Td><Code g={g} /></Td>
            <Td><CallTag g={g} /></Td>
            <Td className="max-w-[16rem]"><NoteTags g={g} /></Td>
            <Td><Tag tone={STATUS_TONE[g.status] || 'slate'}>{label(g.status)}</Tag></Td>
          </tr>
        ))}
      </Table>
    </>
  )
}

type Cond = 'all' | 'dirty' | 'clean' | 'inspected' | 'oos' | 'flags' | 'turning'
function Housekeeping({ d, q, canTasks, reload }: { d: any; q: string; canTasks: boolean; reload: () => void }) {
  const [cond, setCond] = useState<Cond>('all')
  const [who, setWho] = useState<string>('')
  const [warn, setWarn] = useState('')
  const [kind, setKind] = useState<string>('')
  const rooms: any[] = d.rooms
  const hkNames: string[] = useMemo(() => Array.from(new Set<string>([...rooms.map(r => r.housekeeper), ...d.tasks.map((t: any) => t.assigned_to)].filter(Boolean))).sort(), [rooms, d.tasks])
  const ql = q.toLowerCase()
  const roomHit = (r: any) => {
    if (cond === 'dirty' || cond === 'clean' || cond === 'inspected') { if (r.condition !== cond) return false }
    else if (cond === 'oos') { if (!r.oos) return false }
    else if (cond === 'flags') { if (!r.dnd && !r.refused && !r.comments) return false }
    else if (cond === 'turning') { if (!r.departing && !r.arriving) return false }
    if (who && r.housekeeper !== who && !r.tasks.some((t: any) => t.assigned_to === who)) return false
    return !ql || [r.name, r.type, r.housekeeper, r.comments, r.stay?.guest, r.arriving, r.frontdesk].join(' ').toLowerCase().includes(ql)
  }
  const list = rooms.filter(roomHit)
  const tasks: any[] = d.tasks.filter((t: any) => (!kind || t.kind === kind) && (!who || t.assigned_to === who) && (!ql || [t.room_name, t.kind, t.assigned_to, t.note].join(' ').toLowerCase().includes(ql)))
  const setTask = async (t: any, status: string) => { setWarn(''); const r = await post('/api/garden/tasks', { id: t.id, status }, 'PATCH'); setWarn(r?.warning || r?.error || r?.message || ''); reload() }
  const s = d.summary.hk
  // CLEANS BY TYPE (Jon, 2026-11-11: "stayover cleans, inspected units and checkout cleans").
  const byKind = (k: string) => { const L = d.tasks.filter((t: any) => t.kind === k && t.status !== 'cancelled'); return { total: L.length, done: L.filter((t: any) => t.status === 'done').length, going: L.filter((t: any) => t.status === 'in_progress').length } }
  const co = byKind('clean'), so = byKind('stayover'), ins = byKind('inspection')
  const turned = rooms.filter(r => r.departing && !r.oos)
  const turnedInspected = turned.filter(r => r.condition === 'inspected').length
  const n = (c: Cond) => c === 'all' ? rooms.length : c === 'oos' ? s.oos : c === 'flags' ? rooms.filter(r => r.dnd || r.refused || r.comments).length : c === 'turning' ? rooms.filter(r => r.departing || r.arriving).length : s[c]

  const cleanChip = (k: string, l: string, x: { total: number; done: number; going: number }, extra?: string) => (
    <button key={k} onClick={() => setKind(v => v === k ? '' : k)} className={`text-left rounded-xl border bg-white px-3 py-1.5 min-w-[9rem] ${kind === k ? 'border-brand-400 ring-1 ring-brand-200' : 'border-line'}`} title="Show these tasks below">
      <div className="text-[10.5px] uppercase tracking-wider text-muted font-semibold">{l}</div>
      <div className={`text-[16px] font-semibold tabular-nums ${x.total && x.done === x.total ? 'text-emerald-700' : 'text-ink'}`}>{x.done}/{x.total}</div>
      <div className="text-[11px] text-muted">{x.going ? `${x.going} in progress` : x.total - x.done ? `${x.total - x.done} to go` : x.total ? 'all done' : 'none today'}{extra ? ' · ' + extra : ''}</div>
    </button>
  )
  return (
    <>
      <div className="flex gap-1.5 flex-wrap mb-2">
        {cleanChip('clean', 'Checkout cleans', co)}
        {cleanChip('stayover', 'Stayover cleans', so)}
        {cleanChip('inspection', 'Inspections', ins, `${s.inspected} rooms inspected`)}
        <button onClick={() => setCond(c => c === 'turning' ? 'all' : 'turning')} className={`text-left rounded-xl border bg-white px-3 py-1.5 min-w-[9rem] ${cond === 'turning' ? 'border-brand-400 ring-1 ring-brand-200' : 'border-line'}`} title="Rooms with a departure today">
          <div className="text-[10.5px] uppercase tracking-wider text-muted font-semibold">Turned rooms inspected</div>
          <div className={`text-[16px] font-semibold tabular-nums ${turned.length && turnedInspected === turned.length ? 'text-emerald-700' : 'text-ink'}`}>{turnedInspected}/{turned.length}</div>
          <div className="text-[11px] text-muted">{turned.filter(r => r.condition === 'clean').length} clean, awaiting inspection</div>
        </button>
      </div>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <LeanPick<Cond> size="sm" value={cond} onPick={setCond} options={(['all', 'dirty', 'clean', 'inspected', 'turning', 'oos', 'flags'] as Cond[]).map(c => ({ v: c, label: <>{c === 'oos' ? 'Out of service' : c === 'flags' ? 'DND / refused / notes' : c === 'turning' ? 'Arriving / departing' : c[0].toUpperCase() + c.slice(1)} <span className="opacity-60 tabular-nums">{n(c)}</span></> }))} />
      </div>
      {hkNames.length ? (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Housekeeper</span>
          <LeanPick size="sm" value={who || '__all'} onPick={v => setWho(v === '__all' ? '' : v)} options={[{ v: '__all', label: 'Everyone' }, ...hkNames.map(h => ({ v: h, label: h }))]} />
        </div>
      ) : null}
      {!d.available.roomDetail ? <p className="text-[12px] text-amber-700 mb-2 px-1">Housekeeper, comments, DND and refused-service are not in the database yet (migration 170) — showing condition only.</p> : null}

      {d.housekeepers.length ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5 mb-3">
          {d.housekeepers.map((h: any) => (
            <button key={h.name} onClick={() => setWho(w => w === h.name ? '' : h.name)} className={`text-left rounded-xl border bg-white px-2.5 py-1.5 ${who === h.name ? 'border-brand-400 ring-1 ring-brand-200' : 'border-line'}`}>
              <div className="text-[12.5px] font-semibold text-ink truncate">{h.name}</div>
              <div className="text-[11px] text-muted tabular-nums">
                {h.rooms ? <>{h.clean}/{h.rooms} rooms ready{h.dirty ? <span className="text-rose-700"> · {h.dirty} dirty</span> : null}</> : null}
                {h.rooms && h.tasks ? ' · ' : null}
                {h.tasks ? <>{h.done}/{h.tasks} tasks</> : null}
              </div>
            </button>
          ))}
        </div>
      ) : null}

      <h2 className="text-[11px] font-bold uppercase tracking-wider mb-1.5 px-1 text-muted">Rooms <span className="tabular-nums">{list.length}</span></h2>
      {!rooms.length ? <LeanEmpty>No rooms synced from Cloudbeds yet.</LeanEmpty> : !list.length ? <LeanEmpty>No rooms in this view.</LeanEmpty> : (
        <Table head={['Room', 'Type', 'Condition', 'Housekeeper', 'Guest', 'Flags', 'Tasks', 'Comments']}>
          {list.map(r => (
            <tr key={r.id} className={r.oos ? 'bg-slate-50' : ''}>
              <Td className="font-semibold text-ink tabular-nums">{r.name}</Td>
              <Td className="text-muted max-w-[10rem] truncate" title={r.type || ''}>{r.type || '—'}</Td>
              <Td>{r.condition ? <Tag tone={COND_TONE[r.condition] || 'slate'} title={r.conditionAt ? `Updated ${clock(r.conditionAt)}` : undefined}>{r.condition}</Tag> : <Tag>unknown</Tag>}</Td>
              <Td className={r.housekeeper ? 'text-ink' : 'text-muted'}>{r.housekeeper || '—'}</Td>
              <Td className="max-w-[14rem] truncate">
                <span className="inline-flex items-center gap-1">
                  {r.departing ? <Tag tone="amber">out</Tag> : null}
                  {r.arriving ? <Tag tone="emerald" title={`Arriving: ${r.arriving}`}>in</Tag> : null}
                  <span className={r.stay ? 'text-ink' : 'text-muted'}>{r.stay ? `${r.stay.guest} → ${dayShort(r.stay.out)}` : r.arriving || 'vacant'}</span>
                </span>
              </Td>
              <Td>
                <span className="inline-flex items-center gap-1">
                  {r.oos ? <Tag tone="roseSolid" title={[r.oos.reason, r.oos.until ? `until ${dayShort(r.oos.until)}` : ''].filter(Boolean).join(' · ') || undefined}>{label(r.oos.kind) || 'OOS'}</Tag> : null}
                  {r.dnd ? <Tag tone="violet">DND</Tag> : null}
                  {r.refused ? <Tag tone="rose">refused svc</Tag> : null}
                  {r.frontdesk ? <Tag tone="sky" title="Cloudbeds front-desk status">{label(r.frontdesk)}</Tag> : null}
                  {!r.oos && !r.dnd && !r.refused && !r.frontdesk ? <span className="text-muted">—</span> : null}
                </span>
              </Td>
              <Td>{r.tasks.length ? <span className="inline-flex items-center gap-1">{r.tasks.map((t: any) => <Tag key={t.id} tone={TASK_TONE[t.status] || 'slate'} title={`${KIND_LABEL[t.kind] || t.kind}${t.assigned_to ? ` · ${t.assigned_to}` : ''}`}>{(KIND_LABEL[t.kind] || t.kind).split(' ')[0].toLowerCase()} {label(t.status)}</Tag>)}</span> : <span className="text-muted">—</span>}</Td>
              <Td className="text-muted max-w-[18rem] truncate" title={r.comments || ''}>{r.comments || '—'}</Td>
            </tr>
          ))}
        </Table>
      )}

      <h2 className="text-[11px] font-bold uppercase tracking-wider mb-1.5 px-1 text-muted flex items-center gap-2">Tasks today <span className="tabular-nums">{d.summary.tasks.done}/{d.summary.tasks.total} done</span>{kind ? <button onClick={() => setKind('')} className="normal-case tracking-normal font-semibold text-brand-700">· {KIND_LABEL[kind] || kind} only — show all</button> : null}</h2>
      {warn ? <p className="text-[12px] text-amber-700 mb-1 px-1">{warn}</p> : null}
      {!d.tasks.length ? <LeanEmpty>No tasks today. Departure cleans and stayovers are created from Cloudbeds reservations on every sync.</LeanEmpty> : !tasks.length ? <LeanEmpty>No tasks in this view.</LeanEmpty> : (
        <Table head={['Room', 'Task', 'Assigned', 'Status', 'Started', 'Done', 'Note', '']}>
          {tasks.map(t => (
            <tr key={t.id} className={t.status === 'done' || t.status === 'cancelled' ? 'opacity-60' : ''}>
              <Td className="font-semibold text-ink tabular-nums">{t.room_name || '—'}</Td>
              <Td>{KIND_LABEL[t.kind] || label(t.kind)}{t.priority && t.priority !== 'none' ? <span className="ml-1"><Tag tone="violet">{t.priority}</Tag></span> : null}</Td>
              <Td className={t.assigned_to ? 'text-ink' : 'text-muted'}>{t.assigned_to || 'unassigned'}</Td>
              <Td><Tag tone={TASK_TONE[t.status] || 'slate'}>{label(t.status)}</Tag></Td>
              <Td className="text-muted tabular-nums">{clock(t.started_at)}</Td>
              <Td className="text-muted tabular-nums" title={t.finished_by || ''}>{clock(t.finished_at)}</Td>
              <Td className="text-muted max-w-[16rem] truncate" title={t.note || ''}>{t.note || '—'}</Td>
              <Td className="text-right">
                {canTasks && t.status === 'open' ? <button onClick={() => setTask(t, 'in_progress')} title="Start" className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] font-semibold text-muted hover:text-ink"><Play size={11} /> start</button> : null}
                {canTasks && t.status === 'in_progress' ? <button onClick={() => setTask(t, 'done')} title="Finish (marks the room clean in Cloudbeds)" className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700"><Check size={11} /> done</button> : null}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}

function Team({ d, q }: { d: any; q: string }) {
  const ql = q.toLowerCase()
  const list: any[] = d.team.filter((p: any) => !ql || [p.name, p.department, p.shift?.role, (p.shift?.rooms || []).join(' ')].join(' ').toLowerCase().includes(ql))
  const notes = [
    !d.available.shifts ? 'Shifts table not available.' : null,
    !d.available.timecards ? 'Homebase timecards not available.' : d.syncs?.homebase_timecards?.at ? `Homebase punches ${ago(d.syncs.homebase_timecards.at)}.` : 'Homebase timecards never synced.',
  ].filter(Boolean)
  if (!d.team.length) return <><LeanEmpty>Nobody is scheduled or clocked in today. Shifts come from the Schedule page; punches from Homebase.</LeanEmpty><p className="text-[11.5px] text-muted mt-1.5 px-1">{notes.join(' ')}</p></>
  if (!list.length) return <LeanEmpty>Nobody matches “{q}”.</LeanEmpty>
  const depts = Array.from(new Set(list.map(p => p.department)))
  return (
    <>
      {depts.map(dep => {
        const ppl = list.filter(p => p.department === dep)
        return (
          <section key={dep}>
            <h2 className="text-[11px] font-bold uppercase tracking-wider mb-1.5 px-1 text-muted flex items-center gap-2">{DEPT_LABEL[dep] || label(dep)} <span className="tabular-nums">{ppl.filter(p => p.state === 'on').length}/{ppl.length} on</span></h2>
            <Table head={['Name', 'Shift', 'Clock in', 'Clock out', 'Hours', 'Status', 'Rooms']}>
              {ppl.map(p => (
                <tr key={p.key}>
                  <Td className="font-semibold text-ink">
                    <span className="inline-flex items-center gap-1.5">{p.phone ? <a href={`tel:${p.phone}`} aria-label={`Call ${p.name}`} className="text-muted hover:text-brand-700"><Phone size={12} /></a> : null}{p.name}</span>
                  </Td>
                  <Td className="tabular-nums text-muted">{p.shift ? `${hhmm(p.shift.start)}–${hhmm(p.shift.end)}` : '—'}</Td>
                  <Td className="tabular-nums">{clock(p.clockIn)}</Td>
                  <Td className="tabular-nums text-muted">{p.state === 'on' ? 'on shift' : clock(p.clockOut)}</Td>
                  <Td className="tabular-nums text-muted">{p.hours ? p.hours : '—'}</Td>
                  <Td><Tag tone={STATE[p.state]?.tone || 'slate'}>{STATE[p.state]?.t || p.state}</Tag></Td>
                  <Td className="text-muted max-w-[16rem] truncate" title={(p.shift?.rooms || []).join(', ')}>{p.shift?.rooms?.length ? `${p.shift.rooms.length}: ${p.shift.rooms.join(', ')}` : '—'}</Td>
                </tr>
              ))}
            </Table>
          </section>
        )
      })}
      <p className="text-[11.5px] text-muted px-1">{notes.join(' ')}</p>
    </>
  )
}
