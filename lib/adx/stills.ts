// AD STUDIO — THE FRAMES THE CREATIVE DIRECTOR LOOKS AT (Jon, 2026-11-20: "a true Claude creative build as if creating
// here"). Every scene of a piece at its resting moment, drawn by the same player that exports it, as a small JPEG,
// with the measured audit run on the same canvas. Browser only.
import type { Composition } from './composition'
import { renderFrame, restTime, canvasMeasure, type Ctx } from './player'
import { auditComposition, canvasSampler, issueLines, type AuditResult } from './audit'
import { loadAssets } from './assets'

export type Look = { stills: { scene: string; data: string }[]; audit: AuditResult; findings: string; fails: number }

/** Draw the piece and measure it. `width` is the long-edge-agnostic width of each still in pixels. */
export async function lookAt(doc: Composition, width = 540): Promise<Look> {
  const { assets } = await loadAssets(doc)
  const W = doc.canvas.w, H = doc.canvas.h
  const full = document.createElement('canvas'); full.width = W; full.height = H
  const g = full.getContext('2d', { willReadFrequently: true }) as Ctx
  const audit = auditComposition(doc, canvasMeasure(g), { sample: canvasSampler(doc, assets, g) })
  const small = document.createElement('canvas'); small.width = width; small.height = Math.round((width * H) / W)
  const sg = small.getContext('2d')!
  sg.imageSmoothingEnabled = true; sg.imageSmoothingQuality = 'high'
  const stills: Look['stills'] = []
  for (const s of doc.scenes) {
    if (assets.seek) await assets.seek(doc, restTime(s))        // a video clip is put on the frame this moment shows
    renderFrame(g, doc, restTime(s), assets)
    sg.drawImage(full, 0, 0, small.width, small.height)
    const url = small.toDataURL('image/jpeg', 0.82)
    stills.push({ scene: s.id, data: url.slice(url.indexOf(',') + 1) })
  }
  const failing = audit.issues.filter(x => x.sev === 'fail')
  return { stills, audit, findings: issueLines(failing), fails: failing.length }
}
