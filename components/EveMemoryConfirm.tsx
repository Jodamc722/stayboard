'use client'
// CONFIRM WHAT SHE LEARNED — Settings → Eve → Memory, under the clean-up card (2026-11-10).
//
// Most of Eve's memory was overheard in Slack or concluded in her nightly reflection and never
// checked by anyone. Those rows are unconfirmed: she may recall one, tagged as unconfirmed, but it
// is never a standing rule. This is where a person settles them — grouped by building, each with
// the words it came from. Approve makes it yours (your name, your weight, it stops fading); Edit
// fixes the wording first; Reject takes it out of every prompt. Nothing is deleted.
// Reads GET /api/eve/memory?pending=1; writes POST /api/eve/memory (pending_approve / _edit / _reject).
import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, ListChecks, Pencil, RefreshCw, X } from 'lucide-react'

type Fact = {
  id: string; kind: string; text: string; why: string | null; scope: string; weight: number; source: string; created_at: string
  origin: 'slack' | 'reflection' | 'eve'
  quote: { where: string; speaker: string | null; at: string | null; text: string | null; permalink: string | null }
  disputes: { id: string; text: string } | null
}
type Group = { group: string; items: Fact[] }

const card = 'bg-white border border-line rounded-2xl shadow-soft'
const input = 'w-full text-sm text-ink bg-app border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200'
const btn = 'inline-flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-1.5 disabled:opacity-50'

function day(iso: string | null): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date(t)) } catch { return '' }
}

