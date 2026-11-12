'use client'
// THE UNIT, ONE GLANCE AWAY (lib/inbox-property). Wi-Fi first — the thing guests ask for most — then the facts a
// reply needs. Every line copies with one tap, and "Add to reply" drops it into the reply box of the open thread
// (window event `lh:reply-insert`, picked up by MessageThread's ReplyBox), so nothing is retyped.
import { useEffect, useState } from 'react'
import { Check, ChevronDown, Copy, CornerDownLeft, Home, Wifi } from 'lucide-react'

type Fact = { key: string; label: string; value: string; long?: boolean }
type P = { listingId: string; name: string; building: string; wifi: { network: string; password: string } | null; facts: Fact[]; more: Fact[] }

const cache: Record<string, Promise<any>> = {}
const load = (id: string) => (cache[id] = cache[id] || fetch('/api/messages/property?listingId=' + encodeURIComponent(id)).then(r => r.json()).catch(() => null))
export function prefetchProperty(id: string | null | undefined) { if (id) load(id) }

/** Put text into the open thread's reply box (appended on its own line). */
export function insertIntoReply(text: string) {
  try { window.dispatchEvent(new CustomEvent('lh:reply-insert', { detail: { text } })) } catch { /* fine */ }
}

export function InboxPropertyCard({ listingId, canSend }: { listingId: string | null | undefined; canSend: boolean }) {
  const [p, setP] = useState<P | null>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    let live = true
    setP(null); setMore(false)
    if (listingId) load(listingId).then(j => { if (live && j?.ok) setP(j) })
    return () => { live = false }
  }, [listingId])
  if (!listingId || !p) return null
  const w = p.wifi
  const wifiText = w ? ['Wi-Fi: ' + (w.network || '—'), w.password ? 'Password: ' + w.password : ''].filter(Boolean).join('\n') : ''
  return (
    <section className="rounded-2xl border border-line bg-white p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted inline-flex items-center gap-1"><Home size={12} /> Property</span>
        <span className="text-[12px] font-semibold text-ink truncate">{p.name}</span>
      </div>

      {w && (
        <div className="rounded-xl border border-sky-200 bg-sky-50/70 px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <Wifi size={13} className="text-sky-700" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-sky-800">Wi-Fi</span>
            <span className="ml-auto inline-flex gap-1">
              <CopyBtn text={wifiText} label="Copy both" />
              {canSend && <button onClick={() => insertIntoReply(wifiText)} className="h-6 px-2 rounded-md bg-sky-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 hover:bg-sky-800" title="Put the network and password into your reply"><CornerDownLeft size={11} /> Add to reply</button>}
            </span>
          </div>
          <div className="mt-1 grid grid-cols-[auto_1fr_auto] gap-x-2 gap-y-0.5 items-center">
            <span className="text-[11px] text-sky-900/70">Network</span><span className="font-mono text-[13px] font-semibold text-ink truncate">{w.network || '—'}</span>{w.network ? <CopyBtn text={w.network} /> : <span />}
            <span className="text-[11px] text-sky-900/70">Password</span><span className="font-mono text-[13px] font-semibold text-ink truncate">{w.password || '—'}</span>{w.password ? <CopyBtn text={w.password} /> : <span />}
          </div>
        </div>
      )}

      <div className="divide-y divide-line/60">
        {p.facts.map(f => <Line key={f.key} f={f} canSend={canSend} />)}
      </div>
      {p.more.length > 0 && (
        <>
          <button onClick={() => setMore(m => !m)} className="w-full flex items-center justify-between text-[11.5px] font-semibold text-muted hover:text-ink">
            <span>Access, house manual, rules & {p.more.length} more</span><ChevronDown size={13} className={more ? 'rotate-180 transition' : 'transition'} />
          </button>
          {more && <div className="divide-y divide-line/60">{p.more.map(f => <Line key={f.key} f={f} canSend={canSend} />)}</div>}
        </>
      )}
    </section>
  )
}

function Line({ f, canSend }: { f: Fact; canSend: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="group py-1 flex items-start gap-2">
      <span className="text-[11px] text-muted w-20 shrink-0 pt-[2px]">{f.label}</span>
      <button onClick={() => f.long && setOpen(o => !o)} className={'flex-1 min-w-0 text-left text-[12.5px] text-ink ' + (f.long && !open ? 'line-clamp-2' : 'whitespace-pre-wrap')} title={f.long ? (open ? 'Show less' : 'Show all') : undefined}>{f.value}</button>
      <span className="shrink-0 inline-flex gap-0.5 opacity-60 group-hover:opacity-100">
        <CopyBtn text={f.value} />
        {canSend && <button onClick={() => insertIntoReply(f.value)} className="h-6 w-6 rounded-md hover:bg-app inline-flex items-center justify-center text-muted hover:text-ink" title={'Add “' + f.label + '” to your reply'} aria-label={'Add ' + f.label + ' to your reply'}><CornerDownLeft size={12} /></button>}
      </span>
    </div>
  )
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text) } catch {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy') } catch { /* fine */ } t.remove()
    }
    setOk(true); setTimeout(() => setOk(false), 1200)
  }
  return label
    ? <button onClick={copy} className="h-6 px-2 rounded-md border border-sky-200 bg-white text-[11px] font-semibold text-sky-800 inline-flex items-center gap-1 hover:bg-sky-50" title="Copy">{ok ? <Check size={11} /> : <Copy size={11} />} {ok ? 'Copied' : label}</button>
    : <button onClick={copy} className="h-6 w-6 rounded-md hover:bg-app inline-flex items-center justify-center text-muted hover:text-ink" title={ok ? 'Copied' : 'Copy'} aria-label="Copy">{ok ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}</button>
}
