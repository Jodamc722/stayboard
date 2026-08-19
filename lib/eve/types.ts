// Tool contract shared by every Eve domain module.
import 'server-only'
import type { EveCtx } from './ctx'

export type EveTool = {
  name: string
  description: string
  input_schema: any
  run: (input: any, ctx: EveCtx) => Promise<any>
  /** true = output passes through redactMoney() for anyone without the `money` permission. */
  money?: boolean
}

export type EveDomain = {
  key: string
  label: string
  /** One line shown to Eve when she opens the domain, so she knows what she just gained. */
  blurb: string
  tools: EveTool[]
}

/** The Anthropic tool definition — the run() function is ours and never crosses the wire. */
export function wireShape(t: EveTool) {
  return { name: t.name, description: t.description, input_schema: t.input_schema }
}

export const S = {
  str: { type: 'string' },
  num: { type: 'number' },
  bool: { type: 'boolean' },
}
export function obj(props: Record<string, any>, required?: string[]) {
  const o: any = { type: 'object', properties: props }
  if (required && required.length) o.required = required
  return o
}
