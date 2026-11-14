import * as maplibregl from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
// the worker is a separate file that Vite does not pick up by itself: it is emitted as an asset and MapLibre is pointed to it
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { INK, useTheme } from '../theme'

type Props = {
  overlayUrl: string | null
  bounds: [number, number, number, number]
  outline: GeoJSON.Geometry | null
  compareOutline: GeoJSON.Geometry | null
  point: [number, number] | null
  fitTo: number[] | null
  onPick: (lon: number, lat: number) => void
  onOverlayState: (loading: boolean) => void
  globe: boolean
  onReady?: (map: maplibregl.Map | null) => void
  /** raster tiles shown instead of the overlay (NASA GIBS imagery) */
  tiles?: { url: string; maxzoom: number } | null
}

maplibregl.setWorkerUrl(workerUrl)

const MAX_PIXEL_RATIO = 1.5

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const feature = (g: GeoJSON.Geometry | null): GeoJSON.FeatureCollection =>
  g ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: g, properties: {} }] } : EMPTY

let countries: Promise<GeoJSON.FeatureCollection> | null = null
const loadCountries = () => (countries ??= fetch('/countries.json').then((r) => r.json()))

/** Map with the trend overlay (a Web-Mercator PNG from the API), borders and the selected territory. */
export function MapView({
  overlayUrl,
  bounds,
  outline,
  compareOutline,
  point,
  fitTo,
  onPick,
  onOverlayState,
  globe,
  onReady,
  tiles = null,
}: Props) {
  const { theme } = useTheme()
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const ready = useRef(false)
  const latest = useRef({ overlayUrl, bounds, outline, compareOutline, point, theme, globe, tiles })
  latest.current = { overlayUrl, bounds, outline, compareOutline, point, theme, globe, tiles }
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const stateRef = useRef(onOverlayState)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  stateRef.current = onOverlayState

  const sync = () => {
    const map = mapRef.current
    if (!map || !ready.current) return
    const s = latest.current
    const ink = INK[s.theme]
    map.setProjection({ type: s.globe ? 'globe' : 'mercator' })
    map.setPaintProperty('ocean', 'background-color', ink.ocean)
    map.setPaintProperty('land', 'fill-color', ink.land)
    map.setPaintProperty('borders', 'line-color', ink.border)
    map.setPaintProperty('outline', 'line-color', ink.outline)
    map.setPaintProperty('point', 'circle-stroke-color', ink.outline)
    ;(map.getSource('outline') as maplibregl.GeoJSONSource).setData(feature(s.outline))
    ;(map.getSource('compare') as maplibregl.GeoJSONSource).setData(feature(s.compareOutline))
    ;(map.getSource('point') as maplibregl.GeoJSONSource).setData(feature(s.point ? { type: 'Point', coordinates: s.point } : null))
  }

  useEffect(() => {
    if (!el.current) return
    const ink = INK[latest.current.theme]
    const map = new maplibregl.Map({
      container: el.current,
      style: { version: 8, sources: {}, layers: [{ id: 'ocean', type: 'background', paint: { 'background-color': ink.ocean } }] },
      center: [15, 25],
      zoom: 0.95,
      minZoom: 0,
      maxZoom: 7,
      renderWorldCopies: false,
      // a Retina screen would make the map draw four times the pixels; the trend layer is a 0.5 degree grid,
      // so 1.5 looks the same and draws about half of them
      pixelRatio: Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO),
      attributionControl: { compact: true, customAttribution: 'NASA MERRA-2, GPM IMERG, CERES / MODIS · Natural Earth' },
    })
    mapRef.current = map
    onReadyRef.current?.(map)
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', async () => {
      const fc = await loadCountries()
      if (!mapRef.current) return
      map.addSource('countries', { type: 'geojson', data: fc })
      map.addLayer({ id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': ink.land } })
      map.addSource('outline', { type: 'geojson', data: EMPTY })
      map.addSource('compare', { type: 'geojson', data: EMPTY })
      map.addSource('point', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': ink.border, 'line-width': 0.6 } })
      map.addLayer({
        id: 'compare',
        type: 'line',
        source: 'compare',
        paint: { 'line-color': INK.dark.compare, 'line-width': 2, 'line-dasharray': [2, 1.5] },
      })
      map.addLayer({ id: 'outline', type: 'line', source: 'outline', paint: { 'line-color': ink.outline, 'line-width': 2 } })
      map.addLayer({
        id: 'point',
        type: 'circle',
        source: 'point',
        paint: { 'circle-radius': 6, 'circle-color': '#f08a45', 'circle-stroke-width': 2, 'circle-stroke-color': ink.outline },
      })
      ready.current = true
      sync()
      setOverlay()
      setTiles()
    })
    map.on('click', (e) => pickRef.current(e.lngLat.lng, e.lngLat.lat))
    map.getCanvas().style.cursor = 'crosshair'
    return () => {
      ready.current = false
      mapRef.current = null
      onReadyRef.current?.(null)
      map.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setOverlay = () => {
    const map = mapRef.current
    const { overlayUrl: url, bounds: b } = latest.current
    if (!map || !ready.current) return
    if (!url) return
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [b[0], b[3]],
      [b[2], b[3]],
      [b[2], b[1]],
      [b[0], b[1]],
    ]
    stateRef.current(true)
    // the legend already describes the new variable: the old picture fades until the new one arrives
    if (map.getLayer('trend')) map.setPaintProperty('trend', 'raster-opacity', 0.15)
    // the new overlay is preloaded, so the old one stays until it is ready
    const img = new Image()
    img.onload = () => {
      if (latest.current.overlayUrl !== url || !mapRef.current) return
      const src = map.getSource('trend') as maplibregl.ImageSource | undefined
      if (src) {
        src.updateImage({ url, coordinates })
        map.setPaintProperty('trend', 'raster-opacity', 1)
      } else {
        map.addSource('trend', { type: 'image', url, coordinates })
        map.addLayer(
          { id: 'trend', type: 'raster', source: 'trend', paint: { 'raster-fade-duration': 200, 'raster-resampling': 'nearest' } },
          'borders',
        )
        if (latest.current.tiles) map.setLayoutProperty('trend', 'visibility', 'none')
      }
      stateRef.current(false)
    }
    img.onerror = () => stateRef.current(false)
    img.src = url
  }

  // NASA imagery replaces the overlay; the overlay stays loaded underneath, so switching back is instant
  const setTiles = () => {
    const map = mapRef.current
    if (!map || !ready.current) return
    const t = latest.current.tiles
    if (map.getLayer('gibs')) map.removeLayer('gibs')
    if (map.getSource('gibs')) map.removeSource('gibs')
    if (map.getLayer('trend')) map.setLayoutProperty('trend', 'visibility', t ? 'none' : 'visible')
    if (!t) return
    map.addSource('gibs', { type: 'raster', tiles: [t.url], tileSize: 256, maxzoom: t.maxzoom, attribution: 'NASA GIBS' })
    map.addLayer({ id: 'gibs', type: 'raster', source: 'gibs', paint: { 'raster-fade-duration': 200 } }, 'borders')
  }

  useEffect(setOverlay, [overlayUrl, bounds]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(setTiles, [tiles?.url]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(sync, [outline, compareOutline, point, theme, globe]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // the globe looks best from a little further away, the flat map should fill the frame
    const map = mapRef.current
    if (map && ready.current) map.easeTo({ zoom: globe ? Math.min(map.getZoom(), 1.6) : Math.max(map.getZoom(), 0.95), duration: 500 })
  }, [globe])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !fitTo) return
    const [w, s, e, n] = fitTo
    if (e - w > 300) map.easeTo({ center: [10, (s + n) / 2], zoom: 1.2 })
    else
      map.fitBounds(
        [
          [w, Math.max(s, -84)],
          [e, Math.min(n, 84)],
        ],
        { padding: 50, maxZoom: 5.5, duration: 700 },
      )
  }, [fitTo])

  return <div ref={el} className="map" />
}
