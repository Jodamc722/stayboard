// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// THE THREE CALLS THAT MAKE A PIECE, server side. Models are reached only through the app's routing
// (lib/ai-models modelPairFor → lib/anthropic-call anthropicMessages), so the tier is a setting, the spend is written
// to the usage ledger and the app-wide guard applies; Ad Studio's own monthly cap is checked first (lib/adx/budget).
//   concepts  three ideas + the photographs the piece may use            (adx-concept)
//   copy      three ways to say the chosen idea                          (adx-copy)
//   compose   the art director writes the composition, looking at the photographs   (adx-compose)
//             → validated and clamped (sanitizeComposition) → audited → one repair pass if the audit fails
// What comes back from a model is DATA: it is parsed as JSON and goes through the validator; nothing else is done
// with it.
import 'server-only'
import { anthropicMessages } from '@/lib/anthropic-call'
import { modelPairFor } from '@/lib/ai-models'
import { usageOf, costUsd } from '@/lib/ai-usage'
import { looseJson } from '@/lib/ad-json'
import { MUSIC } from '@/lib/ad-engine'
import { sanitizeComposition, canvasFor, cleanText, LOOK_KEYS, type Brief, type Composition, type PhotoAsset } from './composition'
import { conceptPrompt, copyPrompt, composerSystem, composerUser, repairPrompt, reviewPrompt, sceneCount, EXAMPLE_FOR } from './brief'
import { IDENTITIES } from './identities'
import { auditComposition, issueLines, MEASURED_CODES, type Issue } from './audit'
import { approxMeasure } from './player'
import { housePiece } from './seeds'
import { adxBudgetBlock, bustAdxSpend } from './budget'
import { thumbUrl } from './photos'
import { newPieceId } from './store'

export type Concept = { name: string; idea: string; look: string; ground: string[]; hook: string; lead: string; beats: string[]; why: string }
export type CopyOption = { voice: string; lines: { vo: string; head: string; photo: string }[]; caption: string; hashtags: string[] }
type Fail = { ok: false; status: number; error: string; budget?: boolean }

async function ask(task: string, body: { system?: string; content: any; maxTokens: number; temperature: number }): Promise<{ ok: true; json: any; usd: number } | Fail> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, status: 503, error: 'No AI key is configured for this site, so new designs cannot be made here. The house design still opens.' }
  const cap = await adxBudgetBlock()
  if (cap) return { ok: false, status: 429, error: cap, budget: true }
  const { model, fallback } = await modelPairFor(task)
  const messages: any[] = [{ role: 'user', content: body.content }]
  let usd = 0
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await anthropicMessages(key, { model, max_tokens: body.maxTokens, temperature: attempt ? 0.2 : body.temperature, ...(body.system ? { system: body.system } : {}), messages }, fallback, task)
    bustAdxSpend()
    if (!r.ok) {
      const e = r.data?.error
      if (e?.type === 'budget_exceeded') return { ok: false, status: 429, budget: true, error: String(e.message || 'Today’s AI budget is used up.') + ' An admin can raise it in Settings → AI models.' }
      if (r.status === 429 || r.status === 529 || r.status === 503) return { ok: false, status: 502, error: 'The AI is busy right now (it was retried three times). Give it a minute and press it again.' }
      return { ok: false, status: 502, error: `The AI call failed (${r.status}${e?.message ? ': ' + String(e.message).slice(0, 140) : ''}). Try again.` }
    }
    try { usd += costUsd(String(r.data?.model || r.model), usageOf(r.data)) } catch { /* the ledger has the real number */ }
    const text = (r.data?.content || []).filter((c: any) => c?.type === 'text').map((c: any) => String(c.text || '')).join('')
    const cut = r.data?.stop_reason === 'max_tokens'
    const j = cut ? null : looseJson(text)
    if (j) return { ok: true, json: j, usd }
    messages.push({ role: 'assistant', content: text || '(empty)' })
    messages.push({ role: 'user', content: (cut ? 'That reply was cut off. Give the same answer again, more compactly, ' : 'That reply was not valid JSON. Give the same answer again ') + 'as ONLY valid JSON: double quotes, no trailing commas, nothing before or after.' })
  }
  return { ok: false, status: 502, error: 'The answer came back garbled twice. Try again.' }
}

const str = (v: unknown, n: number) => cleanText(v, n)

