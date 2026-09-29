// FILE → TEXT, ONCE, AT UPLOAD (2026-09-29). Jon: "Adam and Eve should have file upload feature,
// where we can upload items for learning or reference for handbooks, SOPs, etc."
//
// What each kind becomes:
//   .txt .md .csv .json      read as text
//   .docx                    mammoth → plain text with its paragraphs (headings kept as lines)
//   .pdf .png .jpg .webp     Claude transcribes it to markdown (typed or scanned — both work)
// The original is kept in the private `agent-files` bucket so a person can open what the agent
// read. Both agents then file the TEXT: that is what is searched, quoted and learned from.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { anthropicMessages, textOf } from '../anthropic-call'
import { modelPairFor } from '../ai-models'

export const BUCKET = 'agent-files'
export const MAX_BYTES = 25 * 1024 * 1024
export const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.csv,.json,.png,.jpg,.jpeg,.webp'
const TEXT = /\.(txt|md|markdown|csv|json)$/i
const IMG: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

export type Extracted = { ok: true; text: string; words: number; method: string; path: string | null; name: string } | { ok: false; error: string }

const ext = (name: string) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '')

async function transcribe(bytes: Uint8Array, kind: 'pdf' | 'image', mediaType: string, name: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('AI not configured — add ANTHROPIC_API_KEY in Vercel.')
  const data = Buffer.from(bytes).toString('base64')
  const block = kind === 'pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data } }
  const { model, fallback } = await modelPairFor('file-read')
  const r = await anthropicMessages(key, {
    model, max_tokens: 16000,
    system: 'You transcribe business documents (SOPs, handbooks, policies, checklists, forms) into faithful markdown. Keep every line of content, the headings as #/##, lists as lists, tables as markdown tables. Do not summarise, correct, reorder or add anything. If a part is illegible write [illegible]. Output the markdown only.',
    messages: [{ role: 'user', content: [block, { type: 'text', text: `Transcribe "${name}" in full.` }] }],
  }, fallback, 'file-read')
  if (!r.ok) throw new Error(String(r.data?.error?.message || `transcription failed (${r.status})`).slice(0, 300))
  return textOf(r.data).trim()
}

export async function extractFile(file: File, folder: string): Promise<Extracted> {
  const name = String(file.name || 'file').slice(0, 200)
  const e = ext(name)
  if (file.size > MAX_BYTES) return { ok: false, error: 'Max 25MB per file.' }
  const bytes = new Uint8Array(await file.arrayBuffer())
  let text = '', method = ''
  try {
    if (TEXT.test(name)) { text = new TextDecoder().decode(bytes); method = 'text' }
    else if (e === 'docx') {
      const mammoth: any = await import('mammoth')
      const out = await (mammoth.default || mammoth).extractRawText({ buffer: Buffer.from(bytes) })
      text = String(out?.value || ''); method = 'docx'
    } else if (e === 'pdf') { text = await transcribe(bytes, 'pdf', 'application/pdf', name); method = 'pdf (read by AI)' }
    else if (IMG[e]) { text = await transcribe(bytes, 'image', IMG[e], name); method = 'image (read by AI)' }
    else return { ok: false, error: 'Upload a PDF, Word (.docx), text/markdown/CSV file, or a photo of a page.' }
  } catch (err: any) { return { ok: false, error: `Could not read ${name}: ${String(err?.message || err).slice(0, 240)}` } }
  text = text.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim()
  if (text.replace(/\s/g, '').length < 40) return { ok: false, error: `${name} came out empty — nothing readable in it.` }

  // Keep the original (private bucket). Best effort: the text is what matters.
  let path: string | null = null
  try {
    const sb = supabaseAdmin()
    try { await sb.storage.createBucket(BUCKET, { public: false }) } catch { /* exists */ }
    const p = `${folder}/${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]+/g, '-')}`
    const up = await sb.storage.from(BUCKET).upload(p, bytes, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (!up.error) path = p
  } catch { /* keep going */ }
  return { ok: true, text, words: text.split(/\s+/).filter(Boolean).length, method, path, name }
}

/** A short-lived link to an original, for the person who may already read the library. */
export async function signedUrl(path: string): Promise<string | null> {
  const { data } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, 300)
  return data?.signedUrl || null
}
