'use client'
// Glitches — the full record of guest-reported problems, open and resolved.
// The Today-in-Ops tab shows what needs eyes NOW; this page is for managing the pattern:
// what's still open regardless of age, what got resolved, and which units keep glitching.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Shell } from '@/components/Shell'
import { GlitchBoard } from '@/components/GlitchBoard'
import { BuildingPatterns } from '@/components/BuildingPatterns'
import { RefreshCw, Search, ExternalLink, FileText, X } from 'lucide-react'
import { LeanHead, LeanTabs, Pill, Tag, IconBtn, LeanList, LeanRow, LeanEmpty } from '@/components/lean'

type Person = { id: number; name: string; departments: string[] }
type Glitch = { id: string; unit: string; market: string; building?: string | null; issue: string; rawName: string; status: string; done: boolean; resolvedDate: string | null; scheduledDate: string | null; reportedDate: string | null; ageDays: number | null; running: boolean; unassigned: boolean; assignees: string[]; reportUrl: string | null }
type Data = { ok: boolean; today: string; count: number; unassigned: number; glitches: Glitch[]; error?: string }

function adminUrl(id: string) { return 'https://app.breezeway.io/task/' + id }
function fmtShort(iso: string | null) { if (!iso) return ''; const d = new Date(iso + 'T12:00:00'); if (isNaN(d.getTime())) return iso; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) }

