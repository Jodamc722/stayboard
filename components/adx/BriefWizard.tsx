'use client'
// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// THE GUIDED BRIEF. Jon: "guide me first when creating an ad — goal, audience, what it should accomplish, vibe —
// and confirm the details before anything is built." Every choice is a button (there are no drop-down menus in the
// studio): the event, who it is for, what it should do, where, the vibe, the format and the length. The last screen
// reads the brief back in plain words and nothing is sent anywhere until "Confirm the brief" is pressed.
import { useMemo, useState } from 'react'
import { MOMENTS } from '@/lib/marketing-calendar'
import { whenShortOf } from '@/lib/ad-event'
import { MARKETS, MARKET_LABEL, marketAreas, buildingsIn, buildingName, type MarketKey } from '@/lib/ad-places'
import { ADX_MOMENTS, ADX_ANYTIME, CHANNELS, type Brief, type ChannelKey } from '@/lib/adx/composition'
import { STYLES } from '@/lib/adx/prop'
import { IDENTITIES, AUDIENCES, GOALS, VIBES, LENGTHS, ANYTIME, TEAM_AUDIENCE } from '@/lib/adx/identities'

export const UI = { bg: '#0B0F16', panel: '#121824', panel2: '#182131', line: 'rgba(255,255,255,0.09)', ink: '#F1F3F7', mut: '#8E9AAE', gold: '#D2B077', red: '#E06C6C', green: '#4CC488' }

export function Chip({ on, onClick, children, hint, disabled }: { on?: boolean; onClick: () => void; children: React.ReactNode; hint?: string; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={!!on}
      style={{ textAlign: 'left', padding: hint ? '10px 14px' : '9px 14px', borderRadius: 12, border: '1px solid ' + (on ? UI.gold : UI.line), background: on ? 'rgba(210,176,119,0.16)' : UI.panel2, color: UI.ink, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, fontSize: 13.5, fontWeight: 700, lineHeight: 1.25 }}>
      {children}
      {hint ? <span style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: UI.mut, marginTop: 3 }}>{hint}</span> : null}
    </button>
  )
}
const Q = ({ n, title, children, note }: { n: number; title: string; children: React.ReactNode; note?: string }) => (
  <section style={{ margin: '0 0 22px' }}>
    <p style={{ margin: '0 0 9px', fontSize: 13, fontWeight: 800, letterSpacing: '0.02em', color: UI.ink }}><span style={{ color: UI.gold, marginRight: 8 }}>{n}</span>{title}{note ? <span style={{ fontWeight: 500, color: UI.mut, marginLeft: 8 }}>{note}</span> : null}</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{children}</div>
  </section>
)

