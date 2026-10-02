'use client'
// ARRIVALS ON TODAY (Jon, 2026-10-02: "take Today and take Front desk and take the best parts, but
// get rid of the Front desk tab on the VR side — it feels like a double"). The Front Desk board's
// best idea was the arrival card that travels Notice → Call → Ready. That card is now a row on
// Today, one per arrival, with the same two actions it had there: mark the building notice sent,
// and log the welcome call. Reads /api/front-desk exactly as the board did; writes go through the
// Notices desk and the Calls desk endpoints, so nothing about the record changed.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, ChevronUp, Loader2, PhoneOff, Voicemail } from 'lucide-react'
import { Tag } from '@/components/lean'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import type { FdArrival, FdData } from '@/app/api/front-desk/route'
import { Row, LIST, GHOST, DARK } from '@/components/command/Hub'

type CallOutcome = 'reached' | 'voicemail' | 'no_answer' | 'claim'
const URL = '/api/front-desk'
const CH = (s: string) => String(s || '').replace(/airbnb2?/i, 'Airbnb').replace(/bookingcom|booking\.com/i, 'Booking.com').replace(/expedia/i, 'Expedia').replace(/vrbo|homeaway/i, 'Vrbo').replace(/direct|website|manual/i, 'Direct')
const shortUnit = (u: string) => String(u || '').replace(/\s+-\s+.*$/, '')

export function ArrivalsLane() {
  const { data, loading, refresh } = useCachedFetch<FdData>(URL, { ttl: 60_000 })
  const reload = () => { invalidateCache(URL); refresh() }
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [all, setAll] = useState(false)
  const [initials, setInitials] = useState('')
  useEffect(() => { try { setInitials(localStorage.getItem('frontdesk.initials') || '') } catch { /* fine */ } }, [])

  const post = (u: string, body: any) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const act = async (key: string, fn: () => Promise<Response>) => {
    setBusy(key); setErr('')
    try { const r = await fn(); const j = await r.json().catch(() => ({})); if (!r.ok || j?.error) throw new Error(j?.error || 'That did not save.'); reload() }
    catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  const call = (a: FdArrival, outcome: CallOutcome) => act('call:' + a.reservationId, () => post('/api/welcome-call', { reservationId: a.reservationId, outcome, tier: a.tier || 'standard' }))
  const markSent = (a: FdArrival) => {
    if (!a.notice) return
    let ini = initials
    if (ini.length < 2) { const v = window.prompt('Your initials (so the record shows who sent it):', '') || ''; ini = v.trim().toUpperCase().slice(0, 4); if (ini.length < 2) return; setInitials(ini); try { localStorage.setItem('frontdesk.initials', ini) } catch { /* fine */ } }
    return act('notice:' + a.notice.id, () => post('/api/reservation-notices/mark-sent', { id: a.notice!.id, initials: ini }))
  }

  const arrivals = data?.arrivals || []
  // Open work first (notice not sent, then call owed), ready last; VIP/mandatory ahead within each.
  const sorted = useMemo(() => arrivals.slice().sort((a, b) => {
    const rank = (x: FdArrival) => x.ready ? 3 : (x.notice && !x.notice.sent) ? 0 : (x.call.due && !x.call.done) ? 1 : 2
    return rank(a) - rank(b) || Number(b.mandatory) - Number(a.mandatory) || String(a.checkIn).localeCompare(String(b.checkIn))
  }), [arrivals])
  const openCount = sorted.filter(a => !a.ready).length
  const shown = all ? sorted : sorted.filter(a => !a.ready).slice(0, 8)
  const s = data?.summary
  if (!data && !loading) return null
  if (data && !arrivals.length) return null

  return (
    <section>
      <h2 className="px-1 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink flex items-center gap-2">
        <span>Arrivals {arrivals.length ? <span className="text-muted font-medium">{arrivals.length}</span> : null}</span>
        <span className="normal-case tracking-normal font-medium text-muted">
          {s ? `— ${s.ready} ready · ${s.noticesSent} of ${s.noticesNeeded} notices sent · ${s.callsDone} of ${s.callsNeeded} calls made` : loading ? '— reading the day…' : ''}
        </span>
        <Link href="/front-desk" className="ml-auto text-[11px] font-semibold text-brand-700 hover:underline normal-case tracking-normal">Front desk →</Link>
      </h2>
      {shown.length > 0 && (
        <div className={LIST}>
          {shown.map(a => {
            const noticeOpen = !!a.notice && !a.notice.sent
            const callOpen = a.call.due && !a.call.done
            const b = busy === 'call:' + a.reservationId || (a.notice ? busy === 'notice:' + a.notice.id : false)
            return (
              <Row key={a.reservationId} dot={a.ready ? null : noticeOpen && a.notice?.form ? 'rose' : 'amber'} title={a.guest || 'Guest'}
                tags={<>
                  {a.mandatory && <Tag tone="violet" title="A call the house always makes (VIP, long stay, high value or first-timer)">must call</Tag>}
                  {a.notice && <Tag tone={a.notice.sent ? 'emerald' : a.notice.form ? 'rose' : 'amber'} title={a.notice.sent ? `Building notice sent${a.notice.sentBy ? ' by ' + a.notice.sentBy : ''}` : a.notice.form ? 'The building needs its registration form before this guest arrives' : 'The building notice has not gone out yet'}>{a.notice.sent ? 'notice sent' : a.notice.form ? 'form due' : 'notice due'}</Tag>}
                  <Tag tone={a.call.done ? 'emerald' : callOpen ? 'amber' : 'slate'} title={a.call.done ? `Welcome call ${a.call.outcome}${a.call.by ? ' · ' + a.call.by : ''}` : callOpen ? 'Welcome call still owed' : 'No call owed on this one'}>{a.call.done ? 'called' : callOpen ? 'call owed' : 'no call'}</Tag>
                  {a.ready && <Tag tone="emerald" title="Notice sent and call made">ready</Tag>}
                </>}
                meta={`${shortUnit(a.unit)} · ${CH(a.channel)}${a.nights ? ` · ${a.nights} night${a.nights === 1 ? '' : 's'}` : ''}${a.phone ? ' · ' + a.phone : ''}`}
                actions={a.ready ? null : <>
                  {noticeOpen && data?.canSend && <button onClick={() => markSent(a)} disabled={!!busy} className={GHOST} title="The building has its notice — record who sent it">{b ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Sent</button>}
                  {callOpen && data?.canCall && <>
                    <button onClick={() => call(a, 'no_answer')} disabled={!!busy} className={GHOST} title="No answer — try again later"><PhoneOff size={12} /></button>
                    <button onClick={() => call(a, 'voicemail')} disabled={!!busy} className={GHOST} title="Left a voicemail"><Voicemail size={12} /></button>
                    <button onClick={() => call(a, 'reached')} disabled={!!busy} className={DARK} title="Reached the guest">{b ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Reached</button>
                  </>}
                </>} />
            )
          })}
        </div>
      )}
      {(openCount > 8 || arrivals.length > openCount) && (
        <button onClick={() => setAll(o => !o)} className="mt-1 px-1 text-[11.5px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1">
          {all ? <ChevronUp size={12} /> : <ChevronDown size={12} />}{all ? 'Fewer' : `All ${arrivals.length} arrivals`}
        </button>
      )}
      {err && <p className="px-1 mt-1 text-[11.5px] font-semibold text-rose-600">{err}</p>}
    </section>
  )
}
