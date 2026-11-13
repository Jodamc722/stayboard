'use client'
// THE MAP (Jon, 2026-11-13: "should have real maps integrated into systems… make it nice"; then "run through and
// make sure it is clean and fast, the map was a bit clunky"). A real, pannable street map: MapLibre GL drawing
// OpenFreeMap's vector tiles (OpenStreetMap data), no API key.
//
// The pins are drawn BY THE MAP (one GeoJSON source, GPU layers), not as HTML elements laid over it:
//   · pins that would pile on top of each other at a zoom gather into one, showing the units inside; a click opens it up
//   · names appear beside the pins once there is room for them
//   · hundreds of pins cost the same as ten, and nothing jumps while searching
// One component for the properties map and for the small "is this the right place?" preview under an address box.
import { useEffect, useRef } from 'react'

export type MapPoint = { id: string; lat: number; lng: number; label: string; /** the short name drawn beside the pin (the label is the hover text) */ name?: string; count?: number; kind?: 'live' | 'onboarding' | 'pin' }
const VER = '4.7.1'
const STYLE = 'https://tiles.openfreemap.org/styles/positron'
const INK = '#14161B', GOLD = '#8C6D3A', HOT = '#B4532A'
const FONT = ['Noto Sans Bold']
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
.sm-fail{display:grid;place-items:center;height:100%;padding:16px;text-align:center;font:400 13px/1.4 Inter,system-ui,sans-serif;color:#6E6F74;background:#F1EDE4}
.sm-tip .maplibregl-popup-content{padding:6px 10px;border-radius:10px;font:600 12.5px/1.3 Inter,system-ui,sans-serif;color:#14161B;box-shadow:0 8px 22px -10px rgba(0,0,0,.45)}
.sm-tip .maplibregl-popup-tip{display:none}
.sm-wrap .maplibregl-ctrl-group{border-radius:10px;overflow:hidden;box-shadow:0 4px 14px -6px rgba(0,0,0,.35)}
`
const geo = (points: MapPoint[]) => ({ type: 'FeatureCollection', features: points.map(p => ({ type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { id: p.id, label: p.label, name: p.name || p.label, count: p.kind === 'live' || !p.kind ? p.count ?? 1 : 0, text: p.kind === 'pin' || p.kind === 'onboarding' ? '' : String(p.count ?? 1), kind: p.kind || 'live' } })) })

export function StayMap({ points, selected, hovered, onSelect, fitKey = '', height = 420, interactive = true, className = '' }: {
  points: MapPoint[]; selected?: string | null; hovered?: string | null; onSelect?: (id: string) => void
  /** Change it to make the map frame the points again (the first set is always framed). */
  fitKey?: string; height?: number | string; interactive?: boolean; className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const st = useRef<{ map: any; lib: any; ready: boolean; fitted: string | null; tip: any }>({ map: null, lib: null, ready: false, fitted: null, tip: null })
  const cur = useRef({ points, selected, hovered, fitKey, onSelect })
  cur.current = { points, selected, hovered, fitKey, onSelect }
  const key = points.map(p => p.id + ':' + p.lat.toFixed(5) + ',' + p.lng.toFixed(5) + ':' + (p.count || '') + (p.kind || '')).join('|')

  function frame(animate: boolean) {
    const { map, lib } = st.current, pts = cur.current.points
    if (!map || !pts.length) return
    if (pts.length === 1) { map[animate ? 'easeTo' : 'jumpTo']({ center: [pts[0].lng, pts[0].lat], zoom: 15, duration: 450 }); return }
    const b = new lib.LngLatBounds(); pts.forEach(p => b.extend([p.lng, p.lat]))
    map.fitBounds(b, { padding: 64, maxZoom: 15, duration: animate ? 450 : 0 })
  }
  function sync() {
    const { map, ready } = st.current
    if (!map || !ready) return
    const { points, selected, hovered, fitKey } = cur.current
    map.getSource('pts')?.setData(geo(points))
    const ring = (id: string | null | undefined) => { const p = points.find(x => x.id === id); return { type: 'FeatureCollection', features: p ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { text: p.kind === 'live' || !p.kind ? String(p.count ?? 1) : '' } }] : [] } }
    map.getSource('sel')?.setData(ring(selected))
    map.getSource('hov')?.setData(ring(hovered && hovered !== selected ? hovered : null))
    if (points.length && st.current.fitted !== fitKey) { const first = st.current.fitted === null; st.current.fitted = fitKey; frame(!first) }
  }

  useEffect(() => {
    let dead = false, ro: ResizeObserver | null = null
    loadLib().then(lib => {
      if (dead || !box.current || st.current.map) return
      const map = new lib.Map({ container: box.current, style: STYLE, center: [-80.19, 25.95], zoom: 8.6, attributionControl: { compact: true }, interactive, dragRotate: false, pitchWithRotate: false, fadeDuration: 120 })
      st.current.map = map; st.current.lib = lib
      if (interactive) { map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right'); map.touchZoomRotate?.disableRotation?.() }
      // the box is often sized after the map is made (a grid column, a viewport-height rule): keep the canvas in step
      ro = new ResizeObserver(() => { try { map.resize() } catch { /* gone */ } }); ro.observe(box.current)
      map.on('load', () => {
        if (dead) return
        const empty = { type: 'FeatureCollection', features: [] }
        map.addSource('pts', { type: 'geojson', data: empty, cluster: true, clusterRadius: 36, clusterMaxZoom: 13, clusterProperties: { units: ['+', ['get', 'count']] } })
        map.addSource('sel', { type: 'geojson', data: empty }); map.addSource('hov', { type: 'geojson', data: empty })
        const halo = { 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 }
        map.addLayer({ id: 'cl', type: 'circle', source: 'pts', filter: ['has', 'point_count'], paint: { 'circle-color': INK, 'circle-radius': ['step', ['get', 'units'], 17, 20, 21, 60, 26, 150, 31], 'circle-opacity': 0.94, ...halo } })
        map.addLayer({ id: 'cl-n', type: 'symbol', source: 'pts', filter: ['has', 'point_count'], layout: { 'text-field': ['to-string', ['case', ['>', ['get', 'units'], 0], ['get', 'units'], ['get', 'point_count']]], 'text-font': FONT, 'text-size': 13, 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff' } })
        map.addLayer({ id: 'pt', type: 'circle', source: 'pts', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': ['match', ['get', 'kind'], 'live', INK, GOLD], 'circle-radius': ['match', ['get', 'kind'], 'live', 14, 'onboarding', 10, 9], ...halo } })
        map.addLayer({ id: 'pt-n', type: 'symbol', source: 'pts', filter: ['!', ['has', 'point_count']], layout: { 'text-field': ['get', 'text'], 'text-font': FONT, 'text-size': 12.5, 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff' } })
        map.addLayer({ id: 'pt-name', type: 'symbol', source: 'pts', minzoom: 11.5, filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'kind'], 'pin']], layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 12, 'text-anchor': 'left', 'text-offset': [1.5, 0], 'text-max-width': 12, 'text-optional': true }, paint: { 'text-color': INK, 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } })
        map.addLayer({ id: 'hov', type: 'circle', source: 'hov', paint: { 'circle-color': INK, 'circle-radius': 17, 'circle-stroke-color': HOT, 'circle-stroke-width': 3 } })
        map.addLayer({ id: 'sel', type: 'circle', source: 'sel', paint: { 'circle-color': HOT, 'circle-radius': 17, ...halo, 'circle-stroke-width': 3 } })
        map.addLayer({ id: 'sel-n', type: 'symbol', source: 'sel', layout: { 'text-field': ['get', 'text'], 'text-font': FONT, 'text-size': 13, 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff' } })
        if (interactive) {
          map.on('click', 'cl', async (e: any) => { const f = e.features?.[0]; if (!f) return; try { const z = await map.getSource('pts').getClusterExpansionZoom(f.properties.cluster_id); map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(z + 0.4, 17), duration: 420 }) } catch { map.easeTo({ center: f.geometry.coordinates, zoom: map.getZoom() + 2, duration: 420 }) } })
          map.on('click', 'pt', (e: any) => { const id = e.features?.[0]?.properties?.id; if (id) cur.current.onSelect?.(id) })
          const tip = new lib.Popup({ closeButton: false, closeOnClick: false, offset: 18, className: 'sm-tip', maxWidth: '260px' }); st.current.tip = tip
          const over = (text: (f: any) => string) => (e: any) => { map.getCanvas().style.cursor = 'pointer'; const f = e.features?.[0]; if (f) tip.setLngLat(f.geometry.coordinates).setText(text(f)).addTo(map) }
          const out = () => { map.getCanvas().style.cursor = ''; tip.remove() }
          map.on('mouseenter', 'pt', over(f => f.properties.label)); map.on('mouseleave', 'pt', out)
          map.on('mouseenter', 'cl', over(f => `${f.properties.point_count} places${f.properties.units ? ' · ' + f.properties.units + ' units' : ''} · click to zoom in`)); map.on('mouseleave', 'cl', out)
        }
        st.current.ready = true
        sync()
      })
    }).catch(() => { if (!dead && box.current) box.current.innerHTML = '<div class="sm-fail">The map could not load. Check the connection and reload.</div>' })
    return () => { dead = true; ro?.disconnect(); try { st.current.map?.remove() } catch { /* already gone */ } st.current = { map: null, lib: null, ready: false, fitted: null, tip: null } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { sync() }, [key, hovered, fitKey])
  useEffect(() => {
    sync()
    const { map } = st.current
    const p = points.find(x => x.id === selected)
    if (!map || !p) return
    // only travel when it helps: already close and on screen → stay put
    const z = map.getZoom(), on = map.getBounds().contains([p.lng, p.lat])
    if (on && z >= 13.5) return
    map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(z, 14.5), duration: on ? 450 : 700 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  return <div className={'sm-wrap ' + className} style={{ height, borderRadius: 16, overflow: 'hidden', background: '#EEF0EF', position: 'relative' }}><style>{CSS}</style><div ref={box} style={{ position: 'absolute', inset: 0 }} /></div>
}
