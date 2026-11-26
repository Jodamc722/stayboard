'use client'
// OUR STORY (Jon, 2026-11-26): "like a history page of our stats … our story … a living timeline.
// Make this beautiful." The team's year in numbers, then the timeline of how we got here.
//
// One dark hero with the two numbers that say the year, then four chapters (the work, the guests, the
// conversation, the care), the records, the people, a card to share, and the living timeline. Every
// number counts up once. A number whose data started part-way through the year says "since <month>"
// beside it — nothing on this page is estimated.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2, RefreshCw, Plus, X, Sparkles, Building2, Cpu, Users, Flag } from 'lucide-react'

type Leader = { name: string; n: number }
type Covered = { total: number; since: string | null; monthly: number[] }
type Ev = { id: string; date: string; title: string; note: string | null; kind: 'system' | 'property' | 'team' | 'milestone'; auto: boolean }
type Data = {
  ok: true; year: number; asOf: string; computedAt: string; months: string[]; partial: string[]; canEdit: boolean; timeline: Ev[]; hiddenEvents: number
  work: { total: number; cleans: number; departureCleans: number; maintenance: number; inspections: number; hours: number; people: number; units: number; monthly: { housekeeping: number[]; maintenance: number[]; inspection: number[] }; busiestDay: { date: string; n: number } | null; bestMonth: { month: string; n: number } | null; leaders: { housekeeping: Leader[]; maintenance: Leader[]; inspection: Leader[] } }
  guests: { stays: number; nights: number; uniqueGuests: number; partyStays: number; guestsCounted: number; avgParty: number | null; guestsEstimate: number | null; ownerStays: number; listings: number; avgNights: number; monthly: number[]; channels: Leader[]; busiestArrival: { date: string; n: number } | null }
  reviews: { total: number; avg: number | null; fiveStar: number; fiveStarShare: number | null; replied: number; monthly: number[] }
  talk: { guestMessages: Covered; teamMessages: Covered; automated: Covered; calls: Covered & { inbound: number; answered: number; outbound: number; outboundTalked: number; talkHours: number }; welcomeCalls: number }
  care: { guestIssues: Covered & { closed: number }; claims: Covered & { paid: number; recovered: number }; lostFound: number; autoInspections: number; eveAnswers: number; eveActions: number; guidebooks: number; ownerReports: number }
}

const serif: React.CSSProperties = { fontFamily: "var(--font-display), 'Instrument Serif', Georgia, serif", letterSpacing: '-0.01em' }
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const longDay = (ymd: string) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
const medDay = (ymd: string) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
// Validated categorical set (dataviz validator, light surface): housekeeping · maintenance · inspection.
const SERIES = [{ key: 'housekeeping' as const, label: 'Departure cleans', color: '#1f6fb5' }, { key: 'maintenance' as const, label: 'Maintenance', color: '#c9861a' }, { key: 'inspection' as const, label: 'Inspections', color: '#7a4fd0' }]

/** Counts up to `to` once, the first time it scrolls into view. */
function Count({ to, prefix = '', suffix = '', decimals = 0 }: { to: number; prefix?: string; suffix?: string; decimals?: number }) {
  const [v, setV] = useState(0)
  const ref = useRef<HTMLSpanElement | null>(null)
  const done = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const run = () => {
      if (done.current) return
      done.current = true
      if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setV(to); return }
      const t0 = performance.now(), dur = 1300
      const tick = (t: number) => { const p = Math.min(1, (t - t0) / dur); setV(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
    }
    if (typeof IntersectionObserver === 'undefined') { run(); return }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { run(); io.disconnect() } }, { threshold: 0.2 })
    io.observe(el)
    return () => io.disconnect()
  }, [to])
  return <span ref={ref} className="tabular-nums">{prefix}{decimals ? v.toFixed(decimals) : fmt(v)}{suffix}</span>
}

