// WHO IS THIS, IN LIGHTHOUSE TERMS — THE DECISION (lib/slack-identity.ts fetches, this decides).
//
// NO IMPORTS, ON PURPOSE: lib/eve/__tests__/slack-identity.test.mjs loads this file with plain node,
// so the rules that decide whose permissions a Slack message carries are proven, not assumed.
//
// THE HOLE THIS CLOSES (2026-09-29 security review, N1). The old lookup matched the LOCAL PART of any
// Slack email against every active account, so a Slack guest signed up as jon@anything.com became
// jon@stay-hospitality.com — the owner — and anyone who renamed their Slack profile "Jon McGill" was
// matched to him by name. Slack verifies the address on a profile; it does not verify a display name,
// and it cannot vouch for a mailbox on a domain we do not own. So:
//   - the same-local-part bridge runs only between OUR domains (both sides), where the company owns
//     the mailbox and "jon@" on one is the same person as "jon@" on the other;
//   - a name alone never resolves to the owner or an admin — if a name matches one, nothing matches;
//   - a Slack guest account (single- or multi-channel) is never matched by name at all, and neither is
//     a profile whose guest flag we have not read yet (a directory cached before the flag existed).
// Anyone left unmatched gets the unmapped tier (lib/eve/slack-tier.ts), exactly as before.

/** The email domains the company controls. The local-part bridge only ever runs between these. */
export const OUR_EMAIL_DOMAINS: string[] = ['stay-hospitality.com', 'staysoflo.com']

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

/** One app_users row, reduced to what the decision needs. `privileged` = the owner, an admin, or anyone
 *  set to Direct for door codes or allowed to approve them (lib/slack-identity.ts appUsers). */
export type IdentityUser = { email: string; status: string; name: string; privileged: boolean }

/** The Slack side. `guest` is null when unknown (a cached directory from before it was recorded). */
export type SlackProfile = { email: string; name: string; guest: boolean | null }

const low = (s: any) => String(s == null ? '' : s).trim().toLowerCase()

/** The part after the LAST @ — "a@b.com@evil.io" is evil.io, not b.com. */
export function emailDomain(email: string): string {
  const e = low(email)
  const at = e.lastIndexOf('@')
  return at > 0 ? e.slice(at + 1) : ''
}
function localPart(email: string): string {
  const e = low(email)
  const at = e.lastIndexOf('@')
  return at > 0 ? e.slice(0, at) : ''
}

/** Exact domain match only: "evil-stay-hospitality.com" and "stay-hospitality.com.evil.io" are not ours. */
export function isOurDomain(email: string): boolean {
  const d = emailDomain(email)
  return !!d && OUR_EMAIL_DOMAINS.indexOf(d) >= 0
}

/**
 * Turn what we know about a Slack user into the Lighthouse email that owns their permissions.
 *
 * ORDER IS DELIBERATE, cheapest and most certain first:
 *   1. the manual map by Slack id — an explicit human decision always wins
 *   2. their Slack profile email, IF it is an active Lighthouse user (Slack verifies that address)
 *   3. the manual map keyed by that email
 *   4. SAME LOCAL PART, OUR DOMAINS ONLY — jon@staysoflo.com -> jon@stay-hospitality.com. The profile
 *      email AND the account must both be on OUR_EMAIL_DOMAINS, and exactly one active account may match.
 *   5. their Slack name against the name on the Lighthouse profile — only for a full (non-guest)
 *      member, only on a single unambiguous match, and never onto the owner or an admin.
 */
export function decideIdentity(input: {
  slackUserId: string
  map: Record<string, string>
  profile: SlackProfile | null
  users: IdentityUser[]
  nameMatches: (a: string, b: string) => boolean
}): Resolved {
  const id = low(input.slackUserId)
  const out: Resolved = { email: null, how: null, profileEmail: null, slackName: null }
  if (!id) return out
  const map = input.map || {}
  if (map[id]) return { ...out, email: low(map[id]), how: 'map-id' }

  const profileEmail = low(input.profile?.email)
  const slackName = String(input.profile?.name || '').trim()
  out.profileEmail = profileEmail || null
  out.slackName = slackName || null

  const users = (input.users || []).map(u => ({ ...u, email: low(u.email) })).filter(u => u.email)
  const active = users.filter(u => u.status === 'active')

  if (profileEmail) {
    const direct = active.find(u => u.email === profileEmail)
    if (direct) return { ...out, email: direct.email, how: 'profile' }
    if (map[profileEmail]) return { ...out, email: low(map[profileEmail]), how: 'map-email' }
    // Exists but switched off is NOT the same as absent, and saying so saves somebody ten minutes.
    const inactive = users.find(u => u.email === profileEmail && u.status !== 'active')
    if (inactive) return { ...out, problem: `their Lighthouse account ${profileEmail} is ${inactive.status || 'not set'}, not active` }
  }

  // 4. Same person, our other domain — and only ours, on both sides.
  if (profileEmail && isOurDomain(profileEmail)) {
    const local = localPart(profileEmail)
    const sameLocal = active.filter(u => isOurDomain(u.email) && localPart(u.email) === local)
    if (sameLocal.length === 1) return { ...out, email: sameLocal[0].email, how: 'alias-domain' }
    if (sameLocal.length > 1) return { ...out, problem: `"${local}@" matches ${sameLocal.length} Lighthouse accounts, so I cannot tell which is theirs` }
  }

  // 5. By name — the weakest evidence there is, so it is fenced three ways.
  if (slackName) {
    const guest = input.profile ? input.profile.guest : null
    if (guest !== false) {
      return { ...out, problem: guest ? 'their Slack account is a guest account, and guests are only ever matched by email' : 'I could not confirm their Slack account is a full member, so I did not match them by name' }
    }
    const byName = active.filter(u => u.name && input.nameMatches(u.name, slackName))
    if (byName.some(u => u.privileged)) {
      return { ...out, problem: `"${slackName}" is named like an admin account, and admin accounts are only ever matched by email` }
    }
    if (byName.length === 1) return { ...out, email: byName[0].email, how: 'name' }
    if (byName.length > 1) return { ...out, problem: `${byName.length} Lighthouse accounts are named like "${slackName}"` }
  }

  return out
}

/** One sentence a person can act on, given a failed or partial resolution. */
export function identityHint(r: Resolved, _slackUserId?: string): string {
  if (r.problem) return r.problem
  if (!r.profileEmail && !r.slackName) return 'Slack did not give me an email or a name for you'
  if (r.profileEmail) return `your Slack address ${r.profileEmail} is not a Lighthouse account, and nothing else matched you`
  return `nothing matched the name "${r.slackName}"`
}
