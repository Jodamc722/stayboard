'use client'
// ADD A TASK — the Breezeway-shaped one (Jon, 2026-09-14: "add a way to add a task easy, should
// feel like breezeway — assign a template, pick the date, assign the team member, edit the title").
//
// ── WHY THIS MOVED OUT OF OpsV2 ─────────────────────────────────────────────────────────────────
// The sheet already did all four of those things. The problem was never the fields; it was that
// you could only reach it from one page, and that it made you answer a question first.
//
//   REACH. It lived inside components/OpsV2, which renders on Today in Ops and nowhere else. If
//   you were looking at a glitch, a reservation, a building or a review and wanted to file the
//   work you just decided on, there was no way to do it without navigating away first — and
//   navigating away is where the thought gets dropped. It now mounts once in the app shell and
//   opens from anywhere: the ＋ Task button in the sidebar, the ＋ in the phone header, or
//   openAddTask() from any component that has a unit in its hand.
//
//   THE GATE. Everything except the unit picker was hidden behind `{unit && (…)}`. So the sheet
//   opened as a single empty box and revealed itself only once you had picked the right listing —
//   which is backwards from how the work actually arrives. In Breezeway you start from whatever
//   you know: sometimes the unit, often the template ("PM check"), sometimes just the title. The
//   whole form is visible from the first frame now; the unit is one required field among several,
//   and Create says which piece is still missing rather than silently staying grey.
//
// ── THE DESCRIPTION: THIS SHEET DOES NOT WRITE THE UNIT BRIEF ───────────────────────────────────
// /api/ops-today/add-task has attached lib/listingIntel to every task it creates since August —
// role-shaped (a cleaner, an inspector and a tech need three different briefs), bilingual, scored
// against the portfolio. This sheet used to compose its OWN guest feedback and quoted review in
// the browser, and the server then appended the real block underneath, so the crew opened a task
// carrying the same complaint twice in two formats. That was the noise.
//
// The box below therefore holds the STANDING INSTRUCTION for this kind of work and anything the
// person types — nothing about this particular unit. What the unit has on it is SHOWN beside the
// box instead, so you can see it while you decide, and attached once by the server on create.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X, Loader2, Users, CalendarDays, Search } from 'lucide-react'
import { useModal } from '@/components/Modal'
import { previewRows, type BriefIntel } from '@/lib/task-brief'
import { matchRoster } from '@/lib/roster-match'

export type Roster = { id: number; name: string; departments: string[] }
type Listing = { id: string; nickname?: string | null; title?: string | null; building?: string | null; status?: string | null }
type BzTpl = { id: number; name: string; department: string; description: string }

// WHAT THE CALLER ALREADY KNOWS (Jon, 2026-09-14: "add task should be in today in ops at the team
// level, unit level etc"). A ＋ on a unit row knows the listing; a ＋ on a person row knows who is
// standing there. Making somebody re-type either — on the screen that just showed it to them — is
// the difference between filing the task and deciding to do it later.
//
// listingId beats unit text: the text goes through the search box and can miss or match two, while
// the id is the answer. The text is kept as the label so the picker reads right before it resolves.
export type AddTaskSeed = { unit?: string; listingId?: string; assigneeName?: string; date?: string }

/** Open the sheet from anywhere, optionally pre-filled. A bare string still means the unit search. */
export function openAddTask(seed?: AddTaskSeed | string) {
  const detail: AddTaskSeed = typeof seed === 'string' ? { unit: seed } : (seed || {})
  try { window.dispatchEvent(new CustomEvent('task:add', { detail })) } catch { /* SSR */ }
}

