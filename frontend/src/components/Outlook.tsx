import React, { useEffect, useState } from 'react'
import { api, type ForecastSkill, type HindcastSummary, type Series } from '../api'
import { useI18n } from '../i18n'
import { Mark } from './Icon'

/** "If the trend continues": the value at the end of the horizon with 80% and 95% ranges and how well the same
 *  rule did on the past. Nothing for variables where the hindcast showed no skill. */
export function OutlookNote({ s }: { s: Series }) {
  const { t, num, unit, l } = useI18n()
  const o = s.outlook
  if (!o || !o.hindcast?.enabled) return null
  if (!o.available) return <p className="muted small outlook-off">{t('outlook.off')}</p>
  const d = s.variable.decimals
  const k = o.years.length - 1
  const v = (x: number) => `${num(s.mean + x, d)} ${unit(s.variable.units)}`.trim()
  return (
    <div className="outlook">
      <div className="outlook-title">{t('outlook.title')}</div>
      <p className="small">
        {t('outlook.text', {
          year: o.years[k],
          v: v(o.mid[k]),
          now: v(o.ref),
          last: o.last_year,
          lo: num(s.mean + o.lo80[k], d),
          hi: num(s.mean + o.hi80[k], d),
          lo95: num(s.mean + o.lo95[k], d),
          hi95: num(s.mean + o.hi95[k], d),
        })}
      </p>
      <p className="muted small">
        {t('outlook.checked', {
          n: o.hindcast.cases,
          skill: num((o.hindcast.skill ?? 0) * 100, 0),
          cov: num((o.hindcast.coverage95 ?? 0) * 100, 0),
          where: o.hindcast.scope_name ? l(o.hindcast.scope_name) : '',
        })}{' '}
        {o.hindcast.model && t('outlook.modelUsed', { m: t(`outlook.model.${o.hindcast.model}`) })}
      </p>
    </div>
  )
}

/** The hindcast table: per variable, for the whole world and per climate zone, whether the outlook is shown. */
export function SkillTable() {
  const { t, num, l } = useI18n()
  const [d, setD] = useState<ForecastSkill | null>(null)
  useEffect(() => {
    api
      .forecastSkill()
      .then(setD)
      .catch(() => setD(null))
  }, [])
  if (!d) return null
  const zones = Object.keys(d.rule.zones)
  const shown = (v: ForecastSkill['variables'][number]) => Number(v.world.enabled) + zones.filter((z) => v.zones[z]?.enabled).length
  const rows = [...d.variables].sort((a, b) => shown(b) - shown(a) || (b.world.skill ?? -9) - (a.world.skill ?? -9))
  const cell = (r: HindcastSummary | undefined) => {
    if (!r || r.cases < d.rule.min_cases || r.skill === undefined || r.skill === null)
      return (
        <td className="muted" title={t('outlook.few')}>
          ·
        </td>
      )
    return (
      <td className={r.enabled ? 'on' : 'off'} title={t('outlook.cellHint', { n: r.cases, cov: num((r.coverage95 ?? 0) * 100, 0) })}>
        {r.enabled && (
          <>
            <Mark ok />{' '}
          </>
        )}
        {num(r.skill * 100, 0, true)}%
      </td>
    )
  }
  return (
    <section className="evidence">
      <h3>{t('outlook.tableTitle')}</h3>
      <p className="muted small">{t('outlook.tableNote', { min: d.rule.min_cases, cov: num(d.rule.min_coverage95 * 100, 0) })}</p>
      <div className="skill-wrap">
        <table className="skill-table small">
          <thead>
            <tr>
              <th>{t('outlook.col.var')}</th>
              <th>{t('outlook.col.model')}</th>
              <th>{t('outlook.col.world')}</th>
              {zones.map((z) => (
                <th key={z}>{l(d.rule.zones[z])}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id} className={shown(v) ? 'on' : ''}>
                <td>{l(v.name)}</td>
                <td>{v.world.model ? t(`outlook.modelShort.${v.world.model}`) : '·'}</td>
                {cell(v.world)}
                {zones.map((z) => (
                  <React.Fragment key={z}>{cell(v.zones[z])}</React.Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
