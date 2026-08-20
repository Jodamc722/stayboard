'use client'
// Roles editor (/users → Roles). A role = a member type: name + landing page + a permission level
// per tab. Owner-only editing (admins can look). The Admin role is system-locked.
// Levels per tab: Off (hidden) · View (read-only, server rejects writes) · Edit (day-to-day
// actions) · Full (destructive + settings actions on that tab).
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Copy, Trash2, Check, AlertTriangle, ShieldCheck, Users, Save, Eye, X, Star } from 'lucide-react'
import { FEATURES, GROUP_ORDER, type Level } from '@/lib/features'

type RoleRow = { key: string; label: string; blurb: string; landing: string; perms: Record<string, string>; is_system: boolean; sort: number }

const LEVEL_OPTS: { key: Level; label: string; hint: string }[] = [
  { key: 'off',  label: 'Off',  hint: 'Hidden — tab gone from the menu, URL blocked' },
  { key: 'view', label: 'View', hint: 'Read-only — can look, server rejects any change' },
  { key: 'edit', label: 'Edit', hint: 'Day-to-day actions — assign, comment, create, mark done' },
  { key: 'full', label: 'Full', hint: 'Everything on this tab — delete, settings, policies' },
]

// Grid grouping is DERIVED from the FEATURES registry (lib/features.ts) — never hand-listed here.
// That's what keeps this editor complete: register a tab once and it appears in the grid. Any
// feature whose group isn't recognized still shows, in a "New tabs" bucket at the bottom.
const GROUPS: { title: string; keys: string[] }[] = (() => {
  const gs = GROUP_ORDER
    .map(title => ({ title, keys: FEATURES.filter(f => f.group === title).map(f => f.key) }))
    .filter(g => g.keys.length > 0)
  const claimed: string[] = []
  for (const g of gs) for (const k of g.keys) claimed.push(k)
  const extra = FEATURES.filter(f => claimed.indexOf(f.key) < 0).map(f => f.key)
  if (extra.length > 0) gs.push({ title: 'New tabs', keys: extra })
  return gs
})()

const label = (key: string) => FEATURES.find(f => f.key === key)?.label || key
const lvlOf = (perms: Record<string, string>, key: string): Level => {
  const v = perms[key] ?? perms['*']
  return (['off', 'view', 'edit', 'full'] as string[]).includes(String(v)) ? (v as Level) : 'off'
}

