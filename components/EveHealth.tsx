'use client'
// HOW EVE IS DOING (2026-11-10). One calm page: does she answer correctly (the answer check,
// lib/eve/evals.ts), does she still know what she was taught (memory retention — a different thing,
// labelled as such), what people think of her answers, what she costs per desk, how much she is
// used, and — for admins — the queue of questions waiting to become part of the check.
// Summary first, detail below. Every section shows "not available yet" on its own when its data is
// missing; nothing here blocks on anything else. Reads GET /api/eve/evals; writes POST /api/eve/evals.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Check, X, Play, Pencil, ChevronDown, ChevronRight, Plus, Inbox } from 'lucide-react'

type Trend = { at: string; accuracy: number | null; graded?: number }
type DomainRow = { domain: string; label: string; latest: { asked: number; graded: number; passed: number; accuracy: number | null } | null; trend: Array<number | null> }
type Accuracy = {
  latest: { at: string; accuracy: number | null; graded: number; passed: number; asked: number; trigger: string | null; stopped: string | null; usd: number | null }
  previous: { at: string; accuracy: number | null } | null
  trend: Trend[]
  byDomain: DomainRow[]
}
type Retention = { what: string; latest: { at: string; rate: number; asked: number; forgotten: number } | null; trend: Array<{ at: string; rate: number }> }
type Feedback = { days: number; chats: number; rated: number; up: number; down: number; upRate: number | null; ratedShare: number | null; correctedChats: number; correctionsLearned: number | null; short: boolean }
type Usage = { days: number; total: number; perDay: Array<{ day: string; total: number; bySurface: Record<string, number> }>; bySurface: Record<string, number>; short: boolean; note: string }
type Cost = { days: number; eveUsd: number; appUsd: number; short: boolean; byDesk: Array<{ key: string; label: string; usd: number; tasks: string[] }>; restOfApp: Array<{ task: string; usd: number }> }
type QueueItem = {
  id: string; kind: string; source: string; question: string; expected: string; method: boolean; domain: string; domainLabel: string
  sourceChatId: string | null; approvedBy: string | null; createdAt: string; lastAskedAt: string | null; lastPass: boolean | null; lastWhy: string | null
  lastAnswer: string | null; passCount: number; failCount: number
}
type Queue = { candidates: QueueItem[]; approved: QueueItem[]; counts: { candidates: number; approved: number; active: number; rejected: number }; domains: Array<{ key: string; label: string }> }
type Data = {
  ok: boolean; isAdmin: boolean; generatedAt?: string; evalMax?: number; error?: string
  accuracy: Accuracy | null; retention: Retention | null; feedback: Feedback | null; usage: Usage | null; cost: Cost | null; queue: Queue | null
}

const card = 'bg-white border border-line rounded-2xl shadow-soft'
const input = 'w-full text-sm text-ink bg-app border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200'
const btn = 'inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-2 border disabled:opacity-50'
const btnBrand = btn + ' text-brand-700 bg-brand-50 border-brand-200 hover:bg-brand-100'
const btnPlain = btn + ' text-ink bg-white border-line hover:bg-app'

const fmtPct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${Math.round(v)}%`)
const fmtUsd = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v < 10 ? `$${v.toFixed(2)}` : `$${Math.round(v)}`)
function ago(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const h = (Date.now() - Date.parse(iso)) / 3600_000
  if (!Number.isFinite(h)) return String(iso)
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`
  if (h < 48) return `${Math.round(h)}h ago`
  return `${Math.round(h / 24)}d ago`
}
const SURFACE_LABEL: Record<string, string> = { web: 'Web chat', slack: 'Slack', telegram: 'Telegram', api: 'API' }
const surfaceWord = (s: string) => SURFACE_LABEL[s] || s

/** Calm tone for a percentage: green at 80+, amber 60–79, red below — words carry the meaning too. */
function tone(v: number | null | undefined): string {
  if (v == null) return 'text-muted'
  return v >= 80 ? 'text-[#0F7B52]' : v >= 60 ? 'text-[#9A6200]' : 'text-[#B42318]'
}

