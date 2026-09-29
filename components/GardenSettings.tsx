'use client'
// GARDEN HOTEL SETTINGS — Hotel · Voice · Phone · Triggers, one page (Jon: "create better settings").
import { useCallback, useEffect, useState } from 'react'
import { Settings, Check, Loader2, Play, Plus, Trash2, RefreshCw, Zap } from 'lucide-react'
import { LeanHead, LeanTabs, LeanList, LeanRow, LeanSection, LeanEmpty, Tag, Pill, IconBtn } from '@/components/lean'

const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, { cache: 'no-store', ...init }); return r.json() }
const post = (url: string, body: any, method = 'POST') => j(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never'
const input = 'rounded-lg border border-line bg-white px-3 py-2 text-[13px] focus:outline-none focus:border-brand-500 disabled:opacity-60'
const Label = ({ t }: { t: string }) => <span className="block text-[11px] uppercase tracking-wider text-muted font-semibold mb-1">{t}</span>

// `only` renders one section inside the Users & admin → Settings directory (same console as the VR
// side); without it the old tabbed page renders.
export function GardenSettings({ owner, canEdit, only }: { owner: boolean; canEdit: boolean; only?: 'hotel' | 'voice' | 'phone' | 'triggers' }) {
  const [tab, setTab] = useState<'hotel' | 'voice' | 'phone' | 'triggers'>(only || 'hotel')
  const [d, setD] = useState<any | null>(null)
  const [saved, setSaved] = useState('')
  const load = useCallback(async () => setD(await j('/api/garden/settings')), [])
  useEffect(() => { load() }, [load])
  const save = async (patch: any) => { const r = await post('/api/garden/settings', patch, 'PUT'); setSaved(r?.ok ? 'Saved' : (r?.error || 'Could not save')); setTimeout(() => setSaved(''), 2500); if (r?.newToken) setSaved(`Saved · webhook token: ${r.newToken} (copy it now; it is not shown again)`); setD((x: any) => ({ ...x, ...r })) }
  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
  if (!d.ok) return <LeanEmpty>{d.error}</LeanEmpty>
  if (only) return (
    <>
      {saved ? <p className="text-[12px] text-emerald-700 mb-2">{saved}</p> : null}
      {only === 'hotel' ? <HotelTab h={d.hotel} owner={owner} save={h => save({ hotel: h })} /> : null}
      {only === 'voice' ? <VoiceTab v={d.voice} owner={owner} save={v => save({ voice: v })} /> : null}
      {only === 'phone' ? <PhoneTab p={d.phone} status={d.phoneStatus} owner={owner} save={p => save({ phone: p })} /> : null}
      {only === 'triggers' ? <TriggersTab canEdit={canEdit} /> : null}
      {!owner && only !== 'triggers' ? <p className="text-[12px] text-muted mt-3 px-1">Someone with full access on hotel settings edits these.</p> : null}
    </>
  )
  return (
    <>
      <LeanHead title="Garden Hotel settings" icon={<Settings size={20} className="text-brand-600" />}>
        <Pill tone={d.phone.provider === 'none' ? 'slate' : d.phoneStatus.configured || d.phoneStatus.hasToken ? 'emerald' : 'amber'} title="Phone system">{d.phone.provider === 'none' ? 'no phone system' : `${d.phone.provider} · ${d.phoneStatus.configured || d.phoneStatus.hasToken ? 'ready' : 'not configured'}`}</Pill>
        {saved ? <Pill tone="emerald">{saved}</Pill> : null}
      </LeanHead>
      <LeanTabs value={tab} onChange={setTab} tabs={[{ key: 'hotel', label: 'Hotel' }, { key: 'voice', label: 'Voice' }, { key: 'phone', label: 'Phone system' }, { key: 'triggers', label: 'Triggers' }]} />
      {tab === 'hotel' ? <HotelTab h={d.hotel} owner={owner} save={h => save({ hotel: h })} /> : null}
      {tab === 'voice' ? <VoiceTab v={d.voice} owner={owner} save={v => save({ voice: v })} /> : null}
      {tab === 'phone' ? <PhoneTab p={d.phone} status={d.phoneStatus} owner={owner} save={p => save({ phone: p })} /> : null}
      {tab === 'triggers' ? <TriggersTab canEdit={canEdit} /> : null}
      {!owner && tab !== 'triggers' ? <p className="text-[12px] text-muted mt-3 px-1">An owner edits these.</p> : null}
    </>
  )
}

function HotelTab({ h, owner, save }: { h: any; owner: boolean; save: (h: any) => void }) {
  const [f, setF] = useState<any>(h)
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }))
  const setIn = (k: string, kk: string, v: any) => setF((x: any) => ({ ...x, [k]: { ...(x[k] || {}), [kk]: v } }))
  const F = ({ k, t, w }: { k: string; t: string; w?: string }) => <label className="block"><Label t={t} /><input value={f[k] ?? ''} onChange={e => set(k, e.target.value)} disabled={!owner} className={`${input} w-full ${w || ''}`} /></label>
  return (
    <div className="space-y-4">
      <LeanSection title="The hotel">
        <div className="rounded-2xl border border-line bg-white p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <F k="name" t="Name" /><F k="shortName" t="Short name" /><F k="city" t="City" /><F k="managerName" t="Manager (who the calls come from)" />
          <F k="checkInTime" t="Check-in time (HH:MM)" /><F k="checkOutTime" t="Check-out time (HH:MM)" /><F k="frontDeskPhone" t="Front desk phone" /><F k="frontDeskEmail" t="Front desk email" />
          <label className="block sm:col-span-2"><Label t="Slack channel for the desk (id or #name, for triggers)" /><input value={f.slackChannel ?? ''} onChange={e => set('slackChannel', e.target.value || null)} disabled={!owner} className={`${input} w-full`} /></label>
        </div>
      </LeanSection>
      <LeanSection title="Welcome calls">
        <div className="rounded-2xl border border-line bg-white p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[13px]">
          <label className="inline-flex items-center gap-2 col-span-2 sm:col-span-4"><input type="checkbox" checked={!!f.welcomeCall?.enabled} onChange={e => setIn('welcomeCall', 'enabled', e.target.checked)} disabled={!owner} /> Put a welcome call on the desk for arrivals</label>
          <label><Label t="Days before arrival" /><input type="number" value={f.welcomeCall?.daysBefore ?? 2} onChange={e => setIn('welcomeCall', 'daysBefore', Number(e.target.value))} disabled={!owner} className={`${input} w-full`} /></label>
          <label><Label t="Call from (hour ET)" /><input type="number" value={f.welcomeCall?.fromHour ?? 9} onChange={e => setIn('welcomeCall', 'fromHour', Number(e.target.value))} disabled={!owner} className={`${input} w-full`} /></label>
          <label><Label t="Until (hour ET)" /><input type="number" value={f.welcomeCall?.toHour ?? 19} onChange={e => setIn('welcomeCall', 'toHour', Number(e.target.value))} disabled={!owner} className={`${input} w-full`} /></label>
          <label><Label t="Long stay = nights ≥" /><input type="number" value={f.welcomeCall?.longStayNights ?? 7} onChange={e => setIn('welcomeCall', 'longStayNights', Number(e.target.value))} disabled={!owner} className={`${input} w-full`} /></label>
          <div className="col-span-2 sm:col-span-4"><Label t="Mandatory for" />{(['all', 'direct', 'ota', 'long_stay'] as const).map(k => <label key={k} className="inline-flex items-center gap-1.5 mr-4"><input type="checkbox" checked={(f.welcomeCall?.mandatoryFor || []).includes(k)} onChange={e => { const cur: string[] = f.welcomeCall?.mandatoryFor || []; setIn('welcomeCall', 'mandatoryFor', e.target.checked ? Array.from(new Set([...cur, k])) : cur.filter(x => x !== k)) }} disabled={!owner} /> {k.replace('_', ' ')}</label>)}</div>
        </div>
      </LeanSection>
      <LeanSection title="Verification and after the stay">
        <div className="rounded-2xl border border-line bg-white p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[13px]">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!f.verification?.requireId} onChange={e => setIn('verification', 'requireId', e.target.checked)} disabled={!owner} /> ID required</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!f.verification?.requireCard} onChange={e => setIn('verification', 'requireCard', e.target.checked)} disabled={!owner} /> Card on file required</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!f.verification?.requireDeposit} onChange={e => setIn('verification', 'requireDeposit', e.target.checked)} disabled={!owner} /> Deposit required</label>
          <label><Label t="Deposit $" /><input type="number" value={f.verification?.depositAmount ?? ''} onChange={e => setIn('verification', 'depositAmount', e.target.value === '' ? null : Number(e.target.value))} disabled={!owner} className={`${input} w-full`} /></label>
          <label className="col-span-2 sm:col-span-4"><Label t="Only for these sources (comma-separated; blank = all)" /><input value={(f.verification?.sources || []).join(', ')} onChange={e => setIn('verification', 'sources', e.target.value.split(',').map(x => x.trim()).filter(Boolean))} disabled={!owner} className={`${input} w-full`} /></label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!f.postStay?.callEnabled} onChange={e => setIn('postStay', 'callEnabled', e.target.checked)} disabled={!owner} /> Post-stay call</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!f.postStay?.reviewAskEnabled} onChange={e => setIn('postStay', 'reviewAskEnabled', e.target.checked)} disabled={!owner} /> Ask for a review</label>
          <label><Label t="Hours after checkout" /><input type="number" value={f.postStay?.hoursAfterCheckout ?? 6} onChange={e => setIn('postStay', 'hoursAfterCheckout', Number(e.target.value))} disabled={!owner} className={`${input} w-full`} /></label>
        </div>
      </LeanSection>
      {owner ? <button onClick={() => save(f)} className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1"><Check size={13} /> Save hotel settings</button> : null}
    </div>
  )
}

