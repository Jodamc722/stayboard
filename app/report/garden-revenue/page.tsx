'use client'
// THE GARDEN REVENUE REPORT BY LINK (Jon, 2026-11-23: "How do I get a shareable link with passcode to
// share with the Rev team"). The Revenue report from Garden → Reports, read-only, for someone without a
// Lighthouse login: pick the period, the side (whole property / Garden / Botanica), the filters and the
// view; press Refresh to read Cloudbeds now. No guest names. Opens on this link's own passcode —
// share_links row 'garden-revenue', minted from the report's Share button. Data: /api/public/garden-revenue.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Lock } from 'lucide-react'
import { GardenRevenue } from '@/components/GardenRevenue'
import { GardenBrand } from '@/components/GardenBrand'

const CODE = 'garden-revenue'
const API = '/api/public/garden-revenue'

export default function GardenRevenueSharePage() {
  const [state, setState] = useState<'checking' | 'locked' | 'open' | 'gone'>('checking')
  const [msg, setMsg] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/public/link-auth?code=' + CODE, { cache: 'no-store' }).then(r => r.json()).then(j => {
      if (j?.gone || !j?.ok) { setState('gone'); return }
      if (j.authed) setState('open'); else { setMsg(j.unset ? 'This link has no passcode yet. Ask the person who sent it.' : ''); setState('locked') }
    }).catch(() => setState('locked'))
  }, [])
  const onLocked = useCallback((m: string) => { setMsg(m); setState('locked') }, [])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pw || busy) return
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/public/link-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: CODE, password: pw.trim() }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { setErr(j.error || 'Wrong passcode.'); setBusy(false); return }
      setPw(''); setState('open')
    } catch { setErr('Could not check the passcode. Try again.') }
    setBusy(false)
  }

  return (
    <div data-business="garden" className="min-h-screen bg-app text-ink" style={{ fontFamily: 'var(--font-ui)' }}>
      <header className="border-b border-line bg-white">
        <div className="max-w-[1180px] mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <GardenBrand compact />
          <div className="min-w-0">
            <div className="gh-display text-[15px] font-semibold leading-tight">Revenue report</div>
            <div className="text-[11px] text-muted">The Garden Hotel &amp; Resort · Botanica · read-only</div>
          </div>
        </div>
      </header>
      <main className="max-w-[1180px] mx-auto px-4 sm:px-6 py-5">
        {state === 'checking' ? <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Opening…</p> : null}
        {state === 'gone' ? <div className="max-w-sm mx-auto mt-16 text-center"><p className="text-[15px] font-semibold">This link is not active.</p><p className="text-[13px] text-muted mt-1">Ask the person who sent it for a new one.</p></div> : null}
        {state === 'locked' ? (
          <form onSubmit={submit} className="max-w-sm mx-auto mt-14 rounded-2xl border border-line bg-white p-6">
            <div className="flex items-center gap-2 mb-1"><Lock size={16} className="text-brand-600" /><span className="text-[16px] font-semibold">Enter the passcode</span></div>
            <p className="text-[12.5px] text-muted mb-3">{msg || 'This report opens with the passcode that came with the link.'}</p>
            <input type="password" autoFocus value={pw} onChange={e => setPw(e.target.value)} placeholder="Passcode" autoComplete="off" className="w-full h-10 rounded-lg border border-line px-3 text-[14px] outline-none focus:border-brand-600" />
            {err ? <p className="text-[12.5px] text-rose-700 mt-2">{err}</p> : null}
            <button type="submit" disabled={!pw || busy} className="mt-3 w-full h-10 rounded-lg bg-brand-600 text-white text-[13.5px] font-semibold disabled:opacity-50">{busy ? 'Checking…' : 'Open the report'}</button>
          </form>
        ) : null}
        {state === 'open' ? <GardenRevenue api={API} shared onLocked={onLocked} /> : null}
      </main>
    </div>
  )
}
