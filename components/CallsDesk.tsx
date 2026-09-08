'use client'
// THE CALLS DESK — a call center, not a list (Jon, 2026-09-08 evening).
//
// Five tabs. WELCOME is the daily sheet: MANDATORY calls first (luxury buildings, big bookings,
// recovery units), then the standard 48-hour calls. RECOVERY is the mandatory subset at units
// still waiting for a good review, grouped by arrival day. POST-CHECKOUT is the guest who just
// left a recovery unit. SCOREBOARD is the durable record — who called, what got done, what the
// nightly close-out marked incomplete. ALL ARRIVALS is the 14-day view with the closed-out rows
// badged Missed so a miss is seen, not deleted.
//
// Every row can be CLAIMED ("Take it") so two people never dial the same guest, and every call
// ends in an OUTCOME — Reached / Voicemail / No answer — so "called" means something specific.
// A No answer keeps the row on the sheet and counts the attempt; the close-out at midnight turns
// whatever is still open into an `incomplete` row with the attempts on it.
//
// The script panel is the one built earlier today: facts as chips, the must-dos in the only box,
// six steps, the building guide behind a toggle, notes last.
import { useEffect, useState } from 'react'
import { PhoneCall, Check, AlertTriangle, Loader2, ShieldAlert, Clock, Copy, StickyNote, ScrollText, ShieldCheck, MapPin, KeyRound, ChevronDown, CreditCard, CalendarDays, Globe, Car, Star, Wrench, HeartHandshake, PhoneOff, MessageSquareWarning, Crown, Gem, Hand, Voicemail, BarChart3, UserCheck } from 'lucide-react'
import { channelOf, channelPolicy, buildingGuideFor, QUESTIONS_UNIVERSAL } from '@/lib/welcome-call-guide'

type Recovery = { listingId: string; rating: number; channel: string; guest: string; content: string; at: string; openDays: number; reviewsSince: number }
type Glitch = { id: string; overview: string; status: string; at: string }
type Tier = 'recovery' | 'lux' | 'big' | 'standard'

type Row = {
  id: string; guest: string; guestId: string; listing: string; building: string; check_in: string
  phone: string; value: number; source: string; notes: string
  status: { paidFull: boolean; balance: number; currency: string; parking: number | null; addOns: { t: string; amt: number }[]; nights: number; checkOut: string }
  tier: Tier; mandatory: boolean
  done: boolean; outcome: string; attempts: number
  callValue: string; calledBy: string; calledAt: string
  claimedBy: string; claimedAt: string
  sensitive: boolean
  due: boolean; dueToday: boolean; lastChance: boolean; closed: boolean; incomplete: boolean
  prio: number
  recovery: Recovery | null
}
type OutRow = {
  id: string; guest: string; listing: string; building: string; check_in: string; check_out: string
  phone: string; value: number; source: string; nights: number; notes: string
  glitches: Glitch[]; recovery: Recovery | null; reasons: string[]
  done: boolean; outcome: string; attempts: number; calledBy: string; calledAt: string; callNote: string
  claimedBy: string; claimedAt: string
  closed: boolean; incomplete: boolean
}
type Kpis = {
  dueNow: number; dueToday: number; lastChance: number; mandatoryOpen: number; mandatoryDoneToday: number
  calledToday: number; pending: number
  coverage: number | null; coverageOf: number; coverageMissed: number; coverageShort: boolean
  recoveryUnits: number; recoveryCalls: number; postDue: number; closedOut: number; recoveryFailed: boolean
}

// Sort weight inside a day — lux first (Jon: "lux calls get priority"), then recovery, big, standard.
const TIER_RANK: Record<Tier, number> = { lux: 0, recovery: 1, big: 2, standard: 3 }
const TIER_META: Record<Tier, { label: string; Icon: any; cls: string }> = {
  recovery: { label: 'Recovery', Icon: HeartHandshake, cls: 'bg-rose-600 text-white' },
  lux: { label: 'Luxury', Icon: Crown, cls: 'bg-violet-600 text-white' },
  big: { label: 'Big booking', Icon: Gem, cls: 'bg-emerald-600 text-white' },
  standard: { label: 'Standard', Icon: PhoneCall, cls: 'bg-slate-100 text-slate-600' },
}
const REASON_META: Record<string, { label: string; Icon: any; cls: string }> = {
  glitch: { label: 'Issue during stay', Icon: Wrench, cls: 'bg-rose-100 text-rose-700' },
  recovery: { label: 'Unit in recovery', Icon: HeartHandshake, cls: 'bg-amber-100 text-amber-800' },
  direct: { label: 'Direct booking', Icon: Globe, cls: 'bg-indigo-100 text-indigo-700' },
  value: { label: 'High-value stay', Icon: Star, cls: 'bg-emerald-100 text-emerald-700' },
}

const money = (n: number) => n ? '$' + Math.round(n).toLocaleString() : ''
const who = (e: string) => e ? (e.split('@')[0] || e) : ''
const day = (iso: string) => { try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) } catch { return '' } }
const longDay = (ymd: string) => { try { return new Date(ymd + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) } catch { return ymd } }
const shortDay = (ymd: string) => { try { return new Date(ymd + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) } catch { return ymd } }
const Badge = ({ cls, Icon, children }: { cls: string; Icon?: any; children: any }) => (
  <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 ${cls}`}>{Icon ? <Icon size={10} /> : null}{children}</span>
)

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: 'rose' | 'emerald' | 'amber' | 'brand' }) {
  const v = tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-700' : tone === 'brand' ? 'text-brand-700' : 'text-ink'
  return (
    <div className="rounded-2xl border border-line bg-white px-3.5 py-3">
      <div className={`text-2xl font-bold tabular-nums leading-none ${v}`}>{value}</div>
      <div className="text-[10.5px] uppercase tracking-wider text-muted font-semibold mt-1.5">{label}</div>
      {sub && <div className="text-[11px] text-muted/80 mt-0.5">{sub}</div>}
    </div>
  )
}

function Chip({ Icon, children, tone }: { Icon: any; children: any; tone?: 'warn' | 'ok' }) {
  const cls = tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900' : tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-line bg-white text-muted'
  return <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] ${cls}`}><Icon size={11} className="shrink-0" />{children}</span>
}

/** One line on the card: the unit is in recovery. The review itself is behind the click (Jon:
 *  "only show the review if you click into it"). */
function RecoveryFlag({ rec }: { rec: Recovery }) {
  return (
    <div className="text-[12px] text-rose-800 inline-flex items-center gap-1.5 flex-wrap">
      <HeartHandshake size={13} className="shrink-0" />
      <b>Recovery</b> · last review {rec.rating.toFixed(1)}★{rec.channel ? ` on ${rec.channel}` : ''} {shortDay(rec.at)} · {rec.openDays} {rec.openDays === 1 ? 'day' : 'days'} without a good one
      <span className="text-rose-800/70">— open the script for what they said.</span>
    </div>
  )
}
/** Inside the script: what the last guest wrote, and what this call is for. */
function RecoveryNote({ rec, unit }: { rec: Recovery; unit: string }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5">
      <div className="font-bold text-rose-800 flex items-center gap-1.5 text-[12px]">
        <HeartHandshake size={13} /> The goal of this call is a good review at {unit}
      </div>
      <div className="mt-1 text-[11.5px] text-rose-900/90">
        Last review <b>{rec.rating.toFixed(1)}★</b>{rec.channel ? ` on ${rec.channel}` : ''}{rec.guest ? ` from ${rec.guest}` : ''} · {rec.openDays} {rec.openDays === 1 ? 'day' : 'days'} ago
        {rec.reviewsSince > 0 && <> · {rec.reviewsSince} review{rec.reviewsSince === 1 ? '' : 's'} since, none of them good</>}
      </div>
      {rec.content && <div className="mt-1.5 text-[11.5px] text-rose-900 italic border-l-2 border-rose-300 pl-2">&ldquo;{rec.content}&rdquo;</div>}
      <div className="mt-1.5 text-[11px] text-rose-800/80">Do not read the review to the guest. Use it to know what to check before they arrive, and to ask the right question on the call.</div>
    </div>
  )
}