export function RolesAdmin({ isOwner }: { isOwner: boolean }) {
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [sel, setSel] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // draft state for the selected role
  const [dPerms, setDPerms] = useState<Record<string, string>>({})
  const [dLanding, setDLanding] = useState('/')
  const [dLabel, setDLabel] = useState('')
  const [preview, setPreview] = useState(false)

  async function load(keep?: string) {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/roles'); const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Failed to load roles.')
      setRoles(j.roles || []); setCounts(j.counts || {})
      const pick = keep && (j.roles || []).some((x: RoleRow) => x.key === keep) ? keep : (j.roles?.[0]?.key ?? null)
      setSel(pick)
    } catch (e: any) { setError(e.message || String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const role = useMemo(() => roles.find(r => r.key === sel) || null, [roles, sel])
  useEffect(() => {
    if (!role) return
    const p: Record<string, string> = {}
    for (const f of FEATURES) p[f.key] = lvlOf(role.perms || {}, f.key)
    setDPerms(p); setDLanding(role.landing || '/'); setDLabel(role.label); setMsg(null)
  }, [role?.key, roles])

  const dirty = role && !role.is_system && (
    dLabel !== role.label || dLanding !== (role.landing || '/') ||
    FEATURES.some(f => dPerms[f.key] !== lvlOf(role.perms || {}, f.key))
  )

  async function save() {
    if (!role) return
    setBusy(true); setError(null); setMsg(null)
    try {
      // Keep the role's '*' catch-all when saving: it's what decides the level of FUTURE tabs
      // that ship after this save (e.g. manager '*'=full → new tabs appear for managers at Full).
      // dPerms only carries the tabs that exist today, so without this the default would be lost.
      const star = role.perms && role.perms['*'] != null ? { '*': String(role.perms['*']) } : {}
      const r = await fetch('/api/roles', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: role.key, label: dLabel, landing: dLanding, perms: { ...star, ...dPerms } }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed to save.')
      setMsg(`Saved ${dLabel}.`); load(role.key)
    } catch (e: any) { setError(e.message || String(e)) } finally { setBusy(false) }
  }

  async function createRole(fromKey?: string) {
    const name = window.prompt(fromKey ? `Name for the copy of ${roles.find(r => r.key === fromKey)?.label}:` : 'Name the new role (e.g. Front Desk):')
    if (!name || !name.trim()) return
    setBusy(true); setError(null)
    try {
      const src = fromKey ? roles.find(r => r.key === fromKey) : null
      const perms = src ? { ...src.perms } : { '*': 'off', home: 'view' }
      const r = await fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: name.trim(), perms, landing: src?.landing || '/', blurb: src ? `Copy of ${src.label}` : '' }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed to create role.')
      setMsg(`Role "${name.trim()}" created.`); await load(j.key)
    } catch (e: any) { setError(e.message || String(e)) } finally { setBusy(false) }
  }

  async function deleteRole(key: string) {
    const r0 = roles.find(r => r.key === key); if (!r0) return
    if (!window.confirm(`Delete the role "${r0.label}"? People must be moved off it first.`)) return
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/roles', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed to delete.')
      setMsg(`Deleted ${r0.label}.`); await load()
    } catch (e: any) { setError(e.message || String(e)) } finally { setBusy(false) }
  }

  const setAllInGroup = (keys: string[], lvl: Level) => {
    if (!isOwner || !role || role.is_system) return
    setDPerms(p => { const n = { ...p }; for (const k of keys) n[k] = lvl; return n })
  }

  if (loading) return <div className="px-4 py-10 text-center text-sm text-muted">Loading roles…</div>

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}
      {msg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700 flex items-center gap-2"><Check size={14} /> {msg}</div>}

      <div className="grid gap-4 lg:grid-cols-[240px,1fr]">
        {/* Role list */}
        <div className="rounded-2xl border border-line bg-white overflow-hidden self-start">
          <div className="px-3 py-2.5 border-b border-line flex items-center">
            <span className="text-[13px] font-bold text-ink">Roles</span>
            {isOwner && (
              <button onClick={() => createRole()} disabled={busy} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-brand-600 text-white px-2 py-1 text-[11px] font-semibold hover:bg-brand-700 disabled:opacity-50">
                <Plus size={12} /> New
              </button>
            )}
          </div>
          <ul className="divide-y divide-line">
            {roles.map(r => (
              <li key={r.key}>
                <button onClick={() => setSel(r.key)}
                  className={`w-full text-left px-3 py-2.5 transition-colors ${sel === r.key ? 'bg-brand-50' : 'hover:bg-app/60'}`}>
                  <div className="text-[13px] font-semibold text-ink inline-flex items-center gap-1.5">
                    {r.is_system && <ShieldCheck size={13} className="text-brand-600" />}{r.label}
                  </div>
                  <div className="text-[11px] text-muted mt-0.5 inline-flex items-center gap-1">
                    <Users size={10} /> {counts[r.key] || 0} {counts[r.key] === 1 ? 'person' : 'people'}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Editor */}
        {role && (
          <div className="rounded-2xl border border-line bg-white">
            <div className="px-4 py-3 border-b border-line flex flex-wrap items-center gap-2">
              {role.is_system ? (
                <div className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><ShieldCheck size={15} className="text-brand-600" /> {role.label}</div>
              ) : (
                <input value={dLabel} disabled={!isOwner} onChange={e => setDLabel(e.target.value)}
                  className="text-sm font-bold text-ink rounded-lg border border-transparent hover:border-line focus:border-line bg-transparent px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-200 min-w-[180px]" />
              )}
              <div className="inline-flex items-center gap-1.5 text-[12px] text-muted">
                Lands on
                <select value={dLanding} disabled={!isOwner || role.is_system} onChange={e => setDLanding(e.target.value)}
                  className="text-[12px] rounded-lg border border-line bg-app px-2 py-1 disabled:opacity-60">
                  {FEATURES.filter(f => dPerms[f.key] !== 'off').map(f => <option key={f.key} value={f.path}>{f.label}</option>)}
                </select>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={() => setPreview(true)}
                  title="See exactly what someone on this role sees — including unsaved changes"
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-2.5 py-1.5 hover:bg-brand-100"><Eye size={13} /> Preview</button>
                {isOwner && !role.is_system && (
                  <>
                    <button onClick={() => createRole(role.key)} disabled={busy} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-brand-700"><Copy size={13} /> Duplicate</button>
                    <button onClick={() => deleteRole(role.key)} disabled={busy || (counts[role.key] || 0) > 0}
                      title={(counts[role.key] || 0) > 0 ? 'Move people off this role first' : 'Delete role'}
                      className="inline-flex items-center gap-1 text-[12px] text-rose-600 hover:text-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"><Trash2 size={13} /> Delete</button>
                    {dirty && (
                      <button onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12px] font-semibold hover:bg-brand-700 disabled:opacity-50">
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save changes
                      </button>
                    )}
                  </>
                )}
                {isOwner && role.is_system && <button onClick={() => createRole(role.key)} disabled={busy} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-brand-700"><Copy size={13} /> Duplicate</button>}
              </div>
            </div>

            {role.is_system ? (
              <div className="px-4 py-6 text-[13px] text-muted">The <b>Admin</b> role is locked: every tab at Full, plus user management. Duplicate it to make an editable variant.</div>
            ) : (
              <div className="p-4 space-y-4">
                {!isOwner && <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Only the owner can edit roles — you&apos;re viewing.</p>}
                {GROUPS.map(g => (
                  <div key={g.title}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="text-[11px] uppercase tracking-wider font-semibold text-muted/70">{g.title}</div>
                      {isOwner && (
                        <div className="flex items-center gap-1">
                          {LEVEL_OPTS.map(o => (
                            <button key={o.key} onClick={() => setAllInGroup(g.keys, o.key)} title={`Set all ${g.title} to ${o.label}`}
                              className="text-[10px] px-1.5 py-px rounded border border-line text-muted hover:border-brand-300 hover:text-brand-700">all {o.label}</button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {g.keys.map(k => (
                        <div key={k} className="flex items-center gap-2 rounded-lg border border-line bg-app/40 px-2.5 py-1.5">
                          <span className="text-[12px] font-medium text-ink flex-1 truncate inline-flex items-center gap-1.5">
                            {label(k)}
                            {role.perms && role.perms[k] == null && (
                              <span title="Added in a recent build — running on this role's default until you pick a level and save"
                                className="text-[9px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-px shrink-0">New</span>
                            )}
                          </span>
                          <div className="inline-flex rounded-lg border border-line overflow-hidden">
                            {LEVEL_OPTS.map(o => {
                              const active = dPerms[k] === o.key
                              return (
                                <button key={o.key} disabled={!isOwner} title={o.hint}
                                  onClick={() => setDPerms(p => ({ ...p, [k]: o.key }))}
                                  className={`text-[10px] font-semibold px-2 py-1 transition-colors disabled:cursor-not-allowed ${active
                                    ? (o.key === 'off' ? 'bg-slate-600 text-white' : o.key === 'view' ? 'bg-sky-600 text-white' : o.key === 'edit' ? 'bg-emerald-600 text-white' : 'bg-brand-600 text-white')
                                    : 'bg-white text-muted hover:text-ink'}`}>
                                  {o.label}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-muted">
                  <b>Off</b> hides the tab · <b>View</b> is read-only (the server rejects changes) · <b>Edit</b> allows day-to-day actions · <b>Full</b> adds delete/settings on that tab. Changes apply within a minute of saving.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ROLE PREVIEW (Jon, 2026-08-20: "when I designate a person to a role and give visibility,
          can I preview it?"). A faithful mock of the sidebar as THIS role sees it, built from the
          draft permissions — so you can preview before you even save. Off tabs are simply absent,
          exactly as they are for the real person; each visible tab carries its level. */}
      {preview && role && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setPreview(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-line flex items-center gap-2">
              <Eye size={15} className="text-brand-600" />
              <div>
                <p className="text-sm font-bold text-ink">What {dLabel || role.label} sees</p>
                <p className="text-[11px] text-muted">Lands on {FEATURES.find(f => f.path === dLanding)?.label || dLanding}{dirty ? ' · previewing unsaved changes' : ''}</p>
              </div>
              <button onClick={() => setPreview(false)} className="ml-auto p-1.5 rounded-lg text-muted hover:text-ink"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 bg-app/50">
              <div className="rounded-xl bg-white border border-line p-2">
                <div className="rounded-lg bg-app/70 border border-line p-1.5 mb-2">
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider font-bold text-ink/50 flex items-center gap-1.5">
                    <Star size={10} className="fill-brand-200 text-brand-400" /> Your tabs
                  </div>
                  <p className="px-2 pb-1 text-[11px] text-muted/70">Starts with the standard six — they arrange their own from there.</p>
                </div>
                {GROUPS.map(g => {
                  const vis = g.keys.filter(k => (dPerms[k] || 'off') !== 'off')
                  if (!vis.length) return null
                  return (
                    <div key={'pv-' + g.title} className="mb-2">
                      <div className="px-2 py-1 text-[10px] uppercase tracking-[0.12em] font-bold text-muted/60">{g.title}</div>
                      {vis.map(k => {
                        const lv = dPerms[k] as string
                        return (
                          <div key={'pv-' + k} className="flex items-center gap-2 px-2.5 py-[6px] rounded-lg text-[13px] font-medium text-ink/80">
                            <span className="flex-1 truncate">{label(k)}</span>
                            <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-px rounded ${lv === 'view' ? 'bg-sky-50 text-sky-700 border border-sky-200' : lv === 'edit' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-brand-50 text-brand-700 border border-brand-200'}`}>{lv}</span>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
                {GROUPS.every(g => g.keys.every(k => (dPerms[k] || 'off') === 'off')) && (
                  <p className="px-2 py-4 text-[13px] text-muted text-center">Every tab is off — this role would see an empty app.</p>
                )}
              </div>
            </div>
            <div className="px-4 py-2.5 border-t border-line text-[11px] text-muted">
              View is read-only · Edit allows day-to-day actions · Full adds delete &amp; settings. The Eve bubble shows only if Eve is on for the role.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
