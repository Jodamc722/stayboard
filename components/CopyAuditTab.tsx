'use client'
// THE COPY AUDIT TAB on /admin (Jon, 2026-11-06: "there should be audit in admin center, need it to
// work but should note these things"). Every active listing's title and six sections:
//   Must fix        a channel refuses or cuts it (summary over 500, title over 50, banned content),
//                   it states the wrong bedrooms / bathrooms / guests, or a Regenerate push did not stick
//   Worth checking  empty sections, the summary without its closing line, all caps, Vrbo length
// The list reads the last Guesty sync; "Check live" re-reads one unit (or every Must-fix unit) from
// Guesty itself and re-runs the same checks, so a fix already pushed clears at once. "Fix" opens the
// unit, where Regenerate and Push again live.
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { RefreshCw, Search, Wrench } from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import { Tag, LeanList, LeanRow, LeanEmpty, LeanPick, LeanSection, Pill, type Tone } from '@/components/lean'
import { auditCopy, type Finding } from '@/lib/copy-audit-core'

type Row = {
  id: string; name: string; building: string; bedrooms: number | null; bathrooms: number | null; sleeps: number | null; roomType: string
  title: string; summaryLen: number; syncedAt: string | null; findings: Finding[]
  push: { at: string; synced: boolean; missing: string[]; by?: string | null } | null
}
type Res = { ok: boolean; error?: string; at: string; rows: Row[] }
type View = 'fix' | 'check' | 'clean' | 'all'
type Kind = Finding['kind'] | 'any'

const URL_ = '/api/admin-desk/copy-audit'
const KIND_LABEL: Record<Finding['kind'], string> = { limit: 'Over limit', facts: 'Wrong facts', sync: 'Not synced', content: 'Content', empty: 'Empty', closing: 'Closing line' }
const KIND_TONE: Record<Finding['kind'], Tone> = { limit: 'rose', facts: 'rose', sync: 'roseSolid', content: 'amber', empty: 'amber', closing: 'slate' }
const ghost = 'inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[12px] font-semibold text-ink hover:border-ink/40 shrink-0 disabled:opacity-50'
const btn = 'inline-flex items-center gap-1 rounded-lg bg-ink text-white px-2.5 py-1 text-[12px] font-bold hover:opacity-90 shrink-0'
const ago = (iso?: string | null) => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 2880 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago' }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const levelOf = (f: Finding[]) => f.some(x => x.level === 'fix') ? 'fix' : f.length ? 'check' : 'clean'