function Tile({ label, value, sub, since, decimals, prefix, suffix }: { label: string; value: number; sub?: ReactNode; since?: string | null; decimals?: number; prefix?: string; suffix?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5 flex-wrap">{label}{since ? <span className="normal-case tracking-normal font-medium rounded-full bg-brand-50 text-brand-800 px-1.5 py-px text-[10.5px]">since {since}</span> : null}</div>
      <div className="text-[34px] leading-none mt-1.5 text-ink" style={serif}><Count to={value} decimals={decimals} prefix={prefix} suffix={suffix} /></div>
      {sub ? <div className="text-[12px] text-muted mt-1.5 leading-snug">{sub}</div> : null}
    </div>
  )
}
function Chapter({ n, title, line, children }: { n: string; title: string; line: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-[13px] font-semibold text-brand-600 tabular-nums">{n}</span>
        <h2 className="text-[30px] leading-none text-ink" style={serif}>{title}</h2>
        <span className="text-[13px] text-muted hidden sm:inline">{line}</span>
      </div>
      {children}
    </section>
  )
}

function WorkChart({ d }: { d: Data }) {
  const [hover, setHover] = useState<number | null>(null)
  const totals = d.months.map((_, i) => SERIES.reduce((s, x) => s + d.work.monthly[x.key][i], 0))
  const max = Math.max(1, ...totals)
  return (
    <div className="rounded-2xl border border-line bg-white px-4 pt-4 pb-3 mt-3">
      <div className="flex items-center gap-4 flex-wrap mb-3">
        <span className="text-[13px] font-semibold text-ink">Jobs finished each month</span>
        <span className="flex items-center gap-3 ml-auto">{SERIES.map(s => <span key={s.key} className="inline-flex items-center gap-1.5 text-[12px] text-muted"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}</span>
      </div>
      <div className="relative flex items-end gap-1.5 sm:gap-3 h-56" onMouseLeave={() => setHover(null)}>
        {d.months.map((m, i) => (
          <div key={m} className="flex-1 h-full flex flex-col justify-end items-center cursor-default" onMouseEnter={() => setHover(i)}>
            <span className={`text-[11px] tabular-nums mb-1 ${hover === i ? 'text-ink font-semibold' : 'text-muted'}`}>{fmt(totals[i])}</span>
            <div className="w-full max-w-[56px] flex flex-col-reverse gap-[2px]" style={{ height: `${(totals[i] / max) * 86}%`, opacity: hover == null || hover === i ? 1 : 0.45, transition: 'opacity .15s' }}>
              {SERIES.map((s, si) => { const v = d.work.monthly[s.key][i]; return v ? <div key={s.key} style={{ background: s.color, flexGrow: v, flexBasis: 0, borderRadius: si === SERIES.length - 1 || !SERIES.slice(si + 1).some(x => d.work.monthly[x.key][i]) ? '4px 4px 0 0' : 0 }} /> : null })}
            </div>
            <span className="text-[11.5px] text-muted mt-1.5">{m}{i === d.months.length - 1 ? '*' : ''}</span>
          </div>
        ))}
        {hover != null ? (
          <div className="absolute top-0 pointer-events-none rounded-xl bg-ink text-white px-3 py-2 text-[12px] shadow-lg" style={{ left: `${Math.min(78, Math.max(0, (hover / d.months.length) * 100))}%` }}>
            <div className="font-semibold mb-1">{d.months[hover]} {d.year}</div>
            {SERIES.map(s => <div key={s.key} className="flex items-center gap-2"><span className="w-2 h-2 rounded-sm" style={{ background: s.color }} /><span className="text-white/70">{s.label}</span><span className="ml-auto pl-4 tabular-nums font-semibold">{fmt(d.work.monthly[s.key][hover])}</span></div>)}
          </div>
        ) : null}
      </div>
      <div className="text-[11px] text-muted mt-1">* {d.months[d.months.length - 1]} is the month so far.</div>
    </div>
  )
}

function Bars({ title, rows, color, rank = true }: { title: string; rows: Leader[]; color: string; rank?: boolean }) {
  const max = Math.max(1, ...rows.map(r => r.n))
  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-3.5">
      <div className="text-[13px] font-semibold text-ink mb-2.5">{title}</div>
      {!rows.length ? <div className="text-[12.5px] text-muted">Nothing on record yet.</div> : (
        <ul className="space-y-2">{rows.map((r, i) => (
          <li key={r.name} title={`${r.name}: ${fmt(r.n)}`}>
            <div className="flex items-baseline gap-2 text-[13px]">{rank ? <span className="text-muted tabular-nums w-4">{i + 1}</span> : null}<span className="flex-1 truncate text-ink">{r.name}</span><span className="tabular-nums font-semibold text-ink">{fmt(r.n)}</span></div>
            <div className={`h-1.5 rounded-full bg-app mt-1 overflow-hidden ${rank ? 'ml-6' : ''}`}><div className="h-full rounded-full" style={{ width: `${(r.n / max) * 100}%`, background: color }} /></div>
          </li>
        ))}</ul>
      )}
    </div>
  )
}