/** One series, oldest left; gaps where a run had no number. Numbers stay in text next to it. */
function Spark({ values, label }: { values: Array<number | null>; label: string }) {
  const w = 96, h = 28, pad = 4
  const pts = values.map((v, i) => (v == null ? null : { x: pad + (i * (w - 2 * pad)) / Math.max(1, values.length - 1), y: pad + ((100 - Math.max(0, Math.min(100, v))) / 100) * (h - 2 * pad), v }))
  const runs: string[] = []
  let cur: string[] = []
  for (const p of pts) { if (!p) { if (cur.length) runs.push(cur.join(' ')); cur = []; continue } cur.push(`${p.x},${p.y}`) }
  if (cur.length) runs.push(cur.join(' '))
  const any = pts.some(Boolean)
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" role="img" aria-label={any ? `${label}: ${values.map(v => (v == null ? 'none' : Math.round(v))).join(', ')}` : `${label}: no runs yet`}>
      <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} stroke="currentColor" className="text-line" strokeWidth={1} />
      {runs.map((d, i) => <polyline key={i} points={d} fill="none" stroke="currentColor" className="text-brand-600" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
      {pts.map((p, i) => p && <circle key={i} cx={p.x} cy={p.y} r={3} fill="white" stroke="currentColor" className="text-brand-600" strokeWidth={2}><title>{`${Math.round(p.v)}%`}</title></circle>)}
    </svg>
  )
}

function Tile({ label, value, sub, valueClass }: { label: string; value: string; sub: string; valueClass?: string }) {
  return (
    <div className={card + ' p-3.5 min-w-0'}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={'text-2xl font-semibold mt-1 ' + (valueClass || 'text-ink')}>{value}</div>
      <div className="text-[12px] text-muted mt-0.5 leading-snug">{sub}</div>
    </div>
  )
}

function Section({ title, hint, children, right }: { title: string; hint?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className={card + ' p-4'}>
      <div className="flex items-start gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {hint && <p className="text-[12px] text-muted mt-0.5 leading-snug">{hint}</p>}
        </div>
        {right && <div className="ml-auto shrink-0">{right}</div>}
      </div>
      {children}
    </section>
  )
}
const NotYet = ({ what }: { what: string }) => <div className="text-[13px] text-muted">{what}</div>