// The quick presets. These are OUR standing instructions for work that has no Breezeway template,
// and they are deliberately one sentence each: everything unit-specific comes from the brief.
const PRESETS: { key: string; label: string; hint: string; department: string; priority: string; title: string; base: string; useIntel?: boolean }[] = [
  { key: 'inspection', label: 'Inspection', hint: 'standard unit check', department: 'inspection', priority: 'high', title: 'Unit Check', useIntel: true, base: 'Standard unit inspection: cleanliness against the photos, damage and wear, amenities present and working, consumables restocked.' },
  { key: 'deepclean', label: 'Deep clean', hint: 'beyond turnover', department: 'housekeeping', priority: 'normal', title: 'Deep Clean', useIntel: true, base: 'Deep clean beyond the turnover standard: inside appliances, behind and under furniture, grout and caulk, vents, baseboards, window tracks, upholstery and mattress protectors.' },
  { key: 'pm', label: 'PM check', hint: 'A/C, plumbing, detectors', department: 'maintenance', priority: 'normal', title: 'Preventative Maintenance Task', useIntel: true, base: 'Preventative maintenance pass: A/C, plumbing under sinks, water heater, smoke and CO detectors, light bulbs, door hardware.' },
  { key: 'batteries', label: 'Lock batteries', hint: 'annual', department: 'maintenance', priority: 'normal', title: 'Replace lock batteries', base: 'Annual lock battery replacement. Replace batteries in every door lock, re-test the lock and the codes afterwards, and log the date.' },
  { key: 'acfilter', label: 'A/C filter', hint: 'size + date', department: 'maintenance', priority: 'normal', title: 'Change A/C filter', base: 'Change the central A/C filter. Note the filter size used and log the date.' },
  { key: 'audit', label: 'Annual audit', hint: 'files the audit link', department: 'inspection', priority: 'normal', title: 'Annual Quality Audit', useIntel: true, base: 'Annual quality audit: score the unit against the standard checklist, log damage and wear, confirm inventory counts, photograph anything below standard.' },
  { key: 'custom', label: 'Custom', hint: 'type it yourself', department: 'maintenance', priority: 'normal', title: '', base: '' },
]

const DEPTS = ['maintenance', 'housekeeping', 'inspection', 'safety']
const PRIOS = ['normal', 'high', 'urgent', 'low']
const todayYmd = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

/** Mounted once, in the app shell. Listens for openAddTask() and renders the sheet when asked. */
export function AddTaskHost() {
  const [open, setOpen] = useState(false)
  const [seed, setSeed] = useState<AddTaskSeed>({})
  useEffect(() => {
    const on = (e: any) => { setSeed((e?.detail || {}) as AddTaskSeed); setOpen(true) }
    window.addEventListener('task:add', on)
    return () => window.removeEventListener('task:add', on)
  }, [])
  if (!open) return null
  // Keyed on the seed so opening it again for a DIFFERENT unit remounts with that unit, rather
  // than reopening on whatever the last one left behind.
  return <AddTaskSheet key={JSON.stringify(seed)} seed={seed} onClose={() => setOpen(false)} onDone={() => setOpen(false)} />
}