export default function GlitchesPage() {
  const [tab, setTab] = useState<'board' | 'history' | 'patterns' | 'trends'>('board')
  const [data, setData] = useState<Data | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [market, setMarket] = useState('all')
  const [q, setQ] = useState('')
  // DEEP LINK (2026-09-02): the Command Center sends /glitches?q=<unit> so a tapped row lands on
  // that unit's issues rather than on a 200-card board you then have to search again.
  useEffect(() => { try { const v = new URLSearchParams(window.location.search).get('q'); if (v) setQ(v) } catch {} }, [])

  const load = useCallback(async () => {
    try {
      setErr('')
      if (tab === 'board') { setLoading(false); return }
      const r = await fetch('/api/ops-today/glitches?history=1', { cache: 'no-store' })
      const j: Data = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Failed to load'); setLoading(false); return }
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [tab])
  useEffect(() => { setLoading(true); load() }, [load])
  useEffect(() => { fetch('/api/breezeway/people', { cache: 'no-store' }).then(r => r.json()).then(j => setPeople(Array.isArray(j.people) ? j.people : [])).catch(() => {}) }, [])
  // board glitches (with category + $) power the insights strip on History
  const [board, setBoard] = useState<any>(null)
  useEffect(() => { fetch('/api/glitches', { cache: 'no-store' }).then(r => r.json()).then(setBoard).catch(() => {}) }, [])

  const assign = async (taskId: string, personId: number) => {
    try {
      const r = await fetch('/api/breezeway/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, assigneeIds: [personId] }) })
      const j = await r.json(); if (!r.ok || !j.ok) { setErr(j.error || 'Assign failed'); return }
      load()
    } catch (e: any) { setErr(String(e?.message || e)) }
  }

  const all: Glitch[] = (data && data.glitches) || []
  const rows = useMemo(() => {
    let list = market === 'all' ? all : all.filter(g => g.market === market)
    const needle = q.trim().toLowerCase()
    if (needle) list = list.filter(g => g.unit.toLowerCase().includes(needle) || g.issue.toLowerCase().includes(needle))
    return list
  }, [all, market, q])

  // repeat offenders: units with 2+ glitches in the loaded set (most useful on History)
  const repeats = useMemo(() => {
    const byUnit: Record<string, number> = {}
    for (const g of all) byUnit[g.unit] = (byUnit[g.unit] || 0) + 1
    return Object.keys(byUnit).map(u => ({ unit: u, n: byUnit[u] })).filter(x => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 6)
  }, [all])

  const markets = ['all', 'Miami', 'Broward', 'North', 'Vendor']
  const openCount = all.filter(g => !g.done).length
  const bg: any[] = board && Array.isArray(board.glitches) ? board.glitches : []
  const inPlay = bg.filter(g => g.status !== 'closed').length
  const boardRefunds = bg.reduce((s, g) => s + (Number(g.refund_approved) || 0), 0)
  const topCats = (() => {
    const byCat: Record<string, number> = {}
    for (const g of bg) if (g.category) byCat[g.category] = (byCat[g.category] || 0) + 1
    return Object.keys(byCat).map(k => ({ k, n: byCat[k] })).sort((a, b) => b.n - a.n).slice(0, 3)
  })()

  return (
    <Shell>
      {/* The Today-in-Ops tab shows what needs eyes now; this page manages the pattern. */}
      <LeanHead title="Guest Issues">
        {bg.length > 0 && <Pill tone={inPlay ? 'rose' : 'emerald'} title="Cards on the escalation board that are not closed">{inPlay} in play</Pill>}
        {data && <Pill title={all.length + ' Breezeway guest-reported tasks on record'}>{openCount} open in Breezeway</Pill>}
        {boardRefunds > 0 && <Pill tone="emerald" title="Refunds approved across board cards">${Math.round(boardRefunds).toLocaleString()} refunded</Pill>}
      </LeanHead>

      <LeanTabs value={tab} onChange={setTab}
        tabs={[
          { key: 'board', label: 'Board', n: inPlay || null },
          { key: 'history', label: 'History', n: data ? all.length : null },
          { key: 'patterns', label: 'Patterns' },
          { key: 'trends', label: 'Trends' },
        ]}
        right={tab === 'history' ? (<>
          <select value={market} onChange={e => setMarket(e.target.value)} title="Market" className="text-[12px] py-1 pl-2 pr-6 rounded-lg border border-line bg-white">
            {markets.map(m => <option key={m} value={m}>{m === 'all' ? 'All markets' : m}</option>)}
          </select>
          <span className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Unit or issue…" className="text-[12px] border border-line rounded-lg pl-6 pr-2 py-1 bg-white w-40 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          </span>
          <IconBtn title="Reload the history from Breezeway" onClick={() => { setLoading(true); load() }}><RefreshCw size={13} /></IconBtn>
        </>) : null} />

      {tab === 'board' && <GlitchBoard />}
      {tab !== 'board' && tab !== 'patterns' && loading && !data && <LeanEmpty>Loading glitches…</LeanEmpty>}
      {err && <div className="text-[12.5px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">{err}</div>}

      {/* Nav diet 2026-08-11 (Jon): Building Patterns folded in from /patterns. Lean pass: the
          repeat-offender drill it used to stack underneath is now its own Trends tab. */}
      {tab === 'patterns' && <BuildingPatterns />}
      {tab === 'trends' && data && (
        <PatternsView all={all} board={board} onDrill={(u: string) => { setTab('history'); setQ(u) }} />
      )}

      {tab === 'history' && data && (
        <>
          {(topCats.length > 0 || repeats.length > 0) && (
            <div className="flex items-center gap-1.5 flex-wrap mb-3 px-1 text-[12px] text-muted">
              {topCats.length > 0 && <span className="font-semibold">Top</span>}
              {topCats.map(t => <Tag key={t.k} title={t.k}>{t.k.replace('Maintenance - ', '')} ×{t.n}</Tag>)}
              {repeats.length > 0 && <span className="font-semibold ml-2">Repeat units</span>}
              {repeats.map(r => (
                <button key={r.unit} onClick={() => setQ(r.unit)} title={'Show only ' + r.unit}><Tag tone="rose">{r.unit} ×{r.n}</Tag></button>
              ))}
            </div>
          )}

          {rows.length === 0 ? <LeanEmpty>Nothing matches.</LeanEmpty> : (
            <LeanList>
              {rows.map(g => (
                <LeanRow key={g.id}
                  tint={!g.done && g.unassigned ? 'rose' : undefined}
                  name={g.issue}
                  meta={g.unit + (g.market ? ' · ' + g.market : '')}
                  tags={<>
                    {g.done
                      ? <Tag tone="emerald">Resolved{g.resolvedDate ? ' ' + fmtShort(g.resolvedDate) : ''}</Tag>
                      : g.running
                        ? <Tag tone="sky">In progress</Tag>
                        : <Tag tone={(g.ageDays || 0) >= 2 ? 'rose' : 'amber'} title={g.ageDays != null ? g.ageDays + ' days open' : undefined}>Open{g.ageDays != null && g.ageDays > 0 ? ' · ' + g.ageDays + 'd' : ''}</Tag>}
                    {g.reportedDate && <Tag title="Reported">{fmtShort(g.reportedDate)}</Tag>}
                    {!g.done && g.unassigned && <Tag tone="rose" title="Open the row to assign">Unassigned</Tag>}
                    {g.assignees.length > 0 && <Tag title={'Assigned: ' + g.assignees.join(', ')}>{g.assignees[0].split(' ')[0]}{g.assignees.length > 1 ? ' +' + (g.assignees.length - 1) : ''}</Tag>}
                  </>}
                  actions={<>
                    <IconBtn title="Open the task in Breezeway (edit, assign, check)" href={adminUrl(g.id)}><ExternalLink size={13} /></IconBtn>
                    {g.reportUrl && <IconBtn title="View the field report" href={g.reportUrl}><FileText size={13} /></IconBtn>}
                  </>}>
                  {!g.done ? (
                    <div className="flex items-center gap-2 flex-wrap text-[12px]">
                      <span className="text-muted">Assign</span>
                      <input list="glitch-page-ppl" defaultValue="" placeholder={g.assignees.length ? g.assignees.join(', ') : 'pick a person…'} onChange={e => { const inp = e.target as HTMLInputElement; const nm = inp.value.trim().replace(/\s*\([^)]*\)\s*$/, ''); const p = people.find(x => x.name === nm); if (p) { inp.value = ''; assign(g.id, p.id) } }} className={'text-[12px] rounded-lg border px-2 py-1 bg-white w-56 max-w-full ' + (g.assignees.length ? 'border-line text-ink placeholder:text-ink' : 'border-rose-300 text-rose-800 placeholder:text-rose-800 font-medium')} />
                    </div>
                  ) : (
                    <p className="text-[12px] text-muted">{g.assignees.length ? 'Handled by ' + g.assignees.join(', ') : 'No assignee recorded'}</p>
                  )}
                </LeanRow>
              ))}
            </LeanList>
          )}
          <datalist id="glitch-page-ppl">
            {people.map(p => <option key={p.id} value={p.name + (p.departments && p.departments.length ? ' (' + p.departments.join('/') + ')' : '')} />)}
          </datalist>
        </>
      )}
    </Shell>
  )
}


// PATTERNS — the learning layer: recurring issues by theme, building and unit, plus the
// monthly trend, computed from the full Breezeway guest-reported history (and board $ once logged).
const THEMES: { key: string; label: string; re: RegExp }[] = [
  { key: 'ac', label: 'A/C & cooling', re: /\ba\/?c\b|air ?cond|cooling|not cooling|thermostat/i },
  { key: 'hotwater', label: 'Hot water / heater', re: /hot ?water|water ?heater|no ?heat/i },
  { key: 'plumbing', label: 'Plumbing & leaks', re: /leak|plumb|toilet|drain|clog|sink|shower|faucet|flood/i },
  { key: 'appliance', label: 'Appliances', re: /washer|dryer|dishwasher|fridge|refrigerator|freezer|oven|stove|microwave|ice ?maker/i },
  { key: 'clean', label: 'Cleanliness', re: /clean|dirty|hair|stain|smell|odor|trash|linen|towel/i },
  { key: 'pest', label: 'Pests', re: /roach|pest|bug|ant\b|rodent|mice|mouse|bed ?bug/i },
  { key: 'access', label: 'Locks & access', re: /lock|code|key\b|door|access|get ?in|locked ?out/i },
  { key: 'electrical', label: 'Electrical & lights', re: /power|outlet|light|breaker|electric|bulb/i },
  { key: 'wifi', label: 'Wifi / TV', re: /wi-?fi|internet|tv\b|television|remote|cable/i },
  { key: 'furniture', label: 'Furniture & beds', re: /bed\b|mattress|sofa|couch|chair|table|furniture|blind|curtain|screen/i },
]
function buildingOf(g: Glitch): string {
  if (g.building) return g.building
  const head = (g.unit || '').split(' - ')[0].trim()
  const stripped = head.replace(/[\s-]*\d+[\d\/-]*$/, '').trim()
  return stripped || head || 'Unknown'
}
function PatternsView({ all, board, onDrill }: { all: Glitch[]; board: any; onDrill: (u: string) => void }) {
  // FOCUS FILTERS — narrow every stat to one building and/or one unit, so it's obvious
  // where to spend improvement effort.
  const [bFilter, setBFilter] = useState('')
  const [uFilter, setUFilter] = useState('')
  const buildingOpts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const g of all) { const b = buildingOf(g); m[b] = (m[b] || 0) + 1 }
    return Object.keys(m).map(b => ({ b, n: m[b] })).sort((a, b) => b.n - a.n)
  }, [all])
  const unitOpts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const g of all) { if (bFilter && buildingOf(g) !== bFilter) continue; m[g.unit] = (m[g.unit] || 0) + 1 }
    return Object.keys(m).map(u => ({ u, n: m[u] })).sort((a, b) => b.n - a.n)
  }, [all, bFilter])
  const filtered = useMemo(() => all.filter(g => (!bFilter || buildingOf(g) === bFilter) && (!uFilter || g.unit === uFilter)), [all, bFilter, uFilter])
  const focused = !!(bFilter || uFilter)

  const stats = useMemo(() => {
    const open = filtered.filter(g => !g.done)
    const now = new Date()
    const monthKey = (iso: string) => iso.slice(0, 7)
    const months: { key: string; label: string; n: number }[] = []
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleDateString('en-US', { month: 'short' }), n: 0 }) }
    const byB: Record<string, { total: number; open: number; recent: number }> = {}
    const byUnit: Record<string, { total: number; open: number; recent: number }> = {}
    const themeCount: Record<string, number> = {}
    const cutoff90 = new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10)
    for (const g of filtered) {
      const d = g.reportedDate || g.scheduledDate || ''
      const mk = d ? monthKey(d) : ''
      const m = months.find(x => x.key === mk); if (m) m.n++
      const bld = buildingOf(g)
      if (!byB[bld]) byB[bld] = { total: 0, open: 0, recent: 0 }
      byB[bld].total++; if (!g.done) byB[bld].open++; if (d && d >= cutoff90) byB[bld].recent++
      if (!byUnit[g.unit]) byUnit[g.unit] = { total: 0, open: 0, recent: 0 }
      byUnit[g.unit].total++; if (!g.done) byUnit[g.unit].open++; if (d && d >= cutoff90) byUnit[g.unit].recent++
      let matched = false
      for (const t of THEMES) if (t.re.test(g.issue)) { themeCount[t.key] = (themeCount[t.key] || 0) + 1; matched = true }
      if (!matched) themeCount.other = (themeCount.other || 0) + 1
    }
    const buildings = Object.keys(byB).map(k => ({ b: k, ...byB[k] })).sort((a, b) => b.total - a.total).slice(0, 12)
    const unitRows = Object.keys(byUnit).map(k => ({ b: k, ...byUnit[k] })).sort((a, b) => b.total - a.total).slice(0, 15)
    const units = Object.keys(byUnit).map(u => ({ u, n: byUnit[u].total })).sort((a, b) => b.n - a.n).slice(0, 10)
    const themes = THEMES.map(t => ({ label: t.label, n: themeCount[t.key] || 0 })).concat([{ label: 'Other', n: themeCount.other || 0 }]).filter(x => x.n > 0).sort((a, b) => b.n - a.n)
    const last90 = filtered.filter(g => { const d = g.reportedDate || g.scheduledDate || ''; return d && d >= cutoff90 }).length
    const maxM = Math.max(1, ...months.map(m => m.n))
    const maxT = Math.max(1, ...themes.map(t => t.n))
    return { open: open.length, months, maxM, buildings, unitRows, units, themes, maxT, last90 }
  }, [filtered])

  const bg: any[] = useMemo(() => {
    const src = board && Array.isArray(board.glitches) ? board.glitches : []
    return src.filter((g: any) => (!bFilter || buildingOf({ unit: g.unit || '', building: null } as Glitch) === bFilter) && (!uFilter || g.unit === uFilter))
  }, [board, bFilter, uFilter])
  const ref = bg.reduce((s, g) => s + (Number(g.refund_approved) || 0), 0)

  return (
    <div className="space-y-4">
      {/* FOCUS BAR — building and/or unit, with the headline numbers as pills on the same line. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <select value={bFilter} onChange={e => { setBFilter(e.target.value); setUFilter('') }} title="Focus on one building" className="text-[12px] py-1 pl-2 pr-6 border border-line rounded-lg bg-white max-w-[14rem]">
          <option value="">All buildings</option>
          {buildingOpts.map(x => <option key={x.b} value={x.b}>{x.b} ({x.n})</option>)}
        </select>
        <input list="patterns-units" value={uFilter} onChange={e => setUFilter(e.target.value)} title="Focus on one unit" placeholder={'Unit\u2026 (' + unitOpts.length + ')'} className="text-[12px] py-1 px-2 border border-line rounded-lg bg-white w-44" />
        <datalist id="patterns-units">{unitOpts.map(x => <option key={x.u} value={x.u}>{'\u00d7' + x.n}</option>)}</datalist>
        {focused && <IconBtn title="Clear the focus" onClick={() => { setBFilter(''); setUFilter('') }}><X size={13} /></IconBtn>}
        {uFilter && <button onClick={() => onDrill(uFilter)} className="text-[12px] font-semibold text-brand-700 hover:underline">Full history</button>}
        <span className="ml-auto flex items-center gap-1.5 flex-wrap">
          <Pill title={focused ? 'Glitches for ' + (uFilter || bFilter) : 'Glitches on record'}>{filtered.length} on record</Pill>
          <Pill tone={stats.open > 0 ? 'rose' : 'slate'} title="Still open">{stats.open} open</Pill>
          <Pill title="Reported in the last 90 days">{stats.last90} in 90d</Pill>
          <Pill tone={ref > 0 ? 'emerald' : 'slate'} title="Refunds approved on board cards">${Math.round(ref).toLocaleString()} refunds</Pill>
        </span>
      </div>

      <div className="rounded-2xl border border-line bg-white p-4">
        <div className="text-sm font-semibold text-ink mb-3">Glitches per month (last 12){focused ? ' \u2014 ' + (uFilter || bFilter) : ''}</div>
        {/* Twelve bars across a phone is a 20px column — narrower than its own "Sep" label, so the
            months collided. Give each bar a real width and let the chart scroll itself. */}
        <div className="lh-hscroll -mx-1 px-1 sm:mx-0 sm:px-0">
        <div className="flex items-end gap-1.5 h-28 min-w-[420px] sm:min-w-0">
          {stats.months.map(m => (
            <div key={m.key} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] text-muted tabular-nums">{m.n || ''}</span>
              <div className="w-full rounded-t bg-brand-600/80" style={{ height: Math.max(2, Math.round((m.n / stats.maxM) * 80)) + 'px' }} />
              <span className="text-[10px] text-muted">{m.label}</span>
            </div>
          ))}
        </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-line bg-white p-4">
          <div className="text-sm font-semibold text-ink mb-2" title="Keyword match on the task issue text; one glitch can hit multiple themes">Recurring issue themes{focused ? ' \u2014 ' + (uFilter || bFilter) : ''}</div>
          <div className="space-y-1.5">
            {stats.themes.map(t => (
              <div key={t.label} className="flex items-center gap-2 text-[12px]">
                <span className="w-36 shrink-0 text-muted">{t.label}</span>
                <div className="flex-1 h-3 rounded bg-app overflow-hidden"><div className="h-full bg-amber-500/70" style={{ width: Math.max(2, Math.round((t.n / stats.maxT) * 100)) + '%' }} /></div>
                <span className="w-8 text-right tabular-nums font-semibold text-ink">{t.n}</span>
              </div>
            ))}
            {stats.themes.length === 0 && <div className="text-[12px] text-muted">No glitches in this selection.</div>}
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-white p-4">
          <div className="text-sm font-semibold text-ink mb-2">{uFilter ? 'Unit in focus' : 'Repeat-offender units' + (bFilter ? ' \u2014 ' + bFilter : '')}</div>
          <div className="divide-y divide-line">
            {stats.units.map(x => (
              <button key={x.u} onClick={() => setUFilter(uFilter === x.u ? '' : x.u)} title={uFilter === x.u ? 'Clear the focus' : 'Focus every stat on this unit'} className={'w-full flex items-center gap-2 py-1.5 text-left text-[12px] rounded px-1 ' + (uFilter === x.u ? 'bg-ink text-white' : 'hover:bg-app/50')}>
                <span className={'flex-1 ' + (uFilter === x.u ? 'text-white' : 'text-ink')}>{x.u}</span>
                <span className={'tabular-nums font-semibold ' + (uFilter === x.u ? 'text-white' : 'text-rose-700')}>{'\u00d7'}{x.n}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-white p-4">
        <div className="text-sm font-semibold text-ink mb-2">{bFilter || uFilter ? 'By unit' + (bFilter ? ' \u2014 ' + bFilter : '') : 'By building'}</div>
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-1 text-[12px]">
          <div className="text-[10px] uppercase tracking-wide text-muted">{bFilter || uFilter ? 'Unit' : 'Building'}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted text-right">Total</div>
          <div className="text-[10px] uppercase tracking-wide text-muted text-right">Open</div>
          <div className="text-[10px] uppercase tracking-wide text-muted text-right">Last 90d</div>
          {(bFilter || uFilter ? stats.unitRows : stats.buildings).map(b => (
            <FragmentRow key={b.b} b={b} onPick={() => { if (bFilter || uFilter) setUFilter(uFilter === b.b ? '' : b.b); else { setBFilter(b.b); setUFilter('') } }} />
          ))}
        </div>
      </div>

      {bg.length > 0 && (
        <div className="rounded-2xl border border-line bg-white p-4">
          <div className="text-sm font-semibold text-ink mb-2">Board categories{focused ? ' \u2014 ' + (uFilter || bFilter) : ''}</div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {Object.entries(bg.reduce((m: Record<string, number>, g: any) => { if (g.category) m[g.category] = (m[g.category] || 0) + 1; return m }, {})).sort((a: any, b: any) => b[1] - a[1]).map(([k, n]: any) => (
              <Tag key={k} title={k}>{k.replace('Maintenance - ', '')} {n}</Tag>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
function FragmentRow({ b, onPick }: { b: { b: string; total: number; open: number; recent: number }; onPick?: () => void }) {
  return (
    <>
      <button onClick={onPick} title="Focus every stat on this" className="text-left text-ink hover:underline decoration-dotted">{b.b}</button>
      <div className="text-right tabular-nums font-semibold text-ink">{b.total}</div>
      <div className={'text-right tabular-nums font-semibold ' + (b.open > 0 ? 'text-rose-700' : 'text-muted')}>{b.open}</div>
      <div className="text-right tabular-nums text-muted">{b.recent}</div>
    </>
  )
}
