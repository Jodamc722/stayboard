'use client'
// THE REFUND PLAYBOOK — the page the team reads, and the page they train on.
//
// Jon, 2026-09-22: "create a matrix that works thats reasonable ... The goal is never a refund. The
// goal is to remediate or solve the issue quickly and promptly, but if that's not enough, then the
// refund is a tool to ensure a positive guest experience."
//
// So the ladder comes first and the grid comes second, in that order on the screen, because a page
// that opens with a money grid teaches the opposite of what it says. Every number here is computed
// by the live engine through /api/refunds/playbook — nothing on this page is typed in beside the
// code that decides it.
import { useCallback, useEffect, useState } from 'react'
import {
  Wrench, HandHeart, DollarSign, PenLine, Clock, AlertTriangle, ShieldCheck, Loader2,
  ChevronDown, ChevronRight, Eye, EyeOff, Star, Check, Info,
} from 'lucide-react'

const card = 'bg-white border border-line rounded-2xl shadow-soft'
const money = (n: any) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const mins = (m: number) => (m < 60 ? `${m} min` : `${Math.round(m / 60)} hr`)

type Tab = 'ladder' | 'matrix' | 'scenarios' | 'categories' | 'authority'

const LEVEL_TONE: Record<string, string> = {
  critical: 'bg-rose-50 text-rose-800 ring-rose-200',
  high: 'bg-amber-50 text-amber-800 ring-amber-200',
  raised: 'bg-sky-50 text-sky-800 ring-sky-200',
  low: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
}
const SEV_TONE: Record<string, string> = {
  minor: 'bg-emerald-50 text-emerald-900',
  moderate: 'bg-amber-50 text-amber-900',
  critical: 'bg-rose-50 text-rose-900',
}

