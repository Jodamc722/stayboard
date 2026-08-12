'use client'
// /ffe has four jobs now, in the order the work actually happens:
//   Owners & links  hand the walk out          (Jon, 2026-08-11)
//   Checklist       decide what gets asked     (Jon, 2026-08-11: "a tab where we can update it")
//   Catalog         the products, with codes   (Jon, 2026-08-12: "if we wanted to add lamps, etc.")
//   Orders          build it, send it, track it (Jon, 2026-08-12: "and then actually managing it")
//
// Tabs rather than four pages, because it is usually the same person walking the list back from the
// units, pricing it and sending it to the owner in one sitting. The tab lives in the URL hash so a
// link to "the orders tab" is a link somebody can actually send.
import { useEffect, useState } from 'react'
import { Link2, ListChecks, Package, ShoppingCart } from 'lucide-react'
import { FfeIndex } from '@/components/FfeIndex'
import { FfeChecklistEditor } from '@/components/FfeChecklistEditor'
import { FfeCatalog } from '@/components/FfeCatalog'
import { FfeOrders } from '@/components/FfeOrders'

type Tab = 'links' | 'checklist' | 'catalog' | 'orders'
const TABS: { k: Tab; label: string; Icon: any }[] = [
  { k: 'links', label: 'Owners & links', Icon: Link2 },
  { k: 'checklist', label: 'Checklist', Icon: ListChecks },
  { k: 'catalog', label: 'Catalog', Icon: Package },
  { k: 'orders', label: 'Orders', Icon: ShoppingCart },
]

export function FfeTabs() {
  const [tab, setTab] = useState<Tab>('links')

  useEffect(() => {
    const h = (window.location.hash || '').replace('#', '')
    if (TABS.some(t => t.k === h)) setTab(h as Tab)
  }, [])
  const go = (k: Tab) => {
    setTab(k)
    try { window.history.replaceState(null, '', '#' + k) } catch { /* no-op */ }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center rounded-xl border border-line bg-white shadow-soft overflow-hidden w-fit max-w-full overflow-x-auto">
        {TABS.map(t => (
          <button key={t.k} onClick={() => go(t.k)}
            className={'px-4 py-2 text-[12.5px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap ' +
              (tab === t.k ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
            <t.Icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'links' ? <FfeIndex />
        : tab === 'checklist' ? <FfeChecklistEditor />
          : tab === 'catalog' ? <FfeCatalog />
            : <FfeOrders />}
    </div>
  )
}
