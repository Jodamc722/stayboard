'use client'
// THE VAULT — one shelf for the things that currently live in a phone's notes app, a pinned Slack
// message, or an email thread from three years ago.
//
// The design rule this screen follows: NOTHING SENSITIVE IS ON SCREEN UNTIL SOMEONE ASKS FOR IT.
// The list renders hints ("••••4471"), never values. Revealing a secret is a deliberate click that
// hits its own endpoint and writes an audit row; the value then auto-hides again, because a
// password left open on a laptop in a lobby is the failure this whole thing exists to prevent.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2, Plus, Search, Trash2, X, Check, AlertTriangle, Eye, EyeOff, Copy, Download,
  Upload, Users, Clock, KeyRound, FileText, StickyNote, ShieldCheck, History, RefreshCw, Lock,
  Database, Unlock, ChevronRight, ChevronDown, MoreHorizontal, FolderLock, ArrowRightLeft,
} from 'lucide-react'

// Keep in sync with CATEGORIES in lib/vault.ts — this order is the order the shelves render in.
const CATEGORIES = [
  { id: 'building', label: 'Building & access' },
  { id: 'channel', label: 'Channel logins' },
  { id: 'email', label: 'Email accounts' },
  { id: 'utility', label: 'Utilities & internet' },
  { id: 'apps', label: 'Apps, vendors & tools' },
  { id: 'revenue', label: 'Revenue & finance' },
  { id: 'company', label: 'Company & legal' },
  { id: 'owner', label: 'Owner & payouts' },
  { id: 'guest', label: 'Guest documents' },
  { id: 'archive', label: 'Old / unused' },
]
const CAT_ORDER: Record<string, number> = Object.fromEntries(CATEGORIES.map((c, i) => [c.id, i]))

// What the vault-code prompt hands back. `null` = the person cancelled.
type CodeAnswer = { code: string; reason: string } | null
type AskCode = (purpose: string, opts?: { askReason?: boolean }) => Promise<CodeAnswer>

type Item = {
  id: string; kind: 'secret' | 'file' | 'note'; category: string
  collection_id?: string | null
  title: string; description?: string | null
  property_id?: string | null; unit_no?: string | null; reservation_id?: string | null
  secret_hint?: string | null; username?: string | null; url?: string | null
  hasSecret: boolean; hasFile: boolean
  doc_name?: string | null; doc_bytes?: number | null; doc_mime?: string | null
  expires_on?: string | null; tags: string[]
  owner_email: string; created_at: string; updated_at: string
  level: 'view' | 'manage' | null
}
type Grant = { item_id: string; email: string; level: string }
type Collection = {
  id: string; name: string; slug: string; color?: string | null
  level: 'view' | 'manage'; roles: string[]; myLevel?: 'view' | 'manage' | null
  items?: number; members?: string[]
}
const PRIVATE = '__private__'   // the pseudo-vault for items filed nowhere: owner + named grants only

const EMPTY = {
  kind: 'secret' as Item['kind'], category: 'building', title: '', description: '',
  username: '', url: '', secret: '', property_id: '', unit_no: '', expires_on: '',
}

function fmtDate(d?: string | null): string {
  if (!d) return ''
  const m = String(d).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return String(d)
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return MON[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1]
}
function fmtBytes(n?: number | null): string {
  if (!n) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}
function daysUntil(d?: string | null): number | null {
  if (!d) return null
  const t = Date.parse(String(d).slice(0, 10) + 'T12:00:00Z')
  if (!Number.isFinite(t)) return null
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  return Math.round((t - Date.parse(today + 'T12:00:00Z')) / 86400000)
}

const field = 'w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-brand-400'
const lbl = 'block text-[11px] uppercase tracking-wider text-muted font-semibold mb-1'

// ── RECORDS — the verification paper trail (Jon, 2026-08-22): Salato check-ins, Elser
// registration forms, and a shelf ready for incident reports. Feeds, not copies — links are
// minted short-lived on demand from the private buckets they already live in. ──
function RecordsView({ askCode }: { askCode: AskCode }) {
  const [data, setData] = useState<any | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/vault/records', { cache: 'no-store' }).then(r => r.json())
      .then(j => { if (j.ok) setData(j); else setErr(j.error || j.message || 'Could not load records.') })
      .catch(e => setErr(String(e)))
  }, [])
  const open = async (ref: string) => {
    setBusy(ref); setErr(null)
    try {
      let r = await fetch('/api/vault/records?sign=' + encodeURIComponent(ref), { cache: 'no-store' })
      let j = await r.json()
      if (!j.ok && j.wrongCode) {                     // window shut — ask once, then retry the click
        const ans = await askCode('open this record')
        if (!ans) { setBusy(null); return }
        await fetch('/api/vault/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: ans.code }) })
        r = await fetch('/api/vault/records?sign=' + encodeURIComponent(ref), { cache: 'no-store' })
        j = await r.json()
      }
      if (j.ok && j.url) window.open(j.url, '_blank', 'noopener')
      else setErr(j.error || 'Could not open that file.')
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(null)
  }
  if (err) return <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{err}</div>
  if (!data) return <div className="rounded-2xl border border-line bg-white p-8 text-center text-[13px] text-muted">Loading records…</div>
  const needle = q.trim().toLowerCase()
  const hit = (s: string) => !needle || s.toLowerCase().includes(needle)
  const salato = (data.salato || []).filter((v: any) => hit(v.guest + ' ' + v.unit + ' ' + v.id))
  const forms = (data.forms || []).filter((f: any) => hit(f.guest + ' ' + f.unit + ' ' + f.property + ' ' + (f.confirmation || '')))
  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Guest, unit, confirmation…"
          className="w-full rounded-xl border border-line bg-white pl-8 pr-3 py-1.5 text-[12.5px] shadow-soft" />
      </div>
      <div className="rounded-2xl border border-line bg-white shadow-soft">
        <div className="px-4 py-3 border-b border-line/60 flex items-center gap-2">
          <ShieldCheck size={14} className="text-emerald-600" />
          <span className="text-[13px] font-bold text-ink">Salato verifications</span>
          <span className="text-[11.5px] text-muted">{salato.length} completed · ID, selfie and signature open as 10-minute links, each open is on the record</span>
        </div>
        {salato.length ? salato.slice(0, 100).map((v: any) => (
          <div key={v.id} className="px-4 py-2 border-b border-line/40 flex items-center gap-3 flex-wrap text-[12.5px]">
            <span className="font-semibold text-ink">{v.guest || 'Guest'}</span>
            <span className="text-muted">{v.unit}</span>
            <span className="text-[10.5px] uppercase tracking-wider font-bold text-emerald-700">{v.status}</span>
            <span className="text-[11px] text-muted">{String(v.at).slice(0, 10)}</span>
            <span className="grow" />
            {v.files.map((f: any) => (
              <button key={f.ref} onClick={() => open(f.ref)} disabled={busy === f.ref}
                className="rounded-lg border border-line bg-white px-2 py-0.5 text-[11.5px] font-semibold hover:border-brand-300 disabled:opacity-50">
                {busy === f.ref ? 'Opening…' : f.label}
              </button>
            ))}
          </div>
        )) : <div className="px-4 py-6 text-center text-[12.5px] text-muted">No completed verifications yet.</div>}
      </div>
      <div className="rounded-2xl border border-line bg-white shadow-soft">
        <div className="px-4 py-3 border-b border-line/60 flex items-center gap-2">
          <FileText size={14} className="text-brand-600" />
          <span className="text-[13px] font-bold text-ink">Elser registration forms</span>
          <span className="text-[11.5px] text-muted">{forms.length} filed · the exact PDF the building was sent</span>
        </div>
        {forms.length ? forms.slice(0, 100).map((f: any) => (
          <div key={f.id} className="px-4 py-2 border-b border-line/40 flex items-center gap-3 flex-wrap text-[12.5px]">
            <span className="font-semibold text-ink">{f.guest || 'Guest'}</span>
            <span className="text-muted">{f.unit}</span>
            <span className="text-[11px] text-muted">arrives {f.arrival}</span>
            {f.sentAt ? <span className="text-[10.5px] uppercase tracking-wider font-bold text-emerald-700">sent</span> : <span className="text-[10.5px] uppercase tracking-wider font-bold text-amber-700">not sent</span>}
            <span className="grow" />
            <button onClick={() => open(f.ref)} disabled={busy === f.ref}
              className="rounded-lg border border-line bg-white px-2 py-0.5 text-[11.5px] font-semibold hover:border-brand-300 disabled:opacity-50">
              {busy === f.ref ? 'Opening…' : 'Open form'}
            </button>
          </div>
        )) : <div className="px-4 py-6 text-center text-[12.5px] text-muted">No filed forms yet.</div>}
      </div>
      <div className="rounded-2xl border border-dashed border-line bg-white/60 px-4 py-4 text-[12.5px] text-muted">
        <b className="text-ink">Incident reports</b> — the shelf is ready; the incident-report flow lands here the day we build it.
      </div>
    </div>
  )
}

