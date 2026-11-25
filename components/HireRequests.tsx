'use client'
// NEW HIRE FORMS — the manager's side, on Training → People (Jon, 2026-11-25: "a shareable link… only
// sent after hiring… then it will go for approval, then when approved will get access to their portal…
// invite will be sent").
//
//   THE LINK        one link to send to someone who has been hired. Copy it; make a new one if it got
//                   out (the old one stops working).
//   WAITING         what people sent, oldest first. Approve is the one button: it shows what will happen
//                   (the job and the area, each a row of buttons to correct) and then makes their
//                   record, assigns their training and emails the invite to their page.
//   DECIDED         the last few, with whether the invite went out.
// Nothing about a person exists in Training until Approve is pressed.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Check, Copy, Link2, RefreshCw, X, Mail, UserPlus } from 'lucide-react'
import { Tag, LeanPick } from '@/components/lean'
import { HIRE_TRACKS, HIRE_MARKETS, type HireRequest } from '@/lib/hire-rules'

type Data = { link: { code: string; url: string; codeAt: string }; pending: HireRequest[]; decided: HireRequest[] }
const BTN = 'inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-line bg-white text-[12.5px] font-semibold text-ink hover:bg-app disabled:opacity-40 whitespace-nowrap'
const BTN_OK = 'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-emerald-600 text-white text-[12.5px] font-semibold disabled:opacity-40 whitespace-nowrap'
const LABEL = 'text-[10.5px] font-bold uppercase tracking-wider text-muted'
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const day = (ymd: string | null) => ymd ? new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
const jobOf = (k: string) => HIRE_TRACKS.find(t => t.key === k)?.en || k

async function post(body: Record<string, any>) {
  const r = await fetch('/api/training/hire', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j?.ok === false) throw new Error(j?.error || `That did not save (${r.status}).`)
  return j
}

