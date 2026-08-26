'use client'
// EVE'S LIBRARY — the written knowledge, and the one screen that puts something in it.
//
// Everything else she knows she worked out from records. This is where a person hands her what was
// never in a table: the departure-clean standard, the mini-GM playbook, the refund rules, how an
// owner statement is supposed to read. Written policy outranks anything she inferred, which is
// exactly why adding to it is admin-only and why re-uploading a title REPLACES it — two live
// versions of one rule is how a policy quietly contradicts itself.
//
// Drop a .md or .txt and the browser reads it; anything else, paste the text. Extracting text from
// a .docx or a scanned PDF is a different job with different failure modes, and a library that
// silently stores an empty document is worse than one that asks you to paste.
import { useState, useEffect, useCallback, useRef } from 'react'
import { BookOpen, Upload, Trash2, RefreshCw, Check, AlertTriangle, FileText } from 'lucide-react'

type Doc = {
  id: string; title: string; category: string; source: string | null
  words: number; sections: number; active: boolean; added_by: string | null; updated_at: string
}

const card = 'bg-white border border-line rounded-2xl shadow-soft'
const input = 'w-full text-sm text-ink bg-app border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200'
const btn = 'inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-xl px-3 py-1.5 transition-colors'

const CATEGORY_HELP: Record<string, string> = {
  sop: 'How a job is done, step by step.',
  playbook: 'How to think about a situation — judgement, not steps.',
  policy: 'A rule with consequences: refunds, access, owner money.',
  reference: 'Facts to look up — buildings, contacts, codes, systems.',
  research: 'Findings and analysis. Context, not instruction.',
}

export function EveDocsAdmin({ canEdit }: { canEdit: boolean }) {
  const [docs, setDocs] = useState<Doc[]>([])
  const [cats, setCats] = useState<string[]>(['sop', 'playbook', 'policy', 'reference', 'research'])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState({ title: '', category: 'sop', source: '', body: '' })
  const fileRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/eve/docs').then(x => x.json())
      if (r?.error) setErr(r.error)
      else { setDocs(r.docs || []); if (Array.isArray(r.categories)) setCats(r.categories); setErr('') }
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function pickFile(f: File | null) {
    if (!f) return
    if (!/\.(md|txt|markdown|csv)$/i.test(f.name)) {
      setErr(`${f.name} is not a text file. Open it, copy the content, and paste it below — a document I cannot read is a document that would sit in her library saying nothing.`)
      return
    }
    const text = await f.text()
    setErr('')
    setDraft(d => ({
      ...d,
      body: text,
      source: f.name,
      title: d.title || f.name.replace(/\.(md|txt|markdown|csv)$/i, '').replace(/[-_]+/g, ' ').trim(),
    }))
  }

  async function save() {
    setBusy('save'); setNote(''); setErr('')
    try {
      const r = await fetch('/api/eve/docs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      }).then(x => x.json())
      if (r?.ok) {
        setNote(`${r.replaced ? 'Replaced' : 'Added'} "${r.title}" — ${r.words.toLocaleString()} words in ${r.sections} sections. She can quote it now.`)
        setDraft({ title: '', category: draft.category, source: '', body: '' })
        if (fileRef.current) fileRef.current.value = ''
        await load()
      } else setErr(r?.error || r?.message || 'That did not save.')
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy('') }
  }

  async function retire(d: Doc) {
    setBusy(d.id)
    try {
      await fetch(`/api/eve/docs?id=${encodeURIComponent(d.id)}`, { method: 'DELETE' })
      await load()
      setNote(`"${d.title}" retired — she will stop quoting it. It is kept, not deleted, because it still explains decisions made while it was current.`)
    } finally { setBusy('') }
  }

  const words = draft.body.trim() ? draft.body.trim().split(/\s+/).length : 0

  return (
    <div className="space-y-4">
      {err && <p className="text-[13px] text-[#A32020] inline-flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{err}</p>}
      {note && <p className="text-[13px] text-[#1F7A4D] inline-flex items-start gap-1.5"><Check size={13} className="mt-0.5 shrink-0" />{note}</p>}

      <div className={`${card} p-4`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5"><BookOpen size={14} /> What she has read</p>
            <p className="text-[13px] text-muted mt-1 max-w-2xl">
              Everything else Eve knows she worked out from records. These are the things that were never in a
              table — the standards, the playbooks, the rules. When a document says something, she quotes it by
              name and it outranks anything she concluded on her own.
            </p>
          </div>
          <button onClick={load} className="text-muted hover:text-ink shrink-0" title="Refresh"><RefreshCw size={14} /></button>
        </div>

        {loading && !docs.length ? <p className="text-[13px] text-muted mt-3">Loading…</p> : null}
        {!loading && !docs.length ? (
          <p className="text-[13px] text-muted mt-3">Nothing loaded yet. Until something is here, every answer she gives about how we do things is inferred from what the records happen to show.</p>
        ) : null}

        <div className="mt-3 space-y-2">
          {docs.filter(d => d.active).map(d => (
            <div key={d.id} className="border border-line rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5"><FileText size={13} /> {d.title}</p>
                <p className="text-[12px] text-muted">
                  {d.category} · {d.words.toLocaleString()} words · {d.sections} sections{d.source ? ` · from ${d.source}` : ''}
                  {d.added_by ? ` · added by ${d.added_by}` : ''}
                </p>
              </div>
              <button disabled={!canEdit || busy === d.id} onClick={() => retire(d)}
                className={`${btn} bg-app border border-line text-ink hover:bg-white disabled:opacity-40`}>
                <Trash2 size={13} /> Retire
              </button>
            </div>
          ))}
        </div>
        {docs.some(d => !d.active) && (
          <p className="text-[12px] text-muted mt-3">Retired: {docs.filter(d => !d.active).map(d => d.title).join(', ')}. Kept for the record, never quoted.</p>
        )}
      </div>

      {/* ---- Add ---- */}
      <div className={`${card} p-4`}>
        <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5"><Upload size={14} /> Add a document</p>
        <p className="text-[13px] text-muted mt-1 max-w-2xl">
          Drop a <b>.md</b> or <b>.txt</b> and it fills itself in, or paste the text. Re-using a title replaces
          that document rather than adding a second copy. It is split on its own headings, so she can answer
          from the one relevant section instead of reciting the whole thing.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input className={input} placeholder="Title — she will quote this name" value={draft.title}
            disabled={!canEdit} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
          <select className={input} value={draft.category} disabled={!canEdit}
            onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}>
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <p className="text-[12px] text-muted mt-1">{CATEGORY_HELP[draft.category] || ''}</p>

        <div className="mt-2">
          <input ref={fileRef} type="file" accept=".md,.txt,.markdown,.csv" disabled={!canEdit}
            onChange={e => pickFile(e.target.files?.[0] || null)}
            className="text-[13px] text-muted file:mr-3 file:rounded-xl file:border file:border-line file:bg-app file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-ink" />
        </div>

        <textarea className={input + ' mt-2 min-h-[160px] font-mono text-[12px]'} placeholder="Or paste the document here…"
          value={draft.body} disabled={!canEdit} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))} />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button disabled={!canEdit || busy === 'save' || !draft.title.trim() || words < 20}
            onClick={save} className={`${btn} bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40`}>
            <Upload size={13} /> {busy === 'save' ? 'Saving…' : 'Add to her library'}
          </button>
          <span className="text-[12px] text-muted">{words ? `${words.toLocaleString()} words` : 'nothing pasted yet'}</span>
        </div>
      </div>
    </div>
  )
}
