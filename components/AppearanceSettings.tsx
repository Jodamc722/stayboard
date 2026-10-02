'use client'
// APPEARANCE (Jon, 2026-10-02: "have a theme change in settings so I can revert to legacy").
// Per person, not app-wide: the choice is saved to app_users.prefs.theme and applied at once.
import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { THEMES, type ThemeKey, applyTheme, readDeviceTheme } from '@/lib/theme'

export function AppearanceSettings() {
  const [theme, setTheme] = useState<ThemeKey>('lighthouse')
  const [note, setNote] = useState('')
  useEffect(() => { setTheme(readDeviceTheme()) }, [])
  async function pick(t: ThemeKey) {
    setTheme(t); applyTheme(t); setNote('')
    try {
      const r = await fetch('/api/access/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: t }) })
      const j = await r.json().catch(() => null)
      setNote(j && j.saved ? 'Saved — it follows you to every device.' : 'Applied on this device; it could not be saved to your profile.')
    } catch { setNote('Applied on this device; it could not be saved to your profile.') }
  }
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">Pick how Lighthouse looks for you. Legacy restores the colors, fonts and surfaces from before October; the page layouts stay the same in both.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {THEMES.map(t => {
          const on = t.key === theme
          return (
            <button key={t.key} type="button" onClick={() => pick(t.key)} aria-pressed={on}
              className={'text-left rounded-xl border p-4 transition-all ' + (on ? 'border-ink bg-white' : 'border-line bg-white/60 hover:border-ink/40')}>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-ink">{t.label}</span>
                {on && <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-ink"><Check size={12} /> On</span>}
              </div>
              <p className="text-[12.5px] text-muted mt-1">{t.blurb}</p>
              <div className="mt-3 flex gap-1.5" aria-hidden="true">
                {t.key === 'lighthouse'
                  ? <><i className="w-6 h-6 rounded" style={{ background: '#F6F5F0', border: '1px solid #E1E1DC' }} /><i className="w-6 h-6 rounded" style={{ background: '#15161A' }} /><i className="w-6 h-6 rounded" style={{ background: '#A8864E' }} /><i className="w-6 h-6 rounded" style={{ background: '#ffffff', border: '1px solid #E1E1DC' }} /></>
                  : <><i className="w-6 h-6 rounded" style={{ background: '#F7F7F8', border: '1px solid #E5E7EB' }} /><i className="w-6 h-6 rounded" style={{ background: '#0B1220' }} /><i className="w-6 h-6 rounded" style={{ background: '#5B63E8' }} /><i className="w-6 h-6 rounded" style={{ background: '#ffffff', border: '1px solid #E5E7EB' }} /></>}
              </div>
            </button>
          )
        })}
      </div>
      {note && <p className="text-[12px] text-muted">{note}</p>}
    </div>
  )
}
