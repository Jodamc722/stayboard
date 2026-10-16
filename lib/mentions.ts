// TAG → TOLD. The one server call every note box makes after it saves (Jon, 2026-10-14: "all notes
// in Lighthouse you can tag and it notifies them, pop up on their page … clean running late should
// be able to message team in Slack, or in Lighthouse notification").
//
//   tagAndNotify({ text, by, title, link, building, dept, toSlack })
//
// does, in order:
//   1. parses @tags with lib/mentions-parse against the live roster (app_users)
//   2. drops a 'mention' row in app_notifications for each person → the bell AND the pop-up on
//      whatever page they are on (components/MentionPopups)
//   3. DMs each tagged person in Slack when the bot knows them (email match, then name match) —
//      the same text, with the link — unless they muted it (prefs.mute_slack_dm)
//   4. when asked (toSlack: 'channel'), posts the note to the area's Slack room for the building and
//      department, with real <@U…> tags, so "clean running late at 1704" reaches the whole crew
// Nothing here throws: a Slack outage never loses the note.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { notify } from '@/lib/notify'
import { parseMentions, namesFor, describeMentions, type RosterPerson, type ParsedMentions } from '@/lib/mentions-parse'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const APP = () => (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/$/, '')

export type RosterEntry = RosterPerson & { prefs?: any }

/** Active Lighthouse people (the VR business), with the role words the group tags resolve on. */
export async function roster(): Promise<RosterEntry[]> {
  try {
    const { data } = await supabaseAdmin().from('app_users').select('email,status,role,access_role,profile,prefs,businesses').eq('status', 'active')
    return ((data || []) as any[])
      .filter(u => !Array.isArray(u.businesses) || u.businesses.includes('vr'))
      .map(u => ({
        email: str(u.email).toLowerCase(),
        name: str(u.profile?.name) || str(u.email).split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        role: u.role === 'admin' ? 'admin' : (str(u.access_role) || null),
        prefs: u.prefs || null,
      }))
      .filter(u => u.email)
  } catch { return [] }
}

export type TagInput = {
  /** The note as typed. */
  text: string
  /** Author email. Never notified about their own tag. */
  by: string
  /** Author display name, if the caller has it; else the email prefix. */
  byName?: string | null
  /** What the note is on — "Arya 1704 — clean Oct 14", "Glitch #812", "Bulletin". */
  title: string
  /** Where "Open" takes them. Relative ("/glitches?id=812") or absolute. */
  link?: string | null
  /** Emails chosen from a picker, honoured as tags. */
  picked?: string[]
  /** For the Slack room choice. */
  building?: string | null
  dept?: 'housekeeping' | 'maintenance' | null
  /** 'dm' (default): tagged people get a Slack DM. 'channel': ALSO post to the area room. false: in-app only. */
  toSlack?: 'dm' | 'channel' | false
  /** Extra people to tell as plain 'comment' notifications (thread followers, the glitch creator). */
  followers?: string[]
  followerTitle?: string
  /** The app_comments thread this came from — lets the Inbox reply in place. */
  entity?: { type: string; id: string } | null
}

export type TagResult = {
  mentions: ParsedMentions
  names: string[]
  summary: string
  notified: string[]
  slack: { dm: number; channel: boolean | null; channelId: string | null; error?: string }
}

export async function tagAndNotify(inp: TagInput): Promise<TagResult> {
  const people = await roster()
  const me = str(inp.by).toLowerCase()
  const mentions = parseMentions(str(inp.text), people, inp.picked || [])
  mentions.emails = mentions.emails.filter(e => e !== me)
  const names = namesFor(mentions.emails, people)
  const actor = str(inp.byName) || me.split('@')[0]
  const link = inp.link ? (inp.link.startsWith('http') ? inp.link : APP() + inp.link) : null
  const body = str(inp.text).slice(0, 500)
  const out: TagResult = { mentions, names, summary: describeMentions(mentions, people), notified: [], slack: { dm: 0, channel: null, channelId: null } }

  // 1. The bell + the pop-up.
  if (mentions.emails.length) {
    try {
      const r = await notify(mentions.emails, { kind: 'mention', title: `${actor} tagged you · ${inp.title}`.slice(0, 200), body, link: inp.link || undefined, actor: me, entity: inp.entity || null })
      if (r.ok) out.notified = mentions.emails.slice()
    } catch { /* best effort */ }
  }
  // Followers hear about the reply, never twice.
  const followers = Array.from(new Set((inp.followers || []).map(e => str(e).toLowerCase()))).filter(e => e && e !== me && !mentions.emails.includes(e) && people.some(p => p.email === e))
  if (followers.length) {
    try { await notify(followers, { kind: 'comment', title: (inp.followerTitle || `${actor} replied · ${inp.title}`).slice(0, 200), body, link: inp.link || undefined, actor: me, entity: inp.entity || null }) } catch { /* best effort */ }
  }

  // 2. Slack.
  const toSlack = inp.toSlack === undefined ? 'dm' : inp.toSlack
  if (toSlack && (mentions.emails.length || toSlack === 'channel')) {
    try {
      const [{ getDirectory, dmUser, mention, postToChannel, botConnected }, { getSlackRules, resolveSlackId, groupForBuilding, channelFor }] = await Promise.all([import('@/lib/slack'), import('@/lib/slack-rules')])
      if (await botConnected()) {
        const [dir, rules] = await Promise.all([getDirectory(), getSlackRules()])
        const users = (dir.users || []) as any[]
        const idOf = (email: string): string | null => {
          const p = people.find(x => x.email === email)
          const byEmail = users.find(u => u && !u.deleted && str(u.email).toLowerCase() === email)
          return byEmail?.id || resolveSlackId(p?.name || email, users, rules) || null
        }
        const ids: Record<string, string> = {}
        for (const e of mentions.emails) { const id = idOf(e); if (id) ids[e] = id }
        const tail = link ? `\n<${link}|Open in Lighthouse>` : ''
        const line = `*${actor}* · ${inp.title}\n${body}`
        if (toSlack === 'channel') {
          const group = groupForBuilding(rules, inp.building || null)
          const ch = channelFor(rules, group, inp.dept || 'housekeeping')
          out.slack.channelId = ch
          if (ch) {
            const tags = mentions.emails.map(e => ids[e] ? mention(ids[e]) : '').filter(Boolean).join(' ')
            const r = await postToChannel(ch, (tags ? tags + ' ' : '') + line + tail)
            out.slack.channel = !!r.ok
            if (!r.ok) out.slack.error = r.error
          } else out.slack.channel = false
        }
        // A DM to each tagged person — skipped for anyone the channel post already tagged, and for
        // anyone who muted Slack DMs.
        for (const e of mentions.emails) {
          if (!ids[e]) continue
          if (toSlack === 'channel' && out.slack.channel) continue
          const p = people.find(x => x.email === e)
          if (p?.prefs && (p.prefs.mute_all === true || p.prefs.mute_slack_dm === true)) continue
          const r = await dmUser(ids[e], `You were tagged. ${line}${tail}`)
          if (r.ok) out.slack.dm++
        }
      }
    } catch (e: any) { out.slack.error = str(e?.message || e).slice(0, 120) }
  }
  return out
}

/** The team list the pickers show: name + email, alphabetical. */
export async function rosterForPicker(): Promise<{ email: string; name: string; role: string | null }[]> {
  return (await roster()).map(p => ({ email: p.email, name: p.name, role: p.role || null })).sort((a, b) => a.name.localeCompare(b.name))
}
