'use client'
// THE BUSINESS BRAIN PAGE (app/brain). Summary first, each list on demand (/api/brain/data):
//   Units      health ranking, critical and risk first — what moved the score, repeat systems,
//              upkeep billed against net revenue (90 days), the unit page and an Ask-Eve link
//   Repeats    unit × system that failed again, with every event of that pair, newest first
//   Owners     owner_month over the last 3 and 12 months (thin by design — flagged)
//   Data       how fresh each table is, people to confirm (one tap), unknown buildings, units with no
//              Breezeway home or no owner, the maintenance titles still filed as "other"
// Red is for critical only. Phone first: every row wraps at 390px.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Brain, Check, MessageCircle, RefreshCw, X } from 'lucide-react'
import { LeanHead, LeanTabs, LeanPick, LeanList, LeanRow, LeanSection, LeanEmpty, Pill, Tag, IconBtn, type Tone } from '@/components/lean'

type TabKey = 'units' | 'repeats' | 'owners' | 'quality'
type Driver = { key: string; points: number; why: string }
type UnitRow = {
  id: string; listingId: string; unit: string; buildingId: string; building: string; market: string
  ownerId: string | null; owner: string | null; score: number | null; band: string
  drivers: Driver[]; looseRepeats: string[]; repeats: string[]
  reviewAvg: number | null; reviewN: number; glitches: number; nights: number; pmOverdue: number
  net90: number | null; billed90: number | null; upkeepPct: number | null; partial: boolean
}
type Ev = { id: string; source: string; title: string; openedAt: string; closedAt: string | null; open: boolean; hours: number | null; repeat: boolean; billed: number | null; who: string | null }
type RepeatRow = { key: string; physicalUnitId: string; unit: string; listingId: string; system: string; systemLabel: string; repeats90: number; events180: number; lastAt: string; billed180: number; events: Ev[] }
type OwnerFig = { units: number; nights: number; ownerNights: number; occupancy: number | null; net: number; billed: number; issues: number; repeats: number; events: number; reviewAvg: number | null; reviewN: number; months: number }
type OwnerRow = { ownerId: string; name: string; m3: OwnerFig; m12: OwnerFig }
type Person = { id: string; name: string; email: string | null; dept: string | null; breezewayId: string | null; homebaseId: string | null; sources: string[] }
type Lite = { listingId: string; unit: string; building: string }
type Quality = {
  missing: string[]; fresh: { table: string; rows: number | null; lastBuiltAt: string | null }[]
  people: Person[]; peopleShort: boolean
  unknownBuildings: { id: string; label: string; units: number }[]
  noHome: Lite[]; noOwner: Lite[]; topOther: { title: string; n: number }[]; otherEvents: number; vendorsToConfirm: number | null
}
type Summary = { day: string | null; bands: Record<string, number>; partialRows: number; repeatPairs: number; peopleToConfirm: number | null; unknownBuildings: number | null; formula: string }

const BAND_TONE: Record<string, Tone> = { critical: 'rose', risk: 'amber', watch: 'sky', healthy: 'emerald', unrated: 'slate' }
const BAND_LABEL: Record<string, string> = { critical: 'Critical', risk: 'Risk', watch: 'Watch', healthy: 'Healthy', unrated: 'Unrated' }
const DRIVER_LABEL: Record<string, string> = { reviews: 'Reviews', issues: 'Guest issues', repeats: 'Repeats', upkeep: 'Upkeep', inspection: 'Inspection' }
const money = (n: number | null | undefined) => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US')
const day = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)
  return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}
const ago = (iso: string | null) => {
  if (!iso) return 'never'
  const h = (Date.now() - Date.parse(iso)) / 3600_000
  if (!Number.isFinite(h)) return '—'
  return h < 1 ? 'under an hour ago' : h < 48 ? Math.round(h) + 'h ago' : Math.round(h / 24) + 'd ago'
}

async function getSection<T>(section: string): Promise<T & { ok: boolean; ready?: boolean; missing?: string[]; error?: string }> {
  const r = await fetch('/api/brain/data?section=' + section, { cache: 'no-store' })
  const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }))
  if (!r.ok || !j.ok) throw new Error(j.error || j.message || 'did not load')
  return j
}

