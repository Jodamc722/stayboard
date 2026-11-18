'use client'
// OWNER ONBOARDING, THE TEAM'S SIDE (lib/owner-onboard).
//   OwnerOnboardingDesk  — /owner-onboarding: every owner link, and a new one (owner, property, who sends the
//                          introductory email, what to ask, optionally the home started for them, the agreement)
//   OwnerOnboardingReport — /owner-onboarding/<code>: the report the team works from: the home, what it has and
//                          needs, the timeline, the onboarding call, the paperwork and the handoff to accounting.
import { remindState, REMIND_LABEL } from '@/lib/owner-onboard-remind'
import { AddressInput } from './AddressInput'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Loader2, Copy, Check, Mail, Phone, MessageSquare, ExternalLink, FileUp, Download, Send, Lock, Printer, Search, Archive, Clock, ChevronDown } from 'lucide-react'
import { OO_STEPS, OO_BEDS, OO_APPLIANCES, OO_APPLIANCE_LABEL, DEFAULT_GM, DEFAULT_SALES, DEFAULT_HOME, OO_DECISIONS, stockOf, linenLines, introEmail, stepLabel, type OOIndexRow, type OOItem, type OOStepStatus, type OOHome, type OOTrack } from '@/lib/owner-onboard'

type Any = any
const lab = 'text-[10.5px] uppercase tracking-[0.16em] text-muted font-semibold'
const field = 'mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-[13.5px] text-ink'
const card = 'rounded-2xl border border-line bg-white p-5'
const origin = () => (typeof window !== 'undefined' ? window.location.origin : '')
const ownerLink = (code: string) => origin() + '/join/' + code

// ── WHERE THE OWNER STANDS (Jon, 2026-11-16: "see if the onboarding email was sent or if the onboarding form was
//    logged in… super visible in the main page and in the admin page… inventory finished and W-9 and ACH finished").
//    One tag per thing, the same on the list and on the owner's page: green = done, amber = under way, red = not yet. ──
const shortDay = (iso: string) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')
// QUIET ON PURPOSE (Jon, same day: "It looks noisy"): no coloured pills. On the list each thing is one narrow column
// with a green tick, an amber "2/3" or clock, or a grey dash; on the owner's page it is one line of plain words.
type TrackTone = 'ok' | 'wait' | 'no' | 'na'
type TrackChip = { key: string; name: string; tone: TrackTone; /** a date or a count, when there is one */ detail: string; tip: string }
function trackChips(t: OOTrack): TrackChip[] {
  const all = (n: number) => n >= t.owners
  const part = (n: number) => (t.owners > 1 ? `${n}/${t.owners}` : '')
  return [
    { key: 'intro', name: 'Intro email', tone: t.intro ? 'ok' : 'no', detail: shortDay(t.intro), tip: t.intro ? 'Introductory email sent ' + shortDay(t.intro) : 'Introductory email not marked as sent' },
    { key: 'portal', name: 'Portal email', tone: all(t.invited) ? 'ok' : t.invited ? 'wait' : 'no', detail: all(t.invited) ? shortDay(t.invitedAt) : t.invited ? part(t.invited) : '', tip: all(t.invited) ? 'Owner-portal email sent ' + shortDay(t.invitedAt) : t.invited ? `Owner-portal email sent to ${t.invited} of ${t.owners} owners` : 'Owner-portal email not sent (Send invite)' },
    { key: 'signin', name: 'Signed in', tone: all(t.signedIn) ? 'ok' : t.signedIn || t.invited ? 'wait' : 'no', detail: all(t.signedIn) ? shortDay(t.seenAt) : t.signedIn ? part(t.signedIn) : '', tip: all(t.signedIn) ? 'Signed in to the portal, last ' + shortDay(t.seenAt) : t.signedIn ? `${t.signedIn} of ${t.owners} owners have signed in` : t.invited ? 'Portal email sent, not signed in yet' : 'Not signed in' },
    { key: 'home', name: 'Home', tone: t.home ? 'ok' : 'no', detail: '', tip: t.home ? 'Home details are in' : 'Home details not filled in yet' },
    { key: 'inventory', name: 'Inventory', tone: t.inventory === 'na' ? 'na' : t.inventory === 'done' ? 'ok' : t.inventory === 'started' ? 'wait' : 'no', detail: t.inventory === 'started' ? 'started' : '', tip: t.inventory === 'na' ? 'Not asked on this link' : t.inventory === 'done' ? 'Inventory finished' : t.inventory === 'started' ? 'Inventory started, not finished' : 'Inventory not started' },
    { key: 'w9', name: 'W-9', tone: t.w9 === 'na' ? 'na' : t.w9 ? 'ok' : 'no', detail: '', tip: t.w9 === 'na' ? 'Not asked on this link' : t.w9 ? 'W-9 received' : 'W-9 not received' },
    { key: 'ach', name: 'ACH', tone: t.ach === 'na' ? 'na' : t.ach ? 'ok' : 'no', detail: '', tip: t.ach === 'na' ? 'Not asked on this link' : t.ach ? 'ACH authorization received' : 'ACH authorization not received' },
  ]
}
const TRACK_COLS = ['Intro email', 'Portal email', 'Signed in', 'Home', 'Inventory', 'W-9', 'ACH']
/** One cell of the list: a tick, a count or clock, or a dash. */
function TrackMark({ c }: { c: TrackChip }) {
  if (c.tone === 'ok') return <Check size={15} className="inline text-emerald-600" aria-label={c.tip} />
  if (c.tone === 'wait') return /^\d/.test(c.detail) ? <span className="text-[12px] font-semibold text-[#8C6D3A] tabular-nums">{c.detail}</span> : <Clock size={13} className="inline text-[#8C6D3A]" aria-label={c.tip} />
  return <span className="text-muted/50">{c.tone === 'na' ? '' : '–'}</span>
}
/** The owner's page: one line of plain words. */
function TrackRow({ t }: { t: OOTrack }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {trackChips(t).filter(c => c.tone !== 'na').map(c => (
        <span key={c.key} title={c.tip} className={'inline-flex items-center gap-1.5 text-[13.5px] whitespace-nowrap ' + (c.tone === 'no' ? 'text-muted' : 'text-ink')}>
          {c.tone === 'ok' ? <Check size={15} className="text-emerald-600" /> : c.tone === 'wait' ? <Clock size={14} className="text-[#8C6D3A]" /> : <span className="inline-block w-[13px] h-[13px] rounded-full border border-line" />}
          <span className={c.tone === 'no' ? '' : 'font-semibold'}>{c.name}</span>{c.detail ? <span className="text-muted text-[12.5px]">{c.detail}</span> : null}
        </span>
      ))}
    </div>
  )
}
const TRACK_TONE = { ok: 'bg-app text-ink border-line', no: 'bg-app text-muted border-line' }
/** What the list can be narrowed to: the things still outstanding. */
const TRACK_FILTERS: { key: string; label: string; hit: (t: OOTrack) => boolean }[] = [
  { key: 'portal', label: 'Portal email not sent', hit: t => t.invited < t.owners },
  { key: 'signin', label: 'Not signed in', hit: t => t.signedIn < t.owners },
  { key: 'inventory', label: 'Inventory not finished', hit: t => t.inventory !== 'na' && t.inventory !== 'done' },
  { key: 'paper', label: 'W-9 or ACH missing', hit: t => t.w9 === false || t.ach === false },
]

function copyText(t: string, done: () => void) {
  const fb = () => { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); try { document.execCommand('copy') } catch { /* */ } a.remove(); done() }
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(t).then(done).catch(fb); else fb()
}
function CopyBtn({ text, label, small }: { text: string; label: string; small?: boolean }) {
  const [ok, setOk] = useState(false)
  return <button type="button" onClick={() => copyText(text, () => { setOk(true); setTimeout(() => setOk(false), 1600) })} className={'inline-flex items-center gap-1.5 rounded-xl border border-line bg-white font-semibold text-ink hover:bg-app ' + (small ? 'px-2.5 py-1 text-[12px]' : 'px-3 py-2 text-[13px]')}>{ok ? <Check size={13} /> : <Copy size={13} />} {ok ? 'Copied' : label}</button>
}
function putFile(url: string, f: File) {
  return new Promise<void>((res, rej) => { const x = new XMLHttpRequest(); x.open('PUT', url); x.setRequestHeader('Content-Type', f.type || 'application/octet-stream'); x.setRequestHeader('x-upsert', 'true'); x.onload = () => (x.status < 300 ? res() : rej(new Error('upload failed'))); x.onerror = () => rej(new Error('upload failed')); x.send(f) })
}
async function uploadAgreement(code: string, f: File) {
  const s = await fetch(`/api/owner-onboarding/${code}/agreement`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sign: f.name }) }).then(r => r.json())
  if (!s?.ok) throw new Error(s?.error || 'Could not start the upload.')
  await putFile(s.signedUrl, f)
  const m = await fetch(`/api/owner-onboarding/${code}/agreement`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meta: { path: s.path, name: f.name, size: f.size } }) }).then(r => r.json())
  if (!m?.ok) throw new Error(m?.error || 'Could not save the agreement.')
}

