// THE OTA PLAYBOOK, SERVER SIDE — load it, teach it, test it, and let Jon's answers fill it in.
//
// Three jobs, all idempotent so the nightly learn can call them without thinking:
//
//   loadOtaPlaybook()   defaults + app_settings overrides + the LIVE claims desk (lib/claims.ts and
//                       its own overrides), so the claims row never disagrees with /claims.
//   syncOtaPlaybook()   every non-empty cell becomes ONE memory scoped `channel:<Channel>` (so it
//                       loads only when that channel is in the conversation — memory.ts), a probe is
//                       written for a NEW memory so tomorrow's self-test checks it took, a changed
//                       cell supersedes its old memory, and every empty Stay half becomes a
//                       question for Jon. A cell Jon has verified carries weight 9 / source jon;
//                       an unverified one weight 6 / source doc, so nothing Eve inferred can
//                       outrank it and nothing it says can outrank Jon.
//   applyOtaAnswer()    when Jon answers one of those questions (Telegram, the panel, the morning
//                       ask), the answer is written straight into the cell's Stay half and marked
//                       verified — the playbook fills itself in from his replies.
import 'server-only'
import { getSetting, setSetting } from '@/lib/app-settings'
import { DEFAULT_CHANNEL_POLICY, policyFor, type ChannelPolicy } from '@/lib/claims'
import {
  OTA_CHANNELS, OTA_TOPICS, OTA_PLAYBOOK_KEY, OTA_PLAYBOOK_MEMORY_KEY, mergePlaybook, playbookGaps, memoryTextFor,
  topicLabel, type OtaChannel, type OtaTopic, type Playbook, type PlaybookOverrides, type PlaybookCell,
} from '@/lib/ota-playbook'
import { saveMemory } from '@/lib/eve/memory'
import { askQuestion } from '@/lib/eve/questions'
import { probeForMemory } from '@/lib/eve/learning-audit'
import { supabaseAdmin } from '@/lib/supabase-admin'

const CLAIMS_POLICY_KEY = 'claims_channel_policy'
/** The claims desk keys its channels slightly differently ('VRBO'). */
const CLAIMS_KEY: Record<OtaChannel, string> = { 'Airbnb': 'Airbnb', 'Vrbo': 'VRBO', 'Booking.com': 'Booking.com', 'Expedia': 'Expedia', 'Direct': 'Direct', 'Other': 'Other' }

/** Gaps in these topics become questions for Jon; the rest just show on the page. */
const ASK_TOPICS: OtaTopic[] = ['payment', 'deposit', 'charging', 'refunds', 'cancellations', 'claims']

type MemoryMap = Record<string, { id: string; hash: string; at: string }>
const cellKey = (ch: OtaChannel, t: OtaTopic) => `${ch}|${t}`

function hashOf(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36) + '.' + s.length.toString(36)
}

function claimsLine(ch: OtaChannel, p: ChannelPolicy): string {
  const bits: string[] = []
  bits.push(p.windowDays == null ? 'no platform window' : `hard window ${p.windowDays} days from checkout`)
  bits.push(`we file by day ${p.targetDays}`)
  if (p.deposit) bits.push(`deposit held $${p.deposit}`)
  bits.push(`route: ${p.route}`)
  if (p.capNote) bits.push(p.capNote)
  return `Live claims desk (${ch}): ${bits.join('; ')}.`
}

export async function loadOtaPlaybook(): Promise<{ playbook: Playbook; overrides: PlaybookOverrides; memoryMap: MemoryMap; lastSync: any }> {
  const [overrides, claimsOverrides, memoryMap, lastSync] = await Promise.all([
    getSetting<PlaybookOverrides>(OTA_PLAYBOOK_KEY, {}),
    getSetting<Record<string, ChannelPolicy>>(CLAIMS_POLICY_KEY, {}),
    getSetting<MemoryMap>(OTA_PLAYBOOK_MEMORY_KEY, {}),
    getSetting<any>('ota_playbook_sync', null),
  ])
  const playbook = mergePlaybook(overrides)
  // The claims row is the one cell with a second source of truth in the app. Stitch the live desk
  // in so Eve quotes the number /claims is actually using, whatever the prose says.
  for (const ch of OTA_CHANNELS) {
    const p = policyFor(CLAIMS_KEY[ch], claimsOverrides) || DEFAULT_CHANNEL_POLICY['Other']
    const c = playbook[ch].claims
    const line = claimsLine(ch, p)
    if (!c.stay.includes(line)) c.stay = (c.stay ? c.stay.replace(/\s*$/, '') + ' ' : '') + line
  }
  return { playbook, overrides: overrides || {}, memoryMap: memoryMap || {}, lastSync }
}

