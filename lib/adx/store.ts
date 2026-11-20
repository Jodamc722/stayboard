// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// WHERE NEW PIECES LIVE: beside the old ones. The studio keeps each piece as one JSON file in its private storage
// bucket (lib/ad-studio: "no migration, on purpose"); compositions go in the same bucket under adx/pieces/, so there
// is no table, no migration and nothing else to deploy. The old pieces under projects/ are untouched and stay
// openable as "Classic". Every read and write passes through the validator: a stored file is data like any other.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { reopenComposition, type Composition } from './composition'

const BUCKET = 'ad-studio'
const DIR = 'adx/pieces'
const safeId = (id: string) => String(id || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40)
export const newPieceId = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

export type PieceRow = { id: string; title: string; updatedAt: string; updatedBy: string; moment: string; channel: string; look: string; scenes: number; seconds: number; thumb: string; ground: string; origin: string }
const rowOf = (d: Composition): PieceRow => {
  const first = d.scenes[0], ph = first ? first.layers.find(l => l.type === 'photo') : null
  const fill = first ? first.layers.find(l => l.type === 'fill') : null
  return {
    id: d.id, title: d.title, updatedAt: d.meta.updatedAt, updatedBy: d.meta.updatedBy, moment: d.brief.moment, channel: d.brief.channel, look: d.concept.look,
    scenes: d.scenes.length, seconds: Math.round(d.canvas.duration), thumb: ph && ph.type === 'photo' ? d.assets.photos[ph.photo]?.src || '' : '',
    ground: fill && fill.type === 'fill' ? d.tokens.color[fill.color] || fill.color : '#000000', origin: d.meta.origin,
  }
}

export async function getPiece(id: string): Promise<Composition | null> {
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(`${DIR}/${safeId(id)}.json`)
  if (error || !data) return null
  try { const { doc } = reopenComposition(JSON.parse(await data.text())); return doc.scenes.length ? doc : null } catch { return null }
}
export async function listPieces(): Promise<PieceRow[]> {
  const { data } = await supabaseAdmin().storage.from(BUCKET).list(DIR, { limit: 200, sortBy: { column: 'updated_at', order: 'desc' } })
  const files = (data || []).filter(f => /\.json$/.test(f.name)).slice(0, 80)
  const docs = await Promise.all(files.map(f => getPiece(f.name.replace(/\.json$/, ''))))
  return (docs.filter(Boolean) as Composition[]).map(rowOf).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}
/** Save what the browser (or the composer) sent — through the validator, never as-is. */
export async function savePiece(raw: unknown, by: string): Promise<Composition> {
  const { doc } = reopenComposition(raw)
  if (!doc.scenes.length) throw new Error('There is nothing to save in this piece.')
  if (!safeId(doc.id) || doc.id === 'piece') doc.id = newPieceId()
  doc.meta.updatedAt = new Date().toISOString(); doc.meta.updatedBy = by
  const body = new Blob([JSON.stringify(doc)], { type: 'application/json' })
  const { error } = await supabaseAdmin().storage.from(BUCKET).upload(`${DIR}/${safeId(doc.id)}.json`, body, { upsert: true, contentType: 'application/json' })
  if (error) throw new Error('save: ' + error.message)
  return doc
}
export async function deletePiece(id: string): Promise<void> {
  await supabaseAdmin().storage.from(BUCKET).remove([`${DIR}/${safeId(id)}.json`])
}
