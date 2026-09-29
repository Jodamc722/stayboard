// ADAM'S LIBRARY (migration 136) — the hotel's written material: handbook sections, SOPs, policies,
// training, reference. Separate from Eve's library by design (garden_agent_docs, never eve_docs).
//
// Upload → text (lib/files/extract) → filed + chunked here → Adam READS it once: the rules and facts
// it states become his memories (source 'doc', naming the document), so he knows them without
// searching; the full text stays searchable with doc_search / doc_read for anything finer.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { anthropicMessages, textOf } from '../anthropic-call'
import { modelPairFor } from '../ai-models'
import { chunkDoc, countWords, terms } from '../eve/docs'
import { adamRemember } from './adam'

export const ADAM_DOC_CATEGORIES = ['handbook', 'sop', 'policy', 'training', 'reference']

export async function listAdamDocs() {
  const { data, error } = await supabaseAdmin().from('garden_agent_docs').select('id,title,category,source,file_path,words,learned,active,added_by,created_at,updated_at').order('updated_at', { ascending: false }).limit(200)
  if (error) throw error
  return data || []
}

export async function saveAdamDoc(d: { title: string; category?: string; body: string; source?: string | null; file_path?: string | null; learn?: boolean; by?: string | null }) {
  const db = supabaseAdmin()
  const title = String(d.title || '').trim().slice(0, 200)
  const body = String(d.body || '')
  if (!title) throw new Error('Give it a title — Adam quotes it by name.')
  if (body.trim().length < 40) throw new Error('That is too short to be a document.')
  const row: any = { title, category: ADAM_DOC_CATEGORIES.includes(String(d.category)) ? d.category : 'sop', source: d.source || null, body, words: countWords(body), active: true, added_by: d.by || null, updated_at: new Date().toISOString() }
  if (d.file_path && /^(adam|handbook)\/[^/]+$/.test(d.file_path)) row.file_path = d.file_path
  // Same title replaces — two live versions of one rule is how a policy contradicts itself.
  const { data: ex } = await db.from('garden_agent_docs').select('id').eq('title', title).maybeSingle()
  let id: string
  if (ex?.id) { id = String(ex.id); await db.from('garden_agent_docs').update(row).eq('id', id); await db.from('garden_agent_doc_chunks').delete().eq('doc_id', id) }
  else { const { data, error } = await db.from('garden_agent_docs').insert(row).select('id').single(); if (error) throw error; id = String(data.id) }
  const chunks = chunkDoc(body).map((c, i) => ({ doc_id: id, idx: i, heading: c.heading || null, text: c.text }))
  for (let i = 0; i < chunks.length; i += 100) await db.from('garden_agent_doc_chunks').insert(chunks.slice(i, i + 100))
  const learned = d.learn === false ? [] : await learnFromDoc(id, title, body, d.by || null).catch(() => [])
  return { id, title, words: row.words, sections: chunks.length, replaced: !!ex?.id, learned }
}

/** Adam reads the document once and files what it states as memories. */
export async function learnFromDoc(id: string, title: string, body: string, by: string | null): Promise<string[]> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return []
  const { model, fallback } = await modelPairFor('adam-study')
  const r = await anthropicMessages(key, {
    model, max_tokens: 3000,
    system: 'You are Adam, the Garden Hotel\'s assistant, reading one of the hotel\'s own documents. List the concrete rules, standards and facts it states that a front desk, housekeeping or maintenance person would need — each one self-contained, one sentence, in the document\'s own terms (times, amounts, names, steps). Only what the document says; nothing general about hotels. Return JSON only: {"items":[{"content":"…","kind":"rule|fact|preference|person","subject":"a room, a role, a vendor, or hotel"}]} — at most 25 items.',
    messages: [{ role: 'user', content: `Document: "${title}"\n\n${body.slice(0, 60000)}` }],
  }, fallback, 'adam-study')
  if (!r.ok) return []
  let items: any[] = []
  try { const t = textOf(r.data); items = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)).items || [] } catch { return [] }
  const saved: string[] = []
  for (const it of items.slice(0, 25)) {
    const content = String(it?.content || '').trim()
    if (content.length < 8) continue
    const mid = await adamRemember({ content: `${content} (from "${title}")`, kind: ['rule', 'fact', 'preference', 'person'].includes(it?.kind) ? it.kind : 'rule', subject: String(it?.subject || 'hotel').slice(0, 80), source: 'doc', by, confidence: 0.9 })
    if (mid) saved.push(content)
  }
  await supabaseAdmin().from('garden_agent_docs').update({ learned: saved.length }).eq('id', id)
  return saved
}

export async function retireAdamDoc(id: string) {
  await supabaseAdmin().from('garden_agent_docs').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id)
}

/** doc_search for Adam: keyword passages across his library (same scoring shape as Eve's). */
export async function searchAdamDocs(q: string, limit = 6) {
  const db = supabaseAdmin()
  const { data: docs } = await db.from('garden_agent_docs').select('id,title,category').eq('active', true).limit(80)
  const list = (docs || []) as any[]
  if (!list.length) return { found: 0, note: 'No hotel documents uploaded yet — say so rather than guessing a policy; ask the team with the ask tool.' }
  const by: Record<string, any> = {}; for (const d of list) by[d.id] = d
  const { data: chunks } = await db.from('garden_agent_doc_chunks').select('doc_id,heading,text').in('doc_id', list.map(d => d.id)).limit(4000)
  const words = terms(q)
  const scored = ((chunks || []) as any[]).map(c => {
    const head = String(c.heading || '').toLowerCase(), hay = head + ' ' + String(c.text || '').toLowerCase()
    let s = 0; for (const w of words) { if (hay.includes(w)) s += 1; if (head.includes(w)) s += 2 }
    return { c, s: s + words.filter(w => hay.includes(w)).length * 0.5 }
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit)
  if (!scored.length) return { found: 0, documents_searched: list.map(d => d.title), note: `Nothing in the hotel's documents matches "${q}".` }
  return { found: scored.length, passages: scored.map(({ c }) => ({ document: by[c.doc_id]?.title, category: by[c.doc_id]?.category, section: c.heading || null, text: String(c.text).slice(0, 1600) })), how_to_use: 'Quote the document by name. The hotel\'s written policy outranks anything you inferred.' }
}

export async function readAdamDoc(title?: string) {
  const db = supabaseAdmin()
  if (!title) { const { data } = await db.from('garden_agent_docs').select('title,category,words').eq('active', true).order('title'); return { documents: data || [] } }
  const { data } = await db.from('garden_agent_docs').select('title,category,body').eq('active', true).ilike('title', `%${title}%`).limit(1)
  const d = (data || [])[0] as any
  return d ? { title: d.title, category: d.category, text: String(d.body).slice(0, 30000) } : { error: `No hotel document titled like "${title}".` }
}
