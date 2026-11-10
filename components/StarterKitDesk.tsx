'use client'
// STARTER KITS — the team desk (Jon, 2026-11-10). One link per prospective owner or client: their
// name, the home's size, an optional note and setup fee. The client opens /kit/<code>, a finished
// report sized to the home, makes their choices and presses Send to Stay. This table shows who
// opened it, what they sent back and the total.
import { useEffect, useMemo, useState } from 'react'
import { Check, ClipboardList, Copy, Download, ExternalLink, Loader2, Lock, Plus, RotateCcw, Search, X, Package } from 'lucide-react'
import { LeanHead, Pill, Tag } from '@/components/lean'
import { APPLIANCES, DEFAULT_SIZE, SIZE_LIMITS, describeSize, fmtMoney, kitTotals, type KitCount, type KitLink, type KitSize } from '@/lib/starter-kit'

const BTN = 'inline-flex items-center gap-1.5 rounded-xl font-bold text-[13px] min-h-[38px] px-3.5 disabled:opacity-50'
const INPUT = 'rounded-xl border border-line bg-white px-3 py-2.5 text-[14px] text-ink font-normal focus:outline-none focus:border-ink'
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')
const SIZE_LABEL: Record<KitCount, string> = { bedrooms: 'Bedrooms', bathrooms: 'Bathrooms', guests: 'Max guests' }

function Stepper({ k, v, set }: { k: KitCount; v: number; set: (n: number) => void }) {
  const [lo, hi] = SIZE_LIMITS[k]
  return (
    <div className="grid gap-1 text-[12px] font-semibold text-muted">{SIZE_LABEL[k]}
      <div className="flex items-center rounded-xl border border-line bg-white overflow-hidden">
        <button type="button" aria-label={'Fewer ' + SIZE_LABEL[k]} onClick={() => set(Math.max(lo, v - 1))} className="w-9 h-10 text-lg text-ink hover:bg-app">−</button>
        <input aria-label={SIZE_LABEL[k]} type="number" value={v} min={lo} max={hi} onChange={e => set(Math.max(lo, Math.min(hi, Math.round(+e.target.value) || lo)))}
          className="w-full min-w-0 text-center text-[15px] font-bold text-ink bg-transparent focus:outline-none tabular-nums" />
        <button type="button" aria-label={'More ' + SIZE_LABEL[k]} onClick={() => set(Math.min(hi, v + 1))} className="w-9 h-10 text-lg text-ink hover:bg-app">+</button>
      </div>
    </div>
  )
}

