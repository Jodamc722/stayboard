// WHOSE NAME IS ON THE REPLY (Jon, 2026-11-02: "make sure the voice for replies for all Boynton
// Beach property is signed from Vanessa and Taylor, not Stay Hospitality").
//
// Some homes are hosted under the owners' own names. For those, every reply Lighthouse writes —
// guest message drafts (Eve's watch and "Draft with Eve"), review replies, Eve's fixed notices —
// speaks as those hosts, never mentions Stay Hospitality, and is signed by them. Matched on the
// listing / unit name or its building. Add a home here to give it its own hosts.
//
// Three layers, so no path slips through: the prompt tells the model who it is (hostVoicePrompt),
// the drafted text is corrected and signed (applyHostVoice), and anything sent to a guest on one
// of these homes has the company name swapped out (brandOnly) even if a person typed it.
import 'server-only'

export type HostVoice = { key: string; hosts: string; signOff: string }

const VOICES: { re: RegExp; v: HostVoice }[] = [
  { re: /\bboynton\b/i, v: { key: 'boynton', hosts: 'Vanessa and Taylor', signOff: 'Vanessa & Taylor' } },
]

/** The hosts for a listing, from any of its names (unit, listing name, building). null = the house voice. */
export function hostVoiceFor(...names: (string | null | undefined)[]): HostVoice | null {
  const hay = names.filter(Boolean).join(' | ')
  if (!hay) return null
  const hit = VOICES.find(x => x.re.test(hay))
  return hit ? hit.v : null
}

/** A block for a system prompt: who "we" is on this home. */
export function hostVoicePrompt(v: HostVoice, kind: 'message' | 'review' = 'message'): string {
  return `\n\nTHIS HOME HAS ITS OWN HOSTS — THIS OVERRIDES ANY BRAND OR SIGNATURE ABOVE: you write as ${v.hosts}, the hosts of this home. "We" is ${v.hosts}. Never mention "Stay Hospitality", a management company or "the team". ` +
    (kind === 'review' ? `End with this signature: — ${v.signOff}` : `End the message with the sign-off on its own line: ${v.signOff}`)
}

const BRAND = /\b(the\s+)?stay\s+hospitality(\s+team)?\b/gi

/** Swap the company name for the hosts (anything sent on one of these homes). */
export function brandOnly(text: string, v: HostVoice): string {
  return String(text || '').replace(BRAND, () => v.hosts)
}

/** Correct a drafted reply and sign it: company name out, one sign-off at the end. */
export function applyHostVoice(text: string, v: HostVoice, kind: 'message' | 'review' = 'message'): string {
  let s = String(text || '').trim()
  // An old signature line ("— Stay Hospitality", "Best, Stay Hospitality team") goes first.
  s = s.replace(/\n?\s*[—–-]\s*(the\s+)?stay\s+hospitality(\s+team)?\s*$/i, '').replace(/\n\s*(best|warmly|thanks|thank you|cheers|regards|kind regards|warm regards)[,!.]?\s*\n?\s*(the\s+)?stay\s+hospitality(\s+team)?\s*$/i, '')
  s = brandOnly(s, v).trim()
  const signed = new RegExp('(—|–|-)?\\s*' + v.signOff.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i').test(s) || new RegExp(v.hosts.replace(/\s+/g, '\\s+') + '\\s*$', 'i').test(s)
  if (!signed) s += kind === 'review' ? ' — ' + v.signOff : '\n\n' + v.signOff
  return s
}

/** The hosts for a guest conversation (its reservation's listing). */
export async function hostVoiceForConversation(conversationId: string): Promise<HostVoice | null> {
  try {
    const { supabaseAdmin } = await import('./supabase-admin')
    const db = supabaseAdmin()
    const { data: c } = await db.from('guesty_conversations').select('reservation_id').eq('id', conversationId).maybeSingle()
    if (!c?.reservation_id) return null
    const { data: r } = await db.from('guesty_reservations').select('listing_name,listing_id').eq('id', c.reservation_id).maybeSingle()
    if (!r) return null
    let building: string | null = null
    if (r.listing_id) { const { data: l } = await db.from('guesty_listings').select('building,nickname').eq('id', r.listing_id).maybeSingle(); building = l ? [l.building, l.nickname].filter(Boolean).join(' ') : null }
    return hostVoiceFor(r.listing_name, building)
  } catch { return null }
}