export function HireRequests({ say, onChanged, onOpen }: { say: (m: string) => void; onChanged: () => void; onOpen?: (personKey: string) => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState(false)
  const [sure, setSure] = useState('')                 // 'rotate' | 'decline:<id>'
  const [open, setOpen] = useState('')                 // the form being approved
  const [edit, setEdit] = useState<Record<string, { track?: string; market?: string }>>({})

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/training/hire', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j); setErr('')
    } catch (e: any) { setErr(e?.message || String(e)) }
  }, [])
  useEffect(() => { load() }, [load])

  const copy = async () => {
    if (!data) return
    try { await navigator.clipboard.writeText(data.link.url); setCopied(true); window.setTimeout(() => setCopied(false), 2500) } catch { setErr('Could not copy. Select the link and copy it by hand.') }
  }
  const rotate = async () => {
    setBusy('rotate'); setErr(''); setSure('')
    try { const j = await post({ action: 'rotate' }); setData(d => (d ? { ...d, link: j.link } : d)); say('New hire link made. The old one no longer works.') } catch (e: any) { setErr(e?.message || String(e)) }
    setBusy('')
  }
  const approve = async (r: HireRequest) => {
    setBusy(r.id); setErr('')
    try {
      const j = await post({ action: 'approve', id: r.id, ...(edit[r.id] || {}) })
      say(`${r.name} is approved. ${j.emailed ? 'The invite to their page was emailed' : j.emailError ? 'The invite did NOT send: ' + j.emailError : 'No invite was sent'}${j.assigned ? `, ${j.assigned} training item${j.assigned === 1 ? '' : 's'} assigned` : ''}.${j.note ? ' ' + j.note : ''}`)
      setOpen(''); await load(); onChanged()
    } catch (e: any) { setErr(e?.message || String(e)) }
    setBusy('')
  }
  const decline = async (r: HireRequest) => {
    setBusy(r.id); setErr(''); setSure('')
    try { await post({ action: 'decline', id: r.id }); say(`${r.name}'s form was declined. Nothing was sent to them.`); await load() } catch (e: any) { setErr(e?.message || String(e)) }
    setBusy('')
  }

  if (!data) return err ? <div className="rounded-2xl border border-line bg-white px-3 py-2.5 mb-3 text-[12.5px] text-rose-700">New hire forms could not be read: {err} <button onClick={load} className="underline text-ink ml-1">Try again</button></div> : null
  const n = data.pending.length
  return (
    <section className="rounded-2xl border border-line bg-white mb-4">
      <div className="px-3 sm:px-4 py-3 flex items-center gap-2 flex-wrap">
        <UserPlus size={16} className="text-muted shrink-0" />
        <div className="min-w-0 flex-1 basis-56">
          <div className="text-[13.5px] font-bold text-ink">New hire form {n > 0 && <span className="ml-1 align-middle"><Tag tone="amber">{n} to approve</Tag></span>}</div>
          <div className="text-[12px] text-muted">Send this link after hiring. They fill it in, you approve, and the invite to their page is emailed.</div>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 text-[12px] text-muted min-w-0 max-w-[22rem]"><Link2 size={13} className="shrink-0" /><span className="truncate select-all">{data.link.url}</span></span>
        <button onClick={copy} className={BTN}>{copied ? <><Check size={13} className="text-emerald-600" /> Copied</> : <><Copy size={13} /> Copy link</>}</button>
        {sure === 'rotate'
          ? <><button onClick={rotate} disabled={busy === 'rotate'} className={BTN + ' !bg-ink !text-white !border-ink'}>{busy === 'rotate' ? <Loader2 size={13} className="animate-spin" /> : null} Yes, new link</button><button onClick={() => setSure('')} className={BTN}>Keep it</button></>
          : <button onClick={() => setSure('rotate')} title="Make a new link. The current one stops working, so anyone who has it can no longer send the form." className={BTN + ' text-muted'}><RefreshCw size={13} /> New link</button>}
      </div>
      {err ? <div className="px-3 sm:px-4 pb-2 text-[12.5px] text-rose-700">{err}</div> : null}

      {n > 0 && (
        <div className="border-t border-line">
          {data.pending.map(r => {
            const e = edit[r.id] || {}, track = e.track || r.track, market = e.market || r.market, o = open === r.id
            return (
              <div key={r.id} className="border-b border-line/70 last:border-b-0 px-3 sm:px-4 py-2.5">
                <div className="flex items-start gap-2 flex-wrap">
                  <div className="min-w-0 flex-1 basis-64">
                    <div className="text-[13.5px] font-semibold text-ink break-words">{r.name}</div>
                    <div className="text-[12px] text-muted break-words">{[jobOf(r.track), r.market, r.lang === 'es' ? 'Español' : 'English', r.startDate ? 'starts ' + day(r.startDate) : 'no start date'].join(' · ')}</div>
                    <div className="text-[12px] text-ink/80 break-words">{r.email} · {r.phone}</div>
                    {(r.emergencyName || r.emergencyPhone) && <div className="text-[12px] text-muted break-words">Emergency: {[r.emergencyName, r.emergencyPhone].filter(Boolean).join(' · ')}</div>}
                    {r.note && <div className="text-[12px] text-ink/80 break-words mt-0.5">“{r.note}”</div>}
                  </div>
                  <span className="text-[11.5px] text-muted whitespace-nowrap pt-0.5">sent {when(r.at)}</span>
                  <div className="flex items-center gap-1.5">
                    {!o && <button onClick={() => { setOpen(r.id); setSure('') }} className={BTN_OK}><Check size={13} /> Approve</button>}
                    {sure === 'decline:' + r.id
                      ? <><button onClick={() => decline(r)} disabled={busy === r.id} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-rose-600 text-white text-[12.5px] font-semibold">Yes, decline</button><button onClick={() => setSure('')} className={BTN}>Keep</button></>
                      : <button onClick={() => { setSure('decline:' + r.id); setOpen('') }} className={BTN + ' text-muted'}><X size={13} /> Decline</button>}
                  </div>
                </div>
                {o && (
                  <div className="mt-2.5 rounded-xl bg-app/60 p-3 space-y-2.5">
                    <div className="flex items-center gap-2 flex-wrap"><span className={LABEL + ' w-16'}>Job</span><LeanPick value={track} size="md" onPick={v => setEdit(x => ({ ...x, [r.id]: { ...(x[r.id] || {}), track: v } }))} options={HIRE_TRACKS.map(t => ({ v: t.key as string, label: t.en }))} /></div>
                    <div className="flex items-center gap-2 flex-wrap"><span className={LABEL + ' w-16'}>Area</span><LeanPick value={market} size="md" onPick={v => setEdit(x => ({ ...x, [r.id]: { ...(x[r.id] || {}), market: v } }))} options={HIRE_MARKETS.map(m => ({ v: m as string, label: m }))} /></div>
                    <div className="text-[12px] text-muted">Approving makes {r.name.split(' ')[0]}'s record, assigns the {jobOf(track).toLowerCase()} training and emails the invite to <b className="text-ink">{r.email}</b>.</div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button onClick={() => approve(r)} disabled={busy === r.id} className={BTN_OK}>{busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} Approve and send the invite</button>
                      <button onClick={() => setOpen('')} className={BTN}>Not yet</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {data.decided.length > 0 && (
        <div className="border-t border-line px-3 sm:px-4 py-2.5">
          <div className={LABEL + ' mb-1.5'}>Decided lately</div>
          <div className="space-y-1">
            {data.decided.slice(0, 6).map(r => (
              <div key={r.id} className="flex items-center gap-2 flex-wrap text-[12.5px]">
                {r.status === 'approved' && r.personKey && onOpen ? <button onClick={() => onOpen(r.personKey!)} className="font-semibold text-ink underline">{r.name}</button> : <span className="font-semibold text-ink">{r.name}</span>}
                <span className="text-muted">{jobOf(r.track)} · {r.market}</span>
                {r.status === 'approved' ? <Tag tone="emerald">Approved</Tag> : <Tag>Declined</Tag>}
                {r.status === 'approved' && (r.invite === 'sent' ? <Tag>Invite emailed</Tag> : r.invite === 'failed' ? <Tag tone="rose" title={r.inviteError}>Invite not sent</Tag> : null)}
                <span className="text-muted text-[11.5px]">{r.decidedBy ? 'by ' + r.decidedBy.split('@')[0].split(' ')[0] + ' · ' : ''}{r.decidedAt ? when(r.decidedAt) : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
