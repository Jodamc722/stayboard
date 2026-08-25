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
  Upload, Users, Clock, KeyRound, FileText, StickyNote, ShieldCheck, History, RefreshCw, Lock, Database,
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
    const ans = await askCode('open this record')
    if (!ans) return
    setBusy(ref); setErr(null)
    try {
      const r = await fetch('/api/vault/records?sign=' + encodeURIComponent(ref), { cache: 'no-store', headers: { 'x-vault-code': ans.code } })
      const j = await r.json()
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
      if (!j.ok && !j.needsMigration && j.error) setErr(j.error)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

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
      if (cat && i.category !== cat) return false
      if (!needle) return true
      return (i.title + ' ' + (i.description || '') + ' ' + (i.username || '') + ' ' +
        (i.doc_name || '') + ' ' + (i.property_id || '') + ' ' + (i.unit_no || '') + ' ' +
        (i.tags || []).join(' ')).toLowerCase().includes(needle)
    }).sort((a, b) => rank(a.category) - rank(b.category) || a.title.localeCompare(b.title))
  }, [items, q, cat])

  const expiring = useMemo(
    () => items.filter(i => { const d = daysUntil(i.expires_on); return d !== null && d <= 30 }).sort(
      (a, b) => (daysUntil(a.expires_on) ?? 0) - (daysUntil(b.expires_on) ?? 0)),
    [items])

  async function reveal(i: Item) {
    setErr(null)
    if (revealed[i.id]) { // second click hides it again
      clearTimeout(timers.current[i.id]); delete timers.current[i.id]
      setRevealed(r => { const n = { ...r }; delete n[i.id]; return n })
      return
    }
    const ans = await askCode('reveal “' + i.title + '”', { askReason: true })
    if (!ans) return
    try {
      const j = await fetch('/api/vault/reveal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ id: i.id, code: ans.code, reason: ans.reason }),
      }).then(x => x.json())
      if (!j.ok) throw new Error(j.error || 'Could not open that.')
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
        // Something already revealed on screen was already paid for with the code; a fresh copy is
        // a fresh reveal and asks again.
        const ans = await askCode('copy “' + i.title + '”', { askReason: true })
        if (!ans) return
        val = await fetch('/api/vault/reveal', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
          body: JSON.stringify({ id: i.id, code: ans.code, reason: 'copied to clipboard' + (ans.reason ? ' · ' + ans.reason : '') }),
        }).then(x => x.json()).then(j => { if (!j.ok) throw new Error(j.error); return j.secret as string })
      }
      await navigator.clipboard.writeText(val)
      setMsg('Copied. Your clipboard now holds it — paste it and move on.')
    } catch (e: any) { setErr(e.message || String(e)) }
  }

  async function openFile(i: Item) {
    setErr(null)
    const ans = await askCode('open “' + (i.doc_name || i.title) + '”')
    if (!ans) return
    try {
      const j = await fetch('/api/vault/file?id=' + encodeURIComponent(i.id), { cache: 'no-store', headers: { 'x-vault-code': ans.code } }).then(x => x.json())
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
      // The code is asked once here and reused for the real run of this same file.
      const ans = await askCode('import ' + file.name)
      if (!ans) return
      const j = await fetch('/api/vault/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, dryRun: true, code: ans.code }),
      }).then(x => x.json())
      if (!j.ok) throw new Error(j.error || 'Could not read that file.')
      setImportState({ name: file.name, csv, code: ans.code, preview: j })
    } catch (e: any) { setErr(e.message || String(e)) }
  }

  async function runImport() {
    if (!importState) return
    setSaving(true); setErr(null); setMsg(null)
    try {
      let code = importState.code
      if (!code) { const ans = await askCode('import ' + importState.name); if (!ans) { setSaving(false); return } code = ans.code }
      const j = await fetch('/api/vault/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: importState.csv, code }),
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
      {view === 'log' && <CodeLogView askCode={askCode} canExport={isOwner} />}
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

      <div className="rounded-2xl border border-line bg-white overflow-hidden">
        {loading && items.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-muted"><Loader2 size={16} className="animate-spin inline mr-2" /> Loading…</div>
        ) : shown.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-muted">
            {items.length === 0 ? 'Nothing in the vault yet. Start with the codes people keep asking you for.' : 'Nothing matches that.'}
          </div>
        ) : shown.map((i, n) => {
          const mine = grants.filter(g => g.item_id === i.id)
          const d = daysUntil(i.expires_on)
          // A shelf header the first time a category appears — the vault reads as shelves, not a heap.
          const newShelf = n === 0 || shown[n - 1].category !== i.category
          const shelfCount = newShelf ? shown.filter(x => x.category === i.category).length : 0
          return (
            <div key={i.id} className="border-b border-line last:border-b-0">
              {newShelf && (
                <div className={'px-4 py-1.5 text-[10.5px] uppercase tracking-[0.14em] font-bold border-b border-line/60 ' + (i.category === 'archive' ? 'bg-neutral-100 text-muted' : 'bg-app text-muted')}>
                  {CATEGORIES.find(c => c.id === i.category)?.label || i.category} <span className="font-semibold normal-case tracking-normal">· {shelfCount}</span>
                </div>
              )}
              <div className="flex items-start gap-2 px-4 py-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-app text-muted"><KindIcon k={i.kind} /></span>
                    <span className="text-[13px] font-semibold text-ink">{i.title}</span>
                    {i.level === 'view' && <span className="text-[10px] uppercase tracking-wider font-semibold text-muted">shared with you</span>}
                    {d !== null && d <= 30 && (
                      <span className={'text-[10px] uppercase tracking-wider font-semibold ' + (d < 0 ? 'text-rose-600' : 'text-amber-700')}>
                        {d < 0 ? 'expired' : 'expires ' + fmtDate(i.expires_on)}
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-muted mt-0.5">
                    {CATEGORIES.find(c => c.id === i.category)?.label || i.category}
                    {i.property_id ? ' · ' + i.property_id : ''}{i.unit_no ? ' ' + i.unit_no : ''}
                    {i.username ? ' · ' + i.username : ''}
                    {i.hasFile && i.doc_name ? ' · ' + i.doc_name + (i.doc_bytes ? ' (' + fmtBytes(i.doc_bytes) + ')' : '') : ''}
                    {mine.length ? ' · shared with ' + mine.length : ''}
                  </div>
                  {i.description && <div className="text-[12px] text-ink/80 mt-1 whitespace-pre-wrap">{i.description}</div>}
                  {i.hasSecret && (
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                      <code className={'text-[13px] px-2 py-1 rounded border ' + (revealed[i.id] ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-line bg-app text-muted')}>
                        {revealed[i.id] || i.secret_hint || '••••••••'}
                      </code>
                      {revealed[i.id] && <span className="text-[11px] text-muted">hides itself shortly</span>}
                    </div>
                  )}
                </div>

                {i.hasSecret && (
                  <>
                    <button onClick={() => reveal(i)}
                      className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink">
                      {revealed[i.id] ? <><EyeOff size={13} /> Hide</> : <><Eye size={13} /> Reveal</>}
                    </button>
                    <button onClick={() => copySecret(i)}
                      className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink">
                      <Copy size={13} /> Copy
                    </button>
                  </>
                )}
                {i.hasFile && (
                  <button onClick={() => openFile(i)}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                    <Download size={13} /> Open
                  </button>
                )}
                {i.url && (
                  <a href={i.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink">
                    Portal
                  </a>
                )}
                {i.level === 'manage' && (
                  <>
                    <button onClick={() => setOpenShare(openShare === i.id ? null : i.id)}
                      className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink">
                      <Users size={13} /> Share
                    </button>
                    <button onClick={() => startEdit(i)} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink">Edit</button>
                    <button onClick={() => remove(i)} className="text-muted hover:text-rose-600" title="Delete"><Trash2 size={14} /></button>
                  </>
                )}
              </div>
              {openShare === i.id && <SharePanel itemId={i.id} onClose={() => setOpenShare(null)} onChanged={load} />}
            </div>
          )
        })}
      </div>

      <p className="text-[11px] text-muted flex items-center gap-1.5">
        <ShieldCheck size={12} /> Secrets are encrypted before they are stored and are never included when this list loads.
        Every reveal asks for the vault code and records who entered it; a sealed backup is written after every change.
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
        <p className="text-[11px] text-muted">Your name, the time and what you opened are recorded. A wrong code is recorded too.</p>
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

  const isEntry = (r: any) => /^code entered/.test(String(r.detail || '')) || ['reveal', 'download', 'export', 'import'].includes(r.action)
  const isDenied = (r: any) => r.action === 'denied'
  const isChange = (r: any) => ['create', 'update', 'delete', 'grant', 'revoke', 'code-set', 'backup'].includes(r.action)
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
          <span className="text-[13px] font-bold text-ink">Who entered the vault code</span>
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
