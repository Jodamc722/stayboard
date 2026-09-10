// WHO IS THIS, IN LIGHTHOUSE TERMS?
//
// A Slack user id is not a Lighthouse account, and the gap between them is the reason Eve spent her
// first day in Slack treating her own GM as a stranger. Jon's Slack profile says jon@staysoflo.com;
// his Lighthouse login is jon@stay-hospitality.com. Nothing bridged the two, so `accessForEmail`
// returned null, the tier system read "no account" as "outside vendor", and she answered the person
// who built her at the most guarded level she has.
//
// The old fix was a hand-maintained `slack_user_map` setting. It never worked, for a reason worth
// stating plainly: NOTHING IN THE APP COULD WRITE TO IT. The only mention of that setting anywhere
// was an error message telling the user to go and add a key to it, which no route, screen or command
// could do. A instruction that cannot be followed is not a fallback.
//
// So the map is now the LAST resort rather than the first, and four cheaper things are tried first.
// Each one is a different question, and when they all fail the caller is told WHICH failed — because
// "no account" and "account exists but is inactive" and "two people share that name" need three
// different fixes from a human, and one error message for all three sends them looking in the wrong
// place.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDirectory, slackUserMap } from '@/lib/slack'
import { nameMatches } from '@/lib/person-name'

export type Resolved = {
  email: string | null
  /** How we got there. Surfaced in errors and logs; never shown as jargon to a person. */
  how: 'map-id' | 'map-email' | 'profile' | 'alias-domain' | 'name' | null
  /** What the Slack profile itself said, for telling someone why they were not recognised. */
  profileEmail: string | null
  slackName: string | null
  /** Set when we found something but deliberately refused it. */
  problem?: string
}

type AppUser = { email: string; status: string; name: string }

async function activeUsers(): Promise<AppUser[]> {
  try {
    const { data } = await supabaseAdmin().from('app_users').select('email, status, profile').limit(500)
    return ((data || []) as any[]).map(r => ({
      email: String(r?.email || '').toLowerCase().trim(),
      status: String(r?.status || ''),
      name: String((r?.profile && typeof r.profile === 'object' ? r.profile.name : '') || '').trim(),
    })).filter(u => u.email)
  } catch { return [] }
}

/**
 * Turn a Slack user id into the Lighthouse email that owns that person's permissions.
 *
 * ORDER IS DELIBERATE, cheapest and most certain first:
 *   1. the manual map by Slack id — an explicit human decision always wins
 *   2. their Slack profile email, IF it is an active Lighthouse user
 *   3. the manual map keyed by that email
 *   4. SAME LOCAL PART ON ANOTHER OF OUR DOMAINS — jon@staysoflo.com -> jon@stay-hospitality.com.
 *      Only ever matches domains that already appear in app_users, so it cannot reach outside the
 *      company, and only when EXACTLY ONE active account matches. Two "maria@"s means no answer.
 *   5. their Slack display name against the name on the Lighthouse profile, again only on a single
 *      unambiguous match. This is what covers people who signed up with a personal address.
 */
export async function resolveLighthouseEmail(slackUserId: string): Promise<Resolved> {
  const id = String(slackUserId || '').trim().toLowerCase()
  const out: Resolved = { email: null, how: null, profileEmail: null, slackName: null }
  if (!id) return out

  const map = await slackUserMap()
  if (map[id]) return { ...out, email: map[id], how: 'map-id' }

  let slackName = ''
  let profileEmail = ''
  try {
    const dir = await getDirectory()
    const hit = (dir.users || []).find((u: any) => u && String(u.id).toLowerCase() === id && !u.deleted && !u.bot)
    profileEmail = String((hit as any)?.email || '').toLowerCase().trim()
    slackName = String((hit as any)?.name || '').trim()
  } catch { /* directory unavailable; the later steps simply find nothing */ }
  out.profileEmail = profileEmail || null
  out.slackName = slackName || null

  const users = await activeUsers()
  const active = users.filter(u => u.status === 'active')

  if (profileEmail) {
    const direct = active.find(u => u.email === profileEmail)
    if (direct) return { ...out, email: direct.email, how: 'profile' }
    if (map[profileEmail]) return { ...out, email: map[profileEmail], how: 'map-email' }
    // Exists but switched off is NOT the same as absent, and saying so saves somebody ten minutes.
    const inactive = users.find(u => u.email === profileEmail && u.status !== 'active')
    if (inactive) return { ...out, problem: `their Lighthouse account ${profileEmail} is ${inactive.status}, not active` }
  }

  // 4. Same person, our other domain.
  if (profileEmail.includes('@')) {
    const local = profileEmail.split('@')[0]
    const sameLocal = active.filter(u => u.email.split('@')[0] === local)
    if (sameLocal.length === 1) return { ...out, email: sameLocal[0].email, how: 'alias-domain' }
    if (sameLocal.length > 1) return { ...out, problem: `"${local}@" matches ${sameLocal.length} Lighthouse accounts, so I cannot tell which is theirs` }
  }

  // 5. By name. nameMatches is the same fuzzy matcher the staffing check uses, so it already bridges
  // the married/maiden drift that defeats an exact comparison.
  if (slackName) {
    const byName = active.filter(u => u.name && nameMatches(u.name, slackName))
    if (byName.length === 1) return { ...out, email: byName[0].email, how: 'name' }
    if (byName.length > 1) return { ...out, problem: `${byName.length} Lighthouse accounts are named like "${slackName}"` }
  }

  return out
}

/** One sentence a person can act on, given a failed or partial resolution. */
export function identityHint(r: Resolved, slackUserId: string): string {
  if (r.problem) return r.problem
  if (!r.profileEmail && !r.slackName) return 'Slack did not give me an email or a name for you'
  if (r.profileEmail) return `your Slack address ${r.profileEmail} is not a Lighthouse account, and nothing else matched you`
  return `nothing matched the name "${r.slackName}"`
}
