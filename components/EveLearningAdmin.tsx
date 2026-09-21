'use client'
// LEARNING — Settings → Eve → Learning (Jon, 2026-09-18: "Need her to learn everything about Stay
// Hospitality"). Every source she learns from, in one table: alive or not, when it last taught
// her anything, how much of it there is. Google read access as a consent step. "Study now" runs
// the existing learning pass and shows the receipt. "Teach her" is a textarea straight into her
// memory at weight 8, source 'jon' — the fastest way to load a house rule.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, X, AlertTriangle, Loader2, Zap, GraduationCap, ExternalLink, RefreshCw, FlaskConical, Trash2, Repeat, ChevronDown, ChevronRight } from 'lucide-react'

type Source = { key: string; label: string; status: 'ok' | 'stale' | 'missing' | 'consent'; lastLearned: string | null; count: number | null; note: string }
type Probe = { id: string; kind: string; question: string; expected: string; source_memory_id: string | null; due_at: string; last_asked_at: string | null; last_answer: string | null; last_pass: boolean | null; last_why: string | null; pass_count: number; fail_count: number; active: boolean; memory: string | null }
type Run = { id: string; at: string; kind: string; probes: number; passed: number; failed: number; memory_hit_rate: number | null; recurrence_rate: number | null; grading_hit_rate: number | null; score: number | null; detail: any; usage: any }
type Audit = {
  migrated: boolean
  run: Run | null
  sparklines: Record<string, Array<number | null>>
  failedProbes: Probe[]
  neverUsed: Array<{ id: string; text: string; kind: string; scope: string; weight: number; source: string; use_count: number }>
  recurringShapes: Array<{ shape: string; reasons: string[]; declinedAt: string; recurrences: number; lastAt: string; skipped: number }>
  declinedShapes: Array<{ shape: string; reasons: string[]; lastAt: string }>
  probes: Probe[]
  counts: { probes: number; active: number; due: number; nextDue: string | null }
}
type Data = {
  sources: Source[]
  google: { granted: boolean; email: string | null; at: string | null; scopes: string[] }
  lastStudy: { at: string; ok: boolean; itemCount: number | null } | null
  lastReview: { at: string; ok: boolean } | null
  memory: { total: number; bySource: Record<string, number>; byWeight: Record<string, number> }
  audit: Audit | null
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
const KIND_LABEL: Record<string, string> = { taught: 'taught', answered: 'answered', declined: 'declined', rule: 'rule' }
const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)}%`)
const untilDue = (iso: string) => { const h = (Date.parse(iso) - Date.now()) / 3600_000; return h <= 0 ? 'due now' : h < 48 ? `in ${Math.round(h)}h` : `in ${Math.round(h / 24)}d` }

/**
 * Four weekly points, oldest left. One series, so no legend: the tile's label names it. Thin
 * 2px line, 8px markers, gaps where a week had no run; the numbers stay in text tokens.
 */
function Sparkline({ values, invert }: { values: Array<number | null>; invert?: boolean }) {
  const w = 96, h = 28, pad = 5
  const pts = values.map((v, i) => (v == null ? null : { x: pad + (i * (w - 2 * pad)) / Math.max(1, values.length - 1), y: pad + ((100 - v) / 100) * (h - 2 * pad), v }))
  const runs: string[] = []
  let cur: string[] = []
  for (const p of pts) { if (!p) { if (cur.length) runs.push(cur.join(' ')); cur = []; continue } cur.push(`${p.x},${p.y}`) }
  if (cur.length) runs.push(cur.join(' '))
  const any = pts.some(Boolean)
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" role="img" aria-label={any ? `four weeks: ${values.map(v => (v == null ? 'no run' : Math.round(v))).join(', ')}` : 'no runs yet'}>
      <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} stroke="currentColor" className="text-line" strokeWidth={1} />
      {runs.map((d, i) => <polyline key={i} points={d} fill="none" stroke="currentColor" className={invert ? 'text-[#9A6200]' : 'text-brand-600'} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
      {pts.map((p, i) => p && <circle key={i} cx={p.x} cy={p.y} r={4} fill="white" stroke="currentColor" className={invert ? 'text-[#9A6200]' : 'text-brand-600'} strokeWidth={2}><title>{`week ${i + 1}: ${Math.round(p.v)}%`}</title></circle>)}
    </svg>
  )
}

export function EveLearningAdmin({ canEdit }: { canEdit: boolean }) {
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [studying, setStudying] = useState(false)
  const [receipt, setReceipt] = useState<any>(null)
  const [teach, setTeach] = useState('')
  const [teaching, setTeaching] = useState(false)
  const [note, setNote] = useState('')
  const [testing, setTesting] = useState(false)
  const [showProbes, setShowProbes] = useState(false)
  const [busyId, setBusyId] = useState('')
  const teachRef = useRef<HTMLTextAreaElement | null>(null)

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

  async function selfTest() {
    if (testing) return
    setTesting(true); setNote('')
    try {
      const r = await fetch('/api/eve/learning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'selftest', limit: 15 }) }).then(x => x.json())
      if (!r?.ok) setNote(r?.error || 'The self-test did not run.')
      else setNote(`Self-test done: ${r.run?.probes ?? 0} probes, ${r.run?.passed ?? 0} passed, ${r.run?.failed ?? 0} failed · score ${r.run?.score ?? '—'} · ~$${Number(r.run?.usage?.usd || 0).toFixed(3)}`)
      await load()
    } catch (e: any) { setNote(e?.message || String(e)) } finally { setTesting(false) }
  }
  async function op(body: any, id: string) {
    if (busyId) return
    setBusyId(id); setNote('')
    try {
      const r = await fetch('/api/eve/learning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(x => x.json())
      if (!r?.ok) setNote(r?.error || 'That did not work.')
      await load()
    } catch (e: any) { setNote(e?.message || String(e)) } finally { setBusyId('') }
  }
  function reteach(p: Probe) {
    const base = p.memory || p.expected
    setTeach(base.replace(/^Jon declined /, 'Never propose ').trim())
    setTimeout(() => { teachRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); teachRef.current?.focus() }, 50)
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

      {/* IS SHE LEARNING? — the instrument, not the counter */}
      {(() => {
        const a = d.audit
        const run = a?.run || null
        const sp = a?.sparklines || {}
        const det = run?.detail || {}
        const tiles: Array<{ key: string; label: string; value: number | null; sub: string; invert?: boolean }> = [
          { key: 'retention', label: 'Retention · 40%', value: det.retention?.rate ?? null, sub: det.retention ? `${det.retention.passed}/${det.retention.asked} probes passed, 7d${det.retention.taughtFailed ? ` · ${det.retention.taughtFailed} taught fact${det.retention.taughtFailed === 1 ? '' : 's'} forgotten` : ''}` : 'no probes asked yet' },
          { key: 'memory_hit_rate', label: 'Memory hit rate · 20%', value: run?.memory_hit_rate ?? null, sub: det.memoryHits ? `${det.memoryHits.used} of ${det.memoryHits.injected} injected memories shaped an answer, ${det.memoryHits.chats} chats` : 'no chat telemetry yet' },
          { key: 'recurrence_rate', label: 'Correction recurrence · 20%', value: run?.recurrence_rate ?? null, sub: det.recurrence ? `${det.recurrence.recurring} of ${det.recurrence.thoughts} thoughts, 7d, were a shape Jon declined` : 'no thoughts in the window', invert: true },
          { key: 'grading_hit_rate', label: 'Recommendation hit rate · 20%', value: run?.grading_hit_rate ?? null, sub: det.grading ? `${det.grading.worked}/${det.grading.graded} graded worked · last 4w ${fmtPct(det.grading.recent4w)} vs prior ${fmtPct(det.grading.prior4w)}` : 'nothing graded yet' },
        ]
        const honesty = det.retention?.honesty
        return (
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 border-b border-line flex flex-wrap items-center gap-2">
              <div className="text-[13px] font-bold text-ink inline-flex items-center gap-1.5"><FlaskConical size={14} /> Is she learning?</div>
              <div className="text-[11px] text-muted">
                {run ? `Last self-test ${ago(run.at)} (${run.kind}) · ${run.probes} probes, ${run.passed} passed, ${run.failed} failed · ~$${Number(run.usage?.usd || 0).toFixed(3)}` : a?.migrated === false ? 'Run migration 103 to switch the audit on.' : 'No self-test yet — nightly after the learning pass, Mondays with the review.'}
                {a?.counts ? ` · ${a.counts.active} active probes, ${a.counts.due} due${a.counts.nextDue ? `, next ${untilDue(a.counts.nextDue)}` : ''}` : ''}
              </div>
              {canEdit && (
                <button onClick={selfTest} disabled={testing || a?.migrated === false} className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 hover:bg-brand-100 disabled:opacity-50">
                  {testing ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />} {testing ? 'Asking her…' : 'Run self-test now'}
                </button>
              )}
            </div>
            <div className="px-4 py-3 grid gap-3 sm:grid-cols-[auto_1fr] items-start">
              <div className="min-w-[120px]">
                <div className="text-[11px] text-muted">Learning score</div>
                <div className="text-4xl font-bold text-ink leading-none mt-1">{run?.score ?? '—'}<span className="text-base text-muted font-normal">/100</span></div>
                <div className="mt-2"><Sparkline values={sp.score || [null, null, null, null]} /></div>
                <div className="text-[10px] text-muted">4 weeks</div>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                {tiles.map(t => (
                  <div key={t.key} className="border border-line rounded-xl px-3 py-2 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-muted">{t.label}</div>
                      <div className="text-lg font-bold text-ink leading-tight">{fmtPct(t.value)}</div>
                      <div className="text-[10px] text-muted truncate" title={t.sub}>{t.sub}</div>
                    </div>
                    <Sparkline values={sp[t.key] || [null, null, null, null]} invert={t.invert} />
                  </div>
                ))}
              </div>
            </div>
            {honesty && (
              <div className="px-4 pb-2 text-[11px] text-muted">Honesty check: asked {honesty.asked} unanswerable question{honesty.asked === 1 ? '' : 's'} with no tools — she said she did not know on {honesty.passed}.{honesty.asked > 0 && honesty.passed < honesty.asked ? ' She made something up on the rest.' : ''}</div>
            )}

            {/* FAILED PROBES */}
            <div className="border-t border-line">
              <div className="px-4 py-2 text-[12px] font-bold text-ink">Failed probes <span className="font-normal text-muted">· what she was told and did not retain</span></div>
              {!a?.failedProbes?.length && <div className="px-4 pb-3 text-[12px] text-muted">{run ? 'Nothing failing right now.' : '—'}</div>}
              {(a?.failedProbes || []).map(p => (
                <div key={p.id} className="px-4 py-2.5 border-t border-line text-[12px]">
                  <div className="flex items-start gap-2">
                    <span className={`shrink-0 text-[10px] font-semibold rounded px-1.5 py-0.5 ${p.kind === 'taught' ? 'bg-[#FDECEC] text-[#B42318]' : 'bg-app text-muted'}`}>{KIND_LABEL[p.kind] || p.kind}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-ink font-semibold">{p.question}</div>
                      <div className="text-muted mt-0.5"><span className="text-ink">Expected:</span> {p.expected}</div>
                      <div className="text-muted mt-0.5"><span className="text-ink">She said:</span> {p.last_answer || '—'}</div>
                      <div className="text-[11px] text-[#B42318] mt-0.5">Why it failed: {p.last_why || '—'} · asked {ago(p.last_asked_at)} · {p.pass_count} pass / {p.fail_count} fail</div>
                    </div>
                    {canEdit && (
                      <button onClick={() => reteach(p)} className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-2 py-1 hover:bg-brand-100"><GraduationCap size={11} /> Re-teach</button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* NEVER-USED MEMORIES + RECURRING SHAPES */}
            <div className="border-t border-line grid md:grid-cols-2">
              <div className="md:border-r border-line">
                <div className="px-4 py-2 text-[12px] font-bold text-ink">Never-used memories <span className="font-normal text-muted">· loaded 5+ times, never shaped an answer</span></div>
                {!a?.neverUsed?.length && <div className="px-4 pb-3 text-[12px] text-muted">None — or no telemetry yet.</div>}
                {(a?.neverUsed || []).map(m => (
                  <div key={m.id} className="px-4 py-2 border-t border-line text-[12px] flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-ink">{m.text}</div>
                      <div className="text-[11px] text-muted">{m.kind} · {m.scope} · w{m.weight} · {SOURCE_LABEL[m.source] || m.source} · loaded {m.use_count}×</div>
                    </div>
                    {canEdit && (
                      <button onClick={() => op({ op: 'prune', memoryId: m.id }, m.id)} disabled={busyId === m.id} title="Retire it — superseded by a note saying who pruned it and why" className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-muted hover:text-[#B42318] border border-line rounded-lg px-2 py-1 disabled:opacity-50">
                        {busyId === m.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Prune
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div>
                <div className="px-4 py-2 text-[12px] font-bold text-ink">Declined shapes still recurring <span className="font-normal text-muted">· 7 days</span></div>
                {!a?.recurringShapes?.length && <div className="px-4 pb-3 text-[12px] text-muted">{a?.declinedShapes?.length ? `None recurring. ${a.declinedShapes.length} shape${a.declinedShapes.length === 1 ? '' : 's'} declined so far — the watches skip them.` : 'Nothing declined with a reason yet — dismiss a thought with one and it counts from then on.'}</div>}
                {(a?.recurringShapes || []).map(sh => (
                  <div key={sh.shape} className="px-4 py-2 border-t border-line text-[12px]">
                    <div className="flex items-center gap-2"><Repeat size={12} className="text-[#9A6200] shrink-0" /><span className="font-mono text-ink truncate">{sh.shape}</span><span className="ml-auto shrink-0 text-muted">{sh.recurrences}× · last {ago(sh.lastAt)}{sh.skipped ? ` · ${sh.skipped} skipped` : ''}</span></div>
                    <div className="text-[11px] text-muted mt-0.5">Jon said: {sh.reasons[0]}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* PROBE LIST */}
            <div className="border-t border-line">
              <button onClick={() => setShowProbes(v => !v)} className="w-full px-4 py-2 text-[12px] font-bold text-ink inline-flex items-center gap-1.5 hover:bg-app/60">
                {showProbes ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Probes <span className="font-normal text-muted">· {a?.counts?.probes ?? 0} total, {a?.counts?.active ?? 0} active</span>
              </button>
              {showProbes && (a?.probes || []).map(p => (
                <div key={p.id} className={`px-4 py-2 border-t border-line text-[12px] flex items-start gap-2 ${p.active ? '' : 'opacity-60'}`}>
                  <span className="shrink-0 w-4 flex justify-center mt-0.5">{p.last_pass === true ? <Check size={13} className="text-[#0F7B52]" /> : p.last_pass === false ? <X size={13} className="text-[#B42318]" /> : <span className="text-muted">·</span>}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-ink">{p.question}</div>
                    <div className="text-[11px] text-muted truncate">{KIND_LABEL[p.kind] || p.kind} · expected: {p.expected} · {p.pass_count} pass / {p.fail_count} fail · {p.active ? `next ${untilDue(p.due_at)}` : 'inactive'}</div>
                  </div>
                  {canEdit && (
                    <button onClick={() => op({ op: 'probe_active', id: p.id, active: !p.active }, p.id)} disabled={busyId === p.id} className="shrink-0 text-[11px] font-semibold text-muted hover:text-ink border border-line rounded-lg px-2 py-1 disabled:opacity-50">{p.active ? 'Pause' : 'Activate'}</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })()}

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
          <textarea ref={teachRef} value={teach} onChange={e => setTeach(e.target.value)} rows={3} className={input}
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
