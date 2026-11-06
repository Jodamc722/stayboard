'use client'
// "Check photos" for a whole building from the review queue (2026-11-06): runs the per-book photo check
// (collages, photos with text, maps used as page art → swapped for the best clean photo) one book at a
// time, so a building is cleaned in one click instead of opening every book.
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function CheckPhotosAll({ ids }: { ids: string[] }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  const [swaps, setSwaps] = useState(0)
  const [errs, setErrs] = useState(0)
  const router = useRouter()
  if (!ids.length) return null
  async function go() {
    setBusy(true); setDone(0); setSwaps(0); setErrs(0)
    for (const id of ids) {
      try {
        const r = await fetch('/api/guidebook/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, action: 'photos' }) })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) setErrs(e => e + 1); else setSwaps(s => s + ((j.swapped || []).length))
      } catch { setErrs(e => e + 1) }
      setDone(d => d + 1)
    }
    setBusy(false)
    router.refresh()
  }
  return busy
    ? <span className="text-[12px] text-muted">Checking photos {done}/{ids.length}…</span>
    : <button onClick={go} className="text-[12px] font-semibold text-ink hover:underline" title="Find collages, photos with text and maps used as page photos; replace them">{done ? 'Photos checked · ' + swaps + ' replaced' + (errs ? ' · ' + errs + ' failed' : '') + ' · again' : 'Check photos (' + ids.length + ')'}</button>
}
