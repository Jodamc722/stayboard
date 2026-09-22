'use client'
// LEAN — the shared kit for the "clean, one liners and tags" pass (Jon, 2026-09-22, after the Calls
// desk: "Way better… lets fix all pages").
//
// THE RULES EVERY PAGE FOLLOWS
//   1. HEADER IS ONE LINE. Title on the left, the 2–5 numbers that matter as <Pill>s on the right.
//      No eyebrow label, no explainer paragraph. If a number needs explaining, put it in `title=`.
//   2. A THING IS ONE ROW. The verb first (a Call / Open / Fix button when there is one), then the
//      name, then muted context (unit · building · date), then <Tag>s, then icon actions on the right.
//      Sentences on a row become tags ("38 days without a good review" → <Tag tone="rose">38d</Tag>).
//   3. DETAIL IS BEHIND A CLICK. Scripts, notes, quotes, history, secondary buttons — inside the row's
//      expand (<LeanRow>), never stacked on the card.
//   4. SECTIONS BECOME TABS. Stacked sections that each fill a screen become <LeanTabs> with counts.
//   5. EMPTY IS ONE LINE. <LeanEmpty>.
import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export type Tone = 'slate' | 'rose' | 'roseSolid' | 'amber' | 'emerald' | 'violet' | 'brand' | 'sky'
const TONE: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-600',
  rose: 'bg-rose-100 text-rose-700',
  roseSolid: 'bg-rose-600 text-white',
  amber: 'bg-amber-100 text-amber-800',
  emerald: 'bg-emerald-100 text-emerald-700',
  violet: 'bg-violet-100 text-violet-700',
  brand: 'bg-brand-50 text-brand-700',
  sky: 'bg-sky-100 text-sky-700',
}

