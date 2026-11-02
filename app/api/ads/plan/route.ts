// AD STUDIO — plan before building (Jon, 2026-11-02: "when generating, first confirm the details
// before creating a video … work through what you want … optimise the request to get it right").
// POST { brief, seconds, format, audience } → a sharpened brief, suggested settings, 2–4 questions
// with a recommended answer first, and the scene outline. Nothing is written or saved here.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { askJson } from '@/lib/ad-json'
import { planPrompt } from '@/lib/ad-studio'
import { libraryIndex, buildingPhotos } from '@/lib/photo-library'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '')

export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: false, error: 'No Anthropic key configured.' }, { status: 503 })
  const b = await req.json().catch(() => ({} as any))
  const brief = String(b?.brief || '').trim().slice(0, 4000)
  if (!brief) return NextResponse.json({ ok: false, error: 'Write a line about the ad first, e.g. "a cool video for Amrit".' }, { status: 400 })
  try {
    let properties = '', photosOf = '', matched = ''
    try {
      const idx = await libraryIndex()
      const bs = idx.buildings.filter(x => x.photos > 0)
      properties = bs.map(x => `${x.name} · ${x.market} · ${x.units.length} units · ${x.photos} photos`).join('\n')
      // The property the brief names (loose spelling): any brief word of 4+ letters inside a building name.
      const words = brief.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4)
      const hit = bs.find(x => words.some(w => norm(x.name).includes(w)) || norm(brief).includes(norm(x.name)))
      if (hit) {
        matched = hit.name
        const sets = await buildingPhotos(hit.name)
        const caps = Array.from(new Set(sets.flatMap(u => u.photos.map((ph: any) => String(ph.caption || '').trim())).filter(Boolean))).slice(0, 40)
        const titles = Array.from(new Set(sets.map(u => String(u.unit.title || '').trim()).filter(Boolean))).slice(0, 4)
        photosOf = [titles.length ? 'Listing titles: ' + titles.join(' | ') : '', caps.map(c => '- ' + c.slice(0, 90)).join('\n')].filter(Boolean).join('\n')
      }
    } catch { /* plan without the library */ }
    const prompt = planPrompt({ brief, seconds: Number(b?.seconds) || 30, format: String(b?.format || '16:9'), audience: String(b?.audience || 'owners'), properties: properties || '(library unavailable)', photosOf })
    const a = await askJson(key, prompt, { maxTokens: 3000, temperature: 0.5 })
    if (!a.ok) return NextResponse.json({ ok: false, error: a.error }, { status: 502 })
    const j = a.json
    const S = j?.settings || {}
    const pick = <T extends string>(v: any, ok: readonly T[], d: T): T => (ok.indexOf(v) >= 0 ? v : d)
    const plan = {
      name: String(j?.name || '').slice(0, 80),
      property: String(j?.property || matched || '').slice(0, 80),
      brief: String(j?.brief || brief).slice(0, 1500),
      settings: {
        audience: pick(S.audience, ['owners', 'partners', 'guests'] as const, 'owners'),
        format: pick(S.format, ['16:9', '9:16', '1:1', '4:5'] as const, '16:9'),
        seconds: [15, 30, 45, 60, 90].indexOf(Number(S.seconds)) >= 0 ? Number(S.seconds) : 30,
        music: pick(S.music, ['werq', 'backbay', 'moonlight', 'inspired', 'wallpaper', 'funkorama'] as const, 'werq'),
      },
      angle: String(j?.angle || '').slice(0, 300),
      hook: String(j?.hook || '').slice(0, 160),
      questions: (Array.isArray(j?.questions) ? j.questions : []).slice(0, 4).map((q: any, i: number) => ({
        id: String(q?.id || 'q' + (i + 1)), q: String(q?.q || '').slice(0, 200),
        options: (Array.isArray(q?.options) ? q.options : []).map((o: any) => String(o).slice(0, 120)).filter(Boolean).slice(0, 4),
      })).filter((q: any) => q.q && q.options.length >= 2),
      outline: (Array.isArray(j?.outline) ? j.outline : []).map((o: any) => String(o).slice(0, 200)).slice(0, 10),
      warnings: (Array.isArray(j?.warnings) ? j.warnings : []).map((o: any) => String(o).slice(0, 200)).slice(0, 4),
    }
    return NextResponse.json({ ok: true, plan })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