// ── ACTIVITY — per-user app activity (Jon, 2026-08-22): every screen opened and every gated API
// call, metadata only. Read access = the people who can manage users. ──
function ActivityView() {
  const [rows, setRows] = useState<any[]>([])
  const [users, setUsers] = useState<string[]>([])
  const [who, setWho] = useState('')
  const [days, setDays] = useState(7)
  const [state, setState] = useState<'loading' | 'ok' | 'migration' | 'forbidden' | 'error'>('loading')
  const [err, setErr] = useState('')
  const load = useCallback(async (email: string, d: number) => {
    setState('loading')
    try {
      const r = await fetch('/api/activity?days=' + d + (email ? '&email=' + encodeURIComponent(email) : ''), { cache: 'no-store' })
      const j = await r.json()
      if (r.status === 403 || r.status === 401) { setState('forbidden'); setErr(j.message || 'Reading activity needs full access on Users & admin.'); return }
      if (!j.ok) { setState(j.needsMigration ? 'migration' : 'error'); setErr(j.error || ''); return }
      setRows(j.rows || []); setUsers(j.users || []); setState('ok')
    } catch (e: any) { setState('error'); setErr(String(e?.message || e)) }
  }, [])
  useEffect(() => { load(who, days) }, [who, days, load])
  if (state === 'forbidden') return <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">{err}</div>
  if (state === 'migration') return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
      <b>One migration to run:</b> <code>supabase/migrations/047_user_activity.sql</code> in the Supabase SQL editor — activity starts recording the moment the table exists.
    </div>
  )
  const pages = rows.filter(r => r.kind === 'page').length
  const apis = rows.filter(r => r.kind === 'api').length
  const refused = rows.filter(r => r.allowed === false).length
  const fmtAt = (s: string) => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={who} onChange={e => setWho(e.target.value)} className="rounded-xl border border-line bg-white px-2.5 py-1.5 text-[12.5px] shadow-soft">
          <option value="">Everyone</option>
          {users.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={days} onChange={e => setDays(Number(e.target.value))} className="rounded-xl border border-line bg-white px-2.5 py-1.5 text-[12.5px] shadow-soft">
          <option value={1}>Today-ish (24h)</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option>
        </select>
        <span className="text-[12px] text-muted">{pages} screens · {apis} actions{refused ? <span className="text-rose-700 font-semibold"> · {refused} refused</span> : ''}</span>
        <span className="grow" />
        <button onClick={() => load(who, days)} className="rounded-xl border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold shadow-soft inline-flex items-center gap-1.5"><RefreshCw size={12} /> Refresh</button>
      </div>
      {state === 'error' ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{err}</div> : null}
      <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
        {state === 'loading' ? <div className="px-4 py-8 text-center text-[12.5px] text-muted">Loading…</div>
          : rows.length ? rows.slice(0, 400).map((r, i) => (
            <div key={i} className="px-4 py-1.5 border-b border-line/40 flex items-center gap-2.5 text-[12.5px]">
              <span className="text-[11px] text-muted tabular-nums w-[110px] shrink-0">{fmtAt(r.at)}</span>
              {!who ? <span className="text-[11.5px] font-semibold text-ink truncate max-w-[180px]">{r.email}</span> : null}
              <span className={'text-[10px] uppercase tracking-wider font-bold ' + (r.kind === 'page' ? 'text-sky-700' : 'text-violet-700')}>{r.kind}</span>
              <span className="text-ink truncate">{r.kind === 'page' ? r.path : (r.feature || '') + (r.need ? ' · ' + r.need : '')}</span>
              {r.allowed === false ? <span className="text-[10px] uppercase font-bold text-rose-700">refused</span> : null}
              {r.meta?.ip ? <span className="ml-auto text-[10.5px] text-muted">{r.meta.ip}</span> : null}
            </div>
          )) : <div className="px-4 py-8 text-center text-[12.5px] text-muted">Nothing recorded in this window yet — activity starts collecting from the moment the migration runs.</div>}
      </div>
      <p className="text-[11px] text-muted">Metadata only: who, which screen or feature, when, and with how much power. What was typed or shown is never stored. Vault reveals keep their own separate log on each item.</p>
    </div>
  )
}

