'use client'
// GARDEN HOTEL OWNER REPORTS — pick a template and a period, see the datasets it will use, generate;
// the result is a report on /r/<code> with the same editor, themes and share link as the VR owner
// review. Templates are editable here: sections, cards, copy, theme.
import { useCallback, useEffect, useState } from 'react'
import { FileText, Loader2, ExternalLink, Plus, Trash2, Check, X, Settings, Wand2, Database } from 'lucide-react'
import { LeanHead, LeanTabs, LeanList, LeanRow, LeanSection, LeanEmpty, Tag, Pill, IconBtn } from '@/components/lean'

const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, { cache: 'no-store', ...init }); return r.json() }
const post = (body: any) => j('/api/garden/owner-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const input = 'rounded-lg border border-line bg-white px-3 py-2 text-[13px] focus:outline-none focus:border-brand-500'
const Label = ({ t }: { t: string }) => <span className="block text-[11px] uppercase tracking-wider text-muted font-semibold mb-1">{t}</span>
const lastMonth = () => { const t = new Date(); const from = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1)); const to = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0)); return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) } }

export function GardenOwnerReports({ canEdit, owner }: { canEdit: boolean; owner: boolean }) {
  const [tab, setTab] = useState<'reports' | 'templates' | 'datasets'>('reports')
  const [d, setD] = useState<any | null>(null)
  const [range, setRange] = useState(lastMonth())
  const [tplKey, setTplKey] = useState('owner-monthly')
  const [theme, setTheme] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [edit, setEdit] = useState<any | null>(null)
  const [ds, setDs] = useState<any[] | null>(null)
  const load = useCallback(async () => setD(await j('/api/garden/owner-reports')), [])
  useEffect(() => { load() }, [load])
  const loadDs = async () => { setDs(null); const r = await j(`/api/garden/owner-reports?datasets=1&from=${range.from}&to=${range.to}`); setDs(r?.datasets || []) }
  useEffect(() => { if (tab === 'datasets') loadDs() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [tab, range.from, range.to])
  const generate = async () => { setBusy(true); setNote(''); const r = await post({ op: 'generate', from: range.from, to: range.to, templateKey: tplKey, theme: theme || undefined }); setBusy(false); if (r?.ok) { window.location.href = '/r/' + r.code } else setNote(r?.error || 'Could not generate') }
  const saveTpl = async () => { const r = await post({ op: 'save_template', template: edit }); if (r?.ok) { setEdit(null); setD((x: any) => ({ ...x, templates: r.templates })) } else setNote(r?.error || 'Could not save') }
  const resetTpl = async (key: string) => { const r = await post({ op: 'reset_template', key }); if (r?.ok) setD((x: any) => ({ ...x, templates: r.templates })) }
  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
  if (!d.ok) return <><LeanHead title="Owner reports" icon={<FileText size={20} className="text-brand-600" />} /><LeanEmpty>{d.error}</LeanEmpty></>
  const tpl = d.templates.find((t: any) => t.key === tplKey) || d.templates[0]
  const secLabel = (k: string) => (d.sections.find((s: any) => s.key === k) || {}).label || k
  return (
    <>
      <LeanHead title="Owner reports" icon={<FileText size={20} className="text-brand-600" />}>
        <Pill title="Reports generated for the hotel">{d.reports.length} reports</Pill>
        <Pill tone="brand" title="Design templates — sections, cards, copy and theme">{d.templates.length} templates</Pill>
      </LeanHead>
      <p className="text-[12.5px] text-muted mb-3">The same report the vacation-rental owners get — same page, same editor, same themes and share link — built from the hotel&apos;s datasets through a template. The Garden theme is the hotel&apos;s own site: sand, forest green, Playfair over Montserrat.</p>
      {note ? <p className="text-[12px] text-rose-700 mb-2">{note}</p> : null}
      <LeanTabs value={tab} onChange={setTab} tabs={[{ key: 'reports', label: 'Reports', n: d.reports.length }, { key: 'templates', label: 'Templates', n: d.templates.length }, { key: 'datasets', label: 'Datasets' }]} />

      {tab === 'reports' ? (<>
        {canEdit ? (
          <div className="rounded-2xl border border-line bg-white p-3 mb-3 flex items-end gap-2 flex-wrap text-[13px]">
            <label><Label t="From" /><input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} className={input} /></label>
            <label><Label t="To" /><input type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} className={input} /></label>
            <label><Label t="Template" /><select value={tplKey} onChange={e => setTplKey(e.target.value)} className={input}>{d.templates.map((t: any) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></label>
            <label><Label t="Theme" /><select value={theme} onChange={e => setTheme(e.target.value)} className={input}><option value="">{tpl ? `template's (${tpl.theme})` : 'garden'}</option>{d.themes.map((t: string) => <option key={t} value={t}>{t}</option>)}</select></label>
            <button onClick={generate} disabled={busy} className="rounded-lg bg-ink text-white px-3 h-9 text-[12px] font-semibold inline-flex items-center gap-1 disabled:opacity-50">{busy ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Generate</button>
            {tpl ? <span className="text-[12px] text-muted">{tpl.sections.map(secLabel).join(' · ')}</span> : null}
          </div>
        ) : null}
        {d.reports.length ? <LeanList>{d.reports.map((r: any) => (
          <LeanRow key={r.id} name={r.title} meta={`${r.period_start} → ${r.period_end} · ${r.theme} · updated ${when(r.updated_at)}`} tags={<Tag tone={r.status === 'sent' ? 'emerald' : r.status === 'final' ? 'brand' : 'amber'}>{r.status}</Tag>}
            actions={<><IconBtn title="Open — edit, change the theme, share" href={'/r/' + r.code}><ExternalLink size={14} /></IconBtn></>} />
        ))}</LeanList> : <LeanEmpty>No hotel reports yet — pick a period and a template above.</LeanEmpty>}
      </>) : null}

      {tab === 'templates' ? (<>
        {canEdit ? <div className="flex justify-end mb-2"><button onClick={() => setEdit({ key: '', name: '', blurb: '', theme: 'garden', font: 'garden', sections: ['verdict', 'snapshot'], cards: ['occupancy', 'adr', 'revpar', 'revenue'], copy: { ...(d.templates[0]?.copy || {}) } })} className="rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1"><Plus size={12} /> New template</button></div> : null}
        {edit ? <TemplateEditor t={edit} setT={setEdit} d={d} onSave={saveTpl} onCancel={() => setEdit(null)} /> : null}
        <LeanList>{d.templates.map((t: any) => (
          <LeanRow key={t.key} name={t.name} meta={t.blurb} tags={<><Tag tone="brand">{t.theme}</Tag>{t.shipped ? <Tag>shipped</Tag> : <Tag tone="violet">custom</Tag>}</>}
            actions={canEdit ? <><IconBtn title="Edit" onClick={() => setEdit({ ...t, copy: { ...(t.copy || {}) } })}><Settings size={14} /></IconBtn><IconBtn title={t.shipped ? 'Back to the shipped version' : 'Delete'} tone="bad" onClick={() => resetTpl(t.key)}><Trash2 size={14} /></IconBtn></> : undefined}>
            <p className="text-[12.5px] text-ink/85">Sections: {t.sections.map(secLabel).join(' → ')}</p>
            <p className="text-[12.5px] text-muted">Cards: {t.cards.join(', ')} · Font: {t.font || 'garden'}</p>
          </LeanRow>
        ))}</LeanList>
      </>) : null}

      {tab === 'datasets' ? (<>
        <div className="flex items-end gap-2 flex-wrap mb-3 text-[13px]">
          <label><Label t="From" /><input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} className={input} /></label>
          <label><Label t="To" /><input type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} className={input} /></label>
          <span className="text-muted pb-2 inline-flex items-center gap-1"><Database size={13} /> What a report for this period is built from — every number, before any design.</span>
        </div>
        {!ds ? <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Reading the tables…</p> : ds.length ? (
          <LeanList>{ds.map((x: any) => (
            <LeanRow key={x.key} name={x.label} meta={x.what} tags={<Tag>{x.count} row{x.count === 1 ? '' : 's'}</Tag>}>
              {x.summary ? <pre className="text-[11.5px] text-ink/80 bg-app rounded-lg p-2 overflow-x-auto">{JSON.stringify(x.summary, null, 1).slice(0, 1600)}</pre> : null}
              {x.rows.length ? <pre className="text-[11.5px] text-ink/80 bg-app rounded-lg p-2 overflow-x-auto">{JSON.stringify(x.rows.slice(0, 6), null, 1).slice(0, 2400)}</pre> : <p className="text-[12px] text-muted">Empty for this period.</p>}
            </LeanRow>
          ))}</LeanList>
        ) : <LeanEmpty>Nothing yet.</LeanEmpty>}
      </>) : null}
    </>
  )
}

