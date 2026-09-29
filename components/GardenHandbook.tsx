'use client'
// THE HOTEL'S HANDBOOK — the Garden Hotel's own SOPs, by section. Adam answers from what is written
// here. Empty entries are the outline still to fill.
import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Loader2, Plus, Save, Trash2, FileText } from 'lucide-react'
import { LeanHead, LeanList, LeanRow, LeanEmpty, Tag, Pill, IconBtn } from '@/components/lean'
import { AgentFileDrop } from '@/components/AgentFileDrop'

const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, { cache: 'no-store', ...init }); return r.json().catch(() => ({})) }
const send = (method: string, body: any) => j('/api/garden/handbook', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export function GardenHandbook({ canEdit, canFull }: { canEdit: boolean; canFull: boolean }) {
  const [d, setD] = useState<any | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [add, setAdd] = useState({ section: '', title: '' })
  const load = useCallback(async () => setD(await j('/api/garden/handbook')), [])
  useEffect(() => { load() }, [load])
  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
  if (!d.ok) return <><LeanHead title="Handbook" icon={<BookOpen size={20} className="text-emerald-700" />} /><LeanEmpty>{/does not exist|schema cache/i.test(d.error || '') ? 'Run migration 118_garden_unit.sql, then reload.' : (d.message || d.error)}</LeanEmpty></>
  const sections: string[] = Array.from(new Set(d.entries.map((e: any) => e.section)))
  const filled = d.entries.filter((e: any) => String(e.body || '').trim()).length
  return (
    <>
      <LeanHead title="Handbook" icon={<BookOpen size={20} className="text-emerald-700" />}>
        <Pill tone={filled === d.entries.length ? 'emerald' : 'amber'} title="Entries with content">{filled}/{d.entries.length} written</Pill>
      </LeanHead>
      <p className="text-[12.5px] text-muted mb-3">The Garden Hotel&apos;s own way of doing things. Adam answers from what is written here; blank entries are the outline still to fill.</p>
      {canEdit ? (
        <div className="flex flex-wrap gap-2 mb-3">
          <input list="hb-sections" className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] w-44" placeholder="Section" value={add.section} onChange={e => setAdd({ ...add, section: e.target.value })} />
          <datalist id="hb-sections">{sections.map(s => <option key={s} value={s} />)}</datalist>
          <input className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] flex-1 min-w-[12rem]" placeholder="Entry title" value={add.title} onChange={e => setAdd({ ...add, title: e.target.value })} />
          <button onClick={async () => { if (!add.section.trim() || !add.title.trim()) return; await send('POST', add); setAdd({ section: add.section, title: '' }); load() }} className="rounded-lg bg-ink text-white px-3 text-[12px] font-semibold inline-flex items-center gap-1"><Plus size={13} /> Add entry</button>
          <div className="basis-full">
            <AgentFileDrop forWho="handbook" label="Import a file as an entry" onText={async f => { await send('POST', { section: add.section.trim() || 'Imported', title: add.title.trim() || f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '), body: f.text, file_path: f.path }); setAdd({ section: add.section, title: '' }); load() }} />
          </div>
        </div>
      ) : null}
      {sections.map(sec => (
        <div key={sec} className="mb-3">
          <div className="px-1 pb-1 text-[10.5px] uppercase tracking-[0.12em] font-bold text-muted/70">{sec}</div>
          <LeanList>{d.entries.filter((e: any) => e.section === sec).map((e: any) => {
            const val = draft[e.id] ?? e.body
            return (
              <LeanRow key={e.id} name={e.title} meta={e.updated_by ? `${e.updated_by} · ${new Date(e.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : undefined}
                tags={<>{String(e.body || '').trim() ? null : <Tag tone="amber">to write</Tag>}{(e.audience || []).length ? <Tag>for {e.audience.join(', ')}</Tag> : null}</>}
                actions={<>
                  {canEdit && draft[e.id] != null && draft[e.id] !== e.body ? <IconBtn title="Save" tone="ok" onClick={async () => { await send('POST', { ...e, body: draft[e.id] }); setDraft(x => { const n = { ...x }; delete n[e.id]; return n }); load() }}><Save size={14} /></IconBtn> : null}
                  {canFull ? <IconBtn title="Delete entry" tone="bad" onClick={async () => { await send('DELETE', { id: e.id }); load() }}><Trash2 size={14} /></IconBtn> : null}
                </>}>
                {canEdit ? <AgentFileDrop forWho="handbook" label="Fill this entry from a file" onText={f => setDraft(x => ({ ...x, [e.id]: f.text }))} /> : null}
                {e.file_path ? <a href={`/api/files/open?path=${encodeURIComponent(e.file_path)}`} target="_blank" rel="noreferrer" className="text-[12px] text-brand-700 hover:underline inline-flex items-center gap-1"><FileText size={12} /> Original file</a> : null}
                {canEdit
                  ? <textarea value={val} onChange={ev => setDraft(x => ({ ...x, [e.id]: ev.target.value }))} rows={Math.min(16, Math.max(4, String(val || '').split('\n').length + 1))} className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[13px] focus:outline-none focus:border-brand-500" placeholder="How the hotel does this…" />
                  : <p className="text-[13px] text-ink/85 whitespace-pre-wrap">{e.body || '—'}</p>}
              </LeanRow>
            )
          })}</LeanList>
        </div>
      ))}
    </>
  )
}
