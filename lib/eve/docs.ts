// THE WRITTEN HOUSE KNOWLEDGE — playbooks, checklists, policies.
//
// Jon, 2026-08-26, asked Eve to be "expert in all things ops and customer service". Everything she
// knew until now she INFERRED: she counted rows and worked out what was true. That ceiling is real
// and it is low, because the most valuable things about this business were never in a table. They
// are in the documents a new GM gets handed on day one — the departure-clean checklist, the mini-GM
// playbook, the refund rules, how an owner statement is meant to read.
//
// WHY THE DATABASE AND NOT THE REPO. The obvious move is a docs/ folder in the codebase. This repo
// is PUBLIC. These documents name owners, buildings, staff and money.
//
// WHY CHUNKS. A 6,000-word playbook answers a question one SECTION at a time. Handing her the whole
// file spends the context she needs for the actual records, and burying the one relevant paragraph
// in fifty irrelevant ones makes her answer worse, not better. So documents are split on their own
// headings, searched as passages, and read whole only when she asks for that.
//
// RETRIEVAL IS KEYWORD, NOT VECTOR, AND SAYS SO. There is no embedding infrastructure in this app
// and inventing one for a dozen documents would be the wrong trade. Scoring is term-overlap with a
// heading bonus. It finds what it finds; when it finds nothing it says the corpus does not cover
// the question rather than reaching for the nearest paragraph.
import 'server-only'
import type { EveTool, EveDomain } from './types'
import { obj, S } from './types'
import { clampLimit, lc, safe } from './ctx'

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'for', 'on', 'we', 'our', 'with', 'that', 'this', 'be', 'are', 'as', 'at', 'by', 'from', 'do', 'does', 'how', 'what', 'when', 'who', 'why', 'i', 'you'])

export function terms(q: string): string[] {
  return lc(q).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)).slice(0, 12)
}

