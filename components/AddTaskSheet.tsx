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

// ── THE PRESETS ARE THE TEAM'S OWN TASK NAMES (Jon, 2026-09-14) ────────────────────────────────
// "The template for adding a task should be HK audit Inspection, Preventative Maintance one,
// Glitch one, Unit Check, Refresh, in house Pest control, field priority, anual audit, ect."
//
// WHAT WAS HERE BEFORE WAS INVENTED. "Inspection", "Deep clean", "PM check", "Lock batteries",
// "A/C filter" — seven plausible-sounding presets written in this repo by someone who had not
// looked at what the crew actually files. Two of them happened to match a real task name; the
// rest did not exist anywhere in Breezeway, so picking one created a task whose title nothing
// else in the business recognises — not the billing board, not the EOD brief, not the person
// who later searches Breezeway for "how often do we do pest control".
//
// These are the real ones, taken from what the team has actually created (breezeway_tasks_sync,
// deleted rows excluded), with their real departments and ordered by how often they are used:
//
//   Unit Check .............................. 897   inspection
//   Audit HK Checklist ...................... 279   inspection
//   Audit Scoring HK ........................ 217   inspection
//   Preventative Pest Control (In-House) .... 176   maintenance
//   Preventative Maintenance Task ............ 81   maintenance
//   Guest Reported / Glitch .................. 61   maintenance
//   Field Reported Priority .................. 26   maintenance
//   Refresh / Exchange linen / towels ........ 25   housekeeping
//
// ONE SPELLING EACH, DELIBERATELY. Pest control is filed under three different names today
// ("Preventative Pest Control (In-House)", "In house pest control", "In-house Pest Control
// Protocol (Guest Reported)") and refresh under four. Every extra spelling is a row that will not
// group with its siblings when somebody counts the work or bills it, so each preset picks the
// dominant name and sticks to it. Typing a different title by hand still works — this only
// decides what the buttons put there.
//
// The titles also have to survive two pieces of machinery downstream, so they are not free text:
// lib/listingIntel's intelKindFor reads the title to choose which brief the crew gets (every one
// of these lands on the right one), and /api/ops-today/add-task mints an audit link only when the
// title says both "annual" and "audit" — which is why the last one is spelled Annual Quality Audit.
//
// The live Breezeway template list still sits ABOVE these and should be preferred: a template
// carries its real checklist into the field app. These are for work that has no template.
const PRESETS: { key: string; label: string; hint: string; department: string; priority: string; title: string; base: string }[] = [
  { key: 'unitcheck', label: 'Unit Check', hint: 'the standard walk', department: 'inspection', priority: 'high', title: 'Unit Check',
    base: 'Unit check: cleanliness against the photos, damage and wear, amenities present and working, consumables restocked.' },
  { key: 'audithk', label: 'Audit HK Checklist', hint: 'housekeeping audit', department: 'inspection', priority: 'normal', title: 'Audit HK Checklist',
    base: 'Housekeeping audit against the checklist. Photograph anything below standard.' },
  { key: 'auditscore', label: 'Audit Scoring HK', hint: 'scored HK audit', department: 'inspection', priority: 'normal', title: 'Audit Scoring HK',
    base: 'Score the clean against the standard. Log the score and photograph anything that costs a point.' },
  { key: 'pest', label: 'Pest Control', hint: 'in-house, preventative', department: 'maintenance', priority: 'normal', title: 'Preventative Pest Control (In-House)',
    base: 'In-house preventative pest treatment: kitchen, bathrooms, baseboards, balcony and any entry points. Note what was treated and flag an exterminator if there are live signs.' },
  { key: 'pm', label: 'Preventative Maintenance', hint: 'A/C, plumbing, detectors', department: 'maintenance', priority: 'normal', title: 'Preventative Maintenance Task',
    base: 'Preventative maintenance pass: A/C, plumbing under sinks, water heater, smoke and CO detectors, light bulbs, door hardware.' },
  { key: 'glitch', label: 'Guest Reported / Glitch', hint: 'a guest hit a problem', department: 'maintenance', priority: 'high', title: 'Guest Reported / Glitch',
    base: 'A guest reported this. Fix it, then say in the notes what it was and whether the guest was told.' },
  { key: 'fieldpri', label: 'Field Reported Priority', hint: 'the crew found it', department: 'maintenance', priority: 'urgent', title: 'Field Reported Priority',
    base: 'Raised from the field as a priority. Handle it today, or say in the notes what is blocking it.' },
  { key: 'refresh', label: 'Refresh', hint: 'linen, towels, amenities', department: 'housekeeping', priority: 'normal', title: 'Refresh / Exchange linen / towels / amenities',
    base: 'Mid-stay refresh: exchange linen and towels, restock amenities and paper goods, tidy and take the trash. The guest is in residence — leave their belongings where they are.' },
  { key: 'annual', label: 'Annual Quality Audit', hint: 'files the audit link', department: 'inspection', priority: 'normal', title: 'Annual Quality Audit',
    base: 'Annual quality audit: score the unit against the standard checklist, log damage and wear, confirm inventory counts, photograph anything below standard.' },
  { key: 'custom', label: 'Custom', hint: 'type it yourself', department: 'maintenance', priority: 'normal', title: '', base: '' },
]

