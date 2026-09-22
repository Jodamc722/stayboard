'use client'
// Owner Reports desk: list of generated reports + the New-report flow
// (pick buildings, period, as-of → generate → open the share page).
import { useEffect, useRef, useState } from 'react'
import { Loader2, Plus, Trash2, ExternalLink, Sparkles, Paperclip, Image as ImageIcon, X } from 'lucide-react'
import { LeanHead, Pill, Tag, LeanTabs, LeanList, LeanRow, LeanEmpty, IconBtn, Tip } from '@/components/lean'

type StatementPick = {
  id: string; ownerId: string; ownerName: string; month: string; label: string
  periodStart: string; periodEnd: string; dueToOwner: number
  net: number | null; paid: number | null
}

type ReportRow = {
  id: string; code: string; title: string; scope_label: string | null
  period_start: string; period_end: string; as_of: string; theme: string; status: string
  created_at: string; updated_at: string
}

// Figures on statement rows are exact dollars from the recognised ledger; round for display
// only, never for anything that is sent to the generator.
const usd0 = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

// How the statement picker fills itself in. Jon's ask, verbatim: "I should be able to select
// one owner statement for review. I should be able to select all of them if I want to."
//   period — statements whose month sits inside the report window (the old default)
//   one    — exactly one statement, review-a-single-owner-month
//   all    — every synced statement in scope, bulk
// Rows stay clickable in every mode, so hand-picking still works; the counter is always the
// truth about what will be pulled.
type StmtMode = 'period' | 'one' | 'all'

const STMT_MODES: Array<{ id: StmtMode; label: string; hint: string }> = [
  { id: 'one', label: 'One statement', hint: 'Review a single owner statement in detail.' },
  { id: 'period', label: 'In this period', hint: 'Statements whose month falls inside the report window.' },
  { id: 'all', label: 'All statements', hint: 'Every synced statement for these owners — the full history.' },
]

/** Which statement ids a mode selects. Never picks an unsynced month: the generator refuses those. */
function idsForMode(mode: StmtMode, list: StatementPick[], from: string, to: string): string[] {
  const synced = list.filter(s => s.net != null)
  if (mode === 'all') return synced.map(s => s.id)
  const inWindow = synced.filter(s => s.month >= from && s.month <= to)
  if (mode === 'one') {
    // Newest statement inside the window, falling back to the newest synced one overall so
    // "one statement" never lands on an empty selection.
    const pool = inWindow.length ? inWindow : synced
    const best = pool.slice().sort((a, b) => b.month.localeCompare(a.month))[0]
    return best ? [best.id] : []
  }
  return inWindow.map(s => s.id)
}

function monthDefaults(): { start: string; end: string } {
  const now = new Date()
  const y = now.getFullYear(); const m = now.getMonth()
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
  const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)
  return { start, end }
}