export function StarterKitDesk() {
  const [links, setLinks] = useState<KitLink[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [showOff, setShowOff] = useState(false)
  const [copied, setCopied] = useState('')
  // the new-link form
  const [client, setClient] = useState('')
  const [property, setProperty] = useState('')
  const [message, setMessage] = useState('')
  const [preparedBy, setPreparedBy] = useState('')
  const [setupFee, setSetupFee] = useState('')
  const [size, setSize] = useState<KitSize>({ ...DEFAULT_SIZE })
  const [sizeLocked, setSizeLocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState('')

  const load = async () => {
    try {
      const j = await fetch('/api/onboard/kits', { cache: 'no-store' }).then(r => r.json())
      if (!j.ok) throw new Error(j.error || 'Could not load the starter kits.')
      setLinks(j.links || []); setErr('')
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const url = (code: string, page = '') => `${typeof window !== 'undefined' ? window.location.origin : ''}/kit/${code}${page ? '/' + page : ''}`
  const copy = async (code: string, page = '') => { try { await navigator.clipboard.writeText(url(code, page)); setCopied(code + page); setTimeout(() => setCopied(''), 1800) } catch { window.prompt('Copy this link', url(code, page)) } }
  const preview = useMemo(() => kitTotals(size, { inc: {}, qty: {}, own: {}, pick: {}, self: {}, have: {} }), [size])
  const shown = useMemo(() => links.filter(l => (showOff || !l.revokedAt) && (!q.trim() || (l.client + ' ' + l.property).toLowerCase().includes(q.trim().toLowerCase()))), [links, q, showOff])
  const stats = useMemo(() => ({ live: links.filter(l => !l.revokedAt).length, opened: links.filter(l => !l.revokedAt && l.views > 0 && !l.submitted).length, sent: links.filter(l => !l.revokedAt && l.submitted).length }), [links])

  const create = async () => {
    setFormErr('')
    if (!client.trim()) { setFormErr('Add the client or owner name.'); return }
    setBusy(true)
    const j = await fetch('/api/onboard/kits', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', client, property, message, preparedBy, setupFee, size, sizeLocked }) }).then(r => r.json()).catch(() => ({ ok: false, error: 'That did not save.' }))
    setBusy(false)
    if (!j.ok) { setFormErr(j.error || 'That did not save.'); return }
    copy(j.link.code)
    setOpen(false); setClient(''); setProperty(''); setMessage(''); setSetupFee(''); setSize({ ...DEFAULT_SIZE }); setSizeLocked(false)
    load()
  }
  const update = async (code: string, patch: any) => {
    await fetch('/api/onboard/kits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', code, ...patch }) }).catch(() => {})
    load()
  }

  return (
    <div>
      <LeanHead title="Starter kits" icon={<Package size={18} />} sub="A report for a prospective owner or client: everything we put in the home, sized to it, with their choices">
        <Pill title="Links that are on">{stats.live} live</Pill>
        <Pill tone="amber" title="Opened, nothing sent back yet">{stats.opened} opened</Pill>
        <Pill tone="emerald" title="The client pressed Send to Stay">{stats.sent} sent back</Pill>
        <a href="/onboarding" className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[12px] font-semibold text-ink hover:bg-app">Onboarding</a>
        <button type="button" onClick={async () => { const link = window.location.origin + '/kit/list'; try { await navigator.clipboard.writeText(link); setCopied('calc'); setTimeout(() => setCopied(''), 1800) } catch { window.prompt('Copy this link', link) } }}
          title="The need list calculator: one link anyone can open, enter bedrooms, bathrooms, guests and the kitchen, and get every item the home needs with counts"
          className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[12px] font-semibold text-ink hover:bg-app">{copied === 'calc' ? <><Check size={13} /> Copied</> : <><ClipboardList size={13} /> Need list link</>}</button>
        <a href="/kit/list" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[12px] font-semibold text-ink hover:bg-app"><ExternalLink size={13} /> Open calculator</a>
        <button type="button" onClick={async () => { const link = window.location.origin + '/kit/linens'; try { await navigator.clipboard.writeText(link); setCopied('linen'); setTimeout(() => setCopied(''), 1800) } catch { window.prompt('Copy this link', link) } }}
          title="The linen calculator: one link anyone can open, no login or password, counted from the saved linen standard"
          className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[12px] font-semibold text-ink hover:bg-app">{copied === 'linen' ? <><Check size={13} /> Copied</> : <><ClipboardList size={13} /> Linen calculator link</>}</button>
        <button type="button" onClick={() => setOpen(o => !o)} className={BTN + ' bg-ink text-white lh-primary'}><Plus size={14} /> New starter kit</button>
      </LeanHead>

      {open && (
        <div className="rounded-2xl border border-line bg-white shadow-soft p-4 md:p-5 grid gap-4 max-w-4xl mb-5">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-[12px] font-semibold text-muted">Client or owner name
              <input value={client} onChange={e => setClient(e.target.value)} placeholder="e.g. Maria Alvarez" className={INPUT} /></label>
            <label className="grid gap-1 text-[12px] font-semibold text-muted">Property (optional)
              <input value={property} onChange={e => setProperty(e.target.value)} placeholder="e.g. 1450 Brickell Bay Dr, Unit 2104" className={INPUT} /></label>
          </div>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            {(Object.keys(SIZE_LIMITS) as KitCount[]).map(k => <Stepper key={k} k={k} v={size[k]} set={n => setSize(s => ({ ...s, [k]: n }))} />)}
            <div className="grid gap-1 text-[12px] font-semibold text-muted">Kitchen
              <div className="inline-flex rounded-xl border border-line p-0.5 w-fit h-[42px] items-center bg-white">
                {[true, false].map(v => <button key={String(v)} type="button" aria-pressed={size.kitchen === v} onClick={() => setSize(s => ({ ...s, kitchen: v }))}
                  className={'px-4 py-1.5 text-[13px] font-semibold rounded-lg ' + (size.kitchen === v ? 'bg-ink text-white' : 'text-muted')}>{v ? 'Yes' : 'No'}</button>)}
              </div>
            </div>
          </div>
          {size.kitchen && <div className="flex flex-wrap gap-x-4 gap-y-2 -mt-1">
            {APPLIANCES.map(a => <label key={a.k} className="inline-flex items-center gap-1.5 text-[13px] text-ink">
              <input type="checkbox" checked={size.appliances[a.k]} onChange={e => setSize(s => ({ ...s, appliances: { ...s.appliances, [a.k]: e.target.checked } }))} /> {a.label}</label>)}
          </div>}
          <label className="inline-flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" checked={sizeLocked} onChange={e => setSizeLocked(e.target.checked)} />
            Lock the size (the client cannot change bedrooms, baths, guests or kitchen)</label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-[12px] font-semibold text-muted">Setup, delivery and installation fee (optional)
              <input value={setupFee} onChange={e => setSetupFee(e.target.value)} inputMode="decimal" placeholder="Leave blank to leave it off the report" className={INPUT} /></label>
            <label className="grid gap-1 text-[12px] font-semibold text-muted">Prepared by
              <input value={preparedBy} onChange={e => setPreparedBy(e.target.value)} placeholder="Your name, as the client should see it" className={INPUT} /></label>
          </div>
          <label className="grid gap-1 text-[12px] font-semibold text-muted">Note to the client (optional)
            <textarea rows={3} value={message} onChange={e => setMessage(e.target.value)} placeholder="e.g. Great meeting you at the property. Here is everything we would set your home up with. Pick what you like and send it back." className={INPUT} /></label>
          <div className="rounded-xl bg-app px-3.5 py-2.5 text-[13px] text-ink">
            At this size: <b>{describeSize(size)}</b> · {preview.items} items · <b>{fmtMoney(preview.total)}</b> before any changes the client makes
          </div>
          {formErr && <div className="text-sm text-rose-700">{formErr}</div>}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={create} className={BTN + ' bg-ink text-white'}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />} Create and copy link</button>
            <button type="button" onClick={() => setOpen(false)} className={BTN + ' border border-line bg-white text-ink'}>Cancel</button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client or property" className="w-full rounded-lg border border-line bg-white pl-8 pr-3 py-1.5 text-[12.5px] focus:outline-none focus:border-ink" />
        </div>
        <label className="inline-flex items-center gap-1.5 text-[12.5px] text-muted"><input type="checkbox" checked={showOff} onChange={e => setShowOff(e.target.checked)} /> Show links that are off</label>
      </div>

      {err && <div className="text-sm text-rose-700 mb-3">{err}</div>}
      <div className="rounded-xl border border-line bg-white shadow-soft overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead><tr className="text-[11px] uppercase tracking-wider text-muted border-b border-line">
            <th className="text-left px-4 py-2">Client</th><th className="text-left px-3 py-2">Home</th><th className="text-left px-3 py-2">Status</th><th className="text-right px-3 py-2">Their total</th><th className="px-3 py-2" />
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-4 py-6 text-muted"><Loader2 size={14} className="inline animate-spin mr-1.5" />Loading…</td></tr>}
            {!loading && shown.map(l => {
              const t = kitTotals(l.size, l.selection)
              return (
                <tr key={l.code} className={'border-b border-line last:border-0 align-top ' + (l.revokedAt ? 'opacity-55' : '')}>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-ink">{l.client}</div>
                    <div className="text-[11.5px] text-muted">{l.property || 'No address'} · made {day(l.createdAt)}{l.preparedBy ? ' by ' + l.preparedBy : ''}</div>
                  </td>
                  <td className="px-3 py-2.5 text-[12.5px] text-ink whitespace-nowrap">{describeSize(l.size)}{l.sizeLocked && <Lock size={11} className="inline ml-1 text-muted" aria-label="Size locked" />}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {l.revokedAt ? <Tag>off</Tag>
                        : l.submitted ? <Tag tone="emerald" title={l.submitted.note || undefined}>sent {day(l.submitted.at)} by {l.submitted.name}</Tag>
                          : l.savedAt ? <Tag tone="sky">choosing · saved {day(l.savedAt)}</Tag>
                            : l.views ? <Tag tone="amber">opened {l.views}× · {day(l.lastView)}</Tag>
                              : <Tag>not opened</Tag>}
                      {t.ownLinks > 0 && <Tag tone="violet">{t.ownLinks} own link{t.ownLinks === 1 ? '' : 's'}</Tag>}
                      {t.selfSupplied > 0 && <Tag tone="violet">{t.selfSupplied} they provide</Tag>}
                    </div>
                    {l.submitted?.email && <div className="text-[11.5px] text-muted mt-1 select-all">{l.submitted.email}</div>}
                    {l.submitted?.note && <div className="text-[12px] text-ink mt-1 max-w-sm">“{l.submitted.note}”</div>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <div className="font-semibold text-ink">{fmtMoney(t.total)}</div>
                    <div className="text-[11.5px] text-muted">{t.items} items{l.setupFee ? ' + ' + fmtMoney(l.setupFee, false) + ' setup' : ''}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {!l.revokedAt && <button type="button" onClick={() => copy(l.code)} className="text-[12px] font-semibold text-ink border border-line rounded-lg px-2.5 py-1 hover:border-ink inline-flex items-center gap-1">{copied === l.code ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy link</>}</button>}
                    {!l.revokedAt && <button type="button" onClick={() => copy(l.code, 'order')} title="Copy the order form link: each item, must-have or recommended, and how many the home needs — like the linen calculator" className="ml-1.5 text-[12px] font-semibold text-ink border border-line rounded-lg px-2.5 py-1 hover:border-ink inline-flex items-center gap-1">{copied === l.code + 'order' ? <><Check size={12} /> Copied</> : <><ClipboardList size={12} /> Order form</>}</button>}
                    {!l.revokedAt && <a href={`/kit/${l.code}`} target="_blank" rel="noopener noreferrer" className="ml-1.5 text-[12px] font-semibold text-ink border border-line rounded-lg px-2.5 py-1 hover:border-ink inline-flex items-center gap-1"><ExternalLink size={12} /> Open</a>}
                    {!l.revokedAt && <a href={`/api/public/starter-kit/${l.code}/pdf`} title="Download their report as a PDF" className="ml-1.5 text-[12px] font-semibold text-ink border border-line rounded-lg px-2.5 py-1 hover:border-ink inline-flex items-center gap-1"><Download size={12} /> PDF</a>}
                    {l.revokedAt
                      ? <button type="button" onClick={() => update(l.code, { revoke: false })} className="ml-1.5 text-[12px] font-semibold text-ink border border-line rounded-lg px-2.5 py-1 hover:border-ink inline-flex items-center gap-1"><RotateCcw size={12} /> Turn on</button>
                      : <button type="button" onClick={() => { if (window.confirm(`Turn off ${l.client}'s link? They will no longer be able to open it. Their choices stay here.`)) update(l.code, { revoke: true }) }} aria-label="Turn link off" title="Turn link off" className="ml-1.5 text-muted hover:text-rose-700 align-middle"><X size={16} /></button>}
                  </td>
                </tr>
              )
            })}
            {!loading && !shown.length && <tr><td colSpan={5} className="px-4 py-8 text-sm text-muted">No starter kits yet. Press <b>New starter kit</b>, enter the client and the home’s size, and send them the link.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
