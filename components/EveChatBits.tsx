'use client'
// THE LEARNING BITS OF EVE'S CHAT (Jon, 2026-11-05: "EVE chat needs to be a learning chat, where we
// can teach Eve"). Shared by the /eve Chat tab and the floating bubble so both show the same thing:
//   LearnedChips  every memory a turn wrote — "Saved as rule · Botanica · Undo · Edit", or for a
//                 non-teacher's auto-capture "Suggested — Confirm / Dismiss" (a teacher confirms)
//   WhatIUsed     the memories and tools an answer drew on, each memory with "This is wrong"
// All writes go through /api/eve/memory, which enforces who may change what.
import { useState } from 'react'
import { Check, X, Pencil, Undo2, ChevronDown, ChevronRight, GraduationCap, AlertTriangle, Lightbulb } from 'lucide-react'

export type Learned = { id: string; kind: string; text: string; scope: string; scopeLabel: string; weight: number; source: string; teacher: string | null; via: string; status: 'saved' | 'suggested'; _gone?: boolean; _note?: string }
export type Used = { id: string; kind: string; text: string; source: string }

const box = 'w-full text-[12.5px] text-ink bg-white border border-line rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200'
const KIND_LABEL: Record<string, string> = { rule: 'rule', preference: 'preference', insight: 'note', decision: 'decision', person: 'person', issue: 'known issue', correction: 'correction' }

