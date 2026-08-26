'use client'
// THE TASK TAXONOMY EDITOR.
//
// The six Today-in-Ops categories and the Breezeway task names that land in each used to be
// regular expressions in my code. Adding "Pool Service" as its own counter, or fixing a task name
// that was filing itself under the wrong heading, meant a deploy. It does not any more.
//
// THE TESTER IS THE POINT OF THIS SCREEN. Rules are ordered and first-match-wins, which is easy to
// state and easy to get wrong — put Maintenance above Glitches and every guest-reported problem in
// the portfolio quietly stops being counted as one. So you paste a real task name, pick its
// department, and the screen tells you which category it lands in and WHICH RULE caught it, before
// you save. Nobody should have to reason about regex precedence in their head.
import { useEffect, useMemo, useState } from 'react'
import { Loader2, RotateCcw, Check, Plus, Trash2, ChevronUp, ChevronDown, FlaskConical } from 'lucide-react'
import { CAT_ICONS, resolveCats, catOfTaskWith, DEFAULT_CATS, type CatDef } from '@/lib/task-categories'

const DEPTS = ['housekeeping', 'maintenance', 'inspection', 'safety', 'other']

export function TaskCategoriesAdmin({ isAdmin }: { isAdmin: boolean }) {
  const [cats, setCats] = useState<CatDef[]>(DEFAULT_CATS)
  const [saved, setSaved] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [tName, setTName] = useState('Guest Reported / Glitch - AC not cooling')
  const [tDept, setTDept] = useState('maintenance')

  useEffect(() => {
    fetch('/api/settings/task-categories', { cache: 'no-store' }).then(r => r.json())
      .then(j => {
        const c = Array.isArray(j?.categories) && j.categories.length ? j.categories : DEFAULT_CATS
        setCats(c); setSaved(JSON.stringify(c)); setIsCustom(!!j?.isCustom)
      })
      .catch(() => {}).finally(() => setLoaded(true))
  }, [])

  const dirty = JSON.stringify(cats) !== saved

  // The tester runs the REAL resolver on the REAL draft — not a description of it. Anything else
  // would be a second implementation, and the whole reason this screen exists is that there was
  // only ever supposed to be one.
  const test = useMemo(() => {
    const live = resolveCats(cats)
    const key = catOfTaskWith(live, { name: tName, dept: tDept })
    const hit = live.find(c => c.key === key)
    let why = 'nothing matched — it fell through to the catch-all'
    if (hit) {
      for (const r of hit.rules) {
        const okName = !r.name || (() => { try { return new RegExp(r.name!, 'i').test(tName) } catch { return false } })()
        const okDept = !r.dept || (() => { try { return new RegExp(r.dept!, 'i').test(tDept) } catch { return false } })()
        const okType = !r.type
        if (okName && okDept && okType && (r.name || r.dept)) {
          why = 'matched ' + [r.name ? 'name /' + r.name + '/' : '', r.dept ? 'dept /' + r.dept + '/' : ''].filter(Boolean).join(' + ')
          break
        }
      }
    }
    return { label: hit ? hit.label : key, why }
  }, [cats, tName, tDept])

  const up = (i: number) => { if (i <= 0) return; const c = cats.slice(); c.splice(i - 1, 0, c.splice(i, 1)[0]); setCats(c) }
  const down = (i: number) => { if (i >= cats.length - 1) return; const c = cats.slice(); c.splice(i + 1, 0, c.splice(i, 1)[0]); setCats(c) }
  const patch = (i: number, p: Partial<CatDef>) => setCats(c => c.map((x, n) => n === i ? { ...x, ...p } : x))
  const addCat = () => setCats(c => [...c.slice(0, c.length - 1), { key: 'new' + c.length, label: 'New category', icon: 'wrench', rules: [{ name: '' }] }, c[c.length - 1]])
  const delCat = (i: number) => setCats(c => c.filter((_, n) => n !== i))

  const save = async () => {
    setBusy(true); setErr(''); setOk('')
    try {
      const r = await fetch('/api/settings/task-categories', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categories: cats }),
      })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || 'Could not save')
      setCats(j.categories); setSaved(JSON.stringify(j.categories)); setIsCustom(true)
      setOk('Saved. The board and the daily briefs both use these now.')
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  const reset = async () => {
    setBusy(true); setErr(''); setOk('')
    try {
      const r = await fetch('/api/settings/task-categories', { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || 'Could not reset')
      setCats(j.categories); setSaved(JSON.stringify(j.categories)); setIsCustom(false)
      setOk('Back to the standard categories.')
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  if (!loaded) return <p className="text-[13px] text-muted">Loading&hellip;</p>

  return (
    <div>
      <div className="rounded-xl border border-line bg-app/50 px-3.5 py-2.5 mb-3">
        <p className="text-[12.5px] text-ink">
          Categories are tried <b>top to bottom</b> and the first match wins. A category matches if <b>any</b> of its rules
          match; a rule matches if <b>every</b> box you filled in matches. Name and department are patterns, not exact text.
        </p>
        <p className="text-[12px] text-muted mt-1">
          Order is not cosmetic: a glitch arrives from Breezeway as a <i>maintenance</i> task called
          &ldquo;Guest Reported / Glitch&hellip;&rdquo;, so Glitches has to be tried before Maintenance or every guest problem
          disappears into the wrong counter.
        </p>
      </div>

      {/* ── THE TESTER ── */}
      <div className="rounded-xl border-2 border-ink/15 bg-white p-3 mb-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted mb-2 inline-flex items-center gap-1.5">
          <FlaskConical size={12} /> Try a task name
        </p>
        <div className="flex gap-2 flex-wrap">
          <input value={tName} onChange={e => setTName(e.target.value)} placeholder="Paste a Breezeway task name"
            className="flex-1 min-w-[220px] rounded-lg border border-line px-2.5 py-1.5 text-[13px]" />
          <select value={tDept} onChange={e => setTDept(e.target.value)}
            className="rounded-lg border border-line px-2 py-1.5 text-[12.5px] bg-white">
            {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <p className="text-[13px] mt-2">
          Lands in <b className="text-ink">{test.label}</b> <span className="text-muted">&mdash; {test.why}</span>
        </p>
      </div>

      {cats.map((c, i) => (
        <div key={i} className="rounded-2xl border border-line bg-white p-3 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-muted w-5">{i + 1}</span>
            <input value={c.label} disabled={!isAdmin} onChange={e => patch(i, { label: e.target.value })}
              className="rounded-lg border border-line px-2 py-1 text-[13px] font-semibold w-40" />
            <select value={c.icon} disabled={!isAdmin} onChange={e => patch(i, { icon: e.target.value })}
              className="rounded-lg border border-line px-2 py-1 text-[12px] bg-white">
              {CAT_ICONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            {c.fallback && (
              <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-app text-muted border border-line"
                title="Anything no other category claims lands here">catch-all</span>
            )}
            <span className="ml-auto flex items-center gap-1">
              <button disabled={!isAdmin || i === 0} onClick={() => up(i)} className="p-1 rounded hover:bg-app disabled:opacity-25"><ChevronUp size={13} /></button>
              <button disabled={!isAdmin || i === cats.length - 1} onClick={() => down(i)} className="p-1 rounded hover:bg-app disabled:opacity-25"><ChevronDown size={13} /></button>
              {!c.fallback && (
                <button disabled={!isAdmin} onClick={() => delCat(i)} className="p-1 rounded hover:bg-rose-50 text-rose-500 disabled:opacity-25" title="Remove this category"><Trash2 size={13} /></button>
              )}
            </span>
          </div>

          {c.fallback ? (
            <p className="text-[11.5px] text-muted mt-1.5 pl-7">Everything no category above claims ends up here. No rules needed.</p>
          ) : (
            <div className="mt-2 pl-7 space-y-1.5">
              {(c.rules || []).map((r, ri) => (
                <div key={ri} className="flex gap-1.5 flex-wrap items-center">
                  <span className="text-[10.5px] text-muted w-8">{ri === 0 ? 'if' : 'or'}</span>
                  <input value={r.name || ''} disabled={!isAdmin} placeholder="name contains (pattern)"
                    onChange={e => patch(i, { rules: c.rules.map((x, n) => n === ri ? { ...x, name: e.target.value } : x) })}
                    className="flex-1 min-w-[180px] rounded-lg border border-line px-2 py-1 text-[12px] font-mono" />
                  <input value={r.dept || ''} disabled={!isAdmin} placeholder="dept"
                    onChange={e => patch(i, { rules: c.rules.map((x, n) => n === ri ? { ...x, dept: e.target.value } : x) })}
                    className="w-28 rounded-lg border border-line px-2 py-1 text-[12px] font-mono" />
                  <button disabled={!isAdmin} onClick={() => patch(i, { rules: c.rules.filter((_, n) => n !== ri) })}
                    className="p-1 rounded hover:bg-app text-muted disabled:opacity-25"><Trash2 size={12} /></button>
                </div>
              ))}
              <button disabled={!isAdmin} onClick={() => patch(i, { rules: [...(c.rules || []), { name: '' }] })}
                className="text-[11.5px] font-bold text-brand-700 inline-flex items-center gap-1 disabled:opacity-40">
                <Plus size={11} /> another rule
              </button>
            </div>
          )}
        </div>
      ))}

      <button disabled={!isAdmin} onClick={addCat}
        className="text-[12.5px] font-bold px-2.5 py-1.5 rounded-lg border border-line bg-white hover:border-ink/30 inline-flex items-center gap-1.5 mb-3 disabled:opacity-40">
        <Plus size={12} /> Add a category
      </button>

      {err && <p className="text-[12.5px] text-rose-600 font-semibold mb-2">{err}</p>}
      {ok && <p className="text-[12.5px] text-emerald-700 font-semibold mb-2 inline-flex items-center gap-1"><Check size={13} /> {ok}</p>}

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={save} disabled={!isAdmin || !dirty || busy}
          className="rounded-xl bg-ink text-white px-4 py-2 text-[13px] font-bold disabled:opacity-40 inline-flex items-center gap-2">
          {busy ? <Loader2 size={13} className="animate-spin" /> : null} {dirty ? 'Save categories' : 'Saved'}
        </button>
        {isCustom && (
          <button onClick={reset} disabled={!isAdmin || busy}
            className="rounded-xl border border-line bg-white px-3 py-2 text-[12.5px] font-bold text-muted hover:text-ink inline-flex items-center gap-1.5 disabled:opacity-40">
            <RotateCcw size={12} /> Reset to standard
          </button>
        )}
        {!isAdmin && <span className="text-[12px] text-muted">Admins can change this.</span>}
      </div>
    </div>
  )
}
