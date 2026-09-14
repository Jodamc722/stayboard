'use client'
// THE CONTACT LIST (Jon, 2026-09-14). A mailing list, not a lookup tool — /guests is the lookup.
//
// The screen is built around the one fact that decides everything downstream: how many of these
// people can you actually email. So that number is the headline, the reason an address fails sits
// next to the address, and the export defaults to the mailable rows. Nobody should be able to
// upload four thousand dead OTA relays to Mailchimp by accident from this page.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Loader2, Download, Search, RefreshCw, Mail, MailX, Star, Repeat, Send,
  CheckCircle2, AlertTriangle, Link2, Trash2, X,
} from 'lucide-react'

type Contact = {
  key: string; first: string; last: string; name: string
  email: string | null; mail: 'mailable' | 'relay' | 'invalid' | 'none'; mailReason: string
  phone: string | null
  channel: string; family: string; channels: string[]; everDirect: boolean
  stays: number; nights: number; value: number
  firstStay: string; lastStay: string; nextStay: string | null; inHouse: boolean
  units: string[]; buildings: string[]; markets: string[]
  lastUnit: string; lastBuilding: string | null
  reviews: number; reviewAvg: number | null
  vip: boolean; tags: string[]
}
type Summary = {
  contacts: number; mailable: number; relay: number; noEmail: number; withPhone: number
  repeat: number; everDirect: number
  channels: { label: string; count: number }[]
  buildings: { label: string; count: number }[]
}
type Mc = {
  connected: boolean; audienceId?: string; audienceName?: string; accountName?: string
  connectedBy?: string; connectedAt?: string; consentConfirmed?: boolean
  lastSyncAt?: string | null; lastSyncCount?: number | null; keyHint?: string
}

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const SEGS = [
  { key: '', label: 'Everyone' },
  { key: 'mailable', label: 'Can email' },
  { key: 'relay', label: 'OTA relay only' },
  { key: 'direct', label: 'Booked direct' },
  { key: 'ota', label: 'OTA guests' },
  { key: 'repeat', label: 'Repeat' },
  { key: 'vip', label: 'VIP' },
]

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-line px-4 py-3.5">
      <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted">{label}</p>
      <p className={'text-[22px] font-bold tabular-nums leading-tight mt-0.5 ' + (tone || 'text-ink')}>{value}</p>
      {sub ? <p className="text-[11.5px] text-muted mt-0.5">{sub}</p> : null}
    </div>
  )
}