export function BrainView() {
  const [tab, setTab] = useState<TabKey>('units')
  const [sum, setSum] = useState<Summary | null>(null)
  const [ready, setReady] = useState<boolean | null>(null)
  const [missing, setMissing] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [units, setUnits] = useState<UnitRow[] | null>(null)
  const [repeats, setRepeats] = useState<RepeatRow[] | null>(null)
  const [owners, setOwners] = useState<{ rows: OwnerRow[]; thin: string; monthsBuilt: string[] } | null>(null)
  const [quality, setQuality] = useState<Quality | null>(null)
  const [loading, setLoading] = useState<string | null>(null)

  const loadSummary = useCallback(async () => {
    setErr(null)
    try {
      const j = await getSection<Summary>('summary')
      if (j.ready === false) { setReady(false); setMissing(j.missing || []); return }
      setReady(true); setSum(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [])

  const load = useCallback(async (k: TabKey, force = false) => {
    if (!force && ((k === 'units' && units) || (k === 'repeats' && repeats) || (k === 'owners' && owners) || (k === 'quality' && quality))) return
    setLoading(k); setErr(null)
    try {
      if (k === 'units') { const j = await getSection<{ rows: UnitRow[] }>('units'); setUnits(j.rows || []) }
      else if (k === 'repeats') { const j = await getSection<{ rows: RepeatRow[] }>('repeats'); setRepeats(j.rows || []) }
      else if (k === 'owners') { const j = await getSection<{ rows: OwnerRow[]; thin: string; monthsBuilt: string[] }>('owners'); setOwners({ rows: j.rows || [], thin: j.thin, monthsBuilt: j.monthsBuilt || [] }) }
      else { const j = await getSection<Quality>('quality'); setQuality(j) }
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(null)
  }, [units, repeats, owners, quality])

  useEffect(() => { loadSummary() }, [loadSummary])
  useEffect(() => { if (ready) load(tab) }, [ready, tab, load])

  const b: Record<string, number> = sum?.bands || {}
  if (ready === false) {
    return (
      <div>
        <LeanHead title="Business brain" icon={<Brain size={22} />} />
        <LeanEmpty>The brain's tables are not there yet — run migration 178. Missing: {missing.join(', ')}</LeanEmpty>
      </div>
    )
  }
  return (
    <div>
      <LeanHead title="Business brain" icon={<Brain size={22} />}
        sub={sum?.day ? 'Health as of ' + day(sum.day) + (sum.partialRows ? ' · ' + sum.partialRows + ' row(s) built on a short read' : '') : 'Loading…'}>
        <Pill tone={b.critical ? 'rose' : 'slate'} title="Apartments scoring under 50" onClick={() => setTab('units')}>{b.critical || 0} critical</Pill>
        <Pill tone={b.risk ? 'amber' : 'slate'} title="Apartments scoring 50–69" onClick={() => setTab('units')}>{b.risk || 0} risk</Pill>
        <Pill tone="violet" title="Unit × system pairs that failed again in the last 90 days" onClick={() => setTab('repeats')}>{sum ? sum.repeatPairs : '…'} repeat</Pill>
        {sum && sum.peopleToConfirm ? <Pill tone="sky" title="People matched by name, waiting for a person to confirm" onClick={() => setTab('quality')}>{sum.peopleToConfirm} to confirm</Pill> : null}
        <IconBtn title="Reload" onClick={() => { loadSummary(); load(tab, true) }}><RefreshCw size={14} /></IconBtn>
      </LeanHead>

      <LeanTabs<TabKey> value={tab} onChange={setTab} tabs={[
        { key: 'units', label: 'Units', n: units ? units.length : null },
        { key: 'repeats', label: 'Repeats', n: sum ? sum.repeatPairs : null },
        { key: 'owners', label: 'Owners', n: owners ? owners.rows.length : null },
        { key: 'quality', label: 'Data', n: sum && sum.peopleToConfirm ? sum.peopleToConfirm : null },
      ]} />

      {err ? <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">{err}</div> : null}
      {loading === tab ? <LeanEmpty>Loading…</LeanEmpty> : null}

      {tab === 'units' && units && loading !== 'units' ? <UnitsTab rows={units} formula={sum?.formula || ''} /> : null}
      {tab === 'repeats' && repeats && loading !== 'repeats' ? <RepeatsTab rows={repeats} /> : null}
      {tab === 'owners' && owners && loading !== 'owners' ? <OwnersTab data={owners} /> : null}
      {tab === 'quality' && quality && loading !== 'quality' ? <QualityTab q={quality} onChanged={() => { loadSummary(); load('quality', true) }} /> : null}
    </div>
  )
}

// ── UNITS ─────────────────────────────────────────────────────────────────────────────────────────
type BandFilter = 'all' | 'critical' | 'risk' | 'watch' | 'healthy' | 'unrated'

function eveLink(r: UnitRow): string {
  const why = r.drivers.map(d => (DRIVER_LABEL[d.key] || d.key) + ': ' + d.why).join('; ')
  const q = 'Unit ' + r.unit + ' (' + r.building + ') scores ' + (r.score == null ? 'unrated' : r.score) + ' on the business-brain health score'
    + (why ? ' — ' + why : '') + (r.repeats.length ? '. Repeat systems: ' + r.repeats.join(', ') : '')
    + '. What is going on with this unit, and should we repair, replace or change how we look after it?'
  return '/eve?q=' + encodeURIComponent(q)
}

function UnitsTab({ rows, formula }: { rows: UnitRow[]; formula: string }) {
  const [band, setBand] = useState<BandFilter>('all')
  const [market, setMarket] = useState<string>('all')
  const [building, setBuilding] = useState<string | null>(null)
  const [owner, setOwner] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(40)
  const markets = useMemo(() => Array.from(new Set(rows.map(r => r.market).filter(Boolean))).sort(), [rows])
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const r of rows) c[r.band] = (c[r.band] || 0) + 1; return c }, [rows])
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(r => (band === 'all' || r.band === band) && (market === 'all' || r.market === market)
      && (!building || r.buildingId === building) && (!owner || r.ownerId === owner)
      && (!needle || (r.unit + ' ' + r.building + ' ' + (r.owner || '')).toLowerCase().indexOf(needle) >= 0))
  }, [rows, band, market, building, owner, q])
  const bName = building ? (rows.find(r => r.buildingId === building)?.building || building) : null
  const oName = owner ? (rows.find(r => r.ownerId === owner)?.owner || owner) : null
  return (
    <div>
      <div className="mb-3 space-y-2">
        <LeanPick<BandFilter> size="sm" value={band} onPick={v => { setBand(v); setShown(40) }} options={[
          { v: 'all', label: 'All ' + rows.length },
          ...(['critical', 'risk', 'watch', 'healthy', 'unrated'] as BandFilter[]).map(k => ({ v: k, label: BAND_LABEL[k] + ' ' + (counts[k] || 0) })),
        ]} />
        {markets.length > 1 ? (
          <LeanPick<string> size="sm" value={market} onPick={v => { setMarket(v); setShown(40) }} options={[{ v: 'all', label: 'Every market' }, ...markets.map(m => ({ v: m, label: m }))]} />
        ) : null}
        <div className="flex items-center gap-1.5 flex-wrap">
          <input value={q} onChange={e => { setQ(e.target.value); setShown(40) }} placeholder="Unit, building or owner"
            className="w-full sm:w-64 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px]" />
          {bName ? <button onClick={() => setBuilding(null)} className="inline-flex items-center gap-1 rounded-md bg-brand-50 text-brand-700 px-2 py-1 text-[11.5px] font-semibold">{bName}<X size={12} /></button> : null}
          {oName ? <button onClick={() => setOwner(null)} className="inline-flex items-center gap-1 rounded-md bg-brand-50 text-brand-700 px-2 py-1 text-[11.5px] font-semibold">{oName}<X size={12} /></button> : null}
        </div>
      </div>
      {!list.length ? <LeanEmpty>No apartment matches.</LeanEmpty> : (
        <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70">
          {list.slice(0, shown).map(r => (
            <li key={r.id} className={r.band === 'critical' ? 'bg-rose-50/40' : ''}>
              <div className="flex items-start gap-2.5 px-3 sm:px-4 py-2.5">
                <Tag tone={BAND_TONE[r.band] || 'slate'} title={BAND_LABEL[r.band] || r.band}>{r.score == null ? '—' : r.score}</Tag>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <a href={'/listings/' + r.listingId} className="text-[13.5px] font-semibold text-ink hover:text-brand-700 truncate max-w-[16rem]">{r.unit}</a>
                    <button onClick={() => setBuilding(r.buildingId)} className="text-[12px] text-muted hover:text-ink" title="Show only this building">{r.building}</button>
                    {r.owner && r.ownerId ? <button onClick={() => setOwner(r.ownerId)} className="text-[12px] text-muted hover:text-ink truncate max-w-[10rem]" title="Show only this owner">· {r.owner}</button> : null}
                    {r.repeats.map(s => <Tag key={s} tone="violet" title="Failed again within 90 days">{s}</Tag>)}
                    {r.partial ? <Tag title="Built on a read that came back short">partial</Tag> : null}
                  </div>
                  {r.drivers.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {r.drivers.map(d => (
                        <li key={d.key} className="text-[12px] text-ink/80">
                          <span className="font-semibold">{DRIVER_LABEL[d.key] || d.key}</span> <span className="text-muted tabular-nums">({Math.round(d.points)})</span> — {d.why}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-1 text-[12px] text-muted">{r.band === 'unrated' ? 'Nothing to judge yet in 90 days.' : 'Nothing took points off.'}</p>}
                  <p className="mt-1 text-[11.5px] text-muted tabular-nums">
                    90 days: upkeep billed {money(r.billed90)} vs net {money(r.net90)}{r.upkeepPct != null ? ' (' + r.upkeepPct + '%)' : ''} · {r.nights} nights · {r.glitches} issue(s)
                    {r.reviewAvg != null ? ' · ' + r.reviewAvg.toFixed(2) + '★ on ' + r.reviewN : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <IconBtn title="Ask Eve about this unit" href={eveLink(r)}><MessageCircle size={14} /></IconBtn>
                  <IconBtn title="Open unit" href={'/listings/' + r.listingId}><ArrowRight size={14} /></IconBtn>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.length > shown ? (
        <button onClick={() => setShown(s => s + 60)} className="mt-2 w-full rounded-xl border border-line bg-white py-2 text-[12.5px] font-semibold text-muted hover:text-ink">Show {Math.min(60, list.length - shown)} more of {list.length - shown}</button>
      ) : null}
      {formula ? <p className="mt-3 text-[11px] text-muted leading-relaxed">{formula}</p> : null}
    </div>
  )
}

// ── REPEATS ───────────────────────────────────────────────────────────────────────────────────────
function RepeatsTab({ rows }: { rows: RepeatRow[] }) {
  if (!rows.length) return <LeanEmpty>No system failed again in the last 90 days.</LeanEmpty>
  return (
    <LeanSection title="Failed again — same part, or back within 30 days of a fix" n={rows.length}>
      <LeanList>
        {rows.map(r => (
          <LeanRow key={r.key} name={r.unit} meta={r.systemLabel}
            tags={<>
              <Tag tone="violet" title="Repeats in the last 90 days">{r.repeats90}× repeat</Tag>
              <Tag title="Every event of this system on this apartment, 180 days">{r.events180} in 180d</Tag>
              {r.billed180 > 0 ? <Tag title="Billed upkeep on these events, 180 days">{money(r.billed180)}</Tag> : null}
            </>}
            actions={<IconBtn title="Open unit" href={'/listings/' + r.listingId}><ArrowRight size={14} /></IconBtn>}>
            <ol className="space-y-1.5">
              {r.events.map(e => (
                <li key={e.id} className="flex items-start gap-2 text-[12px]">
                  <span className="shrink-0 w-16 text-muted tabular-nums">{day(e.openedAt)}</span>
                  <div className="min-w-0 flex-1">
                    <span className="text-ink">{e.title || '(no title)'}</span>
                    <span className="ml-1 inline-flex gap-1 align-middle flex-wrap">
                      {e.repeat ? <Tag tone="violet">repeat</Tag> : null}
                      <Tag>{e.source === 'glitch' ? 'guest issue' : e.source === 'bz_task' ? 'task' : 'work order'}</Tag>
                      {e.open ? <Tag tone="amber">open</Tag> : <Tag tone="emerald">closed {day(e.closedAt)}</Tag>}
                      {e.billed ? <Tag>{money(e.billed)}</Tag> : null}
                      {e.who ? <Tag>{e.who}</Tag> : null}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </LeanRow>
        ))}
      </LeanList>
    </LeanSection>
  )
}

// ── OWNERS ────────────────────────────────────────────────────────────────────────────────────────
function OwnersTab({ data }: { data: { rows: OwnerRow[]; thin: string; monthsBuilt: string[] } }) {
  const [span, setSpan] = useState<'m3' | 'm12'>('m3')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(40)
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return data.rows.filter(r => !needle || r.name.toLowerCase().indexOf(needle) >= 0).slice().sort((a, b) => b[span].net - a[span].net)
  }, [data.rows, q, span])
  const short12 = data.monthsBuilt.length < 12
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <LeanPick<'m3' | 'm12'> size="sm" value={span} onPick={setSpan} options={[{ v: 'm3', label: 'Last 3 months' }, { v: 'm12', label: 'Last 12 months' }]} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Owner" className="w-full sm:w-56 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px]" />
      </div>
      <p className="mb-2 text-[11.5px] text-muted"><Tag tone="amber">thin</Tag> {data.thin}{span === 'm12' && short12 ? ' Only ' + data.monthsBuilt.length + ' month(s) built so far.' : ''}</p>
      {!rows.length ? <LeanEmpty>No owner months built yet.</LeanEmpty> : (
        <LeanList>
          {rows.slice(0, shown).map(r => {
            const f = r[span]
            return (
              <LeanRow key={r.ownerId} name={r.name} meta={f.units + ' unit' + (f.units === 1 ? '' : 's')}
                tags={<>
                  <Tag title="Guest nights ÷ sellable nights (owner nights left out)">{f.occupancy == null ? '—' : Math.round(f.occupancy) + '% occ'}</Tag>
                  <Tag tone="brand" title="Net accommodation">{money(f.net)}</Tag>
                  {f.billed > 0 ? <Tag title="Upkeep billed to these units">{money(f.billed)} billed</Tag> : null}
                  {f.issues > 0 ? <Tag tone={f.repeats > 0 ? 'amber' : 'slate'} title="Guest issues (repeat failures)">{f.issues} issue{f.issues === 1 ? '' : 's'}{f.repeats ? ' · ' + f.repeats + ' rep' : ''}</Tag> : null}
                  {f.reviewAvg != null ? <Tag title={'Review average on ' + f.reviewN + ' review(s)'}>{f.reviewAvg.toFixed(2)}★</Tag> : null}
                </>}>
                <p className="text-[12px] text-muted tabular-nums">
                  {f.nights} guest night(s) · {f.ownerNights} owner night(s) · {f.events} maintenance event(s) · {f.months} month(s) of data
                </p>
              </LeanRow>
            )
          })}
        </LeanList>
      )}
      {rows.length > shown ? (
        <button onClick={() => setShown(s => s + 60)} className="mt-2 w-full rounded-xl border border-line bg-white py-2 text-[12.5px] font-semibold text-muted hover:text-ink">Show more ({rows.length - shown})</button>
      ) : null}
    </div>
  )
}

// ── DATA QUALITY ──────────────────────────────────────────────────────────────────────────────────
function QualityTab({ q, onChanged }: { q: Quality; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const act = async (p: Person, action: 'confirm' | 'reject') => {
    setBusy(p.id); setMsg(null)
    try {
      const r = await fetch('/api/brain/person', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personId: p.id, action }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || j.message || 'did not save')
      setDone(d => ({ ...d, [p.id]: action === 'confirm' ? 'Confirmed' : 'Kept apart' }))
    } catch (e: any) { setMsg(p.name + ': ' + String(e?.message || e)) }
    setBusy(null)
  }
  const open = q.people.filter(p => !done[p.id])
  return (
    <div>
      <LeanSection title="Table freshness" n={q.fresh.length}>
        <LeanList>
          {q.fresh.map(t => {
            const stale = !t.lastBuiltAt || Date.now() - Date.parse(t.lastBuiltAt) > 36 * 3600_000
            return (
              <LeanRow key={t.table} name={t.table} meta={(t.rows == null ? '—' : t.rows.toLocaleString('en-US')) + ' rows'}
                tags={<Tag tone={stale ? 'amber' : 'emerald'} title={t.lastBuiltAt || 'never built'}>{ago(t.lastBuiltAt)}</Tag>} />
            )
          })}
          {q.missing.map(t => <LeanRow key={t} name={t} tags={<Tag tone="amber">missing</Tag>} />)}
        </LeanList>
      </LeanSection>

      <LeanSection title="People to confirm" n={open.length} right={Object.keys(done).length ? <button onClick={onChanged} className="text-brand-700">Refresh</button> : null}>
        {msg ? <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">{msg}</div> : null}
        {!q.people.length ? <LeanEmpty>Everyone matched by name has been confirmed.</LeanEmpty> : (
          <LeanList>
            {q.people.map(p => (
              <LeanRow key={p.id} name={p.name} meta={[p.dept, p.email].filter(Boolean).join(' · ')}
                tags={<>
                  {p.sources.map(s => <Tag key={s}>{s}</Tag>)}
                  {done[p.id] ? <Tag tone="emerald">{done[p.id]}</Tag> : null}
                </>}
                actions={done[p.id] ? null : <>
                  <IconBtn title="Confirm — the same person in every source" tone="ok" disabled={busy === p.id} onClick={() => act(p, 'confirm')}><Check size={14} /></IconBtn>
                  {p.sources.length > 1 ? <IconBtn title="Not the same person — keep these sources apart" tone="bad" disabled={busy === p.id} onClick={() => act(p, 'reject')}><X size={14} /></IconBtn> : null}
                </>}>
                <p className="text-[12px] text-muted">Breezeway {p.breezewayId || '—'} · Homebase {p.homebaseId || '—'} · key {p.id}</p>
              </LeanRow>
            ))}
          </LeanList>
        )}
        {q.peopleShort ? <p className="mt-1 text-[11.5px] text-muted">The list was cut at 2,000 people.</p> : null}
      </LeanSection>

      <LeanSection title="Gaps in the spine">
        <LeanList>
          <LeanRow name="Unknown buildings" meta="a listing resolved to a building the registry (lib/segments) does not carry"
            tags={<Tag tone={q.unknownBuildings.length ? 'amber' : 'emerald'}>{q.unknownBuildings.length}</Tag>}>
            {q.unknownBuildings.length ? <ul className="text-[12px] text-ink/80 space-y-0.5">{q.unknownBuildings.map(b => <li key={b.id}>{b.label} <span className="text-muted">· {b.units} unit(s)</span></li>)}</ul> : <p className="text-[12px] text-muted">None.</p>}
          </LeanRow>
          <LeanRow name="No Breezeway home" meta="live listings Breezeway does not hold (vendor buildings cleaned from Guesty are expected here)"
            tags={<Tag tone={q.noHome.length ? 'amber' : 'emerald'}>{q.noHome.length}</Tag>}>
            <LiteList rows={q.noHome} />
          </LeanRow>
          <LeanRow name="No owner" meta="live listings no Guesty owner statement claims"
            tags={<Tag tone={q.noOwner.length ? 'amber' : 'emerald'}>{q.noOwner.length}</Tag>}>
            <LiteList rows={q.noOwner} />
          </LeanRow>
          <LeanRow name="Vendor matches to confirm" meta="Breezeway names and invoice spellings matched to a vendor by name"
            tags={<Tag tone={q.vendorsToConfirm ? 'sky' : 'emerald'}>{q.vendorsToConfirm == null ? '—' : q.vendorsToConfirm}</Tag>} />
        </LeanList>
      </LeanSection>

      <LeanSection title={'Maintenance still filed as “other” — top titles, 180 days'} n={q.otherEvents}>
        {!q.topOther.length ? <LeanEmpty>Nothing filed as other.</LeanEmpty> : (
          <LeanList>
            {q.topOther.map(t => <LeanRow key={t.title} name={t.title} tags={<Tag>{t.n}×</Tag>} />)}
          </LeanList>
        )}
      </LeanSection>
    </div>
  )
}

function LiteList({ rows }: { rows: Lite[] }) {
  if (!rows.length) return <p className="text-[12px] text-muted">None.</p>
  return (
    <ul className="text-[12px] space-y-0.5">
      {rows.map(r => <li key={r.listingId}><a href={'/listings/' + r.listingId} className="text-ink hover:text-brand-700">{r.unit}</a> <span className="text-muted">· {r.building}</span></li>)}
    </ul>
  )
}
