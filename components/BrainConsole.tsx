'use client'
// THE COMMAND CENTER'S EVE CARD.
//
// This used to be a THIRD full chat implementation (2026-08-21): its own message state, its own
// /api/agent call, its own mic — and none of Eve v2's memory, tool domains, thumbs or logging. So
// the Command Center quietly talked to a different, dumber Eve than the rest of the app, and a rule
// you taught her here was never written down. It is now a launcher for the one real Eve, and the
// voice it was the only place to find moved into her panel.
import { Sparkles, Mic } from 'lucide-react'
import { openEve } from '@/components/EveFloat'

const SUGGEST = [
  'What needs my attention today?',
  "What's overdue right now?",
  "Summarize today's arrivals",
  'Draft replies for the unanswered reviews',
]

export function BrainConsole() {
  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-3.5">
      <div className="flex items-center gap-2 text-sm mb-1">
        <Sparkles size={15} className="text-brand-600" />
        <span className="font-semibold text-ink">Ask Eve</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted"><Mic size={12} /> voice</span>
      </div>
      <p className="text-[11px] text-muted mb-2.5">
        She sees ops, money, quality, labor and guests — and remembers what you teach her.
      </p>
      <div className="flex flex-col gap-1.5">
        {SUGGEST.map(s => (
          <button key={s} onClick={() => openEve(s)}
            className="text-left text-[12px] text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-lg px-2.5 py-2">{s}</button>
        ))}
      </div>
      <button onClick={() => openEve()}
        className="mt-2.5 w-full text-[12.5px] font-semibold rounded-lg bg-brand-600 text-white px-3 py-2 hover:bg-brand-700">
        Open Eve
      </button>
    </div>
  )
}