export function EveMemoryConfirm({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const [groups, setGroups] = useState<Group[]>([])
  const [total, setTotal] = useState(0)
  const [shown, setShown] = useState(0)
  const [canApprove, setCanApprove] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/eve/memory?pending=1')
      const d = await r.json().catch(() => null)
      if (!r.ok || !d?.ok) { setErr(String(d?.error || `The list did not load (HTTP ${r.status}).`)); setGroups([]); setTotal(0); setShown(0) }
      else { setErr(''); setGroups(Array.isArray(d.groups) ? d.groups : []); setTotal(Number(d.total) || 0); setShown(Number(d.shown) || 0); setCanApprove(!!d.canApprove) }
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function send(key: string, payload: any, done: (d: any) => string) {
    setBusy(key); setNote('')
    try {
      const r = await fetch('/api/eve/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const d = await r.json().catch(() => ({} as any))
      setNote(r.ok && d?.ok ? done(d) : String(d?.error || 'That did not go through — nothing was changed.'))
      if (r.ok && d?.ok) { setEditing(null); setDraft('') }
      await load(); onChanged()
    } catch (e: any) { setNote(e?.message || String(e)) } finally { setBusy('') }
  }

  const may = canEdit && canApprove
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  return (
    <div id="memory-confirm" className={`${card} p-4 mb-4 scroll-mt-20`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">
          <ListChecks size={14} /> Confirm what she learned
          {!loading && !err && total > 0 && <span className="text-[11px] font-semibold rounded-full bg-[#FDF3E0] text-[#9A6200] border border-[#F0DAA8] px-2 py-0.5">{total} waiting</span>}
        </p>
        <button onClick={load} disabled={loading || !!busy} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink disabled:opacity-50">
          <RefreshCw size={12} /> {loading ? 'Reading…' : 'Refresh'}
        </button>
      </div>
      <p className="text-[12px] text-muted mt-1">
        What she overheard in Slack or concluded on her own, and nobody has checked. Until you approve one she may mention it as unconfirmed, never as a rule.
        Approve makes it yours; Reject takes it out of her head. Nothing is deleted.
      </p>

      {loading && !groups.length && <p className="text-[13px] text-muted mt-3">Reading what is waiting…</p>}
      {err && (
        <div className="mt-3 text-[13px] text-[#9A6200] bg-[#FDF3E0] border border-[#F0DAA8] rounded-xl px-3.5 py-2.5">
          Could not load the list: {err} <button onClick={load} className="underline font-semibold ml-1">Try again</button>
        </div>
      )}
      {note && <div className="mt-3 text-[13px] text-ink bg-app border border-line rounded-xl px-3.5 py-2.5">{note}</div>}
      {!loading && !err && total === 0 && <p className="text-[13px] text-ink mt-3">Nothing is waiting. Everything she holds has a person behind it or came from the records.</p>}
      {!loading && !err && total > 0 && !canApprove && <p className="text-[12px] text-muted mt-2">Only Jon and the named teachers can approve or reject these.</p>}
      {!err && total > shown && <p className="text-[12px] text-muted mt-2">Showing the newest {shown} of {total}. The rest appear as you work through these.</p>}

      <div className="mt-3 space-y-2">
        {groups.map(g => {
          const isOpen = !!open[g.group]
          const ids = g.items.map(i => i.id)
          return (
            <div key={g.group} className="rounded-xl border border-line">
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <button onClick={() => setOpen(o => ({ ...o, [g.group]: !o[g.group] }))} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink text-left">
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {g.group}
                  <span className="text-[11px] font-normal text-muted">{plural(g.items.length, 'thing', 'things')}</span>
                </button>
                {may && (
                  <button disabled={!!busy} onClick={() => { if (window.confirm(`Approve all ${g.items.length} under "${g.group}"? Each becomes a memory in your name.`)) send('all:' + g.group, { op: 'pending_approve', ids }, d => `Approved ${d.approved ?? 0}${d.skipped ? `, ${d.skipped} skipped` : ''} under ${g.group}.`) }}
                    className={`${btn} bg-brand-600 text-white hover:bg-brand-700`}>
                    <Check size={12} /> {busy === 'all:' + g.group ? 'Approving…' : 'Approve all in this group'}
                  </button>
                )}
              </div>
              {isOpen && (
                <ul className="border-t border-line divide-y divide-line">
                  {g.items.map(f => (
                    <li key={f.id} className="px-3 py-2.5">
                      {editing === f.id ? (
                        <div className="space-y-2">
                          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} className={input} />
                          <div className="flex items-center gap-2">
                            <button disabled={!!busy || draft.trim().length < 8} onClick={() => send('edit:' + f.id, { op: 'pending_edit', id: f.id, text: draft.trim() }, () => 'Saved with your wording, in your name.')}
                              className={`${btn} bg-brand-600 text-white hover:bg-brand-700`}><Check size={12} /> {busy === 'edit:' + f.id ? 'Saving…' : 'Save and approve'}</button>
                            <button disabled={!!busy} onClick={() => { setEditing(null); setDraft('') }} className={`${btn} text-muted border border-line hover:text-ink`}><X size={12} /> Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-[13px] text-ink">{f.text}</p>
                          <p className="text-[11px] text-muted mt-1">
                            {f.origin === 'slack' ? 'Overheard in ' : 'From '}{f.quote.where}{f.quote.speaker ? ` · ${f.quote.speaker}` : ''}{day(f.quote.at || f.created_at) ? ` · ${day(f.quote.at || f.created_at)}` : ''} · {f.kind}
                            {f.quote.permalink && <> · <a href={f.quote.permalink} target="_blank" rel="noreferrer" className="underline">open in Slack</a></>}
                          </p>
                          {f.quote.text && <p className="text-[12px] text-muted mt-1 border-l-2 border-line pl-2 italic">“{f.quote.text}”</p>}
                          {!f.quote.text && f.why && <p className="text-[12px] text-muted mt-1 border-l-2 border-line pl-2">{f.why}</p>}
                          {f.disputes && <p className="text-[12px] text-[#9A6200] bg-[#FDF3E0] border border-[#F0DAA8] rounded-lg px-2 py-1 mt-1.5">Disagrees with something a person taught her: “{f.disputes.text}”</p>}
                          {may && (
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              <button disabled={!!busy} onClick={() => send('ok:' + f.id, { op: 'pending_approve', ids: [f.id] }, () => 'Approved — it is a memory in your name now.')}
                                className={`${btn} bg-brand-600 text-white hover:bg-brand-700`}><Check size={12} /> {busy === 'ok:' + f.id ? 'Approving…' : 'Approve'}</button>
                              <button disabled={!!busy} onClick={() => { setEditing(f.id); setDraft(f.text) }} className={`${btn} text-ink border border-line hover:bg-app`}><Pencil size={12} /> Edit</button>
                              <button disabled={!!busy} onClick={() => send('no:' + f.id, { op: 'pending_reject', ids: [f.id] }, () => 'Rejected — she will not use it, and it is kept on file as rejected.')}
                                className={`${btn} text-[#B42318] border border-[#F3C7C2] hover:bg-[#FEF3F2]`}><X size={12} /> {busy === 'no:' + f.id ? 'Rejecting…' : 'Reject'}</button>
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
