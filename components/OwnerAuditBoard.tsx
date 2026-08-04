'use client'
// OWNER STATEMENT AUDIT BOARD — one board, two homes: the internal /owner-audit page and the
// reviewer-facing /report/owner-audit share link (its own password). This replaces the monthly
// Google-Sheet download / edit / re-download cycle: the audit is computed live from the
// generated statements, and the review state (status, notes, comments) saves in place.
//
// Statuses are deliberately simple: Needs review -> Action needed -> Completed. Flagged rows
// start at Needs review; clean rows start Completed so the reviewer only touches exceptions.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Download, ExternalLink,
  Lock, MessageSquare, RefreshCw, Search, ShieldAlert,
} from 'lucide-react'

type FlagType = 'negative' | 'low_rate' | 'orphan_reimb' | 'refund' | 'zero_rev' | 'passthru' | 'no_reservation'
type Severity = 'high' | 'review' | 'info'
type Status = 'review' | 'action' | 'done'
type Flag = { type: FlagType; severity: Severity; detail: string; amount?: number }
type Line = { date: string; label: string; code: string; amount: number }
type Comment = { author: string; body: string; at: string }
type Item = {
  key: string; kind: 'reservation' | 'line'; ownerId: string; resCode: string
  guest: string; checkIn: string; checkOut: string
  totalNights: number; monthNights: number; splitMonth: boolean
  listingId: string; unit: string; source: string; reservationId: string
  rental: number; commission: number; other: number; net: number; rate: number | null
  lines: Line[]; flags: Flag[]
  status: Status; touched: boolean; note: string; comments: Comment[]
  updatedBy: string | null; updatedAt: string | null
}
type Owner = {
  ownerId: string; ownerName: string; hasStatement: boolean; dueToOwner: number | null
  rental: number; commission: number; other: number; net: number; paid: number
  ties: boolean; items: number; open: number
}
type MonthPick = { m: string; label: string; statements: number }
type Data = {
  month: string; label: string; owners: Owner[]; items: Item[]
  totals: {
    owners: number; statements: number; reservations: number; flagged: number; high: number
    review: number; action: number; done: number
    rental: number; commission: number; net: number; paid: number; dueToOwner: number
  }
  coverage: { ready: boolean; missing: string[] }
}

const FLAG_LABEL: Record<FlagType, string> = {
  negative: 'Negative', low_rate: 'Low rate', orphan_reimb: 'Orphan reimb',
  refund: 'Refund', zero_rev: '$0 revenue', passthru: 'Pass-through', no_reservation: 'No res match',
}
const FLAG_CLS: Record<Severity, string> = {
  high: 'bg-rose-50 text-rose-700 ring-rose-200',
  review: 'bg-amber-50 text-amber-700 ring-amber-200',
  info: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
}
const STATUS_LABEL: Record<Status, string> = { review: 'Needs review', action: 'Action needed', done: 'Completed' }
const STATUS_CLS: Record<Status, string> = {
  review: 'bg-amber-50 text-amber-700 ring-amber-200',
  action: 'bg-rose-50 text-rose-700 ring-rose-200',
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
}

