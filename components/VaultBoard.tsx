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
  Upload, Users, Clock, KeyRound, FileText, StickyNote, ShieldCheck, History, RefreshCw,
} from 'lucide-react'

const CATEGORIES = [
  { id: 'building', label: 'Building & vendor' },
  { id: 'guest', label: 'Guest documents' },
  { id: 'company', label: 'Company & legal' },
  { id: 'owner', label: 'Owner & payouts' },
]

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

export function VaultBoard() {
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

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter(i => {
      if (cat && i.category !== cat) return false
      if (!needle) return true
      return (i.title + ' ' + (i.description || '') + ' ' + (i.username || '') + ' ' +
        (i.doc_name || '') + ' ' + (i.property_id || '') + ' ' + (i.unit_no || '') + ' ' +
        (i.tags || []).join(' ')).toLowerCase().includes(needle)
    })
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
    try {
      const j = await fetch('/api/vault/reveal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ id: i.id }),
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
      const val = revealed[i.id] || await fetch('/api/vault/reveal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ id: i.id, reason: 'copied to clipboard' }),
      }).then(x => x.json()).then(j => { if (!j.ok) throw new Error(j.error); return j.secret })
      await navigator.clipboard.writeText(val)
      setMsg('Copied. Your clipboard now holds it — paste it and move on.')
    } catch (e: any) { setErr(e.message || String(e)) }
  }

  async function openFile(i: Item) {
    setErr(null)
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
        ) : shown.map(i => {
          const mine = grants.filter(g => g.item_id === i.id)
          const d = daysUntil(i.expires_on)
          return (
            <div key={i.id} className="border-b border-line last:border-b-0">
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
        Every reveal, download and refused attempt is logged against the item.
      </p>
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
