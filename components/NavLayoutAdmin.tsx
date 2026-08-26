'use client'
// THE SIDEBAR EDITOR.
//
// Jon moved tabs around three times in a week and each one was a deploy. This is the screen that
// ends that: rename a tab, move it to another section, reorder it, hide it, reorder the sections
// themselves — and see the result before saving.
//
// Two decisions worth stating, because both were tempting to get wrong:
//
//   NO DRAG AND DROP. Up/down buttons and a section dropdown do the same job, work on a phone with
//   one thumb, work with a keyboard, and cannot half-finish a gesture and leave the list scrambled.
//   Drag would look better in a demo and be worse in a hallway.
//
//   HIDING IS NOT REVOKING, and the screen says so out loud. A hidden row is off the sidebar and
//   still reachable by URL and by the Jump-to palette, because access is decided by role levels
//   (Roles tab), not here. An admin who thinks they just took a page away from someone would be
//   wrong in a way that matters.
import { useEffect, useMemo, useState } from 'react'
import { ChevronUp, ChevronDown, Eye, EyeOff, RotateCcw, Loader2, Check, Pencil } from 'lucide-react'
import { SECTIONS } from '@/components/Shell'
import { applyNavLayout, type NavLayout, type NavItemOverride } from '@/lib/nav-layout'

