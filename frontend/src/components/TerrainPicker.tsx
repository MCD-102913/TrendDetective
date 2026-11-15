import { useEffect, useState } from 'react'
import { api, type TerrainTypes } from '../api'
import { useI18n } from '../i18n'

// a type with fewer cells gives a series too noisy to be worth offering
const MIN_CELLS = 3

/** Narrows the chosen territory to one terrain type (MODIS land cover): its forests, croplands, deserts... */
export function TerrainPicker({
  regionId,
  polygon,
  value,
  onChange,
}: {
  regionId?: string
  /** an area drawn on the map, instead of a region */
  polygon?: GeoJSON.Polygon
  value: string | null
  onChange: (terrain: string | null) => void
}) {
  const { t, l } = useI18n()
  const [types, setTypes] = useState<TerrainTypes['types']>([])
  const [year, setYear] = useState<number | null>(null)

  const area = polygon ? JSON.stringify(polygon) : null
  useEffect(() => {
    let live = true
    const request = area ? api.terrainArea(JSON.parse(area)) : api.terrain(!regionId || regionId === 'global' ? null : regionId)
    request
      .then((r) => {
        if (!live) return
        setTypes(r.types.filter((x) => x.cells >= MIN_CELLS))
        setYear(r.year)
      })
      .catch(() => live && setTypes([]))
    return () => {
      live = false
    }
  }, [regionId, area])

  if (types.length === 0) return null
  return (
    <label className="terrain-picker" title={t('terrain.hint', { year: year ?? '' })}>
      <span className="muted small">{t('terrain.label')}</span>
      <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t('terrain.all')}</option>
        {types.map((x) => (
          <option key={x.id} value={x.id}>
            {l(x.name)} ({t('terrain.cells', { n: x.cells })})
          </option>
        ))}
      </select>
    </label>
  )
}