/** Split a document on its own headings, then on size. Returns [{heading, text}] in order. */
export function chunkDoc(body: string, maxWords = 400): { heading: string; text: string }[] {
  const src = String(body || '').replace(/\r\n/g, '\n').trim()
  if (!src) return []
  const lines = src.split('\n')
  const out: { heading: string; text: string }[] = []
  let heading = ''
  let buf: string[] = []
  const flush = () => {
    const text = buf.join('\n').trim()
    buf = []
    if (!text) return
    const words = text.split(/\s+/)
    if (words.length <= maxWords) { out.push({ heading, text }); return }
    // A section longer than the cap is split on paragraph boundaries, never mid-sentence.
    const paras = text.split(/\n{2,}/)
    let cur: string[] = []
    let n = 0
    for (const p of paras) {
      const w = p.split(/\s+/).length
      if (n + w > maxWords && cur.length) { out.push({ heading, text: cur.join('\n\n') }); cur = []; n = 0 }
      cur.push(p); n += w
    }
    if (cur.length) out.push({ heading, text: cur.join('\n\n') })
  }
  for (const line of lines) {
    const h = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line)
    if (h) { flush(); heading = h[2].trim().slice(0, 200); continue }
    // A bare ALL-CAPS or underlined line is a heading in a plain-text SOP too.
    if (/^[A-Z0-9][A-Z0-9 &/,'()-]{6,60}$/.test(line.trim()) && buf.length > 2) { flush(); heading = line.trim(); continue }
    buf.push(line)
  }
  flush()
  return out.filter(c => c.text.replace(/\s/g, '').length > 40)
}

export function countWords(s: string): number {
  return String(s || '').trim().split(/\s+/).filter(Boolean).length
}

export const DOC_TOOLS: EveTool[] = [
  {
    name: 'doc_search',
    description: "Search the company's WRITTEN documents — playbooks, SOPs, checklists, policies, research — and get back the passages that answer the question, with the document and section they came from. Use this whenever a question is about how we DO something, what our policy IS, or what a standard says, rather than what the records show. Written policy from a human outranks anything you concluded from data: if a document says it, quote it and name the document.",
    input_schema: obj({ query: S.str, category: S.str, limit: S.num }, ['query']),
    run: async (input, ctx) => {
      const q = String(input?.query || '').trim()
      if (!q) return { error: 'Give me something to search for.' }
      const words = terms(q)
      const lim = clampLimit(input?.limit, 6, 15)

      let dq = ctx.db.from('eve_docs').select('id,title,category,source,words,updated_at').eq('active', true).order('updated_at', { ascending: false }).limit(60)
      if (input?.category) dq = dq.eq('category', lc(input.category))
      const { data: docs } = await safe(dq, { data: [] } as any)
      const docList = ((docs as any[]) || [])
      if (!docList.length) {
        return { found: 0, note: 'There are no documents loaded yet. Anything I know is inferred from records, not from written policy — say so rather than implying there is a document behind it.' }
      }
      const byId: Record<string, any> = {}
      for (const d of docList) byId[String(d.id)] = d

      const { data: chunks } = await safe(
        ctx.db.from('eve_doc_chunks').select('doc_id,idx,heading,text').in('doc_id', docList.map(d => String(d.id))).order('doc_id').limit(4000),
        { data: [] } as any,
      )
      const scored = ((chunks as any[]) || []).map(c => {
        const hay = lc(c.heading || '') + ' \n ' + lc(c.text || '')
        const head = lc(c.heading || '')
        let score = 0
        for (const w of words) {
          const inBody = hay.includes(w)
          if (inBody) score += 1
          if (head.includes(w)) score += 2      // a heading match is a much stronger signal
        }
        // Reward passages that carry several distinct terms rather than one term repeated.
        const distinct = words.filter(w => hay.includes(w)).length
        score += distinct * 0.5
        return { c, score }
      }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, lim)

      if (!scored.length) {
        return {
          found: 0,
          documents_searched: docList.map(d => d.title),
          note: `Nothing in the written documents matches "${q}". Say that the documents do not cover it rather than answering from general knowledge about short-term rentals — and if it is something we clearly should have written down, that is worth flagging.`,
        }
      }
      return {
        found: scored.length,
        passages: scored.map(({ c, score }) => ({
          document: byId[String(c.doc_id)]?.title || 'unknown',
          category: byId[String(c.doc_id)]?.category,
          section: c.heading || null,
          text: String(c.text || '').slice(0, 1600),
          relevance: Math.round(score * 10) / 10,
          read_the_whole_document_with: `doc_read title="${byId[String(c.doc_id)]?.title}"`,
        })),
        documents_searched: docList.length,
        how_to_use_this: 'Quote the document by name when you use it. This is house policy written by a person and it outranks anything you inferred from the records.',
      }
    },
  },

  {
    name: 'doc_read',
    description: 'Read one written document in full, or list what documents exist. Pass title to read one (partial match is fine); pass nothing to see the library. Use after doc_search when a passage is not enough, or when someone asks what we have written down.',
    input_schema: obj({ title: S.str, section: S.str }),
    run: async (input, ctx) => {
      const { data: docs } = await safe(
        ctx.db.from('eve_docs').select('id,title,category,source,words,updated_at,added_by').eq('active', true).order('category').limit(100),
        { data: [] } as any,
      )
      const list = ((docs as any[]) || [])
      if (!input?.title) {
        return {
          documents: list.map(d => ({ title: d.title, category: d.category, words: d.words, source: d.source, updated: d.updated_at })),
          count: list.length,
          note: list.length ? 'Read one with doc_read title="…", or search across all of them with doc_search.' : 'Nothing loaded yet — everything I know is inferred from records.',
        }
      }
      const want = lc(input.title)
      const doc = list.find(d => lc(d.title) === want) || list.find(d => lc(d.title).includes(want))
      if (!doc) return { error: `No document called "${input.title}".`, available: list.map(d => d.title) }
      const { data: chunks } = await safe(
        ctx.db.from('eve_doc_chunks').select('idx,heading,text').eq('doc_id', doc.id).order('idx', { ascending: true }).limit(200),
        { data: [] } as any,
      )
      let parts = ((chunks as any[]) || [])
      if (input?.section) parts = parts.filter(c => lc(c.heading || '').includes(lc(input.section)))
      // A whole playbook can be enormous; cap what comes back and say so rather than silently cutting.
      let budget = 24000
      const shown: any[] = []
      for (const p of parts) {
        const t = String(p.text || '')
        if (budget - t.length < 0) break
        budget -= t.length
        shown.push({ section: p.heading || null, text: t })
      }
      return {
        title: doc.title, category: doc.category, source: doc.source, words: doc.words, updated: doc.updated_at,
        sections: shown,
        truncated: shown.length < parts.length ? `showing ${shown.length} of ${parts.length} sections — narrow with section="…"` : false,
      }
    },
  },
]

export const DOCS_DOMAIN: EveDomain = {
  key: 'docs',
  label: 'Written playbooks & policy',
  blurb: 'the company\'s own written documents — SOPs, checklists, playbooks, policies — searchable by passage',
  tools: DOC_TOOLS,
}
