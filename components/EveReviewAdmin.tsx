'use client'
// THE OPERATOR'S REVIEW — the Review tab under Settings → Eve (Jon, 2026-09-18: "We need Eve to get
// smarter so she can help us improve app, operations, create plans, improve checklists, improve our
// webapp, understanding of KPIs").
//
// One review at a time, newest first: the headline, what moved and why, the plans (Accept / Reject
// straight into the recommendation ledger, so an accepted plan is graded on the same terms as any
// other), critiques, and the questions — answered inline through the same path as /command, so an
// answer becomes a memory with a name on it. "Run review now" takes an optional focus.
import { useCallback, useEffect, useState } from 'react'
import { Check, X, Loader2, RefreshCw, Send, ChevronDown, ChevronRight, Sparkles } from 'lucide-react'

type Movement = { metric: string; what: string; why_hypothesis: string; evidence: string[]; confidence: 'high' | 'med' | 'low' }
type Plan = { area: string; title: string; problem: string; evidence: string[]; change: string; expected_effect: string; cost: string; first_step: string; owner_suggestion: string; metric?: string; expect_direction?: string; scope?: string; recommendation_id?: string | null }
type Critique = { target: string; name: string; signal: string; verdict: string; change: string }
type Question = { question: string; why_it_matters: string; what_i_will_assume: string; evidence: string[]; question_id?: string | null }
type Body = { headline: string; movements: Movement[]; plans: Plan[]; critiques: Critique[]; questions: Question[]; no_signal: string[] }
type Review = { id: string; at: string; trigger: string; focus: string | null; model: string | null; headline: string | null; body: Body; pack_stats: any; created_by: string | null }
type OpenPlan = { id: string; title: string; status: string }

const card = 'bg-white border border-line rounded-2xl shadow-soft'
const input = 'w-full text-sm text-ink bg-app border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200'
const CONF: Record<string, string> = { high: 'bg-[#E3F4EC] text-[#0F7B52] border-[#BFE5D2]', med: 'bg-[#FDF3E0] text-[#9A6200] border-[#F0DAA8]', low: 'bg-app text-muted border-line' }
const AREA: Record<string, string> = { operations: 'Operations', checklist: 'Checklist', app: 'The app', guest: 'Guests', money: 'Money', people: 'People' }

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : iso
}