async function memPost(payload: any): Promise<any> {
  const r = await fetch('/api/eve/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || d?.error) throw new Error(d?.error || `HTTP ${r.status}`)
  return d
}

export function LearnedChips({ items, onChange }: { items: Learned[]; onChange: (next: Learned[]) => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState('')
  if (!items?.length) return null
  const patch = (id: string, p: Partial<Learned>) => onChange(items.map(x => (x.id === id ? { ...x, ...p } : x)))
  const act = async (id: string, fn: () => Promise<any>, after: (d: any) => Partial<Learned>) => {
    setBusy(id)
    try { const d = await fn(); patch(id, { ...after(d), _note: undefined }) } catch (e: any) { patch(id, { _note: String(e?.message || e) }) }
    setBusy('')
  }
  return (
    <div className="mt-1.5 flex flex-col gap-1 max-w-[90%]">
      {items.map(l => (
        <div key={l.id} className={`rounded-xl border px-2.5 py-1.5 text-[11.5px] ${l._gone ? 'border-line bg-app text-muted line-through' : l.status === 'suggested' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-brand-200 bg-brand-50 text-brand-800'}`}>
          <div className="flex items-center gap-1.5 flex-wrap">
            {l.status === 'suggested' ? <Lightbulb size={12} className="flex-shrink-0" /> : <GraduationCap size={12} className="flex-shrink-0" />}
            <span className="font-semibold">{l.status === 'suggested' ? 'Suggested' : `Saved as ${KIND_LABEL[l.kind] || l.kind}`}</span>
            <span className="opacity-60">·</span><span>{l.scopeLabel || 'Everywhere'}</span>
            {l.teacher && <><span className="opacity-60">·</span><span className="opacity-80">{l.teacher}</span></>}
            {!l._gone && (
              <span className="ml-auto inline-flex items-center gap-2">
                {l.status === 'suggested' ? (
                  <>
                    <button disabled={busy === l.id} onClick={() => act(l.id, () => memPost({ op: 'confirm', id: l.id }), d => ({ id: d.id || l.id, status: 'saved', kind: d.kind || 'rule', weight: d.weight || l.weight }))} className="inline-flex items-center gap-0.5 font-semibold hover:underline"><Check size={12} /> Confirm</button>
                    <button disabled={busy === l.id} onClick={() => act(l.id, () => memPost({ op: 'dismiss', id: l.id }), () => ({ _gone: true }))} className="inline-flex items-center gap-0.5 hover:underline"><X size={12} /> Dismiss</button>
                  </>
                ) : (
                  <>
                    <button disabled={busy === l.id} onClick={() => act(l.id, () => memPost({ op: 'delete', id: l.id }), () => ({ _gone: true }))} className="inline-flex items-center gap-0.5 hover:underline"><Undo2 size={12} /> Undo</button>
                    <button onClick={() => { setEditing(editing === l.id ? null : l.id); setDraft(l.text) }} className="inline-flex items-center gap-0.5 hover:underline"><Pencil size={12} /> Edit</button>
                  </>
                )}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-ink/80 whitespace-pre-wrap">{l.text}</div>
          {editing === l.id && !l._gone && (
            <div className="mt-1.5">
              <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2} className={box} />
              <div className="flex gap-2 mt-1">
                <button disabled={busy === l.id || !draft.trim()} onClick={async () => { await act(l.id, () => memPost({ op: 'update', id: l.id, text: draft.trim() }), () => ({ text: draft.trim() })); setEditing(null) }}
                  className="text-[11.5px] font-semibold bg-brand-600 text-white rounded-lg px-2.5 py-1 hover:bg-brand-700 disabled:opacity-50">Save</button>
                <button onClick={() => setEditing(null)} className="text-[11.5px] text-muted hover:text-ink">Cancel</button>
              </div>
            </div>
          )}
          {l._note && <div className="mt-1 text-[11px] text-rose-700">{l._note}</div>}
        </div>
      ))}
    </div>
  )
}

const TOOL_NICE = (t: string) => String(t || '').replace(/^_/, '').replace(/_/g, ' ')

export function WhatIUsed({ used, tools, chatId, conversationId }: { used?: Used[]; tools?: string[]; chatId?: string | null; conversationId?: string | null }) {
  const [open, setOpen] = useState(false)
  const [fixFor, setFixFor] = useState<string | null>(null)
  const [fix, setFix] = useState('')
  const [done, setDone] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const u = used || []
  const t = Array.from(new Set((tools || []).filter(x => x && !x.startsWith('_'))))
  if (!u.length && !t.length) return null
  async function save(id: string) {
    setBusy(true)
    try {
      const d = await memPost({ op: 'correct', id, text: fix.trim(), chatId, conversationId })
      setDone(m => ({ ...m, [id]: d.superseded === false ? 'Kept beside the original — its author decides.' : 'Corrected — she will use this instead.' }))
      setFixFor(null); setFix('')
    } catch (e: any) { setDone(m => ({ ...m, [id]: String(e?.message || e) })) }
    setBusy(false)
  }
  return (
    <div className="mt-1 max-w-[90%]">
      <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-ink">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} What I used{u.length ? ` · ${u.length} memor${u.length === 1 ? 'y' : 'ies'}` : ''}{t.length ? ` · ${t.length} tool${t.length === 1 ? '' : 's'}` : ''}
      </button>
      {open && (
        <div className="mt-1 rounded-xl border border-line bg-app px-2.5 py-2 space-y-1.5">
          {u.map(m => (
            <div key={m.id} className="text-[11.5px]">
              <div className="flex items-start gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-muted mt-0.5 flex-shrink-0">{KIND_LABEL[m.kind] || m.kind}</span>
                <span className="text-ink flex-1">{m.text} <span className="text-muted">— {m.source === 'jon' ? 'Jon' : String(m.source).split('@')[0]}</span></span>
                {!done[m.id] && <button onClick={() => { setFixFor(fixFor === m.id ? null : m.id); setFix('') }} className="flex-shrink-0 inline-flex items-center gap-0.5 text-[11px] text-rose-700 hover:underline"><AlertTriangle size={11} /> This is wrong</button>}
              </div>
              {done[m.id] && <div className="text-[11px] text-brand-700 mt-0.5">{done[m.id]}</div>}
              {fixFor === m.id && (
                <div className="mt-1">
                  <textarea value={fix} onChange={e => setFix(e.target.value)} rows={2} className={box} placeholder="What is actually right? One sentence she can follow." />
                  <div className="flex gap-2 mt-1">
                    <button disabled={busy || fix.trim().length < 6} onClick={() => save(m.id)} className="text-[11.5px] font-semibold bg-brand-600 text-white rounded-lg px-2.5 py-1 hover:bg-brand-700 disabled:opacity-50">Save correction</button>
                    <button onClick={() => setFixFor(null)} className="text-[11.5px] text-muted hover:text-ink">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {t.length > 0 && <div className="text-[11px] text-muted">Tools: {t.map(TOOL_NICE).join(' · ')}</div>}
        </div>
      )}
    </div>
  )
}
