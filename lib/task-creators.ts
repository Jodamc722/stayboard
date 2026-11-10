// SWITCHES FOR THE CREATORS THAT HAD NONE (Jon, 2026-11-10, approving the Upkeep → Automations
// proposal): four things ran "always on" with no way to stop them short of a deploy.
//
//   connectingDoors   lib/connecting-doors   the "Open / Close connecting door" tasks and title notes
//   walkFixTasks      lib/walk-reports       one maintenance task per failed line of a finished walk
//   carry             cron/suggestions       late preventative tasks carried to today + own duplicates removed
//   lostFoundMove     lib/lost-found-pay     an unfinished Lost & Found delivery moved to the next Tuesday
//
// ONE settings key, `task_creators`. EVERYTHING DEFAULTS ON and the read FAILS OPEN: a missing row, a
// missing field, junk, or a failed read all mean "on" — exactly how these behaved before the key
// existed. Only an explicit `false` turns one off. Flipped on Upkeep → Automations (owner only).
import 'server-only'
import { getSetting } from './app-settings'

export const TASK_CREATORS_KEY = 'task_creators'
export type TaskCreatorSwitches = { connectingDoors: boolean; walkFixTasks: boolean; carry: boolean; lostFoundMove: boolean }
export const TASK_CREATORS_DEFAULTS: TaskCreatorSwitches = { connectingDoors: true, walkFixTasks: true, carry: true, lostFoundMove: true }

/** Stored value → switches. Anything but an explicit false is ON. */
export function mergeTaskCreators(raw: any): TaskCreatorSwitches {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return { connectingDoors: s.connectingDoors !== false, walkFixTasks: s.walkFixTasks !== false, carry: s.carry !== false, lostFoundMove: s.lostFoundMove !== false }
}

export async function getTaskCreators(): Promise<TaskCreatorSwitches> {
  try { return mergeTaskCreators(await getSetting<any>(TASK_CREATORS_KEY, null)) } catch { return { ...TASK_CREATORS_DEFAULTS } }
}

/** Is this one creator on? Fail-open. */
export async function taskCreatorOn(which: keyof TaskCreatorSwitches): Promise<boolean> {
  try { return (await getTaskCreators())[which] !== false } catch { return true }
}