export async function saveOtaCell(ch: OtaChannel, topic: OtaTopic, patch: Partial<PlaybookCell>, by: string): Promise<{ ok: boolean; error?: string }> {
  const overrides = (await getSetting<PlaybookOverrides>(OTA_PLAYBOOK_KEY, {})) || {}
  const next: PlaybookOverrides = { ...overrides, [ch]: { ...(overrides[ch] || {}) } }
  const cur = (next[ch] as any)[topic] || {}
  const cell: Partial<PlaybookCell> = { ...cur }
  if (typeof patch.stay === 'string') cell.stay = patch.stay.trim().slice(0, 2000)
  if (typeof patch.platform === 'string') { cell.platform = patch.platform.trim().slice(0, 2000); cell.asOf = new Date().toISOString().slice(0, 10) }
  if (typeof patch.verified === 'boolean') cell.verified = patch.verified
  cell.by = by; cell.at = new Date().toISOString()
  ;(next[ch] as any)[topic] = cell
  return setSetting(OTA_PLAYBOOK_KEY, next, by)
}

export async function resetOtaCell(ch: OtaChannel, topic: OtaTopic, by: string): Promise<{ ok: boolean; error?: string }> {
  const overrides = (await getSetting<PlaybookOverrides>(OTA_PLAYBOOK_KEY, {})) || {}
  if (!overrides[ch] || !(overrides[ch] as any)[topic]) return { ok: true }
  const next: PlaybookOverrides = { ...overrides, [ch]: { ...(overrides[ch] || {}) } }
  delete (next[ch] as any)[topic]
  return setSetting(OTA_PLAYBOOK_KEY, next, by)
}

export type OtaSyncReceipt = {
  ok: boolean; at: string; by: string
  cells: number; taught: number; updated: number; unchanged: number; probes: number; asked: number; gaps: number
  errors: string[]
}

/**
 * Teach → test. Safe to run nightly: an unchanged cell costs one settings read and nothing else.
 * `askGaps` raises a question per empty Stay half (deduped by lib/eve/questions.ts on words + scope,
 * so it never piles up).
 */
export async function syncOtaPlaybook(opts: { by?: string; askGaps?: boolean } = {}): Promise<OtaSyncReceipt> {
  const by = opts.by || 'system'
  const receipt: OtaSyncReceipt = { ok: true, at: new Date().toISOString(), by, cells: 0, taught: 0, updated: 0, unchanged: 0, probes: 0, asked: 0, gaps: 0, errors: [] }
  const { playbook, memoryMap } = await loadOtaPlaybook()
  const map: MemoryMap = { ...memoryMap }

  for (const ch of OTA_CHANNELS) {
    for (const t of OTA_TOPICS) {
      const c = playbook[ch][t.key]
      const text = memoryTextFor(ch, t.key, c)
      if (!text) continue
      receipt.cells++
      const key = cellKey(ch, t.key)
      const hash = hashOf(text + '|' + (c.verified ? 'v' : 'u'))
      const prior = map[key]
      if (prior && prior.hash === hash) { receipt.unchanged++; continue }
      const saved = await saveMemory({
        kind: 'rule', text,
        why: `OTA playbook — ${ch} / ${topicLabel(t.key)}${c.verified ? ', confirmed by Jon' : ', from the channel’s published rules (unconfirmed)'}. Edited at Settings → Eve → OTA playbook.`,
        scope: `channel:${ch}`,
        weight: c.verified ? 9 : 6,
        source: c.verified ? 'jon' : 'doc',
        confidence: c.verified ? 1 : 0.7,
        created_by: by,
        evidence: { ota: { channel: ch, topic: t.key }, sources: c.sources || [], asOf: c.asOf || null },
      })
      if (!saved.ok || !saved.id) { receipt.errors.push(`${key}: ${saved.error || 'not saved'}`); continue }
      const isNew = !prior || prior.id !== saved.id
      // A small edit reads as the same thought to the dedupe and only reinforces the old row. The
      // playbook is the source of truth for its own cells, so the wording is rewritten in place.
      if (saved.deduped && !isNew) {
        try { await supabaseAdmin().from('eve_memory').update({ text, weight: c.verified ? 9 : 6, source: c.verified ? 'jon' : 'doc', updated_at: new Date().toISOString() }).eq('id', saved.id) } catch { /* reinforced, not rewritten */ }
      }
      // The old wording is superseded, never deleted — /eve shows what changed. Done here rather than
      // through saveMemory's `supersedes` because the dedupe path can hand back a different twin.
      if (prior && isNew) {
        try { await supabaseAdmin().from('eve_memory').update({ superseded_by: saved.id, updated_at: new Date().toISOString() }).eq('id', prior.id).is('superseded_by', null) } catch { /* cosmetic */ }
      }
      if (prior) receipt.updated++; else receipt.taught++
      map[key] = { id: saved.id, hash, at: new Date().toISOString() }
      // A probe only for a memory that is actually new: re-arming an existing one nightly would make
      // it due every morning and drown the self-test in OTA questions.
      if (isNew && !saved.deduped) {
        try { const p = await probeForMemory(saved.id, 'rule'); if (p.ok && !p.rearmed) receipt.probes++ } catch { /* the memory stands without its probe */ }
      }
    }
  }

  const gaps = playbookGaps(playbook)
  receipt.gaps = gaps.length
  if (opts.askGaps !== false) {
    // Only the money topics earn a question; "how do we reach Expedia" can wait for the editor.
    for (const g of gaps.filter(x => ASK_TOPICS.includes(x.topic))) {
      try {
        const r = await askQuestion({
          question: `On ${g.channel} bookings, what is our process for ${g.label.toLowerCase().replace(/\s+—.*$/, '')} — ${g.ask}?`,
          why: `The OTA playbook has ${g.channel}'s own rule for this but not ours. Until you tell me, I answer guests and the team from the platform's default, which may not be what we do. Your answer fills the ${g.channel} / ${g.label} cell of the playbook and becomes a rule I keep.`,
          scope: `channel:${g.channel}`,
          kind: 'gap',
          evidence: { ota: { channel: g.channel, topic: g.topic } },
          source: 'system',
        })
        if (r.ok && !r.repeated) receipt.asked++
      } catch (e: any) { receipt.errors.push(`ask ${g.channel}/${g.topic}: ${String(e?.message || e).slice(0, 120)}`) }
    }
  }

  await setSetting(OTA_PLAYBOOK_MEMORY_KEY, map, by)
  await setSetting('ota_playbook_sync', receipt, by)
  receipt.ok = receipt.errors.length === 0
  return receipt
}

