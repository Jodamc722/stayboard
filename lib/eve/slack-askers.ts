// WHO MAY ASK EVE A QUESTION IN SLACK.
//
// Jon, 2026-09-22: "can we have it where only select user can ask eve questions? in slack", and he
// chose an editable list of named people over a role check, with one short line back to anyone not
// on it. This supersedes the 2026-09-10 position ("I would approve anyone to use eve for now...
// give free access"), which is why the gate did not exist until now.
//
// SCOPE: this gates ANSWERING ONLY -- the front-tag path. Translation (the tag at the end) stays
// open to everyone, deliberately: it is the crews making their own messages readable to the office,
// it reveals nothing, and restricting it would defeat the point of shipping it this morning.
//
// AN EMPTY LIST MEANS EVERYONE, and that is the safe default rather than a clever one. If an empty
// list meant "nobody", then shipping this would silently switch Eve off for the whole company and
// look exactly like the outage we spent this afternoon chasing. So the gate only starts biting once
// somebody has actually been named.
//
// MATCHED ON SLACK ID FIRST. The Slack user id is what the event actually carries; the Lighthouse
// email needs slack_user_map or a profile-email match to resolve and is the thing most likely to be
// missing. Either one being on the list is enough.
import { getSetting, setSetting } from '@/lib/app-settings'

export const EVE_ASKERS_KEY = 'eve_slack_askers'

export type EveAskers = {
  /** Slack user ids (U…), the primary match. */
  slackIds: string[]
  /** Lighthouse emails, a fallback for people whose Slack id nobody has recorded. */
  emails: string[]
  /** Shown to anyone turned away, so the line can name a person instead of a policy. */
  askInstead: string
}

export const DEFAULT_ASKERS: EveAskers = { slackIds: [], emails: [], askInstead: '' }

const str = (v: any) => typeof v === 'string' ? v : (v == null ? '' : String(v))
const cleanList = (v: any, lower: boolean): string[] => {
  const out: string[] = []
  const seen: Record<string, boolean> = {}
  for (const x of (Array.isArray(v) ? v : [])) {
    const s = lower ? str(x).trim().toLowerCase() : str(x).trim()
    if (s && !seen[s]) { seen[s] = true; out.push(s) }
  }
  return out.slice(0, 200)
}

export function normalise(v: any): EveAskers {
  return {
    slackIds: cleanList(v?.slackIds, false),
    emails: cleanList(v?.emails, true),
    askInstead: str(v?.askInstead).slice(0, 120),
  }
}

export async function getEveAskers(): Promise<EveAskers> {
  try { return normalise(await getSetting<any>(EVE_ASKERS_KEY, DEFAULT_ASKERS)) }
  catch { return DEFAULT_ASKERS }
}

export async function saveEveAskers(next: any, actor: string): Promise<EveAskers> {
  const clean = normalise(next)
  await setSetting(EVE_ASKERS_KEY, clean, actor)
  return clean
}

export type AskVerdict = { allowed: true } | { allowed: false; line: string }

/**
 * May this person have Eve answer a question? An empty list means everyone (see above).
 *
 * The refusal is ONE LINE, names somebody to ask instead when we have a name, and never explains
 * the permission model -- an explanation in a shared channel is an invitation to argue with it.
 */
export function canAskEve(cfg: EveAskers, slackUserId: string, email: string | null): AskVerdict {
  const named = cfg.slackIds.length + cfg.emails.length
  if (named === 0) return { allowed: true }
  const id = str(slackUserId).trim()
  const mail = str(email).trim().toLowerCase()
  if (id && cfg.slackIds.indexOf(id) >= 0) return { allowed: true }
  if (mail && cfg.emails.indexOf(mail) >= 0) return { allowed: true }
  const who = cfg.askInstead.trim()
  return {
    allowed: false,
    line: who
      ? `I only take questions from the ops team here — ${who} can ask me and pass it on.`
      : 'I only take questions from the ops team here — ask one of them and they can put it to me.',
  }
}
