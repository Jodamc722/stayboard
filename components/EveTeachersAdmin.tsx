'use client'
// WHO TEACHES EVE — Settings → Eve → Learning (Jon, 2026-11-05: "She can learn from any CCS agent,
// she can also learn from Roberto, Karla & Bernadette"). Edits app_settings `eve_teachers`. A
// teacher's "always / never / from now on" and corrections are kept as rules in their name — Jon up
// to weight 10, the named teachers up to 8, the CCS team up to 6. Only Jon can change the list.
import { useEffect, useState } from 'react'
import { GraduationCap, Save } from 'lucide-react'

type Cfg = { emails: string[]; slackIds: string[]; names: string[]; ccs: boolean; ccsRoles?: string[] }
const input = 'w-full text-sm text-ink bg-app border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200'
const lines = (v: string) => v.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)

export function EveTeachersAdmin() {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [weights, setWeights] = useState<{ jon: number; named: number; ccs: number } | null>(null)
  const [draft, setDraft] = useState({ names: '', emails: '', slackIds: '', ccsRoles: '', ccs: true })
  const [note, setNote] = useState('')
  useEffect(() => {
    fetch('/api/eve/teachers').then(r => r.json()).then(d => {
      if (!d?.value) return
      setCfg(d.value); setCanEdit(!!d.canEdit); setWeights(d.weights || null)
      setDraft({ names: d.value.names.join('\n'), emails: d.value.emails.join('\n'), slackIds: d.value.slackIds.join('\n'), ccsRoles: (d.value.ccsRoles || []).join(', '), ccs: !!d.value.ccs })
    }).catch(() => {})
  }, [])
  async function save() {
    setNote('')
    const value = { names: lines(draft.names), emails: lines(draft.emails).map(s => s.toLowerCase()), slackIds: lines(draft.slackIds), ccsRoles: lines(draft.ccsRoles).map(s => s.toLowerCase()), ccs: draft.ccs }
    const r = await fetch('/api/eve/teachers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || d?.error) { setNote(d?.error || `HTTP ${r.status}`); return }
    setCfg(d.value); setNote('Saved.')
  }
  if (!cfg) return null
  return (
    <div className="bg-white border border-line rounded-2xl shadow-soft p-4 mb-4">
      <div className="flex items-center gap-2 mb-1"><GraduationCap size={15} className="text-brand-600" /><span className="text-sm font-semibold text-ink">Who teaches Eve</span></div>
      <p className="text-[12.5px] text-muted mb-3 max-w-2xl">
        A teacher&apos;s instructions and corrections — in the app or in Slack — are kept as rules in their name, with no confirmation step.
        Jon up to weight {weights?.jon ?? 10}; the people named here up to {weights?.named ?? 8}; the CCS team up to {weights?.ccs ?? 6}.
        Anyone else&apos;s &quot;always / never&quot; is a suggestion a teacher confirms.
      </p>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-[12px] text-muted">Names (one per line)
          <textarea rows={4} disabled={!canEdit} value={draft.names} onChange={e => setDraft({ ...draft, names: e.target.value })} className={`${input} mt-1`} />
        </label>
        <label className="text-[12px] text-muted">Emails
          <textarea rows={4} disabled={!canEdit} value={draft.emails} onChange={e => setDraft({ ...draft, emails: e.target.value })} className={`${input} mt-1`} />
        </label>
        <label className="text-[12px] text-muted">Slack user ids
          <textarea rows={4} disabled={!canEdit} value={draft.slackIds} onChange={e => setDraft({ ...draft, slackIds: e.target.value })} className={`${input} mt-1 font-mono text-[12px]`} />
        </label>
      </div>
      <div className="flex items-center gap-3 flex-wrap mt-3">
        <label className="inline-flex items-center gap-2 text-[12.5px] text-ink">
          <input type="checkbox" disabled={!canEdit} checked={draft.ccs} onChange={e => setDraft({ ...draft, ccs: e.target.checked })} />
          Everyone on the CCS team teaches too
        </label>
        <label className="text-[12px] text-muted inline-flex items-center gap-1.5">CCS access roles
          <input disabled={!canEdit || !draft.ccs} value={draft.ccsRoles} onChange={e => setDraft({ ...draft, ccsRoles: e.target.value })} className="text-[12px] text-ink bg-app border border-line rounded-lg px-2 py-1 w-44" />
        </label>
        {canEdit ? (
          <button onClick={save} className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-2 hover:bg-brand-700"><Save size={13} /> Save teachers</button>
        ) : <span className="ml-auto text-[11.5px] text-muted">Only Jon can change this list.</span>}
      </div>
      {note && <p className="text-[12px] text-muted mt-2">{note}</p>}
    </div>
  )
}
