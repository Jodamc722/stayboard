'use client'
// THE SHARE LINKS HUB — one directory of every share link (Jon, 2026-08-20), rebuilt 2026-09-18:
// "make it smarter, more customizable, have a prompt for creating one, and make them more
// organized" and "individual password per link".
//
// Top to bottom: DESCRIBE IT (one model call → a filled-in form you review), the FORM, the FILTERS,
// then the links grouped by AUDIENCE → KIND, split into Standing (never expire by nature) and
// Generated (one-offs). A passcode is shown ONCE — at create or rotate — then only its last two
// characters. Built for a phone first: every row wraps, every action is a tap.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Copy, Check, Trash2, Pencil, Lock, X, AlertTriangle, ExternalLink, Sparkles, RefreshCw, CalendarClock, Search, KeyRound, Eye, EyeOff, Undo2 } from 'lucide-react'
import { AUDIENCES, AUDIENCE_LABEL, CREATABLE_KINDS, KIND_LABEL, STANDING_KINDS, FIXED_CODE_KINDS, type LinkScope } from '@/lib/share-links'

type Row = {
  id: string; code: string; kind: string; title: string; audience: string; scope: LinkScope
  hint: string | null; hasPasscode: boolean; open: boolean
  expires_at: string | null; revoked_at: string | null; created_by: string | null; created_at: string
  last_used_at: string | null; uses: number; notes: string | null
  status: 'live' | 'expiring' | 'expired' | 'revoked' | 'unset'; path: string; what: string; generated?: boolean
}
type Meta = {
  buildings: string[]; markets: string[]; vendors: { id: string; name: string }[]
  owners: { id: string; name: string; units: number }[]; listings: { id: string; name: string; building: string }[]
}
type Draft = { kind: string; title: string; audience: string; scope: LinkScope; expiresAt: string | null; showMoney: boolean; reasoning?: string }

const REPORT_SECTIONS: { key: string; label: string; sub: string }[] = [
  { key: 'reservations', label: 'Reservations', sub: 'in-house + upcoming stays' },
  { key: 'revenue', label: 'Revenue & ADR', sub: 'stays, nights, ADR for the window' },
  { key: 'marketing', label: 'Booking sources', sub: 'direct vs OTA' },
  { key: 'audience', label: 'Audience', sub: 'contact counts only' },
  { key: 'contacts', label: 'Contact list', sub: 'names, emails, phones — needs a passcode' },
  { key: 'cleaning', label: 'Cleaning & tasks', sub: 'next 14 days of work' },
  { key: 'verification', label: 'Guest verification', sub: 'verified / pending per arrival' },
  { key: 'notes', label: 'Reservation notes', sub: 'current + upcoming stays' },
  { key: 'team', label: 'Weekly planner — cleaning', sub: 'departure cleans and who has them' },
  { key: 'team_maint', label: 'Weekly planner — maintenance', sub: 'work orders with a Breezeway link' },
]
const BOARD_SECTIONS: { key: string; label: string; sub: string }[] = [
  { key: 'today', label: 'Today — priorities', sub: 'act-now list, big bookings' },
  { key: 'units', label: 'Units — today in ops', sub: 'one row per unit with something on' },
  { key: 'crew', label: 'Crew right now', sub: 'on shift, clocked in, what they are on' },
  { key: 'cleans', label: 'Cleans today', sub: 'checkouts, who has them, same-day turns' },
  { key: 'verify', label: 'Arrivals', sub: 'who lands today and when' },
  { key: 'vacant', label: 'Vacant units', sub: 'empty tonight' },
  { key: 'work', label: 'Work today', sub: 'maintenance and other jobs' },
  { key: 'issues', label: 'Issues', sub: 'exceptions and open guest issues' },
  { key: 'requests', label: 'Guest orders & requests', sub: 'what a guest paid for, what the field asked for' },
  { key: 'add', label: 'Let them add jobs', sub: 'file a task into Breezeway, these units only' },
]
const SCOPE_TYPES = [
  { key: 'portfolio', label: 'Whole portfolio' }, { key: 'market', label: 'Market' }, { key: 'building', label: 'Building' }, { key: 'owner', label: 'Owner' }, { key: 'listing', label: 'Unit' },
]
const STATUS_PILL: Record<string, string> = {
  live: 'bg-emerald-50 text-emerald-700', expiring: 'bg-amber-50 text-amber-800', expired: 'bg-rose-50 text-rose-700',
  revoked: 'bg-app text-muted line-through', unset: 'bg-amber-100 text-amber-900', 'locked-out': 'bg-rose-100 text-rose-800',
}
const KIND_ORDER = [...STANDING_KINDS, 'custom-page', 'owner-report', 'guidebook', 'guide', 'order-form', 'count']
const fmtDay = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
const ago = (iso: string | null) => {
  if (!iso) return 'never used'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 2) return 'just now'; if (m < 60) return m + 'm ago'; if (m < 48 * 60) return Math.round(m / 60) + 'h ago'
  return Math.round(m / 1440) + 'd ago'
}
const nextSunday = () => { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7)); return d.toISOString().slice(0, 10) }
const scopeFor = (k: string): LinkScope => {
  if (k === 'vendor-board') return { vendor: 'botanica' }
  if (k === 'scheduler') return { market: 'Miami', viewOnly: false }
  const sections: Record<string, boolean> = k === 'field-board' ? { cleans: true, verify: true } : k === 'parking' ? { parking: true } : { reservations: true }
  return { scopeType: 'portfolio', scopeIds: [], sections, showMoney: false, guestNames: false, windowDays: k === 'parking' ? 45 : 30 }
}
const emptyForm = (): Draft => ({ kind: 'custom-page', title: '', audience: 'internal', scope: { scopeType: 'portfolio', scopeIds: [], sections: { reservations: true }, showMoney: false, guestNames: false, windowDays: 30 }, expiresAt: null, showMoney: false })