export function EveReviewAdmin({ canEdit }: { canEdit: boolean }) {
  const [reviews, setReviews] = useState<Review[]>([])
  const [openPlans, setOpenPlans] = useState<Record<string, string>>({})   // recommendation id -> status
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [focus, setFocus] = useState('')
  const [running, setRunning] = useState(false)
  const [which, setWhich] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/eve/review?n=8').then(x => x.json())
      setReviews(Array.isArray(r?.reviews) ? r.reviews : [])
      const m: Record<string, string> = {}
      for (const p of (r?.open?.plans || []) as OpenPlan[]) m[p.id] = p.status
      setOpenPlans(m)
      setErr('')
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function run() {
    if (running) return
    setRunning(true); setErr('')
    try {
      const r = await fetch('/api/eve/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ focus }) }).then(x => x.json())
      if (!r?.ok) setErr(r?.error || 'The review did not run.')
      else { setFocus(''); setWhich(0) }
      await load()
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setRunning(false) }
  }

  const rv = reviews[which] || null

  return (
    <div className="space-y-4">
      <div className={`${card} p-4`}>
        <p className="text-sm text-ink font-semibold mb-1 flex items-center gap-1.5"><Sparkles size={14} className="text-brand-600" /> The operator&apos;s review</p>
        <p className="text-[13px] text-muted">Every Monday at 6:30 she reads the week — KPIs against last week, anomalies, what the sweep and the audit found, Slack, guest issues, low reviews, the checklist, who opened what in the app, her own track record — and writes what moved, why, and what to change. Plans you accept get graded. Run one now with a focus if you want her on one thing.</p>
        {canEdit && (
          <div className="mt-3 flex items-center gap-2">
            <input value={focus} onChange={e => setFocus(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run() }} placeholder="Focus (optional) — e.g. labor per clean in Broward, the daily checklist, why glitches take so long" className={input} />
            <button onClick={run} disabled={running} className="inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-2 hover:bg-brand-700 disabled:opacity-50 whitespace-nowrap">
              {running ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {running ? 'Reviewing…' : 'Run review now'}
            </button>
          </div>
        )}
        {running && <p className="text-[12px] text-muted mt-2">Building the evidence pack and reading it — usually one to two minutes.</p>}
        {err && <div className="mt-3 text-[13px] text-[#A32020] bg-[#FDECEC] border border-[#F3C2C2] rounded-xl px-3.5 py-2.5">{err}</div>}
      </div>

      {loading ? <p className="text-sm text-muted">Loading…</p> : !reviews.length ? (
        <p className="text-sm text-muted">No review yet. The first one runs Monday morning, or press the button.</p>
      ) : (
        <>
          {reviews.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {reviews.map((r, i) => (
                <button key={r.id} onClick={() => setWhich(i)} className={`text-[12px] font-semibold px-2.5 py-1 rounded-lg border ${i === which ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-muted border-line hover:text-ink'}`}>
                  {when(r.at)}{r.focus ? ' · ' + r.focus.slice(0, 24) : ''}
                </button>
              ))}
            </div>
          )}
          {rv && <ReviewView rv={rv} canEdit={canEdit} openPlans={openPlans} onChanged={load} />}
        </>
      )}
    </div>
  )
}

function ReviewView({ rv, canEdit, openPlans, onChanged }: { rv: Review; canEdit: boolean; openPlans: Record<string, string>; onChanged: () => void }) {
  const b = rv.body || ({} as Body)
  const [busy, setBusy] = useState('')
  const [decided, setDecided] = useState<Record<string, string>>({})
  const [answered, setAnswered] = useState<Record<string, string>>({})

  async function decide(id: string, status: 'accepted' | 'rejected') {
    setBusy(id)
    try {
      const r = await fetch('/api/eve/recommendations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'decide', id, status }) })
      if (r.ok) setDecided(d => ({ ...d, [id]: status }))
      onChanged()
    } finally { setBusy('') }
  }
  async function answer(id: string, op: 'answer' | 'dismiss', text: string) {
    setBusy(id)
    try {
      const r = await fetch('/api/eve/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, id, answer: text }) })
      if (r.ok) setAnswered(a => ({ ...a, [id]: op === 'answer' ? 'answered' : 'dismissed' }))
      return r.ok
    } finally { setBusy('') }
  }

  const stateOf = (p: Plan): string | null => {
    if (!p.recommendation_id) return null
    return decided[p.recommendation_id] || (openPlans[p.recommendation_id] ? 'open' : null)
  }

  return (
    <div className="space-y-4">
      <div className={`${card} p-4`}>
        <p className="text-[11px] uppercase tracking-[0.08em] text-muted font-bold">{when(rv.at)} · {rv.trigger}{rv.focus ? ' · focus: ' + rv.focus : ''}{rv.model ? ' · ' + rv.model : ''}</p>
        <p className="text-[15px] font-semibold text-ink mt-1.5 leading-snug">{b.headline || rv.headline}</p>
        {rv.pack_stats?.tokens ? <p className="text-[11px] text-muted mt-2">Evidence pack ≈ {Number(rv.pack_stats.tokens).toLocaleString()} tokens{rv.pack_stats?.retired ? ` · retired ${rv.pack_stats.retired} template questions` : ''}</p> : null}
        {rv.pack_stats?.modelAsked && rv.pack_stats?.modelAnswered && rv.pack_stats.modelAsked !== rv.pack_stats.modelAnswered ? (
          <p className="text-[11px] text-amber-700 mt-1">{String(rv.pack_stats.modelAsked)} was unavailable, {String(rv.pack_stats.modelAnswered)} answered.</p>
        ) : null}
        {rv.pack_stats?.truncated ? (
          <p className="text-[11px] text-red-600 font-semibold mt-1">Output was cut off at the token limit — the last plan or question may be incomplete. Run it again.</p>
        ) : null}
      </div>

      {!!(b.movements || []).length && (
        <Section title="What moved, and why">
          {b.movements.map((m, i) => (
            <div key={i} className={`${card} p-4`}>
              <div className="flex items-start gap-2">
                <p className="text-sm font-semibold text-ink flex-1">{m.metric ? m.metric + ' — ' : ''}{m.what}</p>
                <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md border ${CONF[m.confidence] || CONF.low}`}>{m.confidence}</span>
              </div>
              <p className="text-[13px] text-ink/85 mt-1.5">{m.why_hypothesis}</p>
              <Evidence lines={m.evidence} />
            </div>
          ))}
        </Section>
      )}

      {!!(b.plans || []).length && (
        <Section title="Plans, biggest impact first">
          {b.plans.map((p, i) => {
            const st = stateOf(p)
            return (
              <div key={i} className={`${card} p-4`}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-muted font-bold">{i + 1} · {AREA[p.area] || p.area}{p.owner_suggestion ? ' · ' + p.owner_suggestion : ''}</p>
                    <p className="text-sm font-semibold text-ink mt-0.5">{p.title}</p>
                    <Line k="Problem" v={p.problem} />
                    <Line k="Change" v={p.change} />
                    <Line k="Expected" v={p.expected_effect} />
                    <Line k="Cost" v={p.cost} />
                    <Line k="First step" v={p.first_step} strong />
                    <Evidence lines={p.evidence} />
                    {p.metric && <p className="text-[11.5px] text-muted mt-2">Graded on <strong className="text-ink">{p.metric}</strong> going <strong className="text-ink">{p.expect_direction || 'up'}</strong> on {p.scope || 'portfolio'} in 21 days.</p>}
                    {st && st !== 'open' && <span className="inline-block mt-2 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md border bg-app text-muted border-line">{st}</span>}
                  </div>
                  {canEdit && p.recommendation_id && st === 'open' && (
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button disabled={!!busy} onClick={() => decide(p.recommendation_id!, 'accepted')} className="inline-flex items-center gap-1 text-xs font-semibold bg-brand-600 text-white rounded-lg px-2.5 py-1.5 hover:bg-brand-700 disabled:opacity-50"><Check size={12} /> Accept</button>
                      <button disabled={!!busy} onClick={() => decide(p.recommendation_id!, 'rejected')} className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink border border-line rounded-lg px-2.5 py-1.5"><X size={12} /> No</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </Section>
      )}

      {!!(b.critiques || []).length && (
        <Section title="What she would change about how we run">
          {b.critiques.map((c, i) => (
            <div key={i} className={`${card} p-4`}>
              <p className="text-[11px] uppercase tracking-[0.08em] text-muted font-bold">{c.target}</p>
              <p className="text-sm font-semibold text-ink mt-0.5">{c.name}</p>
              <Line k="Signal" v={c.signal} />
              <Line k="Verdict" v={c.verdict} />
              <Line k="Change" v={c.change} strong />
            </div>
          ))}
        </Section>
      )}

      {!!(b.questions || []).length && (
        <Section title="Questions only you can answer">
          {b.questions.map((q, i) => <QuestionCard key={i} q={q} canEdit={canEdit} busy={busy === q.question_id} state={q.question_id ? answered[q.question_id] : undefined} onAnswer={answer} />)}
        </Section>
      )}

      {!!(b.no_signal || []).length && (
        <div className={`${card} p-4`}>
          <p className="text-[11px] uppercase tracking-[0.08em] text-muted font-bold mb-1">No signal</p>
          <p className="text-[13px] text-muted">{b.no_signal.join(' · ')}</p>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.08em] text-muted font-bold mb-2">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}
function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  if (!v) return null
  return <p className={`text-[13px] mt-1.5 ${strong ? 'text-ink' : 'text-ink/85'}`}><span className="text-muted font-semibold">{k}:</span> {v}</p>
}
function Evidence({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false)
  if (!lines?.length) return null
  return (
    <div className="mt-2">
      <button onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted hover:text-ink">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {lines.length} piece{lines.length === 1 ? '' : 's'} of evidence</button>
      {open && <ul className="mt-1 ml-3 space-y-0.5">{lines.map((l, i) => <li key={i} className="text-[12px] text-muted font-mono leading-snug">{l}</li>)}</ul>}
    </div>
  )
}

function QuestionCard({ q, canEdit, busy, state, onAnswer }: { q: Question; canEdit: boolean; busy: boolean; state?: string; onAnswer: (id: string, op: 'answer' | 'dismiss', text: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState('')
  return (
    <div className={`${card} p-4`}>
      <p className="text-sm font-semibold text-ink">{q.question}</p>
      <Line k="Why it matters" v={q.why_it_matters} />
      <Line k="If you say nothing, she assumes" v={q.what_i_will_assume} strong />
      <Evidence lines={q.evidence} />
      {state ? <span className="inline-block mt-2 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md border bg-app text-muted border-line">{state}</span>
        : canEdit && q.question_id ? (
          <div className="mt-2 flex items-center gap-1.5">
            <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) onAnswer(q.question_id!, 'answer', draft.trim()) }} placeholder="Tell her…" className={input} />
            <button disabled={busy || !draft.trim()} onClick={() => onAnswer(q.question_id!, 'answer', draft.trim())} className="inline-flex items-center gap-1 text-xs font-semibold bg-brand-600 text-white rounded-lg px-2.5 py-2 hover:bg-brand-700 disabled:opacity-50">{busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send</button>
            <button disabled={busy} onClick={() => onAnswer(q.question_id!, 'dismiss', '')} className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink border border-line rounded-lg px-2.5 py-2" title="Later"><X size={12} /></button>
          </div>
        ) : null}
    </div>
  )
}