function VoiceTab({ v, owner, save }: { v: any; owner: boolean; save: (v: any) => void }) {
  const [f, setF] = useState<any>(v)
  const set = (k: string, val: any) => setF((x: any) => ({ ...x, [k]: val }))
  const ex: { situation: string; reply: string }[] = f.examples || []
  const pts: string[] = f.welcomeCallPoints || []
  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-muted px-1">How the hotel — and Adam — sound to a guest. The same shape as Eve&apos;s review voice on the VR side, kept separate on purpose: review replies, welcome-call scripts and the owner letter all read from here.</p>
      <LeanSection title="Guidelines"><textarea value={f.guidelines || ''} onChange={e => set('guidelines', e.target.value)} disabled={!owner} rows={6} className={`${input} w-full`} /></LeanSection>
      <LeanSection title="Examples" n={ex.length} right={owner ? <button onClick={() => set('examples', [...ex, { situation: '', reply: '' }])} className="text-brand-700 inline-flex items-center gap-1"><Plus size={12} /> Add</button> : null}>
        <div className="space-y-2">{ex.map((e, i) => (
          <div key={i} className="rounded-2xl border border-line bg-white p-3 grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-2">
            <input value={e.situation} placeholder="Situation" onChange={ev => set('examples', ex.map((x, k) => k === i ? { ...x, situation: ev.target.value } : x))} disabled={!owner} className={input} />
            <textarea value={e.reply} placeholder="The reply" rows={2} onChange={ev => set('examples', ex.map((x, k) => k === i ? { ...x, reply: ev.target.value } : x))} disabled={!owner} className={input} />
            {owner ? <IconBtn title="Remove" tone="bad" onClick={() => set('examples', ex.filter((_, k) => k !== i))}><Trash2 size={14} /></IconBtn> : null}
          </div>))}</div>
      </LeanSection>
      <LeanSection title="Welcome call — what every call covers, in order" n={pts.length} right={owner ? <button onClick={() => set('welcomeCallPoints', [...pts, ''])} className="text-brand-700 inline-flex items-center gap-1"><Plus size={12} /> Add</button> : null}>
        <div className="space-y-1.5">{pts.map((p, i) => <div key={i} className="flex gap-2"><input value={p} onChange={e => set('welcomeCallPoints', pts.map((x, k) => k === i ? e.target.value : x))} disabled={!owner} className={`${input} flex-1`} />{owner ? <IconBtn title="Remove" tone="bad" onClick={() => set('welcomeCallPoints', pts.filter((_, k) => k !== i))}><Trash2 size={14} /></IconBtn> : null}</div>)}</div>
      </LeanSection>
      <LeanSection title="Review replies and sign-off">
        <div className="rounded-2xl border border-line bg-white p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
          <label><Label t="Sign-off" /><input value={f.signOff || ''} onChange={e => set('signOff', e.target.value)} disabled={!owner} className={`${input} w-full`} /></label>
          <label><Label t="Languages (en, es, pt, fr)" /><input value={(f.languages || []).join(', ')} onChange={e => set('languages', e.target.value.split(',').map(x => x.trim()).filter(Boolean))} disabled={!owner} className={`${input} w-full`} /></label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!f.reviewReply?.thankFirst} onChange={e => set('reviewReply', { ...f.reviewReply, thankFirst: e.target.checked })} disabled={!owner} /> Thank first, specifically</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!f.reviewReply?.nameTheFix} onChange={e => set('reviewReply', { ...f.reviewReply, nameTheFix: e.target.checked })} disabled={!owner} /> Name the fix when something went wrong</label>
          <label><Label t="Max sentences" /><input type="number" value={f.reviewReply?.maxSentences ?? 5} onChange={e => set('reviewReply', { ...f.reviewReply, maxSentences: Number(e.target.value) })} disabled={!owner} className={`${input} w-full`} /></label>
          <label><Label t="Never mention (comma-separated)" /><input value={(f.reviewReply?.neverMention || []).join(', ')} onChange={e => set('reviewReply', { ...f.reviewReply, neverMention: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} disabled={!owner} className={`${input} w-full`} /></label>
        </div>
      </LeanSection>
      {owner ? <button onClick={() => save(f)} className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1"><Check size={13} /> Save voice</button> : null}
    </div>
  )
}

function PhoneTab({ p, status, owner, save }: { p: any; status: any; owner: boolean; save: (p: any) => void }) {
  const [f, setF] = useState<any>({ provider: p.provider, numbers: (p.numbers || []).join(', '), voicemailMaxSec: p.voicemailMaxSec, envHint: p.envHint || '' })
  const [sync, setSync] = useState('')
  const runSync = async () => { setSync('…'); const r = await post('/api/garden', { action: 'sync' }); setSync(r?.phone ? (r.phone.error || `${r.phone.stored ?? 0} calls · ${r.phone.matched ?? 0} matched to guests`) : 'ran') }
  const ENV: Record<string, string> = { talkroute: 'Shares the VR side\'s Talkroute key (Users & admin → Talkroute). List the hotel\'s own numbers below so its calls are told apart.', twilio: 'Vercel: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN', ringcentral: 'Vercel: RINGCENTRAL_CLIENT_ID + RINGCENTRAL_CLIENT_SECRET + RINGCENTRAL_JWT (+ RINGCENTRAL_SERVER for sandbox)', webhook: 'Any system POSTs JSON to /api/garden/phone/webhook?token=… — one call or { calls: [...] }, each { id, direction, from, to, startedAt, durationSec, result?, recordingUrl? }', none: 'No phone system yet — calls are logged by hand on the desk.' }
  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-muted px-1">Whichever system the hotel ends up on, calls land in one table, get matched to the guest by number, and feed the call desk: an answered call to a guest on the queue is an attempt; a missed call from a guest fires the missed-call trigger.</p>
      <div className="rounded-2xl border border-line bg-white p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
        <label><Label t="Provider" /><select value={f.provider} onChange={e => setF({ ...f, provider: e.target.value })} disabled={!owner} className={`${input} w-full`}>{['none', 'talkroute', 'twilio', 'ringcentral', 'webhook'].map(k => <option key={k} value={k}>{k}</option>)}</select></label>
        <label><Label t="Voicemail if answered under (seconds)" /><input type="number" value={f.voicemailMaxSec} onChange={e => setF({ ...f, voicemailMaxSec: Number(e.target.value) })} disabled={!owner} className={`${input} w-full`} /></label>
        <label className="sm:col-span-2"><Label t="The hotel's numbers (comma-separated)" /><input value={f.numbers} onChange={e => setF({ ...f, numbers: e.target.value })} disabled={!owner} className={`${input} w-full`} /></label>
        <p className="sm:col-span-2 text-[12px] text-muted">{ENV[f.provider]}</p>
        <div className="sm:col-span-2 flex items-center gap-2 flex-wrap">
          <Tag tone={status.configured || (f.provider === 'webhook' && status.hasToken) ? 'emerald' : f.provider === 'none' ? 'slate' : 'amber'}>{f.provider === 'none' ? 'off' : status.configured || (f.provider === 'webhook' && status.hasToken) ? 'configured' : 'not configured'}</Tag>
          <span className="text-muted">last sync {when(p.lastSyncAt)}{p.lastCount != null ? ` · ${p.lastCount} calls` : ''}{p.lastError ? <span className="text-rose-700"> · {p.lastError}</span> : ''}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {owner ? <button onClick={() => save(f)} className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1"><Check size={13} /> Save phone settings</button> : null}
        {owner && f.provider === 'webhook' ? <button onClick={() => save({ ...f, rotateToken: true })} className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-semibold">{status.hasToken ? 'Rotate webhook token' : 'Create webhook token'}</button> : null}
        {f.provider !== 'none' && f.provider !== 'webhook' ? <button onClick={runSync} className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1"><RefreshCw size={12} /> Sync calls now</button> : null}
        {sync ? <span className="text-[12px] text-muted">{sync}</span> : null}
      </div>
    </div>
  )
}

function TriggersTab({ canEdit }: { canEdit: boolean }) {
  const [d, setD] = useState<any | null>(null)
  const [edit, setEdit] = useState<any | null>(null)
  const [note, setNote] = useState('')
  const load = useCallback(async () => setD(await j('/api/garden/triggers?log=1')), [])
  useEffect(() => { load() }, [load])
  const act = async (op: string) => { const r = await post('/api/garden/triggers', { op }); setNote(op === 'run' ? `${r.events ?? 0} events · ${r.fired ?? 0} fired · ${r.skipped ?? 0} skipped · ${r.failed ?? 0} failed` : `${r.seeded ?? 0} added`); load() }
  const saveT = async () => { const body = { ...edit }; try { body.conditions = typeof edit.conditions === 'string' ? JSON.parse(edit.conditions || '{}') : edit.conditions; body.params = typeof edit.params === 'string' ? JSON.parse(edit.params || '{}') : edit.params } catch { setNote('Conditions and params must be JSON'); return } const r = await post('/api/garden/triggers', body, 'PUT'); setNote(r?.ok ? 'Saved' : r?.error || 'failed'); if (r?.ok) setEdit(null); load() }
  const toggle = async (t: any) => { await post('/api/garden/triggers', { ...t, enabled: !t.enabled }, 'PUT'); load() }
  const del = async (t: any) => { await post('/api/garden/triggers', { id: t.id }, 'DELETE'); load() }
  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
  const evLabel = (k: string) => (d.events || []).find((e: any) => e.key === k)?.label || k
  const acLabel = (k: string) => (d.actions || []).find((a: any) => a.key === k)?.label || k
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap text-[12px]">
        <span className="text-muted">When something happens at the hotel, do something — from the sync, the desk and the reviews. {d.pendingEvents ? <b className="text-amber-700">{d.pendingEvents} events waiting</b> : 'Nothing waiting.'}</span>
        <span className="flex-1" />
        {canEdit ? <><button onClick={() => act('run')} className="rounded-lg bg-ink text-white px-2.5 py-1.5 font-semibold inline-flex items-center gap-1"><Play size={12} /> Run now</button>
          {!d.triggers.length ? <button onClick={() => act('seed')} className="rounded-lg border border-line px-2.5 py-1.5 font-semibold">Add the starter set</button> : null}
          <button onClick={() => setEdit({ name: '', event: 'reservation_created', action: 'queue_call', conditions: '{}', params: '{"kind":"welcome"}', enabled: true, sort: 100 })} className="rounded-lg border border-line px-2.5 py-1.5 font-semibold inline-flex items-center gap-1"><Plus size={12} /> New trigger</button></> : null}
        {note ? <span className="text-muted">{note}</span> : null}
      </div>
      {edit ? (
        <div className="rounded-2xl border border-line bg-white p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
          <label className="sm:col-span-2"><Label t="Name" /><input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} className={`${input} w-full`} /></label>
          <label><Label t="When" /><select value={edit.event} onChange={e => setEdit({ ...edit, event: e.target.value })} className={`${input} w-full`}>{d.events.map((e: any) => <option key={e.key} value={e.key}>{e.label}</option>)}</select></label>
          <label><Label t="Do" /><select value={edit.action} onChange={e => setEdit({ ...edit, action: e.target.value })} className={`${input} w-full`}>{d.actions.map((a: any) => <option key={a.key} value={a.key}>{a.label}</option>)}</select></label>
          <label><Label t="Only if (JSON: source_in, source_not, nights_min, nights_max, balance_gt, room_type_in, rating_max, rating_min, kind_in)" /><textarea rows={3} value={typeof edit.conditions === 'string' ? edit.conditions : JSON.stringify(edit.conditions)} onChange={e => setEdit({ ...edit, conditions: e.target.value })} className={`${input} w-full font-mono text-[12px]`} /></label>
          <label><Label t={`Params (JSON) — ${(d.actions.find((a: any) => a.key === edit.action) || {}).params || ''}`} /><textarea rows={3} value={typeof edit.params === 'string' ? edit.params : JSON.stringify(edit.params)} onChange={e => setEdit({ ...edit, params: e.target.value })} className={`${input} w-full font-mono text-[12px]`} /></label>
          <div className="sm:col-span-2 flex gap-2"><button onClick={saveT} className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold">Save</button><button onClick={() => setEdit(null)} className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-semibold">Cancel</button></div>
        </div>
      ) : null}
      {d.triggers.length ? (
        <LeanList>{d.triggers.map((t: any) => (
          <LeanRow key={t.id} lead={<span className={`w-8 h-8 rounded-lg inline-flex items-center justify-center ${t.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-app text-muted'}`}><Zap size={14} /></span>}
            name={t.name} meta={`${evLabel(t.event)} → ${acLabel(t.action)}${t.fired_count ? ` · fired ${t.fired_count}×, last ${when(t.last_fired_at)}` : ' · never fired'}`}
            tags={<Tag tone={t.enabled ? 'emerald' : 'slate'}>{t.enabled ? 'on' : 'off'}</Tag>}
            actions={canEdit ? <><IconBtn title={t.enabled ? 'Switch off' : 'Switch on'} onClick={() => toggle(t)}><Check size={14} /></IconBtn><IconBtn title="Edit" onClick={() => setEdit({ ...t, conditions: JSON.stringify(t.conditions || {}), params: JSON.stringify(t.params || {}) })}><Settings size={14} /></IconBtn><IconBtn title="Delete" tone="bad" onClick={() => del(t)}><Trash2 size={14} /></IconBtn></> : undefined}>
            <p className="text-[12px] text-muted font-mono">if {JSON.stringify(t.conditions || {})} → {JSON.stringify(t.params || {})}</p>
          </LeanRow>))}</LeanList>
      ) : <LeanEmpty>No triggers yet — add the starter set (welcome call on every booking, ID and card on OTA bookings, cancellations to Slack, inspect after a long stay, draft every review reply, low review to the desk, missed call → call back).</LeanEmpty>}
      <LeanSection title="What fired" n={(d.log || []).length}>
        {(d.log || []).length ? <LeanList>{d.log.slice(0, 40).map((l: any) => <LeanRow key={l.id} name={l.trigger_name || l.event} meta={`${evLabel(l.event)} · ${l.subject_id || ''} · ${when(l.at)}`} tags={<Tag tone={l.result === 'fired' ? 'emerald' : l.result === 'failed' ? 'rose' : 'slate'}>{l.result}</Tag>}>{l.detail ? <p className="text-[12px] text-muted font-mono">{JSON.stringify(l.detail)}</p> : null}</LeanRow>)}</LeanList> : <LeanEmpty>Nothing has fired yet.</LeanEmpty>}
      </LeanSection>
    </div>
  )
}