export function EveHealth() {
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/eve/evals', { cache: 'no-store' }).then(x => x.json())
      if (!r || r.ok === false) { setErr(r?.message || r?.error || 'Could not load.'); return }
      setD(r as Data); setErr('')
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function post(body: Record<string, any>, key: string): Promise<any> {
    if (busy) return null
    setBusy(key); setNote('')
    try {
      const r = await fetch('/api/eve/evals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(x => x.json())
      if (!r || r.ok === false) setNote(r?.error || r?.message || 'That did not work.')
      await load()
      return r
    } catch (e: any) { setNote(e?.message || String(e)); return null } finally { setBusy('') }
  }

  async function runNow() {
    const r = await post({ action: 'run-now' }, 'run')
    if (!r) return
    if (r.skipped) setNote(r.skipped)
    else if (r.run) setNote(`Answer check done: ${r.run.passed} of ${r.run.graded} correct (${fmtPct(r.run.accuracy)})${r.run.asked > r.run.graded ? ` · ${r.run.asked - r.run.graded} not graded` : ''}${r.stopped ? ` · stopped early: ${r.stopped}` : ''} · about ${fmtUsd(r.run.usd)}`)
  }

  if (loading && !d) return <div className="flex items-center gap-2 text-sm text-muted p-4"><Loader2 size={14} className="animate-spin" /> Gathering how Eve is doing…</div>
  if (!d) return <div className="text-[13px] text-[#B42318] bg-[#FDECEC] border border-[#F5C2C0] rounded-xl px-3.5 py-2.5">{err || 'Could not load.'}</div>

  const acc = d.accuracy, ret = d.retention, fb = d.feedback, use = d.usage, cost = d.cost, q = d.queue
  const lastAcc: number | null = acc ? acc.latest.accuracy : null
  const prevAcc: number | null = acc && acc.previous ? acc.previous.accuracy : null
  const delta = lastAcc != null && prevAcc != null ? Math.round(lastAcc - prevAcc) : null

  // One plain sentence before any number.
  const headline = acc && acc.latest.graded
    ? `On the last answer check (${ago(acc.latest.at)}), Eve got ${acc.latest.passed} of ${acc.latest.graded} questions right${delta != null ? delta === 0 ? ', the same as the time before' : delta > 0 ? `, up ${delta} points on the time before` : `, down ${Math.abs(delta)} points on the time before` : ''}.`
    : q && q.counts.approved === 0
      ? 'No answer check has run yet — approve a few questions in the review queue below and it starts on the next weekly run.'
      : 'No answer check has run yet.'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] text-ink leading-snug flex-1 min-w-[200px]">{headline}</p>
        <div className="flex items-center gap-2">
          <button onClick={load} className="text-xs text-muted hover:text-ink inline-flex items-center gap-1"><RefreshCw size={12} /> Refresh</button>
          {d.isAdmin && (
            <button onClick={runNow} disabled={!!busy} className={btnBrand} title={`Ask up to ${d.evalMax || 20} approved questions now, with read-only tools`}>
              {busy === 'run' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} {busy === 'run' ? 'Checking… (a few minutes)' : 'Run the check now'}
            </button>
          )}
        </div>
      </div>
      {note && <div className="text-[13px] text-ink bg-app border border-line rounded-xl px-3.5 py-2.5">{note}</div>}
      {d.error && <div className="text-[12px] text-muted">Some numbers could not be read: {d.error}</div>}

      {/* ── Summary ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Answers right" value={fmtPct(acc?.latest.accuracy)} valueClass={tone(acc?.latest.accuracy)}
          sub={acc ? `${acc.latest.passed} of ${acc.latest.graded} on the last check` : 'no check yet'} />
        <Tile label="Memory kept" value={fmtPct(ret?.latest?.rate)} valueClass={tone(ret?.latest?.rate)}
          sub={ret?.latest ? `taught facts recalled with no tools · ${ret.latest.asked} asked this week` : 'no memory test yet'} />
        <Tile label="Thumbs up" value={fmtPct(fb?.upRate)} valueClass={tone(fb?.upRate)}
          sub={fb ? `${fb.up} up · ${fb.down} down · last 30 days` : 'no ratings read'} />
        <Tile label="Cost, 7 days" value={fmtUsd(cost?.eveUsd)}
          sub={cost ? `Eve's desks · ${fmtUsd(cost.appUsd)} for all of Lighthouse` : 'no spend read'} />
      </div>

      {/* ── Answer accuracy by domain ── */}
      <Section title="Answers right, by subject" hint="Real questions asked with her read-only lookups on, each judged against an answer a person approved — or, for the seeded questions, against the method a right answer follows (the right records, the window, the as-of date, the caveats). Weekly, and when an admin runs it.">
        {!acc ? <NotYet what="Not available yet — the first answer check has not run." /> : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-[12px] text-muted">
              <Spark values={acc.trend.map(t => t.accuracy)} label="answers right, each run" />
              <span>Each run, oldest left. Last: {new Date(acc.latest.at).toLocaleDateString()} ({acc.latest.trigger === 'manual' ? 'run by hand' : 'weekly'}){acc.latest.asked > acc.latest.graded ? ` · ${acc.latest.asked - acc.latest.graded} not graded` : ''}{acc.latest.stopped ? ` · stopped early: ${acc.latest.stopped}` : ''}</span>
            </div>
            <ul className="divide-y divide-line">
              {acc.byDomain.map(r => (
                <li key={r.domain} className="py-2 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-ink">{r.label}</div>
                    <div className="h-1.5 bg-app rounded-full mt-1 overflow-hidden" aria-hidden>
                      <div className="h-full bg-brand-600 rounded-full" style={{ width: `${Math.max(0, Math.min(100, r.latest?.accuracy ?? 0))}%` }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0 w-24">
                    <div className={'text-[13px] font-semibold ' + tone(r.latest?.accuracy)}>{fmtPct(r.latest?.accuracy)}</div>
                    <div className="text-[11px] text-muted">{r.latest ? `${r.latest.passed} of ${r.latest.graded}` : 'not in last run'}</div>
                  </div>
                  <div className="hidden sm:block"><Spark values={r.trend} label={`${r.label} over time`} /></div>
                </li>
              ))}
            </ul>
            {acc.byDomain.some(r => (r.latest?.graded ?? 0) < 3) && <p className="text-[11px] text-muted">A subject with fewer than three graded questions is a hint, not a verdict.</p>}
          </div>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Memory retention ── */}
        <Section title="Memory kept" hint={ret?.what || 'Taught facts she still knows with every tool removed — memory, not answer correctness.'}>
          {!ret?.latest ? <NotYet what="Not available yet — no memory test has run." /> : (
            <div className="flex items-center gap-3">
              <Spark values={ret.trend.map(t => t.rate)} label="memory kept, each run" />
              <div className="text-[13px] text-ink">
                <span className={'font-semibold ' + tone(ret.latest.rate)}>{fmtPct(ret.latest.rate)}</span> of {ret.latest.asked} taught facts recalled this week
                {ret.latest.forgotten > 0 && <span className="text-muted"> · {ret.latest.forgotten} forgotten</span>}
              </div>
            </div>
          )}
        </Section>

        {/* ── Thumbs and corrections ── */}
        <Section title="What people thought" hint="Thumbs on her answers and written corrections, last 30 days.">
          {!fb ? <NotYet what="Not available yet." /> : (
            <div className="space-y-2 text-[13px] text-ink">
              <div className="flex h-2 rounded-full overflow-hidden bg-app" aria-hidden>
                {fb.rated > 0 && <div className="bg-[#0F7B52]" style={{ width: `${(fb.up / fb.rated) * 100}%` }} />}
                {fb.rated > 0 && <div className="bg-[#B42318]/70" style={{ width: `${(fb.down / fb.rated) * 100}%` }} />}
              </div>
              <div>{fb.up} thumbs up, {fb.down} thumbs down — {fb.rated} of {fb.chats} answers rated ({fmtPct(fb.ratedShare)}).</div>
              <div className="text-muted">{fb.correctedChats} answer{fb.correctedChats === 1 ? '' : 's'} corrected in writing{fb.correctionsLearned != null ? ` · ${fb.correctionsLearned} correction${fb.correctionsLearned === 1 ? '' : 's'} kept as lessons` : ''}.</div>
              {fb.short && <div className="text-[11px] text-muted">Partial read — the numbers may be short.</div>}
            </div>
          )}
        </Section>

        {/* ── Cost by desk ── */}
        <Section title="What she costs, by desk" hint="AI spend over the last 7 days, by the desk that spent it.">
          {!cost ? <NotYet what="Not available yet." /> : (
            <div className="space-y-2">
              {cost.byDesk.map(r => {
                const max = Math.max(0.01, ...cost.byDesk.map(x => x.usd))
                return (
                  <div key={r.key} className="flex items-center gap-2 text-[13px]">
                    <div className="w-24 shrink-0 text-ink truncate">{r.label}</div>
                    <div className="flex-1 h-2 bg-app rounded-full overflow-hidden" aria-hidden><div className="h-full bg-brand-600/80 rounded-full" style={{ width: `${(r.usd / max) * 100}%` }} /></div>
                    <div className="w-14 shrink-0 text-right text-ink tabular-nums">{fmtUsd(r.usd)}</div>
                  </div>
                )
              })}
              <div className="text-[12px] text-muted pt-1">Eve {fmtUsd(cost.eveUsd)} of {fmtUsd(cost.appUsd)} across Lighthouse.{cost.restOfApp.length ? ` Biggest outside Eve: ${cost.restOfApp.slice(0, 3).map(r => `${r.task} ${fmtUsd(r.usd)}`).join(', ')}.` : ''}</div>
              {cost.short && <div className="text-[11px] text-muted">Partial read — the totals may be short.</div>}
            </div>
          )}
        </Section>

        {/* ── Usage ── */}
        <Section title="How much she is asked" hint={use?.note || 'Questions per day, last 30 days.'}>
          {!use ? <NotYet what="Not available yet." /> : <UsageChart u={use} />}
        </Section>
      </div>

      {/* ── Review queue ── */}
      {d.isAdmin ? <ReviewQueue q={q} busy={busy} post={post} /> : q && (
        <Section title="Questions in the check" hint="Admins approve which questions are part of the answer check. You can suggest one.">
          <AddQuestion domains={q.domains} busy={busy} post={post} isAdmin={false} />
        </Section>
      )}
    </div>
  )
}

