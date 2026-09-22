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
  CheckCircle2, Link2, Trash2, X, Ban,
} from 'lucide-react'
import { LeanHead, Pill, Tag, LeanList, LeanRow, LeanEmpty, IconBtn, Tip } from '@/components/lean'

type Contact = {
  key: string; first: string; last: string; name: string
  email: string | null; mail: 'mailable' | 'restricted' | 'relay' | 'invalid' | 'none'; mailReason: string
  phone: string | null; restricted: boolean
  channel: string; family: string; channels: string[]; everDirect: boolean
  stays: number; nights: number; value: number
  firstStay: string; lastStay: string; nextStay: string | null; inHouse: boolean
  units: string[]; buildings: string[]; markets: string[]
  lastUnit: string; lastBuilding: string | null
  reviews: number; reviewAvg: number | null; reviewLow: number | null; unhappy: boolean
  vip: boolean; tags: string[]
}
type Summary = {
  contacts: number; mailable: number; restricted: number; relay: number; noEmail: number; withPhone: number
  repeat: number; everDirect: number; unhappy: number; mailableAfterUnhappy: number
  channels: { label: string; count: number; mailable: number }[]
  buildings: { label: string; count: number }[]
}
type Mc = {
  connected: boolean; audienceId?: string; audienceName?: string; accountName?: string
  connectedBy?: string; connectedAt?: string; consentConfirmed?: boolean
  lastSyncAt?: string | null; lastSyncCount?: number | null; keyHint?: string
}

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
// TWO AXES, NOT ONE LIST (Jon, 2026-09-14: "better organize ... want to see by ota filter").
// WHO they are is one question; WHETHER we may email them is another. Mixing "Airbnb" and
// "can email" into a single row of chips made it impossible to ask "which Airbnb guests can I
// email?" — the commonest question there is. Channel is its own row now.
const SEGS = [
  { key: '', label: 'Everyone' },
  { key: 'mailable', label: 'Can email' },
  { key: 'restricted', label: 'Channel blocked' },
  { key: 'relay', label: 'Relay address' },
  { key: 'noemail', label: 'No email' },
  { key: 'direct', label: 'Booked direct' },
  { key: 'repeat', label: 'Repeat' },
  { key: 'vip', label: 'VIP' },
  { key: 'unhappy', label: 'Left a low rating' },
]