function TemplateEditor({ t, setT, d, onSave, onCancel }: { t: any; setT: (t: any) => void; d: any; onSave: () => void; onCancel: () => void }) {
  const set = (k: string, v: any) => setT({ ...t, [k]: v })
  const setCopy = (k: string, v: string) => setT({ ...t, copy: { ...(t.copy || {}), [k]: v } })
  const toggle = (list: 'sections' | 'cards', k: string, max?: number) => { const cur: string[] = t[list] || []; if (cur.includes(k)) set(list, cur.filter(x => x !== k)); else if (!max || cur.length < max) set(list, [...cur, k]) }
  const COPY: [string, string][] = [['heroEyebrow', 'Cover eyebrow'], ['heroDateLabel', 'Cover label'], ['preparedFor', 'Prepared for'], ['snapshotHeadline', 'Snapshot headline'], ['snapshotSubtitle', 'Snapshot subtitle'], ['listingsHeadline', 'By room type headline'], ['aheadHeadline', 'On the books headline'], ['voicesHeadline', 'Guest voices headline'], ['projectsHeadline', 'The work headline'], ['sourcesHeadline', 'Sources headline'], ['operationsHeadline', 'Operations headline']]
  return (
    <div className="rounded-2xl border border-line bg-white p-4 mb-3 space-y-3 text-[13px]">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label><Label t="Key (slug)" /><input value={t.key} onChange={e => set('key', e.target.value)} disabled={!!t.shipped} className={`${input} w-full`} /></label>
        <label><Label t="Name" /><input value={t.name} onChange={e => set('name', e.target.value)} className={`${input} w-full`} /></label>
        <label><Label t="Theme" /><select value={t.theme} onChange={e => set('theme', e.target.value)} className={`${input} w-full`}>{d.themes.map((x: string) => <option key={x}>{x}</option>)}</select></label>
        <label className="sm:col-span-2"><Label t="What it is for" /><input value={t.blurb} onChange={e => set('blurb', e.target.value)} className={`${input} w-full`} /></label>
        <label><Label t="Typeface pair" /><select value={t.font || 'garden'} onChange={e => set('font', e.target.value)} className={`${input} w-full`}>{d.fonts.map((x: string) => <option key={x}>{x}</option>)}</select></label>
      </div>
      <div><Label t="Sections, in order (click to add or remove)" /><div className="flex flex-wrap gap-1.5">{d.sections.map((s: any) => { const on = (t.sections || []).includes(s.key); const idx = (t.sections || []).indexOf(s.key); return <button key={s.key} onClick={() => toggle('sections', s.key)} title={s.what} className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold border ${on ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-muted border-line'}`}>{on ? `${idx + 1}. ` : ''}{s.label}</button> })}</div></div>
      <div><Label t="Snapshot cards (four)" /><div className="flex flex-wrap gap-1.5">{d.cards.map((c: any) => { const on = (t.cards || []).includes(c.key); return <button key={c.key} onClick={() => toggle('cards', c.key, 4)} title={c.what} className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold border ${on ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line'}`}>{c.label}</button> })}</div></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{COPY.map(([k, l]) => <label key={k}><Label t={`${l} — {hotel} {period} {rooms}`} /><input value={t.copy?.[k] || ''} onChange={e => setCopy(k, e.target.value)} className={`${input} w-full`} /></label>)}</div>
      <div className="flex gap-2"><button onClick={onSave} className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1"><Check size={12} /> Save template</button><button onClick={onCancel} className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1"><X size={12} /> Cancel</button></div>
    </div>
  )
}
