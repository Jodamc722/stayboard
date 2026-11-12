// ONE FREE TOOL ON ITS OWN LINK (Jon, 2026-11-12: "shareable links… email gated before it allows them
// to download the quote"). Public. ?d=<deck code> credits the lead to the deck it was opened from, and
// the page then names that deck's building and presenter.
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { isToolKey, toolKeyOf, TOOL_META, type ToolKey } from '@/lib/free-tools'
import { FreeTool } from '@/components/FreeTool'
import { STAY_CONTACT } from '@/lib/need-list-contact'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { tool: string } }): Promise<Metadata> {
  const k = toolKeyOf(params.tool)
  if (!k) return {}
  const m = TOOL_META[k]
  return { title: m.short + ' (free) | Stay Hospitality', description: m.dek, openGraph: { title: m.title.replace(/\*/g, ''), description: m.dek, siteName: 'Stay Hospitality' } }
}

async function deckOf(code: string): Promise<{ where: string; area: string; card: any } | null> {
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(code)) return null
  try {
    const { data } = await supabaseAdmin().from('owner_reports').select('scope_label, content').eq('code', code).limit(1)
    const r: any = data && data[0]
    if (!r) return null
    const c = r.content || {}
    return { where: String(r.scope_label || ''), area: String((c.cma && c.cma.area) || ''), card: (c.contact && c.contact.card) || null }
  } catch { return null }
}

export default async function ToolPage({ params, searchParams }: { params: { tool: string }; searchParams: { d?: string } }) {
  // The linen calculator is part of the supply calculator now; its old links land there.
  if (params.tool === 'linen') redirect('/tools/inventory' + (searchParams.d ? '?d=' + encodeURIComponent(String(searchParams.d)) : ''))
  if (!isToolKey(params.tool)) notFound()
  const tool = params.tool as ToolKey
  const m = TOOL_META[tool]
  const deck = searchParams.d ? await deckOf(String(searchParams.d)) : null
  const p = STAY_CONTACT.person
  const card = deck?.card && String(deck.card.name || '').trim() ? deck.card : p
  const contact = { name: String(card?.name || ''), role: String(card?.role || ''), phone: String(card?.phone || p?.phone || ''), email: String(card?.email || p?.email || ''), photo: String(card?.photo || '') }
  const emph = (x: string) => x.split(/(\*[^*]+\*)/).map((s, i) => s.startsWith('*') && s.endsWith('*') ? <em key={i}>{s.slice(1, -1)}</em> : s)
  return (
    <main style={{ minHeight: '100vh', background: '#F7F7F5', fontFamily: 'Inter, system-ui, sans-serif', color: '#101114', padding: '28px max(18px, env(safe-area-inset-left)) 60px' }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" />
      <div style={{ maxWidth: 1020, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <a href="/tools"><img src="/stay-logo.png" alt="Stay Hospitality" style={{ height: 32 }} /></a>
          {deck?.where ? <span style={{ font: '600 10.5px Inter, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', color: '#6B6C72' }}>{deck.where}</span> : null}
        </header>
        <p style={{ font: '600 10.5px Inter, sans-serif', letterSpacing: '.18em', textTransform: 'uppercase', color: '#8C6D3A', margin: '40px 0 0' }}>{m.kicker}</p>
        <h1 style={{ font: '400 clamp(38px, 6vw, 60px)/1.02 "Instrument Serif", Georgia, serif', margin: '10px 0 12px', letterSpacing: '-0.01em' }}>{emph(m.title)}</h1>
        <p style={{ fontSize: 16, lineHeight: 1.55, color: '#3A3B40', maxWidth: '56ch', margin: '0 0 28px' }}>{m.dek}</p>
        <FreeTool tool={tool} refCode={searchParams.d ? String(searchParams.d).slice(0, 40) : undefined} where={deck?.where} area={deck?.area} contact={contact} />
        <p style={{ fontSize: 12, color: '#86878C', marginTop: 40 }}>Stay Hospitality · Short-term rental management across Miami-Dade and Broward · stay-hospitality.com</p>
      </div>
    </main>
  )
}