export function ContactList() {
  const [data, setData] = useState<{ contacts: Contact[]; summary: Summary; shown: number; truncated?: boolean; shortReads?: string[]; restrictedChannels?: string[] } | null>(null)
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [typed, setTyped] = useState('')
  const [seg, setSeg] = useState('')
  const [chan, setChan] = useState('')
  const [mc, setMc] = useState<Mc | null>(null)
  const [showMc, setShowMc] = useState(false)
  const [showRules, setShowRules] = useState(false)

  const load = useCallback(async (fresh?: boolean) => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/contacts?q=' + encodeURIComponent(q) + '&seg=' + seg + '&channel=' + encodeURIComponent(chan)
        + (fresh ? '&fresh=1' : ''), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.message || j?.error || 'Could not load the contacts.')
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }, [q, seg, chan])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    fetch('/api/integrations/mailchimp', { cache: 'no-store' })
      .then(r => r.json()).then(j => { if (j.ok) setMc(j.mailchimp) }).catch(() => {})
  }, [])

  // Typing shouldn't fire a query per keystroke against a 6,000-row aggregation.
  useEffect(() => { const t = setTimeout(() => setQ(typed.trim()), 350); return () => clearTimeout(t) }, [typed])

  const s = data?.summary
  const exportHref = useMemo(
    () => '/api/contacts?format=csv&seg=' + seg + '&channel=' + encodeURIComponent(chan) + '&q=' + encodeURIComponent(q)
      + (seg === 'relay' || seg === 'restricted' || seg === 'noemail' ? '&all=1' : ''),
    [seg, q, chan])

  const blockedNames = (data?.restrictedChannels || []).join(', ') || 'No channels'
  const sel = 'text-[12px] py-1 pl-2 pr-6 rounded-lg border border-line bg-white text-ink'
  return (
    <div className="space-y-3">
      <LeanHead title="Contacts">
        {s ? <>
          <Pill title={'Every guest of the last two years as a mailing list · ' + s.withPhone.toLocaleString() + ' with a phone number'}>{s.contacts.toLocaleString()} contacts</Pill>
          <Pill tone="emerald" title={s.contacts ? Math.round((s.mailable / s.contacts) * 100) + '% of the list can be emailed' : 'Can be emailed'}>{(s.mailableAfterUnhappy ?? s.mailable).toLocaleString()} will email</Pill>
          <Pill tone="amber" title={[s.restricted ? s.restricted.toLocaleString() + ' channel-blocked' : '', s.relay ? s.relay.toLocaleString() + ' relay' : '', s.noEmail ? s.noEmail.toLocaleString() + ' no address' : ''].filter(Boolean).join(' · ')}>{(s.restricted + s.relay + s.noEmail).toLocaleString()} cannot</Pill>
          <Pill title={s.everDirect.toLocaleString() + ' have booked direct'}>{s.repeat.toLocaleString()} repeat</Pill>
          {/* WHO IS OFF LIMITS, AND WHY — the reasons live in the hover; the fix differs per reason. */}
          {s.unhappy > 0 ? <Pill tone="rose" onClick={() => setSeg('unhappy')}
            title={'Lowest rating 3 stars or fewer — never pushed or in the default export. The test is their LOWEST rating, not the average: winning them back is a phone call, not a campaign. Click to see who.'}>
            {s.unhappy.toLocaleString()} low rating</Pill> : null}
        </> : null}
      </LeanHead>

      {s && (s.restricted > 0 || s.relay > 0) ? (
        <div className="flex items-center gap-1.5 flex-wrap text-[12px] text-muted">
          {s.restricted > 0 ? <Tag tone="amber" title={blockedNames + ' forbid marketing to guests booked through them (the address alone cannot tell you). Never sent to Mailchimp or the default CSV. A guest who later books direct is yours again.'}>
            {s.restricted.toLocaleString()} channel-blocked</Tag> : null}
          {s.relay > 0 ? <Tag tone="amber" title="Only ever gave a channel forwarding address (a1b2c3@guest.airbnb.com and the like). They bounce once the booking closes. Kept for front-desk lookup, never uploaded.">
            {s.relay.toLocaleString()} relay only</Tag> : null}
          <span>never mailed · hover for why</span>
        </div>
      ) : null}

      {/* controls — one line */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          {/* Chrome guesses from the placeholder, sees "email", and drops a saved address into the
              search box. autoComplete="off" is advisory; a name it does not recognise plus the
              password-manager opt-outs is what actually stops it. */}
          <input
            value={typed} onChange={e => setTyped(e.target.value)}
            placeholder="Name, email, phone, unit or tag"
            name="contact-lookup" autoComplete="off" data-1p-ignore data-lpignore="true"
            spellCheck={false} autoCapitalize="none" autoCorrect="off"
            className="w-full py-1.5 pl-8 pr-3 rounded-lg border border-line bg-white text-base sm:text-[12.5px] focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>
        {/* TWO AXES: channel (who they are) and segment (whether we may email them) are separate
            filters, so "which Airbnb guests can I email?" is one pick in each. */}
        <select value={chan} onChange={e => setChan(e.target.value)} className={sel} title="Booking channel">
          <option value="">All channels</option>
          {(s?.channels || []).map(c => {
            const blocked = (data?.restrictedChannels || []).some(r => r.toLowerCase() === c.label.toLowerCase())
            return <option key={c.label} value={c.label}>{c.label} · {c.count.toLocaleString()}{blocked ? ' (blocked)' : ' · ' + c.mailable.toLocaleString() + ' mailable'}</option>
          })}
          {chan && !(s?.channels || []).some(c => c.label === chan) ? <option value={chan}>{chan}</option> : null}
        </select>
        <select value={seg} onChange={e => setSeg(e.target.value)} className={sel} title="Show">
          {SEGS.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        <a href={exportHref} download title="Download the current filter as CSV (every match, not just those shown)"
          className="py-1 px-2.5 inline-flex items-center gap-1 rounded-lg bg-ink text-white text-[12px] font-bold">
          <Download size={12} /> CSV
        </a>
        <button onClick={() => setShowMc(v => !v)} title={mc?.connected ? 'Mailchimp connected — push or check the audience' : 'Connect Mailchimp'}
          className="py-1 px-2.5 inline-flex items-center gap-1 rounded-lg text-[12px] font-bold border border-line bg-white text-ink">
          <Send size={12} /> Mailchimp
          {mc?.connected ? <CheckCircle2 size={11} className="text-emerald-600" /> : null}
        </button>
        <IconBtn title="Channels we do not market to" onClick={() => setShowRules(v => !v)}><Ban size={13} /></IconBtn>
        <IconBtn title="Refresh the list" onClick={() => load(true)} disabled={busy}><RefreshCw size={13} className={busy ? 'animate-spin' : ''} /></IconBtn>
      </div>

      {showRules ? (
        <BlockedChannels
          current={data?.restrictedChannels || []}
          all={(s?.channels || []).map(c => c.label)}
          summary={s || null}
          onSaved={() => { setShowRules(false); load() }}
          onClose={() => setShowRules(false)}
        />
      ) : null}

      {showMc ? <MailchimpPanel mc={mc} setMc={setMc} seg={seg} onClose={() => setShowMc(false)} /> : null}

      {data?.truncated ? (
        <p className="text-[12px] text-amber-800 font-semibold">
          The {(data.shortReads || ['data']).join(' and ')} read came back short — counts are a floor. Worth telling Claude.
        </p>
      ) : null}

      {err ? <div className="rounded-xl bg-rose-50 ring-1 ring-rose-200 px-4 py-3 text-[13px] text-rose-700">{err}</div> : null}

      {busy && !data ? (
        <LeanEmpty><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Building the contact list…</LeanEmpty>
      ) : !data?.contacts.length ? (
        <LeanEmpty>Nobody matches that.</LeanEmpty>
      ) : (
        <>
          <LeanList>
            {data.contacts.map(c => <Row key={c.key} c={c} />)}
          </LeanList>
          {data.shown > data.contacts.length ? (
            <p className="text-[12px] text-muted px-1">Showing {data.contacts.length.toLocaleString()} of {data.shown.toLocaleString()} — the CSV has every match.</p>
          ) : null}
        </>
      )}
    </div>
  )
}

function Row({ c }: { c: Contact }) {
  const mailTag = c.mail === 'mailable'
    ? <Tag tone="emerald" title="Can be emailed">Mailable</Tag>
    // The address may be fine — the channel is the problem, so the tag names the channel.
    : c.mail === 'restricted' ? <Tag tone="amber" title={c.mailReason}>{c.channel} · no marketing</Tag>
      : c.email ? <Tag tone="amber" title={c.mailReason}>Not mailable</Tag>
        : <Tag title="No email address on file">No email</Tag>
  return (
    <LeanRow
      name={`${c.first} ${c.last}`}
      meta={c.email || c.phone || undefined}
      tags={<>
        {c.vip ? <Tag tone="violet">VIP</Tag> : null}
        {c.inHouse ? <Tag tone="emerald">In house</Tag> : null}
        {mailTag}
        {c.channel ? <Tag title="Booking channel">{c.channel}</Tag> : null}
        <Tag title={`${c.stays} stay${c.stays === 1 ? '' : 's'} · ${c.nights} night${c.nights === 1 ? '' : 's'}`}>{c.stays}× · {usd(c.value)}</Tag>
        {c.reviews ? <Tag tone={c.unhappy ? 'rose' : 'slate'} title={c.reviews + ' review' + (c.reviews === 1 ? '' : 's') + (c.reviewLow != null ? ' · lowest ' + c.reviewLow : '')}>{c.reviewAvg ? c.reviewAvg + '★' : c.reviews + ' rev'}</Tag> : null}
        {c.tags.map(t => <Tag key={t}>{t}</Tag>)}
      </>}>
      <div className="text-[12.5px] text-ink space-y-1">
        <p className="flex items-center gap-3 flex-wrap text-muted">
          {c.email ? <span className={'inline-flex items-center gap-1 ' + (c.mail === 'mailable' ? 'text-ink' : c.mail === 'restricted' ? '' : 'line-through decoration-amber-400/60')}>
            {c.mail === 'mailable' ? <Mail size={11} className="text-emerald-600" /> : <MailX size={11} className="text-amber-600" />}{c.email}</span>
            : <span className="inline-flex items-center gap-1"><MailX size={11} /> no email</span>}
          {c.phone ? <span>{c.phone}</span> : null}
        </p>
        {c.mail !== 'mailable' && c.email ? <p className="text-[11.5px] text-amber-700">{c.mailReason}</p> : null}
        <p className="text-muted">
          <Repeat size={11} className="inline mr-1" />{c.stays} stay{c.stays === 1 ? '' : 's'} · {c.nights} night{c.nights === 1 ? '' : 's'} · {usd(c.value)}
          {' · '}<Star size={10} className={'inline ' + (c.reviews ? 'text-amber-500' : 'text-line')} />{' '}
          {c.reviews ? c.reviews + ' review' + (c.reviews === 1 ? '' : 's') + (c.reviewAvg ? ' · avg ' + c.reviewAvg : '') : 'no reviews'}
        </p>
        <p className="text-muted">Last unit {c.lastUnit || '—'}{c.units.length > 1 ? ' · all: ' + c.units.join(', ') : ''}</p>
      </div>
    </LeanRow>
  )
}

/**
 * WHICH CHANNELS WE MAY NOT MARKET TO — a setting, not a constant.
 *
 * Jon named Expedia. Airbnb and Booking.com carry the same restriction in their own terms and he
 * may well add them; when he does it should be a tick box, not a deploy. The cost of each choice is
 * shown next to it, because "block Airbnb" is a very different decision at 8,000 contacts than at 8.
 */
function BlockedChannels({ current, all, summary, onSaved, onClose }: {
  current: string[]; all: string[]; summary: Summary | null; onSaved: () => void; onClose: () => void
}) {
  const [picked, setPicked] = useState<string[]>(current)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // A channel already on the list must stay offerable even if nobody booked through it this window.
  const options = Array.from(new Set(all.concat(current))).sort()
  const mailableOf = (label: string) => (summary?.channels || []).find(c => c.label === label)?.mailable || 0

  const save = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/contacts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restrictedChannels: picked }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.message || j?.error || 'Could not save.')
      onSaved()
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(false) }
  }

  return (
    <div className="rounded-2xl bg-white ring-1 ring-line overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2">
        <Ban size={14} className="text-muted" />
        <p className="text-[13.5px] font-bold text-ink flex-1">Channels we do not market to</p>
        <Tip label="Close"><button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink p-1 -m-1 rounded-lg hover:bg-app"><X size={15} /></button></Tip>
      </div>
      <div className="px-4 py-4 space-y-3">
        <p className="text-[12px] text-muted">Ticked = guests who booked only through it are never mailed. Anyone who has booked direct is unaffected.</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {options.map(label => {
            const on = picked.some(x => x.toLowerCase() === label.toLowerCase())
            const cost = mailableOf(label)
            return (
              <label key={label}
                className={'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer transition ' +
                  (on ? 'border-amber-300 bg-amber-50' : 'border-line bg-white hover:border-ink/25')}>
                <input type="checkbox" checked={on} className="mt-0.5"
                  onChange={e => setPicked(p => e.target.checked
                    ? p.concat([label])
                    : p.filter(x => x.toLowerCase() !== label.toLowerCase()))} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-ink">{label}</span>
                  <span className="block text-[11.5px] text-muted">
                    {on
                      ? 'Blocked' + (cost ? ' — was costing ' + cost.toLocaleString() + ' mailable contacts' : '')
                      : cost.toLocaleString() + ' mailable contact' + (cost === 1 ? '' : 's') + ' would be blocked'}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={save} disabled={busy}
            className="h-9 px-4 rounded-xl bg-ink text-white text-[12.5px] font-bold disabled:bg-line disabled:text-faint inline-flex items-center gap-1.5">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Save
          </button>
          {err ? <span className="text-[12.5px] font-semibold text-rose-700">{err}</span> : null}
        </div>
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
  const [dry, setDry] = useState(true)
  // Push arms before it fires. One press used to be the whole ceremony for writing thousands of
  // people into somebody else's mailing list.
  const [armed, setArmed] = useState(false)

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
        <p className="text-[13.5px] font-bold text-ink flex-1">Mailchimp</p>
        <Tip label="Close"><button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink p-1 -m-1 rounded-lg hover:bg-app"><X size={15} /></button></Tip>
      </div>

      <div className="px-4 py-4 space-y-4">
        {!mc?.connected ? (
          <>
            <p className="text-[12px] text-muted">API key from Mailchimp → Account → Extras → API keys. Stored server-side, never shown again.</p>
            <div className="flex gap-2 flex-wrap">
              {/* Chrome autofills ANY type="password" input from the saved-password store, and
                  autoComplete="off" does not stop it — so clicking near this field dropped a Google
                  password into it. Saving that as a Mailchimp key would fail confusingly at best,
                  and store the wrong secret at worst. "new-password" is the value Chrome honours,
                  and the data-* attributes opt out of 1Password and LastPass. */}
              <input value={apiKey} onChange={e => setApiKey(e.target.value)} type="password"
                name="mailchimp-api-key" autoComplete="new-password"
                data-1p-ignore data-lpignore="true" data-form-type="other"
                spellCheck={false} autoCapitalize="none" autoCorrect="off"
                placeholder="Mailchimp API key"
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
                    <span title="Off = transactional: they land in the audience but are not marketing opt-ins (the safe default). Anyone who unsubscribed is never re-subscribed either way.">
                      Add new contacts as <b>subscribed</b> (guests consented). Off = <b>transactional</b>.
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
              {/* Relays and channel-blocked guests are filtered here, again in the API and again in the
                  Mailchimp client — three gates, because one that gets refactored away is how a blocked
                  address ends up in a campaign. Mailchimp keys by email, so a re-push updates, never duplicates. */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <Tag tone="emerald" title="Only addresses marked can-email are sent; relays, channel-blocked and 3-star-or-lower guests never are">Can-email only</Tag>
                <Tag title="Mailchimp keys a contact by email, so a second push updates rather than duplicates">No duplicates</Tag>
                <Tag title="Unsubscribed, hard-bounced and archived contacts are left exactly where they are">Opt-outs untouched</Tag>
                <Tag title="Each contact goes up with name and phone, tagged with channel, stay count, building, market, VIP and your tags">Tagged</Tag>
                {seg ? <Tag tone="brand" title="The current filter is applied to the push">{SEGS.find(x => x.key === seg)?.label}</Tag> : null}
              </div>
              {/* NAME THE DESTINATION NEXT TO THE BUTTON THAT WRITES TO IT (Jon, 2026-09-15).
                  The audience was picked days ago and printed at the top of the panel, twelve lines
                  away from Push. That is not where a person looks when they are about to press it.
                  Stay Hospitality's connected audience was "Homeowners" — one press from putting
                  seven thousand GUESTS into the owners' list, which has no undo worth the name.
                  So the destination is stated on the button itself, and the button arms first. */}
              <p className="text-[12px] text-ink leading-relaxed mt-2.5" title="Wrong list? Disconnect above and reconnect to pick another.">
                Destination: <b>{mc.audienceName}</b>
              </p>
              <div className="flex gap-2 flex-wrap mt-2">
                <button disabled={!!busy}
                  onClick={async () => { setArmed(false); const j = await call({ op: 'sync', seg, dryRun: true }, 'dry'); if (j) { setResult(j.result); setDry(true); setMsg('Checked the audience — nothing was sent.') } }}
                  className="h-9 px-3.5 rounded-xl border border-line bg-white text-[12.5px] font-bold text-ink inline-flex items-center gap-1.5">
                  {busy === 'dry' ? <Loader2 size={13} className="animate-spin" /> : null} <span title="Reads the audience and says how many are new — nothing is sent">Check first</span>
                </button>
                {!armed ? (
                  <button disabled={!!busy} onClick={() => setArmed(true)}
                    className="h-9 px-4 rounded-xl bg-ink text-white text-[12.5px] font-bold disabled:bg-line disabled:text-faint inline-flex items-center gap-1.5">
                    <Send size={13} /> Push to Mailchimp
                  </button>
                ) : (
                  <>
                    <button disabled={!!busy}
                      onClick={async () => { const j = await call({ op: 'sync', seg }, 'sync'); setArmed(false); if (j) { setResult(j.result); setDry(false); setMc(j.mailchimp); setMsg('Pushed to Mailchimp.') } }}
                      className="h-9 px-4 rounded-xl bg-rose-600 text-white text-[12.5px] font-bold disabled:bg-line disabled:text-faint inline-flex items-center gap-1.5">
                      {busy === 'sync' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      Yes — write into {mc.audienceName}
                    </button>
                    <button disabled={!!busy} onClick={() => setArmed(false)}
                      className="h-9 px-3.5 rounded-xl border border-line bg-white text-[12.5px] font-bold text-muted hover:text-ink">
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>

            {result ? <SyncReport r={result} dry={dry} /> : null}
          </>
        )}

        {msg ? <p className="text-[12.5px] font-semibold text-emerald-700">{msg}</p> : null}
        {err ? <p className="text-[12.5px] font-semibold text-rose-700">{err}</p> : null}
      </div>
    </div>
  )
}

/**
 * WHAT THE PUSH IS ABOUT TO DO, OR JUST DID.
 *
 * The old version printed one number — how many contacts were mailable — which answered a question
 * nobody was asking. The question is "am I about to make a mess of my audience", and that has three
 * parts: how many are new (this is the only line that changes what Mailchimp bills), how many are
 * already there (updated in place, never duplicated), and who we deliberately did not touch.
 */
function SyncReport({ r, dry }: { r: any; dry: boolean }) {
  const held = (r.skippedUnsubscribed || 0) + (r.skippedCleaned || 0) + (r.skippedArchived || 0)
  const Stat = ({ n, label, tone }: { n: number; label: string; tone?: string }) => (
    <div className="flex-1 min-w-[92px]">
      <p className={'text-[17px] font-bold leading-none ' + (tone || 'text-ink')}>{n.toLocaleString()}</p>
      <p className="text-[11px] text-muted mt-1 leading-tight">{label}</p>
    </div>
  )
  return (
    <div className="rounded-xl bg-white ring-1 ring-line px-3.5 py-3 space-y-2.5">
      <div className="flex gap-3 flex-wrap">
        <Stat n={r.willCreate || 0} label={dry ? 'new to the audience' : 'were new'} tone="text-emerald-700" />
        <Stat n={r.alreadyInAudience || 0} label={dry ? 'already there — updated, not duplicated' : 'updated in place'} />
        <Stat n={held} label="left alone — opted out, bounced or archived" tone={held ? 'text-amber-700' : undefined} />
        {!dry && r.failed ? <Stat n={r.failed} label="rejected by Mailchimp" tone="text-rose-700" /> : null}
      </div>

      <p className="text-[11.5px] text-muted leading-relaxed">
        {r.attempted.toLocaleString()} {dry ? 'contacts would be sent' : 'contacts sent'} out of{' '}
        {r.audienceTotal ? r.audienceTotal.toLocaleString() + ' already in the audience. ' : 'this segment. '}
        {r.skippedNotMailable ? r.skippedNotMailable.toLocaleString() + ' have no usable address. ' : ''}
        {r.skippedRestricted ? r.skippedRestricted.toLocaleString() + ' are held back by a channel rule. ' : ''}
        {r.skippedUnhappy ? r.skippedUnhappy.toLocaleString() + ' left us three stars or fewer and are never mailed. ' : ''}
        {r.skippedDuplicate ? r.skippedDuplicate.toLocaleString() + ' were the same address twice. ' : ''}
      </p>

      {r.tagsStale ? (
        <p className="text-[11.5px] text-muted leading-relaxed">
          {dry
            ? r.tagsStale.toLocaleString() + ' existing contacts have tags that no longer match — a guest who has gone from one stay to five still reads "Stays: 1" in Mailchimp. Pushing fixes them.'
            : r.tagsRefreshed.toLocaleString() + ' contacts had their tags corrected'
              + (r.tagsDeferred ? ', ' + r.tagsDeferred.toLocaleString() + ' left for the next push' : '')
              + '. Only tags this app generates are ever changed — anything you added in Mailchimp is left alone.'}
        </p>
      ) : null}

      {held ? (
        <p className="text-[11.5px] text-muted leading-relaxed">
          Left alone:{' '}
          {[
            r.skippedUnsubscribed ? r.skippedUnsubscribed.toLocaleString() + ' unsubscribed' : '',
            r.skippedCleaned ? r.skippedCleaned.toLocaleString() + ' hard-bounced' : '',
            r.skippedArchived ? r.skippedArchived.toLocaleString() + ' archived out of the audience' : '',
          ].filter(Boolean).join(' · ')}. Pushing an archived contact back is the one thing here that really does
          add a contact you did not ask for, so it never happens.
        </p>
      ) : null}

      {r.audiencePartial ? (
        <p className="text-[11.5px] font-semibold text-amber-800 leading-relaxed">
          The audience read did not complete, so the numbers above are a floor. Nothing is duplicated either way —
          Mailchimp still matches on the email address — but a contact who unsubscribed may have been written to.
        </p>
      ) : null}

      {(r.errors || []).slice(0, 5).map((e: any, i: number) => (
        <p key={i} className="text-[11.5px] text-rose-700">{e.email}: {e.reason}</p>
      ))}
    </div>
  )
}
