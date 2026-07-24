'use client'
// GLITCH BOARD — the Asana "VR Glitch/Incident Reporting" workflow, rebuilt in-app.
// Pool → Ops → Guest Followup → Refund → Manager Review → Incident → Closed.
// Create a glitch by searching the guest name (reservation details auto-attach), push a
// Breezeway task for the field, and move the card along the escalation path.
import { useState, useEffect, useCallback } from 'react'
import { Plus, RefreshCw, Search, X, Camera } from 'lucide-react'

type Glitch = {
  id: string; status: string; glitch_type: string | null; category: string | null
  listing_id: string | null; unit: string | null; market: string | null
  reservation_id: string | null; guest_name: string | null; guest_phone: string | null
  channel: string | null; check_in: string | null; check_out: string | null
  reservation_total: number | null; incident_date: string | null; overview: string | null
  recovery_cost: number | null; refund_approved: number | null; reported_by: string | null; guest_email: string | null
  breezeway_task_id: string | null; photos: string[] | null; task_status: string | null
  created_at: string
}
type ResMatch = { reservationId: string; listingId: string; unit: string; market: string; guestName: string; guestPhone: string | null; checkIn: string; checkOut: string; channel: string | null; total: number | null }

const COLS: { key: string; label: string }[] = [
  { key: 'pool', label: 'Glitch pool' },
  { key: 'ops', label: 'VR Ops' },
  { key: 'guest_followup', label: 'Guest followup' },
  { key: 'refund', label: 'Refund request' },
  { key: 'manager_review', label: 'Manager review' },
  { key: 'incident', label: 'Incident report' },
  { key: 'closed', label: 'Closed' },
]
const TYPES = ['Glitch (Quality Issue)', 'Security Incident', 'Injury']
const CATS = [
  'Maintenance - HVAC/Temperature', 'Maintenance - Water Heater', 'Maintenance - Plumbing',
  'Maintenance - Electrical', 'Maintenance - Building/Common Areas', 'Maintenance - Appliances',
  'Cleanliness - Inadequate Cleaning', 'Pests/Bed Bugs', 'Safety/Security Concern', 'Parking/Vehicle', 'Other',
]
function fmtShort(iso: string | null) { if (!iso) return ''; const d = new Date(iso + 'T12:00:00'); if (isNaN(d.getTime())) return iso || ''; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
function money(n: number | null) { return n == null ? null : '$' + Math.round(n).toLocaleString() }

export function GlitchBoard() {
  const [glitches, setGlitches] = useState<Glitch[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [market, setMarket] = useState('all')
  const [showNew, setShowNew] = useState(false)
  const [open, setOpen] = useState<string>('')
  const [people, setPeople] = useState<{ id: number; name: string; departments: string[] }[]>([])
  const [panel, setPanel] = useState<string>('')  // '<id>:edit' | '<id>:push'

  const load = useCallback(async () => {
    try {
      setErr('')
      const r = await fetch('/api/glitches', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Failed to load'); setLoading(false); return }
      setGlitches(j.glitches || [])
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { fetch('/api/breezeway/people', { cache: 'no-store' }).then(r => r.json()).then(j => setPeople(Array.isArray(j.people) ? j.people : [])).catch(() => {}) }, [])

  const act = async (id: string, body: Record<string, any>, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return
    try {
      const r = await fetch('/api/glitches/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Action failed'); return }
      if (body.action === 'checkTask') {
        if (j.suggestFollowup && window.confirm('Breezeway task is ' + j.taskStatus + '. Move this glitch to Guest followup?')) { await act(id, { action: 'move', status: 'guest_followup' }); return }
        window.alert('Breezeway task status: ' + j.taskStatus)
        return
      }
      load()
    } catch (e: any) { setErr(String(e?.message || e)) }
  }

  const rows = market === 'all' ? glitches : glitches.filter(g => g.market === market)
  const markets = ['all', 'Miami', 'Broward', 'North', 'Vendor']

  if (loading && !glitches.length) return <div className="text-sm text-muted py-10 text-center">Loading glitch board…</div>

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <button onClick={() => setShowNew(!showNew)} className="text-sm font-medium px-3 py-1.5 rounded-lg bg-ink text-white inline-flex items-center gap-1.5"><Plus size={14} /> New glitch</button>
        {markets.map(m => (
          <button key={m} onClick={() => setMarket(m)} className={'text-sm font-medium px-3 py-1.5 rounded-lg border transition ' + (market === m ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:bg-app')}>{m === 'all' ? 'All markets' : m}</button>
        ))}
        <button onClick={() => { setLoading(true); load() }} className="ml-auto text-sm font-medium px-3 py-1.5 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1.5"><RefreshCw size={13} /> Refresh</button>
      </div>
      {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">{err}</div>}
      {showNew && <NewGlitch onDone={() => { setShowNew(false); load() }} onCancel={() => setShowNew(false)} />}

      <div className="flex gap-3 overflow-x-auto pb-4 items-start">
        {COLS.map(col => {
          const cards = rows.filter(g => g.status === col.key)
          return (
            <div key={col.key} className="w-72 shrink-0 rounded-2xl bg-app/70 border border-line">
              <div className="px-3 py-2 flex items-center gap-2 border-b border-line">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink">{col.label}</span>
                <span className="text-[11px] font-semibold text-muted">{cards.length}</span>
              </div>
              <div className="p-2 space-y-2 min-h-[60px]" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) act(id, { action: 'move', status: col.key }) }}>
                {cards.map(g => {
                  const ci = COLS.findIndex(c => c.key === g.status)
                  const isOpen = open === g.id
                  return (
                    <div key={g.id} draggable onDragStart={e => e.dataTransfer.setData('text/plain', g.id)} className="rounded-xl border border-line bg-white shadow-soft cursor-grab active:cursor-grabbing">
                      <button onClick={() => setOpen(isOpen ? '' : g.id)} className="w-full text-left px-3 py-2.5">
                        <div className="text-sm font-semibold text-ink leading-snug">{g.guest_name ? g.guest_name + ' · ' : ''}{g.unit || 'No unit'}</div>
                        <div className="text-xs text-muted mt-0.5 line-clamp-2">{g.overview}</div>
                        <div className="flex items-center gap-1 flex-wrap mt-1.5">
                          {g.glitch_type && g.glitch_type !== 'Glitch (Quality Issue)' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-600 text-white">{g.glitch_type}</span>}
                          {g.category && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">{g.category.replace('Maintenance - ', '')}</span>}
                          {g.market && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-app text-muted border border-line">{g.market}</span>}
                          {g.channel && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">{g.channel}</span>}
                          {g.incident_date && <span className="text-[9px] text-muted">{fmtShort(g.incident_date)}</span>}
                          {(g.recovery_cost || 0) > 0 && <span className="text-[9px] font-bold text-rose-700">{money(g.recovery_cost)}</span>}
                          {(g.photos || []).length > 0 && <span className="text-[9px] text-muted inline-flex items-center gap-0.5"><Camera size={9} />{(g.photos || []).length}</span>}
                          {g.breezeway_task_id && <span className={'text-[9px] font-semibold px-1.5 py-0.5 rounded border ' + (g.task_status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : g.task_status === 'in_progress' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-violet-50 text-violet-700 border-violet-200')}>{g.task_status === 'completed' ? 'Task completed' : g.task_status === 'in_progress' ? 'Task in progress' : 'Task not started'}</span>}
                          {(g.refund_approved || 0) > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-600 text-white">Refund {money(g.refund_approved)}</span>}
                        </div>
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-2.5 border-t border-line pt-2 space-y-1.5">
                          {g.check_in && <div className="text-[11px] text-muted">Stay {fmtShort(g.check_in)} &rarr; {fmtShort(g.check_out)}{g.reservation_total ? ' · ' + money(g.reservation_total) : ''}{g.guest_phone ? ' · ' + g.guest_phone : ''}</div>}
                          {(g.photos || []).length > 0 && (
                            <div className="flex gap-1 flex-wrap">{(g.photos || []).map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="w-12 h-12 object-cover rounded border border-line" /></a>)}</div>
                          )}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {ci > 0 && <button onClick={() => act(g.id, { action: 'move', status: COLS[ci - 1].key })} className="text-[11px] font-medium px-2 py-1 rounded-md border border-line bg-white hover:bg-app">&larr; {COLS[ci - 1].label}</button>}
                            {ci < COLS.length - 1 && <button onClick={() => act(g.id, { action: 'move', status: COLS[ci + 1].key })} className="text-[11px] font-medium px-2 py-1 rounded-md border border-ink bg-ink text-white">{COLS[ci + 1].label} &rarr;</button>}
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {!g.breezeway_task_id && <button onClick={() => setPanel(panel === g.id + ':push' ? '' : g.id + ':push')} className="text-[11px] font-medium px-2 py-1 rounded-md border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100">Push to Breezeway</button>}
                            <button onClick={() => setPanel(panel === g.id + ':edit' ? '' : g.id + ':edit')} className="text-[11px] font-medium px-2 py-1 rounded-md border border-line bg-white hover:bg-app">Edit</button>
                            {g.breezeway_task_id && <a href={'https://app.breezeway.io/task/' + g.breezeway_task_id} target="_blank" rel="noreferrer" className="text-[11px] font-medium px-2 py-1 rounded-md border border-line bg-white text-brand-600 hover:underline">Task {g.breezeway_task_id}</a>}
                            {g.breezeway_task_id && <button onClick={() => act(g.id, { action: 'checkTask' })} className="text-[11px] font-medium px-2 py-1 rounded-md border border-line bg-white hover:bg-app">Check status</button>}
                            <button onClick={() => act(g.id, { action: 'delete' }, 'Delete this glitch record? (The Breezeway task, if any, stays.)')} className="text-[11px] font-medium px-2 py-1 rounded-md border border-line bg-white text-muted hover:text-rose-700 hover:border-rose-300">Delete</button>
                          </div>
                          {panel === g.id + ':push' && <PushPanel g={g} people={people} onDone={() => { setPanel(''); load() }} act={act} />}
                          {panel === g.id + ':edit' && <EditGlitch g={g} onDone={() => { setPanel(''); load() }} />}
                        </div>
                      )}
                    </div>
                  )
                })}
                {cards.length === 0 && <div className="text-[11px] text-muted text-center py-4">Empty</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NewGlitch({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [q, setQ] = useState('')
  const [matches, setMatches] = useState<ResMatch[]>([])
  const [searching, setSearching] = useState(false)
  const [res, setRes] = useState<ResMatch | null>(null)
  const [glitchType, setGlitchType] = useState(TYPES[0])
  const [category, setCategory] = useState('')
  const [incidentDate, setIncidentDate] = useState('')
  const [overview, setOverview] = useState('')
  const [recovery, setRecovery] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [reportedBy, setReportedBy] = useState('')
  const [guestEmail, setGuestEmail] = useState('')

  const search = async () => {
    if (!q.trim()) return
    setSearching(true); setErr('')
    try {
      const r = await fetch('/api/glitches?guest=' + encodeURIComponent(q.trim()), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Search failed') } else setMatches(j.matches || [])
    } catch (e: any) { setErr(String(e?.message || e)) }
    setSearching(false)
  }

  const addPhoto = async (f: File) => {
    setErr('')
    try {
      const buf = await f.arrayBuffer()
      let bin = ''
      const bytes = new Uint8Array(buf)
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 8192)))
      const b64 = btoa(bin)
      const r = await fetch('/api/glitches/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ b64, filename: f.name, contentType: f.type || 'image/jpeg' }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Upload failed'); return }
      setPhotos(prev => prev.concat([j.url]))
    } catch (e: any) { setErr(String(e?.message || e)) }
  }

  const create = async () => {
    setBusy(true); setErr('')
    try {
      const body: Record<string, any> = {
        glitchType, category, incidentDate, overview, recoveryCost: recovery, photos, reportedBy, guestEmail,
      }
      if (res) Object.assign(body, { reservationId: res.reservationId, listingId: res.listingId, unit: res.unit, market: res.market, guestName: res.guestName, guestPhone: res.guestPhone, channel: res.channel, checkIn: res.checkIn, checkOut: res.checkOut, reservationTotal: res.total })
      const r = await fetch('/api/glitches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not create'); setBusy(false); return }
      onDone()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-ink">New glitch</div>
        <button onClick={onCancel} className="text-xs font-medium px-2 py-1 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1 text-muted"><X size={12} /> Cancel</button>
      </div>
      {!res && (
        <div className="mb-3">
          <div className="flex gap-2 max-w-md">
            <span className="relative flex-1">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
              <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search() }} placeholder="Search guest name…" className="w-full text-sm border border-line rounded-lg pl-7 pr-2 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200" />
            </span>
            <button onClick={search} disabled={searching || !q.trim()} className="text-sm font-medium px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-40">{searching ? 'Searching…' : 'Find reservation'}</button>
          </div>
          {matches.length > 0 && (
            <div className="mt-2 space-y-1 max-w-xl">
              {matches.map(m => (
                <button key={m.reservationId} onClick={() => setRes(m)} className="w-full text-left text-sm border border-line rounded-lg px-3 py-2 bg-white hover:bg-app flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-ink">{m.guestName}</span>
                  <span className="text-xs text-muted">{m.unit} · {fmtShort(m.checkIn)} &rarr; {fmtShort(m.checkOut)}{m.channel ? ' · ' + m.channel : ''}{m.total ? ' · ' + money(m.total) : ''}</span>
                </button>
              ))}
            </div>
          )}
          <div className="text-[11px] text-muted mt-1.5">Or skip the reservation and just describe the glitch below.</div>
        </div>
      )}
      {res && (
        <div className="mb-3 text-sm bg-app border border-line rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap">
          <span className="font-medium text-ink">{res.guestName}</span>
          <span className="text-xs text-muted">{res.unit} · {res.market} · {fmtShort(res.checkIn)} &rarr; {fmtShort(res.checkOut)}{res.channel ? ' · ' + res.channel : ''}{res.total ? ' · ' + money(res.total) : ''}{res.guestPhone ? ' · ' + res.guestPhone : ''}</span>
          <button onClick={() => setRes(null)} className="ml-auto text-xs text-muted hover:text-ink">change</button>
        </div>
      )}
      <div className="flex gap-2 flex-wrap items-center mb-2">
        <select value={glitchType} onChange={e => setGlitchType(e.target.value)} className="text-sm border border-line rounded-lg px-2 py-2 bg-white">{TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
        <select value={category} onChange={e => setCategory(e.target.value)} className={'text-sm border rounded-lg px-2 py-2 bg-white ' + (category ? 'border-line' : 'border-amber-300')}><option value="">Category * …</option>{CATS.map(c => <option key={c} value={c}>{c}</option>)}</select>
        <label className="text-sm text-muted inline-flex items-center gap-1.5">Incident date * <input type="date" value={incidentDate} onChange={e => setIncidentDate(e.target.value)} className={'text-sm border rounded-lg px-2 py-1.5 bg-white ' + (incidentDate ? 'border-line' : 'border-amber-300')} /></label>
        <label className="text-sm text-muted inline-flex items-center gap-1.5">Recovery $ <input value={recovery} onChange={e => setRecovery(e.target.value)} placeholder="0" className="text-sm border border-line rounded-lg px-2 py-1.5 bg-white w-20" /></label>
      </div>
      <div className="flex gap-2 flex-wrap items-center mb-2">
        <input value={reportedBy} onChange={e => setReportedBy(e.target.value)} placeholder="Who called / reported (e.g. CCS, Amna)" className="text-sm border border-line rounded-lg px-2 py-1.5 bg-white w-64" />
        <input value={guestEmail} onChange={e => setGuestEmail(e.target.value)} placeholder="Guest email (optional)" className="text-sm border border-line rounded-lg px-2 py-1.5 bg-white w-64" />
      </div>
      <textarea value={overview} onChange={e => setOverview(e.target.value)} rows={3} placeholder="What happened? * (overview the team + Breezeway will see)" className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200" />
      <div className="flex items-center gap-2 flex-wrap mt-2">
        <label className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line cursor-pointer hover:bg-app"><Camera size={13} /> Add photo<input type="file" accept="image/*" multiple className="hidden" onChange={e => { const fs = Array.from(e.target.files || []); fs.forEach(addPhoto); e.currentTarget.value = '' }} /></label>
        {photos.map((u, i) => <span key={i} className="relative inline-block"><img src={u} alt="" className="w-10 h-10 object-cover rounded border border-line" /><button onClick={() => setPhotos(photos.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 bg-rose-600 text-white rounded-full p-0.5"><X size={9} /></button></span>)}
        <button onClick={create} disabled={busy || !overview.trim() || !category || !incidentDate} className="ml-auto text-sm font-medium px-4 py-2 rounded-lg bg-ink text-white disabled:opacity-40">{busy ? 'Creating…' : 'Create glitch'}</button>
      </div>
      {err && <div className="text-xs text-rose-700 mt-2">{err}</div>}
    </div>
  )
}


// Push panel — issue text uses the Breezeway template naming ("Guest Reported / Glitch - <issue>")
// and an assignee can be picked right here. Pushes are URGENT: guest glitches are priority field issues.
function PushPanel({ g, people, onDone, act }: { g: Glitch; people: { id: number; name: string; departments: string[] }[]; onDone: () => void; act: (id: string, body: Record<string, any>, c?: string) => Promise<void> }) {
  const [issue, setIssue] = useState((g.overview || '').split('\n')[0].slice(0, 70))
  const [assignee, setAssignee] = useState('')
  const [busy, setBusy] = useState(false)
  const doPush = async () => {
    setBusy(true)
    const nm = assignee.trim().replace(/\s*\([^)]*\)\s*$/, '')
    const p = people.find(x => x.name === nm)
    await act(g.id, { action: 'push', issue: issue.trim(), assigneeIds: p ? [p.id] : [] })
    setBusy(false); onDone()
  }
  return (
    <div className="mt-1.5 rounded-lg border border-violet-200 bg-violet-50/50 p-2 space-y-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">Push to Breezeway (urgent)</div>
      <div className="text-[11px] text-muted">Task: <span className="text-ink">Guest Reported / Glitch - {issue || '…'}</span></div>
      <input value={issue} onChange={e => setIssue(e.target.value)} placeholder="Short issue (e.g. Hot water issue.)" className="w-full text-xs border border-line rounded px-2 py-1.5 bg-white" />
      <input list="glitch-board-ppl" value={assignee} onChange={e => setAssignee(e.target.value)} placeholder="Assignee (optional)…" className="w-full text-xs border border-line rounded px-2 py-1.5 bg-white" />
      <datalist id="glitch-board-ppl">{people.map(p => <option key={p.id} value={p.name + (p.departments && p.departments.length ? ' (' + p.departments.join('/') + ')' : '')} />)}</datalist>
      <button onClick={doPush} disabled={busy || !issue.trim()} className="text-[11px] font-medium px-2.5 py-1.5 rounded-md bg-violet-600 text-white disabled:opacity-40">{busy ? 'Pushing…' : 'Create task'}</button>
    </div>
  )
}

// Edit panel — every field editable after creation.
function EditGlitch({ g, onDone }: { g: Glitch; onDone: () => void }) {
  const [f, setF] = useState({
    glitchType: g.glitch_type || TYPES[0], category: g.category || '', incidentDate: g.incident_date || '',
    overview: g.overview || '', recoveryCost: String(g.recovery_cost || ''), refundApproved: String(g.refund_approved || ''),
    reportedBy: g.reported_by || '', guestName: g.guest_name || '', guestPhone: g.guest_phone || '', guestEmail: g.guest_email || '', unit: g.unit || '', channel: g.channel || '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: string, v: string) => setF(prev => ({ ...prev, [k]: v }))
  const save = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/glitches/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: g.id, action: 'update', ...f }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Save failed'); setBusy(false); return }
      onDone()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  return (
    <div className="mt-1.5 rounded-lg border border-line bg-app/60 p-2 space-y-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Edit glitch</div>
      <div className="grid grid-cols-2 gap-1.5">
        <select value={f.glitchType} onChange={e => set('glitchType', e.target.value)} className="text-xs border border-line rounded px-1.5 py-1.5 bg-white">{TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
        <select value={f.category} onChange={e => set('category', e.target.value)} className="text-xs border border-line rounded px-1.5 py-1.5 bg-white"><option value="">Category…</option>{CATS.map(c => <option key={c} value={c}>{c}</option>)}</select>
        <input type="date" value={f.incidentDate} onChange={e => set('incidentDate', e.target.value)} className="text-xs border border-line rounded px-1.5 py-1.5 bg-white" />
        <input value={f.unit} onChange={e => set('unit', e.target.value)} placeholder="Unit" className="text-xs border border-line rounded px-1.5 py-1.5 bg-white" />
        <input value={f.guestName} onChange={e => set('guestName', e.target.value)} placeholder="Guest name" className="text-xs border border-line rounded px-1.5 py-1.5 bg-white" />
        <input value={f.guestPhone} onChange={e => set('guestPhone', e.target.value)} placeholder="Guest phone" className="text-xs border border-line rounded px-1.5 py-1.5 bg-white" />
        <input value={f.guestEmail} onChange={e => set('guestEmail', e.target.value)} placeholder="Guest email" className="text-xs border border-line rounded px-1.5 py-1.5 bg-white" />
        <input value={f.channel} onChange={e => set('channel', e.target.value)} placeholder="Channel (Airbnb…)" className="text-xs border border-line rounded px-1.5 py-1.5 bg-white" />
        <input value={f.recoveryCost} onChange={e => set('recoveryCost', e.target.value)} placeholder="Recovery cost $" className="text-xs border border-line rounded px-1.5 py-1.5 bg-white" />
        <input value={f.refundApproved} onChange={e => set('refundApproved', e.target.value)} placeholder="Refund approved $" className="text-xs border border-line rounded px-1.5 py-1.5 bg-white" />
        <input value={f.reportedBy} onChange={e => set('reportedBy', e.target.value)} placeholder="Reported by" className="text-xs border border-line rounded px-1.5 py-1.5 bg-white col-span-2" />
      </div>
      <textarea value={f.overview} onChange={e => set('overview', e.target.value)} rows={3} className="w-full text-xs border border-line rounded px-2 py-1.5 bg-white" />
      <div className="flex items-center gap-1.5">
        <button onClick={save} disabled={busy} className="text-[11px] font-medium px-2.5 py-1.5 rounded-md bg-ink text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>
        {err && <span className="text-[10px] text-rose-700">{err}</span>}
      </div>
    </div>
  )
}
