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
  // THE LINK, SHOWN AND COPIED FOR REAL (Jon, 2026-11-12: "when I copy the link it does not open when
  // pasted"). The full address is on screen to select; Copy tries the clipboard, falls back to selecting
  // and copying the box, and only says Copied when one of them worked.
  const [origin, setOrigin] = useState('')
  useEffect(() => { setOrigin(window.location.origin) }, [])
  const linkOf = (k: string) => (origin || 'https://lighthouse-stay.vercel.app') + '/tools/' + k
  const copy = async (k: string) => {
    const u = linkOf(k)
    let ok = false
    try { await navigator.clipboard.writeText(u); ok = true } catch { /* fall back below */ }
    if (!ok) {
      const el = document.getElementById('tool-link-' + k) as HTMLInputElement | null
      if (el) { el.focus(); el.select(); try { ok = document.execCommand('copy') } catch { ok = false } }
    }
    setCopied(ok ? k : 'fail:' + k); setTimeout(() => setCopied(''), 2200)
  }
  return (
    <div className="rounded-2xl border border-line bg-white">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-app rounded-2xl">
        <span className="flex items-center gap-2 text-[14px] font-semibold text-ink"><Calculator size={15} /> Free tools <span className="text-muted font-normal text-[12.5px]">· rental income, inventory and linen calculators, email gated</span></span>
        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-ink tabular-nums">{leads ? leads.length + ' lead' + (leads.length === 1 ? '' : 's') : '…'} {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="grid gap-2">
            {TOOL_KEYS.map(k => (
              <div key={k} className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-semibold text-ink w-48 shrink-0">{TOOL_META[k].short}</span>
                <input id={'tool-link-' + k} readOnly value={linkOf(k)} onFocus={e => e.target.select()} className="min-w-0 flex-1 rounded-lg border border-line bg-app px-2 py-1.5 text-[12.5px] text-ink" />
                <button type="button" onClick={() => copy(k)} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ink">{copied === k ? <><Check size={13} /> Copied</> : copied === 'fail:' + k ? 'Select and copy the box' : <><Copy size={13} /> Copy</>}</button>
                <a href={'/tools/' + k} target="_blank" rel="noreferrer" className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ink">Open</a>
              </div>
            ))}
            <span className="text-[12px] text-muted">Anyone can open these without signing in. Add them to a deck under Magazine → Builder → Free tools.</span>
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
