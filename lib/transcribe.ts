// SPEECH TO TEXT (2026-09-21). One job: hand it a URL to an audio file, get back text.
//
// Deepgram is the provider because of one property that matters here: it fetches the audio ITSELF
// from a URL. Talkroute hands us a temporary signed link to the recording, so with Deepgram the
// serverless function posts a JSON body of about eighty bytes and never downloads or re-uploads a
// megabyte of audio — which is what would otherwise blow the function's memory and time budget on
// a long call. Whisper-style APIs need the file uploaded, so they are not used here.
//
// The key is pasted on Users & admin → Talkroute (sealed with the vault key, same as the Talkroute
// key itself). Nothing transcribes until it exists; the rest of the phone integration is unaffected.
import 'server-only'
import { getSetting, setSetting } from './app-settings'
import { encryptSecret, decryptSecret, vaultKeyReady } from './vault'

export const TRANSCRIBE_KEY = 'transcribe'

export type TranscribeSettings = {
  provider?: 'deepgram'
  apiKeyCipher?: string | null
  apiKeyPlain?: string | null
  keyHint?: string | null
  connectedBy?: string | null
  connectedAt?: string | null
  /** master switch — off means calls are still logged, just never transcribed */
  enabled?: boolean
  /** calls shorter than this are not worth a transcript (a hangup on a greeting) */
  minSeconds?: number
  /** stop transcribing for the day once the ledger passes this */
  usdPerDay?: number
  lastError?: string | null
}

export const TRANSCRIBE_DEFAULTS = { minSeconds: 25, usdPerDay: 3, enabled: true }
/** Deepgram nova-3 list price, per minute of audio. Used for the ledger and the daily cap. */
export const USD_PER_MINUTE = 0.0043

export async function getTranscribeSettings(): Promise<TranscribeSettings> {
  return await getSetting<TranscribeSettings>(TRANSCRIBE_KEY, {})
}
export async function saveTranscribeSettings(patch: Partial<TranscribeSettings>, actor?: string | null) {
  const cur = await getTranscribeSettings()
  return setSetting(TRANSCRIBE_KEY, { ...cur, ...patch }, actor || null)
}
export async function transcribeKey(): Promise<string> {
  const env = String(process.env.DEEPGRAM_API_KEY || '').trim()
  if (env) return env
  const s = await getTranscribeSettings()
  if (s.apiKeyCipher) { try { return decryptSecret(s.apiKeyCipher) } catch { return '' } }
  return String(s.apiKeyPlain || '').trim()
}
export async function transcribeReady(): Promise<boolean> {
  const s = await getTranscribeSettings()
  if (s.enabled === false) return false
  return !!(await transcribeKey())
}
export async function storeTranscribeKey(key: string, actor: string) {
  const k = String(key || '').trim()
  if (k.length < 20 || /\s/.test(k)) return { ok: false, error: 'That does not look like a Deepgram API key.' }
  const patch: Partial<TranscribeSettings> = {
    provider: 'deepgram', keyHint: k.slice(-4), connectedBy: actor, connectedAt: new Date().toISOString(),
    enabled: true, lastError: null,
  }
  if (vaultKeyReady()) { patch.apiKeyCipher = encryptSecret(k); patch.apiKeyPlain = null }
  else { patch.apiKeyPlain = k; patch.apiKeyCipher = null }
  return saveTranscribeSettings(patch, actor)
}
export async function clearTranscribeKey(actor: string) {
  return saveTranscribeSettings({ apiKeyCipher: null, apiKeyPlain: null, keyHint: null, connectedBy: null, connectedAt: null }, actor)
}

export type TranscriptResult = {
  ok: boolean
  text: string
  /** speaker-labelled lines, when diarization worked */
  lines: { speaker: number; text: string }[]
  seconds: number
  usd: number
  /** `expired` means the signed URL is dead and the call must be re-read from Talkroute. */
  status: 'done' | 'failed' | 'expired'
  error?: string
}

/**
 * Transcribe the audio at `url`.
 *
 * Diarization is on because a call transcript without speakers is nearly unreadable — "yeah the
 * code is 4432" means something different depending on who said it. Deepgram numbers the speakers
 * rather than naming them; who is who is inferred at summary time from what they say.
 */
export async function transcribeUrl(url: string, opts: { timeoutMs?: number } = {}): Promise<TranscriptResult> {
  const empty: TranscriptResult = { ok: false, text: '', lines: [], seconds: 0, usd: 0, status: 'failed' }
  const key = await transcribeKey()
  if (!key) return { ...empty, error: 'No transcription key.' }
  if (!url) return { ...empty, error: 'No recording URL.' }
  const q = new URLSearchParams({ model: 'nova-3', punctuate: 'true', diarize: 'true', smart_format: 'true', detect_language: 'true' })
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs || 60_000)
  try {
    const r = await fetch('https://api.deepgram.com/v1/listen?' + q.toString(), {
      method: 'POST',
      headers: { Authorization: 'Token ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: ctl.signal,
      cache: 'no-store',
    })
    const j: any = await r.json().catch(() => ({}))
    if (!r.ok) {
      const msg = String(j?.err_msg || j?.error || j?.message || r.statusText).slice(0, 240)
      // Deepgram reports a dead source URL as a REMOTE_CONTENT / fetch failure, not as its own 4xx.
      const expired = /403|404|410|expired|could not|unable to fetch|remote_content/i.test(msg) || r.status === 400
      return { ...empty, status: expired ? 'expired' : 'failed', error: `Deepgram ${r.status}: ${msg}` }
    }
    const alt = j?.results?.channels?.[0]?.alternatives?.[0] || {}
    const seconds = Math.round(Number(j?.metadata?.duration) || 0)
    const words: any[] = Array.isArray(alt.words) ? alt.words : []
    // Fold the word stream into speaker turns. Deepgram gives a speaker per word; a turn ends when
    // the speaker number changes.
    const lines: { speaker: number; text: string }[] = []
    for (const w of words) {
      const sp = Number(w.speaker) || 0
      const t = String(w.punctuated_word || w.word || '')
      if (!t) continue
      const last = lines[lines.length - 1]
      if (last && last.speaker === sp) last.text += ' ' + t
      else lines.push({ speaker: sp, text: t })
    }
    const text = String(alt.transcript || '').trim()
    if (!text) return { ...empty, status: 'done', ok: true, seconds, usd: (seconds / 60) * USD_PER_MINUTE, error: 'Silent recording.' }
    return { ok: true, text, lines, seconds, usd: Math.round((seconds / 60) * USD_PER_MINUTE * 10000) / 10000, status: 'done' }
  } catch (e: any) {
    const aborted = e?.name === 'AbortError'
    return { ...empty, error: aborted ? 'Transcription timed out.' : String(e?.message || e).slice(0, 200) }
  } finally { clearTimeout(timer) }
}

/** The transcript as a readable script for a person or for Claude. */
export function transcriptScript(lines: { speaker: number; text: string }[], fallback: string): string {
  if (!lines.length) return fallback
  return lines.map(l => `Speaker ${l.speaker}: ${l.text}`).join('\n')
}
