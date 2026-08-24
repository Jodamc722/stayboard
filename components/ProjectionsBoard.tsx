'use client'
// OWNER PROJECTIONS — next season, editable. See lib/projections.ts for how numbers are built:
// last season's measured months → market uplift (researched defaults, editable) → the team's
// per-month overrides (occ / ADR / LOS). Net owner = accommodation revenue × (1 − mgmt fee).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, Undo2 } from 'lucide-react'
import { useAccess } from '@/lib/useAccess'

type Cell = {
  month: string; days: number
  histNights: number | null; histOcc: number | null; histAdr: number | null; histLos: number | null; histNet: number | null
  sugOcc: number; sugAdr: number; sugLos: number
  occ: number; adr: number; los: number
  edited: boolean
  nights: number; stays: number; grossAccom: number; netOwner: number
}
type Unit = {
  id: string; name: string; building: string; market: string; bedrooms: number | null
  mgmtPct: number; months: Cell[]
  seasonNet: number; seasonGross: number; seasonNights: number
}
type Data = {
  ok: boolean; error?: string
  season: string[]; histSeason: string[]
  mgmtPct: number; buildingPct: Record<string, number>
  uplift: Record<string, { adrPct: number; occPts: number }>
  units: Unit[]
  buildings: { building: string; units: number; net: number; gross: number; nights: number; byMonth: Record<string, number> }[]
  combined: { net: number; gross: number; nights: number; byMonth: Record<string, number> }
  updatedAt: string | null; updatedBy: string | null
}

const money0 = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const mLabel = (m: string) => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) + ' ’' + m.slice(2, 4)

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white shadow-soft px-4 py-3">
      <div className="text-[10.5px] uppercase tracking-wide text-muted font-bold">{label}</div>
      <div className="text-xl font-bold text-ink tabular-nums">{value}</div>
      {sub ? <div className="text-[11.5px] text-muted mt-0.5">{sub}</div> : null}
    </div>
  )
}

