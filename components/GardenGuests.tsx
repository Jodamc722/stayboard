'use client'
// GUESTS — every Garden Hotel guest and one profile each (Jon, 2026-11-10: "guest profiles … id
// verification … reading notes … Operto codes … see if they completed self check-in").
// List: in house first, then arriving, then everyone by last stay. Profile (?res= or a click): stays,
// spend, channels, the desk's notes read into tags with the notes in full, ID and card per stay,
// the Operto door code and self check-in, the calls.
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Contact, Loader2, Mail, Phone, Search, X } from 'lucide-react'
import { Tag, LeanPick, type Tone } from '@/components/lean'

const j = async (u: string) => { const r = await fetch(u, { cache: 'no-store' }); return r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` })) }
const usd = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US')
const dayShort = (ymd: string) => ymd ? new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: ymd.slice(0, 4) === String(new Date().getFullYear()) ? undefined : '2-digit', timeZone: 'UTC' }) : ''
type View = 'now' | 'vip' | 'repeat' | 'all'

export function GardenGuests() {
  const sp = useSearchParams(), router = useRouter()
  const [d, setD] = useState<any | null>(null)
  const [q, setQ] = useState('')
  const [view, setView] = useState<View>('now')
  const [prof, setProf] = useState<any | null>(null)
  const [pErr, setPErr] = useState('')
  const sel = sp.get('res') || sp.get('key')

  useEffect(() => { j('/api/garden/guests').then(setD) }, [])
  useEffect(() => {
    if (!sel) { setProf(null); return }
    setProf(null); setPErr('')
    j('/api/garden/guests?' + (sp.get('res') ? 'res=' : 'key=') + encodeURIComponent(sel)).then(r => r.ok ? setProf(r.profile) : setPErr(r.error || 'Could not load.'))
  }, [sel]) // eslint-disable-line react-hooks/exhaustive-deps
  const open = (key: string) => router.push('/garden/guests?key=' + encodeURIComponent(key), { scroll: false })
  const close = () => router.push('/garden/guests', { scroll: false })

  const guests: any[] = d?.guests || []
  const counts = useMemo(() => ({ now: guests.filter(g => g.current || g.next).length, vip: guests.filter(g => g.vip).length, repeat: guests.filter(g => g.stays > 1).length, all: guests.length }), [guests])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return guests.filter(g => (view === 'all' || (view === 'now' ? g.current || g.next : view === 'vip' ? g.vip : g.stays > 1))
      && (!s || [g.name, g.email, g.phone, g.current?.rooms?.join(' '), g.next?.rooms?.join(' '), g.channels.join(' ')].join(' ').toLowerCase().includes(s))).slice(0, 400)
  }, [guests, q, view])

  return (
    <div className="pb-10">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <Contact size={18} className="text-ink" /><h1 className="text-[20px] font-semibold text-ink">Guests</h1>
        {d?.ok ? <span className="text-[12px] text-muted">{guests.length.toLocaleString()} guests · {d.reservations.toLocaleString()} reservations from Cloudbeds</span> : null}
        <span className="flex-1" />
        <label className="relative"><Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, email, phone, room" className="h-8 w-60 rounded-lg border border-line bg-white pl-7 pr-2 text-[12.5px]" /></label>
      </div>
      <div className="mb-3"><LeanPick<View> size="sm" value={view} onPick={setView} options={[
        { v: 'now', label: <>Here &amp; arriving this week <span className="opacity-60 tabular-nums">{counts.now}</span></> },
        { v: 'vip', label: <>VIP <span className="opacity-60 tabular-nums">{counts.vip}</span></> },
        { v: 'repeat', label: <>Repeat <span className="opacity-60 tabular-nums">{counts.repeat}</span></> },
        { v: 'all', label: <>All <span className="opacity-60 tabular-nums">{counts.all}</span></> },
      ]} /></div>
      {!d ? <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading guests…</p>
        : !d.ok ? <p className="text-[13px] text-rose-700">{d.error}</p>
        : !shown.length ? <div className="rounded-xl border border-line bg-white p-6 text-center text-[13px] text-muted">No guests in this view.</div> : (
        <div className="rounded-xl border border-line bg-white overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="text-[10.5px] uppercase tracking-wider text-muted bg-app"><tr>{['Guest', 'Now', 'Stays', 'Nights', 'Spend', 'Channels', 'From the notes', 'Last stay'].map(h => <th key={h} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {shown.map(g => (
                <tr key={g.key} onClick={() => open(g.key)} className="border-t border-line hover:bg-app/60 cursor-pointer">
                  <td className="px-3 py-1.5 font-semibold text-ink whitespace-nowrap">{g.name}{g.vip ? <span className="ml-1"><Tag tone="violet">VIP</Tag></span> : null}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{g.current ? <Tag tone="brand">in house · {g.current.rooms.join(', ') || '—'} → {dayShort(g.current.checkOut)}</Tag> : g.next ? <Tag tone="emerald">arrives {dayShort(g.next.checkIn)}</Tag> : <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-1.5 tabular-nums">{g.stays}</td>
                  <td className="px-3 py-1.5 tabular-nums">{g.nights}</td>
                  <td className="px-3 py-1.5 tabular-nums">{g.spend ? usd(g.spend) : '—'}</td>
                  <td className="px-3 py-1.5 text-muted max-w-[12rem] truncate">{g.channels.join(', ')}</td>
                  <td className="px-3 py-1.5"><span className="inline-flex gap-1 flex-wrap">{g.tags.slice(0, 4).map((t: any) => <Tag key={t.key} tone={t.tone as Tone}>{t.label}</Tag>)}</span></td>
                  <td className="px-3 py-1.5 text-muted tabular-nums whitespace-nowrap">{dayShort(g.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sel ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={close}>
          <div className="w-full max-w-xl h-full bg-white shadow-xl p-5 overflow-y-auto" onClick={e => e.stopPropagation()}>
            {!prof ? (pErr ? <p className="text-[13px] text-rose-700">{pErr}</p> : <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>) : (
              <>
                <div className="flex items-start gap-2">
                  <div className="min-w-0">
                    <h2 className="text-[22px] font-semibold text-ink">{prof.name}</h2>
                    <div className="text-[12.5px] text-muted flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                      {prof.phone ? <a href={`tel:${prof.phone}`} className="inline-flex items-center gap-1 hover:text-ink"><Phone size={12} />{prof.phone}</a> : null}
                      {prof.email ? <a href={`mailto:${prof.email}`} className="inline-flex items-center gap-1 hover:text-ink truncate"><Mail size={12} />{prof.email}</a> : null}
                    </div>
                  </div>
                  <span className="flex-1" />
                  <button onClick={close} className="h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-neutral-100" aria-label="Close"><X size={16} /></button>
                </div>
                <div className="grid grid-cols-4 gap-2 mt-3">
                  {[['Stays', prof.totals.stays], ['Nights', prof.totals.nights], ['Spend', usd(prof.totals.spend)], ['Cancelled', prof.totals.cancelled]].map(([k, v]) => <div key={String(k)} className="rounded-lg border border-line px-2.5 py-1.5"><div className="text-[16px] font-bold text-ink tabular-nums">{v}</div><div className="text-[10.5px] text-muted">{k}</div></div>)}
                </div>
                <div className="text-[12px] text-muted mt-2">Books through {prof.channels.join(', ') || '—'}</div>

                <h3 className="text-[11px] uppercase tracking-wider text-muted font-semibold mt-4 mb-1.5">Stays</h3>
                <div className="space-y-2">
                  {prof.stays.map((st: any) => (
                    <div key={st.id} className="rounded-xl border border-line p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13.5px] font-semibold text-ink">{dayShort(st.checkIn)} → {dayShort(st.checkOut)}</span>
                        <span className="text-[12px] text-muted">{st.nights ?? '?'} nts · room {st.rooms.join(', ') || '—'} · {st.source || 'Direct'}</span>
                        <span className="flex-1" />
                        <Tag tone={st.status === 'canceled' ? 'rose' : st.status === 'checked_in' ? 'brand' : st.status === 'checked_out' ? 'slate' : 'emerald'}>{st.status.replace('_', ' ')}</Tag>
                      </div>
                      <div className="text-[12px] text-muted mt-0.5">{usd(st.total)}{st.balance > 0 ? <span className="text-amber-700 font-semibold"> · {usd(st.balance)} open</span> : ' · paid'} · <span className="font-mono">{st.id}</span></div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        <Tag tone={st.id.decision === 'passed' || st.id.onFile ? 'emerald' : st.id.decision === 'failed' ? 'rose' : 'slate'}>ID {st.id.decision ? st.id.decision : st.id.onFile ? 'on file' + (st.id.type ? ' · ' + st.id.type : '') : st.id.onFile === false ? 'not on file' : 'unknown'}</Tag>
                        <Tag tone={st.card.decision === 'passed' || st.card.onFile ? 'emerald' : st.card.decision === 'failed' ? 'rose' : 'slate'}>card {st.card.decision ? st.card.decision : st.card.onFile ? 'on file' : st.card.onFile === false ? 'none on file' : 'unknown'}</Tag>
                        {st.operto ? <>
                          {st.operto.code ? <Tag tone="brand">door code <span className="font-mono">{st.operto.code}</span></Tag> : null}
                          <Tag tone={st.operto.checkin === 'done' ? 'emerald' : st.operto.checkin === 'started' ? 'amber' : 'slate'}>self check-in {st.operto.checkin === 'done' ? 'done' : st.operto.checkin === 'started' ? 'started' : st.operto.checkin === 'not_started' ? 'not started' : '—'}</Tag>
                          {st.operto.codeUsedAt ? <Tag tone="brand">code used {String(st.operto.codeUsedAt).slice(0, 16).replace('T', ' ')}</Tag> : null}
                        </> : null}
                      </div>
                      {st.tags.length ? <div className="flex flex-wrap gap-1 mt-1.5">{st.tags.map((t: any) => <Tag key={t.key} tone={t.tone as Tone} title={t.detail || undefined}>{t.label}{t.detail ? ': ' + t.detail : ''}</Tag>)}</div> : null}
                      {st.notes.length ? <div className="mt-2 space-y-1">{st.notes.map((n: string, i: number) => <p key={i} className="text-[12px] text-ink bg-app rounded-lg px-2 py-1.5 whitespace-pre-wrap">{n}</p>)}</div> : null}
                    </div>
                  ))}
                </div>

                {prof.calls.length ? (<>
                  <h3 className="text-[11px] uppercase tracking-wider text-muted font-semibold mt-4 mb-1.5">Calls</h3>
                  <div className="space-y-1">{prof.calls.map((c: any, i: number) => <div key={i} className="text-[12px] text-ink flex gap-2"><span className="text-muted tabular-nums w-28 shrink-0">{new Date(c.called_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span><span>{c.kind} · {c.outcome}{c.called_by ? ' · ' + c.called_by : ''}{c.note ? ' — ' + c.note : ''}</span></div>)}</div>
                </>) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
