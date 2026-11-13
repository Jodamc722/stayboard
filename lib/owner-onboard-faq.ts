// Owner onboarding → the unit's FAQ (Jon, 2026-11-13: "this should all feed in faq as items are approved").
// Once the unit is attached to its Guesty listing, what the owner told us and the order list they approved
// become FAQ entries on that listing (listing_faq, the same table the FAQ desk and Eve read). Only what is
// missing is added: an entry the team has edited, or one already there under the same question, is left alone.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import type { OORecord } from './owner-onboard'

export type FaqRow = { category: string; question: string; answer: string }

/** What this onboarding knows about the first unit (the one attached to the listing), as FAQ entries. */
export function faqRowsFor(r: OORecord): FaqRow[] {
  const out: FaqRow[] = []
  const h = r.home
  if (h) {
    if (h.wifiName) out.push({ category: 'Wi-Fi', question: 'Wi-Fi', answer: 'Network: ' + h.wifiName + (h.wifiPass ? '\nPassword: ' + h.wifiPass : '') })
    if (h.parking) out.push({ category: 'Parking', question: 'Parking', answer: h.parking })
    out.push({ category: 'Laundry', question: 'Washer and dryer', answer: h.washer ? 'Yes, there is a washer and dryer in the unit.' : 'No washer and dryer in the unit.' })
  }
  const o = r.order
  if (o && o.status === 'approved') {
    const skip = new Set(o.review?.skip || [])
    for (const l of o.lines) {
      const q = l.qty[0] || 0
      if (!q || !l.name) continue
      const what = l.detail && l.detail !== l.name ? ': ' + l.detail : ''
      out.push({ category: l.category || 'In the unit', question: l.name, answer: skip.has(l.key) ? 'Yes, in the unit (the owner’s own).' : `Yes, ${q} in the unit${what}.` })
    }
  }
  return out
}

/** Adds the missing entries to the attached listing's FAQ. Never overwrites one that is already there. */
export async function syncFaq(r: OORecord, by: string | null): Promise<{ ok: boolean; added: number; error?: string }> {
  const listingId = r.attach.listingId
  if (!listingId) return { ok: false, added: 0, error: 'Attach the unit to its Guesty listing first; the FAQ belongs to the listing.' }
  const rows = faqRowsFor(r)
  if (!rows.length) return { ok: true, added: 0 }
  const db = supabaseAdmin()
  const ex = await db.from('listing_faq').select('question').eq('listing_id', listingId).limit(2000)
  if (ex.error) return { ok: false, added: 0, error: ex.error.message }
  const have = new Set((ex.data || []).map((e: any) => String(e.question || '').trim().toLowerCase()))
  const add = rows.filter(x => !have.has(x.question.trim().toLowerCase())).map(x => ({ listing_id: listingId, category: x.category.slice(0, 80), question: x.question.slice(0, 300), answer: x.answer.slice(0, 4000), photo_url: null, source: 'onboarding', status: 'published', created_by: by }))
  if (add.length) { const ins = await db.from('listing_faq').insert(add); if (ins.error) return { ok: false, added: 0, error: ins.error.message } }
  r.faq = { at: new Date().toISOString(), listingId, added: (r.faq?.listingId === listingId ? r.faq.added : 0) + add.length }
  return { ok: true, added: add.length }
}
