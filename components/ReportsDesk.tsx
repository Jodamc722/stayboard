'use client'
// Owner Reports desk: list of generated reports + the New-report flow
// (pick buildings, period, as-of → generate → open the share page).
import { useEffect, useRef, useState } from 'react'
import { FileText, Loader2, Plus, Trash2, ExternalLink, Sparkles, Paperclip, Image as ImageIcon, X } from 'lucide-react'

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
  const defaults = monthDefaults()
  // 'review' = the full performance review; 'projection' = the next-season projection report
  // built from Money → Projections (Jon, 2026-08-22). Projection needs no period — the season
  // IS the period — and skips the AI pass, so it generates in a few seconds.
  const [kind, setKind] = useState<'review' | 'projection'>('review')
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
  }, [])

  // Statements follow the property selection. Anything whose period sits inside the report
  // window is preselected, since that is nearly always what the report is about. Statements
  // whose month hasn't been swept into the ledger mirror can't be picked — the generator
  // refuses them rather than report a silently empty ledger.
  const pickedKey = picked.join(',')
  useEffect(() => {
    if (!picked.length) { setStmtList([]); setStmtPicked([]); return }
    let cancelled = false
    setStmtLoading(true)
    fetch('/api/reports/statements?buildings=' + encodeURIComponent(pickedKey))
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
    if (!picked.length) { setMsg('Pick at least one property.'); return }
    setGenerating(true); setMsg(kind === 'projection' ? 'Building the projection report… (~5s)' : 'Pulling data + writing the report… (~30s)')
    try {
      const r = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          buildings: picked, periodStart, periodEnd,
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

  return (
    <div className="space-y-5">
      {/* New report */}
      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-bold text-ink flex items-center gap-1.5"><Sparkles size={14} className="text-brand-600" /> New owner report</h2>
            <p className="text-[12px] text-muted mt-0.5">Pick properties + a period. Revenue, occupancy, reviews and completed work are pulled automatically.</p>
          </div>
          {!showNew && (
            /* On a phone this wrapped onto its own line and sat alone in an empty band next to
               nothing. Full width there instead — it is the primary action on the page. */
            <button onClick={() => setShowNew(true)} className="w-full sm:w-auto justify-center sm:justify-start inline-flex items-center gap-1.5 rounded-xl bg-brand-600 text-white text-sm font-semibold px-4 py-2 hover:bg-brand-700">
              <Plus size={14} /> New report
            </button>
          )}
        </div>
        {showNew && (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2">Report type</p>
              <div className="flex items-center rounded-xl border border-line bg-neutral-50 overflow-hidden w-fit">
                <button onClick={() => setKind('review')}
                  className={'px-3.5 py-1.5 text-[12.5px] font-semibold ' + (kind === 'review' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                  Owner review
                </button>
                <button onClick={() => setKind('projection')}
                  className={'px-3.5 py-1.5 text-[12.5px] font-semibold ' + (kind === 'projection' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                  Season projection
                </button>
              </div>
              {/* THE PROJECTION BUILDER LIVES HERE (Jon, 2026-08-25: "remove the projections tab,
                  in the owner reports it should have a projection builder"). Projections stopped
                  being a place you navigate to — it is a thing you build for an owner, so the entry
                  point is this toggle, and the model editor is one link off it rather than a sidebar
                  row you have to know exists. The editor keeps its page, its API and its role gate;
                  when Eric's app connects, the budget/forecast side lands behind that same link. */}
              {kind === 'projection' && (
                <div className="mt-1.5">
                  <p className="text-[12px] text-muted">
                    Next season&rsquo;s net owner revenue per unit, with property health and ADR-upside recommendations.
                    Generate, then edit any wording in place; hidden sections can be re-enabled on the report.
                  </p>
                  <a href="/projections"
                    className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-bold px-2.5 py-1.5 rounded-lg border border-line bg-white hover:border-ink/30 text-ink"
                    title="Every month, unit and lever behind these numbers — occupancy, ADR, length of stay, management and building splits">
                    Adjust the model &rarr;
                  </a>
                </div>
              )}
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2">Properties</p>
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
              ) : (
                <span className="text-[12.5px] text-muted pb-2">Period: next high season (Nov–Apr), straight from the projection model.</span>
              )}
              <button onClick={generate} disabled={generating || !picked.length}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 text-white text-sm font-semibold px-5 py-2 hover:bg-brand-700 disabled:opacity-50">
                {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {kind === 'projection' ? 'Generate projection report' : 'Generate report'}
              </button>
              <button onClick={() => { setShowNew(false); setMsg('') }} className="text-sm text-muted hover:text-ink px-2 py-2">Cancel</button>
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
                    <p className="text-[11px] text-muted mt-1.5">{(STMT_MODES.find(m => m.id === stmtMode) || STMT_MODES[0]).hint}</p>
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
                <p className="text-[11px] text-muted mt-1.5">
                  Figures come straight from the recognised Guesty owner ledger &mdash; net is what the owner earned, paid is what actually settled.
                  {stmtPicked.length === 1
                    ? ' One statement selected: the report gets a single-owner statement section for that month.'
                    : stmtPicked.length > 1
                      ? ' ' + stmtPicked.length + ' statements selected: the report rolls them up by month, with a per-owner breakdown.'
                      : ' Nothing selected — the report will be generated without an Owner Statement section.'}
                </p>
              </div>
            )}
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2">Optional attachments</p>
              <div className="flex flex-wrap items-center gap-2">
                <input ref={pacingRef} type="file" accept="application/pdf" className="hidden" onChange={onPacingPick} />
                <input ref={heroRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onHeroPick} />
                <button onClick={() => pacingRef.current && pacingRef.current.click()} disabled={!!uploading}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink hover:border-brand-300 disabled:opacity-50">
                  {uploading === 'pacing' ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />} PriceLabs pacing PDF
                </button>
                <button onClick={() => heroRef.current && heroRef.current.click()} disabled={!!uploading}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink hover:border-brand-300 disabled:opacity-50">
                  {uploading === 'hero' ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />} Hero photo
                </button>
              </div>
              {(pacing || heroImg) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {pacing && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 px-2.5 py-1 text-[11.5px] font-semibold">
                      Pacing: {pacing.name}
                      <button onClick={() => setPacing(null)} className="hover:text-red-600"><X size={11} /></button>
                    </span>
                  )}
                  {heroImg && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 px-2.5 py-1 text-[11.5px] font-semibold">
                      Hero: {heroImg.name}
                      <button onClick={() => setHeroImg(null)} className="hover:text-red-600"><X size={11} /></button>
                    </span>
                  )}
                </div>
              )}
            </div>
            {msg && <p className="text-[13px] text-amber-700">{msg}</p>}
            <p className="text-[11px] text-muted">Performance vs Plan appears automatically when the property has a stored budget. Attach a PriceLabs pacing PDF to add &ldquo;Pacing vs Market&rdquo;, and a hero photo for the cover. The Owner Statement section is built from the statements selected above.</p>
          </div>
        )}
      </section>

      {/* List */}
      <section className="rounded-2xl border border-line bg-white overflow-hidden">
        {loading ? (
          <div className="text-sm text-muted italic py-10 text-center">Loading reports…</div>
        ) : !reports.length ? (
          <div className="text-sm text-muted italic py-10 text-center">No reports yet — generate the first one above.</div>
        ) : (
          /* Five columns — title, period, as-of, status, actions — do not fit a phone, and the
             report title in the first column is itself the link you tap, so the table keeps its
             widths and scrolls in its own box rather than squeezing every date onto two lines. */
          <div className="lh-hscroll">
          <table className="w-full min-w-[680px] sm:min-w-0 text-sm">
            <thead>
              <tr className="text-left border-b border-line bg-app/50">
                <th className="px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted font-semibold">Report</th>
                <th className="px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted font-semibold">Period</th>
                <th className="px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted font-semibold">As of</th>
                <th className="px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted font-semibold">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {reports.map(r => (
                <tr key={r.id} className="border-b border-line last:border-0 hover:bg-app/40">
                  <td className="px-4 py-3">
                    <a href={'/r/' + r.code} className="font-semibold text-ink hover:text-brand-700 inline-flex items-center gap-1.5">
                      <FileText size={14} className="text-muted" /> {r.title}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-muted tabular-nums">{r.period_start} → {r.period_end}</td>
                  <td className="px-4 py-3 text-muted tabular-nums">{r.as_of}</td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 uppercase tracking-wider">{r.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <a href={'/r/' + r.code} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-800 mr-3">
                      <ExternalLink size={12} /> Open
                    </a>
                    <button onClick={() => remove(r.id)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted hover:text-red-600">
                      <Trash2 size={12} /> Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>
    </div>
  )
}
