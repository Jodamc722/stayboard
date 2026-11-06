'use client'
// THE TEAM SCOREBOARD (Jon, 2026-11-06: "Let's build a scoreboard for our team, a way to organize the
// feedback, read the inspection and be able to share the inspection reports with the girls").
//
// Four tabs, one data call (/api/scoreboard):
//   SCOREBOARD  housekeepers ranked by the score as found (HK Post Clean 1.0), 7 / 30 / 90 days, trend
//               against the period before, the weakest area, and a badge when a report is ready.
//   REPORTS     "Every 5 inspections is when it should be flagged to send." The ready ones with Copy /
//               WhatsApp / Text — sending marks it sent (with undo) — and the sent ones with who sent
//               it and whether she opened it. The link is hers: /ir/<code>, no login.
//   FEEDBACK    every miss, coaching note and perfect clean, by person or by area, open → talked →
//               resolved, and the team's top five misses so supervisors know what to retrain.
//   INSPECTIONS the reader: every stored inspection, every line, ✓/✗, English with Spanish under it,
//               photos, notes, and the Breezeway task.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2, RefreshCw, Copy, MessageSquare, Send, Undo2, Eye, ExternalLink, Check, X, ArrowUp, ArrowDown, Minus, Trophy, ClipboardCheck, Link2, Search } from 'lucide-react'
import { LeanHead, Pill, Tag, IconBtn, LeanList, LeanRow, LeanEmpty, LeanTabs, LeanPick, LeanSection, type Tone } from '@/components/lean'
import { Sheet } from '@/components/Sheet'

type Lang = 'en' | 'es'
type Kind = 'hk_post_clean' | 'pm' | 'arrival'
type BoardRow = {
  key: string; name: string; inspections: number; avgScore: number | null; avgPassRate: number | null; prevScore: number | null; delta: number | null
  topWeak: { section: string; count: number } | null; misses: number; lastAt: string | null; readyReports: number; openFeedback: number; pending: number
  lang: Lang | null; learnCode: string | null
}
type ReportRow = {
  id: string; code: string; person_key: string; person_name: string | null; lang: Lang; status: 'ready' | 'sent'; created_at: string
  period_from: string | null; period_to: string | null; sent_at: string | null; sent_by: string | null; sent_via: string | null
  viewed_at: string | null; view_count: number; manager_note: string | null; count: number; avgScore: number | null; avgPassRate: number | null; topSection: string | null
}
type FbStatus = 'open' | 'talked' | 'resolved'
type FeedbackRow = {
  id: string; task_id: string; person_key: string | null; person_name: string | null; kind: 'miss' | 'coaching' | 'praise'; section: string | null
  text_en: string | null; text_es: string | null; status: FbStatus; handled_by: string | null; handled_at: string | null; note: string | null
  created_at: string; unit: string | null; date: string | null
}
type InspRow = {
  task_id: string; kind: Kind; unit: string | null; finished_at: string | null; inspector: string | null; subject_name: string | null; subject_key: string | null
  score: number | null; pass_rate: number | null; yes_count: number; no_count: number; misses: number; link: string
}
type Data = {
  ok: boolean; error?: string; days: number; needs: { results: boolean; reports: boolean }; migrations: { results: string; reports: string }
  board: BoardRow[]; reports: ReportRow[]; feedback: FeedbackRow[]; topMisses: { section: string; en: string; es: string | null; count: number; people: number }[]
  inspections: InspRow[]; unattributed: number; can: { edit: boolean }; me: string
}
type TabKey = 'board' | 'reports' | 'feedback' | 'inspections'
type Days = '7' | '30' | '90'

const pct = (n: number | null | undefined) => n == null ? '—' : `${Math.round(n * 100)}%`
const scoreTone = (n: number | null | undefined): Tone => n == null ? 'slate' : n < 3 ? 'rose' : n < 4 ? 'amber' : 'emerald'
const passTone = (n: number | null | undefined): Tone => n == null ? 'slate' : n < 0.8 ? 'rose' : n < 0.9 ? 'amber' : 'emerald'
const day = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }) : '—'
const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : '—'
const KIND_NAME: Record<Kind, string> = { hk_post_clean: 'HK post clean', pm: 'PM', arrival: 'Arrival' }
const VIA_NAME: Record<string, string> = { whatsapp: 'WhatsApp', sms: 'text', copy: 'copied link', manual: 'marked' }
const btn = (tone: 'ink' | 'ghost' | 'ok' = 'ink') => `inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50 ${tone === 'ink' ? 'bg-ink text-white hover:opacity-90' : tone === 'ok' ? 'bg-emerald-600 text-white hover:opacity-90' : 'border border-line bg-white text-ink hover:bg-app'}`
const origin = () => (typeof window !== 'undefined' ? window.location.origin : '')
const reportUrl = (code: string) => origin() + '/ir/' + code
const first = (name: string | null) => String(name || '').trim().split(/\s+/)[0] || ''

/** The message she gets, in her language, with her link. */
function shareText(r: ReportRow): string {
  const url = reportUrl(r.code)
  const n = r.count || 5
  const avg = r.avgScore != null ? r.avgScore.toFixed(1) : null
  if (r.lang === 'en') return `Hi ${first(r.person_name)}! Here is your report from your last ${n} inspections${avg ? ` (average ${avg} out of 5)` : ''}. Open it here: ${url}\n— Stay Hospitality`
  return `¡Hola ${first(r.person_name)}! Aquí está tu reporte de tus últimas ${n} inspecciones${avg ? ` (promedio ${avg} de 5)` : ''}. Ábrelo aquí: ${url}\n— Stay Hospitality`
}

