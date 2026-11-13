'use client'
// OWNER ONBOARDING, THE TEAM'S SIDE (lib/owner-onboard).
//   OwnerOnboardingDesk  — /owner-onboarding: every owner link, and a new one (owner, property, who sends the
//                          introductory email, what to ask, optionally the home started for them, the agreement)
//   OwnerOnboardingReport — /owner-onboarding/<code>: the report the team works from: the home, what it has and
//                          needs, the timeline, the onboarding call, the paperwork and the handoff to accounting.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Loader2, Copy, Check, Mail, ExternalLink, FileUp, Download, Send, Lock, Printer, Search, Archive } from 'lucide-react'
import { OO_STEPS, OO_BEDS, OO_APPLIANCES, OO_APPLIANCE_LABEL, DEFAULT_GM, DEFAULT_SALES, DEFAULT_HOME, introEmail, stepLabel, type OOIndexRow, type OOItem, type OOStepStatus, type OOHome } from '@/lib/owner-onboard'

type Any = any
const lab = 'text-[10.5px] uppercase tracking-[0.16em] text-muted font-semibold'
const field = 'mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-[13.5px] text-ink'
const card = 'rounded-2xl border border-line bg-white p-5'
const origin = () => (typeof window !== 'undefined' ? window.location.origin : '')
const ownerLink = (code: string) => origin() + '/join/' + code

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