export async function runConcepts(brief: Brief, photos: Record<string, PhotoAsset>): Promise<{ ok: true; concepts: Concept[]; usd: number } | Fail> {
  const id = IDENTITIES[brief.moment]
  const a = await ask('adx-concept', { content: conceptPrompt(brief, photos), maxTokens: 2600, temperature: 0.8 })
  if (!a.ok) return a
  const keys = Object.keys(photos)
  const concepts: Concept[] = (Array.isArray(a.json?.concepts) ? a.json.concepts : []).slice(0, 3).map((c: any) => ({
    name: str(c?.name, 60), idea: str(c?.idea, 320),
    look: (LOOK_KEYS as readonly string[]).indexOf(c?.look) >= 0 ? c.look : id.looks[0],
    ground: (Array.isArray(c?.ground) ? c.ground : []).map((g: any) => String(g || '')).filter((g: string) => Object.prototype.hasOwnProperty.call(id.palette, g)).slice(0, 3),
    hook: String(c?.hook || '').replace(/[\u0000-\u001f]+/g, ' ').slice(0, 80), lead: keys.indexOf(String(c?.lead)) >= 0 ? String(c.lead) : keys[0] || '',
    beats: (Array.isArray(c?.beats) ? c.beats : []).map((b: any) => str(b, 160)).filter(Boolean).slice(0, 6), why: str(c?.why, 200),
  })).filter((c: Concept) => c.name && c.idea)
  if (!concepts.length) return { ok: false, status: 502, error: 'No usable ideas came back. Try again.' }
  return { ok: true, concepts, usd: a.usd }
}

export async function runCopy(brief: Brief, concept: Concept, photos: Record<string, PhotoAsset>): Promise<{ ok: true; options: CopyOption[]; usd: number } | Fail> {
  const a = await ask('adx-copy', { content: copyPrompt(brief, concept, photos), maxTokens: 3000, temperature: 0.8 })
  if (!a.ok) return a
  const keys = Object.keys(photos), n = sceneCount(brief.seconds)
  const options: CopyOption[] = (Array.isArray(a.json?.options) ? a.json.options : []).slice(0, 3).map((o: any) => {
    const used = new Set<string>()
    return {
      voice: str(o?.voice, 40),
      lines: (Array.isArray(o?.lines) ? o.lines : []).slice(0, n).map((l: any) => {
        let photo = keys.indexOf(String(l?.photo)) >= 0 ? String(l.photo) : ''
        if (photo && used.has(photo)) photo = ''        // never the same photograph twice
        if (photo) used.add(photo)
        return { vo: str(l?.vo, 200), head: String(l?.head || '').replace(/\\n/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f]+/g, ' ').slice(0, 120), photo }
      }).filter((l: { vo: string; head: string }) => l.vo || l.head),
      caption: str(o?.caption, 600),
      hashtags: (Array.isArray(o?.hashtags) ? o.hashtags : []).map((h: any) => String(h || '').trim()).filter((h: string) => /^#[A-Za-z0-9_]{1,40}$/.test(h)).slice(0, 4),
    }
  }).filter((o: CopyOption) => o.lines.length >= 2)
  if (!options.length) return { ok: false, status: 502, error: 'No usable script came back. Try again.' }
  return { ok: true, options, usd: a.usd }
}

/** The music a piece starts with: the event's own track, with its licence credit (from the studio's bundled list, never from a model). */
export function musicFor(moment: string): { track: string; gain: number; credit: string } {
  const m = MUSIC.find(x => x.key === (IDENTITIES[moment]?.music || ''))
  return m ? { track: m.key, gain: 0.5, credit: m.credit } : { track: '', gain: 0.5, credit: '' }
}

export async function runCompose(brief: Brief, concept: Concept, option: CopyOption, photos: Record<string, PhotoAsset>, by: string, priorUsd = 0): Promise<{ ok: true; doc: Composition; notes: string[]; issues: Issue[]; usd: number; repaired: boolean } | Fail> {
  const example = housePiece(EXAMPLE_FOR[brief.moment] || 'thanksgiving')
  const system = composerSystem(brief.audience, example)
  // the photographs, small, in the order of the list — the composer designs from what it sees
  const images = Object.values(photos).slice(0, 10).map(p => ({ type: 'image', source: { type: 'url', url: thumbUrl(p.src) } }))
  const user = composerUser(brief, concept, option.lines, option.caption, photos)
  const a = await ask('adx-compose', { system, content: [...images, { type: 'text', text: user }], maxTokens: 14000, temperature: 0.7 })
  if (!a.ok) return a
  let usd = a.usd
  const trusted = { id: newPieceId(), title: `${brief.momentName} · ${concept.name}`, brief, canvas: canvasFor(brief.channel), photos, music: musicFor(brief.moment), meta: { updatedBy: by, origin: 'composer' as const } }
  let authored: any = a.json
  let { doc, notes } = sanitizeComposition(authored, trusted)
  if (!doc.scenes.length) return { ok: false, status: 502, error: 'The design came back empty. Try again.' }
  let audit = auditComposition(doc, approxMeasure)
  // ONE repair pass, for what can be judged without the browser's exact type measure (those are shown to the person instead)
  const hard = audit.issues.filter(x => x.sev === 'fail' && MEASURED_CODES.indexOf(x.code) < 0)
  let repaired = false
  if (hard.length) {
    const ids = Array.from(new Set(hard.map(x => x.scene).filter(Boolean))) as string[]
    const r = await ask('adx-compose', {
      system,
      content: [...images, { type: 'text', text: user }, { type: 'text', text: 'YOUR DOCUMENT:\n' + JSON.stringify({ concept: doc.concept, tokens: doc.tokens, scenes: doc.scenes.map(s => ({ id: s.id, name: s.name, dur: s.dur, transitionIn: s.transitionIn, layers: s.layers })) }) + '\n\n' + repairPrompt(issueLines(hard), ids.length ? ids : doc.scenes.map(s => s.id)) }],
      maxTokens: 9000, temperature: 0.3,
    })
    if (r.ok && Array.isArray(r.json?.scenes) && r.json.scenes.length) {
      usd += r.usd
      const fixed = new Map<string, any>(r.json.scenes.filter((s: any) => s && typeof s.id === 'string').map((s: any) => [s.id, s]))
      authored = { ...authored, tokens: doc.tokens, concept: doc.concept, script: doc.script, social: doc.social, scenes: doc.scenes.map(s => fixed.get(s.id) || { id: s.id, name: s.name, dur: s.dur, transitionIn: s.transitionIn, layers: s.layers }) }
      const again = sanitizeComposition(authored, trusted)
      if (again.doc.scenes.length) {
        const audit2 = auditComposition(again.doc, approxMeasure)
        if (audit2.fails <= audit.fails) { doc = again.doc; notes = notes.concat(again.notes); audit = audit2; repaired = true }
      }
    }
  }
  doc.meta.costUsd = Math.round((usd + priorUsd) * 10000) / 10000
  return { ok: true, doc, notes, issues: audit.issues, usd, repaired }
}