export function ReportsDesk() {
  const [reports, setReports] = useState<ReportRow[]>([])
  const [buildings, setBuildings] = useState<string[]>([])
  const [picked, setPicked] = useState<string[]>([])
  // SCOPE BY OWNER, NOT BUILDING (Jon, 2026-09-16: "owner reports need to be by owner, not
  // building"). An owner can hold units across several buildings, or a handful inside one — so
  // a building-scoped report showed them their neighbours' numbers next to their own, and titled
  // the cover after a building instead of after them. Owner is now the default; building stays
  // for the cases where the report really is about a whole property.
  // Three ways to say who a document is about. UNIT matters most for onboarding (Jon,
  // 2026-09-16: "also have create by unit, multiple select") — a new owner usually arrives with
  // one unit, not a building and not a portfolio, and picking their building would put their
  // neighbours' units in their welcome deck.
  const [scopeMode, setScopeMode] = useState<'owner' | 'building' | 'unit'>('owner')
  const [units, setUnits] = useState<{ id: string; name: string; building: string }[]>([])
  const [pickedUnits, setPickedUnits] = useState<string[]>([])
  const [unitQ, setUnitQ] = useState('')
  const [owners, setOwners] = useState<{ id: string; name: string; units: number; listingIds: string[] }[]>([])
  const [pickedOwners, setPickedOwners] = useState<string[]>([])
  const [ownerQ, setOwnerQ] = useState('')
  const defaults = monthDefaults()
  // 'review' = the full performance review; 'projection' = the next-season projection report
  // built from Money → Projections (Jon, 2026-08-22). Projection needs no period — the season
  // IS the period — and skips the AI pass, so it generates in a few seconds.
  // 'onboarding' = the welcome presentation for a NEW owner (Jon, 2026-09-16). Also periodless —
  // the unit has no history yet, which is why we are having the call.
  const [kind, setKind] = useState<'review' | 'projection' | 'onboarding'>('review')
  const [ownerName, setOwnerName] = useState('')
  const [goLive, setGoLive] = useState('')
  // The list below mixes three document types once you have a few of each; this filters it.
  const [listKind, setListKind] = useState<'all' | 'review' | 'projection' | 'onboarding'>('all')
  const [periodStart, setPeriodStart] = useState(defaults.start)
  const [periodEnd, setPeriodEnd] = useState(defaults.end)
  const [showNew, setShowNew] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const [pacing, setPacing] = useState<{ name: string; url: string } | null>(null)
  const [heroImg, setHeroImg] = useState<{ name: string; url: string } | null>(null)
  const [uploading, setUploading] = useState<string>('')
  // Real Guesty owner statements for the picked properties. Statements are SELECTED, never
  // uploaded — the figures come from the recognised owner-ledger mirror.
  const [stmtList, setStmtList] = useState<StatementPick[]>([])
  const [stmtPicked, setStmtPicked] = useState<string[]>([])
  const [stmtLoading, setStmtLoading] = useState(false)
  const [stmtMode, setStmtMode] = useState<StmtMode>('period')
  // The fetch effect must read the CURRENT mode without re-running when the mode changes —
  // switching between one and all is a pure re-pick over the list already in hand, and
  // refetching would re-aggregate the whole ledger for nothing.
  const stmtModeRef = useRef<StmtMode>('period')
  const pacingRef = useRef<HTMLInputElement>(null)
  const heroRef = useRef<HTMLInputElement>(null)

  async function uploadOne(file: File): Promise<{ name: string; url: string } | null> {
    const fd = new FormData()
    fd.append('file', file)
    try {
      const r = await fetch('/api/guidebook/upload', { method: 'POST', body: fd })
      const d = await r.json()
      if (d?.ok && d?.url) return { name: file.name, url: d.url }
      setMsg(d?.error || 'Upload failed')
    } catch { setMsg('Upload failed') }
    return null
  }
  async function onPacingPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    setUploading('pacing')
    const up = await uploadOne(f)
    if (up) setPacing(up)
    setUploading('')
    e.target.value = ''
  }
  // In one-statement mode a row click REPLACES the selection, so the list behaves like radio
  // buttons and you can never accidentally end up reviewing two owner-months as if they were one.
  function toggleStatement(id: string) {
    if (stmtMode === 'one') { setStmtPicked([id]); return }
    setStmtPicked(prev => prev.indexOf(id) >= 0 ? prev.filter(x => x !== id) : [...prev, id])
  }
  function pickMode(m: StmtMode) {
    stmtModeRef.current = m
    setStmtMode(m)
    setStmtPicked(idsForMode(m, stmtList, periodStart.slice(0, 7), periodEnd.slice(0, 7)))
  }
  async function onHeroPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    setUploading('hero')
    const up = await uploadOne(f)
    if (up) setHeroImg(up)
    setUploading('')
    e.target.value = ''
  }

  function loadReports() {
    fetch('/api/reports').then(r => r.json()).then(d => {
      if (Array.isArray(d?.reports)) setReports(d.reports)
      setLoading(false)
    }).catch(() => setLoading(false))
  }
  useEffect(() => {
    loadReports()
    fetch('/api/reports/budgets?buildings=1').then(r => r.json()).then(d => {
      if (Array.isArray(d?.buildings)) setBuildings(d.buildings)
    }).catch(() => {})
    fetch('/api/reports/budgets?owners=1').then(r => r.json()).then(d => {
      if (Array.isArray(d?.owners)) setOwners(d.owners)
    }).catch(() => {})
    fetch('/api/listings?slim=1').then(r => r.json()).then(d => {
      const rows: any[] = Array.isArray(d?.results) ? d.results : []
      setUnits(rows
        .filter(l => ['inactive', 'disabled', 'archived', 'deleted'].indexOf(String(l.status || '').toLowerCase()) < 0)
        .map(l => ({ id: String(l.id), name: String(l.nickname || l.title || l.id), building: String(l.building || '') }))
        .sort((a, b) => a.name.localeCompare(b.name)))
    }).catch(() => {})
  }, [])

  // Statements follow the property selection. Anything whose period sits inside the report
  // window is preselected, since that is nearly always what the report is about. Statements
  // whose month hasn't been swept into the ledger mirror can't be picked — the generator
  // refuses them rather than report a silently empty ledger.
  // One scope, whichever way it was picked. Everything downstream — statements, the generator —
  // already speaks listingIds, so owner mode just resolves to the union of their live units.
  const ownerRows = owners.filter(o => pickedOwners.indexOf(o.id) >= 0)
  const ownerListingIds = Array.from(new Set(ownerRows.flatMap(o => o.listingIds)))
  const ownerLabel = ownerRows.map(o => o.name).join(' + ')
  // PICKING AN OWNER SELECTS THEIR PROPERTIES (Jon, 2026-09-16: "when I pick my owner, it should
  // select their properties"). Their units come on as a set you can see and then trim — an owner
  // with eight units often wants a document about three of them.
  const ownerKey = pickedOwners.join(',')
  useEffect(() => {
    if (scopeMode !== 'owner') return
    const ids = Array.from(new Set(owners.filter(o => pickedOwners.indexOf(o.id) >= 0).flatMap(o => o.listingIds)))
    setPickedUnits(ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey, scopeMode, owners.length])

  const unitRows = units.filter(u => pickedUnits.indexOf(u.id) >= 0)
  // Two units read better as their names; a dozen read better as a count.
  const unitLabel = unitRows.length <= 2
    ? unitRows.map(u => u.name).join(' + ')
    : unitRows.length + ' units'
  const scopeIds = scopeMode === 'owner'
    ? (pickedUnits.length ? pickedUnits : ownerListingIds)
    : scopeMode === 'unit' ? pickedUnits : []
  const scopeLabel = scopeMode === 'owner' ? ownerLabel : scopeMode === 'unit' ? unitLabel : ''
  const byIds = scopeMode === 'owner' || scopeMode === 'unit'
  const scopeReady = byIds ? scopeIds.length > 0 : picked.length > 0
  const pickedKey = byIds ? scopeIds.join(',') : picked.join(',')
  useEffect(() => {
    if (!pickedKey) { setStmtList([]); setStmtPicked([]); return }
    let cancelled = false
    setStmtLoading(true)
    fetch('/api/reports/statements?' + (byIds ? 'listingIds=' : 'buildings=') + encodeURIComponent(pickedKey))
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        const list: StatementPick[] = Array.isArray(d?.statements) ? d.statements : []
        setStmtList(list)
        const from = periodStart.slice(0, 7)
        const to = periodEnd.slice(0, 7)
        let mode = stmtModeRef.current
        let ids = idsForMode(mode, list, from, to)
        // The period defaults to the month we are IN, and a statement for the current month
        // does not exist yet — so "in this period" would open on an empty selection and look
        // broken. Drop to the most recent statement instead, and say so by moving the mode.
        if (!ids.length && mode === 'period' && list.some(s => s.net != null)) {
          mode = 'one'
          ids = idsForMode(mode, list, from, to)
          stmtModeRef.current = mode
          setStmtMode(mode)
        }
        setStmtPicked(ids)
      })
      .catch(() => { if (!cancelled) { setStmtList([]); setStmtPicked([]) } })
      .then(() => { if (!cancelled) setStmtLoading(false) })
    return () => { cancelled = true }
  }, [pickedKey, periodStart, periodEnd])

  function toggleBuilding(b: string) {
    setPicked(prev => prev.indexOf(b) >= 0 ? prev.filter(x => x !== b) : [...prev, b])
  }

  async function generate() {
    if (!scopeReady) {
      setMsg(scopeMode === 'owner' ? 'Pick an owner.' : scopeMode === 'unit' ? 'Pick at least one unit.' : 'Pick at least one property.')
      return
    }
    setGenerating(true)
    setMsg(kind === 'projection' ? 'Building the projection report… (~5s)'
      : kind === 'onboarding' ? 'Building the onboarding presentation… (~10s)'
      : 'Pulling data + writing the report… (~30s)')
    try {
      const r = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          ...(byIds
            ? { listingIds: scopeIds, scopeLabel }
            : { buildings: picked }),
          periodStart, periodEnd,
          ownerName: ownerName || undefined,
          goLive: goLive || undefined,
          pacingUrl: pacing ? pacing.url : undefined,
          statementIds: stmtPicked.length ? stmtPicked : undefined,
          heroImageUrl: heroImg ? heroImg.url : undefined,
        }),
      })
      const d = await r.json()
      if (d?.ok && d?.code) {
        window.location.href = '/r/' + d.code
        return
      }
      setMsg(d?.error || 'Generate failed')
    } catch { setMsg('Generate failed') }
    setGenerating(false)
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this report? The share link will stop working.')) return
    await fetch('/api/reports?id=' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {})
    loadReports()
  }

  // Which kind a stored row is. The kind lives in the title at generation ("… — Owner Onboarding
  // — Sep 16, 2026"), so rows generated before onboarding existed still classify correctly.
  const kindOfRow = (r: ReportRow): 'review' | 'projection' | 'onboarding' =>
    /onboarding/i.test(String(r.title || '')) ? 'onboarding'
      : /projection/i.test(String(r.title || '')) ? 'projection' : 'review'
  const shownReports = listKind === 'all' ? reports : reports.filter(r => kindOfRow(r) === listKind)

  const nKind = (k: 'review' | 'projection' | 'onboarding') => reports.filter(r => kindOfRow(r) === k).length
  const KIND_TAG: Record<'review' | 'projection' | 'onboarding', { l: string; t: 'brand' | 'violet' | 'emerald' }> = {
    review: { l: 'Review', t: 'brand' }, projection: { l: 'Projection', t: 'violet' }, onboarding: { l: 'Onboarding', t: 'emerald' },
  }
  // Hover text for the three document types — the explainer paragraphs that used to sit under the toggle.
  const KIND_HELP: Record<'review' | 'projection' | 'onboarding', string> = {
    review: 'Performance review for a period: revenue, occupancy, reviews and completed work pulled automatically.',
    projection: 'Next season’s net owner revenue per unit, with property health and ADR-upside recommendations. Edit any wording in place after generating.',
    onboarding: 'The kickoff call as a document: listing reviewed on every channel, strategy, ramp, team, billables and a worked statement. Answers save live on the call; the boilerplate is the house template.',
  }

  return (
    <div className="space-y-4">
      <LeanHead title="Owner Reports">
        <Pill title="Owner documents generated so far">{reports.length} report{reports.length === 1 ? '' : 's'}</Pill>
        {!showNew && (
          <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white text-[12.5px] font-semibold px-3 py-1.5 hover:bg-brand-700">
            <Plus size={14} /> New report
          </button>
        )}
      </LeanHead>
      {/* New report — only on screen while it is being built */}
      {showNew && (
      <section className="rounded-2xl border border-line bg-white p-4">
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[13.5px] font-bold text-ink flex items-center gap-1.5 mr-1"><Sparkles size={14} className="text-brand-600" /> New report</h2>
              <div className="flex items-center rounded-lg border border-line bg-neutral-50 overflow-hidden w-fit">
                <button onClick={() => setKind('review')} title={KIND_HELP.review}
                  className={'px-3 py-1 text-[12px] font-semibold ' + (kind === 'review' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                  Owner review
                </button>
                <button onClick={() => setKind('projection')} title={KIND_HELP.projection}
                  className={'px-3 py-1 text-[12px] font-semibold ' + (kind === 'projection' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                  Season projection
                </button>
                <button onClick={() => setKind('onboarding')} title={KIND_HELP.onboarding}
                  className={'px-3 py-1 text-[12px] font-semibold ' + (kind === 'onboarding' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                  Owner onboarding
                </button>
              </div>
              {/* THE PROJECTION BUILDER LIVES HERE (Jon, 2026-08-25): projections are built for an
                  owner from this toggle; the model editor is one link off it (own page, API, gate). */}
              {kind === 'projection' && (
                <a href="/projections"
                  className="inline-flex items-center gap-1.5 text-[12px] font-bold px-2.5 py-1 rounded-lg border border-line bg-white hover:border-ink/30 text-ink"
                  title="Every month, unit and lever behind these numbers — occupancy, ADR, length of stay, management and building splits">
                  Adjust the model &rarr;
                </a>
              )}
              <span className="ml-auto"><IconBtn title="Close without generating" onClick={() => { setShowNew(false); setMsg('') }}><X size={14} /></IconBtn></span>
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <p className="text-[11px] uppercase tracking-wider text-muted font-semibold">For</p>
                <span className="inline-flex items-center rounded-lg border border-line bg-neutral-50 overflow-hidden">
                  <button onClick={() => setScopeMode('owner')}
                    className={'px-3 py-1 text-[12px] font-semibold ' + (scopeMode === 'owner' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                    An owner
                  </button>
                  <button onClick={() => setScopeMode('unit')}
                    className={'px-3 py-1 text-[12px] font-semibold ' + (scopeMode === 'unit' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                    Specific units
                  </button>
                  <button onClick={() => setScopeMode('building')}
                    className={'px-3 py-1 text-[12px] font-semibold ' + (scopeMode === 'building' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                    A building
                  </button>
                </span>
              </div>

              {scopeMode === 'owner' ? (
                <div>
                  <input
                    value={ownerQ} onChange={e => setOwnerQ(e.target.value)}
                    placeholder={owners.length ? 'Search ' + owners.length + ' owners…' : 'Loading owners…'}
                    className="mb-2 w-full max-w-sm rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink"
                  />
                  <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto">
                    {owners
                      .filter(o => !ownerQ.trim() || o.name.toLowerCase().indexOf(ownerQ.trim().toLowerCase()) >= 0)
                      .slice(0, 80)
                      .map(o => {
                        const on = pickedOwners.indexOf(o.id) >= 0
                        return (
                          <button key={o.id}
                            onClick={() => setPickedOwners(p => on ? p.filter(x => x !== o.id) : [...p, o.id])}
                            className={'rounded-full px-3 py-1.5 text-[12.5px] font-semibold border transition-colors ' + (on ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-ink border-line hover:border-brand-300')}>
                            {o.name} <span className={on ? 'opacity-70' : 'text-muted'}>· {o.units}</span>
                          </button>
                        )
                      })}
                    {!owners.length && <span className="text-sm text-muted italic">Loading owners…</span>}
                  </div>
                  {ownerRows.length > 0 && (
                    <div className="mt-3 rounded-xl border border-line bg-app/40 p-3">
                      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                        <p className="text-[11px] uppercase tracking-wider text-muted font-semibold">
                          Their properties · {scopeIds.length} of {ownerListingIds.length} selected
                        </p>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setPickedUnits(ownerListingIds)} className="text-[12px] font-semibold text-muted hover:text-ink">Select all</button>
                          <button onClick={() => setPickedUnits([])} className="text-[12px] font-semibold text-muted hover:text-ink">Clear</button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto">
                        {ownerListingIds.map(id => {
                          const u = units.find(x => x.id === id)
                          const on = pickedUnits.indexOf(id) >= 0
                          return (
                            <button key={id}
                              onClick={() => setPickedUnits(p => on ? p.filter(x => x !== id) : [...p, id])}
                              className={'rounded-full px-3 py-1.5 text-[12.5px] font-semibold border transition-colors ' + (on ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-muted border-line hover:border-brand-300')}>
                              {u ? u.name : id}
                            </button>
                          )
                        })}
                      </div>
                      <p className="mt-2 text-[12px] text-muted" title="The document is titled for them and covers the units ticked above">
                        For <b className="text-ink">{ownerLabel}</b>
                      </p>
                    </div>
                  )}
                </div>
              ) : scopeMode === 'unit' ? (
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <input
                      value={unitQ} onChange={e => setUnitQ(e.target.value)}
                      placeholder={units.length ? 'Search ' + units.length + ' units…' : 'Loading units…'}
                      className="w-full max-w-sm rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink"
                    />
                    {pickedUnits.length > 0 && (
                      <button onClick={() => setPickedUnits([])} className="text-[12px] font-semibold text-muted hover:text-ink">Clear {pickedUnits.length}</button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto">
                    {units
                      .filter(u => {
                        const q = unitQ.trim().toLowerCase()
                        return !q || u.name.toLowerCase().indexOf(q) >= 0 || u.building.toLowerCase().indexOf(q) >= 0
                      })
                      .slice(0, 120)
                      .map(u => {
                        const on = pickedUnits.indexOf(u.id) >= 0
                        return (
                          <button key={u.id}
                            onClick={() => setPickedUnits(p => on ? p.filter(x => x !== u.id) : [...p, u.id])}
                            className={'rounded-full px-3 py-1.5 text-[12.5px] font-semibold border transition-colors ' + (on ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-ink border-line hover:border-brand-300')}>
                            {u.name}
                          </button>
                        )
                      })}
                    {!units.length && <span className="text-sm text-muted italic">Loading units…</span>}
                  </div>
                  {unitRows.length > 0 && (
                    <p className="mt-2 text-[12px] text-muted" title="The document covers these units and nothing else">
                      For <b className="text-ink">{unitLabel}</b>
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {buildings.map(b => {
                    const on = picked.indexOf(b) >= 0
                    return (
                      <button key={b} onClick={() => toggleBuilding(b)}
                        className={'rounded-full px-3 py-1.5 text-[12.5px] font-semibold border transition-colors ' + (on ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-ink border-line hover:border-brand-300')}>
                        {b}
                      </button>
                    )
                  })}
                  {!buildings.length && <span className="text-sm text-muted italic">Loading properties…</span>}
                </div>
              )}
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              {kind === 'review' ? (
                <>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Period start</span>
                    <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Period end</span>
                    <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
                  </label>
                </>
              ) : kind === 'onboarding' ? (
                <>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Owner name</span>
                    <input value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Optional"
                      className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Target go-live</span>
                    <input value={goLive} onChange={e => setGoLive(e.target.value)} placeholder="e.g. Nov 1"
                      className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
                  </label>
                </>
              ) : (
                <span className="pb-2"><Tag title="The season comes straight from the projection model">Next high season · Nov–Apr</Tag></span>
              )}
              <button onClick={generate} disabled={generating || !scopeReady}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 text-white text-sm font-semibold px-5 py-2 hover:bg-brand-700 disabled:opacity-50">
                {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {kind === 'projection' ? 'Generate projection report' : kind === 'onboarding' ? 'Generate onboarding' : 'Generate report'}
              </button>
            </div>
            {picked.length > 0 && (
              <div>
                <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                  <p className="text-[11px] uppercase tracking-wider text-muted font-semibold">
                    Owner statements {stmtLoading && <Loader2 size={11} className="inline animate-spin ml-1" />}
                  </p>
                  {stmtList.length > 0 && (
                    <div className="flex items-center gap-3 text-[11.5px]">
                      <span className="text-muted">{stmtPicked.length} of {stmtList.length} selected</span>
                      <button onClick={() => setStmtPicked([])} className="font-semibold text-muted hover:underline">Clear</button>
                    </div>
                  )}
                </div>
                {stmtList.length > 0 && (
                  <div className="mb-2">
                    <div className="inline-flex rounded-xl border border-line bg-white p-0.5">
                      {STMT_MODES.map(m => (
                        <button key={m.id} onClick={() => pickMode(m.id)} title={m.hint}
                          className={'rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ' + (stmtMode === m.id ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink')}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {!stmtLoading && !stmtList.length ? (
                  <p className="text-[12px] text-muted italic">No Guesty owner statements found for these properties.</p>
                ) : (
                  <div className="rounded-xl border border-line divide-y divide-line max-h-64 overflow-y-auto">
                    {stmtList.map(s => {
                      const on = stmtPicked.indexOf(s.id) >= 0
                      const synced = s.net != null
                      return (
                        <button key={s.id} onClick={() => synced && toggleStatement(s.id)} disabled={!synced}
                          className={'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ' + (synced ? 'hover:bg-app/60 ' : 'opacity-55 cursor-not-allowed ') + (on ? 'bg-brand-50' : 'bg-white')}>
                          {stmtMode === 'one' ? (
                            <span className={'shrink-0 h-4 w-4 rounded-full border-2 flex items-center justify-center ' + (on ? 'border-brand-600' : 'border-line')}>
                              <span className={'h-2 w-2 rounded-full ' + (on ? 'bg-brand-600' : 'bg-transparent')} />
                            </span>
                          ) : (
                            <span className={'shrink-0 h-4 w-4 rounded border flex items-center justify-center text-[10px] font-bold ' + (on ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-line text-transparent')}>&#10003;</span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-semibold text-ink truncate">{s.label}</span>
                            <span className="block text-[11px] text-muted">
                              {synced
                                ? <>Net {usd0(s.net as number)} &middot; Paid {usd0(s.paid || 0)} &middot; Due to owner {usd0(s.dueToOwner)}</>
                                : <>Not synced &mdash; run the owner-statement sync for {s.month}</>}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Tag tone={stmtPicked.length ? 'brand' : 'amber'}
                    title={'Figures come straight from the recognised Guesty owner ledger — net is what the owner earned, paid is what actually settled. '
                      + (stmtPicked.length === 1 ? 'One statement: the report gets a single-owner statement section for that month.'
                        : stmtPicked.length > 1 ? 'Several statements: the report rolls them up by month, with a per-owner breakdown.'
                          : 'Nothing selected: the report is generated without an Owner Statement section.')}>
                    {stmtPicked.length === 1 ? 'Single-statement section' : stmtPicked.length > 1 ? 'Rolled up by month' : 'No statement section'}
                  </Tag>
                </div>
              </div>
            )}
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2" title="Performance vs Plan appears automatically when the property has a stored budget. A PriceLabs pacing PDF adds Pacing vs Market; a hero photo becomes the cover.">Optional attachments</p>
              <div className="flex flex-wrap items-center gap-2">
                <input ref={pacingRef} type="file" accept="application/pdf" className="hidden" onChange={onPacingPick} />
                <input ref={heroRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onHeroPick} />
                <button onClick={() => pacingRef.current && pacingRef.current.click()} disabled={!!uploading}
                  title="Adds a Pacing vs Market section" className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink hover:border-brand-300 disabled:opacity-50">
                  {uploading === 'pacing' ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />} PriceLabs pacing PDF
                </button>
                <button onClick={() => heroRef.current && heroRef.current.click()} disabled={!!uploading}
                  title="Used on the cover" className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink hover:border-brand-300 disabled:opacity-50">
                  {uploading === 'hero' ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />} Hero photo
                </button>
              </div>
              {(pacing || heroImg) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {pacing && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 px-2.5 py-1 text-[11.5px] font-semibold">
                      Pacing: {pacing.name}
                      <Tip label="Remove the pacing PDF"><button onClick={() => setPacing(null)} aria-label="Remove the pacing PDF" className="hover:text-red-600"><X size={11} /></button></Tip>
                    </span>
                  )}
                  {heroImg && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 px-2.5 py-1 text-[11.5px] font-semibold">
                      Hero: {heroImg.name}
                      <Tip label="Remove the hero photo"><button onClick={() => setHeroImg(null)} aria-label="Remove the hero photo" className="hover:text-red-600"><X size={11} /></button></Tip>
                    </span>
                  )}
                </div>
              )}
            </div>
            {msg && <p className="text-[13px] text-amber-700">{msg}</p>}
          </div>
      </section>
      )}

      {/* List — one row per document, filtered by kind */}
      <LeanTabs
        tabs={[
          { key: 'all' as const, label: 'All', n: reports.length },
          { key: 'review' as const, label: 'Reviews', n: nKind('review') },
          { key: 'projection' as const, label: 'Projections', n: nKind('projection') },
          { key: 'onboarding' as const, label: 'Onboarding', n: nKind('onboarding') },
        ]}
        value={listKind} onChange={setListKind} />
      {loading ? (
        <LeanEmpty><Loader2 size={13} className="inline animate-spin mr-1.5" />Loading reports…</LeanEmpty>
      ) : !shownReports.length ? (
        <LeanEmpty>{reports.length ? 'None of this kind yet.' : 'No reports yet — press New report.'}</LeanEmpty>
      ) : (
        <LeanList>
          {shownReports.map(r => {
            const k = KIND_TAG[kindOfRow(r)]
            return (
              <LeanRow key={r.id}
                name={<a href={'/r/' + r.code} className="hover:text-brand-700">{r.title}</a>}
                meta={r.period_start + ' – ' + r.period_end}
                tags={<>
                  <Tag tone={k.t}>{k.l}</Tag>
                  <Tag title={'Data as of ' + r.as_of}>as of {r.as_of}</Tag>
                  <Tag tone="brand" title="Report status">{r.status}</Tag>
                </>}
                actions={<>
                  <Tip label="Open in a new tab">
                    <a href={'/r/' + r.code} target="_blank" rel="noreferrer" aria-label="Open in a new tab"
                      className="shrink-0 inline-flex items-center justify-center rounded-lg border border-line bg-white w-8 h-8 text-muted hover:text-ink hover:bg-app"><ExternalLink size={14} /></a>
                  </Tip>
                  <IconBtn title="Delete report (the link stops working)" tone="bad" onClick={() => remove(r.id)}><Trash2 size={14} /></IconBtn>
                </>} />
            )
          })}
        </LeanList>
      )}
    </div>
  )
}