// ── email the owner their private link (a magic link; they then create a password) ──
function InviteOwner({ rec, onRec }: { rec: Any; onRec: (r: Any) => void }) {
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('')
  const acc = rec.ownerAccess || {}
  return (
    <section className={card}>
      <h2 className="font-serif text-[22px] leading-none text-ink mb-1">The owner’s private link <Lock size={14} className="inline" /></h2>
      <p className="text-[12.5px] text-muted mb-3">The owner’s page is private. Email them a sign-in link: it opens their page once and has them create a password. After that the link asks for the password, or emails them a fresh sign-in link.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || !rec.custom.ownerEmail} onClick={async () => { setBusy(true); setMsg(''); const d = await fetch(`/api/owner-onboarding/${rec.code}/invite`, { method: 'POST' }).then(r => r.json()).catch(() => null); setBusy(false); if (d?.record) onRec(d.record); setMsg(d?.ok ? 'Sent to ' + rec.custom.ownerEmail + '.' : 'Not sent: ' + (d?.error || 'try again')) }} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {acc.invitedAt ? 'Email the link again' : 'Email the owner their link'}</button>
        <span className="text-[12.5px] text-muted">{msg || (!rec.custom.ownerEmail ? 'Add the owner’s email first (without one, the link stays open to anyone who has it).' : [acc.invitedAt ? 'Sent ' + new Date(acc.invitedAt).toLocaleDateString() : 'Not sent yet', acc.hasPassword ? 'password created' : 'no password yet'].join(' · '))}</span>
      </div>
    </section>
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
  const skip: string[] = o?.review?.skip || []
  const total = lines.filter(l => skip.indexOf(l.key) < 0).reduce((a, l) => a + (Number(l.price) || 0) * l.qty.reduce((x: number, y: number) => x + (Number(y) || 0), 0), 0)
  const inp = 'rounded-lg border border-line px-2 py-1 text-[12.5px] text-ink'
  return (
    <section className={card}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1"><h2 className="font-serif text-[22px] leading-none text-ink mr-auto">Order list</h2>
        {o ? <span className={'rounded-full px-2 py-0.5 text-[11.5px] font-semibold ' + (o.status === 'approved' ? 'bg-emerald-50 text-emerald-800' : o.status === 'changes' ? 'bg-amber-50 text-amber-800' : o.status === 'sent' ? 'bg-app text-ink' : 'bg-app text-muted')}>{o.status === 'approved' ? 'Approved by the owner' : o.status === 'changes' ? 'Owner asked for changes' : o.status === 'sent' ? 'With the owner for review' : 'Draft'}</span> : null}</div>
      <p className="text-[12.5px] text-muted mb-3">Our actual items from the Stay catalog, sized to {units.length > 1 ? 'each unit' : 'the home'}. Take off what the owner already has, adjust, then send it to the owner to review and approve. Linen is separate.</p>
      {!o ? <button type="button" disabled={busy === 'build' || !units.length} onClick={() => act('build')} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold disabled:opacity-50">{busy === 'build' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Build the order list</button> : (<>
        {o.review ? <div className={'rounded-xl p-3 mb-3 ' + (o.status === 'approved' ? 'bg-emerald-50' : 'bg-amber-50')}><p className={lab}>The owner’s review · {new Date(o.review.at).toLocaleString()}</p>
          {o.review.skip.length ? <p className="text-[13px] text-ink mt-1">Already has: {o.review.skip.map((k: string) => lines.find(l => l.key === k)?.name || k).join(', ')}</p> : null}
          {o.review.note ? <p className="text-[13px] text-ink mt-1 whitespace-pre-wrap">“{o.review.note}”</p> : null}</div> : null}
        <div className="overflow-x-auto"><table className="w-full min-w-[500px] text-[12.5px]">
          <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted border-b border-line"><th className="py-1.5 font-semibold">Item</th>{units.map(u => <th key={u} className="px-1 text-right font-semibold whitespace-nowrap">{units.length > 1 ? u : 'Qty'}</th>)}<th className="px-1 text-right font-semibold">Each</th><th className="text-right font-semibold">Total</th><th /></tr></thead>
          <tbody>{lines.map((l, i) => { const q = l.qty.reduce((x: number, y: number) => x + (Number(y) || 0), 0), off = skip.indexOf(l.key) >= 0; return (
            <tr key={l.key} className={'border-b border-line align-top ' + (off ? 'opacity-50' : '')}>
              <td className="py-1.5 pr-2"><input value={l.name} onChange={e => set(i, { name: e.target.value })} className={inp + ' w-full font-semibold'} /><span className="block text-[11.5px] text-muted mt-0.5">{l.detail && l.detail !== l.name ? l.detail + ' · ' : ''}{l.category}{l.url ? <> · <a href={l.url} target="_blank" rel="noreferrer" className="underline">item</a></> : null}{off ? ' · owner has this' : ''}</span></td>
              {units.map((u, ui) => <td key={u} className="px-1 text-right"><input inputMode="numeric" value={String(l.qty[ui] ?? 0)} onChange={e => set(i, { qty: units.map((_, k) => (k === ui ? Number(e.target.value.replace(/\D/g, '')) || 0 : l.qty[k] || 0)) })} className={inp + ' w-12 text-right'} /></td>)}
              <td className="px-1 text-right"><input inputMode="decimal" value={l.price ?? ''} onChange={e => set(i, { price: e.target.value === '' ? null : e.target.value })} className={inp + ' w-[68px] text-right'} /></td>
              <td className="text-right tabular-nums pt-2.5">{l.price != null && l.price !== '' ? money(Number(l.price) * q) : '—'}</td>
              <td className="pl-1 pt-2"><button type="button" onClick={() => { setLines(ls => ls.filter((_, j) => j !== i)); setDirty(true) }} className="text-muted hover:text-red-700" title="Remove">×</button></td>
            </tr>) })}</tbody>
          <tfoot><tr><td className="pt-2 font-semibold text-ink" colSpan={units.length + 2}>Estimated total{skip.length ? ' (without what the owner has)' : ''}</td><td className="pt-2 text-right font-semibold tabular-nums">{money(total)}</td><td /></tr></tfoot>
        </table></div>
        <div className="oo-noprint">
          <button type="button" onClick={() => { setLines(ls => [...ls, { key: 'c' + Date.now().toString(36), category: 'Other', name: 'New item', detail: '', url: '', price: null, qty: units.map(() => 1) }]); setDirty(true) }} className="mt-2 text-[12.5px] font-semibold text-ink">+ Add an item</button>
          <label className="block mt-3"><span className={lab}>Note to the owner (shown above the list)</span><textarea rows={2} value={note} onChange={e => { setNote(e.target.value); setDirty(true) }} className={field} placeholder="e.g. We left off what you marked as already in the home." /></label>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button type="button" disabled={!dirty || !!busy} onClick={() => act('save', { lines, note })} className="rounded-xl border border-line px-3 py-2 text-[13px] font-semibold text-ink disabled:opacity-40">Save changes</button>
            <button type="button" disabled={!!busy} onClick={async () => { if (dirty && !(await act('save', { lines, note }))) return; act('send') }} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold disabled:opacity-50">{busy === 'send' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {o.status === 'draft' ? 'Send to the owner to review' : 'Send again'}</button>
            {o.status !== 'draft' ? <button type="button" onClick={() => act('unsend')} className="text-[12.5px] text-muted underline">Take it back to a draft</button> : null}
            <button type="button" onClick={() => act('build')} className="text-[12.5px] text-muted underline">Rebuild from the catalog</button>
          </div>
          <div className="mt-3 rounded-xl bg-app p-3 text-[12.5px] text-ink flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="mr-auto"><b>The unit’s FAQ.</b> {rec.faq ? `${rec.faq.added} ${rec.faq.added === 1 ? 'entry' : 'entries'} added, last on ${new Date(rec.faq.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.` : rec.attach?.listingId ? (o.status === 'approved' ? 'Approved items go in automatically.' : 'Items go in once the owner approves the list, with the Wi-Fi, parking and laundry.') : 'Attach the unit to its Guesty listing and the approved items, Wi-Fi, parking and laundry go into its FAQ.'}</span>
            {rec.attach?.listingId ? <button type="button" disabled={!!busy} onClick={() => act('faq')} className="font-semibold underline">{busy === 'faq' ? 'Updating…' : 'Update the FAQ now'}</button> : null}
          </div>
        </div>
      </>)}
      {msg ? <p className="text-[12.5px] text-ink mt-2">{msg}</p> : null}
    </section>
  )
}

