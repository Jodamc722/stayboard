// WHAT THE TEAM TEACHES EVE, KEPT (Jon, 2026-09-30: "Eve needs to constantly be improving and learning
// and making permanent improvements").
//
// Two lesson books, both read on every relevant call and both written into her long-term memory:
//
//   MATCH LESSONS — every time a person corrects how she tied a Slack report to a Breezeway task or a
//   glitch ("Not this task", "This is the task: …"), the correction is filed with the report, what
//   she picked, what was right and why. lib/eve/investigate reads the latest ones before judging.
//
//   VOICE LESSONS — every time someone has to ask her a follow-up after she posts in Slack ("which
//   unit?", "what task?", "for who?"), that question is filed as a clarity miss. The slack watch
//   records it; her Slack writing reads the latest ones ("people had to ask you X — say X up front").
//
// app_settings keeps the recent 40 of each (fast, in every prompt); saveMemory makes each one
// permanent, so the nightly learning pass and recall can build on it.
import 'server-only'
import { getSetting, setSetting } from '@/lib/app-settings'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const clip = (s: any, n: number) => { const t = str(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }

export type MatchLesson = { at: string; by: string; report: string; unit: string | null; picked: string | null; right: string | null; why: string }
export type VoiceLesson = { at: string; channel: string; herPost: string; question: string; asker: string }

const MATCH_KEY = 'eve_match_lessons'
const VOICE_KEY = 'eve_voice_lessons'

async function remember(text: string, why: string, by: string, kind: 'correction' | 'rule') {
  try {
    const { saveMemory } = await import('./memory')
    await saveMemory({ kind, text: clip(text, 400), why: clip(why, 300), scope: 'portfolio', weight: 7, source: by && by.indexOf('@') > 0 ? 'staff' : 'eve', created_by: by || 'eve' })
  } catch { /* the lesson book still has it */ }
}

export async function recordMatchLesson(l: Omit<MatchLesson, 'at'>): Promise<void> {
  const cur = await getSetting<MatchLesson[]>(MATCH_KEY, [])
  const next = [...(Array.isArray(cur) ? cur : []), { ...l, at: new Date().toISOString() }].slice(-40)
  await setSetting(MATCH_KEY, next, l.by)
  const text = l.right
    ? `Matching Slack reports to work: "${clip(l.report, 120)}"${l.unit ? ' (' + l.unit + ')' : ''} belonged to ${l.right}${l.picked ? `, not ${l.picked}` : ''}. ${l.why}`
    : `Matching Slack reports to work: "${clip(l.report, 120)}"${l.unit ? ' (' + l.unit + ')' : ''} was NOT ${l.picked || 'the task I linked'}. ${l.why}`
  await remember(text, 'a person corrected my match', l.by, 'correction')
}

export async function matchLessonsText(limit = 12): Promise<string> {
  const cur = await getSetting<MatchLesson[]>(MATCH_KEY, [])
  return (Array.isArray(cur) ? cur : []).slice(-limit).map(l =>
    `- "${clip(l.report, 100)}"${l.unit ? ' on ' + l.unit : ''}: ${l.right ? `the right match was ${l.right}` : 'there was no match'}${l.picked ? `; I had picked ${l.picked}` : ''}. Why: ${clip(l.why, 160)}`).join('\n')
}

export async function recordVoiceLesson(l: Omit<VoiceLesson, 'at'>): Promise<void> {
  const cur = await getSetting<VoiceLesson[]>(VOICE_KEY, [])
  const list = Array.isArray(cur) ? cur : []
  if (list.some(x => x.question === l.question && x.herPost === l.herPost)) return
  await setSetting(VOICE_KEY, [...list, { ...l, at: new Date().toISOString() }].slice(-40), 'eve')
  await remember(`When I post in Slack, say it up front: after my post "${clip(l.herPost, 120)}" ${l.asker || 'someone'} had to ask "${clip(l.question, 120)}".`, 'a clarity miss — the team had to ask a follow-up', 'eve', 'rule')
}

export async function voiceLessonsText(limit = 10): Promise<string> {
  const cur = await getSetting<VoiceLesson[]>(VOICE_KEY, [])
  return (Array.isArray(cur) ? cur : []).slice(-limit).map(l => `- After "${clip(l.herPost, 90)}", ${l.asker || 'someone'} asked: "${clip(l.question, 100)}"`).join('\n')
}

export async function listLessons(): Promise<{ match: MatchLesson[]; voice: VoiceLesson[] }> {
  const [m, v] = await Promise.all([getSetting<MatchLesson[]>(MATCH_KEY, []), getSetting<VoiceLesson[]>(VOICE_KEY, [])])
  return { match: (Array.isArray(m) ? m : []).slice().reverse(), voice: (Array.isArray(v) ? v : []).slice().reverse() }
}
