'use client'
// SYNC LISTINGS (Jon, 2026-11-18: "sync listings to Lighthouse, new ones added. Need a button for
// that"). Pulls every listing from Guesty now instead of waiting for the twice-a-day run, then says
// which units are new, each a link to its page.
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { RefreshCw, X } from 'lucide-react'

type Added = { id: string; name: string; building: string | null }

export function SyncListingsButton() {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)
  const [added, setAdded] = useState<Added[]>([])

  async function run() {
    if (busy) return
    setBusy(true); setMsg(''); setBad(false); setAdded([])
    try {
      const r = await fetch('/api/sync/guesty?only=listings', { method: 'POST' })
      const text = await r.text()
      let d: any = null
      try { d = text ? JSON.parse(text) : null } catch { /* a gateway timeout is not JSON */ }
      if (!d) { setBad(true); setMsg(r.status === 504 ? 'Guesty is slow right now. It may still be finishing; try again in a minute.' : `Sync failed (${r.status}).`); return }
      if (!r.ok || !d.ok) { setBad(true); setMsg(d.error || `Sync failed (${r.status}).`); return }
      const list: Added[] = Array.isArray(d.added) ? d.added : []
      setAdded(list)
      setMsg(list.length ? `${list.length} new unit${list.length === 1 ? '' : 's'} added` : `Up to date · ${d.total} listings, nothing new`)
      startTransition(() => router.refresh())
    } catch (e: any) { setBad(true); setMsg(String(e?.message || 'Sync failed')) } finally { setBusy(false) }
  }

  return (
    <>
      <button onClick={run} disabled={busy} title="Pull every listing from Guesty now. New units appear here straight away."
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white text-ink px-2.5 py-1 text-[12.5px] font-semibold hover:border-ink/40 disabled:opacity-60">
        <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> {busy ? 'Syncing listings…' : 'Sync listings'}
      </button>
      {msg ? (
        <span className={`basis-full order-last text-[12.5px] ${bad ? 'text-rose-700' : 'text-ink'} inline-flex items-center gap-x-2 gap-y-1 flex-wrap`}>
          <span className="font-semibold">{msg}{added.length ? ':' : ''}</span>
          {added.map(a => <Link key={a.id} href={`/listings/${a.id}`} prefetch={false} className="underline decoration-line underline-offset-2 hover:text-brand-600">{a.name}</Link>)}
          <button onClick={() => { setMsg(''); setAdded([]) }} className="text-muted hover:text-ink" title="Dismiss"><X size={13} /></button>
        </span>
      ) : null}
    </>
  )
}
