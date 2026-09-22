// RECONCILING THE PRICELABS PACING PDF AGAINST ARITHMETIC AND AGAINST OUR OWN NUMBERS.
//
// The pacing slide is read out of a PriceLabs PDF by a vision model, off a *chart* — it is
// estimating where a line sits against a Y axis. That is the weakest thing a vision model does,
// and on the 17WEST September report (2026-09-22) it produced a slide that could not be true:
//
//     Occupancy  ours 65%   comps 40%   +25 pts
//     ADR        ours $200  comps $185  +$15
//     RevPAR     ours $110  comps $145  -$35      <-- impossible, twice over
//
// Two independent contradictions, either of which is fatal:
//   1. RevPAR IS occupancy x ADR, by definition. 65% x $200 = $130, not $110; 40% x $185 = $74,
//      not $145. A comp set cannot have a RevPAR ($145) close to its own ADR ($185) at 40%
//      occupancy — RevPAR <= ADR always, with equality only at 100% occupancy.
//   2. Ahead on occupancy AND ahead on ADR means ahead on RevPAR. Always. The slide told a 17
//      West owner we were $35/night behind the market while we were roughly $56 ahead of it.
//
// Our own board had the true figure the whole time: 66% / $213 / $140, and 66% x $213 = $140.
//
// So: RevPAR is never read out of the PDF again. It is DERIVED from the occupancy and ADR rows,
// which are flat labelled values rather than a third line to eyeball. Deltas are recomputed from
// the values rather than trusted, and any row that still cannot be true is dropped rather than
// shown. An owner report may be missing a row. It may not carry a false one.
//
// The window caveat, deliberately handled: the PriceLabs pull window (e.g. Aug 31-Sep 11) is not
// the report period (September), so our authoritative figures are used ONLY to detect a
// swapped "Your"/"Market" series — a swap is a large, obvious difference — and never to
// overwrite a value the PDF legitimately reports for a different window.

export type PacingRow = { metric: string; ours: string; comps: string; delta: string }
export type OurTruth = { occPct?: number; adr?: number; revpar?: number }

const numOf = (s: any): number => {
  const m = String(s == null ? '' : s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return m ? Number(m[0]) : NaN
}
const isPct = (s: any) => /%/.test(String(s == null ? '' : s))
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const pct = (n: number) => Math.round(n) + '%'

const findRow = (rows: PacingRow[], re: RegExp) => rows.find(r => re.test(String(r.metric)))
const OCC = /occup/i, ADR = /\badr\b|average daily/i, RPR = /revpar|rev\s*par/i

/** Signed advantage of ours over comps, in the unit the metric is quoted in. */
function deltaOf(metric: string, ours: number, comps: number): string {
  const d = ours - comps
  const sign = d >= 0 ? '+' : '-'
  if (OCC.test(metric)) return sign + Math.abs(Math.round(d)) + ' pts'
  return sign + '$' + Math.abs(Math.round(d)).toLocaleString('en-US')
}

/**
 * Reconcile parsed pacing rows. Returns the corrected rows plus a plain-English note for each
 * correction, so the desk can see the extraction was adjusted rather than silently trusting it.
 */
export function reconcilePacing(input: PacingRow[], truth: OurTruth = {}): { rows: PacingRow[]; notes: string[]; ahead: boolean } {
  const notes: string[] = []
  let rows: PacingRow[] = input.map(r => ({ ...r }))

  // ---- 1. WHOLE-TABLE SWAP: PriceLabs' "Your"/"Market" lines read backwards. Our own occupancy
  // is authoritative and a swap shows up as a large difference, so it is safe to test on.
  const occ0 = findRow(rows, OCC)
  if (occ0 && typeof truth.occPct === 'number' && truth.occPct > 0) {
    const o = numOf(occ0.ours), c = numOf(occ0.comps)
    if (isFinite(o) && isFinite(c) && Math.abs(c - truth.occPct) + 3 < Math.abs(o - truth.occPct)) {
      rows = rows.map(r => ({ ...r, ours: r.comps, comps: r.ours }))
      notes.push('The "Your" and "Market" series were read backwards and have been swapped (our occupancy is ' + truth.occPct + '%).')
    }
  }

  // ---- 2. REVPAR IS DERIVED, NEVER READ. occupancy x ADR, for each side independently.
  const occ = findRow(rows, OCC), adr = findRow(rows, ADR)
  const oOcc = occ ? numOf(occ.ours) : NaN, cOcc = occ ? numOf(occ.comps) : NaN
  const oAdr = adr ? numOf(adr.ours) : NaN, cAdr = adr ? numOf(adr.comps) : NaN
  if (occ && adr && isFinite(oOcc) && isFinite(oAdr) && isFinite(cOcc) && isFinite(cAdr)) {
    const oR = (oOcc / 100) * oAdr, cR = (cOcc / 100) * cAdr
    const existing = findRow(rows, RPR)
    const was = existing ? numOf(existing.ours) : NaN
    const row: PacingRow = { metric: 'RevPAR', ours: money(oR), comps: money(cR), delta: deltaOf('RevPAR', oR, cR) }
    if (existing) {
      const drift = isFinite(was) ? Math.abs(was - oR) : Infinity
      Object.assign(existing, row)
      if (drift > Math.max(5, oR * 0.05)) {
        notes.push('RevPAR was read off the chart as ' + money(was) + '; it is ' + money(oR) + ' (' + pct(oOcc) + ' x ' + money(oAdr) + ') and has been recomputed.')
      }
    } else {
      rows.push(row)
      notes.push('RevPAR was missing and has been computed from occupancy x ADR.')
    }
  } else {
    // Cannot derive it, so it cannot be trusted either. RevPAR <= ADR is the one check left.
    const rp = findRow(rows, RPR)
    if (rp && adr) {
      const bad = (a: number, b: number) => isFinite(a) && isFinite(b) && a > b
      if (bad(numOf(rp.ours), numOf(adr.ours)) || bad(numOf(rp.comps), numOf(adr.comps))) {
        rows = rows.filter(r => r !== rp)
        notes.push('The RevPAR row was dropped: it exceeded ADR, which cannot happen.')
      }
    }
  }

  // ---- 3. EVERY DELTA RECOMPUTED FROM THE VALUES. The model's own delta agreed with its own
  // wrong numbers, which is exactly how a false row survives a read-through.
  for (const r of rows) {
    const o = numOf(r.ours), c = numOf(r.comps)
    if (!isFinite(o) || !isFinite(c)) continue
    const want = deltaOf(r.metric, o, c)
    if (r.delta !== want) r.delta = want
  }

  // ---- 4. ANYTHING STILL IMPOSSIBLE IS DROPPED, NOT SHOWN.
  rows = rows.filter(r => {
    const o = numOf(r.ours)
    if (!isFinite(o) || o < 0) return false
    if (isPct(r.ours) && o > 100) return false
    return true
  })

  // ---- 5. The direction check that started all this: ahead on occupancy and ahead on ADR means
  // ahead on RevPAR. If the rows ever disagree with that again, say nothing rather than lie.
  const behind = (r?: PacingRow) => !!r && /^[-−]/.test(String(r.delta).trim())
  const oc = findRow(rows, OCC), ad = findRow(rows, ADR), rp = findRow(rows, RPR)
  if (oc && ad && rp && !behind(oc) && !behind(ad) && behind(rp)) {
    rows = rows.filter(r => r !== rp)
    notes.push('RevPAR contradicted occupancy and ADR and was dropped.')
  }

  const ahead = rows.length > 0 && rows.every(r => !behind(r))
  return { rows, notes, ahead }
}
