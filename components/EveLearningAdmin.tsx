'use client'
// LEARNING — Settings → Eve → Learning (Jon, 2026-09-18: "Need her to learn everything about Stay
// Hospitality"). Every source she learns from, in one table: alive or not, when it last taught
// her anything, how much of it there is. Google read access as a consent step. "Study now" runs
// the existing learning pass and shows the receipt. "Teach her" is a textarea straight into her
// memory at weight 8, source 'jon' — the fastest way to load a house rule.
import { useCallback, useEffect, useState } from 'react'
import { Check, X, AlertTriangle, Loader2, Zap, GraduationCap, ExternalLink, RefreshCw } from 'lucide-react'

type Source = { key: string; label: string; status: 'ok' | 'stale' | 'missing' | 'consent'; lastLearned: string | null; count: number | null; note: string }
type Data = {
  sources: Source[]
  google: { granted: boolean; email: string | null; at: string | null; scopes: string[] }
  lastStudy: { at: string; ok: boolean; itemCount: number | null } | null
  lastReview: { at: string; ok: boolean } | null
  memory: { total: number; bySource: Record<string, number>; byWeight: Record<string, number> }
}

const card = 'bg-white border border-line rounded-2xl shadow-soft'
const input = 'w-full text-sm text-ink bg-app border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200'

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const h = (Date.now() - Date.parse(iso)) / 3600_000
  if (!Number.isFinite(h)) return iso
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`
  if (h < 48) return `${Math.round(h)}h ago`
  return `${Math.round(h / 24)}d ago`
}
const SOURCE_LABEL: Record<string, string> = { jon: 'Jon', doc: 'documents', slack: 'Slack', telegram: 'Telegram', system: 'nightly sweep', eve: 'Eve herself' }

export function EveLearningAdmin({ canEdit }: { canEdit: boolean }) {
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [studying, setStudying] = useState(false)
  const [receipt, setReceipt] = useState<any>(null)
  const [teach, setTeach] = useState('')
  const [teaching, setTeaching] = useState(false)
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/eve/learning').then(x => x.json())
      if (!r?.ok) { setErr(r?.message || r?.error || 'Could not load.'); return }
      setD(r); setErr('')
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function study() {
    if (studying) return
    setStudying(true); setReceipt(null); setNote('')
    try {
      const r = await fetch('/api/eve/learning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'study' }) }).then(x => x.json())
      if (!r?.ok) setNote(r?.error || 'The study pass did not run.')
      else setReceipt(r.receipt)
      await load()
    } catch (e: any) { setNote(e?.message || String(e)) } finally { setStudying(false) }
  }

  async function teachHer() {
    const text = teach.trim()
    if (text.length < 8 || teaching) return
    setTeaching(true); setNote('')
    try {
      const r = await fetch('/api/eve/learning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'teach', text }) }).then(x => x.json())
      if (!r?.ok) setNote(r?.error || 'Could not save that.')
      else { setNote(r.deduped ? 'She already had that one — reinforced.' : 'Filed as a rule at weight 8, with your name and today\'s date on it.'); setTeach('') }
      await load()
    } catch (e: any) { setNote(e?.message || String(e)) } finally { setTeaching(false) }
  }

  if (loading && !d) return <div className="flex items-center gap-2 text-sm text-muted p-4"><Loader2 size={14} className="animate-spin" /> Checking every source…</div>
  if (!d) return <div className="text-[13px] text-[#B42318] bg-[#FDECEC] border border-[#F5C2C0] rounded-xl px-3.5 py-2.5">{err || 'Could not load.'}</div>

  const icon = (s: Source['status']) => s === 'ok' ? <Check size={14} className="text-[#0F7B52]" /> : s === 'stale' ? <AlertTriangle size={14} className="text-[#9A6200]" /> : s === 'consent' ? <ExternalLink size={14} className="text-brand-600" /> : <X size={14} className="text-[#B42318]" />
  const word = (s: Source['status']) => s === 'ok' ? 'learning' : s === 'stale' ? 'stale' : s === 'consent' ? 'needs consent' : 'not connected'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[12px] text-muted">
          Last study pass: {d.lastStudy ? `${ago(d.lastStudy.at)}${d.lastStudy.ok ? '' : ' (failed)'}` : 'never'} · Last review: {d.lastReview ? ago(d.lastReview.at) : 'never'} · {d.memory.total} memories
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} className="text-xs text-muted hover:text-ink inline-flex items-center gap-1"><RefreshCw size={12} /> Refresh</button>
          {canEdit && (
            <button onClick={study} disabled={studying}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 hover:bg-brand-100 disabled:opacity-50">
              {studying ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />} {studying ? 'Studying…' : 'Study now'}
            </button>
          )}
        </div>
      </div>

      {err && <div className="text-[13px] text-[#B42318] bg-[#FDECEC] border border-[#F5C2C0] rounded-xl px-3.5 py-2.5">{err}</div>}
      {note && <div className="text-[13px] text-ink bg-app border border-line rounded-xl px-3.5 py-2.5">{note}</div>}

      {receipt && (
        <div className={`${card} p-4 text-[12px]`}>
          <div className="text-[13px] font-bold text-ink mb-1">Study receipt · {Math.round((receipt.ms || 0) / 1000)}s</div>
          <div>Sweep: {receipt.sweep?.ok === false ? `failed — ${receipt.sweep.error}` : `${receipt.sweep?.findings ?? 0} findings · ${receipt.sweep?.knowledgeWritten ?? 0} written · ${receipt.sweep?.promotedToMemory ?? 0} promoted to memory`}</div>
          <div>Documents studied: {receipt.studied?.studied ?? 0}{receipt.studied?.error ? ` — ${receipt.studied.error}` : ''}</div>
          <div>Questions raised: {receipt.questions?.asked ?? 0} new, {receipt.questions?.repeated ?? 0} repeated{receipt.questions?.error ? ` — ${receipt.questions.error}` : ''}</div>
        </div>
      )}

      {/* SOURCES */}
      <div className={`${card} overflow-hidden`}>
        <div className="px-4 py-3 border-b border-line text-[13px] font-bold text-ink">Where she learns from</div>
        <div className="divide-y divide-line">
          {d.sources.map(s => (
            <div key={s.key} className="px-4 py-2.5 flex items-center gap-3">
              <div className="w-5 flex justify-center">{icon(s.status)}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-ink">{s.label} <span className="text-[11px] font-normal text-muted">· {word(s.status)}</span></div>
                <div className="text-[11px] text-muted truncate">{s.note}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[12px] text-ink">{s.count == null ? '—' : s.count.toLocaleString()}</div>
                <div className="text-[11px] text-muted">{ago(s.lastLearned)}</div>
              </div>
              {s.key === 'google' && !d.google.granted && canEdit && (
                <a href="/api/google/auth?scopes=read&mailbox=jon@stay-hospitality.com" target="_blank" rel="noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold bg-brand-600 text-white rounded-lg px-2.5 py-1.5 hover:bg-brand-700">
                  Connect <ExternalLink size={11} />
                </a>
              )}
            </div>
          ))}
        </div>
        <div className="px-4 py-2 text-[11px] text-muted border-t border-line">
          Google read access asks for Gmail, Drive and Calendar read-only on top of the existing send/draft grant. It only records consent for now; reading the mailbox into her corpus is the next step.
        </div>
      </div>

      {/* TEACH HER */}
      {canEdit && (
        <div className={`${card} p-4`}>
          <div className="text-[13px] font-bold text-ink mb-1 inline-flex items-center gap-1.5"><GraduationCap size={14} /> Teach her</div>
          <div className="text-[11px] text-muted mb-2">One rule per line is fine. Saved at weight 8, source Jon — it outranks anything she worked out herself.</div>
          <textarea value={teach} onChange={e => setTeach(e.target.value)} rows={3} className={input}
            placeholder="e.g. Botanica is a hotel — we do listings and guest messaging only; their staff does housekeeping and maintenance." />
          <div className="mt-2 flex items-center gap-2">
            <button onClick={teachHer} disabled={teaching || teach.trim().length < 8}
              className="inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-2 hover:bg-brand-700 disabled:opacity-50">
              {teaching ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} File it
            </button>
          </div>
        </div>
      )}

      {/* MEMORY COUNTS */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className={`${card} p-4`}>
          <div className="text-[13px] font-bold text-ink mb-2">Memory by source</div>
          {Object.keys(d.memory.bySource).length === 0 && <div className="text-[12px] text-muted">Nothing yet.</div>}
          {Object.entries(d.memory.bySource).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
            <div key={k} className="flex items-center justify-between text-[12px] py-0.5"><span className="text-ink">{SOURCE_LABEL[k] || k}</span><span className="text-muted">{n}</span></div>
          ))}
        </div>
        <div className={`${card} p-4`}>
          <div className="text-[13px] font-bold text-ink mb-2">Memory by weight</div>
          {Object.entries(d.memory.byWeight).sort((a, b) => Number(b[0]) - Number(a[0])).map(([k, n]) => (
            <div key={k} className="flex items-center gap-2 text-[12px] py-0.5">
              <span className="w-6 text-ink">{k}</span>
              <div className="flex-1 h-2 bg-app rounded-full overflow-hidden"><div className="h-full bg-brand-500" style={{ width: `${Math.min(100, (n / Math.max(1, d.memory.total)) * 100)}%` }} /></div>
              <span className="w-8 text-right text-muted">{n}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
