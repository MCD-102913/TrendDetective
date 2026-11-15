import type { ChainKey, Region, Series, Target, Variable } from '../api'
import { useI18n } from '../i18n'
import { plainVerdict } from '../plain'
import { shownRate } from '../rate'
import { FoundHere } from './Found'
import { ProfileCard } from './ProfileCard'
import { Mark } from './Icon'
import { OutlookNote } from './Outlook'
import { RegionSearch } from './RegionSearch'
import { RelationCard } from './RelationCard'
import { TrendChart } from './TrendChart'

/** Simple view: the verdict as one or two plain sentences. */
export function PlainVerdict({ s, name, tone }: { s: Series; name: string; tone: 'main' | 'compare' }) {
  const { t, num, unit, l } = useI18n()
  const dir = s.verdict.endsWith('_up') ? 'up' : s.verdict.endsWith('_down') ? 'down' : 'flat'
  const [first, ...rest] = plainVerdict(s, name, t, num, l, unit)
  return (
    <div className={`verdict plain ${dir} ${s.verdict.startsWith('significant') ? 'strong' : ''} ${tone}`}>
      <div className="plain-main">{first}</div>
      {rest.map((x, i) => (
        <div key={i} className="small plain-rest">
          {x}
        </div>
      ))}
    </div>
  )
}

// beyond this the estimate says only that the record is far too short
const MAX_YEARS_SHOWN = 100

/** A trend that is not proven yet may only need a longer record: how many years this noise needs (Weatherhead 1998). */
export function LongerRecord({ s }: { s: Series }) {
  const { t, num } = useI18n()
  const need = s.years_to_detect
  const unproven = s.verdict === 'no_trend' || s.verdict === 'likely_up' || s.verdict === 'likely_down'
  if (!unproven || !need || !Number.isFinite(need) || need <= s.n_years) return null
  return (
    <p className="small detect">
      {need > MAX_YEARS_SHOWN ? t('detect.century', { have: s.n_years }) : t('detect.longer', { n: num(need, 0), have: s.n_years })}
    </p>
  )
}

export function Verdict({ s, name, tone }: { s: Series; name: string; tone: 'main' | 'compare' }) {
  const { t, num, unit, l } = useI18n()
  const dir = s.verdict.endsWith('_up') ? 'up' : s.verdict.endsWith('_down') ? 'down' : 'flat'
  const strong = s.verdict.startsWith('significant')
  if (!s.rate) {
    return (
      <div className={`verdict flat ${tone}`}>
        <div className="verdict-name">{name}</div>
        <div className="verdict-label">{t('verdict.too_short')}</div>
      </div>
    )
  }
  const { rate, units, decimals } = shownRate(s)
  const robust = s.robustness?.robust
  const twin = s.second_opinion.find((x) => x.agrees) ?? s.second_opinion[0]
  return (
    <div className={`verdict ${dir} ${strong ? 'strong' : ''} ${tone}`}>
      <div className="verdict-name">{name}</div>
      <div className="verdict-rate">
        <span className="arrow" aria-hidden>
          {rate.per_decade > 0 ? '▲' : '▼'}
        </span>
        {num(rate.per_decade, decimals, true)}{' '}
        <span className="units">
          {unit(units)} {t('rate.perDecade')}
        </span>
      </div>
      <div className="verdict-label">
        {t(`verdict.${s.verdict}`)}
        {strong && <span className={`badge ${robust ? 'ok' : 'warn'}`}>{t(robust ? 'robust.yes' : 'robust.no')}</span>}
      </div>
      <div className="muted small">
        {t('rate.ci', { lo: num(rate.lo, decimals, true), hi: num(rate.hi, decimals, true) })}
        {' · '}
        {t('rate.total', { v: `${num(s.total_change, s.variable.decimals, true)} ${unit(s.variable.units)}`, n: s.n_years })}
        {' · '}
        {t('rate.mean', { v: `${num(s.mean, s.variable.decimals)} ${unit(s.variable.units)}` })}
      </div>
      {tone === 'main' && <LongerRecord s={s} />}
      {tone === 'main' && twin && (
        <div className="small twin">
          <Mark ok={twin.agrees} fail="open" />{' '}
          {t(twin.agrees ? 'twin.agrees' : 'twin.differs', {
            src: twin.source,
            name: l(twin.name),
            v: `${num(twin.per_decade, twin.decimals, true)} ${unit(twin.units)}`,
          })}
        </div>
      )}
    </div>
  )
}