/** A small flag on a row. Two or three words at most. */
export function Tag({ tone = 'slate', title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return <span title={title} className={`shrink-0 whitespace-nowrap text-[10.5px] font-semibold leading-none px-1.5 py-[3px] rounded-md ${TONE[tone]}`}>{children}</span>
}

/** A headline number in the page header. */
export function Pill({ tone = 'slate', title, onClick, children }: { tone?: Tone; title?: string; onClick?: () => void; children: ReactNode }) {
  const cls = `rounded-lg px-2 py-1 text-[12px] font-semibold tabular-nums whitespace-nowrap ${TONE[tone]} ${onClick ? 'hover:opacity-80' : ''}`
  return onClick ? <button onClick={onClick} title={title} className={cls}>{children}</button> : <span title={title} className={cls}>{children}</span>
}

/** One-line page header: title left, pills (and any control) right. */
export function LeanHead({ title, icon, children }: { title: ReactNode; icon?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3 flex-wrap mb-3">
      <h1 className="text-2xl font-bold text-ink tracking-tight inline-flex items-center gap-2">{icon}{title}</h1>
      {children ? <div className="flex items-center gap-1.5 flex-wrap">{children}</div> : null}
    </header>
  )
}

/** Segmented tabs with counts. */
export function LeanTabs<K extends string>({ tabs, value, onChange, right }: {
  tabs: { key: K; label: string; n?: number | null }[]; value: K; onChange: (k: K) => void; right?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap mb-3">
      <div className="inline-flex rounded-xl border border-line overflow-hidden text-[12.5px] max-w-full overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => onChange(t.key)}
            className={`px-2.5 sm:px-3 py-1.5 font-semibold border-l border-line first:border-l-0 whitespace-nowrap ${value === t.key ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>
            {t.label}{t.n ? <span className="ml-1 opacity-70 tabular-nums">{t.n}</span> : null}
          </button>
        ))}
      </div>
      {right ? <div className="ml-auto flex items-center gap-2 flex-wrap">{right}</div> : null}
    </div>
  )
}

/** Square icon action for the right end of a row. */
export function IconBtn({ title, onClick, href, disabled, tone, children }: {
  title: string; onClick?: () => void; href?: string; disabled?: boolean; tone?: 'ok' | 'bad' | 'brand'; children: ReactNode
}) {
  const cls = `shrink-0 inline-flex items-center justify-center rounded-lg border bg-white w-8 h-8 disabled:opacity-40 ${
    tone === 'ok' ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
      : tone === 'bad' ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
        : tone === 'brand' ? 'border-brand-200 text-brand-700 hover:bg-brand-50'
          : 'border-line text-muted hover:text-ink hover:bg-app'}`
  if (href) return <a href={href} title={title} aria-label={title} className={cls} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">{children}</a>
  return <button onClick={onClick} disabled={disabled} title={title} aria-label={title} className={cls}>{children}</button>
}

/** A list container for LeanRows. */
export function LeanList({ children }: { children: ReactNode }) {
  return <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70 overflow-hidden">{children}</ul>
}

/**
 * One row. `lead` is the verb button (optional), `name` + `meta` + `tags` form the line, `actions`
 * sit at the right, and `children` is what opens underneath. With no children there is no chevron.
 */
export function LeanRow({ lead, name, meta, tags, actions, children, tint, open: openProp, onToggle, defaultOpen }: {
  lead?: ReactNode; name: ReactNode; meta?: ReactNode; tags?: ReactNode; actions?: ReactNode; children?: ReactNode
  tint?: 'rose' | 'amber' | 'emerald'; open?: boolean; onToggle?: () => void; defaultOpen?: boolean
}) {
  const [own, setOwn] = useState(!!defaultOpen)
  const open = openProp ?? own
  const toggle = onToggle ?? (() => setOwn(o => !o))
  const can = children != null && children !== false
  const bg = tint === 'rose' ? 'bg-rose-50/40' : tint === 'amber' ? 'bg-amber-50/40' : tint === 'emerald' ? 'bg-emerald-50/30' : ''
  return (
    <li className={bg}>
      <div className="flex items-center gap-2.5 px-3 sm:px-4 py-2">
        {lead}
        <div onClick={can ? toggle : undefined} className={`flex-1 min-w-0 ${can ? 'cursor-pointer' : ''}`}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[13.5px] font-semibold text-ink truncate max-w-[18rem]">{name}</span>
            {meta ? <span className="text-[12px] text-muted truncate max-w-[18rem]">{meta}</span> : null}
            {tags}
          </div>
        </div>
        {actions ? <div className="flex items-center gap-1 shrink-0">{actions}</div> : null}
        {can && <button onClick={toggle} title={open ? 'Close' : 'Open'} className="shrink-0 text-muted hover:text-ink p-1"><ChevronDown size={15} className={open ? 'rotate-180 transition' : 'transition'} /></button>}
      </div>
      {can && open && <div className="px-3 sm:px-4 pb-3 space-y-2">{children}</div>}
    </li>
  )
}

/** Section label above a LeanList. */
export function LeanSection({ title, n, tone, right, children }: { title: ReactNode; n?: number; tone?: 'rose'; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className={`text-[11px] font-bold uppercase tracking-wider mb-1.5 px-1 flex items-center gap-2 ${tone === 'rose' ? 'text-rose-700' : 'text-muted'}`}>
        {title}{n != null ? <span className="tabular-nums">{n}</span> : null}
        {right ? <span className="ml-auto normal-case tracking-normal font-medium">{right}</span> : null}
      </h2>
      {children}
    </section>
  )
}

export function LeanEmpty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-line bg-white px-4 py-6 text-center text-[13px] text-muted">{children}</div>
}

/** Long text clamped to two lines; click to read it all. */
export function Clamp({ text, lines = 2 }: { text: string; lines?: 2 | 3 }) {
  const [all, setAll] = useState(false)
  if (!text) return null
  return (
    <p onClick={() => setAll(a => !a)} className={`text-[12.5px] text-ink/85 cursor-pointer ${all ? '' : lines === 2 ? 'line-clamp-2' : 'line-clamp-3'}`}>{text}</p>
  )
}
