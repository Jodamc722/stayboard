'use client'
// Admin console — STAFFING & AGENCIES. Two tables and one export.
//
// Homebase owns the punches; this owns the two things it cannot know — which agency a person is
// contracted through, and the role/area WE call them. The roster dropdown is fed live from
// Homebase (last 30 days of punches + today's schedule), so you assign real people rather than
// re-typing names that then fail to match at invoice time.
//
// Fees attach per agency and stack: % of wages, $ per hour, and a flat amount per invoice. Each
// defaults to 0, so nothing is ever billed at a rate nobody chose.
import { useCallback, useEffect, useState } from 'react'
import { Users2, Loader2, Check, AlertTriangle, Save, Download, Plus, Building2, Wand2 } from 'lucide-react'

type Agency = { key: string; label: string; fee_percent: number; fee_per_hour: number; fee_flat: number; active: boolean; notes?: string | null; sort?: number }
type Staff = { name: string; agency: string | null; role: string | null; area: string | null; active: boolean }
type RosterPerson = {
  name: string; wageRate: number | null; role: string | null; days: number
  department?: string | null; active?: boolean; agencyHint?: string | null
  source?: 'homebase' | 'punches'
}
type Vendor = { key: string; label: string; buildings: string[]; billing: string | null; contact: string | null; notes: string | null; active: boolean; sort: number }
type Diag = { locations: number; fromEmployeeList: number; punchesOnly: number; inactive: number; withAgencyHint: number }

