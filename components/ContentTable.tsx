// THE COPY THAT IS LIVE, AS A TABLE YOU CAN SCAN.
//
// This replaces a block that reprinted every description section at full length, unclamped — about
// a thousand pixels of prose sitting between the diagnosis and every tool on the page, duplicating
// what the optimizer below already shows in its own "Current" column. On a filled listing you had
// the same 2,700 characters on screen twice the moment you pressed Generate.
//
// What an operator actually needs from the live copy, in order: which fields are EMPTY, how long
// each one is against its target, and what the copy says. The first two are one glance in a table
// and were previously buried inside the prose; the third is what the optimizer is for.
//
// AN EMPTY SECTION IS THE MOST USEFUL ROW ON THE PAGE, so it is the loudest — and it carries what
// it costs, because "Transit is empty" and "Transit is empty and that is 1.8 points" are different
// sentences to somebody deciding what to do this afternoon.
import { type SectionKey } from '@/lib/listing-ai'

export type ContentRow = {
  key: string
  label: string
  text: string
  targetMin?: number
  targetMax?: number
  hardCap?: number | null
  /** Optimize-score points this field is currently giving up, when we know. */
  costs?: number | null
}

export function ContentTable({ rows }: { rows: ContentRow[] }) {
  return (
    <div className="divide-y divide-line">
      {rows.map(r => {
        const n = r.text.trim().length
        const empty = n === 0
        const over = r.hardCap != null && n > r.hardCap
        const short = !empty && r.targetMin != null && n < r.targetMin
        return (
          <div key={r.key} className={'px-3 py-2 ' + (empty ? 'bg-rose-50/40' : '')}>
            <div className="flex items-baseline gap-2.5">
              <span className="text-[10px] uppercase tracking-wider text-muted font-bold w-[86px] shrink-0 pt-0.5">{r.label}</span>
              {empty ? (
                <span className="text-[12.5px] text-rose-700 italic flex-1">
                  Empty{r.costs ? ` — costs ${r.costs.toFixed(1)} points` : ''}
                </span>
              ) : (
                // Two lines is enough to recognise the copy. Reading it in full is the optimizer's
                // job, where it sits beside the proposed version rather than alone.
                <span className="text-[12.5px] text-ink flex-1 leading-snug line-clamp-2">{r.text}</span>
              )}
              <span className={'text-[10.5px] tabular-nums shrink-0 ' + (over ? 'text-rose-600 font-bold' : short ? 'text-amber-600 font-semibold' : 'text-muted')}
                title={r.targetMin && r.targetMax ? `Target ${r.targetMin}–${r.targetMax}${r.hardCap ? `, hard cap ${r.hardCap}` : ''}` : undefined}>
                {n}
                {over ? ` / ${r.hardCap}` : ''}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
