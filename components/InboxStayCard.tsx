'use client'
// THE DECISION CARD (Jon, 2026-11-12: "The reservation details should show glitches or claims that are assigned to
// that guest. Should show old and new codes, should show status of clean / inspected. Should give the team info if
// needed to make real decisions. See reservation notes, sentiment").
//
// One narrow column beside the thread, in the order a person decides in: anything flagged → is the unit ready →
// the door → problems (this stay and the guest's others) → how the guest feels → notes → who they are → the rest.
// The stay comes from /api/reservation/<id>/360 (shared cache with StayPanel); the unit, the guest's other stays and
// the codes from /api/messages/stay-extras. Codes are never fetched until someone taps "Show codes".
import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronDown, ExternalLink, Eye, EyeOff, KeyRound, Loader2, MessageSquare, Scale, Sparkles, StickyNote, User, Wrench } from 'lucide-react'
import { Tag } from '@/components/lean'
import { StayFlags, useStay360 } from '@/components/StayPanel'

type Brief = { id: string; name: string; status: string; done: boolean; scheduled: string | null; finished: string | null; who: string[]; reportUrl: string | null }
type Extras = {
  unit: { for: 'arrival' | 'departure'; clean: Brief | null; inspection: Brief | null; verdict: string; tone: 'emerald' | 'amber' | 'rose' | 'slate' }
  otherStays: { glitches: { id: string; overview: string; status: string; createdAt: string; refund: number | null; unit: string; checkIn: string }[]; claims: { id: string; stage: string; summary: string | null; sought: number | null; paid: number | null; unit: string; checkIn: string }[] }
  codes: null | { system: 'listing' | 'reservation'; current: string | null; previous: string | null; expect: 'new' | 'old' | 'only_one' | null; note: string }
}

const cache: Record<string, { at: number; p: Promise<any> }> = {}
function loadExtras(id: string): Promise<any> {
  const hit = cache[id]
  if (hit && Date.now() - hit.at < 60_000) return hit.p
  const p = fetch('/api/messages/stay-extras?reservationId=' + encodeURIComponent(id), { cache: 'no-store' }).then(r => r.json())
  cache[id] = { at: Date.now(), p }
  return p
}
export function prefetchStayExtras(id: string | null | undefined) { if (id) loadExtras(id).catch(() => null) }

const money = (n: any) => n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString()
const day = (v: any) => { const s = String(v || ''); if (!s) return ''; try { return new Date(s.length === 10 ? s + 'T12:00:00Z' : s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: s.length === 10 ? 'UTC' : 'America/New_York' }) } catch { return s.slice(0, 10) } }
const time = (v: any) => { try { return new Date(String(v)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) } catch { return '' } }
const open = (s: string) => !/closed|resolved|done|complete|cancel/i.test(s)