async function post(body: Record<string, any>) {
  const r = await fetch('/api/scoreboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j?.ok === false) throw new Error(j?.error || j?.message || `HTTP ${r.status}`)
  return j
}

export function ScoreboardDesk() {
  const [days, setDays] = useState<Days>('30')
  const [tab, setTab] = useState<TabKey>('board')
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  const [person, setPerson] = useState<string | null>(null)
  const [reading, setReading] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // ?tab= from the bell link (read on mount — no useSearchParams, so no Suspense boundary needed).
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('tab')
      if (t === 'reports' || t === 'feedback' || t === 'inspections' || t === 'board') setTab(t)
    } catch { /* default tab */ }
  }, [])

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setErr(null)
    try {
      const r = await fetch('/api/scoreboard?days=' + days, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || j.ok === false) throw new Error(j.error || j.message || `HTTP ${r.status}`)
      setD(j)
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [days])
  useEffect(() => { load() }, [load])

  const say = (text: string, undo?: () => void) => {
    setToast({ text, undo })
    window.setTimeout(() => setToast(t => (t && t.text === text ? null : t)), undo ? 9000 : 4500)
  }
  const patchReport = (id: string, p: Partial<ReportRow>) => setD(x => x ? { ...x, reports: x.reports.map(r => r.id === id ? { ...r, ...p } : r) } : x)
  const patchFb = (id: string, p: Partial<FeedbackRow>) => setD(x => x ? { ...x, feedback: x.feedback.map(f => f.id === id ? { ...f, ...p } : f) } : x)

  const undoSent = async (r: ReportRow) => {
    try { await post({ action: 'undo-sent', id: r.id }); patchReport(r.id, { status: 'ready', sent_at: null, sent_by: null, sent_via: null }); say('Back to ready.') } catch (e: any) { say(e?.message || String(e)) }
  }
  const markSent = async (r: ReportRow, via: string) => {
    try {
      await post({ action: 'mark-sent', id: r.id, via })
      patchReport(r.id, { status: 'sent', sent_at: new Date().toISOString(), sent_by: d?.me || null, sent_via: via })
      say(`Marked sent to ${r.person_name || 'her'}.`, () => undoSent({ ...r, status: 'sent' }))
    } catch (e: any) { say(e?.message || String(e)) }
  }
  /** Share opens WhatsApp / Messages first (a pop-up must open inside the click), then marks it sent. */
  const share = async (r: ReportRow, via: 'whatsapp' | 'sms' | 'copy') => {
    const msg = shareText(r)
    if (via === 'whatsapp') window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener')
    else if (via === 'sms') window.location.href = 'sms:?&body=' + encodeURIComponent(msg)
    else { try { await navigator.clipboard.writeText(msg) } catch { window.prompt('Copy this message', msg) } }
    if (r.status === 'ready' && d?.can.edit) await markSent(r, via)
    else if (via === 'copy') say('Message with her link copied.')
  }
  const setFb = async (f: FeedbackRow, status: FbStatus, note?: string) => {
    setBusy(f.id)
    try {
      await post({ action: 'feedback', id: f.id, status, ...(note !== undefined ? { note } : {}) })
      patchFb(f.id, { status, handled_by: status === 'open' ? null : d?.me || null, handled_at: status === 'open' ? null : new Date().toISOString(), ...(note !== undefined ? { note: note || null } : {}) })
    } catch (e: any) { say(e?.message || String(e)) } finally { setBusy(null) }
  }
  const buildNow = async () => {
    setBusy('build')
    try {
      const j = await post({ action: 'build-now' })
      say(j.created ? `${j.created} new report${j.created === 1 ? '' : 's'} ready to send.` : `No new block of 5 yet${j.feedback ? ` · ${j.feedback} feedback item${j.feedback === 1 ? '' : 's'} added` : ''}.`)
      load(true)
    } catch (e: any) { say(e?.message || String(e)) } finally { setBusy(null) }
  }

  const ready = (d?.reports || []).filter(r => r.status === 'ready')
  const openFb = (d?.feedback || []).filter(f => f.status === 'open' && f.kind !== 'praise')
  const can = d?.can || { edit: false }

  return (
    <div className="max-w-6xl mx-auto">
      <LeanHead title="Team scoreboard" sub="HK Post Clean Inspection 1.0 — the clean as found. A report to send every 5 inspections.">
        <Pill title="Housekeepers with an inspection in this period">{d?.board.length ?? 0} people</Pill>
        {ready.length ? <Pill tone="amber" title="Reports ready to send" onClick={() => setTab('reports')}>{ready.length} to send</Pill> : null}
        {openFb.length ? <Pill tone="rose" title="Misses and coaching notes nobody has talked to her about yet" onClick={() => setTab('feedback')}>{openFb.length} open</Pill> : null}
        <LeanPick<Days> value={days} size="sm" title="Period" onPick={setDays} options={[{ v: '7', label: '7d' }, { v: '30', label: '30d' }, { v: '90', label: '90d' }]} />
        <IconBtn title="Reload" onClick={() => load(true)}><RefreshCw size={14} /></IconBtn>
        {can.edit && d && !d.needs.reports && !d.needs.results ? <button onClick={buildNow} disabled={busy === 'build'} className={btn('ghost')} title="Make any report now due (every 5 inspections) and file the feedback">{busy === 'build' ? <Loader2 size={13} className="animate-spin" /> : <ClipboardCheck size={13} />} Check now</button> : null}
      </LeanHead>

      <LeanTabs<TabKey> value={tab} onChange={setTab} tabs={[
        { key: 'board', label: 'Scoreboard', n: d?.board.length },
        { key: 'reports', label: 'Reports to send', n: ready.length },
        { key: 'feedback', label: 'Feedback', n: openFb.length },
        { key: 'inspections', label: 'Inspections', n: d?.inspections.length },
      ]} />

      {err ? <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-[12.5px] mb-3">{err}</div> : null}
      {loading && !d ? <div className="flex items-center gap-2 text-muted text-[13px] py-10 justify-center"><Loader2 size={15} className="animate-spin" /> Loading…</div> : null}
      {d?.needs.results ? <LeanEmpty>Run migration <span className="font-mono">{d.migrations.results}</span> in Supabase, then sync inspections from Training → Inspections.</LeanEmpty> : null}
      {d && !d.needs.results && d.needs.reports ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-[12.5px] mb-3">Reports and feedback are off until migration <span className="font-mono">{d.migrations.reports}</span> runs in Supabase. The scoreboard and the reader work now.</div>
      ) : null}

      {d && !d.needs.results ? <>
        {tab === 'board' ? <BoardView d={d} onPick={setPerson} /> : null}
        {tab === 'reports' ? <ReportsView d={d} share={share} markSent={markSent} undoSent={undoSent} onNote={async (r, note) => { try { await post({ action: 'manager-note', id: r.id, note }); patchReport(r.id, { manager_note: note || null }); say('Note saved — it shows on her report.') } catch (e: any) { say(e?.message || String(e)) } }} /> : null}
        {tab === 'feedback' ? <FeedbackView d={d} setFb={setFb} busy={busy} onRead={setReading} /> : null}
        {tab === 'inspections' ? <InspectionsView d={d} onRead={setReading} /> : null}
      </> : null}

      {person && d ? <PersonSheet d={d} personKey={person} onClose={() => setPerson(null)} onRead={(t) => setReading(t)} share={share} setFb={setFb} busy={busy} say={say} /> : null}
      {reading ? <ReaderSheet taskId={reading} onClose={() => setReading(null)} /> : null}

      {toast ? (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] rounded-xl bg-ink text-white text-[13px] px-4 py-2.5 shadow-lg flex items-center gap-3 max-w-[92vw]">
          <span>{toast.text}</span>
          {toast.undo ? <button onClick={() => { const u = toast.undo; setToast(null); u && u() }} className="inline-flex items-center gap-1 font-semibold underline"><Undo2 size={13} /> Undo</button> : null}
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- scoreboard
function Trend({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="text-muted">—</span>
  if (delta >= 0.25) return <span className="inline-flex items-center gap-0.5 text-emerald-700 font-semibold"><ArrowUp size={12} />{delta.toFixed(1)}</span>
  if (delta <= -0.25) return <span className="inline-flex items-center gap-0.5 text-rose-700 font-semibold"><ArrowDown size={12} />{Math.abs(delta).toFixed(1)}</span>
  return <span className="inline-flex items-center gap-0.5 text-muted"><Minus size={12} />flat</span>
}

function BoardView({ d, onPick }: { d: Data; onPick: (k: string) => void }) {
  if (!d.board.length) return <LeanEmpty>No HK Post Clean inspections in the last {d.days} days.</LeanEmpty>
  return (
    <>
      {d.unattributed ? <p className="text-[12px] text-amber-700 mb-2 px-1">{d.unattributed} inspection{d.unattributed === 1 ? '' : 's'} in this period could not be matched to a housekeeper.</p> : null}
      <div className="rounded-2xl border border-line bg-white overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted border-b border-line">
              <th className="px-3 py-2 font-semibold w-8">#</th>
              <th className="px-2 py-2 font-semibold">Housekeeper</th>
              <th className="px-2 py-2 font-semibold text-right" title="The 1–5 score the inspector gave the clean as found">Score</th>
              <th className="px-2 py-2 font-semibold text-right">Inspections</th>
              <th className="px-2 py-2 font-semibold text-right" title="Yes answers of all Yes/No lines">Pass</th>
              <th className="px-2 py-2 font-semibold" title={`Score against the ${d.days} days before`}>Trend</th>
              <th className="px-2 py-2 font-semibold">Weakest area</th>
              <th className="px-2 py-2 font-semibold">Report</th>
            </tr>
          </thead>
          <tbody>
            {d.board.map((p, i) => (
              <tr key={p.key} onClick={() => onPick(p.key)} className="border-b border-line/60 last:border-0 hover:bg-app cursor-pointer">
                <td className="px-3 py-2 text-muted tabular-nums">{i < 3 && p.avgScore != null ? <Trophy size={13} className={i === 0 ? 'text-amber-500' : i === 1 ? 'text-slate-400' : 'text-amber-700'} /> : i + 1}</td>
                <td className="px-2 py-2 font-semibold text-ink whitespace-nowrap">{p.name}{p.openFeedback ? <span className="ml-1.5"><Tag tone="rose" title="Open feedback">{p.openFeedback} open</Tag></span> : null}</td>
                <td className="px-2 py-2 text-right"><Tag tone={scoreTone(p.avgScore)}>{p.avgScore != null ? p.avgScore.toFixed(1) : '—'}</Tag></td>
                <td className="px-2 py-2 text-right tabular-nums">{p.inspections}</td>
                <td className="px-2 py-2 text-right"><Tag tone={passTone(p.avgPassRate)}>{pct(p.avgPassRate)}</Tag></td>
                <td className="px-2 py-2 whitespace-nowrap"><Trend delta={p.delta} /></td>
                <td className="px-2 py-2">{p.topWeak ? <Tag tone="amber" title={`${p.topWeak.count} miss${p.topWeak.count === 1 ? '' : 'es'}`}>{p.topWeak.section}</Tag> : <span className="text-muted">—</span>}</td>
                <td className="px-2 py-2 whitespace-nowrap">{p.readyReports ? <Tag tone="brand">Report ready</Tag> : <span className="text-[11.5px] text-muted tabular-nums" title="Inspections toward her next report">{p.pending % 5}/5</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- reports
function ShareButtons({ r, share, compact }: { r: ReportRow; share: (r: ReportRow, via: 'whatsapp' | 'sms' | 'copy') => void; compact?: boolean }) {
  return <>
    <IconBtn title="Preview her page (does not count as opened)" href={'/ir/' + r.code + '?preview=1'}><Eye size={14} /></IconBtn>
    <IconBtn title="Copy the message with her link" onClick={() => share(r, 'copy')}><Copy size={14} /></IconBtn>
    <IconBtn title="Send by text message" onClick={() => share(r, 'sms')}><MessageSquare size={14} /></IconBtn>
    {compact ? <IconBtn title="Send on WhatsApp" tone="ok" onClick={() => share(r, 'whatsapp')}><Send size={14} /></IconBtn>
      : <button onClick={() => share(r, 'whatsapp')} className={btn('ok')}><Send size={13} /> WhatsApp</button>}
  </>
}

function NoteBox({ value, onSave, placeholder }: { value: string | null; onSave: (v: string) => void; placeholder: string }) {
  const [v, setV] = useState(value || '')
  return (
    <div className="flex items-start gap-2">
      <textarea value={v} onChange={e => setV(e.target.value)} rows={2} placeholder={placeholder} className="flex-1 rounded-xl border border-line px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-brand-200" />
      <button onClick={() => onSave(v.trim())} disabled={v.trim() === (value || '')} className={btn('ghost')}>Save</button>
    </div>
  )
}

function ReportsView({ d, share, markSent, undoSent, onNote }: { d: Data; share: (r: ReportRow, via: 'whatsapp' | 'sms' | 'copy') => void; markSent: (r: ReportRow, via: string) => void; undoSent: (r: ReportRow) => void; onNote: (r: ReportRow, note: string) => void }) {
  if (d.needs.reports) return <LeanEmpty>Run migration <span className="font-mono">{d.migrations.reports}</span> in Supabase to turn on reports.</LeanEmpty>
  const ready = d.reports.filter(r => r.status === 'ready')
  const sent = d.reports.filter(r => r.status === 'sent').sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))
  const facts = (r: ReportRow) => `${r.count} inspections · ${day(r.period_from)} – ${day(r.period_to)}`
  return (
    <>
      <LeanSection title="Ready to send" n={ready.length}>
        {!ready.length ? <LeanEmpty>Nothing to send. A report is made for each housekeeper every 5 inspections.</LeanEmpty> : (
          <LeanList>
            {ready.map(r => (
              <LeanRow key={r.id} name={r.person_name || r.person_key} meta={facts(r)}
                tags={<>
                  <Tag tone={scoreTone(r.avgScore)}>{r.avgScore != null ? `avg ${r.avgScore.toFixed(1)}` : 'no score'}</Tag>
                  <Tag tone={passTone(r.avgPassRate)}>{pct(r.avgPassRate)} pass</Tag>
                  <Tag tone="slate">{r.lang === 'es' ? 'Español' : 'English'}</Tag>
                  {r.manager_note ? <Tag tone="violet">note</Tag> : null}
                </>}
                actions={d.can.edit ? <ShareButtons r={r} share={share} /> : <IconBtn title="Preview" href={'/ir/' + r.code + '?preview=1'}><Eye size={14} /></IconBtn>}>
                <p className="text-[12px] text-muted">Made {when(r.created_at)}{r.topSection ? ` · most misses in ${r.topSection}` : ''}. Sending by WhatsApp, text or Copy marks it sent.</p>
                {d.can.edit ? <>
                  <NoteBox value={r.manager_note} onSave={(v) => onNote(r, v)} placeholder="A line from you — shows at the top of her report (optional)" />
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => markSent(r, 'manual')} className={btn('ghost')}><Check size={13} /> Mark sent (sent another way)</button>
                    <span className="text-[11.5px] text-muted font-mono break-all">{reportUrl(r.code)}</span>
                  </div>
                </> : null}
              </LeanRow>
            ))}
          </LeanList>
        )}
      </LeanSection>
      <LeanSection title="Sent" n={sent.length}>
        {!sent.length ? <LeanEmpty>None sent in this period.</LeanEmpty> : (
          <LeanList>
            {sent.map(r => (
              <LeanRow key={r.id} name={r.person_name || r.person_key} meta={`${facts(r)} · sent ${when(r.sent_at)}${r.sent_by ? ` by ${r.sent_by}` : ''}${r.sent_via ? ` · ${VIA_NAME[r.sent_via] || r.sent_via}` : ''}`}
                tags={<>
                  <Tag tone={scoreTone(r.avgScore)}>{r.avgScore != null ? `avg ${r.avgScore.toFixed(1)}` : 'no score'}</Tag>
                  {r.viewed_at ? <Tag tone="emerald" title={`First opened ${when(r.viewed_at)}`}>opened{r.view_count > 1 ? ` ×${r.view_count}` : ''}</Tag> : <Tag tone="amber">not opened</Tag>}
                </>}
                actions={d.can.edit ? <>
                  <ShareButtons r={r} share={share} compact />
                  <IconBtn title="Undo — back to ready" onClick={() => undoSent(r)}><Undo2 size={14} /></IconBtn>
                </> : null} />
            ))}
          </LeanList>
        )}
      </LeanSection>
    </>
  )
}

// ---------------------------------------------------------------- feedback
const FB_KIND: Record<FeedbackRow['kind'], { label: string; tone: Tone }> = { miss: { label: 'miss', tone: 'rose' }, coaching: { label: 'coaching', tone: 'violet' }, praise: { label: 'praise', tone: 'emerald' } }

function FeedbackItem({ f, by, setFb, busy, onRead, canEdit }: { f: FeedbackRow; by: 'person' | 'area'; setFb: (f: FeedbackRow, s: FbStatus, note?: string) => void; busy: string | null; onRead: (t: string) => void; canEdit: boolean }) {
  const meta = [by === 'area' ? f.person_name : f.section, f.unit, day(f.date)].filter(Boolean).join(' · ')
  return (
    <LeanRow name={f.text_en || '—'} meta={meta}
      tags={<>
        <Tag tone={FB_KIND[f.kind].tone}>{FB_KIND[f.kind].label}</Tag>
        {f.status !== 'open' ? <Tag tone={f.status === 'resolved' ? 'emerald' : 'sky'} title={`${f.handled_by || ''} · ${when(f.handled_at)}`}>{f.status === 'talked' ? 'talked' : 'resolved'}</Tag> : null}
      </>}
      actions={canEdit && f.kind !== 'praise' ? <>
        {f.status === 'open' ? <button disabled={busy === f.id} onClick={() => setFb(f, 'talked')} className={btn('ghost')}>Talked to her</button> : null}
        {f.status !== 'resolved' ? <IconBtn title="Resolved" tone="ok" disabled={busy === f.id} onClick={() => setFb(f, 'resolved')}><Check size={14} /></IconBtn>
          : <IconBtn title="Reopen" disabled={busy === f.id} onClick={() => setFb(f, 'open')}><Undo2 size={14} /></IconBtn>}
      </> : null}>
      {f.text_es ? <p className="text-[12.5px] text-muted italic">{f.text_es}</p> : null}
      {f.status !== 'open' ? <p className="text-[12px] text-muted">{f.status === 'talked' ? 'Talked' : 'Resolved'} by {f.handled_by || '—'} · {when(f.handled_at)}</p> : null}
      {canEdit ? <NoteBox value={f.note} onSave={(v) => setFb(f, f.status, v)} placeholder="Note (optional) — what was said, what changed" /> : f.note ? <p className="text-[12.5px]">{f.note}</p> : null}
      <button onClick={() => onRead(f.task_id)} className="text-[12px] font-semibold text-brand-700 hover:underline">Read the inspection →</button>
    </LeanRow>
  )
}

function FeedbackView({ d, setFb, busy, onRead }: { d: Data; setFb: (f: FeedbackRow, s: FbStatus, note?: string) => void; busy: string | null; onRead: (t: string) => void }) {
  const [status, setStatus] = useState<FbStatus | 'all'>('open')
  const [by, setBy] = useState<'person' | 'area'>('person')
  const cut = new Date(Date.now() - d.days * 86400000).toISOString()
  const rows = useMemo(() => d.feedback.filter(f => {
    // Open and talked items stay until someone resolves them; resolved ones are this period's.
    if (status !== 'all' && f.status !== status) return false
    if (f.status === 'resolved' && String(f.date || f.created_at) < cut) return false
    return true
  }), [d.feedback, status, cut])
  const groups = useMemo(() => {
    const m: Record<string, FeedbackRow[]> = {}
    for (const f of rows) { const k = by === 'person' ? (f.person_name || f.person_key || 'Not matched to a person') : (f.kind === 'miss' ? (f.section || 'Other') : f.kind === 'coaching' ? 'Coaching notes' : 'Praise'); (m[k] || (m[k] = [])).push(f) }
    return Object.entries(m).sort((a, b) => b[1].filter(f => f.kind === 'miss').length - a[1].filter(f => f.kind === 'miss').length || b[1].length - a[1].length)
  }, [rows, by])
  if (d.needs.reports) return <LeanEmpty>Run migration <span className="font-mono">{d.migrations.reports}</span> in Supabase to turn on feedback.</LeanEmpty>
  return (
    <>
      <LeanSection title={`Top 5 misses · last ${d.days} days`} n={d.topMisses.length}>
        {!d.topMisses.length ? <LeanEmpty>No misses in this period.</LeanEmpty> : (
          <ol className="rounded-2xl border border-line bg-white divide-y divide-line/70">
            {d.topMisses.map((m, i) => (
              <li key={i} className="px-3 sm:px-4 py-2 flex items-start gap-3">
                <span className="text-[18px] font-bold text-muted tabular-nums w-5 shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-semibold text-ink">{m.en}</p>
                  {m.es ? <p className="text-[12px] text-muted italic">{m.es}</p> : null}
                  <p className="text-[11.5px] text-muted mt-0.5">{m.section}</p>
                </div>
                <div className="text-right shrink-0">
                  <Tag tone="rose">{m.count}×</Tag>
                  <p className="text-[11px] text-muted mt-1">{m.people} {m.people === 1 ? 'person' : 'people'}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </LeanSection>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <LeanPick<FbStatus | 'all'> value={status} size="sm" onPick={setStatus} options={[{ v: 'open', label: 'Open' }, { v: 'talked', label: 'Talked' }, { v: 'resolved', label: 'Resolved' }, { v: 'all', label: 'All' }]} />
        <span className="text-muted text-[12px] ml-2">Group by</span>
        <LeanPick<'person' | 'area'> value={by} size="sm" onPick={setBy} options={[{ v: 'person', label: 'Person' }, { v: 'area', label: 'Area' }]} />
      </div>
      {!groups.length ? <LeanEmpty>Nothing {status === 'all' ? '' : status} here.</LeanEmpty> : groups.map(([k, list]) => (
        <LeanSection key={k} title={k} n={list.length}>
          <LeanList>{list.map(f => <FeedbackItem key={f.id} f={f} by={by} setFb={setFb} busy={busy} onRead={onRead} canEdit={d.can.edit} />)}</LeanList>
        </LeanSection>
      ))}
    </>
  )
}

// ---------------------------------------------------------------- inspections list
function InspectionsView({ d, onRead }: { d: Data; onRead: (t: string) => void }) {
  const [kind, setKind] = useState<Kind | 'all'>('all')
  const [q, setQ] = useState('')
  const rows = d.inspections.filter(r => (kind === 'all' || r.kind === kind) && (!q || [r.unit, r.subject_name, r.inspector].join(' ').toLowerCase().includes(q.toLowerCase())))
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <LeanPick<Kind | 'all'> value={kind} size="sm" onPick={setKind} options={[{ v: 'all', label: 'All' }, { v: 'hk_post_clean', label: 'HK post clean' }, { v: 'pm', label: 'PM' }, { v: 'arrival', label: 'Arrival' }]} />
        <label className="relative ml-auto">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Person or unit…" className="rounded-lg border border-line pl-7 pr-2 py-1 text-[12.5px] w-48 focus:outline-none focus:ring-2 focus:ring-brand-200" />
        </label>
      </div>
      {!rows.length ? <LeanEmpty>No inspections match.</LeanEmpty> : (
        <LeanList>
          {rows.map(r => (
            <li key={r.task_id} onClick={() => onRead(r.task_id)} className="flex items-center gap-2.5 px-3 sm:px-4 py-2 cursor-pointer hover:bg-app">
              <Tag tone={r.kind === 'hk_post_clean' ? 'brand' : r.kind === 'pm' ? 'sky' : 'violet'}>{KIND_NAME[r.kind]}</Tag>
              <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                <span className="text-[13.5px] font-semibold text-ink truncate max-w-[14rem]">{r.unit || '—'}</span>
                <span className="text-[12px] text-muted truncate">{[r.subject_name, day(r.finished_at), r.inspector ? `by ${r.inspector}` : null].filter(Boolean).join(' · ')}</span>
              </div>
              {r.score != null ? <Tag tone={scoreTone(r.score)}>{r.score}/5</Tag> : null}
              {r.pass_rate != null ? <Tag tone={passTone(r.pass_rate)}>{pct(r.pass_rate)}</Tag> : null}
              {r.misses ? <Tag tone="rose">{r.misses} ✗</Tag> : null}
            </li>
          ))}
        </LeanList>
      )}
    </>
  )
}

// ---------------------------------------------------------------- one person
function PersonSheet({ d, personKey, onClose, onRead, share, setFb, busy, say }: {
  d: Data; personKey: string; onClose: () => void; onRead: (t: string) => void; share: (r: ReportRow, via: 'whatsapp' | 'sms' | 'copy') => void
  setFb: (f: FeedbackRow, s: FbStatus, note?: string) => void; busy: string | null; say: (m: string) => void
}) {
  const p = d.board.find(x => x.key === personKey)
  const insp = d.inspections.filter(r => r.subject_key === personKey && r.kind === 'hk_post_clean')
  const fb = d.feedback.filter(f => f.person_key === personKey)
  const openFb = fb.filter(f => f.status !== 'resolved' && f.kind !== 'praise')
  const reports = d.reports.filter(r => r.person_key === personKey)
  const bySection = useMemo(() => {
    const m: Record<string, number> = {}
    for (const f of fb) if (f.kind === 'miss' && String(f.date || '') >= new Date(Date.now() - d.days * 86400000).toISOString()) m[f.section || 'Other'] = (m[f.section || 'Other'] || 0) + 1
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [fb, d.days])
  const learn = p?.learnCode ? origin() + '/learn/' + p.learnCode : null
  const stat = (label: string, v: ReactNode) => <div className="rounded-xl border border-line bg-white px-3 py-2"><p className="text-[10.5px] uppercase tracking-wider text-muted font-semibold">{label}</p><p className="text-[17px] font-bold text-ink tabular-nums">{v}</p></div>
  return (
    <Sheet open onClose={onClose} wide title={p?.name || personKey} subtitle={`Last ${d.days} days · HK Post Clean`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {stat('Score', p?.avgScore != null ? p.avgScore.toFixed(1) : '—')}
          {stat('Pass', pct(p?.avgPassRate))}
          {stat('Inspections', p?.inspections ?? 0)}
          {stat('Trend', <Trend delta={p?.delta ?? null} />)}
        </div>
        {bySection.length ? (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5">Misses by area</p>
            <div className="flex flex-wrap gap-1.5">{bySection.map(([s, n]) => <Tag key={s} tone="amber">{s} · {n}</Tag>)}</div>
          </div>
        ) : null}
        {reports.length ? (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5">Reports</p>
            <LeanList>
              {reports.map(r => (
                <LeanRow key={r.id} name={`${r.count} inspections · ${day(r.period_from)} – ${day(r.period_to)}`}
                  tags={<>{r.status === 'ready' ? <Tag tone="brand">ready</Tag> : r.viewed_at ? <Tag tone="emerald">opened</Tag> : <Tag tone="amber">sent · not opened</Tag>}<Tag tone={scoreTone(r.avgScore)}>{r.avgScore != null ? r.avgScore.toFixed(1) : '—'}</Tag></>}
                  actions={d.can.edit ? <ShareButtons r={r} share={share} compact /> : null} />
              ))}
            </LeanList>
          </div>
        ) : <p className="text-[12.5px] text-muted">{p ? `${p.pending % 5} of 5 inspections toward her next report.` : ''}</p>}
        {openFb.length ? (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5">Feedback to follow up · {openFb.length}</p>
            <LeanList>{openFb.map(f => <FeedbackItem key={f.id} f={f} by="person" setFb={setFb} busy={busy} onRead={onRead} canEdit={d.can.edit} />)}</LeanList>
          </div>
        ) : null}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5">Inspections · {insp.length}</p>
          <LeanList>
            {insp.map(r => (
              <li key={r.task_id} onClick={() => onRead(r.task_id)} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-app">
                <span className="flex-1 min-w-0 text-[13px] truncate"><b className="text-ink">{r.unit || '—'}</b> <span className="text-muted">· {day(r.finished_at)}</span></span>
                {r.misses ? <Tag tone="rose">{r.misses} ✗</Tag> : <Tag tone="emerald">✓</Tag>}
                <Tag tone={scoreTone(r.score)}>{r.score ?? '—'}</Tag>
              </li>
            ))}
          </LeanList>
        </div>
        {learn ? (
          <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
            <Link2 size={13} className="text-muted" /><span className="text-muted">Her training link</span>
            <button className="font-semibold text-brand-700 hover:underline" onClick={async () => { try { await navigator.clipboard.writeText(learn); say('Training link copied.') } catch { say(learn) } }}>Copy</button>
            <span className="text-muted">· {p?.lang === 'es' ? 'Español' : 'English'}</span>
          </div>
        ) : null}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------- the reader
type Line = { section: string; section_es?: string | null; text: string; text_es?: string | null; type: string; response: string | null; yn: 'yes' | 'no' | null; photos: number; photo_urls?: string[]; note?: string | null }
type Detail = {
  task_id: string; kind: Kind; unit: string | null; finished_at: string | null; inspector: string | null; subject_name: string | null; subject_source: string | null
  score: number | null; pass_rate: number | null; yes_count: number; no_count: number; clean_finished: boolean | null; fixed: string | null; coaching: string | null; notes: string | null
  readings: Record<string, number | null>; answered: number; total: number; photos: number; items: Line[]; link: string
  misses: { section: string; item_en: string; photos: string[] }[]
}
const READING_NAME: Record<string, string> = { lock_battery_pct: 'Lock battery %', vent_temp_f: 'Vent temp °F', wifi_mbps: 'Wi-Fi Mbps', guests: 'Guests' }

function ReaderSheet({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [x, setX] = useState<Detail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setX(null); setErr(null)
    fetch('/api/scoreboard/inspection?task=' + encodeURIComponent(taskId), { cache: 'no-store' }).then(r => r.json()).then(j => { if (!live) return; if (j.ok) setX(j.inspection); else setErr(j.error || 'Could not read it.') }).catch(e => live && setErr(String(e?.message || e)))
    return () => { live = false }
  }, [taskId])
  const sections = useMemo(() => {
    const m: { name: string; es: string | null; lines: Line[] }[] = []
    for (const l of x?.items || []) {
      let g = m.find(s => s.name === l.section)
      if (!g) { g = { name: l.section, es: l.section_es ?? null, lines: [] }; m.push(g) }
      g.lines.push(l)
    }
    return m
  }, [x])
  // Rows stored before 2026-11-06 carry photo URLs only on their misses — use those for the ✗ lines.
  const missPhotos = (l: Line): string[] => l.photo_urls && l.photo_urls.length ? l.photo_urls
    : l.yn === 'no' ? ((x?.misses || []).find(m => m.section === l.section && m.item_en === l.text)?.photos || []) : []
  return (
    <Sheet open onClose={onClose} wide title={x ? `${KIND_NAME[x.kind]} · ${x.unit || '—'}` : 'Inspection'} subtitle={x ? [when(x.finished_at), x.subject_name ? `about ${x.subject_name}` : null, x.inspector ? `by ${x.inspector}` : null].filter(Boolean).join(' · ') : undefined}>
      {err ? <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-[12.5px]">{err}</div> : null}
      {!x && !err ? <div className="flex items-center gap-2 text-muted text-[13px] py-8 justify-center"><Loader2 size={15} className="animate-spin" /> Loading…</div> : null}
      {x ? (
        <div className="space-y-4">
          <div className="flex items-center gap-1.5 flex-wrap">
            {x.score != null ? <Tag tone={scoreTone(x.score)}>score {x.score}/5</Tag> : null}
            {x.pass_rate != null ? <Tag tone={passTone(x.pass_rate)}>{pct(x.pass_rate)} pass</Tag> : null}
            <Tag tone="emerald">{x.yes_count} yes</Tag>
            <Tag tone={x.no_count ? 'rose' : 'slate'}>{x.no_count} no</Tag>
            <Tag>{x.answered}/{x.total} answered</Tag>
            {x.photos ? <Tag tone="sky">{x.photos} photos</Tag> : null}
            {x.clean_finished === false ? <Tag tone="amber" title="The clean was not finished when the inspection started">clean not finished</Tag> : null}
            <a href={x.link} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:underline">Breezeway task <ExternalLink size={12} /></a>
          </div>
          {Object.entries(x.readings || {}).some(([, v]) => v != null) ? (
            <div className="flex flex-wrap gap-1.5">{Object.entries(x.readings).filter(([, v]) => v != null).map(([k, v]) => <Tag key={k} tone="sky">{READING_NAME[k] || k}: {v}</Tag>)}</div>
          ) : null}
          {x.fixed || x.coaching || x.notes ? (
            <div className="grid sm:grid-cols-2 gap-2">
              {x.fixed ? <div className="rounded-xl border border-line bg-app px-3 py-2"><p className="text-[10.5px] uppercase tracking-wider text-muted font-semibold mb-0.5">What the inspector fixed</p><p className="text-[13px] whitespace-pre-wrap">{x.fixed}</p></div> : null}
              {x.coaching ? <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2"><p className="text-[10.5px] uppercase tracking-wider text-violet-700 font-semibold mb-0.5">Coaching for the housekeeper</p><p className="text-[13px] whitespace-pre-wrap">{x.coaching}</p></div> : null}
              {x.notes ? <div className="rounded-xl border border-line bg-white px-3 py-2 sm:col-span-2"><p className="text-[10.5px] uppercase tracking-wider text-muted font-semibold mb-0.5">Other notes</p><p className="text-[13px] whitespace-pre-wrap">{x.notes}</p></div> : null}
            </div>
          ) : null}
          {sections.map(s => {
            const yes = s.lines.filter(l => l.yn === 'yes').length, no = s.lines.filter(l => l.yn === 'no').length
            return (
              <section key={s.name}>
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5 px-1 flex items-center gap-2">{s.name || 'Checklist'}{s.es ? <span className="normal-case tracking-normal font-normal italic">{s.es}</span> : null}<span className="ml-auto normal-case tracking-normal font-medium tabular-nums">{yes ? `${yes} ✓` : ''}{no ? ` · ${no} ✗` : ''}</span></h3>
                <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70">
                  {s.lines.map((l, i) => (
                    <li key={i} className={`px-3 py-2 flex items-start gap-2.5 ${l.yn === 'no' ? 'bg-rose-50/50' : ''}`}>
                      <span className={`shrink-0 mt-0.5 w-6 h-6 rounded-md inline-flex items-center justify-center text-[11px] font-bold ${l.yn === 'yes' ? 'bg-emerald-100 text-emerald-700' : l.yn === 'no' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                        {l.yn === 'yes' ? <Check size={13} /> : l.yn === 'no' ? <X size={13} /> : l.type === 'rating' || l.type === 'count' ? (l.response || '—').slice(0, 3) : '·'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-ink">{l.text}</p>
                        {l.text_es ? <p className="text-[12px] text-muted italic">{l.text_es}</p> : null}
                        {l.response && !l.yn && l.type !== 'rating' && l.type !== 'count' ? <p className="text-[12.5px] text-ink/85 mt-0.5 whitespace-pre-wrap">“{l.response}”</p> : null}
                        {l.note ? <p className="text-[12px] text-amber-800 mt-0.5">Note: {l.note}</p> : null}
                        {missPhotos(l).length ? (
                          <div className="flex gap-1.5 flex-wrap mt-1.5">
                            {missPhotos(l).map((u, k) => (
                              <button key={k} type="button" onClick={() => setZoom(u)} className="w-16 h-16 rounded-lg overflow-hidden border border-line bg-app">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={u} alt="" loading="lazy" className="w-full h-full object-cover" />
                              </button>
                            ))}
                          </div>
                        ) : l.photos ? <p className="text-[11.5px] text-muted mt-0.5">{l.photos} photo{l.photos === 1 ? '' : 's'} in Breezeway</p> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      ) : null}
      {zoom ? (
        <button type="button" onClick={() => setZoom(null)} className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" className="max-w-full max-h-full rounded-xl" />
        </button>
      ) : null}
    </Sheet>
  )
}
