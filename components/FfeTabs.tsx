'use client'
// /ffe has two jobs now: hand out the links, and decide what the checklist asks (Jon, 2026-08-11:
// "a tab where we can update it or add item"). Tabs rather than two pages, because the person
// adding an item is usually the same person about to send the links out.
import { useState } from 'react'
import { Link2, ListChecks } from 'lucide-react'
import { FfeIndex } from '@/components/FfeIndex'
import { FfeChecklistEditor } from '@/components/FfeChecklistEditor'

export function FfeTabs() {
  const [tab, setTab] = useState<'links' | 'checklist'>('links')
  return (
    <div className="space-y-4">
      <div className="flex items-center rounded-xl border border-line bg-white shadow-soft overflow-hidden w-fit">
        {([
          { k: 'links' as const, label: 'Owners & links', Icon: Link2 },
          { k: 'checklist' as const, label: 'Checklist', Icon: ListChecks },
        ]).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={'px-4 py-2 text-[12.5px] font-semibold inline-flex items-center gap-1.5 ' +
              (tab === t.k ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
            <t.Icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'links' ? <FfeIndex /> : <FfeChecklistEditor />}
    </div>
  )
}
