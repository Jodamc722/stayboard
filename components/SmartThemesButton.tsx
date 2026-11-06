'use client'
// "Smart themes" on /guidebooks (Jon, 2026-11-06): sets every guidebook to the smart colour theme, which
// then picks its palette from the property, the location and the vibe (lib/guide-themes). Any book can
// still be set to a fixed theme from its own editor afterwards.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Palette } from 'lucide-react'

export function SmartThemesButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const router = useRouter()
  async function go() {
    if (!window.confirm('Give every guidebook a smart colour theme picked for its property, location and vibe? You can still set any book to a fixed theme afterwards.')) return
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/guidebook', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'theme_all', theme: 'smart' }) })
      const j = await r.json().catch(() => ({}))
      setMsg(r.ok ? (j.changed || 0) + ' updated' : (j.error || 'Failed'))
      if (r.ok) router.refresh()
    } catch (e: any) { setMsg(String(e?.message || e)) }
    setBusy(false)
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" onClick={go} disabled={busy} title="Colours picked for each property, location and vibe" className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-lg border border-line bg-white text-ink px-2.5 py-1 hover:bg-app disabled:opacity-60"><Palette size={13} /> {busy ? 'Theming…' : 'Smart themes'}</button>
      {msg ? <span className="text-[11.5px] text-muted">{msg}</span> : null}
    </span>
  )
}