const KIND_ICON: Record<Ev['kind'], ReactNode> = { system: <Cpu size={13} />, property: <Building2 size={13} />, team: <Users size={13} />, milestone: <Flag size={13} /> }
const KIND_LABEL: Record<Ev['kind'], string> = { system: 'System', property: 'Property', team: 'Team', milestone: 'Milestone' }

/** The card to share: the year in six numbers, 4:5, ready for a post. */
export function ShareCard({ d, heading = 'Thank you, team.', line }: { d: Data; heading?: string; line?: string }) {
  const rows: [string, string][] = [
    [fmt(d.guests.stays), 'guest stays hosted'], [fmt(d.guests.nights), 'nights'], [fmt(d.work.departureCleans), 'departure cleans'],
    [fmt(d.work.maintenance), 'maintenance jobs'], [fmt(d.work.inspections), 'inspections'], [fmt(d.reviews.total), 'guest reviews'],
  ]
  return (
    <div id="story-share-card" className="relative overflow-hidden rounded-[28px] text-white w-full max-w-[540px] aspect-[4/5] flex flex-col px-9 py-9" style={{ background: 'radial-gradient(120% 80% at 100% 0%, #3a2f1c 0%, #15161a 55%, #0e0f12 100%)' }}>
      <div className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#cdb27f]">Stay Hospitality · {d.year}</div>
      <div className="text-[54px] leading-[1.02] mt-4" style={serif}>{heading}</div>
      <div className="text-[15px] text-white/70 mt-3 leading-snug max-w-[400px]">{line || `Here is what you did this year, through ${new Date(d.asOf + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`}</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-7 mt-auto">
        {rows.map(([n, l]) => <div key={l}><div className="text-[58px] leading-none text-[#e9d9b4]" style={serif}>{n}</div><div className="text-[14px] text-white/70 mt-1.5">{l}</div></div>)}
      </div>
      <div className="mt-7 pt-4 border-t border-white/15 text-[12.5px] text-white/60 flex items-center gap-2"><Sparkles size={13} className="text-[#cdb27f]" /> {fmt(d.work.people)} people finished {fmt(d.work.total)} jobs across {fmt(d.work.units)} homes.</div>
    </div>
  )
}