export function NavLayoutAdmin({ isAdmin }: { isAdmin: boolean }) {
  const [layout, setLayout] = useState<NavLayout>({})
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/nav', { cache: 'no-store' }).then(r => r.json())
      .then(j => { const L = j?.layout || {}; setLayout(L); setSaved(JSON.stringify(L)) })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  // The preview IS the merge the sidebar runs — same function, same input. A preview computed any
  // other way is a second implementation that will eventually disagree with the real one.
  const preview = useMemo(() => applyNavLayout(SECTIONS as any, layout), [layout])
  const hiddenRows = useMemo(() => {
    const hid = Object.keys(layout.items || {}).filter(k => layout.items![k]?.hidden)
    const all = SECTIONS.flatMap(s => s.items)
    return hid.map(to => ({ to, label: (layout.items![to]?.label) || all.find(i => i.to === to)?.label || to }))
  }, [layout])

  const sectionNames = useMemo(() => {
    const fromCode = SECTIONS.map(s => s.title)
    const fromLayout = Object.values(layout.items || {}).map(o => o.section).filter(Boolean) as string[]
    return Array.from(new Set(fromCode.concat(fromLayout).concat(preview.map(s => s.title))))
  }, [layout, preview])

  const dirty = JSON.stringify(layout) !== saved
  const set = (to: string, patch: NavItemOverride) => setLayout(L => {
    const items = { ...(L.items || {}) }
    const next = { ...(items[to] || {}), ...patch }
    for (const k of Object.keys(next)) if ((next as any)[k] === undefined) delete (next as any)[k]
    if (Object.keys(next).length) items[to] = next; else delete items[to]
    return { ...L, items }
  })

  /** Renumber one section from the preview, then swap two neighbours. Explicit order for every row
      in that section, so the move survives whatever the defaults were doing. */
  const move = (title: string, to: string, dir: -1 | 1) => {
    const sec = preview.find(s => s.title === title)
    if (!sec) return
    const idx = sec.items.findIndex(i => i.to === to)
    const j = idx + dir
    if (idx < 0 || j < 0 || j >= sec.items.length) return
    const order = sec.items.map(i => i.to)
    order.splice(j, 0, order.splice(idx, 1)[0])
    setLayout(L => {
      const items = { ...(L.items || {}) }
      order.forEach((path, n) => { items[path] = { ...(items[path] || {}), order: n * 10, section: title } })
      return { ...L, items }
    })
  }

  const moveSection = (title: string, dir: -1 | 1) => {
    const order = preview.map(s => s.title)
    const idx = order.indexOf(title)
    const j = idx + dir
    if (idx < 0 || j < 0 || j >= order.length) return
    order.splice(j, 0, order.splice(idx, 1)[0])
    setLayout(L => ({ ...L, sections: order }))
  }

  const save = async () => {
    setBusy(true); setErr(''); setOk('')
    try {
      const r = await fetch('/api/settings/nav', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ layout }),
      })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || 'Could not save')
      setSaved(JSON.stringify(j.layout || layout)); setLayout(j.layout || layout)
      setOk('Saved. Reload any page to see the new sidebar.')
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  const reset = async () => {
    setBusy(true); setErr(''); setOk('')
    try {
      const r = await fetch('/api/settings/nav', { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || 'Could not reset')
      setLayout({}); setSaved(JSON.stringify({}))
      setOk('Back to the standard sidebar.')
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  if (!loaded) return <p className="text-[13px] text-muted">Loading&hellip;</p>

  return (
    <div>
      <div className="rounded-xl border border-line bg-app/50 px-3.5 py-2.5 mb-3">
        <p className="text-[12.5px] text-ink">
          This is what everyone sees in the left sidebar. Renaming or hiding a tab here is <b>layout only</b> &mdash;
          it does not change who is allowed to open the page. Access lives in the <b>Roles</b> tab.
        </p>
      </div>

      {preview.map((sec, si) => (
        <div key={sec.title} className="mb-3 rounded-2xl border border-line bg-white overflow-hidden">
          <div className="px-3 py-2 bg-app/60 border-b border-line flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-ink">{sec.title}</span>
            <span className="ml-auto flex items-center gap-1">
              <button disabled={!isAdmin || si === 0} onClick={() => moveSection(sec.title, -1)}
                className="p-1 rounded hover:bg-white disabled:opacity-25" title="Move this section up"><ChevronUp size={13} /></button>
              <button disabled={!isAdmin || si === preview.length - 1} onClick={() => moveSection(sec.title, 1)}
                className="p-1 rounded hover:bg-white disabled:opacity-25" title="Move this section down"><ChevronDown size={13} /></button>
            </span>
          </div>
          <div className="divide-y divide-line">
            {sec.items.map((it, ii) => (
              <div key={it.to} className="px-3 py-2 flex items-center gap-2 flex-wrap">
                {editing === it.to ? (
                  <input autoFocus defaultValue={it.label}
                    onBlur={e => { const v = e.target.value.trim(); set(it.to, { label: v && v !== defaultLabel(it.to) ? v : undefined }); setEditing(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }}
                    className="rounded-lg border-2 border-ink px-2 py-1 text-[13px] w-44" />
                ) : (
                  <button disabled={!isAdmin} onClick={() => setEditing(it.to)}
                    className="text-[13.5px] font-semibold text-ink inline-flex items-center gap-1.5 hover:text-brand-700 disabled:hover:text-ink">
                    {it.label} <Pencil size={11} className="text-muted" />
                  </button>
                )}
                {it.label !== defaultLabel(it.to) && (
                  <span className="text-[10.5px] text-muted">was &ldquo;{defaultLabel(it.to)}&rdquo;</span>
                )}
                <span className="text-[11px] text-muted">{it.to}</span>

                <span className="ml-auto flex items-center gap-1">
                  <select disabled={!isAdmin} value={sec.title}
                    onChange={e => set(it.to, { section: e.target.value, order: undefined })}
                    className="rounded-lg border border-line px-1.5 py-1 text-[11.5px] bg-white max-w-[130px]" title="Move to another section">
                    {sectionNames.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <button disabled={!isAdmin || ii === 0} onClick={() => move(sec.title, it.to, -1)}
                    className="p-1 rounded hover:bg-app disabled:opacity-25" title="Move up"><ChevronUp size={13} /></button>
                  <button disabled={!isAdmin || ii === sec.items.length - 1} onClick={() => move(sec.title, it.to, 1)}
                    className="p-1 rounded hover:bg-app disabled:opacity-25" title="Move down"><ChevronDown size={13} /></button>
                  <button disabled={!isAdmin} onClick={() => set(it.to, { hidden: true })}
                    className="p-1 rounded hover:bg-app disabled:opacity-25 text-muted" title="Hide from the sidebar (does not remove access)"><EyeOff size={13} /></button>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {hiddenRows.length > 0 && (
        <div className="mb-3 rounded-2xl border border-line bg-white overflow-hidden">
          <div className="px-3 py-2 bg-app/60 border-b border-line">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Hidden from the sidebar</span>
            <span className="text-[11px] text-muted"> &middot; still reachable by link and by Cmd-K</span>
          </div>
          <div className="divide-y divide-line">
            {hiddenRows.map(h => (
              <div key={h.to} className="px-3 py-2 flex items-center gap-2">
                <span className="text-[13px] text-muted">{h.label}</span>
                <span className="text-[11px] text-muted">{h.to}</span>
                <button disabled={!isAdmin} onClick={() => set(h.to, { hidden: undefined })}
                  className="ml-auto text-[12px] font-bold text-brand-700 inline-flex items-center gap-1 disabled:opacity-40">
                  <Eye size={12} /> Show again
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {err && <p className="text-[12.5px] text-rose-600 font-semibold mb-2">{err}</p>}
      {ok && <p className="text-[12.5px] text-emerald-700 font-semibold mb-2 inline-flex items-center gap-1"><Check size={13} /> {ok}</p>}

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={save} disabled={!isAdmin || !dirty || busy}
          className="rounded-xl bg-ink text-white px-4 py-2 text-[13px] font-bold disabled:opacity-40 inline-flex items-center gap-2">
          {busy ? <Loader2 size={13} className="animate-spin" /> : null} {dirty ? 'Save the sidebar' : 'Saved'}
        </button>
        <button onClick={reset} disabled={!isAdmin || busy}
          className="rounded-xl border border-line bg-white px-3 py-2 text-[12.5px] font-bold text-muted hover:text-ink inline-flex items-center gap-1.5 disabled:opacity-40">
          <RotateCcw size={12} /> Reset to standard
        </button>
        {!isAdmin && <span className="text-[12px] text-muted">Admins can change this.</span>}
      </div>
    </div>
  )
}

const DEFAULT_LABELS: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const s of SECTIONS) for (const i of s.items) m[i.to] = i.label
  return m
})()
const defaultLabel = (to: string) => DEFAULT_LABELS[to] || to