export function ShareLinksHub() {
  const [links, setLinks] = useState<Row[] | null>(null)
  const [generated, setGenerated] = useState<Row[]>([])
  const [locked, setLocked] = useState<string[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [canMoney, setCanMoney] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')
  const [busy, setBusy] = useState(false)
  const [origin, setOrigin] = useState('')

  // describe → draft
  const [ask, setAsk] = useState('')
  const [asking, setAsking] = useState(false)
  const [askNote, setAskNote] = useState('')

  // the form (create or edit)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)
  const [form, setForm] = useState<Draft>(emptyForm())
  const [passcode, setPasscode] = useState('')
  const [noPasscode, setNoPasscode] = useState(false)
  const [notes, setNotes] = useState('')
  const [q, setQ] = useState('')

  // reveal-once
  const [reveal, setReveal] = useState<{ row: Row; passcode: string | null } | null>(null)

  // filters / bulk
  const [fAud, setFAud] = useState(''); const [fKind, setFKind] = useState(''); const [fBld, setFBld] = useState(''); const [fStatus, setFStatus] = useState('')
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [extendTo, setExtendTo] = useState('')
  const [showGen, setShowGen] = useState(false)

  useEffect(() => {
    setOrigin(window.location.origin)
    try { const p = new URLSearchParams(window.location.search).get('q'); if (p) setSearch(p) } catch { /* fine */ }
  }, [])
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/share-links', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.message || j?.error || 'Could not load.')
      setLinks(j.links || []); setGenerated(j.generated || []); setLocked(j.lockedCodes || []); setMeta(j.meta || null); setCanMoney(!!j.canSeeMoney)
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [])
  useEffect(() => { load() }, [load])

  const copyText = async (text: string, key: string) => { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1800) } catch { /* blocked */ } }
  const post = async (body: any) => {
    const r = await fetch('/api/share-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.ok) throw new Error(j?.error || j?.message || 'That did not work.')
    return j
  }

  // ── describe → draft ──
  const draft = async () => {
    if (ask.trim().length < 4) return
    setAsking(true); setAskNote(''); setErr('')
    try {
      const r = await fetch('/api/share-links/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: ask }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok || !j.draft) throw new Error(j?.error || 'Could not draft it — fill the form instead.')
      const d: Draft = j.draft
      // A fixed page already has its row: open THAT for editing rather than minting a duplicate.
      const existing = FIXED_CODE_KINDS.indexOf(d.kind) >= 0 ? (links || []).find(l => l.kind === d.kind && !l.revoked_at) : null
      if (existing) {
        startEdit(existing)
        setForm(f => ({ ...f, scope: { ...f.scope, ...d.scope }, expiresAt: d.expiresAt ?? f.expiresAt, title: f.title || d.title }))
        setAskNote((d.reasoning ? d.reasoning + ' ' : '') + 'That page has one fixed link, so this is its existing row — review and save.')
      } else {
        setEditing(null); setForm({ ...emptyForm(), ...d, scope: { ...emptyForm().scope, ...d.scope } }); setPasscode(''); setNoPasscode(false); setNotes(''); setOpen(true)
        setAskNote(d.reasoning || 'Drafted — review and click Create.')
      }
    } catch (e: any) {
      setAskNote(String(e?.message || e)); setEditing(null); setForm({ ...emptyForm(), title: ask.slice(0, 80) }); setOpen(true)
    }
    setAsking(false)
  }

  const startEdit = (l: Row) => {
    setEditing(l); setForm({ kind: l.kind, title: l.title, audience: l.audience, scope: { ...l.scope }, expiresAt: l.expires_at ? l.expires_at.slice(0, 10) : null, showMoney: l.scope.showMoney === true })
    setPasscode(''); setNoPasscode(false); setNotes(l.notes || ''); setOpen(true); setAskNote('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const closeForm = () => { setOpen(false); setEditing(null); setForm(emptyForm()); setPasscode(''); setNoPasscode(false); setNotes(''); setAskNote('') }

  const save = async () => {
    setBusy(true); setErr('')
    try {
      if (editing) {
        await post({ action: 'update', id: editing.id, title: form.title, audience: form.audience, scope: form.scope, expiresAt: form.expiresAt, notes })
        if (passcode.trim()) { const j = await post({ action: 'rotate', id: editing.id, passcode: passcode.trim() }); setReveal({ row: j.link, passcode: j.passcode }) }
        closeForm(); await load()
      } else {
        const j = await post({ action: 'create', kind: form.kind, title: form.title, audience: form.audience, scope: form.scope, expiresAt: form.expiresAt, passcode: passcode.trim() || undefined, open: noPasscode, notes })
        closeForm(); await load(); setReveal({ row: j.link, passcode: j.passcode })
      }
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  const rotate = async (l: Row) => {
    if (!window.confirm('New passcode for “' + l.title + '”? The old one stops working immediately — everyone you sent it to will need the new one.')) return
    try { const j = await post({ action: 'rotate', id: l.id }); setReveal({ row: j.link, passcode: j.passcode }); await load() } catch (e: any) { setErr(String(e?.message || e)) }
  }
  const revoke = async (ids: string[]) => {
    if (!ids.length) return
    if (!window.confirm(ids.length === 1 ? 'Turn this link off? Anyone holding it loses access immediately.' : `Turn off ${ids.length} links? Everyone holding them loses access immediately.`)) return
    try { await post({ action: 'revoke', ids }); setSel({}); await load() } catch (e: any) { setErr(String(e?.message || e)) }
  }
  const restore = async (id: string) => { try { await post({ action: 'restore', id }); await load() } catch (e: any) { setErr(String(e?.message || e)) } }
  const extend = async (ids: string[], to: string | null) => {
    if (!ids.length) return
    try { await post({ action: 'extend', ids, expiresAt: to }); setSel({}); setExtendTo(''); await load() } catch (e: any) { setErr(String(e?.message || e)) }
  }

  // ── filtering + grouping ──
  const all = useMemo(() => (links || []).concat(showGen ? generated : []), [links, generated, showGen])
  const shown = useMemo(() => {
    const n = search.trim().toLowerCase()
    return all.filter(l => {
      if (fAud && l.audience !== fAud) return false
      if (fKind && l.kind !== fKind) return false
      if (fStatus && (fStatus === 'locked-out' ? locked.indexOf(l.code) < 0 : l.status !== fStatus)) return false
      if (fBld) {
        const hay = [...(l.scope.scopeIds || []), ...(l.scope.buildings || []), l.what].join(' ').toLowerCase()
        if (!hay.includes(fBld.toLowerCase())) return false
      }
      if (n && !(l.title + ' ' + l.what + ' ' + l.code + ' ' + (l.notes || '') + ' ' + KIND_LABEL[l.kind as keyof typeof KIND_LABEL]).toLowerCase().includes(n)) return false
      return true
    })
  }, [all, fAud, fKind, fStatus, fBld, search, locked])
  const standing = shown.filter(l => STANDING_KINDS.indexOf(l.kind as any) >= 0 && !l.expires_at)
  const oneOff = shown.filter(l => !(STANDING_KINDS.indexOf(l.kind as any) >= 0 && !l.expires_at))
  const group = (rows: Row[]) => {
    const out: { audience: string; kinds: { kind: string; rows: Row[] }[] }[] = []
    for (const a of AUDIENCES) {
      const mine = rows.filter(r => r.audience === a)
      if (!mine.length) continue
      const kinds = KIND_ORDER.filter(k => mine.some(r => r.kind === k)).map(k => ({ kind: k, rows: mine.filter(r => r.kind === k) }))
      out.push({ audience: a, kinds })
    }
    return out
  }
  const selected = Object.keys(sel).filter(k => sel[k])
  const unsetCount = (links || []).filter(l => l.status === 'unset').length

  // scope pick-list for custom kinds
  const options = useMemo(() => {
    if (!meta) return []
    const n = q.trim().toLowerCase(); const st = form.scope.scopeType
    if (st === 'market') return meta.markets.map(m => ({ id: m, name: m, sub: '' }))
    if (st === 'building') return meta.buildings.filter(b => !n || b.toLowerCase().includes(n)).map(b => ({ id: b, name: b, sub: '' }))
    if (st === 'owner') return meta.owners.filter(o => !n || o.name.toLowerCase().includes(n)).map(o => ({ id: o.id, name: o.name, sub: o.units + ' units' }))
    if (st === 'listing') return meta.listings.filter(l => !n || (l.name + ' ' + l.building).toLowerCase().includes(n)).slice(0, 30).map(l => ({ id: l.id, name: l.name, sub: l.building }))
    return []
  }, [meta, form.scope.scopeType, q])
  const nameOf = (st: string | undefined, id: string) => st === 'owner' ? (meta?.owners.find(o => o.id === id)?.name || id) : st === 'listing' ? (meta?.listings.find(x => x.id === id)?.name || id) : id
  const setScope = (patch: Partial<LinkScope>) => setForm(f => ({ ...f, scope: { ...f.scope, ...patch } }))
  const isCustom = form.kind === 'custom-page' || form.kind === 'field-board' || form.kind === 'parking'
  const sectionsFor = form.kind === 'field-board' ? BOARD_SECTIONS : form.kind === 'custom-page' ? REPORT_SECTIONS : []
  const isFixed = FIXED_CODE_KINDS.indexOf(form.kind) >= 0

  if (!links) return <div className="rounded-2xl border border-line bg-white p-10 text-center text-sm text-muted"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading…</div>

  const RowView = ({ l }: { l: Row }) => {
    const url = origin + l.path
    const isLocked = locked.indexOf(l.code) >= 0
    const status = isLocked && l.status === 'live' ? 'locked-out' : l.status
    return (
      <div className={'px-3 sm:px-4 py-3 ' + (l.revoked_at ? 'opacity-60' : '')}>
        <div className="flex items-start gap-2">
          {!l.generated ? <input type="checkbox" checked={!!sel[l.id]} onChange={e => setSel(s => ({ ...s, [l.id]: e.target.checked }))} className="mt-1.5 shrink-0" /> : <span className="w-[13px] shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[13.5px] font-bold text-ink">{l.title || 'Untitled link'}</span>
              <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' + STATUS_PILL[status]}>{status === 'unset' ? 'no passcode yet' : status}</span>
              {l.scope.showMoney ? <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5">$ on</span> : null}
            </div>
            <p className="text-[11.5px] text-muted mt-0.5">{l.what}</p>
            <p className="text-[11px] text-faint mt-0.5 flex flex-wrap gap-x-2">
              {l.hasPasscode ? <span className="inline-flex items-center gap-1 font-mono"><Lock size={10} />{l.hint || '••'}</span> : l.open ? <span>open link</span> : null}
              {l.expires_at ? <span className="inline-flex items-center gap-1"><CalendarClock size={10} /> {l.status === 'expired' ? 'expired' : 'expires'} {fmtDay(l.expires_at)}</span> : <span>never expires</span>}
              <span>{ago(l.last_used_at)} · {l.uses} use{l.uses === 1 ? '' : 's'}</span>
              <span className="truncate max-w-[220px]">{l.path}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1.5 pl-5 text-[12px]">
          <button onClick={() => copyText(url, l.id + ':url')} className="font-bold text-brand-700 inline-flex items-center gap-1">
            {copied === l.id + ':url' ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy link</>}
          </button>
          <a href={l.path} target="_blank" rel="noreferrer" className="font-semibold text-ink inline-flex items-center gap-1">Open <ExternalLink size={11} /></a>
          {!l.generated && !l.revoked_at ? (
            <>
              {!l.open ? <button onClick={() => rotate(l)} className="text-muted hover:text-ink inline-flex items-center gap-1" title="New passcode (old one dies immediately)"><KeyRound size={12} /> {l.hasPasscode ? 'New passcode' : 'Set passcode'}</button> : null}
              <button onClick={() => startEdit(l)} className="text-muted hover:text-ink inline-flex items-center gap-1"><Pencil size={12} /> Edit</button>
              <button onClick={() => revoke([l.id])} className="text-muted hover:text-rose-600 inline-flex items-center gap-1"><Trash2 size={12} /> Revoke</button>
            </>
          ) : null}
          {l.revoked_at ? <button onClick={() => restore(l.id)} className="text-muted hover:text-ink inline-flex items-center gap-1"><Undo2 size={12} /> Restore</button> : null}
        </div>
      </div>
    )
  }

  const Groups = ({ rows, empty }: { rows: Row[]; empty: string }) => {
    const g = group(rows)
    if (!g.length) return <p className="px-4 py-6 text-center text-[12.5px] text-muted">{empty}</p>
    return (
      <div>
        {g.map(a => (
          <div key={a.audience} className="border-t border-line first:border-t-0">
            <p className="px-3 sm:px-4 pt-3 pb-1 text-[11px] uppercase tracking-wider font-bold text-muted">{AUDIENCE_LABEL[a.audience as keyof typeof AUDIENCE_LABEL] || a.audience}</p>
            {a.kinds.map(k => (
              <div key={k.kind}>
                <p className="px-3 sm:px-4 pt-1 text-[11.5px] font-semibold text-ink/70">{KIND_LABEL[k.kind as keyof typeof KIND_LABEL] || k.kind} <span className="text-faint font-normal tabular-nums">{k.rows.length}</span></p>
                <div className="divide-y divide-line">{k.rows.map(l => <RowView key={l.id} l={l} />)}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700 flex gap-2"><span className="flex-1">{err}</span><button onClick={() => setErr('')}><X size={14} /></button></div> : null}

      {/* ── REVEAL ONCE ─────────────────────────────────────────────────────────────── */}
      {reveal ? (
        <div className="fixed inset-0 z-50 bg-ink/50 flex items-end sm:items-center justify-center p-3" onClick={() => setReveal(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2"><KeyRound size={16} className="text-brand-700" /><p className="text-sm font-bold text-ink flex-1">{reveal.row.title}</p><button onClick={() => setReveal(null)} className="text-muted"><X size={15} /></button></div>
            {reveal.passcode ? (
              <>
                <p className="text-[12.5px] text-muted">This passcode is shown <b>once</b>. After you close this, the hub only shows its last two characters — write it down or send it now.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-lg font-mono font-bold tracking-wider rounded-xl bg-app border border-line px-3 py-2 text-ink select-all">{reveal.passcode}</code>
                  <button onClick={() => copyText(reveal.passcode || '', 'rv:pw')} className="rounded-xl border border-line px-3 py-2 text-[12.5px] font-bold">{copied === 'rv:pw' ? 'Copied' : 'Copy'}</button>
                </div>
              </>
            ) : <p className="text-[12.5px] text-muted">Open link — the address is the key. No passcode.</p>}
            <div className="rounded-xl border border-line bg-app/60 p-3 text-[12px] whitespace-pre-wrap font-mono text-ink">{origin + reveal.row.path}{reveal.passcode ? '\nPasscode: ' + reveal.passcode : ''}</div>
            <div className="flex gap-2">
              <button onClick={() => copyText(origin + reveal.row.path + (reveal.passcode ? '\nPasscode: ' + reveal.passcode : ''), 'rv:both')} className="flex-1 rounded-xl bg-ink text-white px-4 py-2.5 text-[13px] font-bold inline-flex items-center justify-center gap-1.5">
                {copied === 'rv:both' ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy link{reveal.passcode ? ' + passcode' : ''}</>}
              </button>
              <button onClick={() => setReveal(null)} className="rounded-xl border border-line px-4 py-2.5 text-[13px] font-bold">Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── DESCRIBE IT ─────────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-ink/15 bg-white p-3 sm:p-4 shadow-soft">
        <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1.5 inline-flex items-center gap-1.5"><Sparkles size={12} /> Describe the link you need</p>
        <div className="flex gap-2">
          <input value={ask} onChange={e => setAsk(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') draft() }}
            placeholder="e.g. a link for the Pompano cleaners to see today's and tomorrow's turns, no guest names, expires Sunday"
            className="flex-1 min-w-0 rounded-xl border border-line px-3 py-2.5 text-[13px]" />
          <button onClick={draft} disabled={asking || ask.trim().length < 4} className="rounded-xl bg-ink text-white px-3.5 py-2.5 text-[13px] font-bold disabled:opacity-40 inline-flex items-center gap-1.5 shrink-0">
            {asking ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Draft
          </button>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <p className="text-[11.5px] text-muted flex-1">{askNote || 'It fills in the form below for you to check. Nothing is created until you click Create.'}</p>
          {!open ? <button onClick={() => { setEditing(null); setForm(emptyForm()); setOpen(true) }} className="text-[12px] font-bold text-brand-700 inline-flex items-center gap-1 shrink-0"><Plus size={13} /> Or fill the form</button> : null}
        </div>
      </div>

      {/* ── THE FORM ────────────────────────────────────────────────────────────────── */}
      {open ? (
        <div className="rounded-2xl border border-ink/20 bg-white p-3 sm:p-4 shadow-soft space-y-3.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-ink flex-1">{editing ? 'Edit link' : 'New link'}</p>
            <button onClick={closeForm} className="text-muted hover:text-ink p-1"><X size={15} /></button>
          </div>
          {!editing ? (
            <div>
              <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1.5">What kind of link</p>
              <div className="flex flex-wrap gap-1.5">
                {CREATABLE_KINDS.filter(k => FIXED_CODE_KINDS.indexOf(k) < 0).map(k => (
                  <button key={k} onClick={() => setForm(f => ({ ...emptyForm(), kind: k, title: f.title, audience: k === 'vendor-board' ? 'vendor' : k === 'scheduler' || k === 'field-board' ? 'crew' : k === 'parking' ? 'vendor' : f.audience, scope: scopeFor(k) }))}
                    className={'text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border ' + (form.kind === k ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>
                    {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted mt-1.5">The day sheet, delivery log, live orders, marketing, audit and Botanica reports each have one fixed link already — edit those below.</p>
            </div>
          ) : <p className="text-[12px] text-muted">{KIND_LABEL[form.kind as keyof typeof KIND_LABEL]} · <span className="font-mono">{editing.path}</span>{isFixed ? ' · fixed page' : ''}</p>}

          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="What is this link for? e.g. “Pompano cleaners — turns”" className="w-full rounded-xl border border-line px-3 py-2 text-[13px]" />

          <div>
            <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1.5">Who it is for</p>
            <div className="flex flex-wrap gap-1.5">
              {AUDIENCES.map(a => (
                <button key={a} onClick={() => setForm(f => ({ ...f, audience: a }))} className={'text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border ' + (form.audience === a ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>{AUDIENCE_LABEL[a]}</button>
              ))}
            </div>
          </div>

          {/* scope, per kind */}
          {form.kind === 'vendor-board' ? (
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wider font-bold text-muted">Vendor crew</p>
              <div className="flex flex-wrap gap-1.5">
                {(meta?.vendors || []).map(v => <button key={v.id} onClick={() => setScope({ vendor: v.id })} className={'text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border ' + (form.scope.vendor === v.id ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line')}>{v.name}</button>)}
              </div>
              <p className="text-[11px] text-muted">Limit to buildings (optional — leave empty for the crew's whole scope):</p>
              <div className="flex flex-wrap gap-1.5">
                {(meta?.buildings || []).map(b => { const on = (form.scope.buildings || []).indexOf(b) >= 0; return <button key={b} onClick={() => setScope({ buildings: on ? (form.scope.buildings || []).filter(x => x !== b) : [...(form.scope.buildings || []), b] })} className={'text-[11.5px] px-2 py-1 rounded-lg border ' + (on ? 'bg-brand-50 text-brand-700 border-brand-200 font-semibold' : 'bg-white text-muted border-line')}>{b}</button> })}
              </div>
            </div>
          ) : null}
          {form.kind === 'scheduler' || form.kind === 'day-sheet' ? (
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wider font-bold text-muted">Market</p>
              <div className="flex flex-wrap gap-1.5">
                {[...(meta?.markets || []), 'All'].map(m => <button key={m} onClick={() => setScope({ market: m })} className={'text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border ' + ((form.scope.market || (form.kind === 'day-sheet' ? 'All' : '')) === m ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line')}>{m}</button>)}
              </div>
              {form.kind === 'scheduler' && !editing ? (
                <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink cursor-pointer"><input type="checkbox" checked={form.scope.viewOnly === true} onChange={e => setScope({ viewOnly: e.target.checked })} /> View only — cannot assign or submit (fixed once made)</label>
              ) : null}
            </div>
          ) : null}
          {form.kind === 'marketing' ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-muted">
              <span className="flex items-center gap-1.5">From <input type="date" value={form.scope.from || ''} onChange={e => setScope({ from: e.target.value || undefined })} className="rounded-lg border border-line px-2 py-1" /></span>
              <span className="flex items-center gap-1.5">To <input type="date" value={form.scope.to || ''} onChange={e => setScope({ to: e.target.value || undefined })} className="rounded-lg border border-line px-2 py-1" /></span>
              <label className="flex items-center gap-2 font-semibold text-ink cursor-pointer"><input type="checkbox" checked={form.scope.showMoney !== false} disabled={!canMoney} onChange={e => setScope({ showMoney: e.target.checked ? undefined : false })} /> Show dollars</label>
            </div>
          ) : null}
          {isCustom ? (
            <>
              <div>
                <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1.5">Scoped to</p>
                <div className="flex flex-wrap gap-1.5">
                  {SCOPE_TYPES.map(s => <button key={s.key} onClick={() => { setScope({ scopeType: s.key as any, scopeIds: [] }); setQ('') }} className={'text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border ' + (form.scope.scopeType === s.key ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>{s.label}</button>)}
                </div>
                {form.scope.scopeType && form.scope.scopeType !== 'portfolio' ? (
                  <div className="mt-2">
                    {(form.scope.scopeIds || []).length ? (
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {(form.scope.scopeIds || []).map(id => (
                          <span key={id} className="text-[12px] font-semibold bg-app rounded-lg px-2 py-1 inline-flex items-center gap-1.5">{nameOf(form.scope.scopeType, id)}
                            <button onClick={() => setScope({ scopeIds: (form.scope.scopeIds || []).filter(x => x !== id) })} className="text-muted hover:text-ink"><X size={11} /></button></span>
                        ))}
                      </div>
                    ) : null}
                    {form.scope.scopeType !== 'market' ? <input value={q} onChange={e => setQ(e.target.value)} placeholder={'Search ' + form.scope.scopeType + 's…'} className="w-full rounded-xl border border-line px-3 py-2 text-[13px]" /> : null}
                    {q.trim() || form.scope.scopeType === 'market' || form.scope.scopeType === 'building' ? (
                      <div className="mt-1 rounded-xl border border-line divide-y divide-line overflow-hidden max-h-56 overflow-y-auto">
                        {options.filter(o => (form.scope.scopeIds || []).indexOf(o.id) < 0).slice(0, 40).map(o => (
                          <button key={o.id} onClick={() => { setScope({ scopeIds: [...(form.scope.scopeIds || []), o.id] }); setQ('') }} className="w-full px-3 py-2 text-left text-[13px] hover:bg-app flex items-center gap-2">
                            <span className="font-semibold text-ink">{o.name}</span>{o.sub ? <span className="text-[11.5px] text-muted">{o.sub}</span> : null}
                          </button>
                        ))}
                        {!options.length ? <p className="px-3 py-2 text-[12.5px] text-muted">Nothing matches.</p> : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {sectionsFor.length ? (
                <div>
                  <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1.5">{form.kind === 'field-board' ? 'Board sections' : 'Report sections'}</p>
                  <div className="grid sm:grid-cols-2 gap-x-5 gap-y-1.5">
                    {sectionsFor.map(s => (
                      <label key={s.key} className="flex items-start gap-2 cursor-pointer">
                        <input type="checkbox" checked={!!form.scope.sections?.[s.key]} onChange={e => setScope({ sections: { ...(form.scope.sections || {}), [s.key]: e.target.checked } })} className="mt-0.5" />
                        <span className="text-[12.5px]"><span className="font-semibold text-ink">{s.label}</span> <span className="text-muted">— {s.sub}</span></span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <label className={'flex items-center gap-2 text-[12.5px] font-semibold text-ink ' + (canMoney ? 'cursor-pointer' : 'opacity-50')}><input type="checkbox" disabled={!canMoney} checked={form.scope.showMoney === true} onChange={e => setScope({ showMoney: e.target.checked })} /> Show dollar figures</label>
                <label className="flex items-center gap-2 cursor-pointer text-[12.5px] font-semibold text-ink"><input type="checkbox" checked={form.scope.guestNames === true} onChange={e => setScope({ guestNames: e.target.checked })} /> Full guest names</label>
                <span className="flex items-center gap-1.5 text-[12.5px] text-muted">Window <input type="number" min={7} max={120} value={form.scope.windowDays || 30} onChange={e => setScope({ windowDays: Number(e.target.value) })} className="w-16 rounded-lg border border-line px-2 py-1 text-center" /> days</span>
              </div>
            </>
          ) : null}

          {/* passcode + expiry + notes */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1 inline-flex items-center gap-1"><Lock size={10} /> Passcode</p>
              {editing ? (
                <p className="text-[11.5px] text-muted mb-1">{editing.hasPasscode ? <>Currently <span className="font-mono">{editing.hint}</span>. Type a new one to replace it, or leave blank to keep it.</> : editing.open ? 'Open link — type one to lock it.' : 'None set yet — type one, or leave blank and generate later.'}</p>
              ) : null}
              <input value={passcode} onChange={e => setPasscode(e.target.value)} disabled={noPasscode} placeholder={noPasscode ? 'none — the address is the key' : (editing ? 'leave blank to keep' : 'leave blank to generate one')} className="w-full rounded-xl border border-line px-3 py-2 text-[13px] font-mono disabled:opacity-50" />
              {!editing && (form.kind === 'custom-page' || form.kind === 'field-board') ? (
                <label className="flex items-center gap-2 text-[11.5px] text-muted mt-1 cursor-pointer"><input type="checkbox" checked={noPasscode} onChange={e => setNoPasscode(e.target.checked)} /> No passcode — an open link (the 16-character code is the only key)</label>
              ) : null}
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1 inline-flex items-center gap-1"><CalendarClock size={10} /> Expires</p>
              <div className="flex items-center gap-2 flex-wrap">
                <input type="date" value={form.expiresAt || ''} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value || null }))} className="rounded-xl border border-line px-3 py-2 text-[13px]" />
                <button onClick={() => setForm(f => ({ ...f, expiresAt: nextSunday() }))} className="text-[11.5px] text-brand-700 font-semibold">Sunday</button>
                <button onClick={() => setForm(f => ({ ...f, expiresAt: null }))} className="text-[11.5px] text-muted">never</button>
              </div>
            </div>
          </div>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes for the team (who you sent it to, why)" className="w-full rounded-xl border border-line px-3 py-2 text-[12.5px]" />

          <button onClick={save} disabled={busy} className="rounded-xl bg-ink text-white px-4 py-2.5 text-[13px] font-bold disabled:opacity-40 inline-flex items-center gap-1.5">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {editing ? (passcode.trim() ? 'Save + new passcode' : 'Save changes — every copy updates') : 'Create link'}
          </button>
        </div>
      ) : null}

      {/* ── FILTERS ─────────────────────────────────────────────────────────────────── */}
      {unsetCount > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-900 flex gap-2 items-start">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span><b>{unsetCount} link{unsetCount === 1 ? ' has' : 's have'} no passcode yet</b> and stay shut until one is set — the old shared team passwords no longer open anything. Tap <b>Set passcode</b> on each, then send it.</span>
        </div>
      ) : null}
      <div className="rounded-2xl border border-line bg-white p-3 shadow-soft space-y-2">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search links…" className="w-full rounded-xl border border-line pl-8 pr-3 py-2 text-[13px]" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
          <select value={fAud} onChange={e => setFAud(e.target.value)} className="rounded-lg border border-line px-2 py-1.5 text-[12px] shrink-0"><option value="">Everyone</option>{AUDIENCES.map(a => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}</select>
          <select value={fKind} onChange={e => setFKind(e.target.value)} className="rounded-lg border border-line px-2 py-1.5 text-[12px] shrink-0"><option value="">Every kind</option>{KIND_ORDER.map(k => <option key={k} value={k}>{KIND_LABEL[k as keyof typeof KIND_LABEL]}</option>)}</select>
          <select value={fBld} onChange={e => setFBld(e.target.value)} className="rounded-lg border border-line px-2 py-1.5 text-[12px] shrink-0"><option value="">Any building</option>{(meta?.buildings || []).map(b => <option key={b} value={b}>{b}</option>)}</select>
          <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="rounded-lg border border-line px-2 py-1.5 text-[12px] shrink-0"><option value="">Any status</option>{['live', 'expiring', 'expired', 'revoked', 'unset', 'locked-out'].map(s => <option key={s} value={s}>{s}</option>)}</select>
          <label className="rounded-lg border border-line px-2 py-1.5 text-[12px] shrink-0 inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={showGen} onChange={e => setShowGen(e.target.checked)} /> {showGen ? <Eye size={11} /> : <EyeOff size={11} />} generated ({generated.length})</label>
        </div>
        {selected.length ? (
          <div className="flex items-center gap-2 flex-wrap text-[12px] pt-1 border-t border-line">
            <span className="font-bold text-ink">{selected.length} selected</span>
            <button onClick={() => revoke(selected)} className="rounded-lg border border-rose-200 text-rose-700 px-2 py-1 font-semibold inline-flex items-center gap-1"><Trash2 size={11} /> Revoke</button>
            <span className="inline-flex items-center gap-1"><input type="date" value={extendTo} onChange={e => setExtendTo(e.target.value)} className="rounded-lg border border-line px-2 py-1" /><button onClick={() => extend(selected, extendTo || null)} className="rounded-lg border border-line px-2 py-1 font-semibold inline-flex items-center gap-1"><CalendarClock size={11} /> {extendTo ? 'Extend to' : 'Never expire'}</button></span>
            <button onClick={() => setSel({})} className="text-muted">clear</button>
          </div>
        ) : null}
      </div>

      {/* ── STANDING ────────────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
        <div className="px-3 sm:px-4 py-3 border-b border-line">
          <p className="text-sm font-bold text-ink">Standing links <span className="text-[11px] text-muted font-normal tabular-nums">{standing.length}</span></p>
          <p className="text-[11.5px] text-muted mt-0.5">The boards and reports people keep on their phone. No expiry; each one has its own passcode — rotate it and only that link's holders are asked again.</p>
        </div>
        <Groups rows={standing} empty="Nothing matches." />
      </div>

      {/* ── GENERATED / ONE-OFFS ────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
        <div className="px-3 sm:px-4 py-3 border-b border-line">
          <p className="text-sm font-bold text-ink">Generated &amp; one-off links <span className="text-[11px] text-muted font-normal tabular-nums">{oneOff.length}</span></p>
          <p className="text-[11.5px] text-muted mt-0.5">Custom reports, anything with an expiry date, and — when shown — the owner reports, guidebooks, guide pages and count sheets their own tabs mint.</p>
        </div>
        <Groups rows={oneOff} empty={showGen ? 'Nothing matches.' : 'Nothing matches — tick “generated” above to include owner reports, guidebooks and count sheets.'} />
      </div>

      <p className="text-[11.5px] text-muted">
        Not listed on purpose: the one-shot job links — a walk, a field request, an owner approval, an audit, a Salato verification. Those are tickets for a single task, and there are thousands of them.
      </p>
      <button onClick={load} className="text-[11.5px] text-muted inline-flex items-center gap-1"><RefreshCw size={11} /> Refresh</button>
    </div>
  )
}
