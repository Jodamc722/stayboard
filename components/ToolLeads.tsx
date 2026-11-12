'use client'
// THE FREE TOOLS ON THE SALES DESK (Jon, 2026-11-12): the three links to share, and every email left on
// them, newest first, with what they ran and which deck they came from.
import { useEffect, useState } from 'react'
import { Calculator, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { TOOL_KEYS, TOOL_META } from '@/lib/free-tools'

type Lead = { at: string; email: string; name: string; phone: string; homes: string; source: string; downloads: number }

export function ToolLeads() {
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState('')
  useEffect(() => { fetch('/api/tools/leads', { cache: 'no-store' }).then(r => r.json()).then(d => setLeads(d?.ok ? d.leads : [])).catch(() => setLeads([])) }, [])
  const copy = async (k: string) => { const u = window.location.origin + '/tools/' + k; try { await navigator.clipboard.writeText(u) } catch { /* shown below */ } setCopied(k); setTimeout(() => setCopied(''), 1600) }
  return (
    <div className="rounded-2xl border border-line bg-white">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-app rounded-2xl">
        <span className="flex items-center gap-2 text-[14px] font-semibold text-ink"><Calculator size={15} /> Free tools <span className="text-muted font-normal text-[12.5px]">· rental income, inventory and linen calculators, email gated</span></span>
        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-ink tabular-nums">{leads ? leads.length + ' lead' + (leads.length === 1 ? '' : 's') : '…'} {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {TOOL_KEYS.map(k => (
              <span key={k} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px]">
                <a href={'/tools/' + k} target="_blank" rel="noreferrer" className="font-semibold text-ink hover:underline">{TOOL_META[k].short}</a>
                <button type="button" onClick={() => copy(k)} title="Copy the link" className="text-muted hover:text-ink">{copied === k ? <Check size={13} /> : <Copy size={13} />}</button>
              </span>
            ))}
            <span className="text-[12px] text-muted self-center">Add them to a deck under Magazine → Builder → Free tools.</span>
          </div>
          {!leads ? null : !leads.length ? <p className="text-[12.5px] text-muted">No leads yet. Each email left on a calculator shows here and in your notifications.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-left text-muted"><th className="py-1 pr-3 font-semibold">When</th><th className="py-1 pr-3 font-semibold">Who</th><th className="py-1 pr-3 font-semibold">What they ran</th><th className="py-1 font-semibold">From</th></tr></thead>
                <tbody>
                  {leads.map((l, i) => (
                    <tr key={i} className="border-t border-line align-top">
                      <td className="py-1.5 pr-3 whitespace-nowrap text-muted">{new Date(l.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                      <td className="py-1.5 pr-3"><a href={'mailto:' + l.email} className="font-semibold text-ink hover:underline">{l.name || l.email}</a>{l.name ? <div className="text-muted">{l.email}</div> : null}{l.phone ? <div className="text-muted">{l.phone}</div> : null}</td>
                      <td className="py-1.5 pr-3">{l.homes}</td>
                      <td className="py-1.5 text-muted">{l.source.replace(/^Free tool · [^·]+ · ?/, '') || 'Direct link'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