export default function BriefWizard({ moment, display, busy, onConfirm, onHouse, onCancel }: {
  moment?: string; display: string; busy: boolean
  onConfirm: (b: Brief) => void
  /** Open the house design for the event instead (no AI). */
  onHouse: (moment: string) => void
  onCancel: () => void
}) {
  const events = useMemo(() => MOMENTS.filter(m => ADX_MOMENTS.indexOf(m.key) >= 0), [])
  const [ev, setEv] = useState(moment && ADX_MOMENTS.indexOf(moment) >= 0 ? moment : '')
  // FROM SCRATCH (Jon, 2026-11-20): a piece for no event — our stays, owners, or the team (internal). Who it is for
  // comes with the kind, the area is optional for the team, and what it is about is typed in.
  const any = ANYTIME.find(x => x.key === ev) || null
  const [audience, setAudience] = useState<'guests' | 'owners' | 'team' | ''>(() => (ANYTIME.find(x => x.key === moment)?.audience || ''))
  const [goal, setGoal] = useState('')
  const [area, setArea] = useState<MarketKey | ''>('')
  const [vibe, setVibe] = useState('')
  /** The art style (Jon, 2026-11-20: "Add graphic design, new style"); '' leaves it to the designer. */
  const [style, setStyle] = useState('')
  const [channel, setChannel] = useState<ChannelKey | ''>('')
  const [seconds, setSeconds] = useState(0)
  const [note, setNote] = useState('')
  const [review, setReview] = useState(false)

  const m = events.find(x => x.key === ev) || (any ? ({ key: any.key, name: any.label, start: '', end: '', where: [] } as unknown as typeof events[number]) : undefined)
  const team = audience === 'team'
  const id = ev ? IDENTITIES[ev] : null
  // a piece for no event has no event dates to fill or price
  const goals = (audience ? GOALS[audience] : []).filter(x => !any || (x.key !== 'book-dates' && x.key !== 'big-dates'))
  // where the event happens comes first; every area we have units in can be chosen
  // then the wider markets (Jon, 2026-11-20: "more options, broader markets"), then the other single areas
  const areaOrder = useMemo(() => { const pref = (m?.where || []) as MarketKey[]; const wide = MARKETS.filter(x => x.areas.length > 1).map(x => x.key); return pref.concat(wide, MARKETS.map(x => x.key).filter(k => pref.indexOf(k) < 0 && wide.indexOf(k) < 0)) }, [m])
  const homes = (k: string, n: number) => { const b = buildingsIn(marketAreas(k)).map(buildingName); return b.slice(0, n).join(', ') + (b.length > n ? ` +${b.length - n} more` : '') }
  const [noPhotos, setNoPhotos] = useState(false)
  const done = !!(m && audience && goal && (area || (team && noPhotos)) && vibe && channel && seconds && (!any || note.trim().length >= 4))
  const g = goals.find(x => x.key === goal), v = VIBES.find(x => x.key === vibe), a = team ? TEAM_AUDIENCE : AUDIENCES.find(x => x.key === audience)

  const brief = (): Brief => ({
    goal: g?.brief || '', audience: audience === 'owners' ? 'owners' : audience === 'team' ? 'team' : 'guests', who: a?.brief || '', takeaway: '',
    moment: ev, momentName: m?.name || '', dates: m && !any ? whenShortOf(m) : '', area: area || '', areaLabel: area ? MARKET_LABEL[area] : '', vibe: v?.brief || '',
    channel: (channel || 'vertical') as ChannelKey, seconds: seconds || 15, note: note.trim().slice(0, 400), style, confirmedBy: '', confirmedAt: '',
  })

  if (review && done && m) {
    const ch = CHANNELS[channel as ChannelKey]
    const rows: [string, string][] = [
      any ? ['Piece', any.label + ' — ' + any.hint] as [string, string] : ['Event', `${m.name} · ${whenShortOf(m)}${m.approx ? ' (dates to confirm)' : ''}`],
      ['For', `${a!.label} — ${a!.brief}`],
      ['It should', g!.brief],
      ['Where', area ? `${MARKET_LABEL[area]} — only our units there (${homes(area, 6)})` : 'No unit photographs: type, colour and design only'],
      ['Vibe', v!.label],
      ['Style', (STYLES.find(x => x.key === style) || STYLES[0]).label + (style ? ' — with graphics made for the piece by AI' : '')],
      ['Format', `${ch.label} · ${ch.hint} · about ${seconds} seconds`],
      ...(note.trim() ? [[any ? 'About' : 'Must say', note.trim()] as [string, string]] : []),
    ]
    return (
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '26px 24px 40px', color: UI.ink }}>
        <p style={{ fontFamily: display, fontWeight: 800, fontSize: 24, margin: '0 0 4px' }}>Is this the brief?</p>
        <p style={{ fontSize: 13, color: UI.mut, margin: '0 0 16px' }}>Nothing has been made yet. When you confirm, the studio looks through our photographs for that area and comes back with three ideas.</p>
        <div style={{ background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 14, padding: '6px 16px' }}>
          {rows.map(([k, val]) => (
            <div key={k} style={{ display: 'flex', gap: 14, padding: '10px 0', borderBottom: '1px solid ' + UI.line, fontSize: 13.5 }}>
              <span style={{ width: 84, flex: 'none', color: UI.gold, fontWeight: 800, fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase', paddingTop: 2 }}>{k}</span>
              <span style={{ lineHeight: 1.5 }}>{val}</span>
            </div>
          ))}
          <p style={{ fontSize: 12, color: UI.mut, margin: '10px 0' }}>Always: the Stay logo, {audience === 'guests' ? 'no prices, ends on “Book at stay-hospitality.com”' : team ? 'nothing to sell, ends on the mark' : 'ends on Nick’s line'}, one photograph at a time, never the same one twice, colours and motifs for {id?.name}.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" disabled={busy} onClick={() => onConfirm(brief())} style={{ fontSize: 14, fontWeight: 800, padding: '11px 20px', borderRadius: 10, border: 0, background: UI.gold, color: '#0B0F16', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Working…' : 'Confirm the brief → three ideas'}</button>
          <button type="button" disabled={busy} onClick={() => setReview(false)} style={{ fontSize: 13, fontWeight: 700, padding: '11px 16px', borderRadius: 10, border: '1px solid ' + UI.line, background: 'transparent', color: UI.ink, cursor: 'pointer' }}>← Change something</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '26px 24px 40px', color: UI.ink }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <p style={{ fontFamily: display, fontWeight: 800, fontSize: 24, margin: 0 }}>What are we making?</p>
        <button type="button" onClick={onCancel} style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, padding: '6px 11px', borderRadius: 8, border: '1px solid ' + UI.line, background: 'transparent', color: UI.mut, cursor: 'pointer' }}>✕ Close</button>
      </div>
      <p style={{ fontSize: 13, color: UI.mut, margin: '0 0 22px' }}>A few quick choices. The piece is designed for exactly this — the event, the people, the place — and nothing is built until you confirm.</p>

      <Q n={1} title="What is it?" note="an event, or a piece for any time">
        {events.map(e => <Chip key={e.key} on={ev === e.key} onClick={() => { setEv(e.key); setArea(''); if (audience === 'team') { setAudience(''); setGoal('') } }} hint={whenShortOf(e)}>{e.emoji} {IDENTITIES[e.key]?.name || e.name}</Chip>)}
        {ANYTIME.filter(x => ADX_ANYTIME.indexOf(x.key) >= 0).map(x => <Chip key={x.key} on={ev === x.key} onClick={() => { setEv(x.key); setArea(''); setAudience(x.audience); setGoal(''); setNoPhotos(false) }} hint={x.hint}>{x.emoji} {x.label}</Chip>)}
      </Q>
      {any ? (
        <section style={{ margin: '0 0 22px' }}>
          <p style={{ margin: '0 0 9px', fontSize: 13, fontWeight: 800, color: UI.ink }}>What is it about? <span style={{ fontWeight: 500, color: UI.mut }}>the news, the event, the people — in your words</span></p>
          <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={400} rows={2} placeholder={team ? 'e.g. Holiday lunch, Fri Dec 18, noon at the Fort Lauderdale office. Thank you for a record year.' : any.key === 'ownerstory' ? 'e.g. Why owners in Miami Beach switch to Stay: 15% fee, 40+ platforms, a local team' : 'e.g. Long weekends by the water: balconies, pools, full kitchens'}
            style={{ width: '100%', boxSizing: 'border-box', background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 10, color: UI.ink, padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit', resize: 'vertical' }} />
        </section>
      ) : null}
      <Q n={2} title="Who is it for?">
        {any ? <Chip on onClick={() => {}} hint={a?.hint}>{a?.label || ''}</Chip> : AUDIENCES.map(x => <Chip key={x.key} on={audience === x.key} onClick={() => { setAudience(x.key as 'guests' | 'owners'); setGoal('') }} hint={x.hint}>{x.label}</Chip>)}
      </Q>
      <Q n={3} title="What should it do?" note={audience ? '' : 'pick who it is for first'}>
        {goals.map(x => <Chip key={x.key} on={goal === x.key} onClick={() => setGoal(x.key)} hint={x.hint}>{x.label}</Chip>)}
        {!goals.length ? <span style={{ fontSize: 12.5, color: UI.mut }}>—</span> : null}
      </Q>
      <Q n={4} title="Where?" note={team ? 'unit photographs from one market, or none at all' : 'one area, or a wider market — the piece shows only our units there'}>
        {team ? <Chip on={noPhotos && !area} onClick={() => { setNoPhotos(true); setArea('') }} hint="Type, colour and design only">No unit photos</Chip> : null}
        {areaOrder.map(k => <Chip key={k} on={area === k} onClick={() => { setArea(k); setNoPhotos(false) }} hint={homes(k, 3)}>{MARKET_LABEL[k]}{m?.where && (m.where as string[]).indexOf(k) >= 0 ? ' · where it happens' : ''}</Chip>)}
      </Q>
      <Q n={5} title="The vibe?">
        {VIBES.map(x => <Chip key={x.key} on={vibe === x.key} onClick={() => setVibe(x.key)}>{x.label}</Chip>)}
      </Q>
      <Q n={6} title="The style?" note="how it is drawn — the designer can call for AI-made graphics in this style">
        {STYLES.map(x => <Chip key={x.key || 'any'} on={style === x.key} onClick={() => setStyle(x.key)} hint={x.hint}>{x.label}</Chip>)}
      </Q>
      <Q n={7} title="Where will it run?">
        {(Object.keys(CHANNELS) as ChannelKey[]).map(k => <Chip key={k} on={channel === k} onClick={() => setChannel(k)} hint={CHANNELS[k].hint}>{CHANNELS[k].label}</Chip>)}
      </Q>
      <Q n={8} title="How long?">
        {LENGTHS.map(s => <Chip key={s} on={seconds === s} onClick={() => setSeconds(s)}>{s} seconds</Chip>)}
      </Q>
      {any ? null : <section style={{ margin: '0 0 22px' }}>
        <p style={{ margin: '0 0 9px', fontSize: 13, fontWeight: 800, color: UI.ink }}>Anything it must say? <span style={{ fontWeight: 500, color: UI.mut }}>optional</span></p>
        <input value={note} onChange={e => setNote(e.target.value)} maxLength={400} placeholder="e.g. mention the rooftop pool, or a property by name"
          style={{ width: '100%', boxSizing: 'border-box', background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 10, color: UI.ink, padding: '10px 12px', fontSize: 13.5 }} />
      </section>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" disabled={!done} onClick={() => setReview(true)} style={{ fontSize: 14, fontWeight: 800, padding: '11px 20px', borderRadius: 10, border: 0, background: done ? UI.gold : UI.panel2, color: done ? '#0B0F16' : UI.mut, cursor: done ? 'pointer' : 'default' }}>Review the brief →</button>
        {!done ? <span style={{ fontSize: 12.5, color: UI.mut }}>{any && note.trim().length < 4 ? 'Say what it is about, and answer every question, to continue.' : 'Answer every question to continue.'}</span> : null}
        {ev && !any ? <button type="button" disabled={busy} onClick={() => onHouse(ev)} title="Opens the studio's own finished design for this event, ready to edit. No AI is used." style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, padding: '9px 13px', borderRadius: 10, border: '1px solid ' + UI.line, background: 'transparent', color: UI.ink, cursor: 'pointer' }}>Or open the house design for {id?.name} (no AI)</button> : null}
      </div>
    </div>
  )
}