/**
 * Jon answered an OTA gap question: the answer becomes the cell's Stay half, verified, and the next
 * sync (called here, quietly) turns it into the weight-9 memory + probe. Called from
 * lib/eve/questions.ts answerQuestion via evidence.ota.
 */
export async function applyOtaAnswer(evidence: any, answer: string, by: string): Promise<{ ok: boolean; error?: string }> {
  const ch = evidence?.ota?.channel as OtaChannel
  const topic = evidence?.ota?.topic as OtaTopic
  if (!OTA_CHANNELS.includes(ch) || !OTA_TOPICS.some(t => t.key === topic)) return { ok: false, error: 'not an OTA question' }
  const text = String(answer || '').trim()
  if (!text) return { ok: false, error: 'empty answer' }
  const r = await saveOtaCell(ch, topic, { stay: text, verified: true }, by)
  if (!r.ok) return r
  try { await syncOtaPlaybook({ by, askGaps: false }) } catch { /* the cell is saved; the nightly sync teaches it */ }
  return { ok: true }
}

/** For the Eve tool and the admin page: one channel, or all, with the gaps spelled out. */
export async function otaPlaybookView(channel?: OtaChannel | null, topic?: OtaTopic | null): Promise<any> {
  const { playbook, lastSync } = await loadOtaPlaybook()
  const chans = channel ? [channel] : OTA_CHANNELS.filter(c => c !== 'Other')
  const topics = topic ? OTA_TOPICS.filter(t => t.key === topic) : OTA_TOPICS
  const out: any = { channels: {}, gaps: [] as string[], last_sync: lastSync?.at || null }
  for (const ch of chans) {
    out.channels[ch] = {}
    for (const t of topics) {
      const c = playbook[ch][t.key]
      out.channels[ch][t.key] = {
        topic: t.label,
        our_process: c.stay || null,
        platform_rule: c.platform || null,
        confirmed_by_jon: c.verified,
        platform_rule_checked: c.asOf || null,
        sources: c.sources && c.sources.length ? c.sources : undefined,
      }
      if (!c.stay && ch !== 'Other') out.gaps.push(`${ch} / ${t.label}: no Stay process recorded — ask Jon before promising a guest anything`)
    }
  }
  return out
}

/** How many gap questions are open right now — for the admin page header. */
export async function openOtaQuestions(): Promise<number> {
  try {
    const { data } = await supabaseAdmin().from('eve_questions').select('id,evidence').eq('status', 'open').limit(300)
    return ((data as any[]) || []).filter(q => q?.evidence && typeof q.evidence === 'object' && q.evidence.ota).length
  } catch { return 0 }
}
