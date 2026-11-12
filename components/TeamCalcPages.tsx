'use client'
// SALES → PROJECTIONS LIBRARY → PROJECTION PAGES (Jon, 2026-11-12: "from rental projections our team
// [should] generate these projections and edit the looks"). The projections calculator, ungated, that saves
// an editable page (lib/calc-report), and the pages made so far, owners' and the team's.
import { useEffect, useState } from 'react'
import { FreeTool } from './FreeTool'

type Page = { code: string; title: string; scope: string; preparedFor: string; source: string; by: string; at: string }

export function TeamCalcPages() {
  const [pages, setPages] = useState<Page[] | null>(null)
  const load = () => fetch('/api/sales/calc-report').then(r => r.json()).then(d => setPages(d?.ok ? d.pages : [])).catch(() => setPages([]))
  useEffect(() => { load() }, [])
  return (
    <section style={{ marginTop: 28, padding: '18px 20px', border: '1px solid #E4E2DD', borderRadius: 14, background: '#fff' }}>
      <p style={{ font: '600 10.5px Inter, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', color: '#8C6D3A', margin: 0 }}>Projection pages</p>
      <h3 style={{ font: '400 26px "Instrument Serif", Georgia, serif', margin: '6px 0 4px' }}>Make a projection for an owner</h3>
      <p style={{ fontSize: 13.5, color: '#55565C', margin: '0 0 16px', maxWidth: '70ch' }}>The same calculator owners use, with no email gate. It saves a page you can restyle and edit before you send it. Owners who unlock the free calculator get the same page, and theirs show up here too.</p>
      <FreeTool tool="income" team={{ onCreated: load }} />
      <p style={{ font: '600 10.5px Inter, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', color: '#6B6C72', margin: '26px 0 8px' }}>Recent pages</p>
      {pages === null ? <p style={{ fontSize: 13, color: '#888' }}>Loading…</p> : !pages.length ? <p style={{ fontSize: 13, color: '#888' }}>None yet.</p> : (
        <div style={{ display: 'grid', gap: 6 }}>
          {pages.map(p => (
            <a key={p.code} href={'/r/' + p.code} target="_blank" rel="noopener" style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', alignItems: 'baseline', padding: '9px 12px', border: '1px solid #EEECE7', borderRadius: 10, textDecoration: 'none', color: '#101114' }}>
              <b style={{ fontWeight: 600, fontSize: 14 }}>{p.title}</b>
              <span style={{ fontSize: 12.5, color: '#6B6C72' }}>{[p.preparedFor ? 'for ' + p.preparedFor : '', p.source === 'public' ? 'from the free calculator' : p.by, new Date(p.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })].filter(Boolean).join(' · ')}</span>
            </a>
          ))}
        </div>
      )}
    </section>
  )
}
