// WHERE A DOOR CODE MAY BE ASKED FOR IN SLACK (Jon, 2026-09-29): "Door codes can be requested by any
// Customer Service team member in CCS and Jon Channel, VR Customer Care channel. Never in team
// channels with field team."
//
// So Slack has exactly two rooms where a code can be asked for, and both are Customer Service's own
// private rooms: #ccs-and-jon and #vr-customercareteam. In either one, anyone in the room may ask —
// through Eve or /doorcode — including the CCS agents who have no Lighthouse login, because the room
// IS the team. What asking gets them is unchanged: the three checks still run (lib/eve/door-code.ts),
// and a release still needs an approver ("all codes released must be approved, except for me, Jon
// the owner"). So in these rooms nobody is below Ask, and Direct (Jon, and whoever he set to Direct)
// stays Direct. Either way the code NEVER goes into the room: it goes to the person who asked, by
// direct message, or in /doorcode's reply that only they can see.
//
// Everywhere else in Slack — every housekeeping, maintenance, building and vendor channel, every group
// DM — a code cannot be asked for at all, by anyone: Eve does not get the tool there and /doorcode says
// where to go. A one-to-one DM keeps the person's own setting, as before.
//
// NO IMPORTS, ON PURPOSE: lib/eve/__tests__/door-code-rooms.test.mjs loads this with plain node. The
// #ccs-and-jon id is the one lib/slack-rules.ts keeps as CH.ccsJon; the test fails if the two drift.

export type DoorCodeSetting = 'off' | 'ask' | 'direct'
/** room = one of the two Customer Service rooms; dm = a one-to-one DM; elsewhere = any other conversation. */
export type DoorCodeSurface = 'room' | 'dm' | 'elsewhere'

export const DOOR_CODE_ROOMS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'C07SBALUTU2', name: '#ccs-and-jon' },
  { id: 'G01TT278P2L', name: '#vr-customercareteam' },
]

/** "#ccs-and-jon or #vr-customercareteam" — for the one-line pointer wherever a code is refused. */
export const DOOR_CODE_ROOM_NAMES = DOOR_CODE_ROOMS.map(r => r.name).join(' or ')

const idOf = (channelId: unknown): string => String(channelId == null ? '' : channelId).trim().toUpperCase()

/** The room's name when this is one of the two Customer Service rooms, else null. */
export function doorCodeRoomName(channelId: unknown): string | null {
  const id = idOf(channelId)
  if (!id) return null
  const r = DOOR_CODE_ROOMS.find(x => x.id === id)
  return r ? r.name : null
}

export function isDoorCodeRoom(channelId: unknown): boolean {
  return doorCodeRoomName(channelId) !== null
}

/** A one-to-one DM (Slack ids that start with D). A group DM is not one: it has other people in it. */
export function isDirectMessage(channelId: unknown): boolean {
  return /^D[A-Z0-9]{2,}$/.test(idOf(channelId))
}

export function doorCodeSurface(channelId: unknown): DoorCodeSurface {
  if (isDoorCodeRoom(channelId)) return 'room'
  if (isDirectMessage(channelId)) return 'dm'
  return 'elsewhere'
}

/**
 * The setting a request made in Slack runs at, from the person's own setting and where they asked.
 * 'refused' — not in this conversation, whoever asks. In a Customer Service room nobody is below Ask
 * and nobody is raised to Direct; in a one-to-one DM the person's own setting stands.
 */
export function slackDoorCodeSetting(personal: DoorCodeSetting, surface: DoorCodeSurface): DoorCodeSetting | 'refused' {
  if (surface === 'elsewhere') return 'refused'
  if (surface === 'room') return personal === 'direct' ? 'direct' : 'ask'
  return personal === 'direct' || personal === 'ask' ? personal : 'off'
}

/** The one line said wherever a code cannot be asked for. */
export const NOT_HERE_LINE = `Door codes are never asked for in this channel — Customer Service requests them in ${DOOR_CODE_ROOM_NAMES}, and the code goes to whoever asked, privately.`
