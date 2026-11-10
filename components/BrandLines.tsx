'use client'
// BRAND, THE ALLOWED WAY — on the unit's Content tab (Jon, 2026-11-09: "any new allowable features …
// on the OTAs to bring more brand awareness").
//
// Folded by default: the copy tool above it is the work, this is the reference beside it. Open, it is
// three short lists — lines that are safe on every booking site (copy one, paste it into the section
// named beside it), lines that belong only on the direct site / guidebook / flyer, and a checker for
// any line somebody wants to add by hand. All wording and every rule come from lib/brand-lines.
import { useMemo, useState } from 'react'
import { BadgeCheck, Check, ChevronRight, Copy, ShieldCheck } from 'lucide-react'
import { otaBrandLines, directBrandLines, brandLint, BRAND_CHANNEL_RULES } from '@/lib/brand-lines'
import { WATERMARK_CHANNEL_NOTE } from '@/lib/photo-watermark'

export function BrandLines({ building, city }: { building: string; city: string }) {
  const ota = useMemo(() => otaBrandLines({ building, city }), [building, city])
  const direct = useMemo(() => directBrandLines({ building, city }), [building, city])
  const [copied, setCopied] = useState('')
  const [draft, setDraft] = useState('')
  const problems = useMemo(() => brandLint(draft), [draft])
  const copy = async (id: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(c => (c === id ? '' : c)), 1500) } catch { /* clipboard blocked: the text is on screen to select */ }
  }
  return (
    <details className="rounded-2xl border border-line bg-white overflow-hidden group">
      <summary className="px-3 py-2.5 cursor-pointer select-none list-none flex items-center gap-2 flex-wrap hover:bg-app/50">
        <ChevronRight size={13} className="text-muted group-open:rotate-90 transition-transform shrink-0" />
        <BadgeCheck size={14} className="text-brand-600 shrink-0" />
        <span className="text-[13px] font-bold text-ink">Brand lines</span>
        <span className="text-[11.5px] text-muted">what builds the Stay name on the booking sites, and what has to stay on the direct site</span>
      </summary>
      <div className="border-t border-line p-3 space-y-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5">Safe on every booking site</div>
          <ul className="divide-y divide-line rounded-xl border border-line overflow-hidden">
            {ota.map(l => (
              <li key={l.id} className="px-3 py-2 flex items-start gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-semibold text-ink break-words">{l.text}</span>
                  <span className="block text-[11.5px] text-muted leading-snug">{l.where} · {l.why}</span>
                </span>
                {l.id !== 'title' && (
                  <button type="button" onClick={() => copy(l.id, l.text)} className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ink hover:border-ink/40 min-h-[32px]">
                    {copied === l.id ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-muted leading-snug">Use a line only where it is true of this home. Paste it into the section named, then run the copy check as usual — nothing here is sent anywhere by itself.</p>
        </div>

        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5">Direct site, guidebook and flyer only</div>
          <ul className="space-y-1">
            {direct.map(l => <li key={l.id} className="text-[12.5px] text-ink">{l.text}</li>)}
            <li className="text-[12.5px] text-ink">The Stay watermark on photos — Photo library and the photo editor. <span className="text-muted">{WATERMARK_CHANNEL_NOTE}</span></li>
          </ul>
        </div>

        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5">Check a line before it goes into the copy</div>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2} maxLength={600} placeholder="Type or paste a line…" className="w-full rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
          {draft.trim() && (problems.length === 0 ? (
            <p className="mt-1 text-[12px] text-emerald-700 inline-flex items-center gap-1"><ShieldCheck size={13} /> Nothing a booking site would object to.</p>
          ) : (
            <ul className="mt-1 space-y-0.5">{problems.map((m, i) => <li key={i} className="text-[12px] text-amber-800">Keep this off the booking sites: {m}</li>)}</ul>
          ))}
        </div>

        <details>
          <summary className="text-[11.5px] font-semibold text-muted cursor-pointer select-none hover:text-ink">What each channel allows</summary>
          <ul className="mt-1.5 space-y-1.5">
            {BRAND_CHANNEL_RULES.map(r => (
              <li key={r.channel} className="text-[11.5px] leading-snug">
                <b className="text-ink">{r.channel}.</b> <span className="text-ink">{r.allowed}</span> <span className="text-muted">Not allowed: {r.notAllowed}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </details>
  )
}
