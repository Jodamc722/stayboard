'use client'
// OWNER EMAILS (lib/owner-mail; Jon, 2026-11-21: "a BCC line that communicates with Lighthouse … link
// convos to owners … when we respond to owner we can see it in Lighthouse").
// BCC the Lighthouse address on an owner email; the whole conversation, the owner's replies included,
// shows here, matched to the owner.
import { useEffect, useMemo, useState } from 'react'
import { Copy, ExternalLink, Loader2, Paperclip, RefreshCw, Search } from 'lucide-react'
import { LeanEmpty } from '@/components/lean'

type Person = { name: string; email: string }
type Msg = { id: string; from: Person; to: Person[]; cc: Person[]; at: string; snippet: string; fromUs: boolean }
type Thread = { id: string; subject: string; lastAt: string; count: number; others: Person[]; owners: { id: string; name: string }[]; lastFromUs: boolean; messages: Msg[]; gmailUrl: string }

const when = (iso: string) => { const d = new Date(iso); const days = (Date.now() - d.getTime()) / 864e5; return d.toLocaleString('en-US', days < 1 ? { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' } : { month: 'short', day: 'numeric', ...(days > 300 ? { year: 'numeric' } : {}), timeZone: 'America/New_York' } as any) }

export function OwnerMail() {
  const [data, setData] = useState<{ threads: Thread[]; bcc: string; mailbox: string; error?: string } | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [owner, setOwner] = useState(''); const [q, setQ] = useState('')
  const [open, setOpen] = useState(''); const [bodies, setBodies] = useState<Record<string, { body: string; attachments: number }[] | 'loading' | 'error'>>({})
  const [copied, setCopied] = useState(false)
  const load = (fresh = false) => {
    setBusy(true); setErr('')
    fetch('/api/owner-mail' + (fresh ? '?fresh=1' : ''), { cache: 'no-store' }).then(r => r.json()).then(j => { if (j?.ok) setData(j); else setErr(j?.error || 'Could not read the owner emails.') }).catch(() => setErr('Could not read the owner emails.')).finally(() => setBusy(false))
  }
  useEffect(() => { load() }, [])
  const openThread = (id: string) => {
    setOpen(o => (o === id ? '' : id))
    if (bodies[id] && bodies[id] !== 'error') return
    setBodies(b => ({ ...b, [id]: 'loading' }))
    fetch('/api/owner-mail?thread=' + encodeURIComponent(id), { cache: 'no-store' }).then(r => r.json()).then(j => setBodies(b => ({ ...b, [id]: j?.ok ? j.bodies : 'error' }))).catch(() => setBodies(b => ({ ...b, [id]: 'error' })))
  }
  const owners = useMemo(() => { const m = new Map<string, string>(); for (const t of data?.threads || []) for (const o of t.owners) m.set(o.id, o.name); return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1])) }, [data])
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (data?.threads || []).filter(t => (!owner || (owner === '_none' ? !t.owners.length : t.owners.some(o => o.id === owner)))
      && (!s || (t.subject + ' ' + t.others.map(p => p.name + ' ' + p.email).join(' ') + ' ' + t.owners.map(o => o.name).join(' ') + ' ' + t.messages.map(m => m.snippet).join(' ')).toLowerCase().includes(s)))
  }, [data, owner, q])
  const copy = () => { const a = data?.bcc || ''; try { navigator.clipboard.writeText(a).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) } catch { /* the address is on screen to select */ } }
  const sel = 'rounded-lg border border-line bg-white px-2 py-1.5 text-[12.5px] text-ink'

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-white p-3 text-[12.5px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">BCC Lighthouse</span>
          <code className="rounded-md bg-app px-2 py-1 font-mono text-[12.5px] text-ink select-all">{data?.bcc || 'jon+lighthouse@stay-hospitality.com'}</code>
          <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 font-semibold text-ink"><Copy size={12} /> {copied ? 'Copied' : 'Copy'}</button>
          <button type="button" onClick={() => load(true)} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 font-semibold text-ink" title="Check Gmail again now">{busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh</button>
        </div>
        <p className="mt-1.5 text-muted">Add this address as BCC on any email to an owner. The whole conversation shows here, matched to the owner, and so do the owner’s replies and everything after it in that thread, with no need to BCC again. Replies that go to a mailbox other than {data?.mailbox || 'jon@'} show up only if that reply is BCC’d too.</p>
      </div>
      {err ? <LeanEmpty>{err}</LeanEmpty> : !data ? <LeanEmpty>Reading the owner emails…</LeanEmpty> : data.error ? <LeanEmpty>{data.error}</LeanEmpty> : <>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <select value={owner} onChange={e => setOwner(e.target.value)} aria-label="Owner" className={sel + ' max-w-[240px]'}>
            <option value="">All owners</option>{owners.map(([id, n]) => <option key={id} value={id}>{n}</option>)}<option value="_none">Not matched to an owner</option>
          </select>
          <div className="relative"><Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Find…" aria-label="Find a conversation" className="w-56 max-w-full rounded-lg border border-line bg-white pl-7 pr-2 py-1.5" /></div>
          <span className="ml-auto text-[11.5px] text-muted">{rows.length} of {data.threads.length} conversations</span>
        </div>
        {rows.length === 0 ? <LeanEmpty>{data.threads.length ? 'Nothing matches.' : 'No conversations yet. BCC the address above on your next owner email and it will show here within a few minutes.'}</LeanEmpty> : (
          <div className="rounded-2xl border border-line bg-white divide-y divide-line">
            {rows.map(t => { const last = t.messages[t.messages.length - 1]; const b = bodies[t.id]; return (
              <div key={t.id}>
                <button type="button" onClick={() => openThread(t.id)} className="w-full px-4 py-2.5 text-left hover:bg-app/60">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-semibold text-ink text-[13px]">{t.owners.length ? t.owners.map(o => o.name).join(', ') : t.others.map(p => p.name).slice(0, 2).join(', ') || 'Internal'}</span>
                    {!t.owners.length && t.others.length ? <span className="rounded-full bg-amber-50 px-1.5 text-[10.5px] font-semibold text-amber-800">not matched to an owner</span> : null}
                    <span className={'rounded-full px-1.5 text-[10.5px] font-semibold ' + (t.lastFromUs ? 'bg-app text-muted' : 'bg-emerald-50 text-emerald-800')}>{t.lastFromUs ? 'Waiting on them' : 'They replied'}</span>
                    <span className="ml-auto text-[11.5px] text-muted tabular-nums">{t.count > 1 ? t.count + ' · ' : ''}{when(t.lastAt)}</span>
                  </div>
                  <div className="text-[12.5px] text-ink truncate">{t.subject}</div>
                  <div className="text-[12px] text-muted truncate">{last.fromUs ? 'Us: ' : last.from.name + ': '}{last.snippet}</div>
                </button>
                {open === t.id ? (
                  <div className="space-y-2 bg-app/40 px-4 pb-3 pt-1">
                    {t.messages.map((m, i) => { const full = Array.isArray(b) ? b[i] : null; return (
                      <div key={m.id} className={'rounded-xl border px-3 py-2 ' + (m.fromUs ? 'border-line bg-white' : 'border-emerald-200 bg-emerald-50/50')}>
                        <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted"><b className="text-ink">{m.from.name}</b><span>{m.from.email}</span><span>to {[...m.to, ...m.cc].map(p => p.name).join(', ')}</span>{full?.attachments ? <span className="inline-flex items-center gap-0.5"><Paperclip size={11} />{full.attachments}</span> : null}<span className="ml-auto tabular-nums">{new Date(m.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}</span></div>
                        <div className="mt-1 whitespace-pre-wrap break-words text-[12.5px] text-ink">{b === 'loading' ? m.snippet + ' …' : full ? (full.body || m.snippet) : m.snippet}</div>
                      </div>) })}
                    {b === 'error' ? <p className="text-[12px] text-rose-700">Could not load the full text; showing the previews.</p> : null}
                    <a href={t.gmailUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink underline">Open in Gmail to reply <ExternalLink size={11} /></a>
                  </div>
                ) : null}
              </div>) })}
          </div>
        )}
      </>}
    </div>
  )
}