function NoteBox({ id, prior, draft, setDraft, onSave, saving, saved, placeholder }: {
  id: string; prior: string; draft: Record<string, string>; setDraft: (f: (d: Record<string, string>) => Record<string, string>) => void
  onSave?: () => void; saving: boolean; saved: boolean; placeholder?: string
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-2.5">
      <div className="font-bold text-ink flex items-center gap-1.5 text-[12px]"><StickyNote size={13} /> Call notes → reservation</div>
      {prior && <div className="mt-1.5 text-[11px] text-muted whitespace-pre-wrap border-l-2 border-line pl-2 max-h-28 overflow-auto">{prior}</div>}
      <textarea value={draft[id] || ''} onChange={e => setDraft(d => ({ ...d, [id]: e.target.value }))} rows={2}
        placeholder={placeholder || 'Arrival time, who you spoke to, anything they asked for…'}
        className="mt-1.5 w-full rounded-lg border border-line px-2.5 py-2 text-[12px] text-ink focus:outline-none focus:border-brand-600" />
      {onSave && (
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          <button onClick={onSave} disabled={saving || !(draft[id] || '').trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40">{saving ? <Loader2 size={13} className="animate-spin" /> : <StickyNote size={13} />} Save note</button>
          {saved && <span className="text-[12px] text-emerald-700 inline-flex items-center gap-1"><Check size={12} /> Saved to Guesty</span>}
          <span className="text-[11px] text-muted/70">Internal only · adds your name + date</span>
        </div>
      )}
    </div>
  )
}

// ── THE SCRIPT PANEL (unchanged from this morning's rewrite) ─────────────────────────────────────
function WelcomeScript({ r, draft, setDraft, onSaveNote, saving, saved }: {
  r: Row; draft: Record<string, string>; setDraft: (f: (d: Record<string, string>) => Record<string, string>) => void
  onSaveNote: () => void; saving: boolean; saved: boolean
}) {
  const [showGuide, setShowGuide] = useState(false)
  const ch = channelOf(r.source)
  const pol = channelPolicy(ch)
  const bg = buildingGuideFor(r.listing)
  const musts = pol.checks.filter(c => c.tone === 'warn')
  return (
                <div className="rounded-xl border border-line bg-slate-50 p-3.5 text-[12.5px] space-y-3 leading-relaxed">
                  {/* 1. The facts, as one line of chips. */}
                  <div className="flex flex-wrap gap-1.5">
                    <Chip Icon={CalendarDays}>{r.status.nights} {r.status.nights === 1 ? 'night' : 'nights'}{r.status.checkOut ? ` · out ${shortDay(r.status.checkOut)}` : ''}</Chip>
                    <Chip Icon={CreditCard} tone={pol.merchantOfRecord || r.status.paidFull ? 'ok' : 'warn'}>
                      {pol.merchantOfRecord ? `Paid via ${ch}` : r.status.paidFull ? 'Paid in full' : `Balance ${money(r.status.balance)}`}
                    </Chip>
                    <Chip Icon={Car} tone={r.status.parking != null ? 'ok' : undefined}>
                      {r.status.parking != null ? `Parking booked ${money(r.status.parking)}` : 'No parking booked — ask'}
                    </Chip>
                    {r.status.addOns.map((a, i) => <Chip key={i} Icon={Star}>{a.t} {money(a.amt)}</Chip>)}
                  </div>

                  {/* 2. The only box: what this call MUST accomplish. Absent when there is nothing. */}
                  {musts.length > 0 ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                      <div className="font-bold text-amber-900 flex items-center gap-1.5"><ShieldCheck size={13} /> Must do on this call — {ch} booking</div>
                      <ul className="mt-1 space-y-0.5 text-amber-900">
                        {musts.map((c, i) => <li key={i} className="flex items-start gap-1.5"><span className="mt-px">•</span><span>{c.label}</span></li>)}
                      </ul>
                    </div>
                  ) : (
                    <div className="text-[12px] text-emerald-800 inline-flex items-start gap-1.5"><ShieldCheck size={13} className="mt-0.5 shrink-0" /> {ch} collects the payment and verifies the guest — nothing to chase on this one.</div>
                  )}

                  {/* 3. The call itself. */}
                  <div>
                    <div className="font-bold text-ink flex items-center gap-1.5"><PhoneCall size={13} /> The call</div>
                    <ol className="mt-1 list-decimal pl-5 space-y-1 text-muted marker:text-muted/60">
                      <li>&ldquo;Hi {r.guest || 'there'}, this is [you] with Stay Hospitality — calling ahead of your check-in {longDay(r.check_in)}. Is now a good time?&rdquo;</li>
                      {r.recovery
                        ? <li className="text-rose-800"><b>Set the tone:</b> &ldquo;I wanted to reach you personally before you arrive — we&rsquo;ve made some changes at this place recently and I want your stay to be right from the first minute.&rdquo; Then confirm the unit was checked for the issue above.</li>
                        : <li>Welcome them; say you want arrival to be smooth and you&rsquo;re there for questions.</li>}
                      {musts.length > 0 && <li className="text-amber-900"><b>Run the must-dos above.</b></li>}
                      <li>Confirm <b>arrival time</b> and <b>number of guests</b> against the booking.</li>
                      <li>Walk through access and parking{bg ? ` — ${bg.access} ${bg.parking}` : '.'}</li>
                      <li>Offer one or two local tips, then close: &ldquo;You&rsquo;ll get full check-in details before arrival — save this number and text anytime.&rdquo;</li>
                    </ol>
                  </div>

                  {/* 4. Questions, compact. */}
                  <div>
                    <div className="font-bold text-ink flex items-center gap-1.5"><MessageSquareWarning size={13} /> Ask</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted">
                      {[...QUESTIONS_UNIVERSAL, ...(bg ? bg.questions : [])].map((q, i) => <span key={i} className="before:content-['·'] before:mr-1.5 before:text-brand-600">{q}</span>)}
                    </div>
                  </div>

                  {/* 5. The building guide, for the caller who wants it — not for everyone, every call. */}
                  {bg ? (
                    <div>
                      <button onClick={() => setShowGuide(!showGuide)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-ink">
                        <MapPin size={12} /> {bg.name} — parking, access &amp; local tips <ChevronDown size={12} className={showGuide ? 'rotate-180 transition' : 'transition'} />
                      </button>
                      {showGuide && (
                        <div className="mt-1.5 grid sm:grid-cols-2 gap-x-4 gap-y-1 text-muted">
                          <div><b className="text-ink">Area:</b> {bg.area}</div>
                          <div className="flex items-start gap-1.5"><KeyRound size={12} className="mt-0.5 shrink-0" /><span><b className="text-ink">Access:</b> {bg.access}</span></div>
                          <div className="flex items-start gap-1.5"><Car size={12} className="mt-0.5 shrink-0" /><span><b className="text-ink">Parking:</b> {bg.parking}</span></div>
                          <div><b className="text-ink">Eat:</b> {bg.recs.food.join(', ')}</div>
                          <div><b className="text-ink">Coffee:</b> {bg.recs.coffee}</div>
                          <div><b className="text-ink">Grocery:</b> {bg.recs.grocery}</div>
                          <div><b className="text-ink">Beach:</b> {bg.recs.beach}</div>
                          <div className="text-brand-700 sm:col-span-2">{bg.recs.tip}</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-muted flex items-start gap-1.5"><MapPin size={13} className="mt-0.5 shrink-0" /><span>Building not matched — confirm the exact address, parking and access with the guest.</span></div>
                  )}

                  {/* 6. Notes last: this is what you fill in as you hang up. */}
                  <NoteBox id={r.id} prior={r.notes} draft={draft} setDraft={setDraft} onSave={onSaveNote} saving={saving} saved={saved} />
                </div>
  )
}

// ── OUTCOME ROW: how every call ends ────────────────────────────────────────────────────────────
function OutcomeRow({ busy, onReached, onVoicemail, onNoAnswer, attempts, compact }: {
  busy: boolean; onReached: () => void; onVoicemail: () => void; onNoAnswer: () => void; attempts: number; compact?: boolean
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button onClick={onReached} disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 text-white px-3.5 py-2 text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Reached</button>
      <button onClick={onVoicemail} disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-[12px] font-semibold text-ink hover:bg-app disabled:opacity-50"><Voicemail size={13} /> Left voicemail</button>
      <button onClick={onNoAnswer} disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-[12px] font-semibold text-muted hover:text-ink disabled:opacity-50"><PhoneOff size={13} /> No answer{attempts > 0 ? ` (${attempts} so far)` : ''}</button>
      {!compact && <span className="text-[11px] text-muted/70">Voicemail counts as called. No answer keeps it on the sheet.</span>}
    </div>
  )
}

export function CallsDesk({ rows: initial, outRows: initialOut, kpis: k0, today, me }: { rows: Row[]; outRows: OutRow[]; kpis: Kpis; today: string; me: string }) {
  const [rows, setRows] = useState<Row[]>(initial)
  const [outRows, setOutRows] = useState<OutRow[]>(initialOut)
  const [tab, setTab] = useState<'welcome' | 'recovery' | 'post' | 'board' | 'all'>('welcome')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [myName, setMyName] = useState<string>('')
  useEffect(() => { try { setMyName(window.localStorage.getItem('wc_caller_name') || who(me)) } catch { setMyName(who(me)) } }, [me])

  function askName(): string | null {
    const last = myName || who(me)
    const entered = window.prompt('Your name (who made this call)?', last)
    if (entered === null) return null
    const by = entered.trim() || last
    try { window.localStorage.setItem('wc_caller_name', by) } catch { /* ignore */ }
    setMyName(by)
    return by
  }

  // ── WELCOME CALL ACTIONS ──
  async function welcome(id: string, outcome: 'reached' | 'voicemail' | 'no_answer' | 'claim' | 'undo') {
    const row = rows.find(x => x.id === id); if (!row) return
    let by = myName || who(me)
    if (outcome !== 'undo' && outcome !== 'claim') { const n = askName(); if (n === null) return; by = n }
    if (outcome === 'claim' && !by) { const n = askName(); if (n === null) return; by = n }
    const note = (draft[id] || '').trim()
    setBusy(id); setError(null)
    try {
      const r = await fetch('/api/welcome-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: id, outcome, tier: row.tier, note, by }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed.')
      setRows(prev => prev.map(x => {
        if (x.id !== id) return x
        if (outcome === 'undo') return { ...x, done: false, outcome: '', calledBy: '', calledAt: '', claimedBy: '', claimedAt: '', callValue: '' }
        if (outcome === 'claim') return j.unchanged ? x : { ...x, claimedBy: j.by || by, claimedAt: j.at || new Date().toISOString(), outcome: 'in_progress' }
        if (outcome === 'no_answer') return j.unchanged ? x : { ...x, outcome: 'no_answer', attempts: j.attempts ?? (x.attempts + 1), claimedBy: '', calledBy: j.by || by, calledAt: '' }
        return { ...x, done: true, outcome, calledBy: j.by || by, calledAt: j.at || new Date().toISOString(), callValue: j.callValue || x.callValue, notes: j.notes || x.notes, claimedBy: '', attempts: j.attempts || (x.attempts + 1) }
      }))
      if (outcome !== 'claim') setDraft(d => ({ ...d, [id]: '' }))
    } catch (e: any) { setError(e.message || String(e)) } finally { setBusy(null) }
  }
  async function saveNote(id: string) {
    const note = (draft[id] || '').trim(); if (!note) return
    setSaving(id); setError(null)
    try {
      const r = await fetch('/api/welcome-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: id, noteOnly: true, note }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed to save note.')
      setRows(prev => prev.map(x => x.id === id ? { ...x, notes: j.notes || x.notes } : x))
      setDraft(d => ({ ...d, [id]: '' })); setSaved(id); setTimeout(() => setSaved(s => s === id ? null : s), 1800)
    } catch (e: any) { setError(e.message || String(e)) } finally { setSaving(null) }
  }

  // ── POST-CHECKOUT ACTIONS ──
  async function post(id: string, outcome: 'happy' | 'issue' | 'no_answer' | 'claim' | 'undo') {
    let by = myName || who(me)
    if (outcome !== 'undo') { const n = askName(); if (n === null) return; by = n }
    const note = (draft[id] || '').trim()
    setBusy(id); setError(null)
    try {
      const r = await fetch('/api/post-checkout-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(outcome === 'undo' ? { reservationId: id, undo: true } : { reservationId: id, outcome, note, by }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed to log the call.')
      setOutRows(prev => prev.map(x => {
        if (x.id !== id) return x
        if (outcome === 'undo') return { ...x, done: false, outcome: '', calledBy: '', calledAt: '', callNote: '', claimedBy: '' }
        if (outcome === 'claim') return j.unchanged ? x : { ...x, claimedBy: j.by || by, claimedAt: j.at || '', outcome: 'in_progress' }
        return { ...x, done: outcome !== 'no_answer', outcome, calledBy: j.by || by, calledAt: j.at || new Date().toISOString(), callNote: note, attempts: j.attempts ?? x.attempts, claimedBy: '' }
      }))
      if (outcome !== 'claim') setDraft(d => ({ ...d, [id]: '' }))
      if (j.noteSynced === false) setError('Call logged. The note could not be written to Guesty — add it there by hand if it matters.')
    } catch (e: any) { setError(e.message || String(e)) } finally { setBusy(null) }
  }
  async function copyPhone(id: string, phone: string) {
    try { await navigator.clipboard.writeText(phone); setCopied(id); setTimeout(() => setCopied(c => c === id ? null : c), 1500) } catch { /* ignore */ }
  }

  // Live counts follow the rows as you work them — the strip should move when you press a button.
  const open = rows.filter(r => !r.done && !r.closed)
  const isToday = (iso: string) => { try { return !!iso && new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) === today } catch { return false } }
  const kpis: Kpis = {
    ...k0,
    dueNow: open.filter(r => r.due).length,
    dueToday: open.filter(r => r.dueToday).length,
    lastChance: open.filter(r => r.lastChance).length,
    mandatoryOpen: open.filter(r => r.mandatory && r.due).length,
    mandatoryDoneToday: rows.filter(r => r.mandatory && r.done && isToday(r.calledAt)).length,
    calledToday: rows.filter(r => r.done && isToday(r.calledAt)).length + outRows.filter(r => r.done && isToday(r.calledAt)).length,
    recoveryCalls: open.filter(r => r.recovery).length,
    postDue: outRows.filter(r => !r.done && !r.closed).length,
    pending: open.length,
    closedOut: rows.filter(r => !r.done && r.closed).length + outRows.filter(r => !r.done && r.closed).length,
  }
  const duePending = open.filter(r => r.due)
  // Already in the unit with no call made: the missed-arrival list. Everyone else groups by day.
  const missedArrival = duePending.filter(r => r.check_in < today)
  const recoveryPending = open.filter(r => r.recovery)
  const sortRows = (xs: Row[]) => [...xs].sort((a, b) =>
    (Number(b.lastChance) - Number(a.lastChance)) || (Number(b.dueToday) - Number(a.dueToday)) ||
    (TIER_RANK[a.tier] - TIER_RANK[b.tier]) || (Number(!!b.recovery) - Number(!!a.recovery)) || (b.value - a.value) || a.check_in.localeCompare(b.check_in))
  const allSorted = [...rows].sort((a, b) => a.check_in.localeCompare(b.check_in) || (TIER_RANK[a.tier] - TIER_RANK[b.tier]) || (b.value - a.value))
  const shownOut = [...outRows].sort((a, b) => (Number(a.done) - Number(b.done)) || b.check_out.localeCompare(a.check_out))

  // Grouped by arrival day (Jon: "organized by the day of arrival"), mandatory first inside a day.
  const groupByDay = (xs: Row[]) => {
    const m = new Map<string, Row[]>()
    const ordered = [...xs].sort((a, b) => a.check_in.localeCompare(b.check_in) || (TIER_RANK[a.tier] - TIER_RANK[b.tier]) || (Number(!!b.recovery) - Number(!!a.recovery)) || (b.value - a.value))
    for (const r of ordered) { if (!m.has(r.check_in)) m.set(r.check_in, []); m.get(r.check_in)!.push(r) }
    return m
  }
  const welcomeByDay = groupByDay(duePending.filter(r => r.check_in >= today))
  const byDay = groupByDay(recoveryPending)
  const dayLabel = (d: string) => d === today ? 'Today' : d < today ? `Arrived ${shortDay(d)} — last chance` : d === nextDay(today) ? 'Tomorrow' : shortDay(d)

  const TABS = [
    { key: 'welcome' as const, label: 'Welcome calls', n: duePending.length },
    { key: 'recovery' as const, label: 'Recovery', n: recoveryPending.length },
    { key: 'post' as const, label: 'Post-checkout', n: kpis.postDue },
    { key: 'board' as const, label: 'Scoreboard', n: null as number | null },
    { key: 'all' as const, label: 'All arrivals', n: rows.length },
  ]

  return (
    <div className="space-y-4">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><PhoneCall size={13} /> Guest calls</p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Calls desk</h1>
        <p className="text-sm text-muted mt-1">Mandatory calls first — luxury buildings, big bookings, recovery units — then everyone arriving inside 48 hours. Calls not completed by end of day close out as incomplete, and the scoreboard keeps the record.</p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Kpi label="Mandatory open" value={kpis.mandatoryOpen} sub={kpis.mandatoryDoneToday ? `${kpis.mandatoryDoneToday} done today` : 'lux · big · recovery'} tone={kpis.mandatoryOpen ? 'rose' : 'emerald'} />
        <Kpi label="Due now" value={kpis.dueNow} sub={kpis.lastChance ? `${kpis.lastChance} close tonight` : kpis.dueToday ? `${kpis.dueToday} arriving today` : 'next 48 hours'} tone={kpis.lastChance ? 'rose' : kpis.dueNow ? 'amber' : undefined} />
        <Kpi label="Called today" value={kpis.calledToday} sub="welcome + post-checkout" tone={kpis.calledToday ? 'emerald' : undefined} />
        <Kpi label="Coverage" value={kpis.coverage == null ? '—' : kpis.coverage + '%'}
          sub={kpis.coverageShort ? 'arrivals read came back short' : kpis.coverageOf ? `${kpis.coverageMissed} missed of ${kpis.coverageOf}, last 7 days` : 'no arrivals yet'}
          tone={kpis.coverage != null && kpis.coverage >= 90 ? 'emerald' : kpis.coverage != null && kpis.coverage < 70 ? 'rose' : 'amber'} />
        <Kpi label="Recovery calls" value={kpis.recoveryFailed ? '—' : kpis.recoveryCalls}
          sub={kpis.recoveryFailed ? 'could not be worked out' : `${kpis.recoveryUnits} unit${kpis.recoveryUnits === 1 ? '' : 's'} awaiting a good review`}
          tone={kpis.recoveryFailed ? 'rose' : kpis.recoveryCalls ? 'amber' : undefined} />
        <Kpi label="Post-checkout" value={kpis.postDue} sub="leaving a recovery unit" tone={kpis.postDue ? 'brand' : undefined} />
      </div>

      <div className="lh-actions flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-xl border border-line overflow-hidden text-[13px]">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-2.5 sm:px-3.5 py-2 font-semibold border-l border-line first:border-l-0 inline-flex items-center gap-1.5 ${tab === t.key ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>
              {t.key === 'board' && <BarChart3 size={13} />}{t.label}{t.n != null ? ` (${t.n})` : ''}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-muted">{kpis.pending} open in the next 14 days{kpis.closedOut ? ` · ${kpis.closedOut} closed incomplete` : ''}{myName ? ` · you are ${myName}` : ''}</span>
      </div>

      {kpis.recoveryFailed && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>The review scan came back short, so recovery calls could not be worked out this load — this is <b>not</b> a sign that no unit is in recovery. Reload in a minute; if it keeps happening, say so. Luxury, big-booking and standard calls below are unaffected.</span>
        </div>
      )}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}

      {tab === 'board' && <Scoreboard />}

      {tab === 'post' && (
        <PostCheckoutList rows={shownOut} openId={openId} setOpenId={setOpenId} draft={draft} setDraft={setDraft}
          busy={busy} onAct={post} copied={copied} copyPhone={copyPhone} />
      )}

      {tab === 'welcome' && (
        duePending.length === 0 ? (
          <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted">Nothing due. Every mandatory call is made and nobody arrives in the next 48 hours without a call. Nice.</div>
        ) : (
          <div className="space-y-4">
            {/* MISSED ARRIVAL CALLS (Jon): the guest is already in the unit and nobody called ahead.
                Still callable — and still counts — until the end of the day after arrival, then it
                closes as incomplete. Its own section, on top, in red, because it is the one list
                that gets shorter only by someone picking up the phone right now. */}
            {missedArrival.length > 0 && (
              <section>
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-rose-700 mb-1.5 flex items-center gap-1.5"><PhoneOff size={12} /> Missed arrival calls — {missedArrival.length} · already arrived, call within 24 hours to keep the score</h2>
                <WelcomeList rows={sortRows(missedArrival)} {...{ openId, setOpenId, draft, setDraft, busy, copied, copyPhone, welcome, saveNote, saving, saved, myName }} />
              </section>
            )}
            {/* Then by day of arrival (Jon), mandatory calls first inside each day. */}
            {Array.from(welcomeByDay.entries()).map(([d, xs]) => {
              const m = xs.filter(r => r.mandatory).length
              return (
                <section key={d}>
                  <h2 className={`text-[11px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-2 ${d === today ? 'text-rose-700' : 'text-muted'}`}>
                    {dayLabel(d)} — {xs.length}{m ? <span className="normal-case tracking-normal font-semibold text-rose-700">· {m} mandatory</span> : null}
                  </h2>
                  <WelcomeList rows={xs} {...{ openId, setOpenId, draft, setDraft, busy, copied, copyPhone, welcome, saveNote, saving, saved, myName }} />
                </section>
              )
            })}
          </div>
        )
      )}

      {tab === 'recovery' && (
        byDay.size === 0 ? (
          <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted">
            {kpis.recoveryFailed ? 'Recovery could not be worked out on this load — see the note above.'
              : kpis.recoveryUnits ? `No arrivals booked at the ${kpis.recoveryUnits} unit${kpis.recoveryUnits === 1 ? '' : 's'} still waiting for a good review — nothing to call ahead of yet.`
              : 'No units are in recovery — every unit with a bad review has earned a good one since.'}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-[12px] text-muted">Mandatory welcome calls at units whose last low review has not been answered by a good one. Grouped by arrival day, luxury first. Open the script on a card to see what the last guest wrote and what to check before this one lands — the goal is a good review on the next arrival.</p>
            {Array.from(byDay.entries()).map(([d, xs]) => (
              <section key={d}>
                <h2 className={`text-[11px] font-bold uppercase tracking-wider mb-1.5 ${d <= today ? 'text-rose-700' : 'text-muted'}`}>{dayLabel(d)} — {xs.length}</h2>
                <WelcomeList rows={xs} {...{ openId, setOpenId, draft, setDraft, busy, copied, copyPhone, welcome, saveNote, saving, saved, myName }} />
              </section>
            ))}
          </div>
        )
      )}

      {tab === 'all' && (
        allSorted.length === 0
          ? <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted">No upcoming reservations.</div>
          : <WelcomeList rows={allSorted} {...{ openId, setOpenId, draft, setDraft, busy, copied, copyPhone, welcome, saveNote, saving, saved, myName }} />
      )}

      <p className="text-[11px] text-muted"><StickyNote size={11} className="inline" /> Reached and Voicemail write the <b>Welcome Call</b> field on the reservation in Guesty and append your note to the reservation notes. No answer, Take it and post-checkout outcomes are logged in Lighthouse (the post-checkout note goes to Guesty too). At midnight, anything still open past its day closes as incomplete.</p>
    </div>
  )
}

function nextDay(ymd: string) { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }

// ── ONE WELCOME-CALL CARD LIST ─────────────────────────────────────────────────────────────────
function WelcomeList({ rows, openId, setOpenId, draft, setDraft, busy, copied, copyPhone, welcome, saveNote, saving, saved, myName }: {
  rows: Row[]; openId: string | null; setOpenId: (v: string | null) => void
  draft: Record<string, string>; setDraft: (f: (d: Record<string, string>) => Record<string, string>) => void
  busy: string | null; copied: string | null; copyPhone: (id: string, p: string) => void
  welcome: (id: string, o: 'reached' | 'voicemail' | 'no_answer' | 'claim' | 'undo') => void
  saveNote: (id: string) => void; saving: string | null; saved: string | null; myName: string
}) {
  return (
    <ul className="rounded-2xl border border-line bg-white divide-y divide-line overflow-hidden">
      {rows.map(r => {
        const ch = channelOf(r.source)
        const open = openId === r.id
        const T = TIER_META[r.tier]
        const mine = !!r.claimedBy && myName && r.claimedBy.toLowerCase() === myName.toLowerCase()
        const rowBg = r.done ? '' : r.recovery ? 'bg-rose-50/50' : r.mandatory ? 'bg-brand-50/40' : ''
        return (
          <li key={r.id} className={`px-4 py-3 flex flex-col gap-3 ${rowBg}`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink inline-flex items-center gap-2 flex-wrap">
                  {r.guest || 'Guest'}
                  {r.value > 0 && <span className="text-[12px] font-bold text-emerald-700">{money(r.value)}</span>}
                  <Badge cls="bg-slate-100 text-slate-600">{ch}</Badge>
                  {r.mandatory && !r.done && <Badge cls={T.cls} Icon={T.Icon}>{T.label} · mandatory</Badge>}
                  {r.recovery && r.tier !== 'recovery' && !r.done && <Badge cls="bg-rose-600 text-white" Icon={HeartHandshake}>Bad review</Badge>}
                  {r.lastChance && !r.done && !r.closed && <Badge cls="bg-rose-700 text-white" Icon={Clock}>Last chance · closes tonight</Badge>}
                  {r.dueToday && !r.lastChance && !r.done && !r.closed && <Badge cls="bg-rose-600 text-white" Icon={Clock}>Today</Badge>}
                  {r.due && !r.dueToday && !r.done && !r.mandatory && !r.closed && <Badge cls="bg-rose-100 text-rose-700" Icon={Clock}>Due</Badge>}
                  {r.done && <Badge cls="bg-emerald-100 text-emerald-700" Icon={r.outcome === 'voicemail' ? Voicemail : Check}>{r.outcome === 'voicemail' ? 'Voicemail' : 'Reached'}</Badge>}
                  {!r.done && r.outcome === 'no_answer' && <Badge cls="bg-slate-200 text-slate-700" Icon={PhoneOff}>No answer ×{r.attempts}</Badge>}
                  {!r.done && r.claimedBy && <Badge cls={mine ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-800'} Icon={Hand}>{mine ? 'You have it' : `On it: ${r.claimedBy}`}</Badge>}
                  {(r.closed || r.incomplete) && !r.done && <Badge cls="bg-slate-200 text-slate-600" Icon={PhoneOff}>Incomplete · closed</Badge>}
                  {r.sensitive && <Badge cls="bg-rose-100 text-rose-700" Icon={ShieldAlert}>Sensitive</Badge>}
                </div>
                <div className="text-[12px] text-muted mt-0.5">{r.listing} · checks in {shortDay(r.check_in)}{r.status.nights ? ` · ${r.status.nights} night${r.status.nights === 1 ? '' : 's'}` : ''}</div>
                {r.done && (r.calledBy || r.callValue) && <div className="text-[11px] text-emerald-700 mt-0.5">{r.calledBy ? `${r.outcome === 'voicemail' ? 'Voicemail by' : 'Called by'} ${who(r.calledBy)}` : 'Called'}{r.calledAt ? ` · ${day(r.calledAt)}` : ''}{r.attempts > 1 ? ` · ${r.attempts} attempts` : ''}</div>}
                {!r.done && r.outcome === 'no_answer' && r.calledBy && <div className="text-[11px] text-muted mt-0.5">Last tried by {who(r.calledBy)}</div>}
                {r.phone ? (
                  <div className="text-[12px] mt-1 inline-flex items-center gap-2 flex-wrap">
                    <a href={`tel:${r.phone.replace(/[^+\d]/g, '')}`} title="Calls through the Talkroute desktop app" className="font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"><PhoneCall size={12} /> {r.phone}</a>
                    {copied === r.id ? <span className="text-emerald-700 inline-flex items-center gap-1"><Check size={11} /> Copied</span> : <button onClick={() => copyPhone(r.id, r.phone)} className="text-muted hover:text-ink inline-flex items-center gap-1"><Copy size={11} /> Copy</button>}
                  </div>
                ) : <div className="text-[11px] text-muted/70 mt-1">No phone on file</div>}
              </div>
              <div className="flex items-center gap-2 flex-wrap gap-y-2">
                <a href={`https://app.guesty.com/reservations/${r.id}/summary`} target="_blank" rel="noopener noreferrer" title="Open this reservation in Guesty" className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12px] font-semibold text-muted hover:text-ink"><Globe size={13} /> Guesty</a>
                <button onClick={() => setOpenId(open ? null : r.id)} className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[12px] font-semibold ${open ? 'border-brand-600 text-brand-700 bg-brand-50' : 'border-line text-muted hover:text-ink'}`}><ScrollText size={13} /> Script <ChevronDown size={12} className={open ? 'rotate-180 transition' : 'transition'} /></button>
                {r.closed && !r.done ? (
                  <span className="text-[12px] text-muted/70">Closed out &mdash; never completed</span>
                ) : r.done ? (
                  <button onClick={() => welcome(r.id, 'undo')} disabled={busy === r.id} className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink disabled:opacity-50">{busy === r.id ? <Loader2 size={13} className="animate-spin" /> : null} Undo</button>
                ) : (
                  <>
                    {!r.claimedBy && <button onClick={() => welcome(r.id, 'claim')} disabled={busy === r.id} title="Lock this call to you so nobody else dials the same guest" className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"><Hand size={13} /> Take it</button>}
                    <button onClick={() => welcome(r.id, 'reached')} disabled={busy === r.id} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-3.5 py-2 text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-50">{busy === r.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Reached</button>
                  </>
                )}
              </div>
            </div>

            {r.recovery && !r.done && <RecoveryFlag rec={r.recovery} />}

            {open && (
              <>
                {r.recovery && <RecoveryNote rec={r.recovery} unit={r.listing} />}
                <WelcomeScript r={r} draft={draft} setDraft={setDraft} onSaveNote={() => saveNote(r.id)} saving={saving === r.id} saved={saved === r.id} />
                {!r.done && !r.closed && (
                  <OutcomeRow busy={busy === r.id} attempts={r.attempts}
                    onReached={() => welcome(r.id, 'reached')} onVoicemail={() => welcome(r.id, 'voicemail')} onNoAnswer={() => welcome(r.id, 'no_answer')} />
                )}
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ── POST-CHECKOUT ───────────────────────────────────────────────────────────────────────────────
// Only guests leaving a RECOVERY unit (Jon). A different call with a different shape: one question
// asked well, and the answer decides whether a glitch gets raised before the review does.
function PostCheckoutList({ rows, openId, setOpenId, draft, setDraft, busy, onAct, copied, copyPhone }: {
  rows: OutRow[]; openId: string | null; setOpenId: (v: string | null) => void
  draft: Record<string, string>; setDraft: (f: (d: Record<string, string>) => Record<string, string>) => void
  busy: string | null; onAct: (id: string, o: 'happy' | 'issue' | 'no_answer' | 'claim' | 'undo') => void
  copied: string | null; copyPhone: (id: string, p: string) => void
}) {
  if (rows.length === 0) {
    return <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted">
      Nobody checked out of a recovery unit in the last 48 hours.
    </div>
  }
  return (
    <>
      <p className="text-[12px] text-muted">Guests who checked out of a unit still waiting for a good review, in the last 48 hours. Hear the complaint on the phone instead of reading it in a review — if they raise something, log it as an issue and it becomes a job. After 48 hours the call closes out.</p>
      <ul className="rounded-2xl border border-line bg-white divide-y divide-line overflow-hidden">
        {rows.map(r => {
          const open = openId === r.id
          return (
            <li key={r.id} className={`px-4 py-3 flex flex-col gap-3 ${!r.done && r.glitches.length ? 'bg-rose-50/40' : ''}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink inline-flex items-center gap-2 flex-wrap">
                    {r.guest || 'Guest'}
                    {r.value > 0 && <span className="text-[12px] font-bold text-emerald-700">{money(r.value)}</span>}
                    {r.reasons.map(k => { const m = REASON_META[k]; return m ? <Badge key={k} cls={m.cls} Icon={m.Icon}>{m.label}</Badge> : null })}
                    {r.done && <Badge cls="bg-emerald-100 text-emerald-700" Icon={Check}>{r.outcome === 'issue' ? 'Called · issue' : 'Called'}</Badge>}
                    {!r.done && r.outcome === 'no_answer' && <Badge cls="bg-slate-200 text-slate-700" Icon={PhoneOff}>No answer ×{r.attempts}</Badge>}
                    {!r.done && r.claimedBy && <Badge cls="bg-amber-100 text-amber-800" Icon={Hand}>On it: {r.claimedBy}</Badge>}
                    {(r.closed || r.incomplete) && !r.done && <Badge cls="bg-slate-200 text-slate-600" Icon={PhoneOff}>Incomplete · closed</Badge>}
                  </div>
                  <div className="text-[12px] text-muted mt-0.5">{r.listing} · {r.nights} {r.nights === 1 ? 'night' : 'nights'} · checked out {shortDay(r.check_out)}</div>
                  {(r.calledBy || r.callNote) && <div className="text-[11px] text-emerald-700 mt-0.5">{r.calledBy ? `${r.outcome === 'no_answer' ? 'Tried by' : 'Called by'} ${who(r.calledBy)}` : ''}{r.calledAt ? ` · ${day(r.calledAt)}` : ''}{r.callNote ? ` · ${r.callNote.slice(0, 60)}` : ''}</div>}
                  {r.phone ? (
                    <div className="text-[12px] mt-1 inline-flex items-center gap-2 flex-wrap">
                      <a href={`tel:${r.phone.replace(/[^+\d]/g, '')}`} className="font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"><PhoneCall size={12} /> {r.phone}</a>
                      {copied === r.id ? <span className="text-emerald-700 inline-flex items-center gap-1"><Check size={11} /> Copied</span> : <button onClick={() => copyPhone(r.id, r.phone)} className="text-muted hover:text-ink inline-flex items-center gap-1"><Copy size={11} /> Copy</button>}
                    </div>
                  ) : <div className="text-[11px] text-muted/70 mt-1">No phone on file</div>}
                </div>
                <div className="flex items-center gap-2 flex-wrap gap-y-2">
                  <a href={`https://app.guesty.com/reservations/${r.id}/summary`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12px] font-semibold text-muted hover:text-ink"><Globe size={13} /> Guesty</a>
                  <button onClick={() => setOpenId(open ? null : r.id)} className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[12px] font-semibold ${open ? 'border-brand-600 text-brand-700 bg-brand-50' : 'border-line text-muted hover:text-ink'}`}><ScrollText size={13} /> Call <ChevronDown size={12} className={open ? 'rotate-180 transition' : 'transition'} /></button>
                  {r.done ? <button onClick={() => onAct(r.id, 'undo')} disabled={busy === r.id} className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink disabled:opacity-50">{busy === r.id ? <Loader2 size={13} className="animate-spin" /> : null} Undo</button>
                    : (!r.closed && !r.claimedBy) ? <button onClick={() => onAct(r.id, 'claim')} disabled={busy === r.id} className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"><Hand size={13} /> Take it</button> : null}
                </div>
              </div>

              {r.glitches.length > 0 && !r.done && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-[12px]">
                  <div className="font-bold text-rose-800 flex items-center gap-1.5"><Wrench size={13} /> Logged during their stay</div>
                  <ul className="mt-1 space-y-0.5 text-rose-900">
                    {r.glitches.map(g => <li key={g.id}>· {shortDay(g.at)} — {g.overview || 'Issue'} <span className="text-rose-700/70">({g.status || 'open'})</span></li>)}
                  </ul>
                </div>
              )}
              {r.recovery && !r.done && <RecoveryFlag rec={r.recovery} />}

              {open && !r.closed && (
                <div className="rounded-xl border border-line bg-slate-50 p-3.5 text-[12.5px] space-y-3 leading-relaxed">
                  {r.recovery && <RecoveryNote rec={r.recovery} unit={r.listing} />}
                  <div>
                    <div className="font-bold text-ink flex items-center gap-1.5"><PhoneCall size={13} /> The call</div>
                    <ol className="mt-1 list-decimal pl-5 space-y-1 text-muted marker:text-muted/60">
                      <li>&ldquo;Hi {r.guest || 'there'}, this is [you] with Stay Hospitality — I saw you checked out {shortDay(r.check_out)} and wanted to thank you personally. Do you have a minute?&rdquo;</li>
                      {r.glitches.length > 0
                        ? <li className="text-rose-800"><b>Name it first:</b> &ldquo;I know {r.glitches[0].overview ? r.glitches[0].overview.toLowerCase() : 'something came up'} during your stay — I want to hear how that was handled from your side.&rdquo;</li>
                        : <li><b>The one question:</b> &ldquo;Was there anything about the place that wasn&rsquo;t right, even something small?&rdquo; Then wait — do not fill the silence.</li>}
                      <li>If they raise something: apologise once, say specifically what will be fixed, and <b>log it as an issue</b> below so it becomes a job.</li>
                      <li>If they were happy: &ldquo;That means a lot — if you have a moment, a review really helps us.&rdquo; Only ask for the review when they have said they were happy.</li>
                      <li>Close: &ldquo;Next time you&rsquo;re down, book with us directly and I&rsquo;ll take care of you.&rdquo;</li>
                    </ol>
                  </div>
                  <NoteBox id={r.id} prior={r.notes} draft={draft} setDraft={setDraft} saving={false} saved={false}
                    placeholder="What they said — saved to the reservation in Guesty when you pick an outcome below." />
                  {!r.done && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => onAct(r.id, 'happy')} disabled={busy === r.id} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 text-white px-3.5 py-2 text-[13px] font-semibold hover:bg-emerald-700 disabled:opacity-50">{busy === r.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} All good</button>
                      <button onClick={() => onAct(r.id, 'issue')} disabled={busy === r.id} className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 text-white px-3.5 py-2 text-[13px] font-semibold hover:bg-rose-700 disabled:opacity-50"><AlertTriangle size={14} /> They raised an issue</button>
                      <button onClick={() => onAct(r.id, 'no_answer')} disabled={busy === r.id} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12px] font-semibold text-muted hover:text-ink disabled:opacity-50"><PhoneOff size={13} /> No answer{r.attempts ? ` (${r.attempts} so far)` : ''}</button>
                      <a href="/glitches" className="text-[12px] font-semibold text-brand-600 hover:underline ml-auto">Log the issue →</a>
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

// ── SCOREBOARD ──────────────────────────────────────────────────────────────────────────────────
// Everything here comes from guest_calls — rows a person wrote by pressing a button, or the
// nightly close-out wrote by finding nothing pressed. Nothing is recomputed from bookings, so the
// numbers hold still. Mandatory completion leads: it is the one figure that says whether the desk
// is doing the job it exists for.
type Agg = { completed: number; late: number; incomplete: number; open: number; attempts: number; noAnswer: number; rate: number | null }
type Stats = {
  window: { from: string; to: string; days: number }
  totals: Agg; mandatory: Agg; byTier: Record<string, Agg>
  byDay: (Agg & { day: string })[]
  byCaller: (Agg & { name: string; email: string; reached: number; lastAt: string; reachRate: number | null })[]
  recentIncomplete: { id: string; kind: string; tier: string; guest: string; day: string; attempts: number; note: string }[]
  truncated: boolean
}
const TIER_ORDER = ['recovery', 'lux', 'big', 'standard', 'post_checkout']
const TIER_NAME: Record<string, string> = { recovery: 'Recovery', lux: 'Luxury', big: 'Big booking', standard: 'Standard', post_checkout: 'Post-checkout' }

function Scoreboard() {
  const [days, setDays] = useState<7 | 14 | 30>(14)
  const [s, setS] = useState<Stats | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    setS(null); setErr('')
    fetch(`/api/calls/stats?days=${days}`, { cache: 'no-store' }).then(r => r.json()).then(j => { if (!live) return; if (j?.error) setErr(j.error); else setS(j) }).catch(e => live && setErr(String(e)))
    return () => { live = false }
  }, [days])

  const pct = (n: number | null) => n == null ? '—' : n + '%'
  const tone = (n: number | null) => n == null ? '' : n >= 90 ? 'text-emerald-600' : n < 70 ? 'text-rose-600' : 'text-amber-700'
  const maxDay = s ? Math.max(1, ...s.byDay.map(d => d.completed + d.incomplete)) : 1

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[12px] text-muted">Completed vs closed-incomplete, by tier and by person. A call is only a verdict once it is done or the night has closed it — open calls are shown but not counted against anyone yet.</p>
        <div className="inline-flex rounded-xl border border-line overflow-hidden text-[12px]">
          {([7, 14, 30] as const).map(n => <button key={n} onClick={() => setDays(n)} className={`px-3 py-1.5 font-semibold border-l border-line first:border-l-0 ${days === n ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink'}`}>{n} days</button>)}
        </div>
      </div>
      {err && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700">{err}</div>}
      {!s && !err && <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted inline-flex items-center gap-2 w-full justify-center"><Loader2 size={14} className="animate-spin" /> Loading the record…</div>}
      {s && (
        <>
          {s.truncated && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-[12px] text-amber-800">The log read came back short — these numbers are a floor, not the total.</div>}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <div className="rounded-2xl border border-brand-200 bg-brand-50 px-3.5 py-3 col-span-2">
              <div className={`text-3xl font-bold tabular-nums leading-none ${tone(s.mandatory.rate) || 'text-brand-700'}`}>{pct(s.mandatory.rate)}</div>
              <div className="text-[10.5px] uppercase tracking-wider text-brand-700/80 font-semibold mt-1.5">Mandatory completion</div>
              <div className="text-[11px] text-brand-700/70 mt-0.5">{s.mandatory.completed} done{s.mandatory.late ? ` (${s.mandatory.late} after arrival)` : ''} · {s.mandatory.incomplete} closed incomplete · {s.mandatory.open} still open</div>
            </div>
            <Kpi label="All calls" value={pct(s.totals.rate)} sub={`${s.totals.completed} done · ${s.totals.incomplete} incomplete`} tone={s.totals.rate != null && s.totals.rate >= 90 ? 'emerald' : s.totals.rate != null && s.totals.rate < 70 ? 'rose' : 'amber'} />
            <Kpi label="Completed" value={s.totals.completed} sub={s.totals.late ? `${s.totals.late} made after the guest arrived` : `last ${s.window.days} days`} tone="emerald" />
            <Kpi label="Closed incomplete" value={s.totals.incomplete} sub="never completed by end of day" tone={s.totals.incomplete ? 'rose' : undefined} />
            <Kpi label="Attempts / call" value={s.totals.completed + s.totals.incomplete ? (s.totals.attempts / (s.totals.completed + s.totals.incomplete)).toFixed(1) : '—'} sub={`${s.totals.noAnswer} currently at no-answer`} />
          </div>

          {/* Day by day — completed stacked over incomplete, so a bad day reads as a red day. */}
          <div className="rounded-2xl border border-line bg-white p-3.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted mb-2">Day by day</div>
            <div className="flex items-end gap-1 h-24">
              {s.byDay.map(d => {
                const total = d.completed + d.incomplete
                const h = (n: number) => Math.round((n / maxDay) * 88)
                return (
                  <div key={d.day} className="flex-1 min-w-0 flex flex-col items-center justify-end gap-0.5" title={`${shortDay(d.day)}: ${d.completed} done, ${d.incomplete} incomplete${d.open ? `, ${d.open} open` : ''}`}>
                    <div className="w-full flex flex-col justify-end" style={{ height: 88 }}>
                      {d.incomplete > 0 && <div className="w-full bg-rose-400 rounded-t-sm" style={{ height: h(d.incomplete) }} />}
                      {d.completed > 0 && <div className={`w-full bg-emerald-500 ${d.incomplete ? '' : 'rounded-t-sm'}`} style={{ height: h(d.completed) }} />}
                      {total === 0 && <div className="w-full bg-slate-100 rounded-t-sm" style={{ height: 2 }} />}
                    </div>
                    <div className="text-[9px] text-muted tabular-nums">{d.day.slice(8, 10)}</div>
                  </div>
                )
              })}
            </div>
            <div className="mt-1.5 text-[11px] text-muted flex items-center gap-3"><span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> completed</span><span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-rose-400 inline-block" /> closed incomplete</span></div>
          </div>

          <div className="grid lg:grid-cols-2 gap-3">
            {/* By tier */}
            <div className="rounded-2xl border border-line bg-white overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-line text-[11px] font-bold uppercase tracking-wider text-muted">By tier</div>
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-[10.5px] uppercase tracking-wider text-muted"><th className="text-left px-3.5 py-2 font-semibold">Tier</th><th className="text-right px-2 py-2 font-semibold">Done</th><th className="text-right px-2 py-2 font-semibold">Late</th><th className="text-right px-2 py-2 font-semibold">Incomplete</th><th className="text-right px-2 py-2 font-semibold">Open</th><th className="text-right px-3.5 py-2 font-semibold">Rate</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {TIER_ORDER.filter(t => s.byTier[t]).map(t => { const a = s.byTier[t]; return (
                    <tr key={t}><td className="px-3.5 py-2 font-semibold text-ink">{TIER_NAME[t] || t}{t !== 'standard' && t !== 'post_checkout' ? <span className="ml-1.5 text-[10px] font-bold uppercase text-rose-600">mandatory</span> : null}</td><td className="text-right px-2 py-2 tabular-nums text-emerald-700">{a.completed}</td><td className="text-right px-2 py-2 tabular-nums text-amber-700">{a.late || '—'}</td><td className="text-right px-2 py-2 tabular-nums text-rose-700">{a.incomplete}</td><td className="text-right px-2 py-2 tabular-nums text-muted">{a.open}</td><td className={`text-right px-3.5 py-2 tabular-nums font-bold ${tone(a.rate)}`}>{pct(a.rate)}</td></tr>
                  )})}
                  {Object.keys(s.byTier).length === 0 && <tr><td colSpan={6} className="px-3.5 py-6 text-center text-muted">No calls logged in this window yet.</td></tr>}
                </tbody>
              </table>
            </div>

            {/* By person */}
            <div className="rounded-2xl border border-line bg-white overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-line text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-1.5"><UserCheck size={12} /> By person</div>
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-[10.5px] uppercase tracking-wider text-muted"><th className="text-left px-3.5 py-2 font-semibold">Caller</th><th className="text-right px-2 py-2 font-semibold">Done</th><th className="text-right px-2 py-2 font-semibold">Reached</th><th className="text-right px-2 py-2 font-semibold">Att/call</th><th className="text-right px-3.5 py-2 font-semibold">Last</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {s.byCaller.map(c => (
                    <tr key={c.email || c.name}><td className="px-3.5 py-2 font-semibold text-ink">{c.name}{c.open ? <span className="ml-1.5 text-[10px] text-amber-700">{c.open} open</span> : null}</td><td className="text-right px-2 py-2 tabular-nums text-emerald-700">{c.completed}</td><td className="text-right px-2 py-2 tabular-nums">{c.reachRate == null ? '—' : c.reachRate + '%'}</td><td className="text-right px-2 py-2 tabular-nums text-muted">{c.completed ? (c.attempts / Math.max(1, c.completed + c.incomplete)).toFixed(1) : '—'}</td><td className="text-right px-3.5 py-2 text-muted">{c.lastAt ? day(c.lastAt) : '—'}</td></tr>
                  ))}
                  {s.byCaller.length === 0 && <tr><td colSpan={5} className="px-3.5 py-6 text-center text-muted">Nobody has logged a call in this window.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {s.recentIncomplete.length > 0 && (
            <div className="rounded-2xl border border-line bg-white overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-line text-[11px] font-bold uppercase tracking-wider text-rose-700 flex items-center gap-1.5"><PhoneOff size={12} /> Closed incomplete — most recent</div>
              <ul className="divide-y divide-line text-[12.5px]">
                {s.recentIncomplete.map(r => (
                  <li key={r.kind + r.id} className="px-3.5 py-2 flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ink">{r.guest || 'Guest'}</span>
                    <Badge cls={r.tier === 'standard' ? 'bg-slate-100 text-slate-600' : r.tier === 'post_checkout' ? 'bg-indigo-100 text-indigo-700' : 'bg-rose-600 text-white'}>{TIER_NAME[r.tier] || r.tier}</Badge>
                    <span className="text-muted">{r.kind === 'post_checkout' ? 'checked out' : 'arrived'} {shortDay(r.day)}</span>
                    <span className="text-muted">· {r.attempts ? `${r.attempts} attempt${r.attempts === 1 ? '' : 's'}` : 'never tried'}</span>
                    {r.note && <span className="text-muted/80 truncate max-w-[40ch]">· {r.note}</span>}
                    <a href={`https://app.guesty.com/reservations/${r.id}/summary`} target="_blank" rel="noopener noreferrer" className="ml-auto text-[11.5px] font-semibold text-brand-600 hover:underline">Guesty</a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
