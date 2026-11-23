'use client'
// EMAIL REVIEW (Jon, 2026-11-23; lib/mail-review). The address to forward an email to, the switch,
// and what came in lately. Shown on My account to admins only: the API answers nobody else, and
// then this draws nothing.
import { useEffect, useState } from 'react'
import { Mail, Copy, Check, RefreshCw, Loader2, AlertTriangle } from 'lucide-react'

export function MailReview() {
  const [m, setM] = useState<any>(null)
  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState('')
  const load = () => fetch('/api/mail-review', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => { if (j?.ok) setM(j) }).catch(() => {})
  useEffect(() => { load() }, [])
  if (!m) return null
  const post = async (op: string, id?: string) => {
    setBusy(id ? op + id : op); setMsg('')
    const j = await fetch('/api/mail-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, id }) }).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }))
    setBusy('')
    if (op === 'scan' || op === 'redo') { const n = (j.handled || []).filter((h: any) => h.replied).length; setMsg(j.error ? j.error : j.note ? 'Not run: ' + j.note + '.' : n ? `Reviewed ${n} email${n === 1 ? '' : 's'}. The answer is in your inbox.` : 'Nothing new in the mailbox.') }
    else if (!j.ok) setMsg(j.error || 'That did not save.')
    load()
  }
  const copy = () => { try { navigator.clipboard.writeText(m.address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {}) } catch {} }
  const when = (s?: string | null) => s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : ''
  const seg = (on: boolean) => 'px-2.5 h-8 text-[12px] font-semibold ' + (on ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink')
  const btn = 'h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold text-ink inline-flex items-center gap-1.5 hover:bg-app disabled:opacity-50'
  return (
    <section className="rounded-2xl border border-line bg-white mt-6">
      <div className="px-4 py-3 flex items-center gap-x-3 gap-y-2 flex-wrap">
        <Mail size={16} className="text-muted shrink-0" />
        <div className="flex-1 min-w-[240px]">
          <div className="text-[13.5px] font-semibold text-ink">Email review: <span className="select-all font-mono text-[13px]">{m.address}</span></div>
          <div className="text-[12px] text-muted">Forward, cc or bcc any email here. Lighthouse reads it with its attachments and answers {m.mailbox} only: what it is, what each document is, and the steps needed. Type a question above the forward and it is answered too. Nobody else on the email is answered.</div>
        </div>
        <button onClick={copy} title="Copy the address" className={btn}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}</button>
        <div className="inline-flex rounded-lg border border-line overflow-hidden" role="radiogroup" title="When on, the mailbox is checked every 10 minutes">
          <button role="radio" aria-checked={!m.on} disabled={!!busy} onClick={() => m.on && post('off')} className={seg(!m.on)}>Off</button>
          <button role="radio" aria-checked={!!m.on} disabled={!!busy} onClick={() => !m.on && post('on')} className={seg(!!m.on) + ' border-l border-line'}>On</button>
        </div>
        <button onClick={() => post('scan')} disabled={!!busy} title="Read the mailbox once, now, whether or not the switch is on. About half a minute per email." className={btn}>
          {busy === 'scan' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {busy === 'scan' ? 'Reading…' : 'Check now'}
        </button>
      </div>
      {m.ready === false ? (
        <div className="mx-4 mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 flex items-center gap-2 flex-wrap">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="flex-1 min-w-[200px]">{m.notReady || 'Lighthouse cannot read the mailbox yet.'} Nothing is read until it is allowed. Sign in to Lighthouse as {m.mailbox}, then:</span>
          <a href={'/api/google/auth?scopes=read&mailbox=' + encodeURIComponent(m.mailbox)} target="_blank" rel="noreferrer" className="h-8 px-2.5 rounded-lg bg-ink text-white text-[12px] font-semibold inline-flex items-center">Allow reading</a>
        </div>
      ) : null}
      {(msg || m.lastError || m.lastRun) ? (
        <div className="px-4 pb-2 -mt-1 text-[12px]">
          {msg ? <span className="text-ink">{msg} </span> : null}
          {m.lastError ? <span className="text-rose-700">{m.lastError} </span> : null}
          {m.lastRun ? <span className="text-muted">Last checked {when(m.lastRun)}.</span> : null}
        </div>
      ) : null}
      {(m.recent || []).length ? (
        <ul className="border-t border-line/70 divide-y divide-line/60">
          {m.recent.map((h: any) => (
            <li key={h.id} className="px-4 py-1.5 flex items-center gap-2 flex-wrap text-[12.5px]">
              <span className="text-muted whitespace-nowrap">{when(h.at)}</span>
              <span className="font-semibold text-ink">{h.from}</span>
              <span className="text-muted truncate max-w-[18rem]">{h.subject}</span>
              <span className="text-ink">{h.line}</span>
              {h.error ? <span className="text-rose-700" title={h.error}>{h.replied ? 'reviewed with a problem' : 'not sent'}</span> : null}
              {/^left alone/.test(h.line || '') ? null : <button onClick={() => post('redo', h.id)} disabled={!!busy} title="Review this email again and send a fresh answer" className="ml-auto h-7 px-2 rounded-md border border-line bg-white text-[11.5px] font-semibold text-ink inline-flex items-center gap-1 hover:bg-app disabled:opacity-50">{busy === 'redo' + h.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Again</button>}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