export function AddTaskSheet({
  roster: rosterProp, onClose, onDone, initialQuery, boardDate, seed,
}: {
  roster?: Roster[]
  onClose: () => void
  onDone: () => void
  initialQuery?: string
  boardDate?: string
  seed?: AddTaskSeed
}) {
  const [listings, setListings] = useState<Listing[]>([])
  const [unitsReady, setUnitsReady] = useState(false)
  const [unitsErr, setUnitsErr] = useState(false)
  const [uq, setUq] = useState(seed?.unit || initialQuery || '')
  const [unit, setUnit] = useState<Listing | null>(null)
  const [tpl, setTpl] = useState('custom')
  const [bzTpls, setBzTpls] = useState<BzTpl[]>([])
  const [tplId, setTplId] = useState<number | null>(null)
  const [tplQ, setTplQ] = useState('')
  const [title, setTitle] = useState('')
  const [dept, setDept] = useState('maintenance')
  const [prio, setPrio] = useState('normal')
  const [date, setDate] = useState(seed?.date || boardDate || todayYmd())
  const [desc, setDesc] = useState('')
  // TRUE until the person edits the box by hand. Switching template swaps the standing instruction
  // underneath them — which is right until they have written something, at which point the box is
  // theirs and overwriting it would delete their words.
  const [descAuto, setDescAuto] = useState(true)
  const [picked, setPicked] = useState<number[]>([])
  const [intel, setIntel] = useState<BriefIntel | null>(null)
  const [intelBusy, setIntelBusy] = useState(false)
  const [roster, setRoster] = useState<Roster[]>(rosterProp || [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const boxRef = useRef<HTMLInputElement>(null)
  const { panelProps, onScrim } = useModal(onClose)

  useEffect(() => { if (boardDate) setDate(boardDate) }, [boardDate])

  useEffect(() => {
    // ?slim=1: the unfiltered route is select('*') — the whole Guesty raw blob for 233 listings —
    // to populate a name picker.
    fetch('/api/listings?slim=1', { cache: 'no-store' }).then(r => r.json())
      .then(j => {
        // A failed read must not read as "no such unit" — three states, not two.
        if (!Array.isArray(j.results)) { setUnitsErr(true); setUnitsReady(true); return }
        setListings(j.results); setUnitsReady(true)
      })
      .catch(() => { setUnitsErr(true); setUnitsReady(true) })
    fetch('/api/breezeway/templates', { cache: 'no-store' }).then(r => r.json())
      .then(j => setBzTpls(Array.isArray(j.templates) ? j.templates : [])).catch(() => {})
    if (!rosterProp?.length) {
      fetch('/api/breezeway/people', { cache: 'no-store' }).then(r => r.json())
        .then(j => setRoster(Array.isArray(j.people) ? j.people : [])).catch(() => {})
    }
    setTimeout(() => boxRef.current?.focus(), 60)
  }, [rosterProp?.length])

  // ── RESOLVE WHAT THE CALLER HANDED US ─────────────────────────────────────────────────────────
  // The listing id is the answer; the unit text is only a search term, and on a board full of
  // "OASIS - ROYAL PALM" names a search term can miss or match two. So when a ＋ on a unit row
  // gives us the id, the picker skips straight past itself.
  useEffect(() => {
    if (!seed?.listingId || unit || !listings.length) return
    const hit = listings.find(l => String(l.id) === String(seed.listingId))
    if (hit) setUnit(hit)
  }, [seed?.listingId, listings, unit])

  // A ＋ on a person row means "this person". matchRoster is the app's one matcher — exact name,
  // else a unique first name, else refuse: a guess that writes to Breezeway is worse than a chip
  // that stays unticked, so an ambiguous name just leaves the picker for a human.
  const seedAssignee = seed?.assigneeName
  useEffect(() => {
    if (!seedAssignee || !roster.length || picked.length) return
    const m = matchRoster(roster as any, seedAssignee)
    if (m.ok) setPicked([m.id])
  }, [seedAssignee, roster, picked.length])

  useEffect(() => {
    if (!unit) { setIntel(null); return }
    setIntelBusy(true)
    fetch('/api/schedule/listing-ops?listingId=' + encodeURIComponent(unit.id), { cache: 'no-store' })
      .then(r => r.json()).then(j => setIntel(j || null)).catch(() => setIntel(null))
      .finally(() => setIntelBusy(false))
  }, [unit])

  // The standing instruction for whatever is selected. No unit evidence — see the header.
  const baseFor = useCallback((k: string, id: number | null): string => {
    if (id != null) return String(bzTpls.find(x => x.id === id)?.description || '')
    return PRESETS.find(x => x.key === k)?.base || ''
  }, [bzTpls])

  useEffect(() => {
    if (!descAuto) return
    setDesc(baseFor(tpl, tplId))
  }, [tpl, tplId, descAuto, baseFor])

  const preview = useMemo(() => previewRows(intel), [intel])

  const usePreset = (k: string) => {
    const p = PRESETS.find(x => x.key === k)!
    setTpl(k); setTplId(null); setDept(p.department); setPrio(p.priority)
    // A title the person has already typed is theirs; a preset must not silently rename their task.
    setTitle(t => (!t.trim() || PRESETS.some(x => x.title && x.title === t) ? p.title : t))
    setDescAuto(true)
  }
  const useBzTpl = (t: BzTpl) => {
    setTpl('bz:' + t.id); setTplId(t.id)
    if (t.department) setDept(t.department)
    setTitle(cur => (!cur.trim() || PRESETS.some(x => x.title && x.title === cur) || bzTpls.some(x => x.name === cur) ? t.name : cur))
    setDescAuto(true)
  }

  // TYPING "17WEST 403" MUST FIND "17WEST - 403 - 2BR". Every nickname carries separators, so a
  // raw substring test failed on the most natural query a coordinator types. Normalise both sides
  // to words and require every word typed to appear.
  const hits = useMemo(() => {
    const words = uq.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
    if (!words.length) return []
    const scored = listings
      .filter(l => String(l.status || 'active').trim().toLowerCase() === 'active')
      .map(l => {
        const hay = ((l.nickname || l.title || '') + ' ' + (l.building || '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ')
        if (!words.every(w => hay.includes(w))) return null
        return { l, rank: hay.startsWith(words.join(' ')) ? 0 : hay.indexOf(words[0]) }
      })
      .filter(Boolean) as { l: Listing; rank: number }[]
    return scored.sort((a, b) => a.rank - b.rank).slice(0, 7).map(x => x.l)
  }, [uq, listings])

  // The filter box is always there now. It used to appear only above twelve templates, which is
  // the one case where you can already see them all.
  const bzHits = useMemo(() => {
    const n = tplQ.trim().toLowerCase()
    const pool = bzTpls.filter(t => !n || (t.name + ' ' + t.department).toLowerCase().includes(n))
    return n ? pool.slice(0, 24) : pool.slice(0, 10)
  }, [bzTpls, tplQ])

  const missing = !unit ? 'Pick a unit' : !title.trim() ? 'Give it a title' : ''
  // Say whose row this came from, so a ＋ pressed on a person row is visibly about that person.
  const seededPerson = seedAssignee && picked.length ? roster.find(p => p.id === picked[0])?.name || seedAssignee : ''

  const create = async () => {
    if (!unit || !title.trim() || busy) return
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/ops-today/add-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: unit.id, title: title.trim(), department: dept, priority: prio,
          description: desc, date: date || undefined, assigneeIds: picked, templateId: tplId || undefined,
        }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not create the task')
      onDone()
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(false) }
  }

  const uname = (l: Listing) => l.nickname || l.title || l.id
  const cap = 'text-[10.5px] font-bold uppercase tracking-wider text-muted'
  const fld = 'rounded-xl border border-line px-2.5 py-2 text-[12.5px] bg-white'

  return (
    /* PHONE: a full-screen sheet, not a floating card — the template grid and the roster chips
       fight for width inside a 16px-gutter dialog, and the last control ends up under the home
       indicator. Full-bleed below 640px; the floating dialog is unchanged from sm: up. */
    <div className="fixed inset-0 z-[60] bg-ink/40 backdrop-blur-[1px] flex items-start justify-center p-0 sm:p-4 sm:pt-[5vh] overflow-y-auto" onClick={onScrim}>
      <div {...panelProps} aria-label="Add a task"
        className="bg-white rounded-none sm:rounded-2xl w-full max-w-xl min-h-dvh sm:min-h-0 p-4 pb-28 sm:pb-5 sm:p-5 shadow-2xl outline-none" onClick={e => e.stopPropagation()}>

        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-[16px] font-bold text-ink flex-1">
            Add a task{seededPerson ? <span className="font-semibold text-muted text-[13.5px]"> · for {seededPerson}</span> : null}
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink p-1"><X size={16} /></button>
        </div>

        {/* ── UNIT ──────────────────────────────────────────────────────────────────────────── */}
        <p className={cap + ' mb-1.5'}>Unit</p>
        {!unit ? (
          <div>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input ref={boxRef} value={uq} onChange={e => setUq(e.target.value)} placeholder="Start typing — 17west 403"
                className="w-full rounded-xl border-2 border-line pl-9 pr-3.5 py-2.5 text-[14px] focus:outline-none focus:border-ink" />
            </div>
            {/* SAY WHY THE LIST IS EMPTY. Silence reads as a broken box. */}
            {uq.trim() && !unitsReady && <p className="mt-2 text-[12px] text-muted inline-flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Loading units…</p>}
            {unitsErr && <p className="mt-2 text-[12px] text-rose-700">Could not load the unit list — this is not &ldquo;no match&rdquo;. Try again in a moment.</p>}
            {uq.trim() && unitsReady && !unitsErr && hits.length === 0 && <p className="mt-2 text-[12px] text-muted">No active unit matches &ldquo;{uq.trim()}&rdquo;.</p>}
            {hits.length > 0 && (
              <div className="mt-1.5 rounded-xl border border-line overflow-hidden">
                {hits.map(l => (
                  <button key={l.id} onClick={() => setUnit(l)}
                    className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left text-[13.5px] bg-white hover:bg-app border-b border-line last:border-0">
                    <span className="font-semibold text-ink">{uname(l)}</span>
                    {l.building && <span className="text-[11.5px] text-muted ml-auto">{l.building}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl bg-app px-3.5 py-2.5">
            <span className="text-[14px] font-bold text-ink">{uname(unit)}</span>
            {unit.building && <span className="text-[11.5px] text-muted">{unit.building}</span>}
            {intelBusy && <Loader2 size={12} className="animate-spin text-muted" />}
            <button onClick={() => { setUnit(null); setUq('') }} aria-label="Change unit" className="ml-auto text-muted hover:text-ink"><X size={14} /></button>
          </div>
        )}

        {/* ── TEMPLATE ──────────────────────────────────────────────────────────────────────── */}
        <div className="flex items-baseline gap-2 mt-4 mb-1.5">
          <p className={cap}>Template</p>
          {bzTpls.length > 0 && <span className="text-[10.5px] text-muted">· the crew gets the real checklist</span>}
          {bzTpls.length > 6 && (
            <input value={tplQ} onChange={e => setTplQ(e.target.value)} placeholder="filter…"
              className="ml-auto w-28 rounded-lg border border-line px-2 py-1 text-[11px]" />
          )}
        </div>
        {bzTpls.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {bzHits.map(t => (
              <button key={t.id} onClick={() => useBzTpl(t)}
                className={'px-3 py-2 rounded-xl border-2 text-left max-w-full ' + (tplId === t.id ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-line text-ink hover:border-brand-500/50')}>
                <span className="block text-[12.5px] font-bold leading-tight truncate">{t.name}</span>
                <span className={'block text-[10px] ' + (tplId === t.id ? 'text-white/70' : 'text-muted')}>{t.department || 'Breezeway template'}</span>
              </button>
            ))}
            {tplQ && bzHits.length === 0 && <span className="text-[11.5px] text-muted py-2">No template matches &ldquo;{tplQ}&rdquo;.</span>}
          </div>
        )}
        <p className={cap + ' mt-3 mb-1.5'}>{bzTpls.length > 0 ? 'Or a quick preset' : 'What kind of work'}</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map(t => (
            <button key={t.key} onClick={() => usePreset(t.key)}
              className={'px-3 py-2 rounded-xl border-2 text-left ' + (tpl === t.key ? 'bg-ink border-ink text-white' : 'bg-white border-line text-ink hover:border-ink/30')}>
              <span className="block text-[12.5px] font-bold leading-tight">{t.label}</span>
              <span className={'block text-[10px] ' + (tpl === t.key ? 'text-white/70' : 'text-muted')}>{t.hint}</span>
            </button>
          ))}
        </div>

        {/* ── THE TASK ──────────────────────────────────────────────────────────────────────── */}
        <p className={cap + ' mt-4 mb-1.5'}>The task</p>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing?"
          className="w-full rounded-xl border border-line px-3 py-2.5 text-[13.5px] mb-2" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <select value={dept} onChange={e => setDept(e.target.value)} className={fld} aria-label="Department">
            {DEPTS.map(x => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
          </select>
          <select value={prio} onChange={e => setPrio(e.target.value)} className={fld} aria-label="Priority">
            {PRIOS.map(x => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
          </select>
          {/* Three across is ~90px a column on a phone and a native date picker does not fit, so
              the date takes its own full-width row below 640px. */}
          <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Date"
            className={fld + ' col-span-2 sm:col-span-1'} />
        </div>

        {/* ── THE INSTRUCTION ───────────────────────────────────────────────────────────────── */}
        <div className="flex items-baseline gap-2 mt-3.5 mb-1.5">
          <p className={cap}>What to do</p>
          {!descAuto && (
            <button onClick={() => setDescAuto(true)} className="ml-auto text-[11px] font-semibold text-brand-700 hover:underline">
              Reset to the template
            </button>
          )}
        </div>
        <textarea value={desc} onChange={e => { setDesc(e.target.value); setDescAuto(false) }} rows={4}
          placeholder="The instruction for this job. What the unit has on it is attached automatically."
          className="w-full rounded-xl border border-line px-3 py-2 text-[12.5px] leading-[1.5] text-ink/85" />

        {/* ── WHAT THE UNIT HAS ON IT ───────────────────────────────────────────────────────────
            SHOWN, NOT PASTED. The server attaches the real brief (lib/listingIntel) on create, in
            the crew's language and shaped to their job. Copying it into the box above would mean
            the same complaint reaching the field twice, which is what this whole change removes. */}
        {unit && (
          <div className="mt-3 rounded-xl border border-line bg-app/50 p-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">
              What the crew also gets about {uname(unit)}
            </p>
            {intelBusy ? (
              <p className="text-[12px] text-muted mt-1.5 inline-flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Reading this unit’s history…</p>
            ) : preview.length === 0 ? (
              <p className="text-[12px] text-muted mt-1.5">Nothing outstanding — no low reviews and no open glitches. The task goes out with just the instruction above.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {preview.map((r, i) => (
                  <li key={i} className="text-[12px] leading-snug">
                    <span className={'font-semibold ' + (r.tone === 'alert' ? 'text-rose-700' : 'text-ink')}>{r.label}</span>
                    {r.detail ? <span className="text-muted"> — {r.detail}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10.5px] text-muted mt-2">Attached by the server when you create it, in the crew’s language.</p>
          </div>
        )}

        {/* ── WHO ───────────────────────────────────────────────────────────────────────────── */}
        <p className={cap + ' mt-3.5 mb-1.5'}>Who takes it (optional)</p>
        <div className="flex flex-wrap gap-1.5">
          {roster.filter(p => !p.departments?.length || p.departments.some(x => x.toLowerCase().includes(dept))).slice(0, 12).map(p => (
            <button key={p.id} onClick={() => setPicked(s => s.includes(p.id) ? s.filter(x => x !== p.id) : [...s, p.id])}
              className={'px-3 py-1.5 rounded-full border text-[12.5px] font-semibold ' + (picked.includes(p.id) ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-line text-ink hover:border-ink/30')}>
              {p.name}
            </button>
          ))}
          {!roster.length && <span className="text-[11.5px] text-muted py-1.5">Loading the crew…</span>}
        </div>

        {tplId != null && (
          <p className="text-[11px] text-muted mt-2.5 inline-flex items-start gap-1.5">
            <CalendarDays size={12} className="mt-[2px] shrink-0" />
            Files with the Breezeway template attached — whoever opens it in the field app gets that checklist.
          </p>
        )}
        {err && <p className="text-[12px] text-rose-600 font-semibold mt-2">{err}</p>}

        {/* SAY WHICH PIECE IS MISSING. A grey button with no explanation is the commonest way a
            form wastes somebody's minute. */}
        <button onClick={create} disabled={busy || !!missing}
          className="w-full mt-4 rounded-xl bg-ink text-white py-3 text-[14px] font-bold disabled:opacity-40 inline-flex items-center justify-center gap-2">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
          {busy ? 'Creating…' : missing ? missing : picked.length ? 'Create & assign in Breezeway' : 'Create in Breezeway'}
        </button>
      </div>
    </div>
  )
}

/** The ＋ Task button. Same affordance wherever it appears. */
export function AddTaskButton({ className, label = 'Task' }: { className?: string; label?: string }) {
  return (
    <button type="button" onClick={() => openAddTask()} title="Add a task"
      className={className || 'inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-bold hover:opacity-90'}>
      <Plus size={14} /> {label}
    </button>
  )
}