type Props = {
  variable: Variable | null
  onPickVariable: (id: string) => void
  variables: Variable[]
  target: Target
  startYear: number | null
  main: Series | null
  other: Series | null
  loading: boolean
  error: string | null
  onCompare: (r: Region | null) => void
  onMethod: () => void
  onReport: () => void
  onCsv: () => void
  simple: boolean
  nameOf: (s: Series) => string
  onLink: (a: string, b: string) => void
  onChain: (c: ChainKey) => void
  relPreset: { id: string; n: number } | null
}

export function TrendPanel({
  variable,
  onPickVariable,
  variables,
  target,
  startYear,
  main,
  other,
  loading,
  error,
  onCompare,
  onMethod,
  onReport,
  onCsv,
  simple,
  nameOf,
  onLink,
  onChain,
  relPreset,
}: Props) {
  const { t, l, num } = useI18n()
  if (error) return <p className="error">{t('err.load', { msg: error })}</p>
  if (!main || !variable) {
    return (
      <p className="muted empty">
        {loading && variable ? t('panel.loading', { n: new Date().getFullYear() - Number(variable.start.slice(0, 4)) }) : t('panel.empty')}
      </p>
    )
  }
  let compareNote: string | null = null
  const real = (s: Series) => s.verdict !== 'no_trend' && s.verdict !== 'too_short'
  if (other?.rate && main.rate && real(main) && real(other)) {
    const a = shownRate(main).rate.per_decade
    const b = shownRate(other).rate.per_decade
    if (Math.sign(a) !== Math.sign(b)) compareNote = t('compare.opposite')
    else {
      const k = Math.max(Math.abs(a), Math.abs(b)) / Math.max(Math.min(Math.abs(a), Math.abs(b)), 1e-9)
      compareNote = k < 100 ? t('compare.same', { k: num(k, 1) }) : null
    }
  }
  return (
    <div className={`trend-panel ${loading ? 'loading' : ''}`}>
      <header>
        <div className="kicker">{l(main.variable.name)}</div>
        <h2>{nameOf(main)}</h2>
        <div className="muted small">
          {t('panel.cells', { n: main.territory.cells_with_data, a: main.period.start, b: main.period.end, src: main.variable.source })}
        </div>
      </header>
      <div className="verdicts">
        {simple ? (
          <>
            <PlainVerdict s={main} name={nameOf(main)} tone="main" />
            {other && <PlainVerdict s={other} name={nameOf(other)} tone="compare" />}
          </>
        ) : (
          <>
            <Verdict s={main} name={nameOf(main)} tone="main" />
            {other && <Verdict s={other} name={nameOf(other)} tone="compare" />}
          </>
        )}
      </div>
      {compareNote && <p className="note accent">{compareNote}</p>}
      <TrendChart main={main} other={other} mainName={nameOf(main)} otherName={other ? nameOf(other) : ''} />
      {!other && <OutlookNote s={main} />}
      {variable.profile && (
        <ProfileCard
          quantity={variable.profile.quantity}
          current={variable.id}
          target={target}
          startYear={startYear}
          onPick={onPickVariable}
        />
      )}
      <div className="panel-actions">
        <button type="button" className="btn wide" onClick={onMethod}>
          {t('method.open')}
        </button>
        <button type="button" className="btn" onClick={onReport}>
          {t('report.open')}
        </button>
        <button type="button" className="btn" onClick={onCsv}>
          CSV
        </button>
      </div>
      <section className="compare">
        <h3>{t('compare.title')}</h3>
        <div className="compare-row">
          <RegionSearch placeholder={t('compare.add')} onPick={onCompare} />
          {other && (
            <button type="button" className="btn" onClick={() => onCompare(null)}>
              {t('compare.remove')}
            </button>
          )}
        </div>
      </section>
      <RelationCard variable={variable} variables={variables} target={target} startYear={startYear} preset={relPreset} />
      {target.kind === 'region' && target.region.region_id !== 'global' && (
        <FoundHere regionId={target.region.region_id} onLink={onLink} onChain={onChain} />
      )}
    </div>
  )
}