// ── the introductory email, ready to copy ──
function IntroEmail({ rec }: { rec: Any }) {
  const [from, setFrom] = useState<'sales' | 'gm'>(rec.custom.from || 'sales')
  const e = introEmail({ ...rec, custom: { ...rec.custom, from } }, ownerLink(rec.code))
  const to = rec.custom.ownerEmail || ''
  const cc = from === 'sales' ? rec.custom.gm.email : ''
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="font-serif text-[22px] leading-none text-ink mr-auto">Introductory email</h2>
        <div className="inline-flex rounded-full bg-app p-0.5 text-[12px] font-semibold">
          {(['sales', 'gm'] as const).map(k => <button key={k} type="button" onClick={() => setFrom(k)} className={'rounded-full px-3 py-1 ' + (from === k ? 'bg-white text-ink shadow-sm' : 'text-muted')}>From {k === 'sales' ? (rec.custom.sales.name.split(' ')[0] || 'sales') : (rec.custom.gm.name.split(' ')[0] || 'the GM')}</button>)}
        </div>
      </div>
      <p className={lab}>To</p><p className="text-[13.5px] text-ink">{to || <span className="text-muted">Add the owner’s email above</span>}{cc ? <span className="text-muted"> · cc {cc}</span> : null}</p>
      <p className={lab + ' mt-3'}>Subject</p>
      <div className="flex flex-wrap items-center gap-2"><p className="text-[14px] font-semibold text-ink mr-auto">{e.subject}</p><CopyBtn text={e.subject} label="Copy subject" small /></div>
      <p className={lab + ' mt-3'}>Message</p>
      <pre className="mt-1 whitespace-pre-wrap rounded-xl bg-app p-3 text-[13px] leading-relaxed text-ink font-sans max-h-[360px] overflow-auto">{e.body}</pre>
      <div className="flex flex-wrap gap-2 mt-3">
        <CopyBtn text={e.body} label="Copy message" />
        <a href={`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(e.subject)}${cc ? '&cc=' + encodeURIComponent(cc) : ''}&body=${encodeURIComponent(e.body)}`} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold"><Mail size={13} /> Open in my email</a>
      </div>
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
      <label className="block sm:col-span-3"><span className={lab}>Address</span><input value={home.address} onChange={e => set({ ...home, address: e.target.value })} className={field} /></label>
      <label className="block"><span className={lab}>Unit</span><input value={home.unit} onChange={e => set({ ...home, unit: e.target.value })} className={field} /></label>
      {num('sqft', 'Square feet')}{num('bedrooms', 'Bedrooms')}{num('bathrooms', 'Bathrooms', 0.5)}{num('guests', 'Sleeps')}
      {OO_BEDS.map(b => <label key={b} className="block"><span className={lab}>{b} beds</span><input inputMode="numeric" value={String(home.beds[b] || 0)} onChange={e => set({ ...home, beds: { ...home.beds, [b]: Number(e.target.value.replace(/\D/g, '')) || 0 } })} className={field} /></label>)}
      <label className="flex items-center gap-2 text-[13px] text-ink pt-5"><input type="checkbox" checked={home.sleeper} onChange={e => set({ ...home, sleeper: e.target.checked })} /> Sofa bed</label>
      <label className="flex items-center gap-2 text-[13px] text-ink pt-5"><input type="checkbox" checked={home.kitchen} onChange={e => set({ ...home, kitchen: e.target.checked })} /> Kitchen</label>
      {home.kitchen ? <div className="sm:col-span-4 flex flex-wrap gap-2">{OO_APPLIANCES.map(a => <label key={a} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[12.5px] text-ink"><input type="checkbox" checked={home.appliances[a]} onChange={e => set({ ...home, appliances: { ...home.appliances, [a]: e.target.checked } })} /> {OO_APPLIANCE_LABEL[a]}</label>)}</div> : null}
    </div>
  )
}

export function OwnerOnboardingDesk() {
  const [links, setLinks] = useState<OOIndexRow[] | null>(null)
  const [q, setQ] = useState('')
  const [showArch, setShowArch] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [made, setMade] = useState<Any>(null)
  const [f, setF] = useState<Any>({ ownerName: '', ownerEmail: '', ownerPhone: '', property: '', listingId: '', unitLabel: '', from: 'sales', greeting: '', gm: { ...DEFAULT_GM }, sales: { ...DEFAULT_SALES }, askSupplies: true, askLinen: true, askPayout: true, prefill: false, home: { ...DEFAULT_HOME }, teamNotes: '' })
  const agree = useRef<HTMLInputElement>(null)
  const [agreeFile, setAgreeFile] = useState<File | null>(null)
  const load = () => fetch('/api/owner-onboarding', { cache: 'no-store' }).then(r => r.json()).then(d => setLinks(d?.ok ? d.links : [])).catch(() => setLinks([]))
  useEffect(() => { load() }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg('')
    try {
      const body = { custom: { ownerName: f.ownerName, ownerEmail: f.ownerEmail, ownerPhone: f.ownerPhone, greeting: f.greeting, from: f.from, gm: f.gm, sales: f.sales, contact: f.gm, askHome: true, askSupplies: f.askSupplies, askLinen: f.askLinen, askPayout: f.askPayout }, attach: { property: f.property, listingId: f.listingId, unitLabel: f.unitLabel }, home: f.prefill ? f.home : null, teamNotes: f.teamNotes }
      const d = await fetch('/api/owner-onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
      if (!d?.ok) throw new Error(d?.error || 'Could not create the link.')
      if (agreeFile) await uploadAgreement(d.code, agreeFile).catch(err => setMsg('The link is made, but the agreement did not upload: ' + err.message))
      const full = await fetch('/api/owner-onboarding/' + d.code).then(r => r.json())
      setMade(full.record); setCreating(false); setAgreeFile(null); load()
    } catch (err: Any) { setMsg(err.message) } finally { setBusy(false) }
  }

  const shown = (links || []).filter(l => (showArch || !l.archived) && (!q.trim() || (l.ownerName + ' ' + l.property + ' ' + l.unitLabel).toLowerCase().includes(q.trim().toLowerCase())))
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
        {!links ? <p className="py-10 text-center text-muted"><Loader2 size={15} className="inline animate-spin" /></p> : !shown.length ? <p className="p-5 text-[13px] text-muted">No owner links yet. Make the first with “New owner link”.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-[13px]">
            <thead><tr className="text-left text-[10.5px] uppercase tracking-[0.14em] text-muted border-b border-line"><th className="py-2.5 pl-4 pr-3 font-semibold">Owner</th><th className="pr-3 font-semibold">Property · unit</th><th className="pr-3 font-semibold">Where it stands</th><th className="pr-3 font-semibold text-right">Need</th><th className="pr-3 font-semibold">Paperwork</th><th className="pr-4 font-semibold text-right">Updated</th></tr></thead>
            <tbody>{shown.map(l => (
              <tr key={l.code} onClick={() => { window.location.href = '/owner-onboarding/' + l.code }} className="border-b border-line last:border-0 cursor-pointer hover:bg-app">
                <td className="py-2.5 pl-4 pr-3 font-semibold text-ink">{l.ownerName || '—'}{l.archived ? <span className="ml-1 text-[11px] text-muted">(archived)</span> : null}</td>
                <td className="pr-3 text-ink">{[l.property, l.unitLabel].filter(Boolean).join(' · ') || <span className="text-muted">—</span>}{(l.units || 0) > 1 ? <span className="ml-1 text-[11px] text-muted">{l.units} units</span> : null}{l.listingId ? <span className="ml-1 text-[10.5px] text-emerald-700 font-semibold">GUESTY</span> : null}</td>
                <td className="pr-3"><span className="flex items-center gap-1" title={OO_STEPS.map((s, i) => s.label + ': ' + ({ d: 'done', g: 'in progress', t: 'to do' } as Any)[(l.steps || '')[i] || 't']).join('\n')}>{OO_STEPS.map((s, i) => { const c = (l.steps || '')[i] || 't'; return <i key={s.key} className={'inline-block w-4 h-1.5 rounded-full ' + (c === 'd' ? 'bg-emerald-600' : c === 'g' ? 'bg-[#8C6D3A]' : 'bg-line')} /> })}</span><span className="block text-[12px] text-ink mt-1">{l.stage}{l.callAt ? <span className="text-muted"> · call {new Date(l.callAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span> : null}</span></td>
                <td className="pr-3 text-right tabular-nums">{l.need || '—'}</td>
                <td className="pr-3 text-[12px]">{[l.agreement ? 'Agreement' : '', l.paperwork ? 'W-9 + ACH' : '', l.linen === 'sent' ? 'Linen sent' : l.linen === 'approved' ? 'Linen approved' : ''].filter(Boolean).join(' · ') || <span className="text-muted">None yet</span>}</td>
                <td className="pr-4 text-right text-[12px] text-muted whitespace-nowrap">{new Date(l.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
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
  useEffect(() => { if (open && !s) fetch('/api/owner-onboarding/settings').then(r => r.json()).then(d => d?.ok && setS({ to: d.settings.to.join(', '), cc: d.settings.cc.join(', '), replyTo: d.settings.replyTo, vendorTo: (d.settings.vendorTo || []).join(', '), vendorCc: (d.settings.vendorCc || []).join(', ') })).catch(() => {}) }, [open, s])
  return (
    <section className="mt-6 rounded-2xl border border-line bg-white">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full text-left px-4 py-3 text-[13.5px] font-semibold text-ink">Handoff and vendor emails {open ? '▾' : '▸'} <span className="font-normal text-muted text-[12.5px]">· who gets the paperwork handoff and the linen quote</span></button>
      {open && s ? (
        <div className="px-4 pb-4 grid gap-3 sm:grid-cols-3">
          <label className="block"><span className={lab}>To</span><input value={s.to} onChange={e => setS({ ...s, to: e.target.value })} className={field} /></label>
          <label className="block"><span className={lab}>Copy</span><input value={s.cc} onChange={e => setS({ ...s, cc: e.target.value })} className={field} /></label>
          <label className="block"><span className={lab}>Sent from (a connected Google mailbox)</span><input value={s.replyTo} onChange={e => setS({ ...s, replyTo: e.target.value })} className={field} /></label>
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
          <p className="text-[13.5px] text-muted mt-2">{[rec.attach.property, rec.attach.unitLabel ? 'Unit ' + rec.attach.unitLabel : '', rec.custom.ownerEmail, rec.custom.ownerPhone].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="oo-noprint flex flex-wrap gap-2">
          <CopyBtn text={ownerLink(code)} label="Copy owner link" />
          <CopyBtn text={origin() + '/owner-onboarding/' + code} label="Copy team link" />
          <a href={'/join/' + code} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-[13px] font-semibold text-ink"><ExternalLink size={13} /> Owner view</a>
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-[13px] font-semibold text-ink"><Printer size={13} /> Print</button>
        </div>
      </header>
      {msg ? <p className="oo-noprint text-[12.5px] text-muted -mt-3 mb-3">{msg}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6 min-w-0">
          {/* the units */}
          <section className={card}>
            <div className="flex items-center gap-2 mb-3"><h2 className="font-serif text-[22px] leading-none text-ink mr-auto">{units.length > 1 ? units.length + ' units' : 'The home'}</h2>
              <button type="button" onClick={() => { const list = [...units, { ...DEFAULT_HOME, address: units[0]?.address || '' }]; setRec({ ...rec, home: list[0], more: list.slice(1) }); setEditHome(true); setEu(list.length - 1) }} className="oo-noprint text-[12.5px] font-semibold text-ink">+ Add a unit</button></div>
            {!units.length ? <p className="text-[13px] text-muted">The owner has not filled in the home yet. Use “Add a unit” to fill it in for them.</p> : units.map((u, i) => (
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
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-3"><h2 className="font-serif text-[22px] leading-none text-ink mr-auto">Supplies</h2><span className="text-[13px]"><b className="text-ink">{have.length}</b> have · <b className="text-[#B4532A]">{need.length}</b> need · <b className="text-ink">{open.length}</b> not checked</span></div>
            {!sup.length ? <p className="text-[13px] text-muted">The list appears once the home is filled in.</p> : (<>
              {needRoll.length ? (
                <div className="rounded-xl bg-[#FBF1EC] p-3 mb-4"><p className={lab + ' text-[#B4532A]'}>To buy{units.length > 1 ? ' · all ' + units.length + ' units' : ''} · what the owner marked Need</p>
                  <div className="overflow-x-auto"><table className="w-full text-[13px] mt-2"><thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted"><th className="py-1 font-semibold">Item</th>{units.length > 1 ? units.map((_, i) => <th key={i} className="py-1 px-2 text-right font-semibold whitespace-nowrap">{uLabel(i)}</th>) : null}<th className="py-1 text-right font-semibold">Total</th></tr></thead>
                    <tbody>{needRoll.map(e => <tr key={e.name + e.size} className="border-t border-[#F0DCD2]"><td className="py-1 text-ink">{e.name}{e.size ? <span className="text-muted"> · {e.size}</span> : null}</td>{units.length > 1 ? units.map((_, i) => <td key={i} className="py-1 px-2 text-right tabular-nums">{e.per[i] || ''}</td>) : null}<td className="py-1 text-right tabular-nums font-semibold">{e.total}</td></tr>)}</tbody></table></div>
                </div>
              ) : null}
              {units.map((_, ui) => { const mine = sup.filter(i => i.unit === ui); const gs = Array.from(new Set(mine.map(i => i.group))); return (
                <details key={ui} className="mb-1"><summary className="cursor-pointer text-[13px] font-semibold text-ink py-1">{units.length > 1 ? uLabel(ui) + ': the whole list' : 'The whole list, by set'} <span className="font-normal text-muted">· {mine.filter(i => rec.marks[i.key] === 'need').length} need, {mine.filter(i => !rec.marks[i.key]).length} not checked</span></summary>
                  <div className="mt-3 columns-1 md:columns-2 gap-6">{gs.map(g => (
                    <div key={g} className="break-inside-avoid mb-4"><p className={lab}>{g}</p><ul className="text-[12.5px]">{mine.filter(i => i.group === g).map(i => <li key={i.key} className="flex justify-between gap-2 py-1 border-b border-line"><span className="text-ink">{i.name} <span className="text-muted">×{i.qty}</span></span><span className={rec.marks[i.key] === 'have' ? 'text-emerald-700 font-semibold' : rec.marks[i.key] === 'need' ? 'text-[#B4532A] font-semibold' : 'text-muted'}>{rec.marks[i.key] === 'have' ? 'Have' : rec.marks[i.key] === 'need' ? 'Need' : '—'}</span></li>)}</ul></div>
                  ))}</div>
                </details>) })}
            </>)}
            {rec.ownerNotes ? <div className="mt-4 rounded-xl bg-app p-3"><p className={lab}>The owner’s note</p><p className="text-[13.5px] text-ink mt-1 whitespace-pre-wrap">{rec.ownerNotes}</p></div> : null}
          </section>

          <OrderList rec={rec} units={units.map((_, i) => uLabel(i))} onRec={setRec} />

          {/* THE LINEN, ours to specify (Jon, 2026-11-13): counts at par, per unit and in all; approve, then send to the vendor */}
          <section className={card}>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-1"><h2 className="font-serif text-[22px] leading-none text-ink mr-auto">Linen at par</h2><span className="text-[13px]"><b className="text-ink">{lin.reduce((a, i) => a + i.qty, 0)}</b> pieces{units.length > 1 ? ' across ' + units.length + ' units' : ''}</span></div>
            <p className="text-[12.5px] text-muted mb-3">For the team only: the owner’s page never lists linen. {rec.linen?.rows ? <b className="text-ink">Edited by {String(rec.linen.editedBy || 'the team').split('@')[0]}{rec.linen.editedAt ? ' on ' + new Date(rec.linen.editedAt).toLocaleDateString() : ''}; it no longer follows the home’s beds and baths.</b> : 'From the linen standard and each unit’s beds and baths.'}</p>
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
              <div className="oo-noprint mt-3 flex flex-wrap items-center gap-2">
                {!rec.linen?.approvedAt ? <button type="button" onClick={() => linen('approve')} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold"><Check size={13} /> Approve the linen quote</button>
                  : <><span className="text-[12.5px] text-emerald-700 font-semibold"><Check size={13} className="inline" /> Approved {new Date(rec.linen.approvedAt).toLocaleDateString()} by {String(rec.linen.approvedBy || '').split('@')[0]}</span>
                    <button type="button" disabled={busy === 'linen'} onClick={() => linen('send')} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold disabled:opacity-50">{busy === 'linen' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {rec.linen.sentAt ? 'Send to the vendor again' : 'Send to the vendor'}</button>
                    <button type="button" onClick={() => linen('unapprove')} className="text-[12.5px] text-muted underline">Undo approval</button></>}
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
                  <p className="text-[13px] text-ink">{rec.payout.ach.bank} {rec.payout.ach.accountType} {rec.payout.ach.accountHint}</p>
                  <p className="text-[11.5px] text-muted">Signed by {rec.payout.sign.name}, {new Date(rec.payout.sign.at).toLocaleDateString()}</p>
                  <div className="oo-noprint flex flex-wrap gap-2 mt-2"><a href={`/api/owner-onboarding/${code}/forms?doc=w9`} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3 py-1.5 text-[12.5px] font-semibold"><Download size={12} /> W-9</a><a href={`/api/owner-onboarding/${code}/forms?doc=ach`} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3 py-1.5 text-[12.5px] font-semibold"><Download size={12} /> ACH form</a></div>
                  <p className="text-[11px] text-muted mt-1">Filled on download, for full access only. Never emailed.</p>
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

          <div className="oo-noprint space-y-6"><InviteOwner rec={rec} onRec={setRec} /><IntroEmail rec={rec} /></div>
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
