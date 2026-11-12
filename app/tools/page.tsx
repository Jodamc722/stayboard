// THE FREE TOOLS, LISTED (Jon, 2026-11-12). Public: links to each calculator.
import type { Metadata } from 'next'
import Link from 'next/link'
import { TOOL_KEYS, TOOL_META } from '@/lib/free-tools'

export const metadata: Metadata = {
  title: 'Free short-term rental calculators | Stay Hospitality',
  description: 'Free calculators for South Florida rental owners: what your home could earn, what it needs, and the linen a turnover takes.',
}

export default function ToolsIndex() {
  return (
    <main style={{ minHeight: '100vh', background: '#F7F7F5', fontFamily: 'Inter, system-ui, sans-serif', color: '#101114', padding: '40px max(20px, env(safe-area-inset-left))' }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" />
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <img src="/stay-logo.png" alt="Stay Hospitality" style={{ height: 34 }} />
        <h1 style={{ font: '400 48px/1.05 "Instrument Serif", Georgia, serif', margin: '40px 0 10px', letterSpacing: '-0.01em' }}>Free tools for <em>rental owners</em></h1>
        <p style={{ fontSize: 16, color: '#3A3B40', maxWidth: '52ch', lineHeight: 1.55, margin: 0 }}>Three calculators from the team that runs 500+ homes across Miami-Dade and Broward. No account needed.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 32 }}>
          {TOOL_KEYS.map(k => (
            <Link key={k} href={'/tools/' + k} style={{ background: '#fff', border: '1px solid #E4E2DD', borderRadius: 16, padding: 22, textDecoration: 'none', color: '#101114' }}>
              <p style={{ font: '600 10px Inter, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', color: '#8C6D3A', margin: 0 }}>{TOOL_META[k].short}</p>
              <p style={{ font: '400 28px/1.1 "Instrument Serif", Georgia, serif', margin: '10px 0 8px' }}>{TOOL_META[k].title.replace(/\*/g, '')}</p>
              <p style={{ fontSize: 14, lineHeight: 1.5, color: '#3A3B40', margin: 0 }}>{TOOL_META[k].dek}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}
