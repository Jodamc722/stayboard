// The tool registry and the progressive-disclosure mechanism that makes 48 tools workable.
//
// WHY NOT JUST HAND HER ALL 48. Two reasons, both measured rather than theoretical: the schemas
// alone would add ~12k tokens to EVERY request in the loop, and tool-selection accuracy falls off
// once a model is choosing from more than about twenty options — it starts reaching for the
// plausible-sounding tool instead of the right one.
//
// SO: twelve core tools are always present, plus open_domain(). When Eve opens a domain the server
// appends that domain's schemas to the tools array for the REST OF THE CONVERSATION. Cost is one
// extra turn on the first deep question of a thread; benefit is she picks from twelve, then six.
import 'server-only'
import { redactMoney } from '@/lib/money'
import type { EveTool, EveDomain } from './types'
import { wireShape, obj, S } from './types'
import type { EveCtx } from './ctx'
import { CORE_TOOLS, RELOCATED } from './core'
import { OPS_DOMAIN } from './ops'
import { MONEY_DOMAIN } from './money'
import { QUALITY_DOMAIN } from './quality'
import { LABOR_DOMAIN } from './labor'
import { GUESTS_DOMAIN } from './guests'
import { SLACK_DOMAIN } from './slack'
import { PROPERTY_DOMAIN } from './property'
import { SYSTEM_DOMAIN } from './system'
import { CS_TOOLS } from './cs'
import { DOC_TOOLS } from './docs'

// The five tools that were core before and now live alongside their siblings. Built as NEW objects
// rather than by mutating the imported domain — a module-level `.tools = .tools.concat(...)` runs
// again on every hot reload in dev, which would register duplicate tool names and make the
// Anthropic call fail with a confusing "duplicate tool" error that only reproduces after an edit.
const QUALITY: EveDomain = {
  ...QUALITY_DOMAIN,
  tools: QUALITY_DOMAIN.tools.concat([
    RELOCATED.search_reviews, RELOCATED.search_listings, RELOCATED.listing_detail, RELOCATED.guesty_config,
  ]),
}
const OPS: EveDomain = { ...OPS_DOMAIN, tools: OPS_DOMAIN.tools.concat([RELOCATED.field_work]) }

// The customer-service half of the guests domain, added 2026-08-26. Built as a separate module and
// concatenated here for the same reason as the relocated tools above: mutating an imported domain
// at module scope re-runs on every hot reload and registers duplicate tool names.
const GUESTS: EveDomain = { ...GUESTS_DOMAIN, tools: GUESTS_DOMAIN.tools.concat(CS_TOOLS) }

export const DOMAINS: EveDomain[] = [OPS, MONEY_DOMAIN, QUALITY, LABOR_DOMAIN, GUESTS, SLACK_DOMAIN, PROPERTY_DOMAIN, SYSTEM_DOMAIN]
export const DOMAIN_KEYS = DOMAINS.map(d => d.key)

const OPEN_DOMAIN: EveTool = {
  name: 'open_domain',
  description: `Load a whole family of tools you do not have yet. Domains: ${DOMAINS.map(d => `"${d.key}" (${d.label}) — ${d.blurb}`).join(' | ')}. Call this the moment a question touches one of those areas; the tools stay available for the rest of the conversation. You can open more than one. This costs you one turn, so open what you need and then go.`,
  input_schema: obj({ domain: S.str }, ['domain']),
  run: async () => ({ note: 'handled by the route' }),
}

export function coreTools(): EveTool[] {
  // The written documents sit in CORE rather than behind open_domain. A policy question arrives
  // constantly ("what is our rule on…", "how do we handle…") and spending a turn opening a domain
  // to answer one is the wrong trade — two small schemas beat a wasted round trip.
  return CORE_TOOLS.concat(DOC_TOOLS).concat([OPEN_DOMAIN])
}

export function domainByKey(key: string): EveDomain | null {
  const k = String(key || '').toLowerCase().trim()
  return DOMAINS.find(d => d.key === k) || null
}

/** Every tool currently visible: core + whatever domains are open. */
export function activeTools(open: string[]): EveTool[] {
  let list = coreTools()
  for (const k of open) {
    const d = domainByKey(k)
    if (d) list = list.concat(d.tools)
  }
  return list
}

export function wireTools(open: string[]) {
  return activeTools(open).map(wireShape)
}

export function findTool(name: string, open: string[]): EveTool | null {
  return activeTools(open).find(t => t.name === name) || null
}

/** Where does a tool live? Used to tell Eve which domain to open when she guesses a name. */
export function domainOfTool(name: string): string | null {
  for (const d of DOMAINS) if (d.tools.some(t => t.name === name)) return d.key
  return null
}

export type ToolRunResult = { output: any; opened?: string }

/**
 * Run a tool with the money gate applied. Rule 4: redaction happens HERE, before the output is
 * serialized into the conversation — not in the UI, where the model has already seen the number.
 */
export async function runTool(name: string, input: any, ctx: EveCtx, open: string[]): Promise<ToolRunResult> {
  if (name === 'open_domain') {
    const d = domainByKey(input?.domain)
    if (!d) return { output: { error: `Unknown domain. Choose one of: ${DOMAIN_KEYS.join(', ')}.` } }
    if (open.indexOf(d.key) >= 0) {
      return { output: { already_open: true, domain: d.key, tools: d.tools.map(t => t.name) } }
    }
    return {
      opened: d.key,
      output: {
        opened: d.key, label: d.label, blurb: d.blurb,
        tools_now_available: d.tools.map(t => ({ name: t.name, what: t.description.slice(0, 140) })),
        note: 'These are live for the rest of this conversation. Go ahead and call one.',
      },
    }
  }
  const tool = findTool(name, open)
  if (!tool) {
    const home = domainOfTool(name)
    if (home) return { output: { error: `The tool "${name}" lives in the "${home}" domain, which is not open yet. Call open_domain with domain="${home}" first.` } }
    return { output: { error: `Unknown tool "${name}".` } }
  }
  try {
    const out = await tool.run(input || {}, ctx)
    if (tool.money && !ctx.canMoney) {
      return { output: { ...redactMoney(out), _money_redacted: 'Dollar amounts are hidden for this user. Ratios (occupancy, ADR, RevPAR, percentages) are still accurate. Do not guess at the hidden numbers.' } }
    }
    return { output: out }
  } catch (e: any) {
    return { output: { error: String(e?.message || e).slice(0, 200) } }
  }
}

export function toolCatalogue(): string {
  return DOMAINS.map(d => `- ${d.key}: ${d.tools.map(t => t.name).join(', ')}`).join('\n')
}

// Build-time safety net: two tools sharing a name makes the Anthropic call fail with an error that
// points at the API rather than at us. Fail loudly here instead.
{
  const seen: Record<string, string> = {}
  const all = coreTools().concat(DOMAINS.reduce((acc, d) => acc.concat(d.tools), [] as EveTool[]))
  for (const t of all) {
    if (seen[t.name]) throw new Error(`Eve tool registry: "${t.name}" is registered twice (${seen[t.name]} and again)`)
    seen[t.name] = 'first'
  }
}