export function StoryPage() {
  const [d, setD] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ date: '', title: '', note: '', kind: 'milestone' as Ev['kind'] })
  const [formErr, setFormErr] = useState('')
  const load = useCallback(async (refresh = false) => {
    setBusy(true)
    try {
      const r = await fetch('/api/history' + (refresh ? '?refresh=1' : ''), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setD(j); setErr('')
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(false) }
  }, [])
  useEffect(() => { load() }, [load])
  const post = async (body: Record<string, any>) => {
    const r = await fetch('/api/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${r.status}`)
    await load()
  }
  const add = async () => { setFormErr(''); try { await post({ action: 'event.save', ...f }); setAdding(false); setF({ date: '', title: '', note: '', kind: 'milestone' }) } catch (e: any) { setFormErr(e?.message || String(e)) } }

  if (err) return <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-[13px]">{err}</div>
  if (!d) return <div className="flex items-center gap-2 text-muted text-[13px] py-24 justify-center"><Loader2 size={16} className="animate-spin" /> Adding up the year…</div>

  const asOf = new Date(d.asOf + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  const years: string[] = []
  for (const e of d.timeline) if (years.indexOf(e.date.slice(0, 4)) < 0) years.push(e.date.slice(0, 4))
  return (
    <div className="max-w-6xl mx-auto pb-20">
      {/* ---------- hero ---------- */}
      <div className="relative overflow-hidden rounded-[28px] text-white px-6 sm:px-10 py-10 sm:py-14" style={{ background: 'radial-gradient(90% 120% at 100% 0%, #3a2f1c 0%, #15161a 50%, #0e0f12 100%)' }}>
        <div className="flex items-center gap-3">
          <span className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#cdb27f]">Our story · {d.year} so far</span>
          <button onClick={() => load(true)} disabled={busy} title="Recount the year" className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-1 text-[12px] text-white/70 hover:text-white">{busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Through {asOf}</button>
        </div>
        <div role="heading" aria-level={1} className="text-[44px] sm:text-[76px] leading-[0.98] mt-6 max-w-4xl" style={serif}>
          <span className="text-[#e9d9b4]"><Count to={d.guests.stays} /></span> guest stays.<br />
          <span className="text-[#e9d9b4]"><Count to={d.work.total} /></span> jobs done.
        </div>
        <p className="text-[16px] text-white/70 mt-5 max-w-2xl leading-relaxed">{fmt(d.work.people)} people cared for {fmt(d.work.units)} homes this year. Every number on this page is something this team finished.</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6 mt-10 pt-8 border-t border-white/15">
          {([['Nights hosted', d.guests.nights], ['Departure cleans', d.work.departureCleans], ['Maintenance jobs', d.work.maintenance], ['Inspections', d.work.inspections]] as [string, number][]).map(([l, v]) => (
            <div key={l}><div className="text-[40px] sm:text-[48px] leading-none" style={serif}><Count to={v} /></div><div className="text-[12.5px] uppercase tracking-wider text-white/60 mt-2">{l}</div></div>
          ))}
        </div>
      </div>
      {d.partial.length ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-[12.5px]">The count stopped early on {d.partial.join(', ')} — those numbers are low. Press “Through {asOf}” to recount.</div> : null}

      {/* ---------- 01 the work ---------- */}
      <Chapter n="01" title="The work" line="Departure cleans, maintenance and inspections finished in Breezeway.">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Jobs finished" value={d.work.total} sub={d.work.bestMonth ? `Biggest month: ${d.work.bestMonth.month}, ${fmt(d.work.bestMonth.n)}` : undefined} />
          <Tile label="Departure cleans" value={d.work.cleans} sub="A home turned over for the next guest" />
          <Tile label="Maintenance jobs" value={d.work.maintenance} />
          <Tile label="Inspections" value={d.work.inspections} />
          <Tile label="People who did it" value={d.work.people} sub="Everyone who finished a task" />
          <Tile label="Homes cared for" value={d.work.units} />
          <Tile label="Busiest day" value={d.work.busiestDay?.n || 0} suffix=" jobs" sub={d.work.busiestDay ? longDay(d.work.busiestDay.date) : undefined} />
        </div>
        <WorkChart d={d} />
      </Chapter>

      {/* ---------- 02 the guests ---------- */}
      <Chapter n="02" title="The guests" line="Confirmed stays that checked in this year.">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Guest stays" value={d.guests.stays} sub={d.guests.ownerStays ? `Plus ${fmt(d.guests.ownerStays)} owner and friends & family stays` : undefined} />
          <Tile label="Nights hosted" value={d.guests.nights} sub={`${d.guests.avgNights} nights a stay on average`} />
          <Tile label="Guests who booked" value={d.guests.uniqueGuests} sub="Different people, counted once" />
          <Tile label="Busiest arrival day" value={d.guests.busiestArrival?.n || 0} suffix=" check-ins" sub={d.guests.busiestArrival ? longDay(d.guests.busiestArrival.date) : undefined} />
          <Tile label="Reviews" value={d.reviews.total} sub={`${fmt(d.reviews.replied)} answered`} />
          <Tile label="Average rating" value={d.reviews.avg || 0} decimals={2} suffix=" / 5" sub="All channels, on one scale" />
          <Tile label="Five-star reviews" value={d.reviews.fiveStar} sub={d.reviews.fiveStarShare != null ? `${Math.round(d.reviews.fiveStarShare * 100)}% of rated reviews` : undefined} />
          {d.guests.guestsEstimate ? <Tile label="Guests hosted" value={d.guests.guestsEstimate} prefix="≈ " sub={`Estimate: ${d.guests.avgParty} guests a stay, counted on ${fmt(d.guests.partyStays)} stays and applied to the rest`} /> : <Tile label="Listings with a stay" value={d.guests.listings} />}
        </div>
        <div className="grid lg:grid-cols-2 gap-3 mt-3">
          <Bars title="Where guests booked" rows={d.guests.channels} color="#1f6fb5" />
          <Bars title="Stays by month" rows={d.months.map((m, i) => ({ name: m, n: d.guests.monthly[i] }))} color="#a8864e" rank={false} />
        </div>
      </Chapter>

      {/* ---------- 03 the conversation ---------- */}
      <Chapter n="03" title="Customer care" line="Messages in Guesty and calls on the phone line.">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Messages sent by the team" value={d.talk.teamMessages.total} since={d.talk.teamMessages.since} sub="Sent to guests in Guesty, saved replies included" />
          <Tile label="Messages from guests" value={d.talk.guestMessages.total} since={d.talk.guestMessages.since} />
          <Tile label="Automated messages" value={d.talk.automated.total} since={d.talk.automated.since} sub="Check-in details, reminders" />
          <Tile label="Calls answered" value={d.talk.calls.answered} since={d.talk.calls.since} sub={`${fmt(d.talk.calls.inbound)} came in; the rest hung up or were missed`} />
          <Tile label="Calls made" value={d.talk.calls.outbound} since={d.talk.calls.since} sub={`${fmt(d.talk.calls.outboundTalked)} lasted a minute or more; redials and no-answers are in the total`} />
          <Tile label="Hours on the phone" value={d.talk.calls.talkHours} since={d.talk.calls.since} />
          <Tile label="Welcome + care calls" value={d.talk.welcomeCalls} sub="Logged on the Calls desk" />
        </div>
      </Chapter>

      {/* ---------- 04 the care ---------- */}
      <Chapter n="04" title="The care" line="What we caught, fixed and followed through on.">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Guest issues logged" value={d.care.guestIssues.total} since={d.care.guestIssues.since} sub={`${fmt(d.care.guestIssues.closed)} closed`} />
          <Tile label="Damage claims filed" value={d.care.claims.total} since={d.care.claims.since} sub={d.care.claims.paid ? `${fmt(d.care.claims.paid)} paid` : undefined} />
          <Tile label="Recovered for owners" value={d.care.claims.recovered} prefix="$" since={d.care.claims.since} />
          <Tile label="Lost items handled" value={d.care.lostFound} />
          <Tile label="Extra inspections" value={d.care.autoInspections} sub="VIP, owner stays, after a bad review" />
          <Tile label="Questions Eve answered" value={d.care.eveAnswers} />
          <Tile label="Guidebooks made" value={d.care.guidebooks} />
          <Tile label="Owner reports made" value={d.care.ownerReports} />
        </div>
      </Chapter>

      {/* ---------- 05 the people ---------- */}
      <Chapter n="05" title="The people" line="Most jobs finished this year.">
        <div className="grid lg:grid-cols-3 gap-3">
          <Bars title="Departure cleans" rows={d.work.leaders.housekeeping} color={SERIES[0].color} />
          <Bars title="Maintenance" rows={d.work.leaders.maintenance} color={SERIES[1].color} />
          <Bars title="Inspections" rows={d.work.leaders.inspection} color={SERIES[2].color} />
        </div>
      </Chapter>

      {/* ---------- 06 share ---------- */}
      <Chapter n="06" title="Share it" line="The year on one card.">
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <ShareCard d={d} />
          <div className="text-[13.5px] text-muted leading-relaxed max-w-sm">A 4:5 card with the year in six numbers, sized for a Slack or Instagram post. Take a screenshot of the card, or ask for it as an image.</div>
        </div>
      </Chapter>

      {/* ---------- 07 the timeline ---------- */}
      <Chapter n="07" title="How we got here" line="A living timeline. It adds to itself as buildings and systems come online.">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {d.canEdit ? <button onClick={() => setAdding(!adding)} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[12.5px] font-semibold">{adding ? <X size={14} /> : <Plus size={14} />} {adding ? 'Close' : 'Add a milestone'}</button> : null}
          {d.canEdit && d.hiddenEvents ? <button onClick={() => post({ action: 'event.restore' }).catch(() => {})} className="rounded-xl border border-line bg-white px-3 py-2 text-[12.5px] font-semibold text-ink">Bring back {d.hiddenEvents} hidden</button> : null}
        </div>
        {adding ? (
          <div className="rounded-2xl border border-line bg-white p-4 mb-5 grid sm:grid-cols-[160px_1fr] gap-3">
            <input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} className="rounded-xl border border-line px-3 py-2 text-[13px]" />
            <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="What happened — “Breezeway went live”, “Salato came online”" className="rounded-xl border border-line px-3 py-2 text-[13px]" />
            <div className="flex gap-1.5 flex-wrap">{(Object.keys(KIND_LABEL) as Ev['kind'][]).map(k => <button key={k} type="button" onClick={() => setF({ ...f, kind: k })} className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${f.kind === k ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted'}`}>{KIND_LABEL[k]}</button>)}</div>
            <input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="A line about it (optional)" className="rounded-xl border border-line px-3 py-2 text-[13px]" />
            <div className="sm:col-span-2 flex items-center gap-3"><button onClick={add} className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-[13px] font-semibold">Add to the timeline</button>{formErr ? <span className="text-[12.5px] text-rose-700">{formErr}</span> : null}</div>
          </div>
        ) : null}
        {!d.timeline.length ? <div className="text-[13px] text-muted">Nothing on the timeline yet.</div> : years.map(y => (
          <div key={y} className="relative pl-6 sm:pl-28 pb-2">
            <div className="sm:absolute sm:left-0 sm:top-0 text-[40px] leading-none text-brand-500 mb-3" style={serif}>{y}</div>
            <ol className="relative border-l border-line ml-1 sm:ml-0">
              {d.timeline.filter(e => e.date.slice(0, 4) === y).map(e => (
                <li key={e.id} className="relative pl-6 pb-6 group">
                  <span className="absolute -left-[13px] top-0.5 w-[26px] h-[26px] rounded-full bg-white border border-line inline-flex items-center justify-center text-brand-600">{KIND_ICON[e.kind]}</span>
                  <div className="text-[11.5px] uppercase tracking-wider text-muted">{medDay(e.date)}{e.auto ? ' · from the record' : ''}</div>
                  <div className="text-[19px] leading-snug text-ink mt-0.5" style={serif}>{e.title}</div>
                  {e.note ? <div className="text-[13px] text-muted mt-0.5 max-w-2xl">{e.note}</div> : null}
                  {d.canEdit ? <button onClick={() => post({ action: 'event.remove', id: e.id }).catch(() => {})} title={e.auto ? 'Hide from the timeline' : 'Remove'} className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 text-muted hover:text-rose-600"><X size={14} /></button> : null}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </Chapter>
    </div>
  )
}
