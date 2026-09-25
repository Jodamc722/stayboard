'use client'
// THE CALLS DESK — a call center, not a list (Jon, 2026-09-08 evening).
//
// Four tabs. WELCOME is the daily sheet — today and the next 72 hours, grouped by arrival day,
// MANDATORY calls first inside each day (luxury buildings, big bookings, recovery units). It is
// today- and future-focused (Jon, 2026-09-09): the arrival day is the last day a call counts, so no
// past arrival is ever a card here. POST-CHECKOUT is the guest who just left a recovery unit.
// SCOREBOARD is the durable record — who called, what got done, what the nightly close-out marked
// incomplete. ALL ARRIVALS is the 14-day view. The old RECOVERY tab (every future arrival at a
// unit waiting for a good review) moved to the Reviews page on 2026-09-09; recovery arrivals inside
// the 72-hour window are simply mandatory calls on the WELCOME sheet.
//
// Every row can be CLAIMED ("Take it") so two people never dial the same guest, and every call
// ends in an OUTCOME — Reached / Voicemail / No answer — so "called" means something specific.
// A No answer keeps the row on the sheet and counts the attempt; the close-out at midnight turns
// whatever is still open into an `incomplete` row with the attempts on it.
//
// The script panel is the one built earlier today: facts as chips, the must-dos in the only box,
// six steps, the building guide behind a toggle, notes last.
import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, PhoneCall, Check, AlertTriangle, Loader2, ShieldAlert, Clock, Copy, StickyNote, ScrollText, ShieldCheck, MapPin, KeyRound, ChevronDown, CreditCard, CalendarDays, Globe, Car, Star, Wrench, HeartHandshake, PhoneOff, MessageSquareWarning, Crown, Gem, Hand, Voicemail, BarChart3, UserCheck, FileText, X } from 'lucide-react'
import { channelOf, channelPolicy, buildingGuideFor, QUESTIONS_UNIVERSAL } from '@/lib/welcome-call-guide'
import { IconBtn, Tip } from '@/components/lean'
import { StayPanel } from '@/components/StayPanel'

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
  proof: Proof
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
  proof: Proof
  closed: boolean; incomplete: boolean
}
// TALKROUTE (2026-09-21). What the phone system last saw for this call: the source of the outcome
// ('talkroute' when the call record proved it, 'manual' / '' when a person pressed a button), the
// last attempt and its result, and how long the guest actually talked.
type Proof = {
  source: string; lastAttemptAt: string; lastResult: string; talkSeconds: number
  note: string; promised: string[]; issues: string[]; sentiment: string; callId: string; noteBy: string
}
function talkMins(sec: number) { return sec >= 60 ? `${Math.round(sec / 60)} min` : `${sec}s` }
/**
 * WHAT WAS SAID (2026-09-21, Jon: "in the call on call desk i should be able to see record notes").
 * The note written from the recording, on the card. Promises first when there are any — the caller
 * needs to know what we already owe this guest before dialling them again.
 */
function CallNote({ p }: { p: Proof }) {
  if (!p.note) return null
  const tone = p.sentiment === 'unhappy' ? 'border-rose-200 bg-rose-50/60' : p.sentiment === 'happy' ? 'border-emerald-200 bg-emerald-50/50' : 'border-line bg-app/50'
  return (
    <div className={`mt-1.5 rounded-xl border px-2.5 py-2 ${tone}`}>
      <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted flex items-center justify-between gap-2 mb-0.5">
        <span className="inline-flex items-center gap-1"><FileText size={10} /> From the call{p.noteBy ? ` · ${p.noteBy}` : ''}</span>
        {p.callId && <a href={`/welcome-calls/call/${p.callId}`} className="normal-case tracking-normal text-brand-600 hover:underline font-semibold">Full transcript →</a>}
      </div>
      <div className="text-[12.5px] text-ink">{p.note}</div>
      {p.promised.length > 0 && <div className="text-[11.5px] text-brand-700 mt-1"><b>We promised:</b> {p.promised.join(' · ')}</div>}
      {p.issues.length > 0 && <div className="text-[11.5px] text-rose-700 mt-0.5"><b>Flagged:</b> {p.issues.join(' · ')}</div>}
    </div>
  )
}

function ProofLine({ p, done, kind }: { p: Proof; done: boolean; kind: 'welcome' | 'post' }) {
  if (!p.lastAttemptAt) return null
  const res = p.lastResult
  const when = day(p.lastAttemptAt)
  if (res === 'answered') {
    return (
      <div className={`text-[11px] mt-0.5 inline-flex items-center gap-1 ${done ? 'text-emerald-700' : 'text-brand-700'}`}>
        <PhoneCall size={11} /> Talkroute: answered · {talkMins(p.talkSeconds)} · {when}
        {!done && kind === 'post' && <span className="text-ink font-semibold"> — what did they say? Pick an outcome below.</span>}
      </div>
    )
  }
  return <div className="text-[11px] text-muted mt-0.5 inline-flex items-center gap-1"><PhoneOff size={11} /> Talkroute: {res === 'missed' ? 'no answer' : res || 'no answer'} · {when}</div>
}
type Kpis = {
  dueNow: number; dueToday: number; lastChance: number; mandatoryOpen: number; mandatoryDoneToday: number
  calledToday: number; pending: number
  coverage: number | null; coverageOf: number; coverageMissed: number; coverageShort: boolean
  recoveryUnits: number; recoveryCalls: number; postDue: number; closedOut: number; recoveryFailed: boolean
}

// Sort weight inside a day — lux first (Jon: "lux calls get priority"), then recovery, big, standard.
const TIER_RANK: Record<Tier, number> = { lux: 0, recovery: 1, big: 2, standard: 3 }

const money = (n: number) => n ? '$' + Math.round(n).toLocaleString() : ''
const who = (e: string) => e ? (e.split('@')[0] || e) : ''
/**
 * The reply, or a sentence a caller can act on.
 *
 * A route that runs past its limit is answered by the platform with an HTML gateway page, not JSON.
 * `await r.json()` then throws a SyntaxError, and what reached the screen was "Unexpected token '<'"
 * — from a button the caller had just watched spin. Silvia, 2026-09-17: "it just sits there thinking
 * for a moment and doesn't update."
 *
 * So: read the body once as text, parse it only if it is JSON, and otherwise say what happened and
 * whether it is safe to press again.
 */
async function readReply(r: Response): Promise<any> {
  const text = await r.text().catch(() => '')
  try { return text ? JSON.parse(text) : {} } catch { /* not JSON — below */ }
  if (r.status === 504 || r.status === 502 || r.status === 408) {
    throw new Error('Guesty took too long to answer, so nothing was saved. Press it again in a moment — this cannot double-record a call.')
  }
  throw new Error(`The server answered ${r.status} instead of a result, so nothing was saved. Press it again in a moment.`)
}