function UsageChart({ u }: { u: Usage }) {
  const max = Math.max(1, ...u.perDay.map(x => x.total))
  const surfaces = Object.keys(u.bySurface).sort((a, b) => u.bySurface[b] - u.bySurface[a])
  const avg = u.perDay.length ? u.total / u.perDay.length : 0
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-[2px] h-16" role="img" aria-label={`questions per day, last ${u.days} days: ${u.perDay.map(x => x.total).join(', ')}`}>
        {u.perDay.map(x => (
          <div key={x.day} className="flex-1 bg-brand-600/70 rounded-t-sm min-h-[1px]" style={{ height: `${(x.total / max) * 100}%` }} title={`${x.day}: ${x.total}`} />
        ))}
      </div>
      <div className="text-[13px] text-ink">{u.total} questions in {u.days} days · about {avg < 10 ? avg.toFixed(1) : Math.round(avg)} a day</div>
      <div className="flex flex-wrap gap-1.5">
        {surfaces.map(s => <span key={s} className="text-[11px] text-ink bg-app border border-line rounded-full px-2 py-0.5">{surfaceWord(s)} {u.bySurface[s]}</span>)}
      </div>
      {u.short && <div className="text-[11px] text-muted">Partial read — the counts may be short.</div>}
    </div>
  )
}

