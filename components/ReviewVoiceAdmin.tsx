'use client'
// Admin console — Review reply AI voice training. Admins maintain the house voice here:
// tone guidelines + approved example replies. Saved to app_settings ('review_voice') and
// appended to the AI system prompt on every draft in /reviews. The playground tests the
// CURRENT editor state (even unsaved) against a sample review. Drafts are never auto-posted.
import { useEffect, useState } from 'react'
import { Sparkles, Plus, Trash2, Loader2, Check, AlertTriangle, Save, PlayCircle } from 'lucide-react'

type Example = { review: string; reply: string }

const STARTER_GUIDELINES = `- Warm, sincere, professional. 2-4 sentences, plain English, no emojis.
- Never admit fault or restate the specific problem — respond to the feeling, not the defect.
- Never mention the unit number, building name, door codes, phone numbers or links.
- Never confirm bed bugs / pests or an unauthorized entry as fact.
- Always reply in English, whatever language the review is in.
- Thank positive guests for the specific things they praised.`

export function ReviewVoiceAdmin() {
  const [guidelines, setGuidelines] = useState('')
  const [examples, setExamples] = useState<Example[]>([])
  const [loaded, setLoaded] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  // playground
  const [sample, setSample] = useState('')
  const [sampleRating, setSampleRating] = useState('2')
  const [testing, setTesting] = useState(false)
  const [testOut, setTestOut] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/review-voice').then(r => r.json()).then(j => {
      if (j?.note) setNote(j.note)
      const v = j?.voice
      setGuidelines(typeof v?.guidelines === 'string' && v.guidelines ? v.guidelines : STARTER_GUIDELINES)
      setExamples(Array.isArray(v?.examples) ? v.examples.map((e: any) => ({ review: String(e?.review || ''), reply: String(e?.reply || '') })) : [])
      setLoaded(true)
    }).catch(() => { setGuidelines(STARTER_GUIDELINES); setLoaded(true) })
  }, [])

  const mark = () => { setDirty(true); setMsg(null) }

  async function save() {
    setSaving(true); setError(null); setMsg(null)
    try {
      const r = await fetch('/api/settings/review-voice', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guidelines, examples }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed to save.')
      setMsg('Voice profile saved — every AI draft in Reviews now uses it.'); setDirty(false); setNote(null)
    } catch (e: any) { setError(e.message || String(e)) } finally { setSaving(false) }
  }

  async function test() {
    if (!sample.trim()) { setError('Paste a sample review to test against.'); return }
    setTesting(true); setError(null); setTestOut(null)
    try {
      const r = await fetch('/api/reviews/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: sample, rating: Number(sampleRating), guest: 'Alex', channel: 'airbnb', voicePreview: { guidelines, examples } }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Draft failed.')
      setTestOut(j.draft || '')
    } catch (e: any) { setError(e.message || String(e)) } finally { setTesting(false) }
  }

  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2">
        <Sparkles size={15} className="text-brand-600" />
        <span className="text-sm font-bold text-ink">Review reply AI — voice training</span>
        {dirty && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Unsaved</span>}
        <button onClick={save} disabled={saving || !loaded} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12px] font-semibold hover:bg-brand-700 disabled:opacity-50">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save profile
        </button>
      </div>
      <div className="p-4 space-y-4">
        {note && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800 flex items-center gap-2"><AlertTriangle size={14} /> {note}</div>}
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}
        {msg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700 flex items-center gap-2"><Check size={14} /> {msg}</div>}

        <div>
          <label className="block text-[12px] font-semibold text-muted mb-1">Tone guidelines</label>
          <textarea value={guidelines} onChange={e => { setGuidelines(e.target.value); mark() }} rows={7}
            className="w-full text-[13px] leading-relaxed rounded-lg border border-line bg-app px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-brand-200" />
          <p className="text-[11px] text-muted mt-1">These are added to every AI draft. Built-in hard limits always apply (never confirm bed bugs / pests / intrusion as fact; host instruction stays authoritative; drafts are never posted automatically).</p>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <label className="text-[12px] font-semibold text-muted">Approved example replies ({examples.length}/12)</label>
            <button onClick={() => { setExamples(ex => [...ex, { review: '', reply: '' }]); mark() }} disabled={examples.length >= 12}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:underline disabled:opacity-40"><Plus size={12} /> Add example</button>
          </div>
          {examples.length === 0 && <p className="text-[12px] text-muted">None yet. Paste 3–5 of your best real replies — the AI will match their tone. Pairing each with the guest review it answered helps the most.</p>}
          <div className="space-y-2">
            {examples.map((ex, i) => (
              <div key={i} className="rounded-xl border border-line bg-app/50 p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-muted mb-0.5">Guest review (optional)</label>
                      <textarea value={ex.review} onChange={e => { const v = e.target.value; setExamples(a => a.map((x, j) => j === i ? { ...x, review: v } : x)); mark() }} rows={3}
                        placeholder="What the guest wrote…" className="w-full text-[12px] rounded-lg border border-line bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-muted mb-0.5">Your approved reply</label>
                      <textarea value={ex.reply} onChange={e => { const v = e.target.value; setExamples(a => a.map((x, j) => j === i ? { ...x, reply: v } : x)); mark() }} rows={3}
                        placeholder="The reply, exactly as you'd post it…" className="w-full text-[12px] rounded-lg border border-line bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                    </div>
                  </div>
                  <button onClick={() => { setExamples(a => a.filter((_, j) => j !== i)); mark() }} title="Remove example"
                    className="mt-5 text-rose-500 hover:text-rose-700"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3">
          <div className="text-[12px] font-bold text-ink mb-1.5 inline-flex items-center gap-1.5"><PlayCircle size={13} className="text-brand-600" /> Playground — test this voice</div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[260px]">
              <textarea value={sample} onChange={e => setSample(e.target.value)} rows={2} placeholder="Paste a real guest review here to see how the AI would reply with the settings above (uses your unsaved edits too)…"
                className="w-full text-[12px] rounded-lg border border-line bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
            </div>
            <select value={sampleRating} onChange={e => setSampleRating(e.target.value)} className="text-[12px] rounded-lg border border-line bg-white px-2 py-1.5">
              {['5', '4', '3', '2', '1'].map(r => <option key={r} value={r}>{r}★</option>)}
            </select>
            <button onClick={test} disabled={testing} className="inline-flex items-center gap-1.5 rounded-lg border border-brand-300 bg-white text-brand-700 px-3 py-1.5 text-[12px] font-semibold hover:bg-brand-50 disabled:opacity-50">
              {testing ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={13} />} Test draft
            </button>
          </div>
          {testOut != null && (
            <div className="mt-2 rounded-lg border border-line bg-white px-3 py-2.5 text-[13px] text-ink whitespace-pre-wrap">{testOut || '(empty draft)'}</div>
          )}
        </div>
      </div>
    </div>
  )
}