export function InboxStayCard({ reservationId, canCodes }: { reservationId: string; canCodes: boolean }) {
  const { stay: s, err, loading } = useStay360(reservationId)
  const [x, setX] = useState<Extras | null>(null)
  const [codes, setCodes] = useState<Extras['codes'] | 'loading' | null>(null)
  const [codeErr, setCodeErr] = useState('')
  const [more, setMore] = useState(false)
  useEffect(() => {
    let live = true
    setX(null); setCodes(null); setCodeErr('')
    loadExtras(reservationId).then(j => { if (live && j?.ok) setX(j) }).catch(() => null)
    return () => { live = false }
  }, [reservationId])

  const showCodes = async () => {
    if (codes && codes !== 'loading') { setCodes(null); return }
    setCodes('loading'); setCodeErr('')
    try {
      const j = await (await fetch('/api/messages/stay-extras?codes=1&reservationId=' + encodeURIComponent(reservationId), { cache: 'no-store' })).json()
      if (j?.ok) setCodes(j.codes || { system: 'listing', current: null, previous: null, expect: null, note: 'No code found.' })
      else { setCodes(null); setCodeErr(j?.error || 'Could not read the code.') }
    } catch { setCodes(null); setCodeErr('Could not reach Lighthouse.') }
  }

  if (loading && !s) return <Shell><p className="text-[12px] text-muted inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading the booking…</p></Shell>
  if (!s) return err ? <Shell><p className="text-[12px] text-muted">Booking details unavailable — {err}</p></Shell> : null

  const openHere = s.glitches.filter((g: any) => open(g.status)).length + s.claims.filter((c: any) => !/paid|closed|denied|withdrawn/i.test(c.stage)).length
  const other = x?.otherStays
  const otherN = other ? other.glitches.length + other.claims.length : 0
  const sent = s.messages?.sentiment
  const keyFields = (s.customFields || []).filter((f: any) => !/door|code|wifi|password|lock/i.test(f.name)).slice(0, 6)

  return (
    <Shell>
      {s.flags.length > 0 && <div className="flex items-center gap-1 flex-wrap"><StayFlags flags={s.flags} /></div>}

      {/* THE UNIT — ready for this guest? */}
      <Sec icon={<Sparkles size={12} />} title={x?.unit.for === 'departure' ? 'Unit after checkout' : 'Unit for arrival'}
        right={x ? <Tag tone={x.unit.tone as any}>{x.unit.verdict}</Tag> : <Loader2 size={11} className="animate-spin text-muted" />}>
        {x && <>
          <TaskLine label="Clean" t={x.unit.clean} />
          <TaskLine label="Inspection" t={x.unit.inspection} />
        </>}
      </Sec>

      {/* THE DOOR — hidden until asked; Messages edit only. */}
      {canCodes && (
        <Sec icon={<KeyRound size={12} />} title="Door code"
          right={<button onClick={showCodes} className="text-[11.5px] font-semibold text-brand-700 hover:underline inline-flex items-center gap-1" title="Show this stay’s door code — every view is logged">
            {codes && codes !== 'loading' ? <><EyeOff size={11} /> Hide</> : codes === 'loading' ? <><Loader2 size={11} className="animate-spin" /> Reading…</> : <><Eye size={11} /> Show codes</>}</button>}>
          {codeErr && <p className="text-[12px] text-rose-700">{codeErr}</p>}
          {codes && codes !== 'loading' && (
            <div className="space-y-1">
              <div className="flex items-stretch gap-1.5">
                <CodeBox label={codes.system === 'reservation' ? 'This stay' : 'New / current'} code={codes.current} hot={codes.expect !== 'old'} />
                {codes.system === 'listing' && <CodeBox label="Old / previous" code={codes.previous} hot={codes.expect === 'old'} />}
              </div>
              {codes.expect && codes.expect !== 'only_one' && <p className="text-[11.5px] font-semibold text-ink">Keypad most likely holds the <b>{codes.expect === 'new' ? 'new' : 'old'}</b> code now.</p>}
              {codes.note && <p className="text-[11.5px] text-muted">{codes.note}</p>}
            </div>
          )}
        </Sec>
      )}

      {/* PROBLEMS — this stay and every other stay of this guest. */}
      <Sec icon={<AlertTriangle size={12} />} title="Glitches & claims" right={openHere ? <Tag tone="rose">{openHere} open</Tag> : otherN ? <Tag tone="amber">{otherN} before</Tag> : <span className="text-[11px] text-muted">none</span>}>
        {s.glitches.map((g: any) => (
          <Row key={g.id}><Tag tone={open(g.status) ? 'rose' : 'slate'}>{g.status || 'open'}</Tag><a href={'/glitches?q=' + encodeURIComponent(s.guest.name)} className="hover:underline truncate">{g.overview || 'Glitch'}</a>{g.refund ? <span className="text-rose-700"> · {money(g.refund)}</span> : null}</Row>
        ))}
        {s.claims.map((c: any) => (
          <Row key={c.id}><Scale size={11} className="text-violet-600 shrink-0" /><a href={'/claims/' + c.id} className="hover:underline">Claim · {c.stage}</a>{c.sought != null ? <span className="text-muted">· {money(c.sought)}{c.paid != null ? ' paid ' + money(c.paid) : ''}</span> : null}</Row>
        ))}
        {other && otherN > 0 && <p className="pt-1 text-[10.5px] font-bold uppercase tracking-wider text-muted">This guest’s other stays</p>}
        {other?.glitches.map(g => (
          <Row key={g.id} muted><Tag tone={open(g.status) ? 'amber' : 'slate'}>{g.status || 'open'}</Tag><span className="truncate">{g.overview || 'Glitch'}</span><span>· {g.unit} {day(g.checkIn)}{g.refund ? ' · ' + money(g.refund) : ''}</span></Row>
        ))}
        {other?.claims.map(c => (
          <Row key={c.id} muted><Scale size={11} className="text-violet-600 shrink-0" /><a href={'/claims/' + c.id} className="hover:underline">Claim · {c.stage}</a><span>· {c.unit} {day(c.checkIn)}{c.sought != null ? ' · ' + money(c.sought) : ''}</span></Row>
        ))}
        {!s.glitches.length && !s.claims.length && !otherN && <Row muted>Nothing on this stay or any other stay of this guest.</Row>}
      </Sec>

      {/* HOW THEY FEEL. */}
      <Sec icon={<MessageSquare size={12} />} title="Sentiment" right={sent ? <Tag tone={sent.dissatisfied ? 'rose' : /neg/i.test(sent.band || '') ? 'amber' : 'emerald'}>{sent.band || (sent.score ?? '—')}</Tag> : <span className="text-[11px] text-muted">not scanned</span>}>
        {sent?.topIssue && <Row><b>{sent.topIssue}</b></Row>}
        {sent?.reason && <Row muted>{sent.reason}</Row>}
        <Row muted>{s.messages.count} messages{s.messages.firstResponseMin != null ? ' · first reply ' + s.messages.firstResponseMin + ' min' : ''}{s.calls.totals.calls ? ' · ' + s.calls.totals.calls + ' calls' : ''}</Row>
        {s.calls.promised.length > 0 && <Row><span className="text-brand-700"><b>Promised:</b> {s.calls.promised.map((p: any) => p.item).join(' · ')}</span></Row>}
      </Sec>

      {/* NOTES. */}
      {(s.notes || s.guest.teamNotes || keyFields.length > 0) && (
        <Sec icon={<StickyNote size={12} />} title="Notes">
          {s.guest.teamNotes && <p className="text-[12px] text-ink rounded-lg bg-amber-50 border border-amber-100 px-2 py-1"><b>Team:</b> {s.guest.teamNotes}</p>}
          {s.notes && <p className="text-[12px] text-ink/80 whitespace-pre-wrap max-h-32 overflow-auto">{s.notes}</p>}
          {keyFields.map((f: any) => <Row key={f.name} muted><span className="text-ink">{f.name}:</span> <span className="truncate">{f.value}</span></Row>)}
        </Sec>
      )}

      {/* WHO. */}
      <Sec icon={<User size={12} />} title="Guest" right={s.guest.vip ? <Tag tone="violet">VIP</Tag> : s.guest.repeat ? <Tag tone="brand">Repeat</Tag> : null}>
        <Row muted>{s.guest.stays} stay{s.guest.stays === 1 ? '' : 's'} · {s.guest.nights} nights{s.guest.lifetimeValue != null ? ' · ' + money(s.guest.lifetimeValue) + ' lifetime' : ''}</Row>
        {s.guest.tags.length > 0 && <Row>{s.guest.tags.map((t: string) => <Tag key={t}>{t}</Tag>)}</Row>}
        {s.money && <Row muted>Paid {money(s.money.paid)} of {money(s.money.total)}{s.money.refunded ? ' · refunded ' + money(s.money.refunded) : ''}</Row>}
      </Sec>

      {/* THE REST — folded. */}
      <button onClick={() => setMore(m => !m)} className="w-full flex items-center justify-between text-[11.5px] font-semibold text-muted hover:text-ink pt-1">
        <span className="inline-flex items-center gap-1"><Wrench size={11} /> Field work, reviews, other stays</span><ChevronDown size={13} className={more ? 'rotate-180 transition' : 'transition'} />
      </button>
      {more && (
        <div className="space-y-2">
          {s.tasks.slice(0, 8).map((t: any) => <Row key={t.id} muted><Tag tone={/finish|complete|done/i.test(t.status) ? 'emerald' : 'slate'}>{t.status || 'open'}</Tag><span className="text-ink truncate">{t.name}</span><span>{t.scheduled ? '· ' + day(t.scheduled) : ''}</span></Row>)}
          {!s.tasks.length && <Row muted>No field tasks on this booking.</Row>}
          <Row muted>{s.reviews.thisStay ? <>This stay: <b className="text-ink">{s.reviews.thisStay.rating ?? '—'}★</b> {s.reviews.thisStay.channel}</> : 'No review from this stay yet'} · unit {s.reviews.listingAvg90 ?? '—'}★ (90d)</Row>
          {s.guest.history.filter((h: any) => h.id !== s.id).slice(0, 8).map((h: any) => <Row key={h.id} muted><a href={'/reservations/' + h.id} className="hover:underline text-ink">{h.unit}</a> · {day(h.checkIn)}–{day(h.checkOut)}{/cancel/i.test(h.status) ? ' · cancelled' : ''}</Row>)}
        </div>
      )}
      <a href={'/reservations/' + s.id} className="text-[12px] font-semibold text-brand-600 hover:underline inline-flex items-center gap-1">Full picture <ExternalLink size={11} /></a>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return <section className="rounded-2xl border border-line bg-white p-3 space-y-2.5">{children}</section>
}
function Sec({ icon, title, right, children }: { icon: ReactNode; title: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-t border-line/70 pt-2 first:border-0 first:pt-0">
      <div className="flex items-center gap-1.5 mb-1"><span className="text-[10.5px] font-bold uppercase tracking-wider text-muted inline-flex items-center gap-1">{icon} {title}</span><span className="ml-auto">{right}</span></div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}
function Row({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <div className={'text-[12px] flex items-center gap-1 min-w-0 flex-wrap ' + (muted ? 'text-muted' : 'text-ink')}>{children}</div>
}
function TaskLine({ label, t }: { label: string; t: Brief | null }) {
  if (!t) return <Row muted>{label}: none scheduled</Row>
  return (
    <Row>
      <span className="text-muted w-16 shrink-0">{label}</span>
      <Tag tone={t.done ? 'emerald' : /progress|start/i.test(t.status) ? 'amber' : 'slate'}>{t.done ? 'done' : (t.status || 'scheduled').toLowerCase()}</Tag>
      <span className="text-muted truncate">{t.done && t.finished ? time(t.finished) : t.scheduled ? day(t.scheduled) : ''}{t.who.length ? ' · ' + t.who.join(', ') : ''}</span>
      {t.reportUrl && <a href={t.reportUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline" title="Breezeway report"><ExternalLink size={10} /></a>}
    </Row>
  )
}
function CodeBox({ label, code, hot }: { label: string; code: string | null; hot: boolean }) {
  return (
    <div className={'flex-1 rounded-lg border px-2 py-1.5 ' + (hot && code ? 'border-emerald-300 bg-emerald-50' : 'border-line bg-app/50')}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</p>
      <p className={'font-mono text-[17px] font-bold tracking-wider ' + (code ? 'text-ink' : 'text-muted')}>{code || '—'}</p>
    </div>
  )
}