const day = (iso: string) => { try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) } catch { return '' } }
const longDay = (ymd: string) => { try { return new Date(ymd + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) } catch { return ymd } }
const shortDay = (ymd: string) => { try { return new Date(ymd + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) } catch { return ymd } }
const Badge = ({ cls, Icon, children }: { cls: string; Icon?: any; children: any }) => (
  <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 ${cls}`}>{Icon ? <Icon size={10} /> : null}{children}</span>
)

type DayStat = { day: string; mandatory: { completed: number; incomplete: number; open: number; rate: number | null }; other: { completed: number; incomplete: number; open: number; rate: number | null } }
/**
 * Today's two scores, big, then the last seven days in a strip. MANDATORY reads against 100% —
 * anything less is red, because a mandatory call not made is the whole point of the list. OTHER
 * reads as completed-of-due. Past days come from guest_calls (the durable log); today comes from
 * the live rows so the numbers move as buttons are pressed.
 */
function DayScore({ today, mandatoryDone, mandatoryOpen, otherDone, otherOpen, chips }: { today: string; mandatoryDone: number; mandatoryOpen: number; otherDone: number; otherOpen: number; chips: string[] }) {
  const [days, setDays] = useState<DayStat[]>([])
  useEffect(() => {
    let live = true
    fetch('/api/calls/stats?days=8', { cache: 'no-store' }).then(r => r.json()).then(j => { if (live && Array.isArray(j?.byDay)) setDays(j.byDay) }).catch(() => {})
    return () => { live = false }
  }, [today])
  const mTot = mandatoryDone + mandatoryOpen, oTot = otherDone + otherOpen
  const mPct = mTot ? Math.round((mandatoryDone / mTot) * 100) : 100
  const oPct = oTot ? Math.round((otherDone / oTot) * 100) : 100
  const past = days.filter(d => d.day < today).slice(-7)
  const pct = (a: { completed: number; incomplete: number; open: number }) => { const t = a.completed + a.incomplete + a.open; return t ? Math.round((a.completed / t) * 100) : null }
  const mTone = (p: number | null) => p == null ? 'text-muted' : p === 100 ? 'text-emerald-700' : 'text-rose-600'
  const oTone = (p: number | null) => p == null ? 'text-muted' : p >= 90 ? 'text-emerald-700' : p >= 70 ? 'text-amber-700' : 'text-rose-600'
  const wd = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
  return (
    <section className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-line">
        <div className="px-5 py-4">
          <div className="text-[11px] uppercase tracking-wider text-muted font-semibold inline-flex items-center gap-1.5"><Crown size={12} className="text-brand-600" /> Mandatory calls today <span className="normal-case tracking-normal font-medium">· must be 100%</span></div>
          <div className="flex items-baseline gap-3 mt-1.5">
            <span className={`text-4xl font-bold tabular-nums leading-none ${mTot ? (mPct === 100 ? 'text-emerald-600' : 'text-rose-600') : 'text-ink'}`}>{mandatoryDone}<span className="text-2xl text-muted font-semibold"> / {mTot}</span></span>
            <span className={`text-sm font-bold ${mTot ? (mPct === 100 ? 'text-emerald-700' : 'text-rose-600') : 'text-muted'}`}>{mTot ? mPct + '%' : 'none due'}{mTot && mPct === 100 ? ' ✓' : ''}</span>
          </div>
          <div className="text-[12px] text-muted mt-1.5">must call · unit recovery{mandatoryOpen ? <span className="text-rose-600 font-semibold"> · {mandatoryOpen} still to call</span> : ''}</div>
        </div>
        <div className="px-5 py-4">
          <div className="text-[11px] uppercase tracking-wider text-muted font-semibold inline-flex items-center gap-1.5"><PhoneCall size={12} className="text-brand-600" /> Other calls today <span className="normal-case tracking-normal font-medium">· completed</span></div>
          <div className="flex items-baseline gap-3 mt-1.5">
            <span className={`text-4xl font-bold tabular-nums leading-none ${oTot ? (oPct >= 90 ? 'text-emerald-600' : oPct >= 70 ? 'text-amber-700' : 'text-rose-600') : 'text-ink'}`}>{otherDone}<span className="text-2xl text-muted font-semibold"> / {oTot}</span></span>
            <span className={`text-sm font-bold ${oTot ? oTone(oPct) : 'text-muted'}`}>{oTot ? oPct + '%' : 'none due'}</span>
          </div>
          <div className="text-[12px] text-muted mt-1.5">welcome calls due in 72 hours · post-checkout{otherOpen ? ` · ${otherOpen} open` : ''}</div>
        </div>
      </div>
      {/* By day: same two scores for each of the last seven days, so a good week and a bad week look different. */}
      <div className="border-t border-line px-3 py-2.5 overflow-x-auto">
        <div className="flex items-stretch gap-1.5 min-w-max">
          <div className="flex flex-col justify-center pr-2 text-[10px] uppercase tracking-wide text-muted font-semibold leading-tight"><span>Mand.</span><span className="mt-2">Other</span></div>
          {past.map(d => { const mp = pct(d.mandatory), op = pct(d.other); const mt = d.mandatory.completed + d.mandatory.incomplete + d.mandatory.open; const ot = d.other.completed + d.other.incomplete + d.other.open; return (
            <div key={d.day} className="w-[62px] rounded-lg border border-line px-1.5 py-1 text-center">
              <div className="text-[10px] font-semibold text-muted">{wd(d.day)} <span className="font-normal">{d.day.slice(8)}</span></div>
              <div className={`text-[12px] font-bold tabular-nums ${mTone(mp)}`}>{mt ? `${d.mandatory.completed}/${mt}` : '—'}</div>
              <div className={`text-[12px] font-bold tabular-nums ${oTone(op)}`}>{ot ? `${d.other.completed}/${ot}` : '—'}</div>
            </div>
          )})}
          <div className="w-[62px] rounded-lg border-2 border-brand-500 bg-brand-50 px-1.5 py-1 text-center">
            <div className="text-[10px] font-bold text-brand-800">Today</div>
            <div className={`text-[12px] font-bold tabular-nums ${mTot ? mTone(mPct) : 'text-muted'}`}>{mTot ? `${mandatoryDone}/${mTot}` : '—'}</div>
            <div className={`text-[12px] font-bold tabular-nums ${oTot ? oTone(oPct) : 'text-muted'}`}>{oTot ? `${otherDone}/${oTot}` : '—'}</div>
          </div>
        </div>
      </div>
      {chips.length > 0 && <div className="border-t border-line px-4 py-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">{chips.map((c, i) => <span key={i}>{c}</span>)}</div>}
    </section>
  )
}

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


export function CallsDesk({ rows: initial, outRows: initialOut, kpis: k0, today, date: date0, me, meName = '', talkroute = false }: { rows: Row[]; outRows: OutRow[]; kpis: Kpis; today: string; date?: string; me: string; meName?: string; talkroute?: boolean; callers?: string[] }) {
  const [rows, setRows] = useState<Row[]>(initial)
  const [outRows, setOutRows] = useState<OutRow[]>(initialOut)
  const [tab, setTab] = useState<'welcome' | 'post' | 'done' | 'board' | 'all'>('welcome')
  // BY DATE (team ask, 2026-09-25): "by default show today's check-ins for welcome calls and
  // today's checkouts for follow-up calls, with the option to change the date." `date` is the day
  // the desk is pointed at; DAY shows only that day, 72H is the old rolling sheet.
  const date = date0 || today
  const [mode, setMode] = useState<'day' | 'window'>('day')
  const goDate = (d: string) => { if (d && d !== date) router.push(d === today ? '/welcome-calls' : '/welcome-calls?date=' + d) }
  const shiftDate = (n: number) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); goDate(d.toISOString().slice(0, 10)) }
  const dateLabel = date === today ? 'Today' : new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // WHICH row failed. The banner lives at the top of a list that runs to seventy rows, so a caller
  // working row forty watched the button spin, stop, and change nothing — the explanation was a
  // screen and a half away. The message now also appears against the row it belongs to.
  const [failedId, setFailedId] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  // Who is pressing the buttons is whoever is signed in (Jon, 2026-09-22) — the server credits the
  // call to that account; this copy is only for "You have it" and the note strip.
  const myName = meName || who(me)
  // THE NOTE AFTER A MARK (Jon, 2026-09-22: "if you mark it should show or allow you to add notes").
  // A marked welcome call leaves the To-call list at once, so the note box cannot live on its row —
  // it sits at the top of the list, names the guest, and writes to Guesty on Save.
  const [noteAfter, setNoteAfter] = useState<{ id: string; guest: string; label: string } | null>(null)

  // ── REFRESH (Jon, 2026-09-23: "also need a refresh button on call desk, new reservation came in").
  // The desk is a server-rendered page off the Guesty mirror, so a booking made ten minutes ago is
  // not on it until the cron next runs. This pulls Guesty first and only then reloads — a reload
  // alone would re-render the same stale mirror and look broken.
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  async function refreshDesk() {
    if (syncing) return
    setSyncing(true); setSyncMsg(null); setError(null)
    try {
      const r = await fetch('/api/calls/refresh', { method: 'POST' })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || 'Could not reach Guesty.')
      setSyncMsg(j.reservations ? j.reservations + ' booking' + (j.reservations === 1 ? '' : 's') + ' pulled' : 'Up to date')
      router.refresh()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMsg(null), 6000)
    }
  }

  // ── WELCOME CALL ACTIONS ──
  async function welcome(id: string, outcome: 'reached' | 'voicemail' | 'no_answer' | 'claim' | 'undo') {
    const row = rows.find(x => x.id === id); if (!row) return
    const by = myName
    const note = (draft[id] || '').trim()
    setBusy(id); setError(null); setFailedId(null)
    try {
      const r = await fetch('/api/welcome-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: id, outcome, tier: row.tier, note, by }) })
      const j = await readReply(r); if (!r.ok) throw new Error(j?.error || 'Failed.')
      setRows(prev => prev.map(x => {
        if (x.id !== id) return x
        if (outcome === 'undo') return { ...x, done: false, outcome: '', calledBy: '', calledAt: '', claimedBy: '', claimedAt: '', callValue: '' }
        if (outcome === 'claim') return j.unchanged ? x : { ...x, claimedBy: j.by || by, claimedAt: j.at || new Date().toISOString(), outcome: 'in_progress' }
        if (outcome === 'no_answer') return j.unchanged ? x : { ...x, outcome: 'no_answer', attempts: j.attempts ?? (x.attempts + 1), claimedBy: '', calledBy: j.by || by, calledAt: '' }
        return { ...x, done: true, outcome, calledBy: j.by || by, calledAt: j.at || new Date().toISOString(), callValue: j.callValue || x.callValue, notes: j.notes || x.notes, claimedBy: '', attempts: j.attempts || (x.attempts + 1) }
      }))
      if (outcome !== 'claim') setDraft(d => ({ ...d, [id]: '' }))
      if (outcome === 'reached' || outcome === 'voicemail' || outcome === 'no_answer') {
        setNoteAfter({ id, guest: row.guest || 'Guest', label: outcome === 'reached' ? 'Reached' : outcome === 'voicemail' ? 'Voicemail left' : 'No answer' })
      }
    } catch (e: any) { setError(e.message || String(e)); setFailedId(id) } finally { setBusy(null) }
  }
  async function saveNote(id: string) {
    const note = (draft[id] || '').trim(); if (!note) return
    setSaving(id); setError(null); setFailedId(null)
    try {
      const r = await fetch('/api/welcome-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: id, noteOnly: true, note }) })
      const j = await readReply(r); if (!r.ok) throw new Error(j?.error || 'Failed to save note.')
      setRows(prev => prev.map(x => x.id === id ? { ...x, notes: j.notes || x.notes } : x))
      setDraft(d => ({ ...d, [id]: '' })); setSaved(id); setTimeout(() => setSaved(s => s === id ? null : s), 1800)
      setNoteAfter(n => n && n.id === id ? null : n)
    } catch (e: any) { setError(e.message || String(e)); setFailedId(id) } finally { setSaving(null) }
  }

  // ── POST-CHECKOUT ACTIONS ──
  async function post(id: string, outcome: 'happy' | 'issue' | 'no_answer' | 'claim' | 'undo') {
    const by = myName
    const note = (draft[id] || '').trim()
    setBusy(id); setError(null); setFailedId(null)
    try {
      const r = await fetch('/api/post-checkout-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(outcome === 'undo' ? { reservationId: id, undo: true } : { reservationId: id, outcome, note, by }) })
      const j = await readReply(r); if (!r.ok) throw new Error(j?.error || 'Failed to log the call.')
      setOutRows(prev => prev.map(x => {
        if (x.id !== id) return x
        if (outcome === 'undo') return { ...x, done: false, outcome: '', calledBy: '', calledAt: '', callNote: '', claimedBy: '' }
        if (outcome === 'claim') return j.unchanged ? x : { ...x, claimedBy: j.by || by, claimedAt: j.at || '', outcome: 'in_progress' }
        return { ...x, done: outcome !== 'no_answer', outcome, calledBy: j.by || by, calledAt: j.at || new Date().toISOString(), callNote: note, attempts: j.attempts ?? x.attempts, claimedBy: '' }
      }))
      if (outcome !== 'claim') setDraft(d => ({ ...d, [id]: '' }))
      if (outcome === 'happy' || outcome === 'issue' || outcome === 'no_answer') {
        const g = outRows.find(x => x.id === id)
        setNoteAfter({ id, guest: (g && g.guest) || 'Guest', label: outcome === 'happy' ? 'All good' : outcome === 'issue' ? 'Issue raised' : 'No answer' })
      }
      if (j.noteSynced === false) setError('Call logged. The note could not be written to Guesty — add it there by hand if it matters.')
    } catch (e: any) { setError(e.message || String(e)); setFailedId(id) } finally { setBusy(null) }
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
  // Today forward only (Jon: "today focused and future focused"). Yesterday's misses are on the scoreboard.
  // Jon, 2026-09-25: the 14-day view is a worklist, not a guest list — only calls still to make.
  const allSorted = rows.filter(r => r.check_in >= today && !r.done && !r.closed).sort((a, b) => a.check_in.localeCompare(b.check_in) || (TIER_RANK[a.tier] - TIER_RANK[b.tier]) || (b.value - a.value))
  const shownOut = [...outRows].filter(r => mode === 'window' || r.check_out === date).sort((a, b) => (Number(a.done) - Number(b.done)) || b.check_out.localeCompare(a.check_out))

  // By arrival day, then lux > recovery > big > standard, then value (Jon: "organized by the day of arrival").
  const byArrival = (xs: Row[]) => [...xs].sort((a, b) => a.check_in.localeCompare(b.check_in) || (TIER_RANK[a.tier] - TIER_RANK[b.tier]) || (Number(!!b.recovery) - Number(!!a.recovery)) || (b.value - a.value))

  // THREE LANES, NOT ONE LIST (Jon, 2026-09-15: "make it more clear what calls need to be done. I
  // would organize it by mandatory calls, unit recovery calls, and welcome calls").
  //
  // The lanes answer WHY a call exists, because that is what decides whether it can be skipped:
  //   MUST CALL     — a luxury unit, or a big booking. 100% or the day is a miss.
  //   UNIT RECOVERY — the unit is carrying a bad public review and is trying to bury it. Also 100%,
  //                   but it is a different job with a different script, so it gets its own lane.
  //   WELCOME       — everyone else. Worth doing, and not a failure if the day runs out.
  //
  // The lanes are a strict PARTITION — every card sits in exactly one, so the counts add up and the
  // desk can trust them. A luxury stay that is ALSO in a recovering unit stays in Must call (Jon:
  // "lux calls get priority") and keeps its recovery badge, and the recovery lane says how many of
  // its units are being handled up there, so the recovery total is never quietly understated.
  const laneOf = (r: Row) => r.tier === 'recovery' ? 'recovery' : (r.mandatory ? 'must' : 'welcome')
  // DAY mode: everyone arriving on the chosen day who has not been called (a past day shows what
  // closed incomplete; a far day shows who is coming). WINDOW mode: the rolling 72-hour sheet.
  const due = mode === 'day' ? rows.filter(r => r.check_in === date && !r.done) : duePending.filter(r => r.check_in >= today)
  const dayDone = mode === 'day' ? rows.filter(r => r.check_in === date && r.done) : []
  const LANES = [
    { key: 'must', title: 'Must call', why: 'luxury units and big bookings — every one, today', must: true,
      rows: due.filter(r => laneOf(r) === 'must') },
    { key: 'recovery', title: 'Unit recovery', why: 'the unit is carrying a bad review — the call is the repair', must: true,
      rows: due.filter(r => laneOf(r) === 'recovery') },
    { key: 'welcome', title: 'Welcome calls', why: 'everyone else arriving — complete what you can', must: false,
      rows: due.filter(r => laneOf(r) === 'welcome') },
  ].filter(l => l.rows.length)
  // Recovery units being handled in the Must-call lane, so that lane's header can own up to them.
  const recoveryInMust = due.filter(r => laneOf(r) === 'must' && r.recovery).length

  // DONE CALLS (2026-09-21, Jon: "have a completed call section"). Both kinds, newest first —
  // proof of work for the day, and where a note gets re-read after the card has left the board.
  const doneCalls = rows.filter(r => r.done).map(r => ({
    id: r.id, guest: r.guest, listing: r.listing, kind: 'welcome' as const, when: r.calledAt || r.check_in,
    outcome: r.outcome, by: r.calledBy, note: r.proof.note, attempts: r.attempts, proof: r.proof, ref: r.check_in,
  })).concat(outRows.filter(r => r.done).map(r => ({
    id: r.id, guest: r.guest, listing: r.listing, kind: 'post' as const, when: r.calledAt || r.check_out,
    outcome: r.outcome, by: r.calledBy, note: r.callNote || r.proof.note, attempts: r.attempts, proof: r.proof, ref: r.check_out,
  })) as any[]).sort((a, b) => String(b.when).localeCompare(String(a.when)))

  const TABS = [
    { key: 'welcome' as const, label: 'To call', n: mode === 'day' ? due.length : duePending.length },
    { key: 'post' as const, label: 'Post-checkout', n: mode === 'day' ? shownOut.filter(r => !r.done && !r.closed).length : kpis.postDue },
    { key: 'done' as const, label: 'Done', n: doneCalls.length },
    { key: 'board' as const, label: 'Scoreboard', n: null as number | null },
    { key: 'all' as const, label: 'Not called · 14 days', n: allSorted.length },
  ]

  // The two numbers the desk is judged on, in one line (the 7-day strip lives on the Scoreboard tab).
  const mTot = kpis.mandatoryDoneToday + kpis.mandatoryOpen
  const oDone = Math.max(0, kpis.calledToday - kpis.mandatoryDoneToday)
  const oTot = oDone + Math.max(0, kpis.dueNow - kpis.mandatoryOpen) + kpis.postDue
  const listProps = { today, openId, setOpenId, draft, setDraft, busy, copied, copyPhone, welcome, saveNote, saving, saved, myName, failedId, error }

  return (
    <div className="space-y-3">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-ink tracking-tight inline-flex items-center gap-2"><PhoneCall size={20} className="text-brand-600" /> Calls</h1>
        <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
          <span className={`rounded-lg px-2 py-1 font-semibold tabular-nums ${!mTot ? 'bg-slate-100 text-muted' : kpis.mandatoryOpen ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>Must call {kpis.mandatoryDoneToday}/{mTot}</span>
          <span className="rounded-lg px-2 py-1 font-semibold tabular-nums bg-slate-100 text-ink">Other {oDone}/{oTot}</span>
          {kpis.lastChance > 0 && <span className="rounded-lg px-2 py-1 font-semibold bg-rose-600 text-white">{kpis.lastChance} close tonight</span>}
          {kpis.closedOut > 0 && <span className="rounded-lg px-2 py-1 font-semibold bg-slate-100 text-muted">{kpis.closedOut} missed</span>}
          {syncMsg && <span className="text-[12px] font-semibold text-emerald-700">{syncMsg}</span>}
          <button onClick={refreshDesk} disabled={syncing}
            title="Pull new bookings from Guesty and reload the desk — use it when a reservation came in just now"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1 font-semibold text-ink hover:border-ink/30 disabled:opacity-50">
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Checking Guesty…' : 'Refresh'}
          </button>
        </div>
      </header>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-xl border border-line overflow-hidden text-[12.5px]">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-2.5 sm:px-3 py-1.5 font-semibold border-l border-line first:border-l-0 ${tab === t.key ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>
              {t.label}{t.n ? <span className="ml-1 opacity-70 tabular-nums">{t.n}</span> : null}
            </button>
          ))}
        </div>
        {(tab === 'welcome' || tab === 'post') && (
          <div className="inline-flex items-center gap-1 text-[12.5px]">
            <button onClick={() => shiftDate(-1)} title="Previous day" className="rounded-lg border border-line bg-white px-2 py-1 font-semibold text-muted hover:text-ink">‹</button>
            <input type="date" value={date} onChange={e => goDate(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1 font-semibold text-ink" />
            <button onClick={() => shiftDate(1)} title="Next day" className="rounded-lg border border-line bg-white px-2 py-1 font-semibold text-muted hover:text-ink">›</button>
            {date !== today && <button onClick={() => goDate(today)} className="rounded-lg bg-ink text-white px-2.5 py-1 font-semibold">Today</button>}
            <span className="ml-1 inline-flex rounded-lg border border-line overflow-hidden">
              <button onClick={() => setMode('day')} className={`px-2 py-1 font-semibold ${mode === 'day' ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>{dateLabel}</button>
              <button onClick={() => setMode('window')} className={`px-2 py-1 font-semibold border-l border-line ${mode === 'window' ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`} title="The rolling sheet: arrivals in the next 72 hours, checkouts in the last 48">Next 72h</button>
            </span>
          </div>
        )}
        <span className="ml-auto text-[12px] text-muted">Signed in as <b className="text-ink">{myName}</b></span>
      </div>

      {kpis.recoveryFailed && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800 flex items-center gap-2"><AlertTriangle size={13} className="shrink-0" /> Review scan came back short — recovery tags may be missing. Reload in a minute.</div>}
      {error && !failedId && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 flex items-center gap-2"><AlertTriangle size={13} className="shrink-0" /> {error}</div>}

      {noteAfter && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 flex items-center gap-2 flex-wrap">
          <Check size={14} className="text-emerald-700 shrink-0" />
          <span className="text-[12.5px] text-ink"><b>{noteAfter.label}</b> · {noteAfter.guest} <span className="text-muted">— by {myName}</span></span>
          <input autoFocus value={draft[noteAfter.id] || ''} onChange={e => { const v = e.target.value; const id = noteAfter.id; setDraft(d => ({ ...d, [id]: v })) }}
            onKeyDown={e => { if (e.key === 'Enter') saveNote(noteAfter.id); if (e.key === 'Escape') setNoteAfter(null) }}
            placeholder="Add a note — goes to the reservation in Guesty"
            className="flex-1 min-w-[180px] rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] text-ink focus:outline-none focus:border-brand-600" />
          <button onClick={() => saveNote(noteAfter.id)} disabled={saving === noteAfter.id || !(draft[noteAfter.id] || '').trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40">{saving === noteAfter.id ? <Loader2 size={12} className="animate-spin" /> : <StickyNote size={12} />} Save note</button>
          <IconBtn title="No note — close" onClick={() => setNoteAfter(null)}><X size={14} /></IconBtn>
        </div>
      )}

      {tab === 'done' && <CompletedList rows={doneCalls} />}

      {tab === 'board' && (
        <div className="space-y-4">
          <DayScore today={today} mandatoryDone={kpis.mandatoryDoneToday} mandatoryOpen={kpis.mandatoryOpen} otherDone={oDone} otherOpen={Math.max(0, kpis.dueNow - kpis.mandatoryOpen) + kpis.postDue}
            chips={[
              kpis.recoveryFailed ? '' : `${kpis.recoveryUnits} unit${kpis.recoveryUnits === 1 ? '' : 's'} in recovery`,
              kpis.coverage == null ? '' : `${kpis.coverage}% of arrivals called, last 7 days`,
            ].filter(Boolean)} />
          <Scoreboard />
        </div>
      )}

      {tab === 'post' && (
        <PostCheckoutList rows={shownOut} openId={openId} setOpenId={setOpenId} draft={draft} setDraft={setDraft}
          busy={busy} onAct={post} copied={copied} copyPhone={copyPhone} today={today}
          empty={mode === 'day' ? `No follow-up calls for ${dateLabel === 'Today' ? 'today' : dateLabel} — nobody checked out of a recovery unit that day.` : undefined} />
      )}

      {tab === 'welcome' && (
        due.length === 0 ? (
          <div className="rounded-2xl border border-line bg-white px-4 py-8 text-center text-sm text-muted">
            {mode === 'day'
              ? (dayDone.length ? `All ${dayDone.length} arrival${dayDone.length === 1 ? '' : 's'} on ${dateLabel === 'Today' ? 'today' : dateLabel} have had their call.` : `No arrivals on ${dateLabel === 'Today' ? 'today' : dateLabel}.`)
              : 'Nothing due — everyone arriving in the next 72 hours has had their call.'}
          </div>
        ) : (
          <div className="space-y-4">
            {LANES.map(lane => (
              <section key={lane.key}>
                <h2 className={`text-[11px] font-bold uppercase tracking-wider mb-1.5 px-1 flex items-center gap-2 ${lane.must ? 'text-rose-700' : 'text-muted'}`}>
                  {lane.title} <span className="tabular-nums">{lane.rows.length}</span>
                  {lane.must && <span className="normal-case tracking-normal font-semibold text-rose-600/80">· 100%</span>}
                </h2>
                <WelcomeList rows={byArrival(lane.rows)} {...listProps} />
              </section>
            ))}
          </div>
        )
      )}
      {tab === 'welcome' && mode === 'day' && dayDone.length > 0 && due.length > 0 && (
        <p className="text-[12px] text-muted px-1">{dayDone.length} arrival{dayDone.length === 1 ? '' : 's'} on {dateLabel === 'Today' ? 'today' : dateLabel} already called — see Done.</p>
      )}

      {tab === 'all' && (
        allSorted.length === 0
          ? <div className="rounded-2xl border border-line bg-white px-4 py-8 text-center text-sm text-muted">Every arrival in the next 14 days has had its call.</div>
          : <WelcomeList rows={allSorted} {...listProps} />
      )}

      <p className="text-[11px] text-muted/80">
        {talkroute
          ? 'Dial from the Call button — Talkroute marks answered calls complete on its own. Use ✓ / voicemail / no-answer for anything it can’t judge.'
          : '✓ and voicemail write the Welcome Call field and your note to Guesty.'}
      </p>
    </div>
  )
}

/**
 * COMPLETED CALLS (2026-09-21, Jon: "have a completed call section").
 *
 * Every call that closed, welcome and post-checkout together, newest first. Dense on purpose: one
 * line each, because this is a register to scan and audit rather than a worklist to act on. The
 * note from the recording sits underneath when there is one.
 */
function CompletedList({ rows }: { rows: any[] }) {
  if (!rows.length) return <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted">No calls completed yet.</div>
  return (
    <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70 [&>li:first-child]:rounded-t-2xl [&>li:last-child]:rounded-b-2xl">
      {rows.map(r => {
        const vm = r.outcome === 'voicemail'
        return (
          <li key={r.kind + r.id} className="px-3 sm:px-4 py-2">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                {vm ? <Voicemail size={13} className="text-amber-600 shrink-0" /> : <Check size={13} className="text-emerald-600 shrink-0" />}
                <span className="text-[13px] font-semibold text-ink truncate">{r.guest || 'Guest'}</span>
                <span className="text-[11px] text-muted truncate">{r.listing}</span>
                <Badge cls={r.kind === 'welcome' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600'}>{r.kind === 'welcome' ? 'Welcome' : 'Post-checkout'}</Badge>
                {vm && <Badge cls="bg-amber-100 text-amber-800">Voicemail</Badge>}
                {r.outcome === 'issue' && <Badge cls="bg-rose-100 text-rose-700">Issue</Badge>}
              </div>
              <span className="text-[11px] text-muted shrink-0">
                {r.by ? `${who(r.by)} · ` : ''}{r.when ? day(r.when) : ''}{r.attempts > 1 ? ` · ${r.attempts} attempts` : ''}
              </span>
            </div>
            {r.note && (
              <div className="text-[12px] text-muted mt-0.5 pl-[21px] flex items-start gap-1.5">
                <span className="flex-1">{r.note}</span>
                {r.proof?.callId && <a href={`/welcome-calls/call/${r.proof.callId}`} className="text-brand-600 hover:underline shrink-0 font-semibold">transcript →</a>}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function nextDay(ymd: string) { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }

// ── ONE LINE PER CALL (2026-09-22, Jon: "So noisy, should be clean, one liners and tags" · "Call
// button and essential info"). The line is: the Call button, who, where, then tags. Tags carry every
// flag the old card spelled out in sentences — the arrival day, why the call is mandatory, the
// channel, a balance to collect, what the phone system saw. Everything else (script, notes, the
// recording summary, Guesty, claim, undo) is one click away behind the row, not on it.
const TAG_TONE: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-600',
  rose: 'bg-rose-100 text-rose-700',
  roseSolid: 'bg-rose-600 text-white',
  violet: 'bg-violet-100 text-violet-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-800',
  brand: 'bg-brand-50 text-brand-700',
}
function Tag({ tone = 'slate', title, children }: { tone?: string; title?: string; children: ReactNode }) {
  return <span title={title} className={`shrink-0 whitespace-nowrap text-[10.5px] font-semibold leading-none px-1.5 py-[3px] rounded-md ${TAG_TONE[tone] || TAG_TONE.slate}`}>{children}</span>
}
function CallBtn({ phone }: { phone: string }) {
  if (!phone) return <Tip label="No phone number on file"><span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-400 px-2.5 h-8 text-[12px] font-semibold"><PhoneOff size={13} /> No #</span></Tip>
  return (
    <Tip label={`Call ${phone} in Talkroute`}><a href={`tel:${phone.replace(/[^+\d]/g, '')}`}
      className="shrink-0 inline-flex items-center gap-1 rounded-full bg-brand-600 text-white px-3 h-8 text-[12px] font-semibold hover:bg-brand-700 shadow-sm">
      <PhoneCall size={13} /> Call
    </a></Tip>
  )
}
/** The arrival date, big enough to read across the room (Jon, 2026-09-25: "see the arrival date
 *  easily"). Month over day, weekday under, in one fixed-width block at the left of the row. */
function DateBlock({ d, today, label }: { d: string; today: string; label: string }) {
  let mon = '', day = '', wd = ''
  try { const x = new Date(d + 'T12:00:00'); mon = x.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(); day = String(x.getDate()); wd = x.toLocaleDateString('en-US', { weekday: 'short' }) } catch { day = d }
  const isToday = d === today
  return (
    <div title={label + ' ' + d} className={`shrink-0 w-[46px] text-center rounded-lg px-1 py-0.5 leading-none ${isToday ? 'bg-rose-600 text-white' : 'bg-app text-ink border border-line'}`}>
      <div className={`text-[9px] font-bold tracking-wider ${isToday ? 'text-white/85' : 'text-muted'}`}>{mon}</div>
      <div className="text-[17px] font-bold tabular-nums">{day}</div>
      <div className={`text-[9.5px] font-semibold ${isToday ? 'text-white/85' : 'text-muted'}`}>{isToday ? 'Today' : wd}</div>
    </div>
  )
}
/** The small utility strip at the top of an opened row: number + copy, Guesty, claim / undo. */
function RowTools({ id, phone, copied, copyPhone, children }: { id: string; phone: string; copied: string | null; copyPhone: (id: string, p: string) => void; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 flex-wrap text-[12px] text-muted">
      {phone
        ? <span className="inline-flex items-center gap-1.5"><span className="font-semibold text-ink tabular-nums">{phone}</span>
            {copied === id ? <span className="text-emerald-700 inline-flex items-center gap-1"><Check size={11} /> Copied</span> : <button onClick={() => copyPhone(id, phone)} className="hover:text-ink inline-flex items-center gap-1"><Copy size={11} /> Copy</button>}
          </span>
        : <span>No phone on file</span>}
      <a href={`https://app.guesty.com/reservations/${id}/summary`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-ink"><Globe size={11} /> Guesty</a>
      {children}
    </div>
  )
}

function WelcomeList({ rows, today, openId, setOpenId, draft, setDraft, busy, copied, copyPhone, welcome, saveNote, saving, saved, myName, failedId, error }: {
  rows: Row[]; today: string; openId: string | null; setOpenId: (v: string | null) => void
  draft: Record<string, string>; setDraft: (f: (d: Record<string, string>) => Record<string, string>) => void
  busy: string | null; copied: string | null; copyPhone: (id: string, p: string) => void
  welcome: (id: string, o: 'reached' | 'voicemail' | 'no_answer' | 'claim' | 'undo') => void
  saveNote: (id: string) => void; saving: string | null; saved: string | null; myName: string
  failedId: string | null; error: string | null
}) {
  return (
    <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70 [&>li:first-child]:rounded-t-2xl [&>li:last-child]:rounded-b-2xl">
      {rows.map(r => {
        const ch = channelOf(r.source)
        const pol = channelPolicy(ch)
        const open = openId === r.id
        const live = !r.done && !r.closed
        const mine = !!r.claimedBy && !!myName && r.claimedBy.toLowerCase() === myName.toLowerCase()
        const isBusy = busy === r.id
        const owes = !pol.merchantOfRecord && !r.status.paidFull && r.status.balance > 0
        const talked = r.proof.lastResult === 'answered' && r.proof.lastAttemptAt
        return (
          <li key={r.id} className={r.done ? 'bg-emerald-50/30' : ''}>
            <div className="flex items-center gap-2.5 px-3 sm:px-4 py-2">
              <DateBlock d={r.check_in} today={today} label="Arrives" />
              <CallBtn phone={r.phone} />
              <button onClick={() => setOpenId(open ? null : r.id)} className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[13.5px] font-semibold text-ink truncate max-w-[14rem]">{r.guest || 'Guest'}</span>
                  {/* Jon, 2026-09-25: "make sure we know if it's a welcome call, show the check-in and
                      check-out day." The kind is a tag, the stay is in → out on every row. */}
                  <Tag tone="brand">Welcome call</Tag>
                  <span className="text-[12px] text-muted truncate max-w-[14rem]">{r.listing}</span>
                  <span className="text-[12px] text-ink tabular-nums whitespace-nowrap" title="Check-in → check-out">
                    In <b>{shortDay(r.check_in)}</b>{r.status.checkOut ? <> → out <b>{shortDay(r.status.checkOut)}</b></> : null}{r.status.nights ? <span className="text-muted"> · {r.status.nights}n</span> : null}
                  </span>
                  {r.check_in === nextDay(today) && <Tag tone="amber">Tomorrow</Tag>}
                  {r.tier === 'lux' && <Tag tone="violet">Luxury</Tag>}
                  {r.tier === 'big' && <Tag tone="emerald">Big {money(r.value)}</Tag>}
                  {r.recovery && <Tag tone="rose" title={`Last review ${r.recovery.rating.toFixed(1)}★ — ${r.recovery.openDays}d without a good one`}>Recovery {r.recovery.rating.toFixed(1)}★</Tag>}
                  <Tag>{ch}</Tag>
                  {owes && <Tag tone="amber">Owes {money(r.status.balance)}</Tag>}
                  {r.sensitive && <Tag tone="rose">Sensitive</Tag>}
                  {r.done && <Tag tone="emerald">{r.outcome === 'voicemail' ? 'Voicemail' : 'Reached'}{r.calledBy ? ` · ${who(r.calledBy)}` : ''}</Tag>}
                  {live && talked && <Tag tone="brand" title="Talkroute saw an answered call">Talked {talkMins(r.proof.talkSeconds)}</Tag>}
                  {live && !talked && r.attempts > 0 && <Tag>No answer ×{r.attempts}</Tag>}
                  {live && r.claimedBy && <Tag tone="amber">{mine ? 'You have it' : `Taken · ${r.claimedBy}`}</Tag>}
                  {r.closed && !r.done && <Tag>Closed · missed</Tag>}
                  {r.proof.note && <Tag tone={r.proof.sentiment === 'unhappy' ? 'rose' : 'slate'} title={r.proof.note}>Call notes</Tag>}
                </div>
              </button>
              {live && (
                <div className="flex items-center gap-1">
                  <IconBtn title="Reached the guest — mark complete" tone="ok" disabled={isBusy} onClick={() => welcome(r.id, 'reached')}>{isBusy ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />}</IconBtn>
                  <IconBtn title="Left a voicemail — counts as complete" disabled={isBusy} onClick={() => welcome(r.id, 'voicemail')}><Voicemail size={14} /></IconBtn>
                  <IconBtn title={`No answer${r.attempts ? ` (${r.attempts} so far)` : ''} — stays on the list to try again`} disabled={isBusy} onClick={() => welcome(r.id, 'no_answer')}><PhoneOff size={14} /></IconBtn>
                </div>
              )}
              <Tip label={open ? 'Close' : 'Script, notes & details'}><button onClick={() => setOpenId(open ? null : r.id)} className="shrink-0 text-muted hover:text-ink p-1"><ChevronDown size={15} className={open ? 'rotate-180 transition' : 'transition'} /></button></Tip>
            </div>
            {failedId === r.id && error && !open && <p className="px-4 pb-2 text-[12px] text-rose-700 flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}</p>}
            {open && (
              <div className="px-3 sm:px-4 pb-3 space-y-2">
                <RowTools id={r.id} phone={r.phone} copied={copied} copyPhone={copyPhone}>
                  {live && !r.claimedBy && <button onClick={() => welcome(r.id, 'claim')} disabled={isBusy} className="inline-flex items-center gap-1 hover:text-ink"><Hand size={11} /> Take it</button>}
                  {r.done && <button onClick={() => welcome(r.id, 'undo')} disabled={isBusy} className="inline-flex items-center gap-1 hover:text-ink">Undo</button>}
                </RowTools>
                <ProofLine p={r.proof} done={r.done} kind="welcome" />
                <CallNote p={r.proof} />
                <StayPanel reservationId={r.id} compact />
                {r.recovery && !r.done && <RecoveryNote rec={r.recovery} unit={r.listing} />}
                <WelcomeScript r={r} draft={draft} setDraft={setDraft} onSaveNote={() => saveNote(r.id)} saving={saving === r.id} saved={saved === r.id} />
                {failedId === r.id && error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> <span>{error}</span></p>}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ── POST-CHECKOUT ───────────────────────────────────────────────────────────────────────────────
// Only guests leaving a RECOVERY unit (Jon). Same one-line shape; the three outcomes are
// All good / They raised an issue / No answer.
const REASON_TAG: Record<string, { label: string; tone: string }> = {
  glitch: { label: 'Issue in stay', tone: 'rose' },
  recovery: { label: 'Recovery', tone: 'rose' },
  direct: { label: 'Direct', tone: 'brand' },
  value: { label: 'High value', tone: 'emerald' },
}
function PostCheckoutList({ rows, openId, setOpenId, draft, setDraft, busy, onAct, copied, copyPhone, empty, today }: {
  empty?: string; today: string
  rows: OutRow[]; openId: string | null; setOpenId: (v: string | null) => void
  draft: Record<string, string>; setDraft: (f: (d: Record<string, string>) => Record<string, string>) => void
  busy: string | null; onAct: (id: string, o: 'happy' | 'issue' | 'no_answer' | 'claim' | 'undo') => void
  copied: string | null; copyPhone: (id: string, p: string) => void
}) {
  if (rows.length === 0) return <div className="rounded-2xl border border-line bg-white px-4 py-8 text-center text-sm text-muted">{empty || 'Nobody checked out of a recovery unit in the last 48 hours.'}</div>
  return (
    <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70 [&>li:first-child]:rounded-t-2xl [&>li:last-child]:rounded-b-2xl">
      {rows.map(r => {
        const open = openId === r.id
        const live = !r.done && !r.closed
        const isBusy = busy === r.id
        const talked = r.proof.lastResult === 'answered' && r.proof.lastAttemptAt
        return (
          <li key={r.id} className={r.done ? 'bg-emerald-50/30' : ''}>
            <div className="flex items-center gap-2.5 px-3 sm:px-4 py-2">
              <DateBlock d={r.check_out} today={today} label="Checked out" />
              <CallBtn phone={r.phone} />
              <button onClick={() => setOpenId(open ? null : r.id)} className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[13.5px] font-semibold text-ink truncate max-w-[14rem]">{r.guest || 'Guest'}</span>
                  <Tag tone="violet">Follow-up call</Tag>
                  <span className="text-[12px] text-muted truncate max-w-[14rem]">{r.listing}</span>
                  <span className="text-[12px] text-ink tabular-nums whitespace-nowrap" title="Check-in → check-out">
                    In <b>{shortDay(r.check_in)}</b> → out <b>{shortDay(r.check_out)}</b>{r.nights ? <span className="text-muted"> · {r.nights}n</span> : null}
                  </span>
                  {r.reasons.map(k => { const m = REASON_TAG[k]; return m ? <Tag key={k} tone={m.tone}>{m.label}{k === 'value' && r.value ? ` ${money(r.value)}` : ''}</Tag> : null })}
                  {r.done && <Tag tone={r.outcome === 'issue' ? 'rose' : 'emerald'}>{r.outcome === 'issue' ? 'Issue raised' : 'All good'}{r.calledBy ? ` · ${who(r.calledBy)}` : ''}</Tag>}
                  {live && talked && <Tag tone="brand">Talked {talkMins(r.proof.talkSeconds)}</Tag>}
                  {live && !talked && r.attempts > 0 && <Tag>No answer ×{r.attempts}</Tag>}
                  {live && r.claimedBy && <Tag tone="amber">Taken · {r.claimedBy}</Tag>}
                  {r.closed && !r.done && <Tag>Closed · missed</Tag>}
                  {r.proof.note && <Tag tone={r.proof.sentiment === 'unhappy' ? 'rose' : 'slate'} title={r.proof.note}>Call notes</Tag>}
                </div>
              </button>
              {live && (
                <div className="flex items-center gap-1">
                  <IconBtn title="Guest was happy — all good" tone="ok" disabled={isBusy} onClick={() => onAct(r.id, 'happy')}>{isBusy ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />}</IconBtn>
                  <IconBtn title="Guest raised an issue" tone="bad" disabled={isBusy} onClick={() => onAct(r.id, 'issue')}><AlertTriangle size={14} /></IconBtn>
                  <IconBtn title={`No answer${r.attempts ? ` (${r.attempts} so far)` : ''} — try again later`} disabled={isBusy} onClick={() => onAct(r.id, 'no_answer')}><PhoneOff size={14} /></IconBtn>
                </div>
              )}
              <Tip label={open ? 'Close' : 'Script, notes & details'}><button onClick={() => setOpenId(open ? null : r.id)} className="shrink-0 text-muted hover:text-ink p-1"><ChevronDown size={15} className={open ? 'rotate-180 transition' : 'transition'} /></button></Tip>
            </div>
            {open && (
              <div className="px-3 sm:px-4 pb-3 space-y-2">
                <RowTools id={r.id} phone={r.phone} copied={copied} copyPhone={copyPhone}>
                  {live && !r.claimedBy && <button onClick={() => onAct(r.id, 'claim')} disabled={isBusy} className="inline-flex items-center gap-1 hover:text-ink"><Hand size={11} /> Take it</button>}
                  {r.done && <button onClick={() => onAct(r.id, 'undo')} disabled={isBusy} className="inline-flex items-center gap-1 hover:text-ink">Undo</button>}
                  <a href="/glitches" className="inline-flex items-center gap-1 hover:text-ink"><Wrench size={11} /> Log an issue</a>
                </RowTools>
                <ProofLine p={r.proof} done={r.done} kind="post" />
                <CallNote p={r.proof} />
                <StayPanel reservationId={r.id} compact />
                {r.glitches.length > 0 && (
                  <div className="text-[12px] text-rose-800"><b>Logged during stay:</b> {r.glitches.map(g => `${shortDay(g.at)} ${g.overview || 'Issue'} (${g.status || 'open'})`).join(' · ')}</div>
                )}
                {r.recovery && !r.done && <RecoveryNote rec={r.recovery} unit={r.listing} />}
                <div className="rounded-xl border border-line bg-slate-50 p-3 text-[12.5px] leading-relaxed">
                  <ol className="list-decimal pl-5 space-y-1 text-muted marker:text-muted/60">
                    <li>&ldquo;Hi {r.guest || 'there'}, this is [you] with Stay Hospitality — I saw you checked out {shortDay(r.check_out)} and wanted to thank you personally. Do you have a minute?&rdquo;</li>
                    {r.glitches.length > 0
                      ? <li className="text-rose-800"><b>Name it first:</b> &ldquo;I know {r.glitches[0].overview ? r.glitches[0].overview.toLowerCase() : 'something came up'} during your stay — how was that handled from your side?&rdquo;</li>
                      : <li><b>The one question:</b> &ldquo;Was there anything that wasn&rsquo;t right, even something small?&rdquo; Then wait.</li>}
                    <li>Issue raised: apologise once, say what will be fixed, mark it <b>Issue</b>.</li>
                    <li>Happy: ask for a review. Close: &ldquo;Book with us directly next time.&rdquo;</li>
                  </ol>
                </div>
                <NoteBox id={r.id} prior={r.notes} draft={draft} setDraft={setDraft} saving={false} saved={false}
                  placeholder="What they said — saved to Guesty when you pick an outcome." />
              </div>
            )}
          </li>
        )
      })}
    </ul>
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