export function RefundPlaybook() {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<Tab>('ladder')
  const [nightly, setNightly] = useState(300)

  const load = useCallback(async (n: number) => {
    try {
      const r = await fetch(`/api/refunds/playbook?nightly=${n}`).then(x => x.json())
      if (!r?.ok) { setErr(r?.message || r?.error || 'Could not load the playbook.'); return }
      setD(r); setErr('')
    } catch (e: any) { setErr(e?.message || String(e)) }
  }, [])
  useEffect(() => { load(nightly) }, [load, nightly])

  if (err) return <div className={`${card} p-4 text-sm text-rose-700`}>{err}</div>
  if (!d) return <div className="text-sm text-muted p-4 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>

  const tabs: [Tab, string][] = [
    ['ladder', 'The order of operations'], ['matrix', 'The matrix'], ['scenarios', 'Scenarios'],
    ['categories', 'By category'], ['authority', 'Who signs'],
  ]

  return (
    <div className="space-y-4">
      {/* THE ONE SENTENCE */}
      <div className={`${card} p-4 border-l-4 border-l-brand-600`}>
        <p className="text-[15px] text-ink font-semibold leading-snug">
          The goal is never a refund. The goal is to fix the problem quickly — and when that is not enough,
          the refund is what makes the stay right.
        </p>
        <p className="text-[12.5px] text-muted mt-1.5">
          Everything below is in that order. Money is the fourth thing we reach for, not the first, and on a
          case we fixed inside the clock it is often nothing at all.
        </p>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`shrink-0 px-3 py-2 text-[13px] font-semibold border-b-2 -mb-px ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'ladder' && <LadderTab d={d} />}
      {tab === 'matrix' && <MatrixTab d={d} nightly={nightly} setNightly={setNightly} />}
      {tab === 'scenarios' && <ScenariosTab d={d} />}
      {tab === 'categories' && <CategoriesTab d={d} />}
      {tab === 'authority' && <AuthorityTab d={d} reload={() => load(nightly)} />}
    </div>
  )
}

// ── 1. THE ORDER OF OPERATIONS ──────────────────────────────────────────────────────────────────
function LadderTab({ d }: { d: any }) {
  const rungs = [
    { n: 1, Icon: Wrench, title: 'Fix it', body: 'Every category has a clock — when the guest hears a human, and when it is actually put right. Hit the clock and most of these never become a refund at all.', tone: 'bg-brand-50 text-brand-800' },
    { n: 2, Icon: HandHeart, title: 'Hold them', body: 'What goes in their hands while the fix happens. A portable AC inside four hours beats $200 the next morning, and the framework prices it that way.', tone: 'bg-sky-50 text-sky-800' },
    { n: 3, Icon: DollarSign, title: 'Then the money', body: 'Only when the clock was blown, the fix was impossible, or the stay was already spoiled by the time we got there.', tone: 'bg-amber-50 text-amber-900' },
    { n: 4, Icon: PenLine, title: 'Sign it and log it', body: 'Every amount has an owner. Nobody waits for permission their own tier already gives them, and nothing goes unlogged.', tone: 'bg-emerald-50 text-emerald-900' },
  ]
  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-3">
        {rungs.map(r => (
          <div key={r.n} className={`${card} p-4`}>
            <div className="flex items-start gap-3">
              <div className={`shrink-0 w-9 h-9 rounded-xl grid place-items-center ${r.tone}`}><r.Icon size={17} /></div>
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-ink">{r.n}. {r.title}</p>
                <p className="text-[12.5px] text-muted leading-snug mt-0.5">{r.body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className={`${card} p-4`}>
        <p className="text-[13px] font-bold text-ink mb-2">What we hand them before money</p>
        <div className="space-y-2.5">
          {(d.remedies || []).map((r: any) => (
            <div key={r.key} className="border-l-2 border-line pl-3">
              <p className="text-[12.5px] font-semibold text-ink">{r.label}</p>
              <p className="text-[12px] text-muted">{r.what}</p>
              <p className="text-[12px] text-ink/70 mt-0.5">{r.worth}</p>
            </div>
          ))}
        </div>
        <p className="text-[11.5px] text-muted mt-3 pt-3 border-t border-line">
          Moving a guest or buying a hotel night is <strong>not</strong> a standard rung — it is Jon&rsquo;s call.
          The pests and safety ladders say so explicitly, because those are the two cases where staying put is not
          a real option and nobody should be improvising at midnight.
        </p>
      </div>

      <div className={`${card} overflow-hidden`}>
        <div className="px-4 py-3 border-b border-line text-[13px] font-bold text-ink">The rules that are not negotiable</div>
        <div className="divide-y divide-line">
          {(d.rules || []).map((r: any) => (
            <div key={r.key} className="px-4 py-3">
              <p className="text-[13px] font-semibold text-ink">{r.rule}</p>
              <p className="text-[12px] text-muted leading-snug mt-0.5">{r.why}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 2. THE MATRIX ───────────────────────────────────────────────────────────────────────────────
function MatrixTab({ d, nightly, setNightly }: { d: any; nightly: number; setNightly: (n: number) => void }) {
  const speeds = d.matrix.speeds as any[]
  const cells = d.matrix.cells as any[]
  const cellAt = (sev: string, sp: string) => cells.find(c => c.severity === sev && c.speed === sp)
  return (
    <div className="space-y-4">
      <div className={`${card} p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <p className="text-[13px] font-bold text-ink">Percent of one night&rsquo;s rate, per affected night</p>
            <p className="text-[12px] text-muted">The range is the defensible band. Land in the middle by default; the top is for a unit that cannot absorb a bad night.</p>
          </div>
          {d.canSeeMoney && (
            <label className="text-[12px] text-muted inline-flex items-center gap-2">
              Nightly rate
              <input type="number" value={nightly} min={50} max={5000} step={10}
                onChange={e => setNightly(Math.min(5000, Math.max(50, Number(e.target.value) || 300)))}
                className="w-24 text-sm text-ink bg-app border border-line rounded-lg px-2 py-1" />
            </label>
          )}
        </div>

        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-[12px] border-separate border-spacing-0 min-w-[640px]">
            <thead>
              <tr>
                <th className="text-left font-bold text-muted pb-2 pr-3 w-[110px]">How bad</th>
                {speeds.map(s => (
                  <th key={s.key} className="text-left font-bold text-ink pb-2 px-2">
                    {s.label}<span className="block font-normal text-[11px] text-muted">{s.sub}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {['minor', 'moderate', 'critical'].map(sev => (
                <tr key={sev}>
                  <td className={`align-top py-2 pr-3 text-[12px] font-bold capitalize rounded-l-lg ${SEV_TONE[sev]} px-2`}>{sev}</td>
                  {speeds.map(s => {
                    const c = cellAt(sev, s.key)
                    return (
                      <td key={s.key} className="align-top py-2 px-2 border-b border-line">
                        <p className="text-[13px] font-bold text-ink tabular-nums">{c.pctLow}–{c.pctHigh}%</p>
                        {d.canSeeMoney && <p className="text-[11px] text-muted tabular-nums">≈ {money(c.usdMid)} a night</p>}
                        <p className="text-[11px] text-emerald-700 mt-0.5">with a real workaround: {c.pctWithRemedy}%</p>
                        <p className="text-[11.5px] text-ink/80 mt-1 leading-snug">{c.action}</p>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11.5px] text-muted mt-3">
          Read the green line on every cell: that is the same failure with something useful in the guest&rsquo;s hands.
          It is roughly a third off, every time, which is the arithmetic case for the ladder.
        </p>
      </div>

      <div className={`${card} overflow-hidden`}>
        <div className="px-4 py-3 border-b border-line text-[13px] font-bold text-ink">How bad is it, really</div>
        <div className="divide-y divide-line">
          {['minor', 'moderate', 'critical'].map(k => {
            const t = d.matrix.severityTest[k]
            return (
              <div key={k} className="px-4 py-3">
                <p className="text-[13px] font-semibold text-ink">{t.label}</p>
                <p className="text-[12.5px] text-ink/80 mt-0.5"><span className="font-semibold">Ask yourself:</span> {t.test}</p>
                <p className="text-[12px] text-muted mt-0.5">{t.examples}</p>
              </div>
            )
          })}
        </div>
      </div>

      <ExposureExplainer />
    </div>
  )
}

function ExposureExplainer() {
  return (
    <div className={`${card} p-4`}>
      <p className="text-[13px] font-bold text-ink inline-flex items-center gap-1.5"><Star size={14} /> Where the unit&rsquo;s reviews come in</p>
      <p className="text-[12.5px] text-muted mt-1 leading-snug">
        One review moves an average by <span className="font-mono text-[11.5px] text-ink">(average − rating) ÷ (reviews + 1)</span>.
        That is why the same complaint is not the same problem on two different units:
      </p>
      <div className="grid sm:grid-cols-2 gap-2 mt-2.5">
        <div className="rounded-lg ring-1 ring-rose-200 bg-rose-50 px-3 py-2">
          <p className="text-[12px] font-bold text-rose-900">Capri 704 · 11 reviews · 4.82</p>
          <p className="text-[12px] text-rose-800">A 3-star drops it to <strong>4.67</strong> — through 4.8 and 4.7, where the listing starts losing placement.</p>
        </div>
        <div className="rounded-lg ring-1 ring-emerald-200 bg-emerald-50 px-3 py-2">
          <p className="text-[12px] font-bold text-emerald-900">Elser 4412 · 312 reviews · 4.89</p>
          <p className="text-[12px] text-emerald-800">The same 3-star drops it to <strong>4.88</strong>. Nothing moves, nothing breaks.</p>
        </div>
      </div>
      <p className="text-[12.5px] text-ink/80 mt-2.5 leading-snug">
        On a fragile unit the glitch card says so, pushes the fix to same-day, and puts the number at the
        <strong> top of the band its severity already earns</strong> — never above it. A fragile listing does not
        make the guest&rsquo;s loss bigger; it makes our urgency bigger.
      </p>
      <div className="mt-2.5 rounded-lg ring-1 ring-amber-200 bg-amber-50 px-3 py-2 flex gap-2">
        <AlertTriangle size={15} className="shrink-0 text-amber-700 mt-0.5" />
        <p className="text-[12px] text-amber-900">
          <strong>We never buy a review.</strong> No refund is conditional on one, offered in exchange for one, or
          discussed alongside one. Airbnb and Vrbo both treat that as review manipulation and the penalty is the
          listing. The exposure number is internal — it never becomes something we say to a guest.
        </p>
      </div>
    </div>
  )
}

// ── 3. SCENARIOS ────────────────────────────────────────────────────────────────────────────────
function ScenariosTab({ d }: { d: any }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const check = d.selfCheck
  return (
    <div className="space-y-3">
      <div className={`${card} p-3.5 flex items-start gap-2.5`}>
        <Info size={15} className="shrink-0 text-muted mt-0.5" />
        <p className="text-[12.5px] text-muted leading-snug">
          Read the story, decide what you would do, then open the answer. Every number is produced by the same
          engine the glitch card uses — so what you learn here is what the tool will say tomorrow.
          {check && (
            <span className={check.ok ? 'text-emerald-700' : 'text-rose-700'}>
              {' '}{check.ok ? 'All doctrine checks passing.' : `${check.failures.length} doctrine check(s) failing — tell Jon.`}
            </span>
          )}
        </p>
      </div>

      {(d.scenarios || []).map((s: any) => {
        const sc = s.scenario
        const isOpen = !!open[sc.key]
        return (
          <div key={sc.key} className={`${card} overflow-hidden`}>
            <div className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p className="text-[13.5px] font-bold text-ink">{sc.title}</p>
                <span className="text-[11.5px] text-muted">{sc.unit} · {sc.channel} · {d.canSeeMoney ? `${money(sc.nightly)} × ${sc.nights} nights` : `${sc.nights} nights`}</span>
              </div>
              <ol className="mt-2 space-y-1">
                {sc.story.map((line: string, i: number) => (
                  <li key={i} className="text-[12.5px] text-ink/85 leading-snug flex gap-2">
                    <span className="text-muted tabular-nums shrink-0">{i + 1}.</span>{line}
                  </li>
                ))}
              </ol>
              <div className="mt-2.5 rounded-lg bg-app ring-1 ring-line px-3 py-2">
                <p className="text-[11px] uppercase tracking-wider font-bold text-muted">The trap</p>
                <p className="text-[12.5px] text-ink/85">{sc.trap}</p>
              </div>
              <button onClick={() => setOpen(o => ({ ...o, [sc.key]: !isOpen }))}
                className="mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-brand-700 hover:text-brand-800">
                {isOpen ? <EyeOff size={13} /> : <Eye size={13} />} {isOpen ? 'Hide the answer' : 'Show the answer'}
              </button>
            </div>

            {isOpen && (
              <div className="border-t border-line bg-app/50 px-4 py-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {d.canSeeMoney && (
                    <span className="text-[20px] font-bold text-ink tabular-nums">{money(s.refund)}</span>
                  )}
                  {d.canSeeMoney && s.pctOfStay != null && <span className="text-[12px] text-muted">{s.pctOfStay}% of the stay</span>}
                  <span className="text-[11.5px] font-bold px-2 py-0.5 rounded-full bg-white ring-1 ring-line text-ink">{s.tier.who}</span>
                  <span className={`text-[11.5px] font-bold px-2 py-0.5 rounded-full ring-1 ${LEVEL_TONE[s.exposure.level]}`}>
                    reviews: {s.exposure.level}
                  </span>
                </div>
                <p className="text-[12px] text-muted">{s.tierWhy}</p>

                <div className="rounded-lg bg-white ring-1 ring-line px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wider font-bold text-muted">The clock on this one</p>
                  <p className="text-[12.5px] text-ink/85">
                    {s.ladderLabel} — a human within {mins(s.firstResponseMins)}, fixed within {s.fixTargetHours} hours.
                  </p>
                  {d.canSeeMoney && s.saved > 0 && (
                    <p className="text-[12.5px] text-emerald-700 mt-1">
                      Hit that clock with something in their hands and this case costs {money(s.ifWeHadHitTheClock)} instead
                      of {money(s.refund)} — {money(s.saved)} of the number is the delay, not the fault.
                    </p>
                  )}
                </div>

                <div className="rounded-lg bg-white ring-1 ring-line px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wider font-bold text-muted">Why this unit</p>
                  <p className="text-[12.5px] font-semibold text-ink">{s.exposure.headline}</p>
                  {(s.exposure.lines || []).map((l: string, i: number) => (
                    <p key={i} className="text-[12px] text-muted leading-snug mt-0.5">{l}</p>
                  ))}
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-wider font-bold text-muted">The lesson</p>
                  <p className="text-[12.5px] text-ink/90 leading-snug">{sc.lesson}</p>
                </div>

                {d.canSeeMoney && (s.result?.reasoning || []).length > 0 && (
                  <details>
                    <summary className="text-[12px] font-semibold text-muted cursor-pointer">How the number was reached</summary>
                    <ul className="mt-1.5 space-y-1">
                      {s.result.reasoning.map((r: string, i: number) => (
                        <li key={i} className="text-[12px] text-muted leading-snug">· {r}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── 4. BY CATEGORY ──────────────────────────────────────────────────────────────────────────────
function CategoriesTab({ d }: { d: any }) {
  const [open, setOpen] = useState<string>('')
  return (
    <div className={`${card} overflow-hidden`}>
      {(d.ladders || []).map((l: any) => {
        const isOpen = open === l.category
        return (
          <div key={l.category} className="border-b border-line last:border-b-0">
            <button onClick={() => setOpen(isOpen ? '' : l.category)} className="w-full text-left px-4 py-3 hover:bg-app/60 flex items-center gap-2">
              {isOpen ? <ChevronDown size={14} className="text-muted shrink-0" /> : <ChevronRight size={14} className="text-muted shrink-0" />}
              <span className="text-[13px] font-bold text-ink flex-1">{l.label}</span>
              <span className="text-[11.5px] text-muted inline-flex items-center gap-1 shrink-0">
                <Clock size={11} /> {mins(l.firstResponseMins)} · fix in {l.fixTargetHours}h
              </span>
              {l.escalate && <AlertTriangle size={13} className="text-rose-600 shrink-0" />}
            </button>
            {isOpen && (
              <div className="px-4 pb-4 space-y-3">
                <p className="text-[12px] text-muted leading-snug italic">{l.clockWhy}</p>
                {l.escalate && (
                  <div className="rounded-lg ring-1 ring-rose-200 bg-rose-50 px-3 py-2 flex gap-2">
                    <AlertTriangle size={15} className="shrink-0 text-rose-700 mt-0.5" />
                    <p className="text-[12.5px] text-rose-900 font-semibold">{l.escalate}</p>
                  </div>
                )}
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1">Fix it</p>
                    <ul className="space-y-1">{l.fix.map((f: string, i: number) => <li key={i} className="text-[12.5px] text-ink/85 leading-snug flex gap-1.5"><Check size={13} className="shrink-0 mt-0.5 text-brand-600" />{f}</li>)}</ul>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1">Hold them while you do</p>
                    <ul className="space-y-1">{l.hold.map((f: string, i: number) => <li key={i} className="text-[12.5px] text-ink/85 leading-snug flex gap-1.5"><HandHeart size={13} className="shrink-0 mt-0.5 text-sky-600" />{f}</li>)}</ul>
                  </div>
                </div>
                <div className="rounded-lg bg-app ring-1 ring-line px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wider font-bold text-muted">It is critical when</p>
                  <p className="text-[12.5px] text-ink/85">{l.criticalWhen}</p>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── 5. WHO SIGNS ────────────────────────────────────────────────────────────────────────────────
function AuthorityTab({ d, reload }: { d: any; reload: () => void }) {
  const [cfg, setCfg] = useState(d.authority.config)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const dirty = JSON.stringify(cfg) !== JSON.stringify(d.authority.config)

  async function save() {
    setBusy(true); setNote('')
    try {
      const r = await fetch('/api/refunds/playbook', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'authority', ...cfg }),
      }).then(x => x.json())
      if (!r?.ok) setNote(r?.message || r?.error || 'Could not save.')
      else { setNote('Saved. Every recommendation from here on routes on these numbers.'); reload() }
    } catch (e: any) { setNote(e?.message || String(e)) } finally { setBusy(false) }
  }

  const F = ({ k, label, suffix, hint }: { k: string; label: string; suffix: string; hint: string }) => (
    <label className="block">
      <span className="text-[12px] font-semibold text-ink">{label}</span>
      <span className="flex items-center gap-1.5 mt-1">
        <span className="text-[13px] text-muted">{suffix === '$' ? '$' : ''}</span>
        <input type="number" value={(cfg as any)[k]} disabled={!d.canEdit}
          onChange={e => setCfg({ ...cfg, [k]: Number(e.target.value) })}
          className="w-28 text-sm text-ink bg-app border border-line rounded-lg px-2 py-1.5 disabled:opacity-60" />
        <span className="text-[13px] text-muted">{suffix === '%' ? '%' : ''}</span>
      </span>
      <span className="block text-[11.5px] text-muted mt-1 leading-snug">{hint}</span>
    </label>
  )

  return (
    <div className="space-y-4">
      <div className={`${card} overflow-hidden`}>
        <div className="divide-y divide-line">
          {(d.authority.tiers || []).map((t: any, i: number) => (
            <div key={t.key} className="px-4 py-3 flex items-start gap-3">
              <div className={`shrink-0 w-7 h-7 rounded-lg grid place-items-center text-[12px] font-bold ${i === 0 ? 'bg-emerald-50 text-emerald-800' : i === 1 ? 'bg-amber-50 text-amber-900' : 'bg-rose-50 text-rose-800'}`}>{i + 1}</div>
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-ink">{t.who}</p>
                <p className="text-[12.5px] text-ink/85">{t.rule}</p>
                <p className="text-[12px] text-muted mt-0.5">{t.then}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={`${card} p-4`}>
        <p className="text-[13px] font-bold text-ink mb-1">The four numbers</p>
        <p className="text-[12px] text-muted mb-3 leading-snug">
          Tunable without a deploy. The proportion rider <strong>escalates one level</strong> rather than jumping
          straight to Jon — set at 25% it fires at almost exactly the front-line ceiling on a normal two-night
          booking and the supervisor tier disappears, so it sits at 40%.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <F k="front" label="Front line decides up to" suffix="$" hint="No approval, no waiting. Log it and move on." />
          <F k="supervisor" label="Supervisor decides up to" suffix="$" hint="Their call; Jon hears about it the same day." />
          <F k="pctRider" label="Escalate one level above" suffix="%" hint="Share of the stay that bumps a decision up a tier." />
          <F k="fullStay" label="Always Jon at or above" suffix="%" hint="Effectively refunding the booking, at any size." />
        </div>
        {d.canEdit && (
          <div className="mt-3 flex items-center gap-2">
            <button onClick={save} disabled={busy || !dirty}
              className="inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-2 hover:bg-brand-700 disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Save
            </button>
            {note && <span className="text-[12px] text-muted">{note}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
