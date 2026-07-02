'use client'
// "Generate Guidebook" launcher for the property page. Opens the interview modal (the questions
// Jon requires BEFORE generation), then POSTs /api/guidebook and routes to the new guidebook.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, Loader2, X } from 'lucide-react'

const QUESTIONS: { key: string; label: string; hint: string; required?: boolean }[] = [
  { key: 'entry', label: 'Arrival & entry', hint: 'How does the guest get in? Front desk / fob / lockbox / smart lock — step by step.', required: true },
  { key: 'parking', label: 'Parking', hint: 'Where do guests park? Valet, assigned spot, garage level, permits…', required: true },
  { key: 'thermostat', label: 'Thermostat / AC', hint: 'Anything guests should know (limits, brand, "keep above 68", etc.)', required: true },
  { key: 'trash', label: 'Trash & disposal', hint: 'Where does trash go? Chute floor, pickup days, disposal quirks.', required: true },
  { key: 'smartHome', label: 'Smart home / TV', hint: 'TVs, streaming, speakers, blinds — optional.' },
  { key: 'stove', label: 'Stove / appliances', hint: 'Induction? Touch controls? Anything non-obvious — optional.' },
  { key: 'quietHours', label: 'Quiet hours / building rules', hint: 'Building-specific rules worth stating — optional.' },
  { key: 'petPolicy', label: 'Pet policy', hint: 'Leave blank for the standard no-pets language.' },
  { key: 'localPlaces', label: 'Local places to visit', hint: 'Comma-separated. Leave blank and the AI will suggest from the area.' },
  { key: 'restaurants', label: 'Restaurant picks', hint: 'Comma-separated favorites near this building.' },
  { key: 'addons', label: 'Add-on services offered', hint: 'Prefilled with the standard Stay list — edit as needed.' },
  { key: 'checkoutKey', label: 'Checkout — key/access return', hint: 'e.g. "Return the access card to the front desk before you leave."' },
]

export function GuidebookLauncher({ listingId, name }: { listingId: string; name: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [theme, setTheme] = useState('editorial')
  const [answers, setAnswers] = useState<Record<string, string>>({
    addons: 'Private Chef Experience, Mid-Stay Refresh Cleaning, Pre-Arrival Provisioning, Airport Transport, Luxury Car Services, Wellness Package, Boat / Jet Ski Rentals, Dog Walker, Babysitting Services',
  })

  const missing = QUESTIONS.filter(q => q.required && !String(answers[q.key] || '').trim()).map(q => q.label)

  async function generate() {
    if (missing.length) { setErr('Please answer: ' + missing.join(', ')); return }
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/guidebook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ listingId, answers, theme }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d?.id) throw new Error(d?.error || 'Generation failed')
      router.push(`/guidebooks/${d.id}`)
    } catch (e: any) { setErr(e?.message || String(e)); setBusy(false) }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-ink text-white px-4 py-2 text-sm font-semibold hover:opacity-90">
        <BookOpen size={16} /> Generate Guidebook
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl my-8">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h3 className="font-bold text-ink">Guidebook interview — {name}</h3>
                <p className="text-xs text-muted mt-0.5">Answer these first; the description, photos, Wi-Fi and details come from Guesty automatically.</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
              <div>
                <label className="text-xs font-semibold text-ink">Design theme</label>
                <div className="mt-1 flex gap-2">
                  {['editorial', 'dark'].map(t => (
                    <button key={t} onClick={() => setTheme(t)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize ${theme === t ? 'border-ink bg-ink text-white' : 'border-line text-muted hover:text-ink'}`}>
                      {t === 'editorial' ? 'Coastal editorial (light)' : 'Dark luxe'}
                    </button>
                  ))}
                </div>
              </div>
              {QUESTIONS.map(q => (
                <div key={q.key}>
                  <label className="text-xs font-semibold text-ink">{q.label}{q.required && <span className="text-red-500"> *</span>}</label>
                  <textarea rows={2} placeholder={q.hint} value={answers[q.key] || ''}
                    onChange={e => setAnswers(a => ({ ...a, [q.key]: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink/20" />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-line px-5 py-4">
              <p className="text-xs text-red-600">{err}</p>
              <button onClick={generate} disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-ink text-white px-4 py-2 text-sm font-semibold disabled:opacity-50">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <BookOpen size={15} />} {busy ? 'Composing your guidebook…' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
