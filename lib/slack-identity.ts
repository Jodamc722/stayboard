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
//
// THE RULES THEMSELVES live in lib/slack-identity-rules.ts (no imports, proven by a plain-node test):
// the local-part bridge only between our own domains, never the owner or an admin by name alone, and
// never a Slack guest account by name (2026-09-29 security review, N1). This file only fetches.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDirectory, slackUserMap } from '@/lib/slack'
import { nameMatches } from '@/lib/person-name'
import { isSuperadmin } from '@/lib/access'
import { decideIdentity, identityHint, type Resolved, type IdentityUser, type SlackProfile } from '@/lib/slack-identity-rules'

export type { Resolved }
export { identityHint }

async function appUsers(): Promise<IdentityUser[]> {
  try {
    // select('*'): role and access_role are read when present, and a missing optional column never
    // empties the list (an error here means nobody matches, which is the safe way to fail).
    const { data, error } = await supabaseAdmin().from('app_users').select('*').order('email').limit(500)
    if (error) return []
    return ((data || []) as any[]).map(r => {
      const email = String(r?.email || '').toLowerCase().trim()
      const f = r?.features && typeof r.features === 'object' ? r.features : {}
      return {
        email,
        status: String(r?.status || ''),
        name: String((r?.profile && typeof r.profile === 'object' ? r.profile.name : '') || '').trim(),
        // The owner, anyone who gets the admin tier in Slack, and — since anyone in a Customer Service
        // room may ask for a door code (2026-09-29) — anyone who gets a code without an approver or who
        // approves them. Never reachable by a name alone: a Slack name is whatever someone typed.
        privileged: isSuperadmin(email) || r?.role === 'admin' || r?.access_role === 'admin'
          || String(f.door_codes || '').toLowerCase() === 'direct' || f.door_code_approver === true,
      }
    }).filter(u => u.email)
  } catch { return [] }
}

// Guest flags arrived with this file's 2026-09-29 change; a directory cached before it has none. Read
// it fresh ONCE per instance rather than guess — and if that fails the flag stays unknown, which
// resolveLighthouseEmail treats as "do not match by name".
let _refreshedForGuestFlag = false

async function slackProfile(id: string): Promise<SlackProfile | null> {
  const find = (dir: any) => (dir?.users || []).find((u: any) => u && String(u.id).toLowerCase() === id && !u.deleted && !u.bot)
  try {
    let hit: any = find(await getDirectory())
    if (hit && typeof hit.guest !== 'boolean' && !_refreshedForGuestFlag) {
      _refreshedForGuestFlag = true
      hit = find(await getDirectory(true)) || hit
    }
    if (!hit) return null
    return {
      email: String(hit.email || '').toLowerCase().trim(),
      name: String(hit.name || '').trim(),
      guest: typeof hit.guest === 'boolean' ? hit.guest : null,
    }
  } catch { return null }   // directory unavailable; the later steps simply find nothing
}

/**
 * Turn a Slack user id into the Lighthouse email that owns that person's permissions. The order and
 * the fences are documented in lib/slack-identity-rules.ts decideIdentity.
 */
export async function resolveLighthouseEmail(slackUserId: string): Promise<Resolved> {
  const id = String(slackUserId || '').trim().toLowerCase()
  if (!id) return { email: null, how: null, profileEmail: null, slackName: null }
  const map = await slackUserMap()
  // An explicit human decision wins before anything is fetched.
  if (map[id]) return { email: map[id], how: 'map-id', profileEmail: null, slackName: null }
  const [profile, users] = await Promise.all([slackProfile(id), appUsers()])
  return decideIdentity({ slackUserId: id, map, profile, users, nameMatches })
}