const DEPTS = ['inspection', 'maintenance', 'housekeeping', 'safety']
// Breezeway's API says "housekeeping"; Jon asked for the picker to read "inspection, maintenance
// or cleaning". The label is what the person reads, the key is what gets sent — so the dropdown
// speaks the team's language without renaming anything downstream.
const DEPT_LABEL: Record<string, string> = {
  inspection: 'Inspection', maintenance: 'Maintenance', housekeeping: 'Cleaning', safety: 'Safety',
}
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
  const [title, setTitle] = useState('')
  // INSPECTION FIRST. Unit Check alone is 897 of the tasks the team files; the three inspection
  // types together outnumber every maintenance type combined. The picker opens on the answer most
  // people want.
  const [dept, setDept] = useState('inspection')
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

  // ── ONE DROPDOWN, GROUPED, FILTERED BY TYPE (Jon, 2026-09-14: "have the template in drop down
  // like they are in Breezeway based on the type, inspection, maintenance or cleaning") ──────────
  // The picker was two walls of chips — up to ten live Breezeway templates and ten of our own —
  // and neither told you which department it belonged to until you read the small print under the
  // name. Breezeway asks the question in the right order: what KIND of work is this, then which
  // template. Type first, and the list below it only contains things that can be that type.
  //
  // One control for both sources, because from where you are standing they are the same decision.
  // The value carries which list it came from: `bz:<id>` for a live Breezeway template (its real
  // checklist travels with the task), `p:<key>` for one of ours.
  const onPickTemplate = (value: string) => {
    if (!value) { setTpl('custom'); setTplId(null); setDescAuto(true); return }
    if (value.startsWith('bz:')) {
      const t = bzTpls.find(x => String(x.id) === value.slice(3))
      if (t) useBzTpl(t)
      return
    }
    usePreset(value.slice(2))
  }

  // Changing the type drops a template that cannot live there — leaving "Audit HK Checklist"
  // selected under Maintenance would send a task whose title and department disagree, and the
  // brief the crew gets is chosen from the title.
  const onPickDept = (d: string) => {
    setDept(d)
    const keepBz = tplId != null && bzTpls.some(t => t.id === tplId && (!t.department || t.department === d))
    const keepPreset = tplId == null && PRESETS.some(x => x.key === tpl && x.department === d)
    if (keepBz || keepPreset) return
    setTpl('custom'); setTplId(null); setDescAuto(true)
    // AND THE TITLE IT PUT THERE. Dropping the template but leaving "Departure Clean Checklist"
    // in the title box under a type of Inspection is worse than either: lib/listingIntel picks
    // which brief the crew gets by reading the TITLE, so the task would have gone out calling
    // itself a clean and briefing the cleaner. Only a title we wrote is cleared; anything the
    // person typed is theirs.
    setTitle(cur => (PRESETS.some(x => x.title && x.title === cur) || bzTpls.some(x => x.name === cur) ? '' : cur))
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

  // What each list offers for the type currently chosen. A Breezeway template with no department
  // on it is shown under every type rather than hidden: an unclassified template is a gap in
  // Breezeway's own data, and silently dropping it would make a template somebody relies on look
  // like it had been deleted.
  const bzForDept = useMemo(
    () => bzTpls.filter(t => !t.department || t.department === dept),
    [bzTpls, dept])
  // A PRESET THAT DUPLICATES A LIVE TEMPLATE IS NOISE. Our presets were named after the tasks the
  // team actually files, so several of them match a real Breezeway template by title — and the
  // template is strictly better, because it carries its checklist into the field app. Showing both
  // offers the same words twice and lets somebody pick the weaker one by accident.
  const presetsForDept = useMemo(() => {
    const live = new Set(bzTpls.map(t => t.name.trim().toLowerCase()))
    return PRESETS.filter(t => t.key !== 'custom' && t.department === dept && !live.has(t.title.trim().toLowerCase()))
  }, [dept, bzTpls])
  const pickValue = tplId != null ? 'bz:' + tplId : (tpl && tpl !== 'custom' ? 'p:' + tpl : '')

  // ── THE CREW, IN TWO GROUPS, NOBODY HIDDEN (Jon, 2026-09-14: "in the task should have a drop
  // down of assignee") ──────────────────────────────────────────────────────────────────────────
  // This was a chip row that FILTERED the roster to the chosen type and then cut it at twelve. Two
  // quiet failures came out of that: a person who could genuinely take the job — the supervisor who
  // also inspects, the maintenance tech covering a clean — simply was not on the screen, and once
  // the crew grew past twelve, whoever sorted last stopped existing. Neither said anything; the
  // person just was not there, which reads as "they are not on today" rather than "this list is
  // short".
  //
  // A dropdown holds everybody. The type still does its job, as ORDER rather than a filter: people
  // whose departments include it come first under a heading that names it, everyone else sits under
  // "Everyone else" below. Assigning across departments is now one scroll instead of impossible.
  const rosterGroups = useMemo(() => {
    const inDept = roster.filter(p => p.departments?.some(x => x.toLowerCase().includes(dept)))
    const ids = new Set(inDept.map(p => p.id))
    const rest = roster.filter(p => !ids.has(p.id))
    const byName = (a: Roster, b: Roster) => a.name.localeCompare(b.name)
    return { inDept: inDept.slice().sort(byName), rest: rest.slice().sort(byName) }
  }, [roster, dept])
  const pickedPeople = useMemo(
    () => picked.map(id => roster.find(p => p.id === id)).filter(Boolean) as Roster[],
    [picked, roster])

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

        {/* ── TYPE, THEN TEMPLATE — the order Breezeway asks in ──────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-2 mt-4">
          <label className="flex flex-col gap-1">
            <span className={cap}>Type</span>
            <select value={dept} onChange={e => onPickDept(e.target.value)} className={fld}>
              {DEPTS.map(x => <option key={x} value={x}>{DEPT_LABEL[x] || x}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className={cap}>Template</span>
            <select value={pickValue} onChange={e => onPickTemplate(e.target.value)} className={fld}>
              <option value="">No template — type it yourself</option>
              {bzForDept.length > 0 && (
                <optgroup label="Breezeway templates — the crew gets the real checklist">
                  {bzForDept.map(t => <option key={t.id} value={'bz:' + t.id}>{t.name}</option>)}
                </optgroup>
              )}
              {presetsForDept.length > 0 && (
                <optgroup label="Our task types">
                  {presetsForDept.map(t => <option key={t.key} value={'p:' + t.key}>{t.title || t.label}</option>)}
                </optgroup>
              )}
            </select>
          </label>
        </div>
        {/* Say what picking it did. A Breezeway template carries its checklist into the field app;
            one of ours only fills the title and the standing instruction, and the difference
            decides whether the crew gets a list to tick. */}
        {tplId != null ? (
          <p className="text-[11px] text-muted mt-1.5">This template’s checklist travels with the task into the field app.</p>
        ) : bzForDept.length === 0 && bzTpls.length > 0 ? (
          <p className="text-[11px] text-muted mt-1.5">No Breezeway template is filed under {DEPT_LABEL[dept] || dept}.</p>
        ) : null}

        {/* ── THE TASK ──────────────────────────────────────────────────────────────────────── */}
        <p className={cap + ' mt-4 mb-1.5'}>The task</p>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing?"
          className="w-full rounded-xl border border-line px-3 py-2.5 text-[13.5px] mb-2" />
        {/* Department moved up to Type, where it now drives the template list. */}
        <div className="grid grid-cols-2 gap-2">
          <select value={prio} onChange={e => setPrio(e.target.value)} className={fld} aria-label="Priority">
            {PRIOS.map(x => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
          </select>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Date" className={fld} />
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
        {/* The dropdown ADDS rather than replaces, and resets itself to the prompt — a task can
            need two people (a turn with a helper, a tech and a supervisor), and the assign call
            has always taken a list. Whoever is on it shows as a chip you can take off again. */}
        <select value="" disabled={!roster.length}
          onChange={e => { const id = Number(e.target.value); if (Number.isFinite(id) && id > 0) setPicked(s => s.includes(id) ? s : [...s, id]) }}
          className={fld + ' w-full disabled:opacity-60'} aria-label="Assign to">
          <option value="">{!roster.length ? 'Loading the crew…' : picked.length ? 'Add another person…' : 'Unassigned — pick someone'}</option>
          {rosterGroups.inDept.length > 0 && (
            <optgroup label={(DEPT_LABEL[dept] || dept) + ' crew'}>
              {rosterGroups.inDept.map(p => <option key={p.id} value={p.id} disabled={picked.includes(p.id)}>{p.name}{picked.includes(p.id) ? ' — already on it' : ''}</option>)}
            </optgroup>
          )}
          {rosterGroups.rest.length > 0 && (
            <optgroup label="Everyone else">
              {rosterGroups.rest.map(p => <option key={p.id} value={p.id} disabled={picked.includes(p.id)}>{p.name}{picked.includes(p.id) ? ' — already on it' : ''}</option>)}
            </optgroup>
          )}
        </select>
        {pickedPeople.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {pickedPeople.map(p => (
              <span key={p.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand-600 text-white text-[12.5px] font-semibold">
                {p.name}
                <button type="button" aria-label={'Take ' + p.name + ' off this task'}
                  onClick={() => setPicked(s => s.filter(x => x !== p.id))} className="opacity-80 hover:opacity-100">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

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
