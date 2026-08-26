// The document library behind doc_search / doc_read.
//
// Admin-gated in both directions: reading the library tells you what internal policy exists, and
// writing to it changes what Eve treats as house rule — written policy outranks anything she
// inferred, so an upload is a privileged act, not a convenience.
//
// Uploads arrive as TEXT, not files. Extracting text from a .docx or a scanned PDF server-side is
// a different project with a different failure mode; pasting the content (or dropping a .md/.txt,
// which the browser reads) keeps this honest about what it stores. What it does do well is SPLIT:
// a document is chunked on its own headings at write time, so retrieval returns the paragraph that
// answers the question rather than a whole playbook.
import { NextRequest, NextResponse } from 'next/server'
import { eveGate } from '../../agent/route'
import { isSuperadmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { chunkDoc, countWords } from '@/lib/eve/docs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CATEGORIES = ['sop', 'playbook', 'policy', 'reference', 'research']

export async function GET() {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  try {
    const { data, error } = await db.from('eve_docs')
      .select('id,title,category,source,words,active,added_by,created_at,updated_at')
      .order('updated_at', { ascending: false }).limit(200)
    if (error) return NextResponse.json({ error: error.message, hint: 'Run migration 058.' }, { status: 200 })
    const ids = ((data as any[]) || []).map(d => d.id)
    const counts: Record<string, number> = {}
    if (ids.length) {
      const { data: ch } = await db.from('eve_doc_chunks').select('doc_id').in('doc_id', ids).limit(5000)
      for (const c of ((ch as any[]) || [])) counts[String(c.doc_id)] = (counts[String(c.doc_id)] || 0) + 1
    }
    return NextResponse.json({
      docs: ((data as any[]) || []).map(d => ({ ...d, sections: counts[String(d.id)] || 0 })),
      categories: CATEGORIES,
    })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const access = gate.access
  if (!(isSuperadmin(access.email) || access.role === 'admin')) {
    return NextResponse.json({ error: 'forbidden', message: 'Only an admin can add to what Eve treats as written policy.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({} as any))
  const title = String(body?.title || '').trim().slice(0, 200)
  const text = String(body?.body || '')
  const category = CATEGORIES.includes(String(body?.category)) ? String(body.category) : 'sop'
  const source = String(body?.source || '').trim().slice(0, 200) || null
  if (!title) return NextResponse.json({ error: 'Give the document a title — Eve quotes it by name.' }, { status: 400 })
  if (text.trim().length < 80) return NextResponse.json({ error: 'That is too short to be a document. Paste the content, not a summary.' }, { status: 400 })
  if (text.length > 900_000) return NextResponse.json({ error: 'That document is very large. Split it into parts and upload each.' }, { status: 400 })

  const db = supabaseAdmin()
  try {
    // Re-uploading a title REPLACES it rather than making a second copy. Two versions of the same
    // policy, both live, is how a rule quietly contradicts itself.
    const { data: existing } = await db.from('eve_docs').select('id').eq('title', title).maybeSingle()
    const row = {
      title, category, source, body: text, words: countWords(text),
      active: true, added_by: access.email, updated_at: new Date().toISOString(),
    }
    let docId: string
    if (existing?.id) {
      docId = String(existing.id)
      const { error } = await db.from('eve_docs').update(row).eq('id', docId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await db.from('eve_doc_chunks').delete().eq('doc_id', docId)
    } else {
      const { data, error } = await db.from('eve_docs').insert(row).select('id').maybeSingle()
      if (error || !data) return NextResponse.json({ error: error?.message || 'insert failed', hint: 'Run migration 058.' }, { status: 500 })
      docId = String((data as any).id)
    }

    const chunks = chunkDoc(text).map((c, i) => ({ doc_id: docId, idx: i, heading: c.heading || null, text: c.text }))
    for (let i = 0; i < chunks.length; i += 100) {
      await db.from('eve_doc_chunks').insert(chunks.slice(i, i + 100))
    }
    return NextResponse.json({ ok: true, id: docId, title, words: row.words, sections: chunks.length, replaced: !!existing?.id })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  if (!(isSuperadmin(gate.access.email) || gate.access.role === 'admin')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const id = new URL(req.url).searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  try {
    // Retired, not deleted: a policy that was true last quarter explains a decision made last
    // quarter. Eve only reads active ones.
    const { error } = await supabaseAdmin().from('eve_docs').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