// ── SMART REMINDERS (lib/owner-onboard-remind): what the owner will be nudged about and when, with pause and send-now ──
function Reminders({ rec, onRec }: { rec: Any; onRec: (r: Any) => void }) {
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState('')
  const st = remindState(rec)
  const log: Any[] = (rec.remind?.log || []).slice().reverse()
  async function act(body: Any, tag: string) {
    setBusy(tag); setMsg('')
    const d = await fetch(`/api/owner-onboarding/${rec.code}/remind`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).catch(() => null)
    setBusy(''); if (d?.record) onRec(d.record); setMsg(d?.ok ? (d.note || '') : (d?.error || 'Not saved.'))
  }
  const day = (n: number) => new Date(n).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const who = (id: string) => (id === 'p' ? rec.custom.ownerName : (rec.owners || []).find((o: Any) => o.id === id)?.name) || 'the owner'
  return (
    <div className="mt-4 rounded-xl bg-app p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><p className={lab + ' mr-auto'}>Automatic reminders</p>
        <button type="button" disabled={!!busy} onClick={() => act({ action: rec.remind?.paused ? 'resume' : 'pause' }, 'pause')} className="oo-noprint text-[12.5px] font-semibold text-ink underline">{rec.remind?.paused ? 'Turn reminders back on' : 'Pause reminders'}</button></div>
      {!st.on ? <p className="text-[13px] text-ink mt-1">{st.why}</p> : !st.plans.length ? <p className="text-[13px] text-ink mt-1">{st.escalate.length ? 'Three reminders have gone unanswered. A call will probably do more than another email.' : st.why}</p> : (
        <ul className="mt-1 space-y-1.5">{st.plans.map(p => (
          <li key={p.owner} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink">
            <span className="mr-auto"><b>{REMIND_LABEL[p.kind]}</b> · reminder {p.n} of 3 to {p.name || p.email} {p.due ? <span className="text-[#B4532A] font-semibold">goes out on the next weekday morning</span> : <>on or after <b>{day(p.dueAt)}</b></>}</span>
            <button type="button" disabled={!!busy} onClick={() => act({ action: 'send', owner: p.owner }, 's' + p.owner)} className="oo-noprint rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-ink disabled:opacity-50">{busy === 's' + p.owner ? 'Sending…' : 'Send it now'}</button>
          </li>))}</ul>
      )}
      <p className="text-[11.5px] text-muted mt-2">Only two things are chased by email: getting into the portal, then the W-9 and bank details. Up to three reminders each, spaced further apart, at 10am Eastern on weekdays, and never two within two days. After the third, you are told so someone can call.</p>
      {log.length ? <details className="mt-1 text-[11.5px] text-muted"><summary className="cursor-pointer font-semibold text-ink">Sent so far ({log.length})</summary><ul className="mt-1 space-y-0.5">{log.slice(0, 30).map((l, i) => <li key={i}>{l.kind === 'escalate' ? 'Team told: no answer after three reminders (' + (REMIND_LABEL[l.about as keyof typeof REMIND_LABEL] || '').toLowerCase() + ')' : REMIND_LABEL[l.kind as keyof typeof REMIND_LABEL]} · {who(l.owner)} · {new Date(l.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</li>)}</ul></details> : null}
      {msg ? <p className="text-[12.5px] text-ink mt-1">{msg}</p> : null}
    </div>
  )
}

// ── THE OWNERS AND THEIR PORTAL ACCOUNTS (Jon, 2026-11-13: "option for multiple owners… each will need portal passcode
//    and access"): every owner on the link has their own invite, password and sign-in ──
function InviteOwner({ rec, onRec }: { rec: Any; onRec: (r: Any) => void }) {
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState('')
  const [add, setAdd] = useState<Any>(null)
  const co: Any[] = rec.owners || []
  const rows: Any[] = [{ id: 'p', name: rec.custom.ownerName, email: rec.custom.ownerEmail, phone: rec.custom.ownerPhone, access: rec.ownerAccess || {} }, ...co]
  const host = typeof window !== 'undefined' ? window.location.host : ''
  async function invite(o: Any) {
    setBusy('i' + o.id); setMsg('')
    const d = await fetch(`/api/owner-onboarding/${rec.code}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: o.id }) }).then(r => r.json()).catch(() => null)
    setBusy(''); if (d?.record) onRec(d.record); setMsg(d?.ok ? 'Invite sent to ' + o.email + '.' : 'Not sent: ' + (d?.error || 'try again'))
  }
  async function saveOwners(list: Any[], note: string) {
    setBusy('s'); setMsg('')
    const d = await fetch('/api/owner-onboarding/' + rec.code, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owners: list.map(o => ({ id: o.id, name: o.name, email: o.email, phone: o.phone })) }) }).then(r => r.json()).catch(() => null)
    setBusy(''); if (d?.record) { onRec(d.record); setAdd(null) } setMsg(d?.ok ? note : (d?.error || 'Not saved.'))
  }
  const chip = (a: Any) => <span className={'rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap ' + (a.hasPassword ? 'bg-emerald-50 text-emerald-800' : a.invitedAt ? 'bg-amber-50 text-amber-800' : 'bg-app text-muted')}>{a.hasPassword ? 'Active owner user' : a.invitedAt ? 'Invited, not set up yet' : 'Not invited'}</span>
  return (
    <section className={card}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1"><h2 className="font-serif text-[22px] leading-none text-ink mr-auto">{rows.length > 1 ? 'The owners’ portal accounts' : 'The owner’s portal account'} <Lock size={14} className="inline" /></h2></div>
      <p className="text-[12.5px] text-muted mb-3">Each owner gets their own invite, with the team copied, and a second email to them alone with their private sign-in link: they click it, create their own password, and from then on sign in with their email and password, from the link or at <b className="text-ink">{host}/portal</b>. An owner account opens only this onboarding, never the rest of Lighthouse.</p>
      <ul className="divide-y divide-line border-y border-line">
        {rows.map((o, i) => { const a = o.access || {}; return (
          <li key={o.id} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <div className="mr-auto min-w-0"><p className="text-[13.5px] font-semibold text-ink truncate">{o.name || (i === 0 ? 'Owner' : 'Owner ' + (i + 1))}{i === 0 && rows.length > 1 ? <span className="font-normal text-muted"> · first owner</span> : null}</p>
              <p className="text-[12px] text-muted truncate">{o.email || 'No email yet'}{a.activatedAt ? ' · account created ' + new Date(a.activatedAt).toLocaleDateString() : ''}{a.lastSeenAt ? ' · last signed in ' + new Date(a.lastSeenAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</p></div>
            {chip(a)}
            <button type="button" disabled={!!busy || !o.email} onClick={() => invite(o)} className="oo-noprint inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40">{busy === 'i' + o.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} {a.invitedAt ? 'Send again' : 'Send invite'}</button>
            {i > 0 ? <button type="button" disabled={!!busy} onClick={() => saveOwners(co.filter(x => x.id !== o.id), (o.name || 'That owner') + ' was removed. Their access has ended.')} className="oo-noprint text-[12.5px] text-muted hover:text-red-700">Remove</button> : null}
          </li>) })}
      </ul>
      {!rec.custom.ownerEmail ? <p className="text-[12.5px] text-muted mt-2">Add the first owner’s email (Owner details) to invite them. Without any email on the link, it stays open to anyone who has it.</p> : null}
      {add ? (
        <div className="oo-noprint mt-3 grid gap-2 sm:grid-cols-3">
          <label className="block"><span className={lab}>Name</span><input value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} className={field} autoFocus /></label>
          <label className="block"><span className={lab}>Email</span><input type="email" value={add.email} onChange={e => setAdd({ ...add, email: e.target.value })} className={field} /></label>
          <label className="block"><span className={lab}>Phone (optional)</span><input value={add.phone} onChange={e => setAdd({ ...add, phone: e.target.value })} className={field} /></label>
          <div className="sm:col-span-3 flex items-center gap-3"><button type="button" disabled={!!busy || !add.name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(add.email.trim())} onClick={() => saveOwners([...co, add], add.name.trim() + ' was added. Send their invite when you are ready.')} className="rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold disabled:opacity-40">Add this owner</button><button type="button" onClick={() => setAdd(null)} className="text-[12.5px] text-muted underline">Cancel</button></div>
        </div>
      ) : rows.length < 6 ? <button type="button" onClick={() => setAdd({ name: '', email: '', phone: '' })} className="oo-noprint mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink"><Plus size={13} /> Add another owner</button> : null}
      {msg ? <p className="text-[12.5px] text-ink mt-2">{msg}</p> : null}
      <Reminders rec={rec} onRec={onRec} />
      {rows.length > 1 ? <p className="text-[11.5px] text-muted mt-2">Every owner sees the home, the supplies, the order list and the timeline. The W-9 and bank forms can only be downloaded by the owner who sent them.</p> : null}
    </section>
  )
}

// ── OWNER INFORMATION (Jon, 2026-11-17: "add owner information section and email, phone number… make it clickable so
// I can"). Who the owners are and how to reach them, at the top of the page: tap the email to write, the number to
// call or text. Edit fills in or corrects a name, email or phone without going through the invite card.
const telOf = (p: string) => { const d = String(p || '').replace(/[^\d+]/g, ''); return d.length >= 7 ? (d.startsWith('+') ? d : d.length === 10 ? '+1' + d : d) : '' }
function OwnerInfo({ rec, onRec }: { rec: Any; onRec: (r: Any) => void }) {
  const base = (): Any[] => [{ id: 'p', name: rec.custom.ownerName || '', email: rec.custom.ownerEmail || '', phone: rec.custom.ownerPhone || '' }, ...(rec.owners || []).map((o: Any) => ({ id: o.id, name: o.name || '', email: o.email || '', phone: o.phone || '' }))]
  const [edit, setEdit] = useState<Any[] | null>(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('')
  const rows = base()
  async function save() {
    if (!edit) return
    const bad = edit.find(o => o.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email.trim()))
    if (bad) { setMsg('“' + bad.email + '” is not an email address.'); return }
    setBusy(true); setMsg('')
    const p = edit[0]
    const d = await fetch('/api/owner-onboarding/' + rec.code, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ custom: { ...rec.custom, ownerName: p.name.trim(), ownerEmail: p.email.trim(), ownerPhone: p.phone.trim() }, owners: edit.slice(1).map(o => ({ id: o.id, name: o.name.trim(), email: o.email.trim(), phone: o.phone.trim() })) }) }).then(r => r.json()).catch(() => null)
    setBusy(false); if (d?.record) { onRec(d.record); setEdit(null) } setMsg(d?.ok ? 'Owner information saved.' : (d?.error || 'Not saved.'))
  }
  const link = 'inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-[13px] font-semibold text-ink hover:bg-app'
  return (
    <section className={card + ' mb-6'}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2"><h2 className="font-serif text-[22px] leading-none text-ink mr-auto">Owner information</h2>
        {!edit ? <button type="button" onClick={() => { setEdit(base()); setMsg('') }} className="oo-noprint text-[12.5px] font-semibold text-ink underline">Edit</button> : null}</div>
      {rec.business ? <p className="text-[13px] text-ink mb-2"><span className="text-muted">Owned by</span> <b>{rec.business}</b></p> : null}
      {!edit ? (
        <ul className="divide-y divide-line border-y border-line">
          {rows.map((o, i) => { const tel = telOf(o.phone); return (
            <li key={o.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="mr-auto min-w-0">
                <p className="text-[15px] font-semibold text-ink">{o.name || (i === 0 ? 'Owner' : 'Owner ' + (i + 1))}{rows.length > 1 && i === 0 ? <span className="font-normal text-muted text-[12.5px]"> · first owner</span> : null}</p>
                <p className="text-[13px] text-muted break-all">
                  {o.email ? <a href={'mailto:' + o.email} className="text-ink underline decoration-line underline-offset-2">{o.email}</a> : 'No email yet'}
                  {' · '}
                  {o.phone ? (tel ? <a href={'tel:' + tel} className="text-ink underline decoration-line underline-offset-2 whitespace-nowrap">{o.phone}</a> : o.phone) : 'No phone yet'}
                </p>
              </div>
              <div className="oo-noprint flex flex-wrap gap-2">
                {o.email ? <a href={'mailto:' + o.email} className={link}><Mail size={13} /> Email</a> : null}
                {tel ? <a href={'tel:' + tel} className={link}><Phone size={13} /> Call</a> : null}
                {tel ? <a href={'sms:' + tel} className={link}><MessageSquare size={13} /> Text</a> : null}
                {o.email ? <CopyBtn text={o.email} label="Copy email" /> : null}
              </div>
            </li>) })}
        </ul>
      ) : (
        <div className="oo-noprint space-y-3">
          {edit.map((o, i) => { const set = (p: Any) => setEdit(edit.map((x, j) => (j === i ? { ...x, ...p } : x))); return (
            <div key={o.id} className="grid gap-2 sm:grid-cols-3">
              <label className="block"><span className={lab}>{i === 0 ? 'First owner' : 'Owner ' + (i + 1)} · name</span><input value={o.name} onChange={e => set({ name: e.target.value })} className={field} autoComplete="off" /></label>
              <label className="block"><span className={lab}>Email</span><input type="email" value={o.email} onChange={e => set({ email: e.target.value })} className={field} autoComplete="off" /></label>
              <label className="block"><span className={lab}>Phone</span><input type="tel" value={o.phone} onChange={e => set({ phone: e.target.value })} className={field} autoComplete="off" placeholder="(305) 555-0100" /></label>
            </div>) })}
          <p className="text-[12px] text-muted">An owner signs in with their email, so changing it changes what they sign in with. To add or remove an owner, use the portal accounts card below.</p>
          <div className="flex items-center gap-3"><button type="button" disabled={busy} onClick={save} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save</button><button type="button" onClick={() => { setEdit(null); setMsg('') }} className="text-[12.5px] text-muted underline">Cancel</button></div>
        </div>
      )}
      {msg ? <p className="text-[12.5px] text-ink mt-2" role="status">{msg}</p> : null}
    </section>
  )
}

// ── THE INVENTORY REVIEW (Jon, 2026-11-13): the owner's answer, the walkthrough's count, and the team's call on each item,
//    side by side; then the order list is generated from what is really short ──
function InventoryReview({ rec, sup, units, uLabel, onApply, onMsg }: { rec: Any; sup: OOItem[]; units: OOHome[]; uLabel: (i: number) => string; onApply: (d: Any) => void; onMsg: (m: string) => void }) {
  const [busy, setBusy] = useState(''); const [note, setNote] = useState(''); const [short, setShort] = useState(false); const [ui, setUi] = useState(0)
  const [team, setTeam] = useState<string[]>([])
  useEffect(() => { fetch('/api/owner-onboarding/settings').then(r => r.json()).then(d => setTeam(d?.settings?.walkTo || [])).catch(() => {}) }, [])
  const w = rec.walk || null
  const host = typeof window !== 'undefined' ? window.location.origin : ''
  const link = w?.key ? `${host}/join/${rec.code}/walk?k=${w.key}` : ''
  async function post(path: string, body: Any, tag: string) {
    setBusy(tag); setNote('')
    const d = await fetch(`/api/owner-onboarding/${rec.code}${path}`, { method: path ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).catch(() => null)
    setBusy(''); if (d?.record) onApply(d); setNote(d?.ok ? (d.note || '') : (d?.error || 'Not saved.')); return d
  }
  const save = (body: Any) => post('', body, 'save')
  const rows = sup.filter(i => i.unit === ui).map(i => ({ i, s: stockOf(rec, i) }))
  const shown = short ? rows.filter(x => x.s.toBuy > 0 || x.s.decision) : rows
  const all = sup.map(i => stockOf(rec, i))
  const toBuy = all.filter(s => s.toBuy > 0).length, unknown = all.filter(s => s.onHand == null && !s.decision).length, declined = all.filter(s => s.decision).length
  const groups = Array.from(new Set(shown.map(x => x.i.group)))
  const says = (x: { i: OOItem; s: Any }) => (x.s.owner == null ? '—' : x.i.qty > 1 ? String(x.s.owner) : x.s.owner >= 1 ? 'Yes' : 'No')
  const inp = 'w-14 rounded-lg border border-line px-2 py-1 text-[12.5px] text-ink text-right'
  return (
    <div>
      <div className={'rounded-xl p-3 mb-3 ' + (w?.doneAt ? 'bg-emerald-50' : 'bg-amber-50')}>
        <p className={lab}>{w?.doneAt ? 'Inventory closed out' : 'Walkthrough needed'}</p>
        <p className="text-[13px] text-ink mt-1">{rec.stock === 'full' ? 'The owner says the home is fully stocked. ' : rec.stock === 'none' ? 'The owner says nothing has been bought yet. ' : ''}{w?.doneAt ? `${w.by || 'The team'} finished the count on ${new Date(w.doneAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : w?.startedAt ? `${w.by || 'Someone'} has started the count; ${Object.keys(w.counts || {}).length} of ${sup.length} items so far.` : 'We walk every unit before ordering, to count what is really there.'}{w?.sentAt && !w?.doneAt ? ` Request sent ${new Date(w.sentAt).toLocaleDateString()} to ${(w.sentTo || []).join(', ')}.` : ''}</p>
        {w?.doneAt && w?.closedNote ? <p className="text-[13px] text-ink mt-1">{String(w.closedNote).replace(/^Inventory closed out\.\s*/, '')} The count sheet is locked; Reopen lets it be changed.</p> : null}
        {w?.note ? <p className="text-[13px] text-ink mt-1 whitespace-pre-wrap">Note from the walkthrough: “{w.note}”</p> : null}
        <div className="oo-noprint flex flex-wrap items-center gap-2 mt-2">
          <button type="button" disabled={!!busy} onClick={() => post('/walk', { action: 'send' }, 'send')} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold disabled:opacity-50">{busy === 'send' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {w?.sentAt ? 'Send the walkthrough again' : 'Send the walkthrough to the team'}</button>
          {link ? <CopyBtn text={link} label="Copy the walkthrough link" small /> : <button type="button" disabled={!!busy} onClick={() => post('/walk', { action: 'link' }, 'link')} className="rounded-xl border border-line bg-white px-3 py-2 text-[13px] font-semibold text-ink">Get the walkthrough link</button>}
          {link ? <a href={link} target="_blank" rel="noreferrer" className="text-[12.5px] font-semibold text-ink underline">Open the count sheet</a> : null}
          {w?.doneAt ? <button type="button" onClick={() => post('/walk', { action: 'reopen' }, 'reopen')} className="text-[12.5px] text-muted underline">Reopen</button>
            : <button type="button" disabled={!!busy} onClick={() => post('/walk', { action: 'close' }, 'close')} title="Locks the count sheet, marks the Supplies check done and builds the order list from the count" className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-[13px] font-semibold text-ink disabled:opacity-50">{busy === 'close' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Close out the inventory</button>}
          <span className="text-[12px] text-muted basis-full">Goes to {team.length ? team.join(', ') : 'whoever is set under “Handoff and vendor emails”'}. The link opens a count sheet on a phone, no sign-in.</span>
        </div>
      </div>
      <div className="oo-noprint flex flex-wrap items-center gap-x-4 gap-y-2 mb-2 text-[12.5px]">
        {units.length > 1 ? <div className="inline-flex rounded-full bg-app p-0.5 font-semibold">{units.map((_, i) => <button key={i} type="button" onClick={() => setUi(i)} className={'rounded-full px-3 py-1 ' + (ui === i ? 'bg-white text-ink shadow-sm' : 'text-muted')}>{uLabel(i)}</button>)}</div> : null}
        <label className="inline-flex items-center gap-1.5 text-ink"><input type="checkbox" checked={short} onChange={e => setShort(e.target.checked)} /> Only what is short or decided</label>
        <span className="text-muted ml-auto"><b className="text-[#B4532A]">{toBuy}</b> to buy · <b className="text-ink">{declined}</b> not buying · <b className="text-ink">{unknown}</b> not counted yet</span>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-[12.5px]">
        <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted border-b border-line"><th className="py-1.5 font-semibold">Item</th><th className="px-1 text-right font-semibold">Needs</th><th className="px-1 text-right font-semibold">Owner says</th><th className="px-1 text-right font-semibold">Walkthrough</th><th className="px-1 text-right font-semibold">To buy</th><th className="pl-2 font-semibold">Decision</th></tr></thead>
        <tbody>{groups.map(g => [<tr key={'g' + g}><td colSpan={6} className={lab + ' pt-3 pb-1'}>{g}</td></tr>, ...shown.filter(x => x.i.group === g).map(({ i, s }) => (
          <tr key={i.key} className="border-b border-line">
            <td className="py-1.5 pr-2 text-ink">{i.name}</td>
            <td className="px-1 text-right tabular-nums text-muted">{i.qty}</td>
            <td className="px-1 text-right tabular-nums">{says({ i, s })}</td>
            <td className="px-1 text-right">{i.qty > 1
              ? <input inputMode="numeric" defaultValue={s.walk == null ? '' : String(s.walk)} key={i.key + ':' + (s.walk ?? '')} placeholder="—" onBlur={e => { const v = e.target.value.replace(/\D/g, ''); if ((v === '' ? null : Number(v)) !== s.walk) save({ walkCounts: { [i.key]: v === '' ? null : Number(v) } }) }} className={inp + ' oo-noprint'} />
              : <select value={s.walk == null ? '' : s.walk >= 1 ? '1' : '0'} onChange={e => save({ walkCounts: { [i.key]: e.target.value === '' ? null : Number(e.target.value) } })} className="oo-noprint rounded-lg border border-line px-1.5 py-1 text-[12.5px] text-ink"><option value="">—</option><option value="1">Yes</option><option value="0">No</option></select>}</td>
            <td className={'px-1 text-right tabular-nums font-semibold ' + (s.toBuy > 0 ? 'text-[#B4532A]' : 'text-emerald-700')}>{s.decision ? '0' : s.onHand == null ? <span className="text-muted font-normal">{i.qty}?</span> : s.toBuy}</td>
            <td className="pl-2"><select value={s.decision} onChange={e => save({ decisions: { [i.key]: e.target.value } })} className={'oo-noprint rounded-lg border border-line px-1.5 py-1 text-[12.5px] max-w-[190px] ' + (s.decision ? 'text-ink font-semibold bg-app' : 'text-muted')}><option value="">Buy what is short</option>{OO_DECISIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></td>
          </tr>))])}</tbody>
      </table></div>
      {!shown.length ? <p className="text-[13px] text-muted py-3">Nothing is short on this unit.</p> : null}
      <div className="oo-noprint flex flex-wrap items-center gap-3 mt-4">
        <button type="button" disabled={!!busy} onClick={async () => { const d = await post('/order', { action: 'build' }, 'order'); if (d?.ok) { onMsg('Order list built from the inventory review.'); document.getElementById('oo-order')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) } }} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-4 py-2 text-[13px] font-semibold disabled:opacity-50">{busy === 'order' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {rec.order ? 'Rebuild the order list from this' : 'Generate the order list'}</button>
        <span className="text-[12.5px] text-muted">{unknown ? `${unknown} items have no count yet; they are treated as needed.` : 'Every item is counted.'}{rec.order ? ' Rebuilding replaces hand edits on the current order list.' : ''}</span>
      </div>
      {note ? <p className="text-[12.5px] text-ink mt-2">{note}</p> : null}
    </div>
  )
}

// ── THE ORDER LIST: our actual items, edited by the team, sent to the owner to review ──
function OrderList({ rec, units, onRec }: { rec: Any; units: string[]; onRec: (r: Any) => void }) {
  const o = rec.order
  const [lines, setLines] = useState<Any[]>(o?.lines || [])
  const [note, setNote] = useState(o?.note || '')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState('')
  useEffect(() => { setLines(rec.order?.lines || []); setNote(rec.order?.note || ''); setDirty(false) }, [rec.order?.builtAt, rec.order?.status])
  const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  async function act(action: string, extra: Any = {}) {
    setBusy(action); setMsg('')
    const d = await fetch(`/api/owner-onboarding/${rec.code}/order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) }).then(r => r.json()).catch(() => null)
    setBusy(''); if (d?.record) onRec(d.record); setMsg(d?.ok ? (d.note || 'Saved.') : (d?.error || 'Not saved.')); return !!d?.ok
  }
  const set = (i: number, p: Any) => { setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...p } : l))); setDirty(true) }
  // THE EMAIL, SEEN AND EDITED BEFORE IT GOES (Jon, 2026-11-18: "send owner for review should show preview of email.
  // Also I should be able to edit"). Send opens the email first: who gets it, the subject and the message, both
  // editable. The greeting, the steps, the button and the signature are fixed and shown as they will read.
  const [mail, setMail] = useState<Any | null>(null); const [subj, setSubj] = useState(''); const [body, setBody] = useState('')
  async function openMail() {
    if (dirty && !(await act('save', { lines, note }))) return
    setBusy('preview'); setMsg('')
    const d = await fetch(`/api/owner-onboarding/${rec.code}/order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview' }) }).then(r => r.json()).catch(() => null)
    setBusy('')
    if (!d?.ok) { setMsg(d?.error || 'Could not open the email.'); return }
    setMail(d.email); setSubj(d.email.subject); setBody(d.email.message)
  }
  async function sendMail() { if (await act('send', { subject: subj, message: body })) setMail(null) }
  // NOT IN OUR CATALOG (Jon, 2026-11-17: "have it where we can select our hand selected items or just send
  // the list"). What the owner marked "need" that our catalog does not carry is a tick list: tick the ones we
  // are buying and they go on the order as lines to price, or leave them and send the list as it is.
  const [pick, setPick] = useState<string[]>([])
  // COLLAPSABLE (Jon, 2026-11-18: "looks weird and clunky. Should be collapsable too"). Folded, the card is one
  // line: status, how many items, the estimate, how many bought. The choice is remembered per onboarding in
  // this browser; storage can be blocked, so it is only ever a convenience.
  const foldKey = 'oo-order-fold:' + rec.code
  const [fold, setFold] = useState(false)
  useEffect(() => { try { setFold(localStorage.getItem(foldKey) === '1') } catch {} }, [foldKey])
  const toggleFold = () => setFold(f => { try { localStorage.setItem(foldKey, f ? '0' : '1') } catch {} return !f })
  const onList = (x: string) => { const p = parseNeed(x); return lines.some(l => String(l.name).toLowerCase() === p.name.toLowerCase() && (p.unit < 0 || (Number(l.qty[p.unit]) || 0) > 0)) }
  function parseNeed(x: string) {
    const q = x.match(/\s×(\d+)$/); let name = q ? x.slice(0, q.index) : x
    const u = name.match(/\s\(([^()]+)\)$/); let unit = -1
    if (u && units.indexOf(u[1]) >= 0) { unit = units.indexOf(u[1]); name = name.slice(0, u.index) }
    return { name: name.trim(), unit, n: q ? Number(q[1]) || 1 : 1 }
  }
  function addNeeds(xs: string[]) {
    setLines(ls => { const out = ls.slice()
      for (const x of xs) { const p = parseNeed(x), ui = p.unit < 0 ? 0 : p.unit
        const at = out.findIndex(l => String(l.name).toLowerCase() === p.name.toLowerCase() && String(l.key).startsWith('n'))
        if (at >= 0) out[at] = { ...out[at], qty: units.map((_, k) => (k === ui ? Math.max(Number(out[at].qty[k]) || 0, p.n) : Number(out[at].qty[k]) || 0)) }
        else out.push({ key: 'n' + Date.now().toString(36) + out.length, category: 'Added by the team', name: p.name, detail: 'Owner marked as needed; not in our catalog', url: '', price: null, qty: units.map((_, k) => (k === ui ? p.n : 0)) })
      }
      return out })
    setPick([]); setDirty(true); setMsg(xs.length + (xs.length === 1 ? ' item' : ' items') + ' added to the list below. Add a price and a link, then save.')
  }
  // Downloads are of the SAVED list, so unsaved edits are saved first.
  async function download(format: 'pdf' | 'xlsx') { if (dirty && !(await act('save', { lines, note }))) return; window.location.href = `/api/owner-onboarding/${rec.code}/order?format=${format}` }
  const skip: string[] = o?.review?.skip || []
  const total = lines.filter(l => skip.indexOf(l.key) < 0).reduce((a, l) => a + (Number(l.price) || 0) * l.qty.reduce((x: number, y: number) => x + (Number(y) || 0), 0), 0)
  const inp = 'rounded-lg border border-line bg-white px-2 py-1 text-[12.5px] text-ink'
  // the name reads as text until you go to edit it: no box on every row
  const nameInp = 'w-full border-0 border-b border-transparent bg-transparent px-0 py-0.5 text-[13px] font-semibold text-ink hover:border-line focus:border-ink focus:outline-none focus:ring-0'
  const buy = lines.filter(l => skip.indexOf(l.key) < 0)
  const boughtN = buy.filter(l => rec.shop?.got?.[l.key]).length
  const priced = buy.some(l => l.price != null && l.price !== '')
  const summary = !o ? 'Not built yet' : [buy.length + (buy.length === 1 ? ' item' : ' items'), priced ? money(total) + ' est.' : '', rec.shop?.key ? boughtN + ' bought' : '', dirty ? 'unsaved changes' : ''].filter(Boolean).join(' · ')
  // lines under their category, in the order the categories first appear; i stays the line's own index
  const groups: { cat: string; rows: { l: Any; i: number }[] }[] = []
  lines.forEach((l, i) => { const cat = String(l.category || 'Other'); let g = groups.find(x => x.cat === cat); if (!g) { g = { cat, rows: [] }; groups.push(g) } g.rows.push({ l, i }) })
  const b = o?.basis
  const basisLine = !b ? '' : [!b.marked ? 'the full list, the owner has not ticked supplies yet' : b.walked ? 'built after the walkthrough' : 'built before the walkthrough, counts are the owner’s own', b.leftOff.length ? b.leftOff.length + ' left off' : '', b.partial.length ? b.partial.length + ' partly there' : ''].filter(Boolean).join(' · ')
  const rowBtn = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-ink disabled:opacity-50'
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={toggleFold} aria-expanded={!fold} className="flex items-baseline gap-x-3 gap-y-1 flex-wrap text-left mr-auto min-w-0">
          <h2 className="font-serif text-[22px] leading-none text-ink">Order list</h2>
          <span className="text-[12.5px] text-muted">{summary}</span>
        </button>
        {o ? <span className={'rounded-full px-2 py-0.5 text-[11.5px] font-semibold ' + (o.status === 'approved' ? 'bg-emerald-50 text-emerald-800' : o.status === 'changes' ? 'bg-amber-50 text-amber-800' : o.status === 'sent' ? 'bg-app text-ink' : 'bg-app text-muted')}>{o.status === 'approved' ? (o.review?.self ? 'Owner is ordering it themselves' : 'Approved by the owner') : o.status === 'changes' ? 'Owner asked for changes' : o.status === 'sent' ? 'With the owner for review' : 'Draft'}</span> : null}
        <button type="button" onClick={toggleFold} title={fold ? 'Open' : 'Close'} aria-label={fold ? 'Open the order list' : 'Close the order list'} className="rounded-lg p-1 text-muted hover:text-ink"><ChevronDown size={18} className={'transition-transform ' + (fold ? '-rotate-90' : '')} /></button>
      </div>
      {fold ? null : <div className="mt-3">
      {!o ? <p className="text-[12.5px] text-muted mb-3">What {units.length > 1 ? 'each unit' : 'the home'} still needs, from the owner’s supplies answers and the walkthrough. Linen is separate.</p> : null}
      {!o ? <button type="button" disabled={busy === 'build' || !units.length} onClick={() => act('build')} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold disabled:opacity-50">{busy === 'build' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Build the order list</button> : (<>
        {o.basis ? <div className="oo-noprint mb-3 text-[12.5px] text-ink">
          <details className="group"><summary className="cursor-pointer list-none text-muted hover:text-ink [&::-webkit-details-marker]:hidden"><span className="underline decoration-dotted underline-offset-2">How this list was built</span>: {basisLine}</summary>
          <div className="mt-2 rounded-xl bg-app p-3 space-y-1">
          {!o.basis.marked ? <p>The owner has not ticked the supplies list yet, so this is the full list for the home. Rebuild it once they have.</p> : null}
          {o.basis.leftOff.length ? <p><b>Left off, the owner has these:</b> {o.basis.leftOff.join(', ')}</p> : o.basis.marked ? <p>Nothing was left off: the owner did not mark a whole product as already there.</p> : null}
          {o.basis.partial.length ? <div><b>Sets the owner partly has (kept on the list, check them):</b><ul className="list-disc pl-5">{o.basis.partial.map((x: string) => <li key={x}>{x}</li>)}</ul></div> : null}
          {o.basis.walked ? <p className="text-emerald-800 font-semibold">Built after the walkthrough was finished.</p> : o.basis.marked ? <p className="text-amber-800">Built before the walkthrough was finished: counts are the owner’s own.</p> : null}
          {o.basis.short?.length ? <div><b>Partly there, by count:</b><ul className="list-disc pl-5">{o.basis.short.map((x: string) => <li key={x}>{x}</li>)}</ul></div> : null}
          {o.basis.declined?.length ? <div><b>Not buying (the owner or the team said no):</b><ul className="list-disc pl-5">{o.basis.declined.map((x: string) => <li key={x}>{x}</li>)}</ul></div> : null}
          </div></details>
          {o.basis.uncovered.length ? (() => { const left: string[] = o.basis.uncovered.filter((x: string) => !onList(x)); return (
            <div className="mt-2 rounded-xl bg-app p-3">
              <p><b>Marked “need”, not in our catalog.</b> {left.length ? 'Tick the ones we are buying to add them to the list, or leave them and send the list as it is.' : 'All of these are on the list now.'}</p>
              {left.length ? <>
                <div className="flex flex-wrap gap-1.5 mt-2">{left.map((x: string) => { const on = pick.indexOf(x) >= 0; return (
                  <label key={x} className={'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 cursor-pointer select-none ' + (on ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink')}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => setPick(p => (on ? p.filter(y => y !== x) : [...p, x]))} />{on ? <Check size={11} /> : <Plus size={11} />}{x}</label>) })}</div>
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  <button type="button" disabled={!pick.length} onClick={() => addNeeds(pick)} className="rounded-xl bg-ink text-white px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40">Add {pick.length || ''} ticked to the list</button>
                  <button type="button" onClick={() => addNeeds(left)} className="text-[12.5px] font-semibold text-ink underline">Add all {left.length}</button>
                  {pick.length ? <button type="button" onClick={() => setPick([])} className="text-[12.5px] text-muted underline">Clear</button> : null}
                </div></> : null}
            </div>) })() : null}
        </div> : null}
        {o.review ? <div className={'rounded-xl p-3 mb-3 ' + (o.status === 'approved' ? 'bg-emerald-50' : 'bg-amber-50')}><p className={lab}>The owner’s review · {new Date(o.review.at).toLocaleString()}</p>
          {o.review.self ? <p className="text-[13px] text-ink mt-1 font-semibold">The owner is buying these themselves and ticks them off as they arrive. Nothing for us to order.</p> : null}
          {o.review.skip.length ? <p className="text-[13px] text-ink mt-1">Already has: {o.review.skip.map((k: string) => lines.find(l => l.key === k)?.name || k).join(', ')}</p> : null}
          {o.review.note ? <p className="text-[13px] text-ink mt-1 whitespace-pre-wrap">“{o.review.note}”</p> : null}</div> : null}
        <div className="overflow-x-auto"><table className="w-full min-w-[460px] text-[12.5px]">
          <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted"><th className="pb-1 font-semibold min-w-[150px]">Item</th>{units.map(u => <th key={u} className="px-1 pb-1 text-right font-semibold whitespace-nowrap">{units.length > 1 ? u : 'Qty'}</th>)}<th className="px-1 pb-1 text-right font-semibold">Each</th><th className="pb-1 text-right font-semibold">Total</th><th /></tr></thead>
          {groups.map(g => <tbody key={g.cat}>
            <tr><td colSpan={units.length + 4} className="pt-3 pb-1 border-b border-line text-[11.5px] font-semibold text-muted">{g.cat} <span className="font-normal">· {g.rows.length}</span></td></tr>
            {g.rows.map(({ l, i }) => { const q = l.qty.reduce((x: number, y: number) => x + (Number(y) || 0), 0), off = skip.indexOf(l.key) >= 0, got = !!rec.shop?.got?.[l.key]
              const sub = [l.detail && l.detail !== l.name ? l.detail : '', off ? 'owner has this' : ''].filter(Boolean).join(' · '); return (
            <tr key={l.key} className={'group/row border-b border-line/60 align-middle ' + (off ? 'opacity-50' : '')}>
              <td className="py-1 pr-2"><input value={l.name} onChange={e => set(i, { name: e.target.value })} className={nameInp} aria-label="Item name" />
                {sub || got || l.url ? <span className="block text-[11.5px] text-muted leading-snug">{got ? <b className="text-emerald-700">Bought{sub || l.url ? ' · ' : ''}</b> : null}{sub}{l.url ? <>{sub ? ' · ' : ''}<a href={l.url} target="_blank" rel="noreferrer" className="underline">link</a></> : null}</span> : null}</td>
              {units.map((u, ui) => <td key={u} className="px-1 text-right"><input inputMode="numeric" value={String(l.qty[ui] ?? 0)} onChange={e => set(i, { qty: units.map((_, k) => (k === ui ? Number(e.target.value.replace(/\D/g, '')) || 0 : l.qty[k] || 0)) })} className={inp + ' w-12 text-right tabular-nums'} aria-label={'Quantity' + (units.length > 1 ? ', ' + u : '')} /></td>)}
              <td className="px-1 text-right"><input inputMode="decimal" placeholder="$" value={l.price ?? ''} onChange={e => set(i, { price: e.target.value === '' ? null : e.target.value })} className={inp + ' w-[68px] text-right tabular-nums'} aria-label="Price each" /></td>
              <td className="text-right tabular-nums text-ink">{l.price != null && l.price !== '' ? money(Number(l.price) * q) : <span className="text-muted">—</span>}</td>
              <td className="pl-1 w-6 text-right"><button type="button" onClick={() => { setLines(ls => ls.filter((_, j) => j !== i)); setDirty(true) }} className="text-[15px] leading-none text-muted/50 hover:text-red-700 group-hover/row:text-muted" title="Remove" aria-label={'Remove ' + l.name}>×</button></td>
            </tr>) })}
          </tbody>)}
          <tfoot><tr><td className="pt-3 font-semibold text-ink" colSpan={units.length + 2}>Estimated total{skip.length ? ' (without what the owner has)' : ''}</td><td className="pt-3 text-right font-semibold tabular-nums">{priced ? money(total) : '—'}</td><td /></tr></tfoot>
        </table></div>
        <div className="oo-noprint">
          <button type="button" onClick={() => { setLines(ls => [...ls, { key: 'c' + Date.now().toString(36), category: 'Other', name: 'New item', detail: '', url: '', price: null, qty: units.map(() => 1) }]); setDirty(true) }} className="mt-2 text-[12.5px] font-semibold text-ink">+ Add an item</button>
          <label className="block mt-3"><span className={lab}>Note to the owner (shown above the list)</span><textarea rows={2} value={note} onChange={e => { setNote(e.target.value); setDirty(true) }} className={field} placeholder="e.g. We left off what you marked as already in the home." /></label>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button type="button" disabled={!dirty || !!busy} onClick={() => act('save', { lines, note })} className="rounded-xl border border-line px-3 py-2 text-[13px] font-semibold text-ink disabled:opacity-40">Save changes</button>
            <button type="button" disabled={!!busy || !!mail} onClick={openMail} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold disabled:opacity-50">{busy === 'preview' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {o.status === 'draft' ? 'Send to the owner to review' : 'Send again'}</button>
            {o.status !== 'draft' ? <button type="button" onClick={() => act('unsend')} className="text-[12.5px] text-muted underline">Take it back to a draft</button> : null}
            <button type="button" onClick={() => act('build')} className="text-[12.5px] text-muted underline">Rebuild from the supplies list</button>
          </div>
          {mail ? <div className="mt-3 rounded-xl border border-ink/20 bg-app/60 p-3 text-[12.5px] text-ink">
            <p className={lab}>The email the owner gets</p>
            <p className="mt-1.5"><span className="text-muted">To</span> {mail.to.length ? mail.to.map((a: Any) => a.email).join(', ') : <b className="text-amber-800">No owner email on file: the list goes on their page, send them the link yourself.</b>}{mail.cc.length ? <><span className="text-muted"> · Cc</span> {mail.cc.join(', ')}</> : null}</p>
            <label className="block mt-2"><span className="text-muted">Subject</span><input value={subj} onChange={e => setSubj(e.target.value)} maxLength={200} className={field} /></label>
            <div className="mt-2 rounded-xl border border-line bg-white p-3">
              <p className="text-[13px]">Hi {(mail.to[0]?.name || '').split(' ')[0] || 'there'},</p>
              <textarea rows={7} value={body} onChange={e => setBody(e.target.value)} maxLength={4000} aria-label="Message" className="mt-1.5 w-full rounded-lg border border-line px-2.5 py-2 text-[13px] leading-relaxed text-ink" />
              <ol className="mt-1.5 list-decimal pl-5 text-[13px] text-muted">{mail.steps.map((x: string) => <li key={x}>{x}</li>)}</ol>
              <p className="mt-2"><span className="inline-block rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-white">{mail.button}</span></p>
              <p className="mt-2 text-[11.5px] text-muted">{mail.note} Signed by {mail.from || 'the GM'}.{mail.to.length > 1 ? ' Each owner is greeted by their own first name.' : ''}</p>
            </div>
            <p className="mt-1.5 text-[11.5px] text-muted">You can edit the subject and the message. A blank line starts a new paragraph. The greeting, steps, button and signature are added for you.</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <button type="button" disabled={!!busy || !body.trim()} onClick={sendMail} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold disabled:opacity-50">{busy === 'send' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {mail.to.length ? 'Send it' : 'Put it on the owner’s page'}</button>
              <button type="button" onClick={() => { setSubj(mail.subject); setBody(mail.message) }} className="text-[12.5px] text-muted underline">Reset the wording</button>
              <button type="button" onClick={() => setMail(null)} className="text-[12.5px] text-muted underline">Cancel</button>
            </div>
          </div> : null}
          <div className="mt-4 rounded-xl border border-line divide-y divide-line text-[12.5px] text-ink">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="mr-auto"><b>Download</b> <span className="text-muted">the list for whoever is buying</span></span>
              <button type="button" disabled={!!busy} onClick={() => download('pdf')} className={rowBtn}><Printer size={13} /> PDF</button>
              <button type="button" disabled={!!busy} onClick={() => download('xlsx')} className={rowBtn}><Download size={13} /> Excel</button>
            </div>
            {/* The same list as a link (Jon, 2026-11-17: "like a shopping list that as they get they can mark"). */}
            {(() => { const sh = rec.shop, host = typeof window !== 'undefined' ? window.location.origin : '', link = sh?.key ? `${host}/join/${rec.code}/shop?k=${sh.key}` : ''
              return (
                <div className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-auto"><b>Shopping link</b> <span className="text-muted">{link ? <>{boughtN} of {buy.length} bought{sh?.by ? ', last by ' + sh.by : ''}</> : 'they tap each line as they get it, no sign-in'}</span></span>
                    {link ? <>
                      <button type="button" onClick={async () => { if (dirty && !(await act('save', { lines, note }))) return; try { await navigator.clipboard.writeText(link); setMsg('Shopping link copied.') } catch { setMsg(link) } }} className={rowBtn}><Copy size={13} /> Copy link</button>
                      <a href={link} target="_blank" rel="noreferrer" className={rowBtn}><ExternalLink size={13} /> Open</a>
                    </> : <button type="button" disabled={!!busy} onClick={async () => { if (dirty && !(await act('save', { lines, note }))) return; act('shop') }} className={rowBtn}>{busy === 'shop' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Make the link</button>}
                  </div>
                  {link ? <p className="mt-1 text-[11.5px] text-muted"><button type="button" className="underline" onClick={() => act('shop')}>Refresh</button> · <button type="button" className="underline" onClick={() => act('shop', { reset: true })}>Clear the ticks</button> · <button type="button" className="underline" onClick={() => act('shop', { off: true })}>Switch the link off</button></p> : null}
                </div>) })()}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="mr-auto"><b>Unit FAQ</b> <span className="text-muted">{rec.faq ? `${rec.faq.added} ${rec.faq.added === 1 ? 'entry' : 'entries'} added, last on ${new Date(rec.faq.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : rec.attach?.listingId ? (o.status === 'approved' ? 'approved items go in automatically' : 'items go in once the owner approves, with the Wi-Fi, parking and laundry') : 'attach the unit to its Guesty listing first'}</span></span>
              {rec.attach?.listingId ? <button type="button" disabled={!!busy} onClick={() => act('faq')} className={rowBtn}>{busy === 'faq' ? 'Updating…' : 'Update now'}</button> : null}
            </div>
          </div>
        </div>
      </>)}
      </div>}
      {msg ? <p className="text-[12.5px] text-ink mt-2">{msg}</p> : null}
    </section>
  )
}

// ── the introductory email, ready to copy ──
function IntroEmail({ rec, onRec }: { rec: Any; onRec?: (r: Any) => void }) {
  const [from, setFrom] = useState<'sales' | 'gm'>(rec.custom.from || 'sales')
  const e = introEmail({ ...rec, custom: { ...rec.custom, from } }, ownerLink(rec.code))
  const to = rec.custom.ownerEmail || ''
  const [team, setTeam] = useState<string[]>([])
  useEffect(() => { fetch('/api/owner-onboarding/settings').then(r => r.json()).then(d => setTeam(d?.settings?.teamCc || [])).catch(() => {}) }, [])
  const cc = Array.from(new Set([from === 'sales' ? rec.custom.gm.email : '', ...team].filter(Boolean))).join(', ')
  // It leaves from a person's own mailbox, so Lighthouse cannot see it go: opening it in email marks it sent, and it can be set by hand.
  const intro = rec.intro as { at: string; by: string } | null | undefined
  async function setSent(sent: boolean) {
    const d = await fetch('/api/owner-onboarding/' + rec.code, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intro: { sent, from } }) }).then(r => r.json()).catch(() => null)
    if (d?.record && onRec) onRec(d.record)
  }
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="font-serif text-[22px] leading-none text-ink">Introductory email</h2>
        <span className={'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-semibold mr-auto ' + (intro ? TRACK_TONE.ok : TRACK_TONE.no)}>{intro ? <Check size={12} className="text-emerald-600" /> : null}{intro ? 'Sent ' + shortDay(intro.at) + (intro.by ? ' by ' + intro.by.split('@')[0] : '') : 'Not sent yet'}</span>
        <div className="inline-flex rounded-full bg-app p-0.5 text-[12px] font-semibold">
          {(['sales', 'gm'] as const).map(k => <button key={k} type="button" onClick={() => setFrom(k)} className={'rounded-full px-3 py-1 ' + (from === k ? 'bg-white text-ink shadow-sm' : 'text-muted')}>From {k === 'sales' ? (rec.custom.sales.name.split(' ')[0] || 'sales') : (rec.custom.gm.name.split(' ')[0] || 'the GM')}</button>)}
        </div>
      </div>
      <p className={lab}>To</p><p className="text-[13.5px] text-ink">{to || <span className="text-muted">Add the owner’s email above</span>}</p>
      {cc ? <><p className={lab + ' mt-3'}>Cc</p><div className="flex flex-wrap items-center gap-2"><p className="text-[13px] text-ink mr-auto break-all">{cc}</p><CopyBtn text={cc} label="Copy cc" small /></div></> : null}
      <p className={lab + ' mt-3'}>Subject</p>
      <div className="flex flex-wrap items-center gap-2"><p className="text-[14px] font-semibold text-ink mr-auto">{e.subject}</p><CopyBtn text={e.subject} label="Copy subject" small /></div>
      <p className={lab + ' mt-3'}>Message</p>
      <pre className="mt-1 whitespace-pre-wrap rounded-xl bg-app p-3 text-[13px] leading-relaxed text-ink font-sans max-h-[360px] overflow-auto">{e.body}</pre>
      <div className="flex flex-wrap gap-2 mt-3">
        <CopyBtn text={e.body} label="Copy message" />
        <a href={`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(e.subject)}${cc ? '&cc=' + encodeURIComponent(cc) : ''}&body=${encodeURIComponent(e.body)}`} onClick={() => { if (!intro) setSent(true) }} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold"><Mail size={13} /> Open in my email</a>
        <button type="button" onClick={() => setSent(!intro)} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-[13px] font-semibold text-ink">{intro ? 'Mark as not sent' : 'Mark as sent'}</button>
      </div>
      <p className="text-[11.5px] text-muted mt-2">This email goes from your own mailbox. Opening it in your email marks it sent; if you copied it instead, press Mark as sent.</p>
    </section>
  )
}

// ── a unit picker: the buildings and units in Guesty ──
function UnitPicker({ property, listingId, unitLabel, onPick }: { property: string; listingId: string; unitLabel: string; onPick: (p: { property: string; listingId: string; unitLabel: string }) => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Any[]>([])
  const [buildings, setBuildings] = useState<string[]>([])
  useEffect(() => { fetch('/api/owner-onboarding/units').then(r => r.json()).then(d => d?.ok && setBuildings(d.buildings)).catch(() => {}) }, [])
  useEffect(() => { const id = setTimeout(() => { if (!q.trim()) { setHits([]); return } fetch('/api/owner-onboarding/units?q=' + encodeURIComponent(q)).then(r => r.json()).then(d => setHits(d?.units || [])).catch(() => {}) }, 250); return () => clearTimeout(id) }, [q])
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block"><span className={lab}>Property</span>
        <input list="oo-buildings" value={property} onChange={e => onPick({ property: e.target.value, listingId, unitLabel })} placeholder="e.g. Elser" className={field} />
        <datalist id="oo-buildings">{buildings.map(b => <option key={b} value={b} />)}</datalist>
      </label>
      <div>
        <span className={lab}>Unit {listingId ? <span className="normal-case tracking-normal font-normal text-emerald-700">· attached to Guesty</span> : <span className="normal-case tracking-normal font-normal">· attach once it is in Guesty</span>}</span>
        <div className="relative">
          <input value={q || unitLabel} onChange={e => { setQ(e.target.value); onPick({ property, listingId: '', unitLabel: e.target.value }) }} placeholder="Unit number, or search Guesty" className={field} />
          {hits.length ? (
            <ul className="absolute z-20 left-0 right-0 mt-1 max-h-60 overflow-auto rounded-xl border border-line bg-white shadow-lg">
              {hits.map(h => <li key={h.id}><button type="button" onClick={() => { onPick({ property: h.building || property, listingId: h.id, unitLabel: h.unit || h.nickname }); setQ(''); setHits([]) }} className="w-full text-left px-3 py-2 text-[13px] hover:bg-app"><b className="text-ink">{h.building} {h.unit}</b> <span className="text-muted">{h.nickname}</span></button></li>)}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// ── the home, started by the team (optional) ──
function HomeEditor({ home, set }: { home: OOHome; set: (h: OOHome) => void }) {
  const num = (k: keyof OOHome, l: string, step = 1) => <label className="block"><span className={lab}>{l}</span><input inputMode="decimal" value={String(home[k] ?? '')} onChange={e => set({ ...home, [k]: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 } as OOHome)} className={field} step={step} /></label>
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <div className="block sm:col-span-3"><span className={lab}>Address</span><AddressInput value={home.address} lat={home.lat} lng={home.lng} inputClassName={field} onChange={p => set({ ...home, address: p.address, lat: p.lat, lng: p.lng })} /></div>
      <label className="block"><span className={lab}>Unit</span><input value={home.unit} onChange={e => set({ ...home, unit: e.target.value })} className={field} /></label>
      {num('sqft', 'Square feet')}{num('bedrooms', 'Bedrooms')}{num('bathrooms', 'Bathrooms', 0.5)}{num('guests', 'Sleeps')}
      {OO_BEDS.map(b => <label key={b} className="block"><span className={lab}>{b} beds</span><input inputMode="numeric" value={String(home.beds[b] || 0)} onChange={e => set({ ...home, beds: { ...home.beds, [b]: Number(e.target.value.replace(/\D/g, '')) || 0 } })} className={field} /></label>)}
      <label className="flex items-center gap-2 text-[13px] text-ink pt-5"><input type="checkbox" checked={home.sleeper} onChange={e => set({ ...home, sleeper: e.target.checked })} /> Sofa bed</label>
      <label className="flex items-center gap-2 text-[13px] text-ink pt-5"><input type="checkbox" checked={home.kitchen} onChange={e => set({ ...home, kitchen: e.target.checked })} /> Kitchen</label>
      <label className="flex items-center gap-2 text-[13px] text-ink pt-5"><input type="checkbox" checked={!!home.washer} onChange={e => set({ ...home, washer: e.target.checked })} /> Washer and dryer</label>
      <label className="block sm:col-span-2"><span className={lab}>Wi-Fi network</span><input value={home.wifiName || ''} onChange={e => set({ ...home, wifiName: e.target.value })} className={field} autoCapitalize="off" spellCheck={false} /></label>
      <label className="block sm:col-span-2"><span className={lab}>Wi-Fi password</span><input value={home.wifiPass || ''} onChange={e => set({ ...home, wifiPass: e.target.value })} className={field} autoCapitalize="off" spellCheck={false} autoComplete="off" /></label>
      <label className="block sm:col-span-2"><span className={lab}>Parking</span><input value={home.parking || ''} onChange={e => set({ ...home, parking: e.target.value })} className={field} placeholder="e.g. one assigned space, P2 #114" /></label>
      <label className="block sm:col-span-2"><span className={lab}>Access</span><input value={home.access || ''} onChange={e => set({ ...home, access: e.target.value })} className={field} placeholder="e.g. front desk holds the key" /></label>
      {home.kitchen ? <div className="sm:col-span-4 flex flex-wrap gap-2">{OO_APPLIANCES.map(a => <label key={a} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[12.5px] text-ink"><input type="checkbox" checked={home.appliances[a]} onChange={e => set({ ...home, appliances: { ...home.appliances, [a]: e.target.checked } })} /> {OO_APPLIANCE_LABEL[a]}</label>)}</div> : null}
    </div>
  )
}

export function OwnerOnboardingDesk() {
  const [links, setLinks] = useState<OOIndexRow[] | null>(null)
  const [q, setQ] = useState('')
  const [showArch, setShowArch] = useState(false)
  const [flt, setFlt] = useState('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [made, setMade] = useState<Any>(null)
  const [f, setF] = useState<Any>({ owners: [], ownerName: '', ownerEmail: '', ownerPhone: '', property: '', listingId: '', unitLabel: '', from: 'sales', greeting: '', gm: { ...DEFAULT_GM }, sales: { ...DEFAULT_SALES }, askSupplies: true, askLinen: true, askPayout: true, prefill: false, home: { ...DEFAULT_HOME }, teamNotes: '' })
  const agree = useRef<HTMLInputElement>(null)
  const [agreeFile, setAgreeFile] = useState<File | null>(null)
  const load = () => fetch('/api/owner-onboarding', { cache: 'no-store' }).then(r => r.json()).then(d => setLinks(d?.ok ? d.links : [])).catch(() => setLinks([]))
  useEffect(() => { load() }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg('')
    try {
      const body = { custom: { ownerName: f.ownerName, ownerEmail: f.ownerEmail, ownerPhone: f.ownerPhone, greeting: f.greeting, from: f.from, gm: f.gm, sales: f.sales, contact: f.gm, askHome: true, askSupplies: f.askSupplies, askLinen: f.askLinen, askPayout: f.askPayout }, attach: { property: f.property, listingId: f.listingId, unitLabel: f.unitLabel }, home: f.prefill ? f.home : null, teamNotes: f.teamNotes, owners: (f.owners || []).filter((o: Any) => o.name.trim() || o.email.trim()) }
      const d = await fetch('/api/owner-onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
      if (!d?.ok) throw new Error(d?.error || 'Could not create the link.')
      if (agreeFile) await uploadAgreement(d.code, agreeFile).catch(err => setMsg('The link is made, but the agreement did not upload: ' + err.message))
      const full = await fetch('/api/owner-onboarding/' + d.code).then(r => r.json())
      setMade(full.record); setCreating(false); setAgreeFile(null); load()
    } catch (err: Any) { setMsg(err.message) } finally { setBusy(false) }
  }

  const inScope = (links || []).filter(l => (showArch || !l.archived) && (!q.trim() || (l.ownerName + ' ' + l.property + ' ' + l.unitLabel).toLowerCase().includes(q.trim().toLowerCase())))
  const fHit = TRACK_FILTERS.find(x => x.key === flt)
  const shown = fHit ? inScope.filter(l => l.track && fHit.hit(l.track)) : inScope
  const P = (k: 'gm' | 'sales', key: string, label: string) => <label className="block"><span className={lab}>{label}</span><input value={f[k][key]} onChange={e => setF({ ...f, [k]: { ...f[k], [key]: e.target.value } })} className={field} /></label>

  return (
    <div className="max-w-[1200px] mx-auto">
      <header className="flex flex-wrap items-end gap-3 pb-5 mb-6 border-b border-line">
        <div className="mr-auto">
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted font-semibold">Owners</p>
          <h1 className="font-serif text-[40px] leading-none text-ink mt-1">Owner onboarding</h1>
          <p className="text-[13.5px] text-muted mt-2 max-w-[70ch]">One link per owner. They tell us about the home, tick the supplies it already has, and send their W-9 and bank details securely; the team gets a report and a timeline to work from, before anyone visits.</p>
        </div>
        <button type="button" onClick={() => { setCreating(c => !c); setMade(null) }} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-4 py-2.5 text-[13.5px] font-semibold"><Plus size={15} /> New owner link</button>
      </header>

      {made ? (
        <div className="space-y-4 mb-8">
          <section className={card + ' border-emerald-300 bg-emerald-50/40'}>
            <p className="text-[13px] font-semibold text-emerald-800 flex items-center gap-1.5"><Check size={15} /> Link ready for {made.custom.ownerName || 'the owner'}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <input readOnly value={ownerLink(made.code)} onFocus={e => e.target.select()} className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3 py-2 text-[13px] text-ink" />
              <CopyBtn text={ownerLink(made.code)} label="Copy link" />
              <a href={'/join/' + made.code} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-[13px] font-semibold text-ink"><ExternalLink size={13} /> Open as the owner</a>
              <a href={'/owner-onboarding/' + made.code} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold">Open the report</a>
            </div>
          </section>
          <InviteOwner rec={made} onRec={setMade} />
          <IntroEmail rec={made} />
        </div>
      ) : null}

      {creating ? (
        <form onSubmit={create} className={card + ' mb-8 space-y-5'}>
          <h2 className="font-serif text-[26px] leading-none text-ink">New owner link</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block"><span className={lab}>Owner name</span><input value={f.ownerName} onChange={e => setF({ ...f, ownerName: e.target.value })} className={field} required /></label>
            <label className="block"><span className={lab}>Owner email</span><input type="email" value={f.ownerEmail} onChange={e => setF({ ...f, ownerEmail: e.target.value })} className={field} /></label>
            <label className="block"><span className={lab}>Owner phone</span><input value={f.ownerPhone} onChange={e => setF({ ...f, ownerPhone: e.target.value })} className={field} /></label>
            {/* MORE THAN ONE OWNER FOR THE PROPERTY: each gets their own invite, password and portal sign-in */}
            {(f.owners || []).map((o: Any, i: number) => { const set = (p: Any) => setF({ ...f, owners: f.owners.map((x: Any, j: number) => (j === i ? { ...x, ...p } : x)) }); return [
              <label key={'n' + i} className="block"><span className={lab}>Owner {i + 2} name</span><input value={o.name} onChange={e => set({ name: e.target.value })} className={field} /></label>,
              <label key={'e' + i} className="block"><span className={lab}>Owner {i + 2} email</span><input type="email" value={o.email} onChange={e => set({ email: e.target.value })} className={field} /></label>,
              <label key={'p' + i} className="block"><span className={lab}>Owner {i + 2} phone <button type="button" onClick={() => setF({ ...f, owners: f.owners.filter((_: Any, j: number) => j !== i) })} className="normal-case tracking-normal font-normal text-muted underline ml-1">remove</button></span><input value={o.phone} onChange={e => set({ phone: e.target.value })} className={field} /></label>,
            ] })}
            <div className="sm:col-span-3 flex flex-wrap items-center gap-x-3 gap-y-1">{(f.owners || []).length < 5 ? <button type="button" onClick={() => setF({ ...f, owners: [...(f.owners || []), { name: '', email: '', phone: '' }] })} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink"><Plus size={13} /> Add another owner</button> : null}{(f.owners || []).length ? <span className="text-[12px] text-muted">Each owner gets their own invite, password and sign-in to the same portal.</span> : <span className="text-[12px] text-muted">For a property with more than one owner.</span>}</div>
          </div>
          <UnitPicker property={f.property} listingId={f.listingId} unitLabel={f.unitLabel} onPick={p => setF({ ...f, ...p })} />
          <div>
            <p className={lab}>The introductory email comes from</p>
            <div className="inline-flex rounded-full bg-app p-0.5 text-[12.5px] font-semibold mt-1">{(['sales', 'gm'] as const).map(k => <button key={k} type="button" onClick={() => setF({ ...f, from: k })} className={'rounded-full px-4 py-1.5 ' + (f.from === k ? 'bg-white text-ink shadow-sm' : 'text-muted')}>{k === 'sales' ? 'Sales, introducing the GM' : 'The GM'}</button>)}</div>
            <div className="grid gap-3 sm:grid-cols-4 mt-3">{P('gm', 'name', 'GM name')}{P('gm', 'role', 'GM title')}{P('gm', 'phone', 'GM phone')}{P('gm', 'email', 'GM email')}</div>
            {f.from === 'sales' ? <div className="grid gap-3 sm:grid-cols-4 mt-3">{P('sales', 'name', 'Sales name')}{P('sales', 'role', 'Sales title')}{P('sales', 'phone', 'Sales phone')}{P('sales', 'email', 'Sales email')}</div> : null}
          </div>
          <label className="block"><span className={lab}>Welcome line on the owner’s page (optional)</span><textarea rows={2} value={f.greeting} onChange={e => setF({ ...f, greeting: e.target.value })} placeholder="e.g. Welcome to the Elser family. This takes ten minutes and gets your unit ready for photos." className={field} /></label>
          <div className="flex flex-wrap gap-4 text-[13px] text-ink">
            <span className={lab + ' w-full'}>Ask the owner for</span>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked disabled /> The home</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.askSupplies} onChange={e => setF({ ...f, askSupplies: e.target.checked })} /> Supplies check</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.askLinen} onChange={e => setF({ ...f, askLinen: e.target.checked })} /> Linen check</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.askPayout} onChange={e => setF({ ...f, askPayout: e.target.checked })} /> W-9 and bank details</label>
          </div>
          <div>
            <label className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink"><input type="checkbox" checked={f.prefill} onChange={e => setF({ ...f, prefill: e.target.checked })} /> Start the home for them (what we already know)</label>
            {f.prefill ? <div className="mt-3"><HomeEditor home={f.home} set={h => setF({ ...f, home: h })} /></div> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className={lab}>Signed agreement (optional)</span>
              <input ref={agree} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" className="hidden" onChange={e => setAgreeFile(e.target.files?.[0] || null)} />
              <button type="button" onClick={() => agree.current?.click()} className="mt-1 w-full inline-flex items-center gap-2 rounded-xl border border-dashed border-line bg-white px-3 py-2.5 text-[13px] text-ink hover:border-ink/40"><FileUp size={14} /> {agreeFile ? agreeFile.name : 'Upload the signed management agreement'}</button>
              <p className="text-[11.5px] text-muted mt-1">It goes to accounting with the owner’s details when the paperwork is in.</p>
            </div>
            <label className="block"><span className={lab}>Team notes (never shown to the owner)</span><textarea rows={3} value={f.teamNotes} onChange={e => setF({ ...f, teamNotes: e.target.value })} className={field} /></label>
          </div>
          {msg ? <p className="text-[13px] text-red-700">{msg}</p> : null}
          <div className="flex gap-2"><button type="submit" disabled={busy} className="rounded-xl bg-ink text-white px-4 py-2.5 text-[13.5px] font-semibold disabled:opacity-50">{busy ? 'Creating…' : 'Create the link and email'}</button><button type="button" onClick={() => setCreating(false)} className="rounded-xl border border-line px-4 py-2.5 text-[13.5px] font-semibold text-ink">Cancel</button></div>
        </form>
      ) : null}

      <section className="rounded-2xl border border-line bg-white">
        <div className="flex flex-wrap items-center gap-2 p-4 border-b border-line">
          <h2 className="font-serif text-[24px] leading-none text-ink mr-auto">Owners <span className="text-muted text-[15px]">{shown.length}</span></h2>
          <label className="inline-flex items-center gap-1.5 text-[12.5px] text-muted"><input type="checkbox" checked={showArch} onChange={e => setShowArch(e.target.checked)} /> Archived</label>
          <label className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 w-full sm:w-64"><Search size={14} className="text-muted" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Find an owner or property" className="w-full min-w-0 text-[13px] bg-transparent outline-none" /></label>
        </div>
        {links && inScope.length ? (
          <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 border-b border-line">
            <span className={lab + ' mr-1'}>Waiting on</span>
            {TRACK_FILTERS.map(x => { const n = inScope.filter(l => l.track && x.hit(l.track)).length; return <button key={x.key} type="button" onClick={() => setFlt(flt === x.key ? '' : x.key)} className={'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] ' + (flt === x.key ? 'bg-ink text-white border-ink font-semibold' : n ? 'bg-white text-ink border-line' : 'bg-white text-muted/60 border-line')}>{x.label}<span className="tabular-nums font-semibold">{n}</span></button> })}
            {flt ? <button type="button" onClick={() => setFlt('')} className="text-[12.5px] font-semibold text-muted underline ml-1">Show all</button> : null}
          </div>
        ) : null}
        {!links ? <p className="py-10 text-center text-muted"><Loader2 size={15} className="inline animate-spin" /></p> : !shown.length ? <p className="p-5 text-[13px] text-muted">{flt ? 'Nobody is waiting on that.' : 'No owner links yet. Make the first with “New owner link”.'}</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-[13px]">
            <thead><tr className="text-left text-[10.5px] uppercase tracking-[0.14em] text-muted border-b border-line"><th className="py-2.5 pl-4 pr-3 font-semibold">Owner</th><th className="pr-3 font-semibold">Property · unit</th><th className="pr-3 font-semibold">Where it stands</th>{TRACK_COLS.map(c => <th key={c} className="px-1.5 font-semibold text-center whitespace-nowrap">{c}</th>)}<th className="pr-4 pl-3 font-semibold text-right">Updated</th></tr></thead>
            <tbody>{shown.map(l => (
              <tr key={l.code} onClick={() => { window.location.href = '/owner-onboarding/' + l.code }} className="border-b border-line last:border-0 cursor-pointer hover:bg-app">
                <td className="py-2.5 pl-4 pr-3 font-semibold text-ink">{l.ownerName || '—'}{l.archived ? <span className="ml-1 text-[11px] text-muted">(archived)</span> : null}</td>
                <td className="pr-3 text-ink">{[l.property, l.unitLabel].filter(Boolean).join(' · ') || <span className="text-muted">—</span>}{(l.units || 0) > 1 ? <span className="ml-1 text-[11px] text-muted">{l.units} units</span> : null}{l.listingId ? <span className="ml-1 text-[10.5px] text-emerald-700 font-semibold">GUESTY</span> : null}{(() => { const ex = [l.agreement ? 'Agreement in' : '', l.linen === 'sent' ? 'Linen sent' : l.linen === 'approved' ? 'Linen approved' : '', l.walk === 'done' ? 'Walkthrough done' : l.walk === 'sent' ? 'Walkthrough sent' : l.walk === 'needed' ? 'Walkthrough needed' : '', l.need ? l.need + ' to order' : ''].filter(Boolean).join(' · '); return ex ? <span className="block text-[11.5px] text-muted mt-0.5">{ex}</span> : null })()}</td>
                <td className="pr-3"><span className="flex items-center gap-1" title={OO_STEPS.map((s, i) => s.label + ': ' + ({ d: 'done', g: 'in progress', t: 'to do' } as Any)[(l.steps || '')[i] || 't']).join('\n')}>{OO_STEPS.map((s, i) => { const c = (l.steps || '')[i] || 't'; return <i key={s.key} className={'inline-block w-4 h-1.5 rounded-full ' + (c === 'd' ? 'bg-emerald-600' : c === 'g' ? 'bg-[#8C6D3A]' : 'bg-line')} /> })}</span><span className="block text-[12px] text-ink mt-1">{l.stage}{l.callAt ? <span className="text-muted"> · call {new Date(l.callAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span> : null}</span></td>
                {l.track ? trackChips(l.track).map(c => <td key={c.key} title={c.tip} className="px-1.5 text-center">{<TrackMark c={c} />}</td>) : TRACK_COLS.map(c => <td key={c} />)}
                <td className="pr-4 pl-3 text-right text-[12px] text-muted whitespace-nowrap">{new Date(l.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <HandoffSettings />
    </div>
  )
}

function HandoffSettings() {
  const [s, setS] = useState<Any>(null)
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { if (open && !s) fetch('/api/owner-onboarding/settings').then(r => r.json()).then(d => d?.ok && setS({ to: d.settings.to.join(', '), cc: d.settings.cc.join(', '), replyTo: d.settings.replyTo, vendorTo: (d.settings.vendorTo || []).join(', '), vendorCc: (d.settings.vendorCc || []).join(', '), teamCc: (d.settings.teamCc || []).join(', '), walkTo: (d.settings.walkTo || []).join(', ') })).catch(() => {}) }, [open, s])
  return (
    <section className="mt-6 rounded-2xl border border-line bg-white">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full text-left px-4 py-3 text-[13.5px] font-semibold text-ink">Handoff and vendor emails {open ? '▾' : '▸'} <span className="font-normal text-muted text-[12.5px]">· who gets the paperwork handoff and the linen quote</span></button>
      {open && s ? (
        <div className="px-4 pb-4 grid gap-3 sm:grid-cols-3">
          <label className="block"><span className={lab}>To</span><input value={s.to} onChange={e => setS({ ...s, to: e.target.value })} className={field} /></label>
          <label className="block"><span className={lab}>Copy</span><input value={s.cc} onChange={e => setS({ ...s, cc: e.target.value })} className={field} /></label>
          <label className="block"><span className={lab}>Sent from (a connected Google mailbox)</span><input value={s.replyTo} onChange={e => setS({ ...s, replyTo: e.target.value })} className={field} /></label>
          <label className="block sm:col-span-3"><span className={lab}>Copied on every onboarding email</span><input value={s.teamCc} onChange={e => setS({ ...s, teamCc: e.target.value })} className={field} /><span className="block text-[11.5px] text-muted mt-1">Copied on the owner’s invite and order-list emails, the handoff and the linen quote. The owner’s one-time sign-in link goes in a separate email to the owner alone.</span></label>
          <label className="block sm:col-span-3"><span className={lab}>Who walks a new unit (the walkthrough request goes to)</span><input value={s.walkTo} onChange={e => setS({ ...s, walkTo: e.target.value })} className={field} /></label>
          <label className="block sm:col-span-2"><span className={lab}>Linen vendor (the quote goes to)</span><input value={s.vendorTo} onChange={e => setS({ ...s, vendorTo: e.target.value })} placeholder="orders@vendor.com" className={field} /></label>
          <label className="block"><span className={lab}>Linen quote: copy</span><input value={s.vendorCc} onChange={e => setS({ ...s, vendorCc: e.target.value })} className={field} /></label>
          <div className="sm:col-span-3 flex items-center gap-3"><button type="button" onClick={async () => { const d = await fetch('/api/owner-onboarding/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) }).then(r => r.json()).catch(() => null); setMsg(d?.ok ? 'Saved.' : 'Could not save (full access needed).') }} className="rounded-xl bg-ink text-white px-4 py-2 text-[13px] font-semibold">Save</button><span className="text-[12.5px] text-muted">{msg}</span></div>
        </div>
      ) : null}
    </section>
  )
}

// ── one owner: the report ──
export function OwnerOnboardingReport({ code }: { code: string }) {
  const [rec, setRec] = useState<Any>(null)
  const [items, setItems] = useState<OOItem[]>([])
  const [linEdit, setLinEdit] = useState<Any>(null)
  const [canDelete, setCanDelete] = useState(false); const [delAsk, setDelAsk] = useState(false)
  async function remove() { setBusy('del'); const d = await fetch('/api/owner-onboarding/' + code, { method: 'DELETE' }).then(r => r.json()).catch(() => null); if (d?.ok) { window.location.href = '/owner-onboarding'; return } setBusy(''); setMsg(d?.message || d?.error || 'Not deleted.') }
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [editHome, setEditHome] = useState(false)
  const [markEdit, setMarkEdit] = useState(false)
  const [supTab, setSupTab] = useState<'answers' | 'review'>('answers')
  // the team ticking supplies for the owner: shown at once, saved behind
  async function mark(m: Record<string, string>) {
    setRec((r: Any) => (r ? { ...r, marks: { ...r.marks, ...m } } : r))
    const d = await fetch('/api/owner-onboarding/' + code, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marks: m }) }).then(r => r.json()).catch(() => null)
    if (!d?.ok) { setMsg(d?.error || 'Not saved. Check your connection.'); load() }
  }
  const [eu, setEu] = useState(0)
  async function linen(action: string, extra: Any = {}) { setBusy('linen'); const d = await fetch(`/api/owner-onboarding/${code}/linen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) }).then(r => r.json()).catch(() => null); if (d?.record) setRec(d.record); if (Array.isArray(d?.items)) setItems(d.items); if (d?.ok && (action === 'save' || action === 'reset')) setLinEdit(null); setMsg(d?.ok ? (action === 'send' ? 'Sent to the vendor.' : 'Saved.') : (d?.error || 'Not saved.')); setBusy('') }
  const agree = useRef<HTMLInputElement>(null)
  const apply = (d: Any) => { setRec(d.record); setItems(d.items || []); setCanDelete(!!d.canDelete) }
  const load = () => fetch('/api/owner-onboarding/' + code, { cache: 'no-store' }).then(r => r.json()).then(d => (d?.ok ? apply(d) : setErr(d?.error || 'Not found.'))).catch(() => setErr('Could not load.'))
  useEffect(() => { load() }, [code])
  async function patch(body: Any, note = 'Saved.') {
    setMsg('Saving…')
    const d = await fetch('/api/owner-onboarding/' + code, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).catch(() => null)
    if (d?.ok) { apply(d); setMsg(note) } else setMsg(d?.error || 'Not saved.')
  }
  const groups = useMemo(() => Array.from(new Set(items.map(i => i.group))), [items])
  if (err) return <p className="p-8 text-muted">{err}</p>
  if (!rec) return <p className="p-8 text-center text-muted"><Loader2 size={16} className="inline animate-spin" /></p>
  const h: OOHome | null = rec.home
  const units: OOHome[] = h ? [h, ...(rec.more || [])] : []
  const uLabel = (i: number) => (units[i]?.unit ? 'Unit ' + units[i].unit : 'Unit ' + (i + 1))
  const sup = items.filter(i => !i.linen), lin = items.filter(i => i.linen)
  const need = sup.filter(i => rec.marks[i.key] === 'need'), have = sup.filter(i => rec.marks[i.key] === 'have'), open = sup.filter(i => !rec.marks[i.key])
  // one line per item across the units: the total, and what each unit needs
  const roll = (list: OOItem[]) => { const m = new Map<string, { name: string; size?: string; total: number; per: Record<number, number> }>(); for (const i of list) { const k = i.name + '|' + (i.size || ''); const e = m.get(k) || { name: i.name, size: i.size, total: 0, per: {} }; e.total += i.qty; e.per[i.unit] = (e.per[i.unit] || 0) + i.qty; m.set(k, e) } return Array.from(m.values()) }
  const needRoll = roll(need), linRoll = roll(lin)
  const saveUnits = (list: OOHome[]) => patch({ home: list[0], more: list.slice(1) })
  const photosDone = rec.steps.find((s: Any) => s.key === 'photos')?.status === 'done'
  const setStep = (k: string, status: OOStepStatus) => patch({ steps: rec.steps.map((s: Any) => (s.key === k ? { ...s, status, date: status === 'done' ? (s.date || new Date().toISOString().slice(0, 10)) : s.date } : s)) })

  return (
    <div className="max-w-[1200px] mx-auto oo-report">
      <style>{`@media print{.oo-noprint{display:none!important}.oo-report{max-width:none}}`}</style>
      <a href="/owner-onboarding" className="oo-noprint inline-flex items-center gap-1 text-[13px] font-semibold text-ink mb-4">← All owners</a>
      <header className="flex flex-wrap items-end gap-3 pb-5 mb-6 border-b border-line">
        <div className="mr-auto min-w-0">
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted font-semibold">Owner onboarding · {stepLabel(rec.steps.find((s: Any) => s.status !== 'done')?.key || 'live')}</p>
          <h1 className="font-serif text-[40px] leading-none text-ink mt-1">{rec.custom.ownerName || 'Owner'}</h1>
          <p className="text-[13.5px] text-muted mt-2">{[rec.attach.property, rec.attach.unitLabel ? 'Unit ' + rec.attach.unitLabel : ''].filter(Boolean).join(' · ')}{rec.custom.ownerEmail ? <> · <a href={'mailto:' + rec.custom.ownerEmail} className="underline underline-offset-2 hover:text-ink">{rec.custom.ownerEmail}</a></> : null}{rec.custom.ownerPhone ? <> · {telOf(rec.custom.ownerPhone) ? <a href={'tel:' + telOf(rec.custom.ownerPhone)} className="underline underline-offset-2 hover:text-ink whitespace-nowrap">{rec.custom.ownerPhone}</a> : rec.custom.ownerPhone}</> : null}</p>
        </div>
        <div className="oo-noprint flex flex-wrap gap-2">
          <CopyBtn text={ownerLink(code)} label="Copy owner link" />
          <CopyBtn text={origin() + '/owner-onboarding/' + code} label="Copy team link" />
          <a href={'/join/' + code} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-[13px] font-semibold text-ink"><ExternalLink size={13} /> Owner view</a>
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-[13px] font-semibold text-ink"><Printer size={13} /> Print</button>
        </div>
      </header>
      {msg ? <p className="oo-noprint text-[12.5px] text-muted -mt-3 mb-3">{msg}</p> : null}
      <OwnerInfo rec={rec} onRec={setRec} />
      {rec.track ? (
        <section className={card + ' oo-noprint mb-6'}>
          <p className={lab + ' mb-2.5'}>Where the owner stands</p>
          <TrackRow t={rec.track} />
          {(rec.owners || []).length ? (
            <div className="mt-3 pt-3 border-t border-line grid gap-1 text-[12.5px] text-ink">
              {[{ name: rec.custom.ownerName, a: rec.ownerAccess }, ...(rec.owners || []).map((o: Any) => ({ name: o.name, a: o.access }))].map((o: Any, i: number) => (
                <p key={i}><b>{o.name || 'Owner ' + (i + 1)}</b><span className="text-muted">{' · '}{o.a?.invitedAt ? 'portal email ' + shortDay(o.a.invitedAt) : 'portal email not sent'}{' · '}{o.a?.lastSeenAt || o.a?.activatedAt ? 'last signed in ' + shortDay(o.a.lastSeenAt || o.a.activatedAt) : 'not signed in yet'}</span></p>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6 min-w-0">
          {/* the units */}
          <section className={card}>
            <div className="flex items-center gap-2 mb-3"><h2 className="font-serif text-[22px] leading-none text-ink mr-auto">{units.length > 1 ? units.length + ' units' : 'The home'}</h2>
              <button type="button" onClick={() => { const list = [...units, { ...DEFAULT_HOME, address: units[0]?.address || '' }]; setRec({ ...rec, home: list[0], more: list.slice(1) }); setEditHome(true); setEu(list.length - 1) }} className="oo-noprint text-[12.5px] font-semibold text-ink">+ Add a unit</button></div>
            {!units.length ? <div><p className="text-[13px] text-muted mb-2">The owner has not filled in the home yet. If you already know the details, fill them in for the owner: they will see them on their portal and can correct anything.</p><button type="button" onClick={() => { const list = [{ ...DEFAULT_HOME, unit: rec.attach?.unitLabel || '' }]; setRec({ ...rec, home: list[0], more: [] }); setEditHome(true); setEu(0) }} className="oo-noprint rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold">Fill in the home for the owner</button></div> : units.map((u, i) => (
              <div key={i} className={'py-3 ' + (i ? 'border-t border-line' : '')}>
                <div className="flex items-center gap-2 mb-2"><p className="text-[14px] font-semibold text-ink mr-auto">{uLabel(i)}</p>
                  <button type="button" onClick={() => { setEu(i); setEditHome(e => (eu === i ? !e : true)) }} className="oo-noprint text-[12.5px] font-semibold text-ink">{editHome && eu === i ? 'Close' : 'Edit'}</button>
                  {i > 0 ? <button type="button" onClick={() => saveUnits(units.filter((_, j) => j !== i))} className="oo-noprint text-[12.5px] text-muted hover:text-red-700">Remove</button> : null}</div>
                {editHome && eu === i ? <><HomeEditor home={u} set={nh => { const list = units.map((x, j) => (j === i ? nh : x)); setRec({ ...rec, home: list[0], more: list.slice(1) }) }} /><button type="button" onClick={() => { saveUnits(units); setEditHome(false) }} className="mt-3 rounded-xl bg-ink text-white px-4 py-2 text-[13px] font-semibold">Save</button></> : (
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-[13.5px]">
                    {([['Address', u.address], ['Size', u.sqft ? u.sqft.toLocaleString() + ' SF' : '—'], ['Bedrooms', u.bedrooms === 0 ? 'Studio' : String(u.bedrooms)], ['Bathrooms', String(u.bathrooms)], ['Sleeps', String(u.guests)], ['Beds', Object.entries(u.beds).filter(([, n]) => n).map(([k, n]) => n + ' ' + k).join(', ') + (u.sleeper ? ', sofa bed' : '') || '—'], ['Kitchen', u.kitchen ? OO_APPLIANCES.filter(a => u.appliances[a]).map(a => OO_APPLIANCE_LABEL[a]).join(', ') || 'Yes, no appliances ticked' : 'None'], ['Wi-Fi network', u.wifiName || '—'], ['Wi-Fi password', u.wifiPass || '—'], ['Washer and dryer', u.washer ? 'Yes' : 'No'], ['Parking', u.parking || '—'], ['Access', u.access || '—']] as [string, string][]).map(([k, v]) => <div key={k} className={k === 'Address' || k === 'Kitchen' || k === 'Access' || k === 'Beds' ? 'col-span-2' : ''}><dt className={lab}>{k}</dt><dd className="text-ink mt-0.5">{v || '—'}</dd></div>)}
                  </dl>
                )}
              </div>
            ))}
          </section>

          {/* the supplies: everything to buy, and what each unit needs */}
          <section className={card}>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-3"><h2 className="font-serif text-[22px] leading-none text-ink">Supplies</h2><div className="oo-noprint inline-flex rounded-full bg-app p-0.5 text-[12px] font-semibold mr-auto">{([['answers', 'Owner’s answers'], ['review', 'Inventory review']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setSupTab(k)} className={'rounded-full px-3 py-1 ' + (supTab === k ? 'bg-white text-ink shadow-sm' : 'text-muted')}>{l}{k === 'review' && !rec.walk?.doneAt && sup.length ? <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-500 align-middle" /> : null}</button>)}</div><span className="text-[13px]"><b className="text-ink">{have.length}</b> have · <b className="text-[#B4532A]">{need.length}</b> need · <b className="text-ink">{open.length}</b> not checked</span></div>
            {!sup.length ? <p className="text-[13px] text-muted">The list appears once the home is filled in.</p> : supTab === 'review' ? <InventoryReview rec={rec} sup={sup} units={units} uLabel={uLabel} onApply={apply} onMsg={setMsg} /> : (<>
              <div className="oo-noprint flex flex-wrap items-center gap-x-3 gap-y-1 mb-3 text-[12.5px]"><button type="button" onClick={() => setMarkEdit(m => !m)} className="rounded-xl border border-line px-3 py-1.5 font-semibold text-ink">{markEdit ? 'Done' : 'Fill in the supplies for the owner'}</button><span className="text-muted">{markEdit ? 'Tick Have or Need on each item, or a whole set at once. It saves as you go, and the owner sees it on their portal.' : 'If you already know what is in the home, tick it here so the owner does not have to.'}</span></div>
              {needRoll.length ? (
                <div className="rounded-xl bg-[#FBF1EC] p-3 mb-4"><p className={lab + ' text-[#B4532A]'}>To buy{units.length > 1 ? ' · all ' + units.length + ' units' : ''} · what the owner marked Need</p>
                  <div className="overflow-x-auto"><table className="w-full text-[13px] mt-2"><thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted"><th className="py-1 font-semibold">Item</th>{units.length > 1 ? units.map((_, i) => <th key={i} className="py-1 px-2 text-right font-semibold whitespace-nowrap">{uLabel(i)}</th>) : null}<th className="py-1 text-right font-semibold">Total</th></tr></thead>
                    <tbody>{needRoll.map(e => <tr key={e.name + e.size} className="border-t border-[#F0DCD2]"><td className="py-1 text-ink">{e.name}{e.size ? <span className="text-muted"> · {e.size}</span> : null}</td>{units.length > 1 ? units.map((_, i) => <td key={i} className="py-1 px-2 text-right tabular-nums">{e.per[i] || ''}</td>) : null}<td className="py-1 text-right tabular-nums font-semibold">{e.total}</td></tr>)}</tbody></table></div>
                </div>
              ) : null}
              {units.map((_, ui) => { const mine = sup.filter(i => i.unit === ui); const gs = Array.from(new Set(mine.map(i => i.group))); return (
                <details key={ui} className="mb-1" open={markEdit || undefined}><summary className="cursor-pointer text-[13px] font-semibold text-ink py-1">{units.length > 1 ? uLabel(ui) + ': the whole list' : 'The whole list, by set'} <span className="font-normal text-muted">· {mine.filter(i => rec.marks[i.key] === 'need').length} need, {mine.filter(i => !rec.marks[i.key]).length} not checked</span></summary>
                  <div className="mt-3 columns-1 md:columns-2 gap-6">{gs.map(g => (
                    <div key={g} className="break-inside-avoid mb-4"><p className={lab}>{g}{markEdit ? <span className="oo-noprint normal-case tracking-normal font-normal"> · all: <button type="button" className="underline" onClick={() => mark(Object.fromEntries(mine.filter(i => i.group === g).map(i => [i.key, 'have'])))}>have</button> / <button type="button" className="underline" onClick={() => mark(Object.fromEntries(mine.filter(i => i.group === g).map(i => [i.key, 'need'])))}>need</button></span> : null}</p><ul className="text-[12.5px]">{mine.filter(i => i.group === g).map(i => <li key={i.key} className="flex justify-between gap-2 py-1 border-b border-line"><span className="text-ink">{i.name} <span className="text-muted">×{i.qty}</span></span>{markEdit ? <span className="oo-noprint inline-flex shrink-0 rounded-full border border-line overflow-hidden text-[11.5px] font-semibold">{(['have', 'need'] as const).map(v => <button key={v} type="button" onClick={() => mark({ [i.key]: rec.marks[i.key] === v ? '' : v })} className={'px-2 py-0.5 ' + (rec.marks[i.key] === v ? '' : 'text-muted')} style={rec.marks[i.key] === v ? { background: v === 'have' ? '#047857' : '#B4532A', color: '#fff' } : undefined}>{v === 'have' ? 'Have' : 'Need'}</button>)}</span>
                      : <span className={rec.marks[i.key] === 'have' ? 'text-emerald-700 font-semibold' : rec.marks[i.key] === 'need' ? 'text-[#B4532A] font-semibold' : 'text-muted'}>{rec.marks[i.key] === 'have' ? 'Have' : rec.marks[i.key] === 'need' ? 'Need' : '—'}</span>}</li>)}</ul></div>
                  ))}</div>
                </details>) })}
            </>)}
            {rec.ownerNotes ? <div className="mt-4 rounded-xl bg-app p-3"><p className={lab}>The owner’s note</p><p className="text-[13.5px] text-ink mt-1 whitespace-pre-wrap">{rec.ownerNotes}</p></div> : null}
          </section>

          <div id="oo-order"><OrderList rec={rec} units={units.map((_, i) => uLabel(i))} onRec={setRec} /></div>

          {/* THE LINEN, ours to specify (Jon, 2026-11-13): counts at par, per unit and in all; approve, then send to the vendor */}
          <section className={card}>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-1"><h2 className="font-serif text-[22px] leading-none text-ink mr-auto">Linen at par</h2><span className="text-[13px]"><b className="text-ink">{lin.reduce((a, i) => a + i.qty, 0)}</b> pieces{units.length > 1 ? ' across ' + units.length + ' units' : ''}</span></div>
            <p className="text-[12.5px] text-muted mb-3">For the team only: the owner’s page never lists linen. {rec.linen?.rows ? <b className="text-ink">Edited by {String(rec.linen.editedBy || 'the team').split('@')[0]}{rec.linen.editedAt ? ' on ' + new Date(rec.linen.editedAt).toLocaleDateString() : ''}; it no longer follows the home’s beds and baths.</b> : 'Counted by the linen calculator from the saved linen standard and each unit’s beds and baths. Adjust it here before you email or download it.'}</p>
            {linEdit ? (<div className="oo-noprint">
              <div className="overflow-x-auto"><table className="w-full text-[13px]"><thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted border-b border-line"><th className="py-1.5 font-semibold">Item</th><th className="font-semibold">Size</th>{units.map((_, i) => <th key={i} className="px-1 text-right font-semibold whitespace-nowrap">{units.length > 1 ? uLabel(i) : 'Qty'}</th>)}<th /></tr></thead>
                <tbody>{linEdit.rows.map((l: Any, k: number) => { const set = (p: Any) => setLinEdit({ ...linEdit, rows: linEdit.rows.map((x: Any, j: number) => (j === k ? { ...x, ...p } : x)) }); return (
                  <tr key={k} className="border-b border-line"><td className="py-1 pr-1"><input value={l.name} onChange={e => set({ name: e.target.value })} placeholder="Item" className="w-full rounded-lg border border-line px-2 py-1 text-[12.5px] text-ink" /></td>
                    <td className="pr-1"><input value={l.size} onChange={e => set({ size: e.target.value })} placeholder="Size" className="w-24 rounded-lg border border-line px-2 py-1 text-[12.5px] text-ink" /></td>
                    {units.map((_, i) => <td key={i} className="px-1 text-right"><input inputMode="numeric" value={String(l.qty[i] ?? 0)} onChange={e => set({ qty: units.map((__, u) => (u === i ? Number(e.target.value.replace(/\D/g, '')) || 0 : l.qty[u] || 0)) })} className="w-14 rounded-lg border border-line px-2 py-1 text-[12.5px] text-ink text-right" /></td>)}
                    <td className="pl-1"><button type="button" title="Remove" onClick={() => setLinEdit({ ...linEdit, rows: linEdit.rows.filter((_: Any, j: number) => j !== k) })} className="text-muted hover:text-red-700">×</button></td></tr>) })}</tbody></table></div>
              <button type="button" onClick={() => setLinEdit({ ...linEdit, rows: [...linEdit.rows, { name: '', size: '', qty: units.map(() => 1) }] })} className="mt-2 text-[12.5px] font-semibold text-ink">+ Add a line</button>
              <label className="block mt-3"><span className={lab}>Note to the vendor (goes in the quote request)</span><textarea rows={2} value={linEdit.note} onChange={e => setLinEdit({ ...linEdit, note: e.target.value })} className={field} placeholder="e.g. white only, 300 thread count; deliver to the front desk" /></label>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <button type="button" disabled={busy === 'linen'} onClick={() => linen('save', linEdit)} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold disabled:opacity-50">{busy === 'linen' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save the quote</button>
                <button type="button" onClick={() => setLinEdit(null)} className="text-[12.5px] text-muted underline">Cancel</button>
                {rec.linen?.approvedAt ? <span className="text-[12.5px] text-muted">Saving clears the approval, so the edited quote is approved again before it is sent.</span> : null}
              </div>
            </div>) : !lin.length ? <p className="text-[13px] text-muted">The counts appear once the home is filled in.</p> : (<>
              <div className="overflow-x-auto"><table className="w-full text-[13px]"><thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted border-b border-line"><th className="py-1.5 font-semibold">Item</th><th className="font-semibold">Size</th>{units.length > 1 ? units.map((_, i) => <th key={i} className="px-2 text-right font-semibold whitespace-nowrap">{uLabel(i)}</th>) : null}<th className="text-right font-semibold">Total</th></tr></thead>
                <tbody>{linRoll.map(e => <tr key={e.name + e.size} className="border-b border-line"><td className="py-1.5 text-ink">{e.name}</td><td className="text-muted">{e.size || ''}</td>{units.length > 1 ? units.map((_, i) => <td key={i} className="px-2 text-right tabular-nums">{e.per[i] || ''}</td>) : null}<td className="text-right tabular-nums font-semibold">{e.total}</td></tr>)}</tbody></table></div>
              {/* ON HAND (Jon, 2026-11-17: "mark what's on hand and it should adjust the order"). Counted on the walkthrough
                  sheet's Linen section or typed here; the quote and the vendor email ask only for what is short. */}
              {(() => { const ll = linenLines(rec, items); const counted = ll.filter(e => e.have != null).length; const order = ll.reduce((a, e) => a + e.order, 0), par = ll.reduce((a, e) => a + e.par, 0)
                const setHave = (key: string, v: string) => patch({ walkCounts: { [key]: v === '' ? null : Number(v) } }, 'On-hand count saved.')
                return (
                  <details className="mt-3 rounded-xl bg-app p-3" open={counted > 0}>
                    <summary className="cursor-pointer text-[13px] font-semibold text-ink">Linen on hand · {counted ? <>{order} to order of {par} at par</> : 'not counted yet'}</summary>
                    <p className="text-[12.5px] text-muted mt-1 mb-2">What is already in the unit and good enough to keep. It is counted on the walkthrough sheet’s Linen section, or type it here. The quote, the PDF and the vendor email then ask only for what is short. Leave a box empty if it has not been counted.</p>
                    <div className="overflow-x-auto"><table className="w-full text-[13px]"><thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted border-b border-line"><th className="py-1.5 font-semibold">Item</th>{units.length > 1 ? <th className="font-semibold">Unit</th> : null}<th className="text-right font-semibold">Par</th><th className="text-right font-semibold">On hand</th><th className="text-right font-semibold">To order</th></tr></thead>
                      <tbody>{ll.map(e => <tr key={e.key} className="border-b border-line"><td className="py-1 text-ink">{e.name}{e.size ? <span className="text-muted"> · {e.size}</span> : null}</td>{units.length > 1 ? <td className="text-muted whitespace-nowrap">{e.unitLabel}</td> : null}<td className="text-right tabular-nums">{e.par}</td>
                        <td className="text-right"><input key={e.key + ':' + (e.have ?? '')} inputMode="numeric" defaultValue={e.have ?? ''} placeholder="?" aria-label={'On hand: ' + e.name + ' ' + e.size} onBlur={ev => { const v = ev.target.value.replace(/\D/g, ''); if (v !== String(e.have ?? '')) setHave(e.key, v) }} className="w-14 rounded-lg border border-line bg-white px-2 py-1 text-[12.5px] text-ink text-right" /></td>
                        <td className={'text-right tabular-nums font-semibold ' + (e.have != null && e.order === 0 ? 'text-emerald-700' : 'text-ink')}>{e.have != null && e.order === 0 ? 'none' : e.order}</td></tr>)}</tbody>
                      <tfoot><tr><td className="pt-2 font-semibold text-ink" colSpan={units.length > 1 ? 2 : 1}>Total</td><td className="pt-2 text-right tabular-nums">{par}</td><td /><td className="pt-2 text-right tabular-nums font-semibold">{order}</td></tr></tfoot></table></div>
                  </details>) })()}
              <div className="oo-noprint mt-3 flex flex-wrap items-center gap-2">
                {!rec.linen?.approvedAt ? <button type="button" onClick={() => linen('approve')} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold"><Check size={13} /> Approve the linen quote</button>
                  : <><span className="text-[12.5px] text-emerald-700 font-semibold"><Check size={13} className="inline" /> Approved {new Date(rec.linen.approvedAt).toLocaleDateString()} by {String(rec.linen.approvedBy || '').split('@')[0]}</span>
                    <button type="button" disabled={busy === 'linen'} onClick={() => linen('send')} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold disabled:opacity-50">{busy === 'linen' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {rec.linen.sentAt ? 'Send to the vendor again' : 'Send to the vendor'}</button>
                    <button type="button" onClick={() => linen('unapprove')} className="text-[12.5px] text-muted underline">Undo approval</button></>}
                <a href={`/api/owner-onboarding/${code}/linen`} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[13px] font-semibold text-ink"><Download size={13} /> Download the quote (PDF)</a>
                <button type="button" onClick={() => setLinEdit({ rows: linRoll.map(e => ({ name: e.name, size: e.size || '', qty: units.map((_, i) => e.per[i] || 0) })), note: rec.linen?.note || '' })} className="rounded-xl border border-line px-3 py-2 text-[13px] font-semibold text-ink">Edit the quote</button>
                {rec.linen?.rows ? <button type="button" onClick={() => linen('reset')} className="text-[12.5px] text-muted underline">Back to the linen standard</button> : null}
                {rec.linen?.note ? <span className="text-[12.5px] text-ink basis-full">Note to the vendor: {rec.linen.note}</span> : null}
                <span className="text-[12.5px] text-muted basis-full">{rec.linen?.error ? 'Not sent: ' + rec.linen.error : rec.linen?.sentAt ? 'Sent ' + new Date(rec.linen.sentAt).toLocaleString() + ' to ' + (rec.linen.sentTo || []).join(', ') : 'Approving unlocks “Send to the vendor”: the quantities go to the linen vendor, copying the team.'}</span>
              </div>
            </>)}
          </section>

          {/* paperwork */}
          <section className={card}>
            <h2 className="font-serif text-[22px] leading-none text-ink mb-3">Paperwork</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-line p-3">
                <p className={lab}>W-9 and ACH <Lock size={11} className="inline" /></p>
                {rec.payout ? (<>
                  <p className="text-[13px] text-ink mt-1">{rec.payout.w9.business || rec.payout.w9.name} · {rec.payout.w9.tinType === 'ein' ? 'EIN' : 'SSN'} {rec.payout.w9.tinHint}</p>
                  <p className="text-[13px] text-ink">{rec.payout.ach.bank} {rec.payout.ach.ownership || ''} {rec.payout.ach.accountType} {rec.payout.ach.accountHint}</p>
                  <p className="text-[11.5px] text-muted">Signed by {rec.payout.sign.name}, {new Date(rec.payout.sign.at).toLocaleDateString()}</p>
                  <div className="oo-noprint flex flex-wrap gap-2 mt-2"><a href={`/api/owner-onboarding/${code}/forms?doc=w9`} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3 py-1.5 text-[12.5px] font-semibold"><Download size={12} /> W-9</a><a href={`/api/owner-onboarding/${code}/forms?doc=ach`} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3 py-1.5 text-[12.5px] font-semibold"><Download size={12} /> ACH form</a></div>
                  <p className="text-[11px] text-muted mt-1">Filled on download, for full access only. Never emailed.</p>
                  {rec.payoutLog?.length ? <details className="mt-2 text-[11.5px] text-muted"><summary className="cursor-pointer font-semibold text-ink">Download log ({rec.payoutLog.length})</summary><ul className="mt-1 space-y-0.5">{rec.payoutLog.slice(0, 30).map((l: Any, i: number) => <li key={i}>{l.doc === 'ach' ? 'ACH form' : 'W-9'} · {String(l.by).startsWith('owner') ? (String(l.by).slice(7) || 'the owner') : String(l.by).split('@')[0]} · {new Date(l.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</li>)}</ul></details> : <p className="text-[11px] text-muted">No downloads yet. Each one is logged.</p>}
                </>) : <p className="text-[13px] text-muted mt-1">{rec.custom.askPayout === false ? 'Not asked on this link.' : 'Not sent yet.'}</p>}
              </div>
              <div className="rounded-xl border border-line p-3">
                <p className={lab}>Management agreement</p>
                {rec.agreement ? <><p className="text-[13px] text-ink mt-1 truncate">{rec.agreement.name}</p><p className="text-[11.5px] text-muted">Uploaded {new Date(rec.agreement.at).toLocaleDateString()} by {String(rec.agreement.by).split('@')[0]}</p>
                  <button type="button" onClick={async () => { const d = await fetch(`/api/owner-onboarding/${code}/agreement`).then(r => r.json()); if (d?.url) window.open(d.url, '_blank', 'noopener') }} className="oo-noprint mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink"><ExternalLink size={12} /> Open</button></> : <p className="text-[13px] text-muted mt-1">Not uploaded.</p>}
                <input ref={agree} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" className="hidden" onChange={async e => { const fl = e.target.files?.[0]; e.target.value = ''; if (!fl) return; setBusy('agree'); try { await uploadAgreement(code, fl); await load(); setMsg('Agreement uploaded.') } catch (er: Any) { setMsg(er.message) } finally { setBusy('') } }} />
                <button type="button" onClick={() => agree.current?.click()} className="oo-noprint mt-2 ml-2 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink">{busy === 'agree' ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />} {rec.agreement ? 'Replace' : 'Upload'}</button>
              </div>
            </div>
            <div className="mt-4 rounded-xl bg-app p-3 flex flex-wrap items-center gap-3">
              <div className="mr-auto min-w-0"><p className={lab}>Handoff to accounting</p>
                <p className="text-[13px] text-ink mt-0.5">{rec.handoff ? (rec.handoff.error ? 'Not sent: ' + rec.handoff.error : 'Sent ' + new Date(rec.handoff.at).toLocaleString() + ' to ' + rec.handoff.to.join(', ') + (rec.handoff.cc?.length ? ', copying ' + rec.handoff.cc.join(', ') : '')) : 'Sends on its own when the owner’s W-9 and bank details are in: the owner, unit and contact details, the agreement attached, and a request to set up Guesty.'}</p></div>
              <button type="button" disabled={busy === 'send'} onClick={async () => { setBusy('send'); const d = await fetch(`/api/owner-onboarding/${code}/handoff`, { method: 'POST' }).then(r => r.json()).catch(() => null); if (d?.record) setRec(d.record); setMsg(d?.ok ? 'Sent to accounting.' : 'Not sent: ' + (d?.error || 'try again')); setBusy('') }} className="oo-noprint inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[12.5px] font-semibold disabled:opacity-50"><Send size={12} /> {rec.handoff ? 'Send again' : 'Send now'}</button>
            </div>
          </section>

          <div className="oo-noprint space-y-6"><InviteOwner rec={rec} onRec={setRec} /><IntroEmail rec={rec} onRec={setRec} /></div>
        </div>

        <div className="space-y-6 min-w-0">
          {/* the timeline */}
          <section className={card}>
            <h2 className="font-serif text-[22px] leading-none text-ink mb-3">Timeline</h2>
            <ol className="space-y-2">{OO_STEPS.map(s => { const st = rec.steps.find((x: Any) => x.key === s.key) || { status: 'todo' }; return (
              <li key={s.key} className="flex items-start gap-3">
                <span className={'mt-0.5 w-5 h-5 rounded-full grid place-items-center shrink-0 ' + (st.status === 'done' ? 'bg-emerald-600 text-white' : st.status === 'doing' ? 'bg-[#8C6D3A] text-white' : 'border-2 border-line')}>{st.status === 'done' ? <Check size={11} /> : null}</span>
                <div className="min-w-0 flex-1"><p className="text-[13.5px] font-semibold text-ink">{s.label}</p><p className="text-[12px] text-muted">{s.team}{st.date ? ' · ' + st.date : ''}</p></div>
                <select value={st.status} onChange={e => setStep(s.key, e.target.value as OOStepStatus)} className="oo-noprint rounded-lg border border-line px-2 py-1 text-[12px]"><option value="todo">To do</option><option value="doing">In progress</option><option value="done">Done</option></select>
              </li>) })}</ol>
          </section>

          {/* the onboarding call */}
          <section className={card}>
            <h2 className="font-serif text-[22px] leading-none text-ink mb-1">Onboarding call</h2>
            <p className="text-[12.5px] text-muted mb-3">{photosDone ? 'Photos are done: schedule the call to walk the owner through the listing and the pricing strategy.' : 'Schedule it once the listing photos are done. The owner sees it on their timeline.'}</p>
            <CallForm code={code} call={rec.call} ownerEmail={rec.custom.ownerEmail} onRec={setRec} onSave={c => patch({ call: c }, 'Call saved. The owner sees it on their timeline.')} />
          </section>

          {/* attach + who */}
          <section className={card}>
            <h2 className="font-serif text-[22px] leading-none text-ink mb-3">Property and unit</h2>
            <UnitPicker property={rec.attach.property} listingId={rec.attach.listingId} unitLabel={rec.attach.unitLabel} onPick={p => setRec({ ...rec, attach: p })} />
            <button type="button" onClick={() => patch({ attach: rec.attach }, 'Attached.')} className="oo-noprint mt-3 rounded-xl bg-ink text-white px-4 py-2 text-[13px] font-semibold">Save</button>
          </section>

          <section className={card}>
            <h2 className="font-serif text-[22px] leading-none text-ink mb-2">Team notes</h2>
            <textarea rows={4} defaultValue={rec.teamNotes} onBlur={e => e.target.value !== rec.teamNotes && patch({ teamNotes: e.target.value })} className={field} placeholder="Never shown to the owner" />
          </section>

          <button type="button" onClick={() => patch({ archived: !rec.archived }, rec.archived ? 'Restored.' : 'Archived: the owner link no longer opens.')} className="oo-noprint inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted hover:text-ink"><Archive size={13} /> {rec.archived ? 'Restore this link' : 'Archive this link'}</button>
          {canDelete ? (delAsk ? <div className="oo-noprint rounded-xl border border-red-200 bg-red-50 p-3 text-[12.5px] text-ink"><p><b>Delete this onboarding for good?</b> The owner’s answers, the W-9 and ACH details, the agreement, the order list and the linen quote are removed, and the owner’s link stops working. This cannot be undone.</p><div className="flex items-center gap-3 mt-2"><button type="button" disabled={busy === 'del'} onClick={remove} className="rounded-lg bg-red-700 text-white px-3 py-1.5 font-semibold disabled:opacity-50">{busy === 'del' ? 'Deleting…' : 'Yes, delete it'}</button><button type="button" onClick={() => setDelAsk(false)} className="underline text-muted">Keep it</button></div></div>
            : <button type="button" onClick={() => setDelAsk(true)} className="oo-noprint inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-red-700">Delete this onboarding</button>) : null}
        </div>
      </div>
    </div>
  )
}

function CallForm({ code, call, ownerEmail, onSave, onRec }: { code: string; call: Any; ownerEmail: string; onSave: (c: Any) => void; onRec: (r: Any) => void }) {
  const [day, setDay] = useState(call?.at ? String(call.at).slice(0, 10) : '')
  const [time, setTime] = useState(call?.at ? String(call.at).slice(11, 16) : '10:00')
  const [minutes, setMinutes] = useState(call?.minutes || 30)
  const [note, setNote] = useState(call?.note || '')
  const [link, setLink] = useState(call?.link || '')
  const [cal, setCal] = useState<Any>(null)
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('')
  // MY CALENDAR THAT DAY (Jon, 2026-11-13: "attach my calendar"): the signed-in teammate's busy times
  useEffect(() => { if (!day) { setCal(null); return } let on = true; fetch(`/api/owner-onboarding/${code}/call?day=` + day).then(r => r.json()).then(d => on && setCal(d)).catch(() => {}); return () => { on = false } }, [day, code])
  async function meet() {
    setBusy(true); setMsg('')
    const d = await fetch(`/api/owner-onboarding/${code}/call`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, time, minutes, agenda: note }) }).then(r => r.json()).catch(() => null)
    setBusy(false)
    if (d?.ok) { onRec(d.record); setLink(d.record.call.link || ''); setMsg('On your calendar with a Google Meet link' + (ownerEmail ? '; the owner is invited.' : '.')) } else setMsg(d?.error || 'Could not create the meeting.')
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <label className="block col-span-3 sm:col-span-1"><span className={lab}>Date</span><input type="date" value={day} onChange={e => setDay(e.target.value)} className={field} /></label>
        <label className="block"><span className={lab}>Time (ET)</span><input type="time" step={900} value={time} onChange={e => setTime(e.target.value)} className={field} /></label>
        <label className="block"><span className={lab}>Length</span><select value={minutes} onChange={e => setMinutes(Number(e.target.value))} className={field}><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option></select></label>
      </div>
      {day && cal ? <p className="text-[12.5px] text-muted rounded-xl bg-app px-3 py-2">{cal.ok ? (cal.busy.length ? <>Your calendar that day is busy: <b className="text-ink">{cal.busy.map((b: Any) => b.from + '–' + b.to).join(', ')}</b></> : 'Your calendar is open that day.') : <>Calendar not connected: {String(cal.error || '').startsWith('Connect Google') ? <a className="underline font-semibold text-ink" href={'/api/google/auth?mailbox=' + encodeURIComponent(cal.host || '')}>connect Google Calendar</a> : cal.error}</>}</p> : null}
      <label className="block"><span className={lab}>Agenda (optional)</span><input value={note} onChange={e => setNote(e.target.value)} placeholder="Listing walkthrough · pricing strategy · calendar" className={field} /></label>
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" disabled={!day || !time || busy} onClick={meet} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-4 py-2 text-[13px] font-semibold disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : null} {call?.eventId ? 'Move the meeting' : 'Create the Google Meet and invite'}</button>
        {call?.eventUrl ? <a href={call.eventUrl} target="_blank" rel="noreferrer" className="text-[12.5px] font-semibold text-ink underline">Open in Calendar</a> : null}
      </div>
      {msg ? <p className="text-[12.5px] text-ink">{msg}</p> : null}
      <details><summary className="cursor-pointer text-[12px] text-muted">Or set it by hand (no calendar event)</summary>
        <label className="block mt-2"><span className={lab}>Meeting link</span><input value={link} onChange={e => setLink(e.target.value)} placeholder="https://meet.google.com/…" className={field} /></label>
        <button type="button" disabled={!day} onClick={() => onSave({ at: day + 'T' + time, link, note, minutes })} className="mt-2 rounded-xl border border-line px-4 py-2 text-[13px] font-semibold text-ink disabled:opacity-50">Save without a calendar event</button>
      </details>
    </div>
  )
}