export function VaultBoard() {
  const [view, setView] = useState<'vault' | 'records' | 'activity' | 'log'>('vault')
  const [isAdmin, setIsAdmin] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [codeSet, setCodeSet] = useState(true)
  const [importState, setImportState] = useState<any | null>(null)

  // THE VAULT CODE PROMPT. One modal, promise-based: whoever needs the code awaits askCode(), the
  // modal resolves with what was typed (or null). The code lives in this component's memory only
  // for the length of that one request — it is asked again next time, on purpose (Jon, 2026-08-25).
  const [collections, setCollections] = useState<Collection[]>([])
  const [vault, setVault] = useState<string>('')          // '' = every vault I can open
  const [openShelves, setOpenShelves] = useState<Record<string, boolean>>({})
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [menuFor, setMenuFor] = useState<string | null>(null)

  // THE UNLOCK WINDOW. `until` is a timestamp the server gave us; the countdown here is only a
  // display — the server re-checks its own signed cookie on every single reveal.
  const [until, setUntil] = useState<number>(0)
  const [now, setNow] = useState<number>(() => Date.now())
  const [codeReq, setCodeReq] = useState<{ purpose: string; askReason: boolean; resolve: (a: CodeAnswer) => void } | null>(null)
  const askCode = useCallback<AskCode>((purpose, opts) => new Promise<CodeAnswer>(resolve => {
    setCodeReq({ purpose, askReason: !!opts?.askReason, resolve })
  }), [])
  const answerCode = (a: CodeAnswer) => { const r = codeReq; setCodeReq(null); r?.resolve(a) }
  const [items, setItems] = useState<Item[]>([])
  const [grants, setGrants] = useState<Grant[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [keyReady, setKeyReady] = useState(true)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [form, setForm] = useState<any | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [openShare, setOpenShare] = useState<string | null>(null)

  // Revealed plaintext lives ONLY here, in memory, keyed by item, and is wiped on a timer. It is
  // never written to state that gets persisted, to localStorage, or to the URL.
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const timers = useRef<Record<string, any>>({})

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const r = await fetch('/api/vault', { cache: 'no-store' })
      const j = await r.json()
      setItems(Array.isArray(j.items) ? j.items : [])
      setGrants(Array.isArray(j.grants) ? j.grants : [])
      setNeedsMigration(!!j.needsMigration)
      setKeyReady(j.keyReady !== false)
      setIsAdmin(!!j.isAdmin); setIsOwner(!!j.isOwner); setCodeSet(j.codeSet !== false)
      setCollections(Array.isArray(j.collections) ? j.collections : [])
      if (!j.ok && !j.needsMigration && j.error) setErr(j.error)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // A reload should not claim to be locked while the server cookie is still alive.
  useEffect(() => {
    fetch('/api/vault/unlock', { cache: 'no-store' }).then(r => r.json())
      .then(j => { if (j.ok && j.open) setUntil(Date.now() + (j.seconds || 60) * 1000) })
      .catch(() => {})
  }, [])

  // One ticker for the countdown. Stops the moment the window closes, so an idle page is idle.
  const openFor = Math.max(0, Math.ceil((until - now) / 1000))
  useEffect(() => {
    if (until <= Date.now()) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [until])

  // Wipe every revealed secret when the component goes away, and clear pending timers so a
  // navigation cannot leave one sitting in memory waiting to be re-rendered.
  useEffect(() => () => {
    Object.values(timers.current).forEach(t => clearTimeout(t))
    timers.current = {}
  }, [])

  // Anything revealed is hidden again the moment the tab loses focus — the laptop-left-open case.
  useEffect(() => {
    const onHide = () => { if (document.hidden) hideAll() }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [])

  function hideAll() {
    Object.values(timers.current).forEach(t => clearTimeout(t))
    timers.current = {}
    setRevealed({})
  }

  // Shelf order, then A–Z inside a shelf. Old/unused sinks to the bottom; unknown categories land
  // just above it so nothing ever disappears because of a label.
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rank = (c: string) => (c in CAT_ORDER ? CAT_ORDER[c] : CATEGORIES.length - 1.5)
    return items.filter(i => {
      if (vault === PRIVATE) { if (i.collection_id) return false }
      else if (vault && i.collection_id !== vault) return false
      if (cat && i.category !== cat) return false
      if (!needle) return true
      return (i.title + ' ' + (i.description || '') + ' ' + (i.username || '') + ' ' +
        (i.doc_name || '') + ' ' + (i.property_id || '') + ' ' + (i.unit_no || '') + ' ' +
        (i.tags || []).join(' ')).toLowerCase().includes(needle)
    }).sort((a, b) => rank(a.category) - rank(b.category) || a.title.localeCompare(b.title))
  }, [items, q, cat, vault])

  // Shelves in render order, with their counts — the jump bar and the headers read from this one list.
  const shelves = useMemo(() => {
    const out: { id: string; label: string; items: Item[] }[] = []
    for (const i of shown) {
      const last = out[out.length - 1]
      if (last && last.id === i.category) last.items.push(i)
      else out.push({ id: i.category, label: CATEGORIES.find(c => c.id === i.category)?.label || i.category, items: [i] })
    }
    return out
  }, [shown])

  // Collapsed unless the person opened it, unless they are searching — a search that hides its own
  // hits behind closed shelves is worse than no search.
  const searching = !!q.trim() || !!cat
  const isOpen = (id: string) => searching || !!openShelves[id]
  const pickedIds = Object.keys(picked).filter(k => picked[k])
  const vaultName = (id?: string | null) =>
    !id ? 'Private' : (collections.find(c => c.id === id)?.name || 'Vault')

  async function moveTo(collectionId: string | null) {
    if (!pickedIds.length) return
    setErr(null); setMsg(null)
    try {
      const j = await fetch('/api/vault/collections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move', ids: pickedIds, collection_id: collectionId }),
      }).then(r => r.json())
      if (!j.ok) throw new Error(j.error || 'Could not move those.')
      setPicked({})
      setMsg('Moved ' + j.moved + ' to ' + (collectionId ? vaultName(collectionId) : 'Private (owner only)') +
        (j.refused?.length ? ' · ' + j.refused.length + ' skipped (not yours to move)' : ''))
      load()
    } catch (e: any) { setErr(e.message || String(e)) }
  }

  const expiring = useMemo(
    () => items.filter(i => { const d = daysUntil(i.expires_on); return d !== null && d <= 30 }).sort(
      (a, b) => (daysUntil(a.expires_on) ?? 0) - (daysUntil(b.expires_on) ?? 0)),
    [items])

  /** Open the window. One code entry buys 60 seconds of clicking — never of automatic revealing. */
  async function unlock(): Promise<boolean> {
    setErr(null)
    const ans = await askCode('unlock the vault for a minute')
    if (!ans) return false
    try {
      const j = await fetch('/api/vault/unlock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ code: ans.code }),
      }).then(x => x.json())
      if (!j.ok) throw new Error(j.error || 'Could not unlock.')
      setUntil(Date.now() + (j.seconds || 60) * 1000); setNow(Date.now())
      return true
    } catch (e: any) { setErr(e.message || String(e)); return false }
  }

  async function lockNow() {
    hideAll(); setUntil(0)
    try { await fetch('/api/vault/unlock', { method: 'DELETE' }) } catch {}
  }

  async function reveal(i: Item) {
    setErr(null)
    if (revealed[i.id]) { // second click hides it again
      clearTimeout(timers.current[i.id]); delete timers.current[i.id]
      setRevealed(r => { const n = { ...r }; delete n[i.id]; return n })
      return
    }
    // Locked? Ask once, then carry on with the click they already made — being sent back to press
    // Reveal a second time is the kind of small rudeness that makes people write codes on paper.
    if (until <= Date.now() && !(await unlock())) return
    try {
      const j = await fetch('/api/vault/reveal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ id: i.id }),
      }).then(x => x.json())
      if (!j.ok) { if (j.locked) setUntil(0); throw new Error(j.error || 'Could not open that.') }
      setRevealed(r => ({ ...r, [i.id]: j.secret }))
      // Auto-hide. Long enough to read and type, short enough that walking away is safe.
      timers.current[i.id] = setTimeout(() => {
        setRevealed(r => { const n = { ...r }; delete n[i.id]; return n })
        delete timers.current[i.id]
      }, 45000)
    } catch (e: any) { setErr(e.message || String(e)) }
  }

  async function copySecret(i: Item) {
    setErr(null); setMsg(null)
    try {
      let val = revealed[i.id]
      if (!val) {
        if (until <= Date.now() && !(await unlock())) return
        val = await fetch('/api/vault/reveal', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
          body: JSON.stringify({ id: i.id, reason: 'copied to clipboard' }),
        }).then(x => x.json()).then(j => { if (!j.ok) { if (j.locked) setUntil(0); throw new Error(j.error) } return j.secret as string })
      }
      await navigator.clipboard.writeText(val)
      setMsg('Copied. Your clipboard now holds it — paste it and move on.')
    } catch (e: any) { setErr(e.message || String(e)) }
  }

  async function openFile(i: Item) {
    setErr(null)
    if (until <= Date.now() && !(await unlock())) return
    try {
      const j = await fetch('/api/vault/file?id=' + encodeURIComponent(i.id), { cache: 'no-store' }).then(x => x.json())
      if (!j.ok || !j.url) throw new Error(j.error || 'Could not open that file.')
      window.open(j.url, '_blank', 'noopener')
    } catch (e: any) { setErr(e.message || String(e)) }
  }

  async function save() {
    if (!form) return
    setSaving(true); setErr(null); setMsg(null)
    try {
      const body: any = { ...form }
      if (editing) body.id = editing
      // Don't send an empty secret on an edit — that would look like "clear it".
      if (editing && !form.secret) delete body.secret
      const r = await fetch('/api/vault', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'Could not save.')
      setForm(null); setEditing(null); setMsg(editing ? 'Saved.' : 'Stored.')
      load()
    } catch (e: any) { setErr(e.message || String(e)) } finally { setSaving(false) }
  }

  async function upload(itemId: string | null, file: File) {
    setErr(null); setMsg(null)
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('That file is larger than 25 MB.')
      const b64: string = await new Promise((res, rej) => {
        const fr = new FileReader()
        fr.onload = () => { const s = String(fr.result || ''); res(s.slice(s.indexOf(',') + 1)) }
        fr.onerror = () => rej(new Error('Could not read that file.'))
        fr.readAsDataURL(file)
      })
      const j = await fetch('/api/vault/file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: itemId || undefined, name: file.name, mime: file.type || 'application/octet-stream',
          fileBase64: b64, category: form?.category || cat || 'company',
          title: form?.title || file.name, property_id: form?.property_id || '', unit_no: form?.unit_no || '',
          expires_on: form?.expires_on || '',
        }),
      }).then(x => x.json())
      if (!j.ok) throw new Error(j.error || 'Could not store that file.')
      setMsg('Filed.'); setForm(null); setEditing(null); load()
    } catch (e: any) { setErr(e.message || String(e)) }
  }

  // IMPORT — a CSV of logins (title, username, password, url, category, building, unit, notes,
  // tags). Read in the browser, previewed first, then sent with the vault code. Nothing is written
  // until the person has seen the preview and pressed Import.
  async function pickImport(file: File) {
    setErr(null); setMsg(null)
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('That file is larger than 4 MB.')
      const csv = await file.text()
      // Import is admin-gated and logged, not code-gated: it writes entries, it never reveals one.
      const j = await fetch('/api/vault/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, dryRun: true }),
      }).then(x => x.json())
      if (!j.ok) throw new Error(j.error || 'Could not read that file.')
      setImportState({ name: file.name, csv, preview: j })
    } catch (e: any) { setErr(e.message || String(e)) }
  }

  async function runImport() {
    if (!importState) return
    setSaving(true); setErr(null); setMsg(null)
    try {
      const j = await fetch('/api/vault/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: importState.csv }),
      }).then(x => x.json())
      if (!j.ok) throw new Error(j.error || 'Import failed.')
      setImportState(null)
      setMsg('Imported ' + j.created + (j.skipped ? ' · ' + j.skipped + ' already in the vault (skipped)' : '') + '. A backup snapshot was written.')
      load()
    } catch (e: any) { setErr(e.message || String(e)) } finally { setSaving(false) }
  }

  async function remove(i: Item) {
    if (!window.confirm('Delete "' + i.title + '"? It stops appearing here, and the audit trail keeps a record.')) return
    setErr(null)
    try {
      const j = await fetch('/api/vault?id=' + encodeURIComponent(i.id), { method: 'DELETE' }).then(x => x.json())
      if (!j.ok) throw new Error(j.error || 'Could not delete.')
      load()
    } catch (e: any) { setErr(e.message || String(e)) }
  }

  function startEdit(i: Item) {
    setEditing(i.id)
    setForm({
      kind: i.kind, category: i.category, title: i.title, description: i.description || '',
      username: i.username || '', url: i.url || '', secret: '',
      property_id: i.property_id || '', unit_no: i.unit_no || '', expires_on: (i.expires_on || '').slice(0, 10),
    })
  }

  const KindIcon = ({ k }: { k: Item['kind'] }) =>
    k === 'file' ? <FileText size={13} /> : k === 'note' ? <StickyNote size={13} /> : <KeyRound size={13} />

  return (
    <div className="space-y-4">
      {/* Vault = the locked shelf · Records = the verification paper trail · Activity = who did what */}
      <div className="flex items-center rounded-xl border border-line bg-neutral-50 overflow-hidden w-fit">
        {([['vault', 'Vault'], ['records', 'Records'], ['activity', 'Activity'], ['log', 'Code log & backups']] as const).filter(([k]) => k !== 'log' || isAdmin).map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            className={'px-3.5 py-1.5 text-[12.5px] font-semibold ' + (view === k ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
            {label}
          </button>
        ))}
      </div>
      {codeReq && <CodePrompt purpose={codeReq.purpose} askReason={codeReq.askReason} onAnswer={answerCode} />}
      {view === 'records' && <RecordsView askCode={askCode} />}
      {view === 'activity' && <ActivityView />}
      {view === 'log' && <><VaultsPanel collections={collections} onChanged={load} /><CodeLogView askCode={askCode} canExport={isOwner} /></>}
      {view === 'vault' && <>
      {!codeSet && !needsMigration && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          <div className="font-semibold flex items-center gap-1.5"><Lock size={14} /> The vault code is not set</div>
          <p className="mt-1">
            Nothing here can be revealed until an admin sets the vault code at <a href="/users" className="underline font-semibold">Users &amp; admin → Share links &amp; security</a>.
            Once set, every reveal asks for it and records who entered it.
          </p>
        </div>
      )}
      {needsMigration && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          <div className="font-semibold flex items-center gap-1.5"><AlertTriangle size={14} /> One migration to run first</div>
          <p className="mt-1">
            Run <code>supabase/migrations/017_vault.sql</code> in the Supabase SQL editor, then reload.
            If it still says this afterwards, run <code>NOTIFY pgrst, &apos;reload schema&apos;;</code> too.
          </p>
        </div>
      )}
      {!keyReady && !needsMigration && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          <div className="font-semibold flex items-center gap-1.5"><AlertTriangle size={14} /> VAULT_KEY is not set</div>
          <p className="mt-1">
            Files can be stored, but typed secrets cannot be encrypted until <code>VAULT_KEY</code> is added
            to the Vercel environment. Generate one with <code>openssl rand -hex 32</code>. Changing it later
            makes everything stored under the old key unreadable, so set it once and keep it.
          </p>
        </div>
      )}

      {/* THE LOCK BAR — one code entry buys a minute of clicking. Revealing stays a per-item click,
          and every click is still its own line in the log. */}
      {codeSet && (
        <div className={'rounded-2xl border px-4 py-2.5 flex items-center gap-3 flex-wrap ' +
          (openFor > 0 ? 'border-emerald-300 bg-emerald-50' : 'border-line bg-white')}>
          {openFor > 0 ? (
            <>
              <Unlock size={15} className="text-emerald-700 shrink-0" />
              <span className="text-[13px] font-semibold text-emerald-900">Unlocked</span>
              <span className="text-[12.5px] text-emerald-800 tabular-nums">
                {openFor}s left — click Reveal on anything you need
              </span>
              <div className="h-1.5 w-24 rounded-full bg-emerald-200 overflow-hidden" aria-hidden>
                <div className="h-full bg-emerald-600 transition-all duration-500" style={{ width: Math.round((openFor / 60) * 100) + '%' }} />
              </div>
              <span className="grow" />
              <button onClick={lockNow}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-emerald-900">
                <Lock size={13} /> Lock now
              </button>
            </>
          ) : (
            <>
              <Lock size={15} className="text-muted shrink-0" />
              <span className="text-[13px] font-semibold text-ink">Locked</span>
              <span className="text-[12.5px] text-muted">Enter the code once for a minute of access. Every reveal is still a click, and still recorded.</span>
              <span className="grow" />
              <button onClick={unlock}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12.5px] font-semibold hover:bg-brand-700">
                <Unlock size={13} /> Unlock
              </button>
            </>
          )}
        </div>
      )}

      {/* WHICH VAULT. Private = filed nowhere: you and whoever you named on the item itself. */}
      {(collections.length > 0 || isAdmin) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <FolderLock size={14} className="text-muted shrink-0" />
          {([['', 'Everything'], [PRIVATE, 'Private']] as const).map(([id, label]) => (
            <button key={id || 'all'} onClick={() => setVault(id)}
              className={'rounded-full px-3 py-1 text-[12.5px] font-semibold border ' +
                (vault === id ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>
              {label}{id === PRIVATE ? ' · ' + items.filter(x => !x.collection_id).length : ''}
            </button>
          ))}
          {collections.map(c => (
            <button key={c.id} onClick={() => setVault(c.id)}
              className={'rounded-full px-3 py-1 text-[12.5px] font-semibold border ' +
                (vault === c.id ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}
              title={(c.roles || []).length ? 'Open to roles: ' + c.roles.join(', ') : 'Named members only'}>
              {c.name} · {items.filter(x => x.collection_id === c.id).length}
            </button>
          ))}
          {isAdmin && (
            <button onClick={() => setView('log')} className="text-[12px] font-semibold text-brand-700 hover:underline ml-1">Manage vaults</button>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => { setForm({ ...EMPTY, category: cat || 'building' }); setEditing(null) }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[13px] font-semibold hover:bg-brand-700">
          <Plus size={14} /> New item
        </button>
        {/* A 256px box wrapped onto its own line on a phone and then used two thirds of it. */}
        <div className="relative w-full sm:w-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the vault…"
            className="rounded-lg border border-line bg-white pl-8 pr-3 py-1.5 text-[13px] w-full sm:w-64 outline-none focus:border-brand-400" />
        </div>
        <select value={cat} onChange={e => setCat(e.target.value)}
          className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink">
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <button onClick={load} className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink">
          <RefreshCw size={13} /> Refresh
        </button>
        {isAdmin && (
          <label className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink cursor-pointer" title="Import logins from a CSV (title, username, password, url, category, building, notes)">
            <Upload size={13} /> Import CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pickImport(f) }} />
          </label>
        )}
        {Object.keys(revealed).length > 0 && (
          <button onClick={hideAll}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-900">
            <EyeOff size={13} /> Hide {Object.keys(revealed).length} revealed
          </button>
        )}
      </div>

      {err && <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{err}</div>}
      {msg && <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">{msg}</div>}

      {expiring.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          <div className="font-semibold flex items-center gap-1.5"><Clock size={14} /> Expiring soon</div>
          <ul className="mt-1 space-y-0.5">
            {expiring.map(i => {
              const d = daysUntil(i.expires_on)!
              return (
                <li key={i.id}>
                  <strong>{i.title}</strong> — {d < 0 ? 'expired ' + Math.abs(d) + ' days ago' : d === 0 ? 'expires today' : 'expires in ' + d + ' days'} ({fmtDate(i.expires_on)})
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {importState && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50/40 p-4 space-y-2">
          <div className="text-[13px] font-bold text-ink flex items-center gap-1.5"><Upload size={14} /> Import preview — {importState.name}</div>
          <div className="text-[12.5px] text-ink">
            {importState.preview.total} logins found · {importState.preview.rows.filter((r: any) => r.hasPassword).length} with a password
            {importState.preview.problems?.length ? ' · ' + importState.preview.problems.length + ' note' + (importState.preview.problems.length === 1 ? '' : 's') : ''}.
            Rows whose name + username are already in the vault are skipped, so running this twice never doubles anything.
          </div>
          <div className="text-[12px] text-muted flex flex-wrap gap-x-3 gap-y-0.5">
            {CATEGORIES.map(c => { const n = importState.preview.rows.filter((r: any) => r.category === c.id).length; return n ? <span key={c.id}><b className="text-ink">{n}</b> {c.label}</span> : null })}
            {(() => { const n = importState.preview.rows.filter((r: any) => !CAT_ORDER.hasOwnProperty(r.category)).length; return n ? <span><b className="text-ink">{n}</b> unknown shelf → Company &amp; legal</span> : null })()}
          </div>
          {importState.preview.problems?.length ? (
            <ul className="text-[11.5px] text-amber-800 max-h-32 overflow-auto space-y-0.5">
              {importState.preview.problems.slice(0, 40).map((p: string, n: number) => <li key={n}>{p}</li>)}
            </ul>
          ) : null}
          <div className="max-h-56 overflow-auto rounded-lg border border-line bg-white">
            {importState.preview.rows.slice(0, 300).map((r: any, n: number) => (
              <div key={n} className="px-3 py-1 border-b border-line/40 text-[12px] flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider font-bold text-muted w-24 shrink-0 truncate">{CATEGORIES.find(c => c.id === r.category)?.label || r.category}</span>
                <span className="font-semibold text-ink truncate">{r.title}</span>
                <span className="text-muted truncate">{r.username}</span>
                <span className="ml-auto text-[10.5px] text-muted shrink-0">{r.hasPassword ? '••••' : r.kind}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={runImport} disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-40">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Import {importState.preview.total} into the vault
            </button>
            <button onClick={() => setImportState(null)} className="text-[13px] font-semibold px-3 py-1.5 rounded-lg border border-line text-muted hover:text-ink">Cancel</button>
          </div>
        </div>
      )}

      {form && (
        <div className="rounded-2xl border border-line bg-white p-4 space-y-3">
          <div className="text-[13px] font-bold text-ink">{editing ? 'Edit item' : 'New vault item'}</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <span className={lbl}>Type</span>
              <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className={field}>
                <option value="secret">Secret — code, password, account number</option>
                <option value="file">Document</option>
                <option value="note">Note</option>
              </select>
            </div>
            <div>
              <span className={lbl}>Category</span>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className={field}>
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <span className={lbl}>Expires</span>
              <input type="date" value={form.expires_on} onChange={e => setForm({ ...form, expires_on: e.target.value })} className={field} />
            </div>
          </div>
          <div>
            <span className={lbl}>Name *</span>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className={field}
              placeholder="e.g. Elser loading dock code, or 2026 certificate of insurance" />
          </div>
          {form.kind === 'secret' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <span className={lbl}>Username</span>
                <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} className={field} />
              </div>
              <div>
                <span className={lbl}>{editing ? 'New secret (blank = unchanged)' : 'Secret *'}</span>
                {/* type=password so it is not shoulder-read while typing; autoComplete off so the
                    browser's own password manager never offers to remember it. */}
                <input type="password" autoComplete="new-password" value={form.secret}
                  onChange={e => setForm({ ...form, secret: e.target.value })} className={field} />
              </div>
              <div>
                <span className={lbl}>Link</span>
                <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} className={field} placeholder="portal URL" />
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><span className={lbl}>Building</span><input value={form.property_id} onChange={e => setForm({ ...form, property_id: e.target.value })} className={field} placeholder="elser, salato…" /></div>
            <div><span className={lbl}>Unit</span><input value={form.unit_no} onChange={e => setForm({ ...form, unit_no: e.target.value })} className={field} /></div>
          </div>
          <div>
            <span className={lbl}>Notes</span>
            <textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={field + ' font-sans'} />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={save} disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-40">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {editing ? 'Save changes' : 'Store it'}
            </button>
            {form.kind === 'file' && (
              <label className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-3 py-1.5 rounded-lg border border-line text-muted hover:text-ink cursor-pointer">
                <Upload size={13} /> Choose file…
                <input type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(editing, f) }} />
              </label>
            )}
            <button onClick={() => { setForm(null); setEditing(null) }}
              className="text-[13px] font-semibold px-3 py-1.5 rounded-lg border border-line text-muted hover:text-ink">Cancel</button>
          </div>
        </div>
      )}

      {/* JUMP BAR — 94 items is too many to scroll for; this is the table of contents. */}
      {shelves.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
          {shelves.map(sh => (
            <button key={sh.id} onClick={() => setOpenShelves(o => ({ ...o, [sh.id]: true }))}
              className="rounded-lg border border-line bg-white px-2 py-1 font-semibold text-muted hover:text-ink hover:border-brand-300">
              {sh.label} <span className="text-ink">{sh.items.length}</span>
            </button>
          ))}
          <button onClick={() => setOpenShelves(Object.fromEntries(shelves.map(sh => [sh.id, true])))}
            className="px-2 py-1 font-semibold text-brand-700 hover:underline">Open all</button>
          <button onClick={() => setOpenShelves({})}
            className="px-2 py-1 font-semibold text-muted hover:text-ink">Collapse all</button>
        </div>
      )}

      {/* BULK BAR — only when something is ticked, so it never sits there as furniture. */}
      {pickedIds.length > 0 && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50/50 px-4 py-2.5 flex items-center gap-2 flex-wrap">
          <ArrowRightLeft size={14} className="text-brand-700" />
          <span className="text-[13px] font-semibold text-ink">{pickedIds.length} selected</span>
          <span className="text-[12.5px] text-muted">Move to</span>
          {collections.map(c => (
            <button key={c.id} onClick={() => moveTo(c.id)}
              className="rounded-lg border border-line bg-white px-2.5 py-1 text-[12.5px] font-semibold hover:border-brand-300">{c.name}</button>
          ))}
          <button onClick={() => moveTo(null)}
            className="rounded-lg border border-line bg-white px-2.5 py-1 text-[12.5px] font-semibold hover:border-brand-300">Private</button>
          <span className="grow" />
          <button onClick={() => setPicked({})} className="text-[12.5px] font-semibold text-muted hover:text-ink">Clear</button>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-white overflow-hidden">
        {loading && items.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-muted"><Loader2 size={16} className="animate-spin inline mr-2" /> Loading…</div>
        ) : shown.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-muted">
            {items.length === 0 ? 'Nothing in the vault yet. Start with the codes people keep asking you for.' : 'Nothing matches that.'}
          </div>
        ) : shelves.map(sh => (
          <div key={sh.id}>
            <button onClick={() => setOpenShelves(o => ({ ...o, [sh.id]: !o[sh.id] }))}
              className={'w-full flex items-center gap-2 px-4 py-2 border-b border-line/60 text-left ' +
                (sh.id === 'archive' ? 'bg-neutral-100' : 'bg-app')}>
              {isOpen(sh.id) ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
              <span className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted">{sh.label}</span>
              <span className="text-[12px] font-semibold text-ink">{sh.items.length}</span>
              {!isOpen(sh.id) && (
                <span className="text-[11.5px] text-muted truncate hidden sm:block">
                  {sh.items.slice(0, 4).map(x => x.title).join(' · ')}{sh.items.length > 4 ? ' …' : ''}
                </span>
              )}
            </button>

            {isOpen(sh.id) && sh.items.map(i => {
              const mine = grants.filter(g => g.item_id === i.id)
              const d = daysUntil(i.expires_on)
              const canMove = i.level === 'manage'
              return (
                <div key={i.id} className="border-b border-line/60 last:border-b-0">
                  <div className="flex items-start gap-2.5 px-4 py-2.5 flex-wrap">
                    {canMove && (
                      <input type="checkbox" checked={!!picked[i.id]} aria-label={'Select ' + i.title}
                        onChange={e => setPicked(pk => ({ ...pk, [i.id]: e.target.checked }))}
                        className="mt-1 shrink-0 accent-brand-600 w-3.5 h-3.5" />
                    )}
                    <span className="mt-0.5 text-muted shrink-0"><KindIcon k={i.kind} /></span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-ink">{i.title}</span>
                        {i.property_id && (
                          <button onClick={() => setQ(i.property_id || '')}
                            className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 hover:bg-sky-100">
                            {i.property_id}{i.unit_no ? ' ' + i.unit_no : ''}
                          </button>
                        )}
                        {i.collection_id
                          ? <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">{vaultName(i.collection_id)}</span>
                          : <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-neutral-100 text-muted border border-line">Private</span>}
                        {mine.length > 0 && (
                          <span className="text-[10.5px] text-muted inline-flex items-center gap-1"><Users size={11} /> {mine.length}</span>
                        )}
                        {i.level === 'view' && <span className="text-[10px] uppercase tracking-wider font-semibold text-muted">read-only</span>}
                        {d !== null && d <= 30 && (
                          <span className={'text-[10px] uppercase tracking-wider font-semibold ' + (d < 0 ? 'text-rose-600' : 'text-amber-700')}>
                            {d < 0 ? 'expired' : 'expires ' + fmtDate(i.expires_on)}
                          </span>
                        )}
                      </div>

                      {/* Username and the masked hint on one quiet line. The shelf name is gone —
                          the header three rows up already said it. */}
                      <div className="text-[12px] text-muted mt-0.5 flex items-center gap-2 flex-wrap">
                        {i.username && <span className="font-mono text-[11.5px]">{i.username}</span>}
                        {i.hasSecret && (
                          <code className={'text-[12px] px-1.5 py-0.5 rounded border ' + (revealed[i.id]
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-900 font-semibold'
                            : 'border-line bg-app text-muted')}>
                            {revealed[i.id] || i.secret_hint || '••••••••'}
                          </code>
                        )}
                        {revealed[i.id] && <span className="text-[10.5px] text-emerald-700">hides itself shortly</span>}
                        {i.hasFile && i.doc_name && <span>{i.doc_name}{i.doc_bytes ? ' (' + fmtBytes(i.doc_bytes) + ')' : ''}</span>}
                      </div>

                      {i.description && <div className="text-[12px] text-ink/70 mt-1 whitespace-pre-wrap">{i.description}</div>}
                    </div>

                    {/* Reveal and Copy stay on the row. Everything else lives behind the ⋯ */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {i.hasSecret && (
                        <>
                          <button onClick={() => reveal(i)}
                            className={'inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border ' +
                              (revealed[i.id] ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-line text-muted hover:text-ink')}>
                            {revealed[i.id] ? <><EyeOff size={13} /> Hide</> : <><Eye size={13} /> Reveal</>}
                          </button>
                          <button onClick={() => copySecret(i)} title="Copy"
                            className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink">
                            <Copy size={13} />
                          </button>
                        </>
                      )}
                      {i.hasFile && (
                        <button onClick={() => openFile(i)}
                          className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                          <Download size={13} /> Open
                        </button>
                      )}
                      <div className="relative">
                        <button onClick={() => setMenuFor(menuFor === i.id ? null : i.id)} title="More"
                          className="inline-flex items-center px-2 py-1.5 rounded-lg border border-line text-muted hover:text-ink">
                          <MoreHorizontal size={14} />
                        </button>
                        {menuFor === i.id && (
                          <div className="absolute right-0 top-full mt-1 z-20 w-52 rounded-xl border border-line bg-white shadow-lg py-1 text-[12.5px]">
                            {i.url && (
                              <a href={i.url} target="_blank" rel="noopener noreferrer" onClick={() => setMenuFor(null)}
                                className="block px-3 py-1.5 hover:bg-app font-semibold text-ink">Open portal ↗</a>
                            )}
                            {i.level === 'manage' && <>
                              <button onClick={() => { setOpenShare(openShare === i.id ? null : i.id); setMenuFor(null) }}
                                className="block w-full text-left px-3 py-1.5 hover:bg-app font-semibold text-ink">Share with someone…</button>
                              <button onClick={() => { startEdit(i); setMenuFor(null) }}
                                className="block w-full text-left px-3 py-1.5 hover:bg-app font-semibold text-ink">Edit</button>
                              <div className="border-t border-line/60 my-1" />
                              <div className="px-3 py-1 text-[10.5px] uppercase tracking-wider text-muted font-bold">Move to vault</div>
                              {collections.map(c => (
                                <button key={c.id} onClick={() => { setPicked({ [i.id]: true }); setMenuFor(null); moveTo(c.id) }}
                                  className="block w-full text-left px-3 py-1.5 hover:bg-app text-ink">{c.name}</button>
                              ))}
                              <button onClick={() => { setPicked({ [i.id]: true }); setMenuFor(null); moveTo(null) }}
                                className="block w-full text-left px-3 py-1.5 hover:bg-app text-ink">Private (owner only)</button>
                              <div className="border-t border-line/60 my-1" />
                              <button onClick={() => { setMenuFor(null); remove(i) }}
                                className="block w-full text-left px-3 py-1.5 hover:bg-rose-50 font-semibold text-rose-700">Delete</button>
                            </>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {openShare === i.id && <SharePanel itemId={i.id} onClose={() => setOpenShare(null)} onChanged={load} />}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted flex items-center gap-1.5">
        <ShieldCheck size={12} /> Secrets are encrypted before they are stored and are never included when this list loads.
        The code opens a one-minute window; revealing is still a click per item, and every click is recorded against your name.
        A sealed backup is written after every change.
      </p>
      </>}
    </div>
  )
}

/** Who else can open this, and who already has. */
function SharePanel({ itemId, onClose, onChanged }: { itemId: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ grants: any[]; log: any[] } | null>(null)
  const [email, setEmail] = useState('')
  const [level, setLevel] = useState('view')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)

  const load = useCallback(async () => {
    try {
      const j = await fetch('/api/vault/grants?id=' + encodeURIComponent(itemId), { cache: 'no-store' }).then(r => r.json())
      if (!j.ok) throw new Error(j.error || 'Could not load sharing.')
      setData({ grants: j.grants || [], log: j.log || [] })
    } catch (e: any) { setErr(e.message || String(e)) }
  }, [itemId])
  useEffect(() => { load() }, [load])

  async function add() {
    setBusy(true); setErr(null)
    try {
      const j = await fetch('/api/vault/grants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: itemId, email, level }),
      }).then(r => r.json())
      if (!j.ok) throw new Error(j.error || 'Could not share.')
      setEmail(''); load(); onChanged()
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  async function revoke(who: string) {
    setErr(null)
    try {
      const j = await fetch('/api/vault/grants?id=' + encodeURIComponent(itemId) + '&email=' + encodeURIComponent(who), { method: 'DELETE' }).then(r => r.json())
      if (!j.ok) throw new Error(j.error || 'Could not revoke.')
      load(); onChanged()
    } catch (e: any) { setErr(e.message || String(e)) }
  }

  return (
    <div className="px-4 pb-4">
      <div className="rounded-xl border border-line bg-app/60 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-bold text-ink">Who can open this</span>
          <button onClick={onClose} className="p-1 rounded text-muted hover:text-ink"><X size={14} /></button>
        </div>
        {err && <div className="text-[12px] text-rose-700">{err}</div>}
        {!data ? <div className="text-[12px] text-muted">Loading…</div> : (
          <>
            {data.grants.length === 0
              ? <div className="text-[12px] text-muted">Nobody else. Only you and the workspace owner.</div>
              : (
                <ul className="space-y-1">
                  {data.grants.map(g => (
                    <li key={g.email} className="flex items-center gap-2 text-[12px]">
                      <span className="text-ink">{g.email}</span>
                      <span className="text-muted">{g.level}</span>
                      <button onClick={() => revoke(g.email)} className="text-muted hover:text-rose-600 ml-auto">Revoke</button>
                    </li>
                  ))}
                </ul>
              )}
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <input value={email} onChange={e => setEmail(e.target.value)} placeholder="name@stay-hospitality.com"
                className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] w-64 outline-none focus:border-brand-400" />
              <select value={level} onChange={e => setLevel(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1.5 text-[12px]">
                <option value="view">can open</option>
                <option value="manage">can manage</option>
              </select>
              <button onClick={add} disabled={busy || !email.trim()}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40">
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Share
              </button>
            </div>
            <button onClick={() => setShowLog(v => !v)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-ink pt-1">
              <History size={12} /> {showLog ? 'Hide' : 'Show'} access history ({data.log.length})
            </button>
            {showLog && (
              <ul className="space-y-0.5 pt-1 max-h-60 overflow-auto">
                {data.log.length === 0 ? <li className="text-[12px] text-muted">Nothing yet.</li> : data.log.map((l, n) => (
                  <li key={n} className={'text-[11px] ' + (l.action === 'denied' ? 'text-rose-700 font-semibold' : 'text-muted')}>
                    {new Date(l.created_at).toLocaleString()} · {l.email || 'unknown'} · {l.action}{l.detail ? ' · ' + l.detail : ''}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * THE CODE PROMPT. Modal, one question, no memory: the code is handed back to whoever asked and
 * forgotten. type=password so it is not shoulder-read; autoComplete off so no browser ever offers
 * to remember the vault code for the next person at the same laptop.
 */
function CodePrompt({ purpose, askReason, onAnswer }: { purpose: string; askReason: boolean; onAnswer: (a: CodeAnswer) => void }) {
  const [code, setCode] = useState('')
  const [reason, setReason] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onAnswer(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onAnswer])
  const submit = (e?: React.FormEvent) => { e?.preventDefault(); if (code.trim()) onAnswer({ code: code.trim(), reason: reason.trim() }) }
  return (
    <div className="fixed inset-0 z-[70] bg-ink/40 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-3 sm:p-6" onClick={() => onAnswer(null)}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-line bg-white shadow-xl p-4 space-y-3 pb-safe">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-50 text-amber-700"><Lock size={15} /></span>
          <div className="min-w-0">
            <div className="text-[13.5px] font-bold text-ink">Vault code</div>
            <div className="text-[11.5px] text-muted truncate">To {purpose}</div>
          </div>
        </div>
        <input ref={ref} type="password" autoComplete="off" inputMode="text" value={code} onChange={e => setCode(e.target.value)}
          placeholder="Enter the vault code" className={field + ' text-base sm:text-[13px] py-2.5'} />
        {askReason && (
          <input value={reason} onChange={e => setReason(e.target.value)} maxLength={160}
            placeholder="Why? (optional — goes in the log)" className={field} />
        )}
        <p className="text-[11px] text-muted">This opens the vault for one minute. Revealing is still a click per item, and your name, the time and what you opened are recorded on each one. A wrong code is recorded too.</p>
        <div className="flex items-center gap-2">
          <button type="submit" disabled={!code.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-2 text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-40">
            <Check size={13} /> Continue
          </button>
          <button type="button" onClick={() => onAnswer(null)} className="text-[13px] font-semibold px-3 py-2 rounded-lg border border-line text-muted hover:text-ink">Cancel</button>
        </div>
      </form>
    </div>
  )
}

/**
 * CODE LOG & BACKUPS (admins). The whole-vault answer to "who has been in here": every code entry,
 * right or wrong, what it opened, from where — plus the automatic snapshot list and the owner's
 * code-gated CSV download.
 */
function CodeLogView({ askCode, canExport }: { askCode: AskCode; canExport: boolean }) {
  const [rows, setRows] = useState<any[]>([])
  const [people, setPeople] = useState<string[]>([])
  const [who, setWho] = useState('')
  const [days, setDays] = useState(30)
  const [only, setOnly] = useState<'all' | 'entries' | 'denied' | 'changes'>('all')
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [err, setErr] = useState('')
  const [snaps, setSnaps] = useState<{ name: string; bytes: number; at: string }[] | null>(null)
  const [keyReady, setKeyReady] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const load = useCallback(async (d: number) => {
    setState('loading'); setErr('')
    try {
      const [l, b] = await Promise.all([
        fetch('/api/vault/log?days=' + d, { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/vault/backup', { cache: 'no-store' }).then(r => r.json()),
      ])
      if (!l.ok) { setState('error'); setErr(l.error || l.message || 'Could not load the log.'); return }
      setRows(l.rows || []); setPeople(l.people || []); setState('ok')
      if (b.ok) { setSnaps(b.snapshots || []); setKeyReady(b.keyReady !== false) } else setSnaps([])
    } catch (e: any) { setState('error'); setErr(String(e?.message || e)) }
  }, [])
  useEffect(() => { load(days) }, [days, load])

  const isEntry = (r: any) => /^code entered|^in unlock window/.test(String(r.detail || '')) ||
    ['unlock', 'reveal', 'download', 'export'].includes(r.action)
  const isDenied = (r: any) => r.action === 'denied'
  const isChange = (r: any) => ['create', 'update', 'delete', 'grant', 'revoke', 'code-set', 'backup', 'import', 'move', 'lock'].includes(r.action)
  const shown = rows.filter(r => (!who || r.email === who) && (
    only === 'all' ? true : only === 'entries' ? isEntry(r) : only === 'denied' ? isDenied(r) : isChange(r)))
  const entries = rows.filter(isEntry).length, denied = rows.filter(isDenied).length
  const fmtAt = (s: string) => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
  const fmtSnap = (n: string) => { const m = n.match(/vault-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/); return m ? fmtAt(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':00Z') : n }

  async function download(snapshot?: string) {
    setMsg('')
    const ans = await askCode(snapshot ? 'download the snapshot from ' + fmtSnap(snapshot) : 'download the whole vault as a CSV')
    if (!ans) return
    setBusy(snapshot || 'live')
    try {
      const r = await fetch('/api/vault/backup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ code: ans.code, snapshot: snapshot || undefined }),
      })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Could not build the backup.') }
      const blob = await r.blob()
      const name = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'stay-vault-backup.csv'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      setMsg('Downloaded ' + name + '. It holds every password in clear — keep it somewhere locked, and delete it when a newer one exists.')
      load(days)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(null) }
  }

  async function snapshotNow() {
    setBusy('snap'); setMsg('')
    try {
      const j = await fetch('/api/vault/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'snapshot' }) }).then(r => r.json())
      if (!j.ok) throw new Error(j.error || 'Could not write a snapshot.')
      setMsg('Snapshot written.'); load(days)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-white shadow-soft">
        <div className="px-4 py-3 border-b border-line/60 flex items-center gap-2 flex-wrap">
          <Lock size={14} className="text-amber-700" />
          <span className="text-[13px] font-bold text-ink">Who opened the vault, and what they looked at</span>
          <span className="text-[11.5px] text-muted">{entries} entr{entries === 1 ? 'y' : 'ies'}{denied ? <span className="text-rose-700 font-semibold"> · {denied} wrong or refused</span> : ''} in the window</span>
          <span className="grow" />
          <select value={who} onChange={e => setWho(e.target.value)} className="rounded-xl border border-line bg-white px-2.5 py-1.5 text-[12.5px] shadow-soft">
            <option value="">Everyone</option>
            {people.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <select value={only} onChange={e => setOnly(e.target.value as any)} className="rounded-xl border border-line bg-white px-2.5 py-1.5 text-[12.5px] shadow-soft">
            <option value="all">Everything</option><option value="entries">Code entries</option><option value="denied">Wrong / refused</option><option value="changes">Changes &amp; backups</option>
          </select>
          <select value={days} onChange={e => setDays(Number(e.target.value))} className="rounded-xl border border-line bg-white px-2.5 py-1.5 text-[12.5px] shadow-soft">
            <option value={1}>24h</option><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
          </select>
          <button onClick={() => load(days)} className="rounded-xl border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold shadow-soft inline-flex items-center gap-1.5"><RefreshCw size={12} /></button>
        </div>
        {err ? <div className="mx-4 my-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-[13px] text-rose-700">{err}</div> : null}
        {state === 'loading' ? <div className="px-4 py-8 text-center text-[12.5px] text-muted">Loading…</div>
          : shown.length ? shown.slice(0, 500).map((r, i) => (
            <div key={r.id || i} className="px-4 py-1.5 border-b border-line/40 flex items-center gap-2.5 text-[12.5px] flex-wrap sm:flex-nowrap">
              <span className="text-[11px] text-muted tabular-nums w-[110px] shrink-0">{fmtAt(r.created_at)}</span>
              <span className="text-[11.5px] font-semibold text-ink truncate max-w-[200px]">{r.email || 'unknown'}</span>
              <span className={'text-[10px] uppercase tracking-wider font-bold shrink-0 ' + (isDenied(r) ? 'text-rose-700' : isEntry(r) ? 'text-amber-700' : 'text-sky-700')}>{r.action}</span>
              <span className="text-ink truncate">{r.title ? <b className="font-semibold">{r.title}</b> : null}{r.title && r.detail ? ' · ' : ''}{r.detail || ''}</span>
              {r.ip ? <span className="ml-auto text-[10.5px] text-muted shrink-0">{r.ip}</span> : null}
            </div>
          )) : <div className="px-4 py-8 text-center text-[12.5px] text-muted">Nothing in this window.</div>}
      </div>

      <div className="rounded-2xl border border-line bg-white shadow-soft">
        <div className="px-4 py-3 border-b border-line/60 flex items-center gap-2 flex-wrap">
          <Database size={14} className="text-emerald-700" />
          <span className="text-[13px] font-bold text-ink">Backups</span>
          <span className="text-[11.5px] text-muted">A sealed copy of the whole vault is written automatically after every change · last {snaps ? snaps.length : '…'} kept</span>
          <span className="grow" />
          <button onClick={snapshotNow} disabled={busy === 'snap'} className="rounded-xl border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold shadow-soft disabled:opacity-50">{busy === 'snap' ? 'Writing…' : 'Snapshot now'}</button>
          {canExport && (
            <button onClick={() => download()} disabled={busy === 'live'} className="rounded-xl bg-ink text-white px-2.5 py-1.5 text-[12px] font-semibold shadow-soft inline-flex items-center gap-1.5 disabled:opacity-50">
              <Download size={12} /> {busy === 'live' ? 'Building…' : 'Download CSV backup'}
            </button>
          )}
        </div>
        {!keyReady && <div className="mx-4 my-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-[12.5px] text-amber-900">VAULT_KEY is not set on the server — snapshots cannot be sealed until it is.</div>}
        {msg && <div className="mx-4 my-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-[12.5px] text-emerald-800">{msg}</div>}
        {snaps === null ? <div className="px-4 py-6 text-center text-[12.5px] text-muted">Loading…</div>
          : snaps.length ? snaps.slice(0, 60).map(sn => (
            <div key={sn.name} className="px-4 py-1.5 border-b border-line/40 flex items-center gap-3 text-[12.5px]">
              <span className="text-ink font-semibold tabular-nums">{fmtSnap(sn.name)}</span>
              <span className="text-[11px] text-muted">{fmtBytes(sn.bytes)}</span>
              <span className="grow" />
              {canExport && <button onClick={() => download(sn.name)} disabled={busy === sn.name} className="text-[11.5px] font-semibold text-brand-700 hover:underline disabled:opacity-50">{busy === sn.name ? 'Building…' : 'Download as CSV'}</button>}
            </div>
          )) : <div className="px-4 py-6 text-center text-[12.5px] text-muted">No snapshots yet — the first one is written the moment anything in the vault changes.</div>}
        <p className="px-4 py-3 text-[11px] text-muted">
          Snapshots are sealed with the server key and stay in the private vault bucket. The CSV download is the human copy — Super Admin only,
          vault code every time, logged as an export — and its columns are exactly what <b>Import CSV</b> reads, so a backup is also a restore.
        </p>
      </div>
    </div>
  )
}

/**
 * VAULTS — the named groups that replaced sharing ninety-four things one at a time.
 *
 * Two doors into a vault and they add up: named people, and app_roles keys. Roles are the reason
 * "Managers" keeps meaning the right people after somebody is promoted, without anyone remembering
 * to come back here. Deleting a vault never deletes credentials — its items fall back to
 * owner-only, which is the safe direction to fail.
 */
function VaultsPanel({ collections, onChanged }: { collections: Collection[]; onChanged: () => void }) {
  const [data, setData] = useState<Collection[] | null>(null)
  const [privateCount, setPrivateCount] = useState(0)
  const [canManage, setCanManage] = useState(false)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [memberDraft, setMemberDraft] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const j = await fetch('/api/vault/collections', { cache: 'no-store' }).then(r => r.json())
      if (!j.ok) { setNeedsMigration(!!j.needsMigration); setErr(j.error || ''); setData([]); return }
      setData(j.collections || []); setPrivateCount(j.privateCount || 0); setCanManage(!!j.canManage)
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [])
  useEffect(() => { load() }, [load])

  async function post(body: any, okMsg: string) {
    setBusy(true); setErr(''); setMsg('')
    try {
      const j = await fetch('/api/vault/collections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(r => r.json())
      if (!j.ok) throw new Error(j.error || 'That did not work.')
      setMsg(okMsg); load(); onChanged()
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  async function removeVault(c: Collection) {
    if (!window.confirm('Delete the vault "' + c.name + '"? Its ' + (c.items || 0) + ' item(s) become owner-only again. Nothing is deleted.')) return
    setBusy(true); setErr(''); setMsg('')
    try {
      const j = await fetch('/api/vault/collections?id=' + encodeURIComponent(c.id), { method: 'DELETE' }).then(r => r.json())
      if (!j.ok) throw new Error(j.error || 'Could not delete that vault.')
      setMsg('Vault deleted — its items are owner-only again.'); load(); onChanged()
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  if (needsMigration) return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 mb-4">
      <b>One migration to run:</b> <code>supabase/migrations/052_vault_collections.sql</code> in the Supabase SQL editor.
      Until then everything stays private to its owner — which is exactly where it is now, so nothing is exposed by waiting.
    </div>
  )

  return (
    <div className="rounded-2xl border border-line bg-white shadow-soft mb-4">
      <div className="px-4 py-3 border-b border-line/60 flex items-center gap-2 flex-wrap">
        <FolderLock size={14} className="text-amber-700" />
        <span className="text-[13px] font-bold text-ink">Vaults</span>
        <span className="text-[11.5px] text-muted">
          Group logins once instead of sharing them one by one · <b className="text-ink">{privateCount}</b> still private to their owner
        </span>
      </div>

      {err && <div className="mx-4 my-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-[13px] text-rose-700">{err}</div>}
      {msg && <div className="mx-4 my-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-[12.5px] text-emerald-800">{msg}</div>}

      {data === null ? <div className="px-4 py-6 text-center text-[12.5px] text-muted">Loading…</div>
        : data.length === 0 ? <div className="px-4 py-6 text-center text-[12.5px] text-muted">No vaults yet.</div>
        : data.map(c => (
          <div key={c.id} className="border-b border-line/40 last:border-b-0">
            <div className="px-4 py-2.5 flex items-center gap-2.5 flex-wrap text-[12.5px]">
              <span className="font-semibold text-ink">{c.name}</span>
              <span className="text-muted">{c.items || 0} item{(c.items || 0) === 1 ? '' : 's'}</span>
              {(c.roles || []).length > 0 && (
                <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                  role: {c.roles.join(', ')}
                </span>
              )}
              <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-neutral-100 text-muted border border-line">
                {c.level === 'manage' ? 'members can edit' : 'members can open'}
              </span>
              {(c.members?.length || 0) > 0 && (
                <span className="text-muted inline-flex items-center gap-1"><Users size={11} /> {c.members!.length}</span>
              )}
              <span className="grow" />
              {canManage && (
                <>
                  <button onClick={() => setOpenId(openId === c.id ? null : c.id)}
                    className="text-[12px] font-semibold text-brand-700 hover:underline">
                    {openId === c.id ? 'Close' : 'Who can open it'}
                  </button>
                  <button onClick={() => removeVault(c)} className="text-muted hover:text-rose-600" title="Delete vault"><Trash2 size={13} /></button>
                </>
              )}
            </div>

            {openId === c.id && canManage && (
              <div className="px-4 pb-3">
                <div className="rounded-xl border border-line bg-app/60 p-3 space-y-2">
                  {(c.members || []).length === 0
                    ? <div className="text-[12px] text-muted">Nobody named yet{(c.roles || []).length ? ' — but anyone with the ' + c.roles.join('/') + ' role can already open it.' : '. This vault is currently closed to everyone but the owner of each item.'}</div>
                    : (
                      <ul className="space-y-1">
                        {(c.members || []).map(m => (
                          <li key={m} className="flex items-center gap-2 text-[12px]">
                            <span className="text-ink">{m}</span>
                            <button onClick={() => post({ action: 'remove-member', collection_id: c.id, email: m }, 'Removed ' + m + '.')}
                              className="text-muted hover:text-rose-600 ml-auto">Remove</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <input value={memberDraft[c.id] || ''} onChange={e => setMemberDraft(d => ({ ...d, [c.id]: e.target.value }))}
                      placeholder="name@stay-hospitality.com"
                      className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] w-60 outline-none focus:border-brand-400" />
                    <button disabled={busy || !(memberDraft[c.id] || '').trim()}
                      onClick={() => { post({ action: 'add-member', collection_id: c.id, email: (memberDraft[c.id] || '').trim() }, 'Added.'); setMemberDraft(d => ({ ...d, [c.id]: '' })) }}
                      className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40">
                      <Plus size={12} /> Add
                    </button>
                    <span className="grow" />
                    <label className="text-[12px] text-muted inline-flex items-center gap-1.5">
                      Members can
                      <select value={c.level} onChange={e => post({ id: c.id, level: e.target.value }, 'Saved.')}
                        className="rounded-lg border border-line bg-white px-2 py-1 text-[12px]">
                        <option value="view">open &amp; reveal</option>
                        <option value="manage">open, edit &amp; re-file</option>
                      </select>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

      {canManage && (
        <div className="px-4 py-3 border-t border-line/60 flex items-center gap-2 flex-wrap">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New vault name — e.g. Maintenance, or Jon only"
            className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] w-72 outline-none focus:border-brand-400" />
          <button disabled={busy || newName.trim().length < 2}
            onClick={() => { post({ name: newName.trim() }, 'Vault created. Add people to it, then move items in.'); setNewName('') }}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40">
            <Plus size={13} /> Create vault
          </button>
          <span className="text-[11.5px] text-muted">A vault with one member is a private vault.</span>
        </div>
      )}
    </div>
  )
}