// ── the creative director's review (Jon, 2026-11-20: "a true Claude creative build as if creating here") ─────────
export const REVIEW_ROUNDS = 2
export type Still = { scene: string; data: string }
/**
 * One look at the rendered piece. `stills` are the scenes as JPEGs drawn by the browser with the same player that
 * exports; `findings` is the browser's measured audit. Returns the piece (revised or as it was), what the director
 * said, and which scenes changed. The reply is data: whole scenes, merged by id and put through the validator; a
 * revision that makes the measurable problems worse is thrown away.
 */
export async function runReview(doc: Composition, pool: Record<string, PhotoAsset>, stills: Still[], findings: string, round: number): Promise<{ ok: true; doc: Composition; verdict: 'ship' | 'revised'; notes: string[]; changed: string[]; usd: number } | Fail> {
  const example = housePiece(EXAMPLE_FOR[doc.brief.moment] || 'thanksgiving')
  const system = composerSystem(doc.brief.audience === 'owners' ? 'owners' : 'guests', example)
  const photos: Record<string, PhotoAsset> = { ...pool, ...doc.assets.photos }
  const content: any[] = []
  for (const st of stills) {
    const sc = doc.scenes.find(s => s.id === st.scene); if (!sc) continue
    content.push({ type: 'text', text: `SCENE ${sc.id} — "${sc.name}", ${sc.dur.toFixed(1)} s:` })
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: st.data } })
  }
  if (!content.length) return { ok: false, status: 400, error: 'No frames came through to look at.' }
  content.push({ type: 'text', text: reviewPrompt(doc, findings, photos, round, REVIEW_ROUNDS) })
  const a = await ask('adx-compose', { system, content, maxTokens: 12000, temperature: 0.5 })
  if (!a.ok) return a
  const notes = (Array.isArray(a.json?.notes) ? a.json.notes : []).map((n: any) => cleanText(n, 220)).filter(Boolean).slice(0, 6)
  const fresh = new Map<string, any>((Array.isArray(a.json?.scenes) ? a.json.scenes : []).filter((s: any) => s && typeof s.id === 'string' && doc.scenes.some(x => x.id === s.id)).map((s: any) => [s.id, s]))
  const cost = (d: Composition) => { d.meta.costUsd = Math.round(((doc.meta.costUsd || 0) + a.usd) * 10000) / 10000; return d }
  if (a.json?.verdict === 'ship' || !fresh.size) return { ok: true, doc: cost({ ...doc, meta: { ...doc.meta } }), verdict: 'ship', notes, changed: [], usd: a.usd }
  const authored = { concept: doc.concept, tokens: doc.tokens, script: doc.script, social: doc.social, scenes: doc.scenes.map(s => fresh.get(s.id) || { id: s.id, name: s.name, dur: s.dur, transitionIn: s.transitionIn, layers: s.layers }) }
  const trusted = { id: doc.id, title: doc.title, brief: doc.brief, canvas: doc.canvas, photos, music: doc.assets.audio.music, meta: { ...doc.meta } }
  const next = sanitizeComposition(authored, trusted).doc
  const hard = (d: Composition) => auditComposition(d, approxMeasure).issues.filter(x => x.sev === 'fail' && MEASURED_CODES.indexOf(x.code) < 0).length
  if (next.scenes.length !== doc.scenes.length || hard(next) > hard(doc)) return { ok: true, doc: cost({ ...doc, meta: { ...doc.meta } }), verdict: 'ship', notes: notes.concat('A revision was drawn and set aside: it broke more rules than it fixed.'), changed: [], usd: a.usd }
  return { ok: true, doc: cost(next), verdict: 'revised', notes, changed: Array.from(fresh.keys()), usd: a.usd }
}