const AREAS = ['', 'miami', 'broward', 'north', 'vendor']
const ROLES = ['', 'Housekeeper', 'Maintenance', 'Handyman', 'Supervisor', 'Inspector', 'Front desk', 'Office']
const money = (n: number) => '$' + (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const daysAgoISO = (n: number) => new Date(Date.now() - n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

export function StaffingAdmin({ isOwner }: { isOwner: boolean }) {
  const [agencies, setAgencies] = useState<Agency[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [roster, setRoster] = useState<RosterPerson[]>([])
  const [diag, setDiag] = useState<Diag | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const [from, setFrom] = useState(daysAgoISO(6))
  const [to, setTo] = useState(todayISO())
  const [preview, setPreview] = useState<any>(null)

  const load = useCallback(async () => {
    setBusy('load')
    try {
      const r = await fetch('/api/settings/staffing', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'load failed')
      setAgencies(j.agencies || []); setStaff(j.staff || []); setVendors(j.vendors || []); setRoster(j.roster || []); setDiag(j.diag || null)
    } catch (e: any) { setMsg({ tone: 'bad', text: String(e.message || e) }) }
    finally { setBusy(null) }
  }, [])
  useEffect(() => { load() }, [load])

  const save = async () => {
    setBusy('save'); setMsg(null)
    try {
      const r = await fetch('/api/settings/staffing', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agencies, staff, vendors }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error((j.errors || []).join('; ') || j.error || 'save failed')
      setAgencies(j.agencies || agencies); setStaff(j.staff || staff); setVendors(j.vendors || vendors)
      setMsg({ tone: 'ok', text: `Saved ${j.saved} record${j.saved === 1 ? '' : 's'}.` })
    } catch (e: any) { setMsg({ tone: 'bad', text: String(e.message || e) }) }
    finally { setBusy(null) }
  }

  const autofill = async () => {
    setBusy('autofill'); setMsg(null)
    try {
      const r = await fetch('/api/settings/staffing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 60 }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'auto-fill failed')
      setAgencies(j.agencies || agencies); setStaff(j.staff || staff)
      setRoster(j.roster || roster); setDiag(j.diag || diag)
      const added = (j.changed || []).filter((c: any) => c.added).length
      const upd = (j.changed || []).length - added
      const ag = Number(j.matchedAgency || 0)
      setMsg({ tone: 'ok', text: `Auto-filled: ${added} added, ${upd} updated`
        + (ag ? `, ${ag} matched to an agency from their Homebase name.` : '. No agency names found in Homebase — set those below.') })
    } catch (e: any) { setMsg({ tone: 'bad', text: String(e.message || e) }) }
    finally { setBusy(null) }
  }

  const runPreview = async () => {
    setBusy('preview'); setMsg(null); setPreview(null)
    try {
      const r = await fetch(`/api/labor/agency-invoice?from=${from}&to=${to}`, { cache: 'no-store' })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'preview failed')
      setPreview(j)
    } catch (e: any) { setMsg({ tone: 'bad', text: String(e.message || e) }) }
    finally { setBusy(null) }
  }

  const setAg = (i: number, patch: Partial<Agency>) => setAgencies(a => a.map((x, n) => n === i ? { ...x, ...patch } : x))
  const setSt = (i: number, patch: Partial<Staff>) => setStaff(s => s.map((x, n) => n === i ? { ...x, ...patch } : x))

  const addAgency = () => {
    const key = prompt('Agency short key (letters only, e.g. "opal")')?.trim().toLowerCase()
    if (!key) return
    if (agencies.some(a => a.key === key)) { setMsg({ tone: 'bad', text: 'That agency already exists.' }); return }
    setAgencies(a => [...a, { key, label: key, fee_percent: 0, fee_per_hour: 0, fee_flat: 0, active: true, sort: 100 }])
  }
  // Anyone Homebase knows who has no staff row yet — the gap that makes an invoice come up short.
  const unassignedRoster = roster.filter(p => !staff.some(s => s.name.toLowerCase() === p.name.toLowerCase()))
  const addFromRoster = (name: string) => {
    if (!name || staff.some(s => s.name.toLowerCase() === name.toLowerCase())) return
    const p = roster.find(r => r.name.toLowerCase() === name.toLowerCase())
    setStaff(s => [...s, {
      name, agency: p?.agencyHint || null, role: null, area: null, active: p?.active !== false,
    }].sort((a, b) => a.name.localeCompare(b.name)))
  }
  // Jon 2026-08-08: "make sure you pull all employees, Aljenador is someone I don't see." Everyone
  // Homebase knows now gets a visible row — people without a staff record show as a ghost row that
  // is one click from real, so a missing person is obvious instead of buried in a dropdown.
  const addAllFromRoster = () => {
    const missing = unassignedRoster
    if (!missing.length) return
    setStaff(s => [...s, ...missing.map(p => ({
      name: p.name, agency: p.agencyHint || null, role: null, area: null, active: p.active !== false,
    }))].sort((a, b) => a.name.localeCompare(b.name)))
    setMsg({ tone: 'ok', text: `Added ${missing.length} from Homebase — press Save to keep them.` })
  }

  // Rate comes from Homebase (never stored here). Agency cost is what that hour actually costs
  // once the agency's markup is on top — the number that matters when deciding who to send.
  // A flat per-invoice fee is deliberately NOT amortised into an hourly figure; it is not hourly.
  const rateOf = (name: string): number | null => {
    const p = roster.find(r => r.name.toLowerCase() === name.toLowerCase())
    return p && p.wageRate != null ? p.wageRate : null
  }
  const loadedCost = (name: string, agencyKey: string | null): number | null => {
    const w = rateOf(name); if (w == null) return null
    const a = agencies.find(x => x.key === agencyKey)
    if (!a) return w
    return Math.round((w * (1 + (Number(a.fee_percent) || 0) / 100) + (Number(a.fee_per_hour) || 0)) * 100) / 100
  }

  const dis = !isOwner || !!busy

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-muted flex items-start gap-1.5">
        <Users2 size={13} className="mt-0.5 shrink-0" />
        Hours always come live from Homebase punches — fix a punch there and re-run, nothing to re-sync here.
        This page only stores which agency someone works for and what that agency charges on top.
      </p>

      {/* ---------------- agencies ---------------- */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="text-[12px] font-semibold text-ink inline-flex items-center gap-1.5"><Building2 size={13} /> Agencies & fees</h4>
          <button onClick={addAgency} disabled={dis} className="text-[11px] font-semibold text-brand-700 hover:text-brand-800 inline-flex items-center gap-1 disabled:opacity-50"><Plus size={12} /> Add agency</button>
        </div>
        {/* A w-full table inside a scroller shrinks to the phone instead of scrolling: the three
            number inputs were being crushed to a single digit. min-w makes it scroll properly. */}
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-[12px] min-w-[600px]">
            <thead className="bg-app text-muted">
              <tr>
                {['Agency', 'Markup %', '$ / hour', 'Flat / invoice', 'Active'].map(h => (
                  <th key={h} className="text-left font-semibold px-2.5 py-1.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {agencies.map((a, i) => (
                <tr key={a.key}>
                  <td className="px-2.5 py-1.5">
                    <input value={a.label} onChange={e => setAg(i, { label: e.target.value })} disabled={dis}
                      className="w-full bg-transparent border border-line rounded-md px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />
                    <span className="text-[10px] text-muted">{a.key}</span>
                  </td>
                  {(['fee_percent', 'fee_per_hour', 'fee_flat'] as const).map(f => (
                    <td key={f} className="px-2.5 py-1.5">
                      <input type="number" step="0.01" min="0" value={a[f]} disabled={dis}
                        onChange={e => setAg(i, { [f]: Number(e.target.value) || 0 } as any)}
                        className="w-24 bg-transparent border border-line rounded-md px-1.5 py-1 tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />
                    </td>
                  ))}
                  <td className="px-2.5 py-1.5">
                    <input type="checkbox" checked={a.active} disabled={dis} onChange={e => setAg(i, { active: e.target.checked })} />
                  </td>
                </tr>
              ))}
              {!agencies.length && <tr><td colSpan={5} className="px-2.5 py-4 text-center text-muted">No agencies yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------------- vendors ---------------- */}
      {/* VENDOR COMPANIES (Jon, 2026-09-01: "an option to add different vendors"). A vendor is an
          outside company that runs its own crew in buildings we manage. The buildings named here
          feed the same vendor classification everything already uses (lib/ops-presets merges this
          registry into vendorBuildings) — so adding a vendor here is all it takes for its
          buildings to leave cost-per-clean and land in the vendor bucket. */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="text-[12px] font-semibold text-ink inline-flex items-center gap-1.5"><Building2 size={13} /> Vendors</h4>
          <button onClick={() => {
            const label = window.prompt('Vendor company name (e.g. "Opal Works")')?.trim()
            if (!label) return
            const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
            if (vendors.some(v => v.key === key)) { setMsg({ tone: 'bad', text: 'That vendor already exists.' }); return }
            setVendors(v => [...v, { key, label, buildings: [], billing: null, contact: null, notes: null, active: true, sort: 100 }])
          }} disabled={dis} className="text-[11px] font-semibold text-brand-700 hover:text-brand-800 inline-flex items-center gap-1 disabled:opacity-50"><Plus size={12} /> Add vendor</button>
        </div>
        {vendors.length ? (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-[12px] min-w-[640px]">
              <thead className="bg-app text-muted">
                <tr>{['Vendor', 'Buildings they cover', 'How they bill', 'Active'].map(h => (
                  <th key={h} className="text-left font-semibold px-2.5 py-1.5 whitespace-nowrap">{h}</th>))}</tr>
              </thead>
              <tbody>
                {vendors.map((v, i) => (
                  <tr key={v.key} className="border-t border-line">
                    <td className="px-2.5 py-1.5 font-semibold whitespace-nowrap">{v.label}</td>
                    <td className="px-2.5 py-1.5">
                      <input value={v.buildings.join(', ')} disabled={dis}
                        onChange={e => setVendors(vs => vs.map((x, j) => j === i ? { ...x, buildings: e.target.value.split(',').map(b => b.trim()).filter(Boolean) } : x))}
                        placeholder="Botanica, 17WEST — comma-separated, the building names as the app knows them"
                        className="w-full rounded-lg border border-line px-2 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <input value={v.billing || ''} disabled={dis}
                        onChange={e => setVendors(vs => vs.map((x, j) => j === i ? { ...x, billing: e.target.value || null } : x))}
                        placeholder="per clean · monthly invoice…"
                        className="w-40 rounded-lg border border-line px-2 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <input type="checkbox" checked={v.active} disabled={dis}
                        onChange={e => setVendors(vs => vs.map((x, j) => j === i ? { ...x, active: e.target.checked } : x))}
                        className="accent-brand-600" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[11.5px] text-muted rounded-xl border border-dashed border-line px-3 py-2.5">
            No vendors yet. Add the companies whose own crews clean buildings we manage — their buildings then count as vendor-cleaned everywhere, automatically.
          </p>
        )}
      </div>

      {/* ---------------- staff ---------------- */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <h4 className="text-[12px] font-semibold text-ink">Staff</h4>
            <button onClick={autofill} disabled={dis}
              className="text-[11px] font-semibold text-brand-700 hover:text-brand-800 inline-flex items-center gap-1 disabled:opacity-50"
              title="Create a row for everyone Homebase knows, with role and area worked out from their Breezeway history. Never overwrites what you set by hand.">
              {busy === 'autofill' ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Auto-fill roles &amp; areas
            </button>
          </div>
          {unassignedRoster.length > 0 && (
            <button onClick={addAllFromRoster} disabled={dis}
              className="text-[11px] font-semibold text-brand-700 hover:text-brand-800 inline-flex items-center gap-1 disabled:opacity-50"
              title="Create a staff row for every Homebase employee not yet listed here.">
              <Plus size={12} /> Add all {unassignedRoster.length} from Homebase
            </button>
          )}
        </div>
        {diag && (
          <p className="text-[11px] text-muted mb-1.5">
            Homebase: <b className="text-ink">{roster.length}</b> people across{' '}
            <b className="text-ink">{diag.locations}</b> location{diag.locations === 1 ? '' : 's'}
            {diag.punchesOnly > 0 && <> · {diag.punchesOnly} seen only on punches, not on the employee list</>}
            {diag.inactive > 0 && <> · {diag.inactive} archived</>}
            {diag.withAgencyHint > 0 && <> · {diag.withAgencyHint} with an agency in their Homebase name</>}
            {diag.locations === 0 && <span className="text-amber-700"> — could not reach Homebase; check the API key.</span>}
          </p>
        )}
        {/* Seven columns of selects and rates. min-w so they keep their widths and the box scrolls;
            z-10 on the sticky head so rows do not show through it while you scroll. */}
        <div className="overflow-x-auto rounded-xl border border-line max-h-[420px] overflow-y-auto">
          <table className="w-full text-[12px] min-w-[820px]">
            <thead className="bg-app text-muted sticky top-0 z-10">
              <tr>{['Name', 'Agency', 'Role', 'Area', 'Rate/hr', 'Agency cost/hr', 'Active'].map(h => (
                <th key={h} className="text-left font-semibold px-2.5 py-1.5 whitespace-nowrap">{h}</th>))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {staff.map((s, i) => (
                <tr key={s.name}>
                  <td className="px-2.5 py-1.5 font-medium text-ink whitespace-nowrap">{s.name}</td>
                  <td className="px-2.5 py-1.5">
                    <select value={s.agency || ''} disabled={dis} onChange={e => setSt(i, { agency: e.target.value || null })}
                      className="bg-transparent border border-line rounded-md px-1.5 py-1 disabled:opacity-60">
                      <option value="">In-house</option>
                      {agencies.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                    </select>
                  </td>
                  <td className="px-2.5 py-1.5">
                    <select value={s.role || ''} disabled={dis} onChange={e => setSt(i, { role: e.target.value || null })}
                      className="bg-transparent border border-line rounded-md px-1.5 py-1 disabled:opacity-60">
                      {ROLES.map(r => <option key={r} value={r}>{r || '—'}</option>)}
                    </select>
                  </td>
                  <td className="px-2.5 py-1.5">
                    <select value={s.area || ''} disabled={dis} onChange={e => setSt(i, { area: e.target.value || null })}
                      className="bg-transparent border border-line rounded-md px-1.5 py-1 disabled:opacity-60">
                      {AREAS.map(r => <option key={r} value={r}>{r || '—'}</option>)}
                    </select>
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-muted whitespace-nowrap">
                    {rateOf(s.name) == null ? <span title="No Homebase punch in the last 30 days">—</span> : money(rateOf(s.name) as number)}
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap">
                    {(() => {
                      const w = rateOf(s.name), c = loadedCost(s.name, s.agency)
                      if (c == null) return <span className="text-muted">—</span>
                      const up = w != null && c > w
                      return <span className={up ? 'text-amber-700 font-semibold' : 'text-ink'}>{money(c)}</span>
                    })()}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <input type="checkbox" checked={s.active} disabled={dis} onChange={e => setSt(i, { active: e.target.checked })} />
                  </td>
                </tr>
              ))}
              {/* Homebase people with no staff row yet — visible, greyed, one click from real. */}
              {unassignedRoster.map(p => (
                <tr key={'ghost:' + p.name} className="bg-app/40">
                  <td className="px-2.5 py-1.5 text-muted whitespace-nowrap">
                    {p.name}
                    {p.active === false && <span className="ml-1 text-[10px] text-muted">(archived)</span>}
                  </td>
                  <td className="px-2.5 py-1.5 text-[11px] text-muted">
                    {p.agencyHint ? (agencies.find(a => a.key === p.agencyHint)?.label || p.agencyHint) : '—'}
                  </td>
                  <td className="px-2.5 py-1.5 text-[11px] text-muted">{p.role || '—'}</td>
                  <td className="px-2.5 py-1.5 text-[11px] text-muted">—</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-muted whitespace-nowrap">
                    {p.wageRate == null ? '—' : money(p.wageRate)}
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-muted whitespace-nowrap">—</td>
                  <td className="px-2.5 py-1.5">
                    <button onClick={() => addFromRoster(p.name)} disabled={dis}
                      className="text-[11px] font-semibold text-brand-700 hover:text-brand-800 disabled:opacity-50">Add</button>
                  </td>
                </tr>
              ))}
              {!staff.length && !unassignedRoster.length && (
                <tr><td colSpan={7} className="px-2.5 py-4 text-center text-muted">
                  No Homebase employees came back — check the API key and location access.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------------- invoice ---------------- */}
      <div className="rounded-xl border border-line p-3">
        <h4 className="text-[12px] font-semibold text-ink mb-2">Agency hours & invoice</h4>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-muted">From
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="block bg-app border border-line rounded-lg px-2 py-1 text-[12px] text-ink" /></label>
          <label className="text-[11px] text-muted">To
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="block bg-app border border-line rounded-lg px-2 py-1 text-[12px] text-ink" /></label>
          <button onClick={runPreview} disabled={!!busy}
            className="rounded-lg bg-brand-600 text-white text-[12px] font-semibold px-3 py-1.5 disabled:opacity-60">
            {busy === 'preview' ? <Loader2 size={13} className="animate-spin inline" /> : 'Preview'}
          </button>
          <a href={`/api/labor/agency-invoice?from=${from}&to=${to}&format=csv`}
            className="rounded-lg border border-line text-[12px] font-semibold px-3 py-1.5 text-muted hover:text-ink inline-flex items-center gap-1">
            <Download size={13} /> CSV
          </a>
        </div>

        {preview && (
          <div className="mt-3 space-y-2">
            {(preview.agencies || []).map((a: any) => (
              <div key={a.agency} className="rounded-lg border border-line overflow-hidden">
                <div className="px-2.5 py-1.5 bg-app flex items-center justify-between">
                  <b className="text-[12px] text-ink">{a.label}</b>
                  <span className="text-[12px] tabular-nums text-ink"><b>{money(a.total)}</b> <span className="text-muted">· {a.hours}h</span></span>
                </div>
                <div className="px-2.5 py-1.5 text-[11px] text-muted">
                  Wages {money(a.base)}
                  {a.feePercentAmt ? ` + ${a.rates.percent}% ${money(a.feePercentAmt)}` : ''}
                  {a.feePerHourAmt ? ` + $${a.rates.perHour}/hr ${money(a.feePerHourAmt)}` : ''}
                  {a.feeFlatAmt ? ` + flat ${money(a.feeFlatAmt)}` : ''}
                </div>
                <table className="w-full text-[11px]">
                  <tbody className="divide-y divide-line">
                    {a.people.map((p: any) => (
                      <tr key={p.name}>
                        <td className="px-2.5 py-1">{p.name}<span className="text-muted"> · {p.role || '—'}</span></td>
                        <td className="px-2.5 py-1 text-right tabular-nums text-muted">{p.days}d</td>
                        <td className="px-2.5 py-1 text-right tabular-nums">{p.hours}h</td>
                        <td className="px-2.5 py-1 text-right tabular-nums">{money(p.base)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {!preview.agencies?.length && <p className="text-[12px] text-muted">No agency-assigned punches in that range.</p>}
            {preview.unassigned?.hours > 0 && (
              <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {preview.unassigned.hours}h ({money(preview.unassigned.base)}) from {preview.unassigned.people.length} people with no agency set — assign them above, or they are in-house.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={dis}
          className="rounded-lg bg-brand-600 text-white text-[12px] font-semibold px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-60">
          {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
        </button>
        {msg && (
          <span className={`text-[12px] inline-flex items-center gap-1 ${msg.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>
            {msg.tone === 'ok' ? <Check size={13} /> : <AlertTriangle size={13} />} {msg.text}
          </span>
        )}
        {!isOwner && <span className="text-[11px] text-muted">Owner/admin only.</span>}
      </div>
    </div>
  )
}