function ReviewQueue({ q, busy, post }: { q: Queue | null; busy: string; post: (b: Record<string, any>, k: string) => Promise<any> }) {
  const [showApproved, setShowApproved] = useState(false)
  if (!q) return <Section title="Review queue"><NotYet what="Not available yet — the eval columns may not be in the database (migration 177)." /></Section>
  return (
    <Section title="Review queue" hint="Questions waiting to become part of the answer check. Nothing is asked until a person approves it. From a thumbs-up chat her answer is the expected one; from a corrected chat the correction is; a seed question is graded on method. Edit the expected answer before approving if it would be wrong next week."
      right={<button onClick={() => post({ action: 'harvest' }, 'harvest')} disabled={!!busy} className={btnPlain} title="Pull new thumbs-up and corrected chats in now">{busy === 'harvest' ? <Loader2 size={13} className="animate-spin" /> : <Inbox size={13} />} Pull in chats</button>}>
      <div className="text-[12px] text-muted mb-2">{q.counts.candidates} waiting · {q.counts.approved} approved ({q.counts.active} active) · {q.counts.rejected} rejected</div>
      {q.candidates.length === 0 ? <NotYet what="Nothing waiting. New thumbs-up and corrected chats come in every night." /> : (
        <ul className="space-y-2">
          {q.candidates.map(item => <QueueRow key={item.id} item={item} domains={q.domains} busy={busy} post={post} mode="candidate" />)}
        </ul>
      )}
      <div className="mt-4">
        <button onClick={() => setShowApproved(v => !v)} className="text-[13px] font-semibold text-ink inline-flex items-center gap-1">
          {showApproved ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Approved questions ({q.counts.approved})
        </button>
        {showApproved && (
          <ul className="space-y-2 mt-2">
            {q.approved.map(item => <QueueRow key={item.id} item={item} domains={q.domains} busy={busy} post={post} mode="approved" />)}
          </ul>
        )}
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <AddQuestion domains={q.domains} busy={busy} post={post} isAdmin />
      </div>
    </Section>
  )
}

function QueueRow({ item, domains, busy, post, mode }: { item: QueueItem; domains: Array<{ key: string; label: string }>; busy: string; post: (b: Record<string, any>, k: string) => Promise<any>; mode: 'candidate' | 'approved' }) {
  const [editing, setEditing] = useState(false)
  const [expected, setExpected] = useState(item.expected)
  const [domain, setDomain] = useState(item.domain)
  const [open, setOpen] = useState(false)
  const changed = expected.trim() !== item.expected.trim() || domain !== item.domain
  const approve = () => post({ action: 'approve', id: item.id, ...(changed ? { expected, domain } : {}) }, 'a:' + item.id).then(() => setEditing(false))
  const reject = () => post({ action: 'reject', id: item.id }, 'r:' + item.id)
  const result = item.lastPass == null ? null : item.lastPass
  return (
    <li className="border border-line rounded-xl p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted mb-1">
        <span className="bg-app border border-line rounded-full px-2 py-0.5">{item.domainLabel}</span>
        <span>{item.source}</span>
        <span>· {ago(item.createdAt)}</span>
        {mode === 'approved' && (
          <span className={result == null ? '' : result ? 'text-[#0F7B52]' : 'text-[#B42318]'}>
            · {item.lastAskedAt ? `last asked ${ago(item.lastAskedAt)}: ${result == null ? 'not graded' : result ? 'right' : 'wrong'}` : 'not asked yet'}{item.passCount + item.failCount > 0 ? ` (${item.passCount} of ${item.passCount + item.failCount} right overall)` : ''}
          </span>
        )}
      </div>
      <div className="text-[13px] font-medium text-ink">{item.question}</div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea className={input + ' min-h-[90px]'} value={expected} onChange={e => setExpected(e.target.value)} aria-label="Expected answer" />
          <div className="text-[11px] text-muted">Write what a right answer must say. Start with “METHOD: ” to grade how she answers instead (Use: … Must: … Never: …).</div>
          <select className={input + ' sm:w-56'} value={domain} onChange={e => setDomain(e.target.value)} aria-label="Subject">
            {domains.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </div>
      ) : (
        <div className="mt-1 text-[12px] text-muted leading-snug whitespace-pre-wrap">
          <span className="font-semibold text-ink">{item.method ? 'Graded on method: ' : 'Expected: '}</span>
          {(item.method ? item.expected.replace(/^METHOD:\s*/, '') : item.expected).slice(0, open ? 2000 : 280)}
          {item.expected.length > 280 && <button onClick={() => setOpen(v => !v)} className="ml-1 text-brand-700">{open ? 'less' : 'more'}</button>}
        </div>
      )}
      {mode === 'approved' && item.lastWhy && !editing && <div className="mt-1 text-[12px] text-muted">Judge: {item.lastWhy}</div>}
      {mode === 'approved' && item.lastAnswer && !editing && open && <div className="mt-1 text-[12px] text-muted whitespace-pre-wrap"><span className="font-semibold text-ink">Her last answer: </span>{item.lastAnswer}</div>}
      <div className="mt-2 flex flex-wrap gap-2">
        {mode === 'candidate' && !editing && <button onClick={approve} disabled={!!busy} className={btnBrand}>{busy === 'a:' + item.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Approve</button>}
        {editing
          ? <>
              <button onClick={approve} disabled={!!busy || !expected.trim()} className={btnBrand}>{busy === 'a:' + item.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {mode === 'candidate' ? 'Save and approve' : 'Save'}</button>
              <button onClick={() => { setEditing(false); setExpected(item.expected); setDomain(item.domain) }} className={btnPlain}>Cancel</button>
            </>
          : <button onClick={() => setEditing(true)} disabled={!!busy} className={btnPlain}><Pencil size={13} /> Edit expected</button>}
        {!editing && <button onClick={reject} disabled={!!busy} className={btnPlain}>{busy === 'r:' + item.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} {mode === 'candidate' ? 'Reject' : 'Retire'}</button>}
      </div>
    </li>
  )
}

function AddQuestion({ domains, busy, post, isAdmin }: { domains: Array<{ key: string; label: string }>; busy: string; post: (b: Record<string, any>, k: string) => Promise<any>; isAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [expected, setExpected] = useState('')
  const [domain, setDomain] = useState('')
  const ready = useMemo(() => question.trim().length >= 8 && expected.trim().length >= 4, [question, expected])
  async function add() {
    if (!ready) return
    const r = await post({ action: 'add', question, expected, ...(domain ? { domain } : {}) }, 'add')
    if (r && r.ok) { setQuestion(''); setExpected(''); setDomain(''); setOpen(false) }
  }
  if (!open) return <button onClick={() => setOpen(true)} className={btnPlain}><Plus size={13} /> {isAdmin ? 'Add a question' : 'Suggest a question'}</button>
  return (
    <div className="space-y-2">
      <input className={input} placeholder="The question, the way somebody would ask it" value={question} onChange={e => setQuestion(e.target.value)} aria-label="Question" />
      <textarea className={input + ' min-h-[80px]'} placeholder="What a right answer must say — or start with METHOD: to grade how she answers" value={expected} onChange={e => setExpected(e.target.value)} aria-label="Expected answer" />
      <select className={input + ' sm:w-56'} value={domain} onChange={e => setDomain(e.target.value)} aria-label="Subject">
        <option value="">Subject: work it out</option>
        {domains.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
      </select>
      <div className="flex gap-2">
        <button onClick={add} disabled={!ready || !!busy} className={btnBrand}>{busy === 'add' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {isAdmin ? 'Add and approve' : 'Suggest'}</button>
        <button onClick={() => setOpen(false)} className={btnPlain}>Cancel</button>
      </div>
    </div>
  )
}

export default EveHealth