const fmt = (n: number) => {
  const sign = n < 0 ? '-' : ''
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const fmt0 = (n: number) => {
  const sign = n < 0 ? '-' : ''
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
const dateShort = (d: string) => {
  if (!d) return ''
  const t = new Date(d + 'T00:00:00Z')
  return isNaN(t.getTime()) ? d : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
const gyUrl = (id: string) => 'https://app.guesty.com/reservations/' + id + '/summary'

function worstOf(it: Item): Severity | null {
  if (it.flags.some(f => f.severity === 'high')) return 'high'
  if (it.flags.some(f => f.severity === 'review')) return 'review'
  if (it.flags.length) return 'info'
  return null
}

export function OwnerAuditBoard({ share }: { share?: boolean }) {
  const [months, setMonths] = useState<MonthPick[]>([])
  const [month, setMonth] = useState('')
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [needsPw, setNeedsPw] = useState(false)
  const [pw, setPw] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  const [q, setQ] = useState('')
  const [fStatus, setFStatus] = useState<'' | Status>('')
  const [fFlag, setFFlag] = useState<'' | 'flagged' | FlagType>('')
  const [fOwner, setFOwner] = useState('')
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({})
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})           // note drafts
  const [cDrafts, setCDrafts] = useState<Record<string, string>>({})         // comment drafts
  const [savingKey, setSavingKey] = useState('')
  const [me, setMe] = useState('')                                           // share-mode display name

  useEffect(() => {
    if (share) { try { setMe(localStorage.getItem('oa_name') || '') } catch { /* private mode */ } }
  }, [share])

  const load = useCallback(async (m?: string) => {
    setLoading(true); setError('')
    try {
      const r = await fetch('/api/owner-audit' + (m ? '?month=' + m : ''), { cache: 'no-store' })
      const j = await r.json()
      if (r.status === 401 || j.needsPassword) { setNeedsPw(true); setLoading(false); return }
      if (!j.ok) { setError(j.error || 'Could not load the audit'); setLoading(false); return }
      setNeedsPw(false)
      setMonths(j.months || [])
      setData(j.data || null)
      setMonth(j.data ? j.data.month : (m || ''))
      setOpenItems({})
    } catch (e: any) {
      setError(String(e?.message || e))
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const unlock = async () => {
    setPwBusy(true); setPwErr('')
    try {
      const r = await fetch('/api/public/owner-audit-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setPwErr(j.error || 'Wrong password'); setPwBusy(false); return }
      setPw(''); setPwBusy(false)
      load()
    } catch (e: any) { setPwErr(String(e?.message || e)); setPwBusy(false) }
  }

  const patchItem = (it: Item, patch: Partial<Item>) => {
    setData(d => {
      if (!d) return d
      const items = d.items.map(x => (x.ownerId === it.ownerId && x.key === it.key) ? { ...x, ...patch } : x)
      const owners = d.owners.map(o => {
        if (o.ownerId !== it.ownerId) return o
        const open = items.filter(x => x.ownerId === o.ownerId && x.status !== 'done').length
        return { ...o, open }
      })
      const totals = {
        ...d.totals,
        review: items.filter(x => x.status === 'review').length,
        action: items.filter(x => x.status === 'action').length,
        done: items.filter(x => x.status === 'done').length,
      }
      return { ...d, items, owners, totals }
    })
  }

  const save = async (it: Item, body: Record<string, any>) => {
    if (!data) return
    const key = it.ownerId + '|' + it.key
    setSavingKey(key)
    try {
      const r = await fetch('/api/owner-audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: data.month, ownerId: it.ownerId, itemKey: it.key, ...body }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) { setError(j.error || 'Save failed'); setSavingKey(''); return }
      patchItem(it, { status: j.status, note: j.note, comments: j.comments || it.comments, touched: true, updatedBy: j.updatedBy, updatedAt: j.updatedAt })
    } catch (e: any) { setError(String(e?.message || e)) }
    setSavingKey('')
  }

  const setStatus = (it: Item, s: Status) => { patchItem(it, { status: s, touched: true }); save(it, { status: s }) }

  const saveNote = (it: Item) => {
    const k = it.ownerId + '|' + it.key
    const v = drafts[k]
    if (v === undefined || v === it.note) return
    save(it, { note: v })
  }

  const addComment = (it: Item) => {
    const k = it.ownerId + '|' + it.key
    const v = (cDrafts[k] || '').trim()
    if (!v) return
    if (share && me.trim()) { try { localStorage.setItem('oa_name', me.trim()) } catch { /* private mode */ } }
    setCDrafts(prev => ({ ...prev, [k]: '' }))
    save(it, { comment: { body: v, author: me.trim() || 'reviewer' } })
  }

  const ownerName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const o of (data?.owners || [])) m[o.ownerId] = o.ownerName
    return m
  }, [data])

  const filtered = useMemo(() => {
    if (!data) return [] as Item[]
    const needle = q.trim().toLowerCase()
    return data.items.filter(it => {
      if (fOwner && it.ownerId !== fOwner) return false
      if (fStatus && it.status !== fStatus) return false
      if (fFlag === 'flagged' && !it.flags.some(f => f.severity !== 'info')) return false
      if (fFlag && fFlag !== 'flagged' && !it.flags.some(f => f.type === fFlag)) return false
      if (needle) {
        const hay = (it.guest + ' ' + it.resCode + ' ' + it.unit + ' ' + (ownerName[it.ownerId] || '') + ' ' + it.note).toLowerCase()
        if (hay.indexOf(needle) < 0) return false
      }
      return true
    })
  }, [data, q, fStatus, fFlag, fOwner, ownerName])

  const byOwner = useMemo(() => {
    const m: Record<string, Item[]> = {}
    for (const it of filtered) (m[it.ownerId] = m[it.ownerId] || []).push(it)
    return m
  }, [filtered])

  const flagCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const it of (data?.items || [])) {
      const seen: Record<string, boolean> = {}
      for (const f of it.flags) { if (!seen[f.type]) { m[f.type] = (m[f.type] || 0) + 1; seen[f.type] = true } }
    }
    return m
  }, [data])

  const exportCsv = () => {
    if (!data) return
    const esc = (v: any) => '"' + String(v ?? '').split('"').join('""') + '"'
    const head = ['Owner', 'Unit', 'Guest', 'Code', 'Check-in', 'Check-out', 'Nights (month)', 'Rental', 'Rate', 'Commission', 'Net', 'Flags', 'Status', 'Note']
    const lines = filtered.map(it => [
      ownerName[it.ownerId] || it.ownerId, it.unit, it.guest, it.resCode || it.key,
      it.checkIn, it.checkOut, it.monthNights,
      it.rental.toFixed(2), it.rate == null ? '' : it.rate.toFixed(2), it.commission.toFixed(2), it.net.toFixed(2),
      it.flags.map(f => FLAG_LABEL[f.type]).join('; '), STATUS_LABEL[it.status], it.note,
    ].map(esc).join(','))
    const blob = new Blob([head.map(esc).join(',') + '\n' + lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'owner-audit-' + data.month + '.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── password gate (share link) ─────────────────────────────────────────────
  if (needsPw) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-6 shadow-soft">
          <div className="flex items-center gap-2 mb-1"><Lock size={16} className="text-muted" /><h1 className="font-semibold text-ink">Owner statement audit</h1></div>
          <p className="text-sm text-muted mb-4">Enter the audit password to review this month&rsquo;s statements.</p>
          <input
            type="password" value={pw} autoFocus
            onChange={e => setPw(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') unlock() }}
            placeholder="Password"
            className="w-full text-sm border border-line rounded-lg px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          {pwErr && <div className="text-xs text-red-600 mb-2">{pwErr}</div>}
          <button onClick={unlock} disabled={pwBusy || !pw} className="w-full text-sm font-medium px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-40">{pwBusy ? 'Checking…' : 'Open the audit'}</button>
        </div>
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className="rounded-2xl border border-line bg-white p-6 shadow-soft">
        <div className="text-sm text-muted">Loading the audit…</div>
        <div className="mt-3 h-24 rounded-xl bg-app animate-pulse" />
      </div>
    )
  }

  const t = data?.totals
  const total = t ? t.review + t.action + t.done : 0
  const pct = total ? Math.round((t!.done / total) * 100) : 0

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Owner statements</div>
          <h1 className="text-lg font-semibold text-ink">Statement audit {data ? '· ' + data.label : ''}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={month}
            onChange={e => load(e.target.value)}
            className="text-sm border border-line rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            {months.map(m => <option key={m.m} value={m.m}>{m.label} ({m.statements})</option>)}
            {months.length === 0 && <option value="">No statements yet</option>}
          </select>
          <button onClick={() => load(month)} title="Refresh" className="p-2 rounded-lg border border-line bg-white hover:bg-app"><RefreshCw size={14} className={loading ? 'animate-spin text-muted' : 'text-muted'} /></button>
          <button onClick={exportCsv} title="Download CSV of the current view" className="p-2 rounded-lg border border-line bg-white hover:bg-app"><Download size={14} className="text-muted" /></button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
          <button onClick={() => setError('')} className="ml-auto text-xs font-semibold hover:underline">Dismiss</button>
        </div>
      )}
      {data && !data.coverage.ready && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={14} /> The ledger mirror has not fully swept {data.label} yet — these rows may be incomplete until the sync finishes.
        </div>
      )}

      {data && (
        <>
          {/* progress + money strip */}
          <div className="rounded-2xl border border-line bg-white shadow-soft p-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Progress</div>
                <div className="text-sm font-semibold text-ink">{t!.done} of {total} completed · {pct}%</div>
                <div className="mt-1.5 w-44 h-[8px] rounded-full bg-brand-100 overflow-hidden">
                  <div className="h-full rounded-full bg-brand-600 transition-[width] duration-500" style={{ width: pct + '%' }} />
                </div>
              </div>
              <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Statements</div><div className="text-sm font-semibold text-ink">{t!.statements} · {t!.owners} owners</div></div>
              <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Reservations</div><div className="text-sm font-semibold text-ink">{t!.reservations}</div></div>
              <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Rental income</div><div className="text-sm font-semibold text-ink">{fmt0(t!.rental)}</div></div>
              <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Commission</div><div className="text-sm font-semibold text-ink">{fmt0(t!.commission)}</div></div>
              <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Net to owners</div><div className="text-sm font-semibold text-ink">{fmt0(t!.net)}</div></div>
              <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Statements total</div><div className="text-sm font-semibold text-ink">{fmt0(t!.dueToOwner)}</div></div>
            </div>
          </div>

          {/* filters */}
          <div className="flex flex-wrap items-center gap-2">
            {(['review', 'action', 'done'] as Status[]).map(s => (
              <button key={s} onClick={() => setFStatus(fStatus === s ? '' : s)}
                className={'text-xs font-semibold px-2.5 py-1 rounded-full ring-1 ring-inset transition ' + STATUS_CLS[s] + (fStatus === s ? ' outline outline-2 outline-offset-1 outline-brand-300' : '')}>
                {STATUS_LABEL[s]} {s === 'review' ? t!.review : s === 'action' ? t!.action : t!.done}
              </button>
            ))}
            <span className="w-px h-5 bg-line mx-1" />
            <button onClick={() => setFFlag(fFlag === 'flagged' ? '' : 'flagged')}
              className={'text-xs font-semibold px-2.5 py-1 rounded-full ring-1 ring-inset bg-rose-50 text-rose-700 ring-rose-200 transition' + (fFlag === 'flagged' ? ' outline outline-2 outline-offset-1 outline-brand-300' : '')}>
              <ShieldAlert size={11} className="inline -mt-0.5 mr-1" />Flagged {t!.flagged}
            </button>
            {(Object.keys(FLAG_LABEL) as FlagType[]).filter(f => flagCounts[f]).map(f => (
              <button key={f} onClick={() => setFFlag(fFlag === f ? '' : f)}
                className={'text-xs font-medium px-2.5 py-1 rounded-full ring-1 ring-inset bg-white text-muted ring-line hover:text-ink transition' + (fFlag === f ? ' outline outline-2 outline-offset-1 outline-brand-300' : '')}>
                {FLAG_LABEL[f]} {flagCounts[f]}
              </button>
            ))}
            <span className="ml-auto" />
            <select value={fOwner} onChange={e => setFOwner(e.target.value)}
              className="text-xs border border-line rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200 max-w-[220px]">
              <option value="">All owners</option>
              {data.owners.map(o => <option key={o.ownerId} value={o.ownerId}>{o.ownerName}</option>)}
            </select>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Guest, unit, code…"
                className="text-xs border border-line rounded-lg pl-7 pr-2.5 py-1.5 w-48 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200" />
            </div>
          </div>

          {/* owner sections */}
          {data.owners.filter(o => byOwner[o.ownerId] && byOwner[o.ownerId].length).map(o => {
            const items = byOwner[o.ownerId]
            const isCollapsed = !!collapsed[o.ownerId]
            const off = o.dueToOwner == null ? null : Math.round((o.net - o.dueToOwner) * 100) / 100
            return (
              <div key={o.ownerId} className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
                <button onClick={() => setCollapsed(prev => ({ ...prev, [o.ownerId]: !isCollapsed }))}
                  className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-app/60">
                  {isCollapsed ? <ChevronRight size={15} className="text-muted shrink-0" /> : <ChevronDown size={15} className="text-muted shrink-0" />}
                  <span className="font-semibold text-ink text-sm">{o.ownerName}</span>
                  {!o.hasStatement && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-200">No statement generated</span>
                  )}
                  {o.hasStatement && (
                    <span className={'text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset ' + (o.ties ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200')}>
                      {o.ties ? 'Ties to statement' : 'Off by ' + fmt(off || 0)}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted">
                    Net {fmt(o.net)}{o.dueToOwner != null ? ' · Statement ' + fmt(o.dueToOwner) : ''} · {o.open ? o.open + ' open' : 'all clear'}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="border-t border-line divide-y divide-line">
                    {items.map(it => {
                      const k = it.ownerId + '|' + it.key
                      const open = !!openItems[k]
                      const worst = worstOf(it)
                      const saving = savingKey === k
                      return (
                        <div key={k} className={it.status === 'done' ? 'opacity-80' : ''}>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                            <button onClick={() => setOpenItems(prev => ({ ...prev, [k]: !open }))} className="shrink-0 text-muted hover:text-ink">
                              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                            <div className="min-w-[180px] flex-1">
                              <div className="text-sm font-medium text-ink truncate">
                                {it.kind === 'reservation' ? (it.guest || '(guest unknown)') : it.guest}
                                {it.resCode && <span className="text-muted font-normal"> · {it.resCode}</span>}
                              </div>
                              <div className="text-[11px] text-muted truncate">
                                {it.unit || (it.kind === 'line' ? 'Owner-level line items' : '')}
                                {it.checkIn && <span> · {dateShort(it.checkIn)} &ndash; {dateShort(it.checkOut)} · {it.monthNights}n{it.splitMonth ? ' in month of ' + it.totalNights + 'n' : ''}</span>}
                                {!it.checkIn && it.kind === 'reservation' && it.monthNights > 0 && <span> · ~{it.monthNights}n</span>}
                              </div>
                            </div>
                            <div className="text-right w-24">
                              <div className="text-sm font-semibold text-ink">{fmt(it.rental)}</div>
                              <div className="text-[11px] text-muted">{it.rate != null ? fmt(it.rate) + '/n' : ''}</div>
                            </div>
                            <div className="flex flex-wrap gap-1 min-w-[90px]">
                              {it.flags.filter(f => f.severity !== 'info').map((f, i) => (
                                <span key={i} title={f.detail} className={'text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset ' + FLAG_CLS[f.severity]}>{FLAG_LABEL[f.type]}</span>
                              ))}
                              {it.flags.filter(f => f.severity === 'info').map((f, i) => (
                                <span key={'i' + i} title={f.detail} className={'text-[10px] px-1.5 py-0.5 rounded-full ring-1 ring-inset ' + FLAG_CLS.info}>{FLAG_LABEL[f.type]}</span>
                              ))}
                              {!it.flags.length && <span className="text-[10px] px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200"><Check size={10} className="inline -mt-0.5" /> Clean</span>}
                            </div>
                            <div className="flex items-center gap-1">
                              {(['review', 'action', 'done'] as Status[]).map(s => (
                                <button key={s} onClick={() => setStatus(it, s)} disabled={saving}
                                  title={STATUS_LABEL[s]}
                                  className={'text-[10px] font-semibold px-2 py-1 rounded-lg ring-1 ring-inset transition ' + (it.status === s ? STATUS_CLS[s] : 'bg-white text-muted ring-line hover:text-ink')}>
                                  {s === 'review' ? 'Review' : s === 'action' ? 'Action' : 'Done'}
                                </button>
                              ))}
                            </div>
                            <div className="flex items-center gap-1.5 text-muted">
                              {(it.comments.length > 0 || it.note) && <MessageSquare size={13} className={it.note || it.comments.length ? 'text-brand-600' : ''} />}
                              {it.comments.length > 0 && <span className="text-[10px] font-semibold">{it.comments.length}</span>}
                              {it.reservationId && (
                                <a href={gyUrl(it.reservationId)} target="_blank" rel="noopener noreferrer" title="Open in Guesty"
                                  className="p-1 rounded-md hover:bg-app text-muted hover:text-brand-700"><ExternalLink size={13} /></a>
                              )}
                            </div>
                          </div>

                          {open && (
                            <div className="px-4 pb-3 pl-11">
                              {worst && (
                                <div className="space-y-1 mb-2">
                                  {it.flags.map((f, i) => (
                                    <div key={i} className="text-xs text-ink flex items-start gap-1.5">
                                      <span className={'mt-0.5 shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset ' + FLAG_CLS[f.severity]}>{FLAG_LABEL[f.type]}</span>
                                      <span className="text-muted">{f.detail}{f.amount !== undefined ? ' (' + fmt(f.amount) + ')' : ''}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {it.lines.length > 0 && (
                                <div className="rounded-xl border border-line overflow-hidden mb-2 max-w-2xl">
                                  <table className="w-full text-xs">
                                    <tbody>
                                      {it.lines.map((l, i) => (
                                        <tr key={i} className={i % 2 ? 'bg-app/50' : 'bg-white'}>
                                          <td className="px-2.5 py-1 text-muted whitespace-nowrap">{dateShort(l.date)}</td>
                                          <td className="px-2.5 py-1 text-ink">{l.label}</td>
                                          <td className="px-2.5 py-1 text-muted">{l.code}</td>
                                          <td className={'px-2.5 py-1 text-right font-medium whitespace-nowrap ' + (l.amount < 0 ? 'text-rose-700' : 'text-ink')}>{fmt(l.amount)}</td>
                                        </tr>
                                      ))}
                                      <tr className="border-t border-line bg-white">
                                        <td className="px-2.5 py-1 font-semibold text-ink" colSpan={3}>Net to owner</td>
                                        <td className={'px-2.5 py-1 text-right font-semibold whitespace-nowrap ' + (it.net < 0 ? 'text-rose-700' : 'text-ink')}>{fmt(it.net)}</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              )}
                              <div className="max-w-2xl">
                                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">Note</label>
                                <div className="flex gap-2 mt-0.5">
                                  <input
                                    value={drafts[k] !== undefined ? drafts[k] : it.note}
                                    onChange={e => setDrafts(prev => ({ ...prev, [k]: e.target.value }))}
                                    onBlur={() => saveNote(it)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveNote(it) }}
                                    placeholder="What was found / what was done…"
                                    className="flex-1 text-xs border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200"
                                  />
                                </div>
                                {it.comments.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    {it.comments.map((c, i) => (
                                      <div key={i} className="text-xs">
                                        <span className="font-semibold text-ink">{c.author}</span>
                                        <span className="text-muted"> · {new Date(c.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                        <div className="text-ink">{c.body}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div className="flex gap-2 mt-2">
                                  {share && (
                                    <input value={me} onChange={e => setMe(e.target.value)} placeholder="Your name"
                                      className="w-28 text-xs border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                                  )}
                                  <input
                                    value={cDrafts[k] || ''}
                                    onChange={e => setCDrafts(prev => ({ ...prev, [k]: e.target.value }))}
                                    onKeyDown={e => { if (e.key === 'Enter') addComment(it) }}
                                    placeholder="Add a comment…"
                                    className="flex-1 text-xs border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200"
                                  />
                                  <button onClick={() => addComment(it)} disabled={saving || !(cDrafts[k] || '').trim()}
                                    className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40">Post</button>
                                </div>
                                {it.updatedBy && (
                                  <div className="text-[10px] text-muted mt-1.5">Last touched by {it.updatedBy}{it.updatedAt ? ' · ' + new Date(it.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {filtered.length === 0 && (
            <div className="rounded-2xl border border-line bg-white shadow-soft p-8 text-center text-sm text-muted">
              Nothing matches these filters{data.items.length === 0 ? ' — no ledger activity found for ' + data.label : ''}.
            </div>
          )}
        </>
      )}
    </div>
  )
}