export function CopyAuditTab() {
  const res = useCachedFetch<Res>(URL_, { ttl: 300_000 })
  const [view, setView] = useState<View>('fix')
  const [kind, setKind] = useState<Kind>('any')
  const [q, setQ] = useState('')
  // Live re-checks: id → findings from Guesty itself (replace the synced copy's findings).
  const [live, setLive] = useState<Record<string, { findings: Finding[]; at: string; summaryLen: number } | { error: string }>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [bulk, setBulk] = useState<{ done: number; of: number } | null>(null)

  const rows = useMemo(() => (res.data?.rows || []).map(r => {
    const l = live[r.id]
    if (!l || 'error' in l) return r
    return { ...r, findings: l.findings, summaryLen: l.summaryLen }
  }), [res.data, live])

  const counts = useMemo(() => {
    const c = { fix: 0, check: 0, clean: 0, all: rows.length, kinds: {} as Record<string, number> }
    for (const r of rows) {
      c[levelOf(r.findings)]++
      for (const k of Array.from(new Set(r.findings.map(f => f.kind)))) c.kinds[k] = (c.kinds[k] || 0) + 1
    }
    return c
  }, [rows])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows.filter(r => (view === 'all' || levelOf(r.findings) === view)
      && (kind === 'any' || r.findings.some(f => f.kind === kind))
      && (!s || (r.name + ' ' + r.building + ' ' + r.title).toLowerCase().includes(s)))
  }, [rows, view, kind, q])

  const checkLive = async (r: Row) => {
    setBusy(r.id)
    try {
      let j: any = null
      for (const wait of [0, 5000, 12000]) {
        if (wait) await sleep(wait)
        j = await fetch('/api/listing-content?listingId=' + encodeURIComponent(r.id), { cache: 'no-store' }).then(x => x.json()).catch(e => ({ error: String(e) }))
        if (!j?.error || !/429|503|too many/i.test(j.error)) break
      }
      if (!j?.ok) { setLive(m => ({ ...m, [r.id]: { error: j?.error || 'Could not read Guesty' } })); return }
      const found = auditCopy({ title: j.title, sections: j.sections }, { bedrooms: r.bedrooms, bathrooms: r.bathrooms, sleeps: r.sleeps, roomType: r.roomType })
      // A push that did not stick stays flagged until the live copy is clean of it — or a later push syncs.
      const sync = r.findings.filter(f => f.kind === 'sync')
      setLive(m => ({ ...m, [r.id]: { findings: [...sync, ...found], at: new Date().toISOString(), summaryLen: String(j.sections?.summary || '').length } }))
    } finally { setBusy(null) }
  }
  const checkAllFix = async () => {
    const list = rows.filter(r => levelOf(r.findings) === 'fix')
    setBulk({ done: 0, of: list.length })
    for (let i = 0; i < list.length; i++) {
      await checkLive(list[i]); setBulk({ done: i + 1, of: list.length })
      await sleep(900)  // one at a time, so Guesty never answers "too many requests"
    }
    setBulk(null)
  }
  const reload = async () => { invalidateCache(URL_); setLive({}); await res.refresh() }

  if (res.loading && !res.data) return <LeanEmpty>Checking every listing’s copy…</LeanEmpty>
  if (res.error || res.data?.ok === false) return <LeanEmpty>Could not load the audit: {String(res.error || res.data?.error)}</LeanEmpty>

  const kinds = (Object.keys(KIND_LABEL) as Finding['kind'][]).filter(k => counts.kinds[k])

  return (
    <div>
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <Pill tone={counts.fix ? 'rose' : 'emerald'} onClick={() => { setView('fix'); setKind('any') }} title="A channel will refuse or cut it, the facts are wrong, or a push did not stick">{counts.fix} must fix</Pill>
        <Pill tone={counts.check ? 'amber' : 'slate'} onClick={() => { setView('check'); setKind('any') }} title="Allowed, but worth fixing">{counts.check} worth checking</Pill>
        <Pill tone="emerald" onClick={() => { setView('clean'); setKind('any') }} title="Nothing found">{counts.clean} clean</Pill>
        {counts.kinds.sync ? <Pill tone="roseSolid" onClick={() => { setView('all'); setKind('sync') }} title="Regenerate pushed, Guesty did not keep it">{counts.kinds.sync} not synced</Pill> : null}
        <span className="flex-1" />
        <span className="text-[11.5px] text-muted">Guesty copy as last synced · {ago(res.data?.at)}</span>
        <button className={ghost} disabled={!!bulk || !!busy || !counts.fix} onClick={checkAllFix} title="Re-read every Must-fix unit from Guesty now, one at a time">
          <RefreshCw size={13} className={bulk ? 'animate-spin' : ''} />{bulk ? `Checking ${bulk.done}/${bulk.of}` : 'Check must-fix live'}
        </button>
        <button className={ghost} onClick={reload} disabled={!!bulk} title="Rebuild the audit"><RefreshCw size={13} /></button>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <LeanPick size="sm" value={view} onPick={setView} options={[
          { v: 'fix' as View, label: <>Must fix <span className="opacity-60 tabular-nums">{counts.fix}</span></> },
          { v: 'check' as View, label: <>Worth checking <span className="opacity-60 tabular-nums">{counts.check}</span></> },
          { v: 'clean' as View, label: <>Clean <span className="opacity-60 tabular-nums">{counts.clean}</span></> },
          { v: 'all' as View, label: <>All <span className="opacity-60 tabular-nums">{counts.all}</span></> },
        ]} />
        <span className="w-px h-4 bg-line" />
        <LeanPick size="sm" value={kind} onPick={setKind} options={[{ v: 'any' as Kind, label: 'Any problem' }, ...kinds.map(k => ({ v: k as Kind, label: <>{KIND_LABEL[k]} <span className="opacity-60 tabular-nums">{counts.kinds[k]}</span></> }))]} />
        <label className="relative ml-auto">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Unit or building" className="h-8 w-48 rounded-lg border border-line bg-white pl-7 pr-2 text-[12.5px]" />
        </label>
      </div>

      <LeanSection title={view === 'fix' ? 'Must fix' : view === 'check' ? 'Worth checking' : view === 'clean' ? 'Clean' : 'All listings'} n={shown.length}>
        {!shown.length ? <LeanEmpty>{view === 'fix' ? 'Nothing must be fixed.' : 'Nothing here.'}</LeanEmpty> : (
          <LeanList>
            {shown.map(r => {
              const lv = levelOf(r.findings)
              const l = live[r.id]
              const ks = Array.from(new Set(r.findings.map(f => f.kind)))
              return (
                <LeanRow key={r.id} tint={lv === 'fix' ? 'rose' : undefined}
                  name={r.name}
                  meta={`${r.building} · ${r.bedrooms === 0 || /\bstudio\b|\bstu\b/i.test(r.roomType) ? 'studio' : (r.bedrooms ?? '?') + ' bd'} · ${r.bathrooms ?? '?'} ba · sleeps ${r.sleeps ?? '?'}`}
                  tags={<>
                    {r.summaryLen > 500 ? <Tag tone="rose" title="Airbnb cuts everything past 500">Summary {r.summaryLen}/500</Tag> : null}
                    {ks.filter(k => !(k === 'limit' && r.summaryLen > 500 && r.findings.filter(f => f.kind === 'limit').length === 1)).map(k => <Tag key={k} tone={KIND_TONE[k]}>{KIND_LABEL[k]}</Tag>)}
                    {lv === 'clean' ? <Tag tone="emerald">Clean</Tag> : null}
                    {l && 'at' in l ? <Tag tone="sky" title="Re-read from Guesty just now">Live {ago(l.at)}</Tag> : null}
                    {l && 'error' in l ? <Tag tone="amber" title={l.error}>Live check failed</Tag> : null}
                    {r.push?.synced ? <Tag tone="emerald" title={`Last Regenerate push ${ago(r.push.at)} — Guesty kept it`}>Pushed ✓</Tag> : null}
                  </>}
                  actions={<>
                    <button className={ghost} disabled={busy === r.id || !!bulk} onClick={() => checkLive(r)} title="Re-read this unit from Guesty and check again">
                      <RefreshCw size={12} className={busy === r.id ? 'animate-spin' : ''} />Check live
                    </button>
                    {lv !== 'clean' ? <Link href={`/listings/${encodeURIComponent(r.id)}`} className={btn} title="Open the unit — Regenerate, edit, Push again"><Wrench size={12} />Fix</Link> : null}
                  </>}>
                  {r.findings.length ? (
                    <ul className="space-y-1">
                      {r.findings.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-[12.5px]">
                          <Tag tone={f.level === 'fix' ? 'rose' : 'amber'}>{f.level === 'fix' ? 'Fix' : 'Check'}</Tag>
                          <span className="text-muted shrink-0 w-28">{f.field}</span>
                          <span className="text-ink">{f.message}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-[12.5px] text-muted">Nothing found.</p>}
                  {r.title ? <p className="text-[12px] text-muted">Title: <span className="text-ink">{r.title}</span> ({r.title.length}/50)</p> : null}
                </LeanRow>
              )
            })}
          </LeanList>
        )}
      </LeanSection>
    </div>
  )
}
