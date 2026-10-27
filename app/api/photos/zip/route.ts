// PHOTOS AS A ZIP, STREAMED (Jon, 2026-10-27: "download them … in zip files, high quality").
//   GET ?listing=<id>                 every photo of the unit
//   GET ?listing=<id>&pics=<id,id,…>  the picked ones
//   GET ?building=<name>              every unit of the property, one folder per unit
//   GET ?search=<words>               every photo the smart search finds ("elser pool"), a folder per unit
// The archive is written as the photos arrive from Guesty (lib/zip-stream: stored, never
// re-compressed, so each file is byte-for-byte the original) and streamed to the browser, so nothing
// is held in memory and the 4.5 MB response limit does not apply. A photo that cannot be fetched is
// skipped and listed in "_could not fetch.txt" rather than failing the whole download.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { unitPhotos, buildingPhotos, searchPhotoSets, photoFileName, zipFileName, type UnitPhotos } from '@/lib/photo-library'
import { ZipWriter, safeName } from '@/lib/zip-stream'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const disposition = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`

export async function GET(req: NextRequest) {
  const g = await requireLevel('photo-library', 'view')
  if (!g.ok) return g.res
  const sp = req.nextUrl.searchParams
  const listing = String(sp.get('listing') || '').trim()
  const building = String(sp.get('building') || '').trim()
  const search = String(sp.get('search') || '').trim().slice(0, 80)
  const picks = String(sp.get('pics') || '').split(',').map(s => s.trim()).filter(Boolean)
  if (!listing && !building && !search) return NextResponse.json({ ok: false, error: 'listing, building or search is required' }, { status: 400 })

  let sets: UnitPhotos[] = []
  let label = ''
  try {
    if (listing) {
      const u = await unitPhotos(listing, { measure: false })
      if (!u) return NextResponse.json({ ok: false, error: 'No such unit.' }, { status: 404 })
      sets = [{ unit: u.unit, photos: picks.length ? u.photos.filter(p => picks.indexOf(p.id) >= 0) : u.photos }]
      label = u.unit.name + (picks.length ? ' (' + sets[0].photos.length + ' picked)' : '')
    } else if (building) {
      sets = await buildingPhotos(building)
      if (!sets.length) return NextResponse.json({ ok: false, error: 'No photos for that property.' }, { status: 404 })
      label = building
    } else {
      sets = await searchPhotoSets(search)
      if (!sets.length) return NextResponse.json({ ok: false, error: 'No photo matches that search.' }, { status: 404 })
      label = 'Search ' + search
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
  const total = sets.reduce((n, s) => n + s.photos.length, 0)
  if (!total) return NextResponse.json({ ok: false, error: 'Nothing to download.' }, { status: 404 })
  const perUnitFolders = sets.length > 1

  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const z = new ZipWriter(c => controller.enqueue(c))
      // Back-pressure: when the browser is slower than Guesty, wait rather than buffer the archive.
      const breathe = async () => { let n = 0; while (!cancelled && (controller.desiredSize ?? 1) <= 0 && n++ < 4000) await new Promise(r => setTimeout(r, 15)) }
      const missing: string[] = []
      try {
        for (const s of sets) {
          const folder = perUnitFolders ? safeName(s.unit.name, 'unit') + '/' : ''
          const taken = new Set<string>()
          for (let i = 0; i < s.photos.length; i++) {
            if (cancelled) break
            const p = s.photos[i]
            const name = folder + photoFileName(p, i, taken)
            let up: Response | null = null
            try { up = await fetch(p.url) } catch { up = null }
            if (!up || !up.ok || !up.body) { missing.push(name + '  ←  ' + p.url); continue }
            z.startEntry(name)
            const reader = up.body.getReader()
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              if (value && value.length) { z.write(value); await breathe() }
              if (cancelled) { try { await reader.cancel() } catch { /* gone */ } break }
            }
            z.endEntry()
          }
        }
        if (!cancelled) {
          if (missing.length) z.addText('_could not fetch.txt', 'These photos could not be fetched from Guesty when the ZIP was made:\n\n' + missing.join('\n') + '\n')
          z.finish()
          controller.close()
        }
      } catch (e) {
        try { controller.error(e) } catch { /* already closed */ }
      }
    },
    cancel() { cancelled = true },
  }, new CountQueuingStrategy({ highWaterMark: 48 }))

  const headers = new Headers()
  headers.set('Content-Type', 'application/zip')
  headers.set('Content-Disposition', disposition(zipFileName(label)))
  headers.set('Cache-Control', 'private, no-store')
  headers.set('X-Photo-Count', String(total))
  return new Response(stream, { headers })
}
