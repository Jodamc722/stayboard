'use client'
// THE MAP (Jon, 2026-11-13: "should have real maps integrated into systems… make it nice"). A real, pannable
// street map: MapLibre GL drawing OpenFreeMap's vector tiles (OpenStreetMap data), no API key. One component for
// the properties map and for the small "is this the right place?" preview under an address box.
import { useEffect, useRef } from 'react'

export type MapPoint = { id: string; lat: number; lng: number; label: string; count?: number; kind?: 'live' | 'onboarding' | 'pin' }
const VER = '4.7.1'
const STYLE = 'https://tiles.openfreemap.org/styles/positron'
let loading: Promise<any> | null = null
function loadLib(): Promise<any> {
  const w = window as any
  if (w.maplibregl) return Promise.resolve(w.maplibregl)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = `https://unpkg.com/maplibre-gl@${VER}/dist/maplibre-gl.css`; document.head.appendChild(css)
    const s = document.createElement('script'); s.src = `https://unpkg.com/maplibre-gl@${VER}/dist/maplibre-gl.js`; s.async = true
    s.onload = () => resolve(w.maplibregl); s.onerror = () => { loading = null; reject(new Error('map library did not load')) }
    document.head.appendChild(s)
  })
  return loading
}
const CSS = `
.sm-pin{display:grid;place-items:center;min-width:30px;height:30px;padding:0 8px;border-radius:999px;background:#14161B;color:#fff;font:600 12.5px/1 Inter,system-ui,sans-serif;border:2px solid #fff;box-shadow:0 4px 12px -3px rgba(0,0,0,.45);cursor:pointer;transition:transform .15s,background .15s}
.sm-pin:hover{transform:scale(1.1)}
.sm-pin.onboarding{background:#8C6D3A}
.sm-pin.pin{min-width:18px;width:18px;height:18px;padding:0;background:#8C6D3A}
.sm-pin.sel{background:#B4532A;transform:scale(1.18);z-index:2}
.sm-fail{display:grid;place-items:center;height:100%;padding:16px;text-align:center;font:400 13px/1.4 Inter,system-ui,sans-serif;color:#6E6F74;background:#F1EDE4}
`
export function StayMap({ points, selected, onSelect, height = 420, interactive = true, className = '' }: { points: MapPoint[]; selected?: string | null; onSelect?: (id: string) => void; height?: number | string; interactive?: boolean; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const st = useRef<{ map: any; lib: any; markers: Map<string, { m: any; el: HTMLElement }>; fitted: string }>({ map: null, lib: null, markers: new Map(), fitted: '' })
  const onSel = useRef(onSelect); onSel.current = onSelect
  // the latest points and selection, for the draw that runs when the map library finishes loading (it may load
  // after the data does, and must not draw the empty list it was created with)
  const cur = useRef({ points, selected, key: '' })
  const key = points.map(p => p.id + ':' + p.lat.toFixed(5) + ',' + p.lng.toFixed(5) + ':' + (p.count || '') + (p.kind || '')).join('|')

  useEffect(() => {
    let dead = false
    loadLib().then(lib => {
      if (dead || !box.current || st.current.map) return
      const map = new lib.Map({ container: box.current, style: STYLE, center: [-80.19, 25.9], zoom: 9, attributionControl: { compact: true }, interactive, cooperativeGestures: false })
      if (interactive) map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right')
      st.current.map = map; st.current.lib = lib
      draw()
    }).catch(() => { if (!dead && box.current) box.current.innerHTML = '<div class="sm-fail">The map could not load. Check the connection and reload.</div>' })
    return () => { dead = true; try { st.current.map?.remove() } catch { /* already gone */ } st.current = { map: null, lib: null, markers: new Map(), fitted: '' } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  cur.current = { points, selected, key }
  function draw() {
    const { map, lib, markers } = st.current
    const { points, selected, key } = cur.current
    if (!map || !lib) return
    markers.forEach(x => x.m.remove()); markers.clear()
    for (const p of points) {
      const el = document.createElement('button'); el.type = 'button'
      el.className = 'sm-pin ' + (p.kind || 'live') + (selected === p.id ? ' sel' : '')
      el.title = p.label; el.setAttribute('aria-label', p.label)
      el.textContent = p.kind === 'pin' ? '' : p.kind === 'onboarding' ? '•' : String(p.count ?? 1)
      el.onclick = e => { e.stopPropagation(); onSel.current?.(p.id) }
      markers.set(p.id, { m: new lib.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map), el })
    }
    if (points.length && st.current.fitted !== key) {
      st.current.fitted = key
      if (points.length === 1) map.jumpTo({ center: [points[0].lng, points[0].lat], zoom: 15 })
      else { const b = new lib.LngLatBounds(); points.forEach(p => b.extend([p.lng, p.lat])); map.fitBounds(b, { padding: 56, maxZoom: 15, duration: 0 }) }
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { draw() }, [key])
  useEffect(() => {
    const { map, markers } = st.current
    markers.forEach((x, id) => x.el.classList.toggle('sel', id === selected))
    const p = points.find(x => x.id === selected)
    if (map && p) map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 15.2), duration: 700 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  return <div className={className} style={{ height, borderRadius: 16, overflow: 'hidden', background: '#F1EDE4', position: 'relative' }}><style>{CSS}</style><div ref={box} style={{ position: 'absolute', inset: 0 }} /></div>
}
