// EVE, QUIET BY DEFAULT IN SLACK (Jon, 2026-11-19: "let's clean up the briefs and all the Eve noise").
// Four kinds of Slack post are off unless someone turns one back on. Each still exists in Lighthouse
// (the Glitches board, the Eve tab, the bell); what stops is the message in the channel. Two more
// switches cut what she files inside Lighthouse (215 proposals in a week, 44 reply drafts expired unread).
//
//   guestIssueFyi     "Guest issue — <unit>… No glitch filed" in #vr-customercareteam. Safety still posts.
//   stillOpenNudges   "is this still open? … Reply done" tagged at a person in a field channel.
//   sharedBoardsPost  the daily "Shared boards — N overdue" line in #leadership.
//   fixedNotes        on watch: "fixed — a note is ready for the guest" drafts, slipping-item lists and
//                     the ✅ "done by …" replies.
//   flagThoughts      in Lighthouse: watch findings that can only ever be a note on the Thinking tab
//                     (tomorrow's silent arrivals, a listing off a channel). Nothing is recorded.
//   farOutGuestDrafts in Lighthouse: an automatic reply draft for an unanswered guest is written only when
//                     the guest is in the unit or arrives within two days. "Draft with Eve" on a thread is
//                     unchanged.
//
// To bring one back: app_settings key `eve_quiet`, e.g. { "stillOpenNudges": false }.
import 'server-only'
import { getSetting } from '@/lib/app-settings'

export type QuietKey = 'guestIssueFyi' | 'stillOpenNudges' | 'sharedBoardsPost' | 'fixedNotes' | 'flagThoughts' | 'farOutGuestDrafts'
export const EVE_QUIET_KEY = 'eve_quiet'
const ALL: QuietKey[] = ['guestIssueFyi', 'stillOpenNudges', 'sharedBoardsPost', 'fixedNotes', 'flagThoughts', 'farOutGuestDrafts']

export async function eveQuiet(): Promise<Record<QuietKey, boolean>> {
  let v: any = null
  try { v = await getSetting<any>(EVE_QUIET_KEY, null) } catch { v = null }
  const out = {} as Record<QuietKey, boolean>
  for (const k of ALL) out[k] = v && v[k] === false ? false : true
  return out
}
export async function isQuiet(k: QuietKey): Promise<boolean> { return (await eveQuiet())[k] }
