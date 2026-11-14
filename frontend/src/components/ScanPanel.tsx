import { useEffect, useState } from 'react'
import { api, type Region, type Scan, type Variable } from '../api'
import { useI18n } from '../i18n'

type Props = { variable: Variable; startYear: number | null; onPick: (r: Region) => void; onClose: () => void }

/** Countries where the trend of the selected variable is robust, strongest first. */
export function ScanPanel({ variable, startYear, onPick, onClose }: Props) {
  const { t, l, num, unit } = useI18n()
  const [scan, setScan] = useState<Scan | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setScan(null)
    setError(null)
    api
      .scan(variable.id, startYear, ctrl.signal)
      .then(setScan)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(String(e.message ?? e))
      })
    return () => ctrl.abort()
  }, [variable.id, startYear])

  const list = (title: string, rows: Scan['up'], { decimals, units }: Scan) => (
    <div className="scan-col">
      <h4>{title}</h4>
      {rows.length === 0 && <p className="muted small">{t('scan.none')}</p>}
      <ul>
        {rows.map((r) => (
          <li key={r.region_id}>
            <button type="button" onClick={() => onPick(r)}>
              <span>{l(r.name)}</span>
              <span className="scan-rate">
                {num(r.per_decade, decimals, true)} {unit(units)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )

  return (
    <div className="scan">
      <header>
        <div>
          <div className="legend-title">{t('scan.title', { what: l(variable.name) })}</div>
          <div className="muted small">{t('scan.hint')}</div>
        </div>
        <button type="button" className="btn" onClick={onClose} aria-label={t('method.close')}>
          ×
        </button>
      </header>
      {error && <p className="error small">{error}</p>}
      {!scan && !error && <p className="muted small">{t('scan.loading')}</p>}
      {scan && (
        <>
          <p className="small">{t('scan.count', { n: scan.n_robust, up: scan.n_up, down: scan.n_down })}</p>
          <div className="scan-cols">
            {list(t('scan.up'), scan.up, scan)}
            {list(t('scan.down'), scan.down, scan)}
          </div>
        </>
      )}
    </div>
  )
}