/** One assumption input. Saves on blur/Enter; empty string clears back to the suggestion. */
function Field({ value, sug, onSave, w, suffix, disabled }: {
  value: number; sug: number; onSave: (v: number | null) => void; w: string; suffix?: string; disabled?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const edited = Math.abs(value - sug) > 0.001
  return (
    <span className="inline-flex items-center gap-0.5">
      <input
        value={draft != null ? draft : String(value)}
        disabled={disabled}
        onChange={e => setDraft(e.target.value)}
        onFocus={e => e.target.select()}
        onBlur={() => {
          if (draft == null) return
          const t = draft.trim()
          setDraft(null)
          if (t === '') { if (edited) onSave(null); return }
          const n = Number(t)
          if (Number.isFinite(n) && n >= 0 && Math.abs(n - value) > 0.001) onSave(n)
        }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className={w + ' rounded-md border px-1 py-0.5 text-right text-[11.5px] tabular-nums ' + (edited ? 'border-brand-400 bg-brand-50 font-semibold text-brand-800' : 'border-line')}
      />
      {suffix ? <span className="text-[10px] text-muted">{suffix}</span> : null}
    </span>
  )
}

export function ProjectionsBoard() {
  const acc = useAccess()
  const canEdit = acc.atLeast('projections', 'edit')
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [openB, setOpenB] = useState<Record<string, boolean>>({})
  const [openU, setOpenU] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [outlookOpen, setOutlookOpen] = useState(false)

  const load = useCallback(async (quiet?: boolean) => {
    if (!quiet) { setLoading(true); setErr(null) }
    try {
      const r = await fetch('/api/projections', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Load failed')
      setData(j)
    } catch (e: any) { if (!quiet) setErr(String(e?.message || e)) }
    if (!quiet) setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const syncTimer = useRef<any>(null)
  const save = useCallback(async (patch: any) => {
    setSaving(true)
    try {
      const r = await fetch('/api/projections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || 'Save failed')
      if (syncTimer.current) clearTimeout(syncTimer.current)
      syncTimer.current = setTimeout(() => load(true), 400)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setSaving(false)
  }, [load])

  const saveCell = useCallback((uid: string, m: string, field: 'occ' | 'adr' | 'los', v: number | null) => {
    save({ overrides: { [uid]: { [m]: { [field]: v } } } })
  }, [save])

  const unitsShown = useMemo(() => {
    if (!data) return [] as Unit[]
    const needle = q.trim().toLowerCase()
    if (!needle) return data.units
    return data.units.filter(u => (u.name + ' ' + u.building).toLowerCase().includes(needle))
  }, [data, q])
  const byBuilding = useMemo(() => {
    const map: Record<string, Unit[]> = {}
    for (const u of unitsShown) (map[u.building] = map[u.building] || []).push(u)
    return map
  }, [unitsShown])

  if (loading && !data) return <div className="rounded-2xl border border-line bg-white p-10 text-center text-[13px] text-muted">Building the projection from last season, market data and your assumptions…</div>
  if (!data) return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err || 'Could not load.'}</div>

  const season = data.season
  const seasonLabel = mLabel(season[0]) + ' – ' + mLabel(season[season.length - 1])
  const avgOcc = (() => {
    let n = 0, d = 0
    for (const u of data.units) for (const c of u.months) { n += c.nights; d += c.days }
    return d ? Math.round((n / d) * 1000) / 10 : 0
  })()

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-brand-600 font-bold">Money</div>
          <h1 className="text-2xl font-bold text-ink tracking-tight">Owner Projections</h1>
          <p className="text-[12.5px] text-muted mt-0.5">
            Net owner revenue for next season ({seasonLabel}) — baseline is the same month last year, adjusted by the market outlook; every month is editable per unit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saving ? <span className="text-[12px] text-muted">Saving…</span>
            : data.updatedAt ? <span className="text-[11.5px] text-muted">assumptions saved {String(data.updatedAt).slice(0, 10)}{data.updatedBy ? ' · ' + data.updatedBy : ''}</span> : null}
          <button onClick={() => load()} className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft inline-flex items-center gap-1.5">
            <RefreshCw className={'w-3.5 h-3.5 ' + (loading ? 'animate-spin' : '')} /> Refresh
          </button>
        </div>
      </div>

      {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div> : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Net owner revenue" value={money0(data.combined.net)} sub={'combined · ' + seasonLabel} />
        <Kpi label="Gross accommodation" value={money0(data.combined.gross)} sub="net of channel, before mgmt fee" />
        <Kpi label="Projected nights" value={data.combined.nights.toLocaleString()} sub={avgOcc + '% portfolio occupancy'} />
        <Kpi label="Management fee" value={data.mgmtPct + '%'} sub="default — override per building below" />
      </div>

      {/* Market outlook + the levers. Researched 2026-08-21; the uplifts are yours to change. */}
      <div className="rounded-2xl border border-line bg-white shadow-soft">
        <button onClick={() => setOutlookOpen(v => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
          {outlookOpen ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronRight className="w-4 h-4 text-muted" />}
          <span className="text-[13px] font-bold text-ink">Market outlook &amp; assumptions</span>
          <span className="text-[11.5px] text-muted">Miami ADR {data.uplift.miami?.adrPct >= 0 ? '+' : ''}{data.uplift.miami?.adrPct}% · occ {data.uplift.miami?.occPts >= 0 ? '+' : ''}{data.uplift.miami?.occPts}pts &nbsp;·&nbsp; Broward ADR {data.uplift.broward?.adrPct >= 0 ? '+' : ''}{data.uplift.broward?.adrPct}% · occ {data.uplift.broward?.occPts >= 0 ? '+' : ''}{data.uplift.broward?.occPts}pts</span>
        </button>
        {outlookOpen ? (
          <div className="px-4 pb-4 space-y-3">
            <div className="text-[12.5px] text-ink space-y-1.5">
              <p><b>Miami:</b> market ADR ≈ $267–319, occupancy ≈ 44–53%, revenue +4.7% YoY — but supply grew ~30% YoY, which pressures less-differentiated units. March is the strongest month (≈60% market occ, $408 ADR); December strong on Art Basel.</p>
              <p><b>Broward / Fort Lauderdale:</b> ADR ≈ $391, occupancy ≈ 44%, revenue +2.0% YoY with supply +21.5%. Watch-out: Spirit&rsquo;s FLL shutdown removed ~100 daily cheap departures — the budget-domestic segment softens, which is why Broward&rsquo;s default occupancy uplift is negative.</p>
              <p><b>2027 season shape (FIU outlook):</b> headline visitors roughly flat, international + group travel carries spend (longer stays — worth nudging LOS up, not down). Miami-Dade hotels ran ~80% occupancy at $293 ADR (+11.2%) through May 2026.</p>
              <p className="text-[11px] text-muted">Sources: AirROI &amp; Rabbu Miami/Fort Lauderdale market reports; FIU Chaplin School 2027 tourism outlook (researched 2026-08-21). Airbnb has no public API for per-unit comps — these benchmarks stand in, and any cell accepts a comp number you paste from an Airbnb search.</p>
            </div>
            <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-line/60">
              <span className="text-[12px] font-semibold text-ink">Levers:</span>
              <span className="flex items-center gap-1.5 text-[12px] text-muted">Mgmt fee
                <Field value={data.mgmtPct} sug={data.mgmtPct} w="w-14" suffix="%" disabled={!canEdit}
                  onSave={v => { if (v != null) save({ mgmtPct: v }) }} />
              </span>
              {(['miami', 'broward', 'north'] as const).map(mk => data.uplift[mk] ? (
                <span key={mk} className="flex items-center gap-1.5 text-[12px] text-muted capitalize">{mk}: ADR
                  <Field value={data.uplift[mk].adrPct} sug={data.uplift[mk].adrPct} w="w-12" suffix="%" disabled={!canEdit}
                    onSave={v => { if (v != null) save({ uplift: { [mk]: { adrPct: v } } }) }} />
                  occ
                  <Field value={data.uplift[mk].occPts} sug={data.uplift[mk].occPts} w="w-12" suffix="pts" disabled={!canEdit}
                    onSave={v => { if (v != null) save({ uplift: { [mk]: { occPts: v } } }) }} />
                </span>
              ) : null)}
            </div>
          </div>
        ) : null}
      </div>

      {/* Combined by month */}
      <div className="rounded-2xl border border-line bg-white shadow-soft px-4 py-3">
        <div className="grid gap-2" style={{ gridTemplateColumns: '160px repeat(' + season.length + ', minmax(0,1fr)) 110px' }}>
          <div className="text-[10.5px] uppercase tracking-wide text-muted font-bold self-end">Combined net</div>
          {season.map(m => (
            <div key={m} className="text-right">
              <div className="text-[10.5px] uppercase tracking-wide text-muted font-bold">{mLabel(m)}</div>
              <div className="text-[13.5px] font-bold text-ink tabular-nums">{money0(data.combined.byMonth[m] || 0)}</div>
            </div>
          ))}
          <div className="text-right">
            <div className="text-[10.5px] uppercase tracking-wide text-muted font-bold">Season</div>
            <div className="text-[13.5px] font-extrabold text-brand-700 tabular-nums">{money0(data.combined.net)}</div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter unit or building…"
          className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] w-64 shadow-soft" />
        <span className="text-[11.5px] text-muted">Blue cells are edited assumptions; everything else follows last year + the market levers. Click a unit to edit its months.</span>
      </div>

      {data.buildings.map(b => {
        const list = byBuilding[b.building] || []
        if (q && !list.length) return null
        const open = openB[b.building] !== false
        return (
          <div key={b.building} className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
            <button onClick={() => setOpenB(s => ({ ...s, [b.building]: !open }))}
              className="w-full px-4 py-3 flex items-center gap-2 text-left bg-neutral-50/60">
              {open ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronRight className="w-4 h-4 text-muted" />}
              <span className="text-[13.5px] font-bold text-ink">{b.building}</span>
              <span className="text-[11.5px] text-muted">{b.units} {b.units === 1 ? 'unit' : 'units'}</span>
              {canEdit ? (
                <span className="flex items-center gap-1 text-[11.5px] text-muted" onClick={e => e.stopPropagation()}>fee
                  <Field value={data.buildingPct[b.building] != null ? data.buildingPct[b.building] : data.mgmtPct}
                    sug={data.mgmtPct} w="w-12" suffix="%"
                    onSave={v => save({ buildingPct: { [b.building]: v } })} />
                </span>
              ) : null}
              <span className="grow" />
              {season.map(m => (
                <span key={m} className="hidden lg:inline text-[11.5px] tabular-nums text-muted w-[84px] text-right">{money0(b.byMonth[m] || 0)}</span>
              ))}
              <span className="text-[13px] font-extrabold text-ink tabular-nums w-[100px] text-right">{money0(b.net)}</span>
            </button>
            {open ? (
              <div>
                {list.map(u => {
                  const uo = !!openU[u.id]
                  return (
                    <div key={u.id} className="border-t border-line/60">
                      <button onClick={() => setOpenU(s => ({ ...s, [u.id]: !uo }))}
                        className="w-full px-4 py-2 grid items-center gap-2 text-left hover:bg-neutral-50"
                        style={{ gridTemplateColumns: '160px repeat(' + season.length + ', minmax(0,1fr)) 110px' }}>
                        <span className="truncate">
                          <span className="text-[12.5px] font-semibold text-ink">{u.name}</span>
                          {u.bedrooms != null ? <span className="text-[10.5px] text-muted"> · {u.bedrooms}BR</span> : null}
                        </span>
                        {u.months.map(c => (
                          <span key={c.month} className="text-right">
                            <span className={'text-[12.5px] tabular-nums font-semibold ' + (c.edited ? 'text-brand-700' : 'text-ink')}>{money0(c.netOwner)}</span>
                            <span className="block text-[10px] text-muted tabular-nums">{Math.round(c.occ)}% · ${Math.round(c.adr)}</span>
                          </span>
                        ))}
                        <span className="text-right text-[12.5px] font-bold tabular-nums text-ink">{money0(u.seasonNet)}</span>
                      </button>
                      {uo ? (
                        <div className="px-4 pb-3 bg-neutral-50/50">
                          <div className="grid gap-2" style={{ gridTemplateColumns: '160px repeat(' + season.length + ', minmax(0,1fr)) 110px' }}>
                            <div className="text-[11px] text-muted pt-1.5">
                              assumptions<br /><span className="text-[10px]">occ% · ADR · LOS</span>
                              <div className="mt-1 text-[10px]">last year<br />net owner</div>
                            </div>
                            {u.months.map(c => (
                              <div key={c.month} className="pt-1">
                                <div className="flex flex-col items-end gap-1">
                                  <Field value={c.occ} sug={c.sugOcc} w="w-14" suffix="%" disabled={!canEdit}
                                    onSave={v => saveCell(u.id, c.month, 'occ', v)} />
                                  <Field value={c.adr} sug={c.sugAdr} w="w-16" suffix="$" disabled={!canEdit}
                                    onSave={v => saveCell(u.id, c.month, 'adr', v)} />
                                  <Field value={c.los} sug={c.sugLos} w="w-12" suffix="n" disabled={!canEdit}
                                    onSave={v => saveCell(u.id, c.month, 'los', v)} />
                                </div>
                                <div className="mt-1 text-right text-[10px] text-muted tabular-nums">
                                  {c.histOcc != null
                                    ? <>{Math.round(c.histOcc)}% · ${Math.round(c.histAdr || 0)} · {c.histLos != null ? c.histLos : '—'}n<br />{c.histNet != null ? money0(c.histNet) : '—'}</>
                                    : <>no history<br />market-based</>}
                                </div>
                                <div className="mt-0.5 text-right text-[10px] text-muted tabular-nums">{c.nights}n · {c.stays} stays</div>
                              </div>
                            ))}
                            <div className="pt-1 text-right">
                              {canEdit && u.months.some(c => c.edited) ? (
                                <button onClick={() => save({ overrides: { [u.id]: null } })}
                                  title="Clear every edited month on this unit back to the suggestion"
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted hover:text-ink">
                                  <Undo2 className="w-3 h-3" /> reset unit
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
        )
      })}

      <p className="text-[11.5px] text-muted">
        Net owner = projected nights × ADR (net of channel) × (1 − management fee). Cleaning fees are a guest pass-through and are not owner revenue.
        LOS drives the stays count (nights ÷ LOS) so you can sanity-check turnover load. Baselines come from the same month last season;
        units with no history borrow the building average, then the market benchmark for their bedroom count.
      </p>
    </div>
  )
}