export function ContactList() {
  const [data, setData] = useState<{ contacts: Contact[]; summary: Summary; shown: number; truncated?: boolean; shortReads?: string[] } | null>(null)
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [typed, setTyped] = useState('')
  const [seg, setSeg] = useState('')
  const [mc, setMc] = useState<Mc | null>(null)
  const [showMc, setShowMc] = useState(false)

  const load = useCallback(async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/contacts?q=' + encodeURIComponent(q) + '&seg=' + seg, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.message || j?.error || 'Could not load the contacts.')
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }, [q, seg])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    fetch('/api/integrations/mailchimp', { cache: 'no-store' })
      .then(r => r.json()).then(j => { if (j.ok) setMc(j.mailchimp) }).catch(() => {})
  }, [])

  // Typing shouldn't fire a query per keystroke against a 6,000-row aggregation.
  useEffect(() => { const t = setTimeout(() => setQ(typed.trim()), 350); return () => clearTimeout(t) }, [typed])

  const s = data?.summary
  const exportHref = useMemo(
    () => '/api/contacts?format=csv&seg=' + seg + '&q=' + encodeURIComponent(q) + (seg === 'relay' ? '&all=1' : ''),
    [seg, q])

  return (
    <div className="space-y-5">
      {/* the numbers that decide what you can do */}
      {s ? (
        <div className="grid gap-2.5 grid-cols-2 lg:grid-cols-4">
          <Stat label="Contacts" value={s.contacts.toLocaleString()} sub={s.withPhone.toLocaleString() + ' with a phone number'} />
          <Stat label="Can email" value={s.mailable.toLocaleString()} tone="text-emerald-700"
            sub={s.contacts ? Math.round((s.mailable / s.contacts) * 100) + '% of the list' : ''} />
          <Stat label="OTA relay only" value={s.relay.toLocaleString()} tone="text-amber-700" sub="not mailable — see below" />
          <Stat label="Repeat guests" value={s.repeat.toLocaleString()} sub={s.everDirect.toLocaleString() + ' have booked direct'} />
        </div>
      ) : null}

      {/* why the relay number is what it is — said once, plainly, where the number is */}
      {s && s.relay > 0 ? (
        <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 flex items-start gap-2.5">
          <AlertTriangle size={15} className="text-amber-600 mt-0.5 shrink-0" />
          <p className="text-[12.5px] text-amber-900 leading-relaxed">
            <span className="font-bold">{s.relay.toLocaleString()} guests only ever gave us a channel forwarding address</span>
            {' '}— things like <span className="font-mono text-[11.5px]">a1b2c3@guest.airbnb.com</span>. They stop working when
            the booking closes, they bounce, and marketing to them breaches the channel's terms. They stay here so the
            front desk can look someone up, and they are never uploaded to Mailchimp. The way to convert one is to win
            the direct booking.
          </p>
        </div>
      ) : null}

      {/* controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={typed} onChange={e => setTyped(e.target.value)}
            placeholder="Name, email, phone, unit or tag"
            className="w-full h-9 pl-9 pr-3 rounded-xl border border-line bg-white text-base sm:text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>
        <a href={exportHref} download
          className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl bg-ink text-white text-[12.5px] font-bold">
          <Download size={13} /> Export CSV
        </a>
        <button onClick={() => setShowMc(v => !v)}
          className={'h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl text-[12.5px] font-bold border ' +
            (mc?.connected ? 'border-line bg-white text-ink' : 'border-line bg-white text-muted hover:text-ink')}>
          <Send size={13} /> Mailchimp
          {mc?.connected ? <CheckCircle2 size={12} className="text-emerald-600" /> : null}
        </button>
        <button onClick={load} disabled={busy} aria-label="Refresh"
          className="h-9 w-9 grid place-items-center rounded-xl border border-line bg-white text-muted hover:text-ink disabled:opacity-40">
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {SEGS.map(x => (
          <button key={x.key} onClick={() => setSeg(x.key)}
            className={'text-[12.5px] font-semibold px-3 h-8 rounded-xl border transition ' +
              (seg === x.key ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink hover:border-ink/25')}>
            {x.label}
          </button>
        ))}
      </div>

      {showMc ? <MailchimpPanel mc={mc} setMc={setMc} seg={seg} onClose={() => setShowMc(false)} /> : null}

      {data?.truncated ? (
        <p className="text-[12px] text-amber-800 font-semibold">
          The {(data.shortReads || ['data']).join(' and ')} read came back short, so this list may be incomplete —
          treat the counts as a floor. Worth telling Claude, with this line.
        </p>
      ) : null}

      {err ? <div className="rounded-xl bg-rose-50 ring-1 ring-rose-200 px-4 py-3 text-[13px] text-rose-700">{err}</div> : null}

      {/* the list */}
      {busy && !data ? (
        <div className="rounded-2xl bg-white ring-1 ring-line p-12 text-center text-sm text-muted">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Building the contact list…
        </div>
      ) : !data?.contacts.length ? (
        <div className="rounded-2xl bg-white ring-1 ring-line p-12 text-center text-[13px] text-muted">
          Nobody matches that.
        </div>
      ) : (
        <>
          <p className="text-[12px] text-muted">
            Showing {data.contacts.length.toLocaleString()}
            {data.shown > data.contacts.length ? ' of ' + data.shown.toLocaleString() + ' matches' : ''}
            {' '}— the CSV contains every match.
          </p>
          <div className="rounded-2xl bg-white ring-1 ring-line overflow-hidden">
            <div className="divide-y divide-line">
              {data.contacts.map(c => <Row key={c.key} c={c} />)}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Row({ c }: { c: Contact }) {
  return (
    <div className="px-4 py-3 flex items-start gap-3 flex-wrap sm:flex-nowrap hover:bg-app/40">
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-ink leading-tight flex items-center gap-1.5 flex-wrap">
          <span className="truncate">{c.first} {c.last}</span>
          {c.vip ? <span className="text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-violet-100 text-violet-800">VIP</span> : null}
          {c.inHouse ? <span className="text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">In house</span> : null}
          {c.tags.map(t => <span key={t} className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-app text-muted ring-1 ring-line">{t}</span>)}
        </p>
        <p className="text-[12px] mt-0.5 flex items-center gap-1.5 flex-wrap">
          {c.mail === 'mailable' ? (
            <span className="inline-flex items-center gap-1 text-ink"><Mail size={11} className="text-emerald-600" />{c.email}</span>
          ) : c.email ? (
            <span title={c.mailReason} className="inline-flex items-center gap-1 text-muted">
              <MailX size={11} className="text-amber-600" />
              <span className="line-through decoration-amber-400/60">{c.email}</span>
              <span className="text-[10.5px] text-amber-700 font-semibold">not mailable</span>
            </span>
          ) : (
            <span className="text-muted inline-flex items-center gap-1"><MailX size={11} /> no email</span>
          )}
          {c.phone ? <span className="text-muted">· {c.phone}</span> : null}
        </p>
        {c.mail !== 'mailable' && c.email ? (
          <p className="text-[11px] text-amber-700 mt-0.5">{c.mailReason}</p>
        ) : null}
      </div>

      <div className="text-[11.5px] text-muted shrink-0 sm:w-[210px] leading-relaxed">
        <p className="text-ink font-semibold text-[12px]">{c.channel || '—'}</p>
        <p className="truncate" title={c.units.join(', ')}>{c.lastUnit || '—'}</p>
        {c.units.length > 1 ? <p className="text-faint">+{c.units.length - 1} more unit{c.units.length > 2 ? 's' : ''}</p> : null}
      </div>

      <div className="text-[11.5px] text-muted shrink-0 sm:w-[150px] leading-relaxed">
        <p className="inline-flex items-center gap-1 text-ink font-semibold text-[12px]">
          <Repeat size={11} /> {c.stays} stay{c.stays === 1 ? '' : 's'}
        </p>
        <p>{c.nights} night{c.nights === 1 ? '' : 's'} · {usd(c.value)}</p>
        <p className="inline-flex items-center gap-1">
          <Star size={10} className={c.reviews ? 'text-amber-500' : 'text-line'} />
          {c.reviews ? c.reviews + ' review' + (c.reviews === 1 ? '' : 's') + (c.reviewAvg ? ' · ' + c.reviewAvg : '') : 'no reviews'}
        </p>
      </div>
    </div>
  )
}

function MailchimpPanel({ mc, setMc, seg, onClose }: { mc: Mc | null; setMc: (m: Mc) => void; seg: string; onClose: () => void }) {
  const [apiKey, setApiKey] = useState('')
  const [auds, setAuds] = useState<{ id: string; name: string; members: number }[] | null>(null)
  const [pick, setPick] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [result, setResult] = useState<any>(null)

  const call = async (body: any, tag: string) => {
    setBusy(tag); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/integrations/mailchimp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.message || j?.error || 'That did not work.')
      setBusy('')
      return j
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(''); return null }
  }

  return (
    <div className="rounded-2xl bg-white ring-1 ring-line overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2">
        <Send size={14} className="text-muted" />
        <p className="text-[13.5px] font-bold text-ink">Mailchimp</p>
        <button onClick={onClose} className="ml-auto text-muted hover:text-ink p-1 -m-1 rounded-lg hover:bg-app"><X size={15} /></button>
      </div>

      <div className="px-4 py-4 space-y-4">
        {!mc?.connected ? (
          <>
            <p className="text-[12.5px] text-muted leading-relaxed">
              Paste an API key from Mailchimp (Account → Extras → API keys). It is stored on the server, never
              shown back to the browser, and is only ever used to talk to Mailchimp.
            </p>
            <div className="flex gap-2 flex-wrap">
              <input value={apiKey} onChange={e => setApiKey(e.target.value)} type="password"
                autoComplete="off" placeholder="Mailchimp API key"
                className="flex-1 min-w-[240px] h-9 px-3 rounded-xl border border-line bg-white text-base sm:text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-brand-200" />
              <button disabled={!apiKey.trim() || !!busy}
                onClick={async () => {
                  const j = await call({ op: 'probe', apiKey: apiKey.trim() }, 'probe')
                  if (j) { setAuds(j.audiences || []); setPick((j.audiences || [])[0]?.id || ''); setMsg('Key works — pick the audience.') }
                }}
                className="h-9 px-4 rounded-xl bg-ink text-white text-[12.5px] font-bold disabled:bg-line disabled:text-faint inline-flex items-center gap-1.5">
                {busy === 'probe' ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />} Check key
              </button>
            </div>

            {auds ? (
              !auds.length ? (
                <p className="text-[12.5px] text-amber-800 font-semibold">That account has no audiences yet — create one in Mailchimp first.</p>
              ) : (
                <div className="space-y-2.5">
                  <select value={pick} onChange={e => setPick(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-xl border border-line bg-white text-[13px]">
                    {auds.map(a => <option key={a.id} value={a.id}>{a.name} — {a.members.toLocaleString()} members</option>)}
                  </select>
                  <label className="flex items-start gap-2 text-[12px] text-muted leading-relaxed">
                    <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5" />
                    <span>
                      These guests agreed to hear from us, so add new contacts as <b>subscribed</b>. Leave this off and
                      they go in as <b>transactional</b> — they land in the audience but are not counted as marketing
                      opt-ins, which is the safe default. Anyone who already unsubscribed is never re-subscribed either way.
                    </span>
                  </label>
                  <button disabled={!pick || !!busy}
                    onClick={async () => {
                      const j = await call({ op: 'connect', apiKey: apiKey.trim(), audienceId: pick, consentConfirmed: consent }, 'connect')
                      if (j) { setMc(j.mailchimp); setApiKey(''); setAuds(null); setMsg('Connected.') }
                    }}
                    className="h-9 px-4 rounded-xl bg-ink text-white text-[12.5px] font-bold disabled:bg-line disabled:text-faint inline-flex items-center gap-1.5">
                    {busy === 'connect' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Connect
                  </button>
                </div>
              )
            ) : null}
          </>
        ) : (
          <>
            <div className="flex items-start gap-2 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <p className="text-[13px] font-semibold text-ink">{mc.audienceName}</p>
                <p className="text-[11.5px] text-muted">
                  {mc.accountName ? mc.accountName + ' · ' : ''}key {mc.keyHint} · connected by {mc.connectedBy}
                </p>
                <p className="text-[11.5px] text-muted mt-0.5">
                  {mc.lastSyncAt
                    ? 'Last push ' + new Date(mc.lastSyncAt).toLocaleString() + ' — ' + (mc.lastSyncCount ?? 0).toLocaleString() + ' contacts'
                    : 'Nothing pushed yet.'}
                </p>
              </div>
              <button onClick={async () => { const j = await call({ op: 'disconnect' }, 'dc'); if (j) setMc(j.mailchimp) }}
                className="h-8 px-3 rounded-xl border border-line bg-white text-[12px] font-semibold text-muted hover:text-rose-700 inline-flex items-center gap-1.5">
                <Trash2 size={12} /> Disconnect
              </button>
            </div>

            <label className="flex items-start gap-2 text-[12px] text-muted leading-relaxed">
              <input type="checkbox" checked={!!mc.consentConfirmed} className="mt-0.5"
                onChange={async e => { const j = await call({ op: 'consent', on: e.target.checked }, 'consent'); if (j) setMc(j.mailchimp) }} />
              <span>Add new contacts as <b>subscribed</b> (I confirm these guests consented to marketing). Off = transactional.</span>
            </label>

            <div className="rounded-xl bg-app ring-1 ring-line px-3.5 py-3">
              <p className="text-[12px] text-muted leading-relaxed">
                Pushing sends only the addresses marked <b>can email</b> — relays are filtered out here and again on the
                server. Each contact goes up with first name, last name and phone, tagged with their booking channel,
                stay count, building, market, VIP and your own tags.
                {seg ? <> The current filter <b>{SEGS.find(x => x.key === seg)?.label}</b> is applied.</> : null}
              </p>
              <div className="flex gap-2 flex-wrap mt-2.5">
                <button disabled={!!busy}
                  onClick={async () => { const j = await call({ op: 'sync', seg, dryRun: true }, 'dry'); if (j) { setResult(j.result); setMsg('Dry run — nothing was sent.') } }}
                  className="h-9 px-3.5 rounded-xl border border-line bg-white text-[12.5px] font-bold text-ink inline-flex items-center gap-1.5">
                  {busy === 'dry' ? <Loader2 size={13} className="animate-spin" /> : null} Count first
                </button>
                <button disabled={!!busy}
                  onClick={async () => { const j = await call({ op: 'sync', seg }, 'sync'); if (j) { setResult(j.result); setMc(j.mailchimp); setMsg('Pushed to Mailchimp.') } }}
                  className="h-9 px-4 rounded-xl bg-ink text-white text-[12.5px] font-bold disabled:bg-line disabled:text-faint inline-flex items-center gap-1.5">
                  {busy === 'sync' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Push to Mailchimp
                </button>
              </div>
            </div>

            {result ? (
              <div className="text-[12.5px] text-ink space-y-1">
                <p>
                  <b>{result.attempted.toLocaleString()}</b> mailable contacts
                  {result.created || result.updated ? <> · {result.created.toLocaleString()} new · {result.updated.toLocaleString()} updated</> : null}
                  {result.failed ? <span className="text-rose-700"> · {result.failed.toLocaleString()} rejected</span> : null}
                </p>
                <p className="text-muted text-[11.5px]">{result.skippedNotMailable.toLocaleString()} held back — no usable address.</p>
                {(result.errors || []).slice(0, 5).map((e: any, i: number) => (
                  <p key={i} className="text-[11.5px] text-rose-700">{e.email}: {e.reason}</p>
                ))}
              </div>
            ) : null}
          </>
        )}

        {msg ? <p className="text-[12.5px] font-semibold text-emerald-700">{msg}</p> : null}
        {err ? <p className="text-[12.5px] font-semibold text-rose-700">{err}</p> : null}
      </div>
    </div>
  )
}
