import type { Series } from '../api'
import { useI18n } from '../i18n'
import { questionFor } from '../questions'
import { OutlookNote } from './Outlook'
import { TrendChart } from './TrendChart'

type Light = 'green' | 'yellow' | 'grey'

const decimalYear = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return y + (m - 0.5) / 12
}

/** Value of the trend line (in the variable's units) at the first and the last month with data. */
function thenNow(s: Series): { a: number; b: number; then: number; now: number } | null {
  const r = s.rate
  if (!r || r.intercept === undefined) return null
  const valid = s.time.filter((_, i) => s.anomaly[i] !== null)
  const f = (ym: string) => s.mean + (r.per_decade / 10) * decimalYear(ym) + r.intercept!
  return {
    a: Number(valid[0].slice(0, 4)),
    b: Number(valid[valid.length - 1].slice(0, 4)),
    then: f(valid[0]),
    now: f(valid[valid.length - 1]),
  }
}

/** Simple view: the question, a yes or no answer with a traffic light for how sure the verdict is, one picture. */
export function SimplePanel({
  s,
  name,
  loading,
  onDetailed,
  onReport,
}: {
  s: Series
  name: string
  loading: boolean
  onDetailed: () => void
  onReport: () => void
}) {
  const { t, l, num, unit } = useI18n()
  const q = questionFor(s.variable.id)
  const dir = s.verdict.endsWith('_up') ? 'up' : s.verdict.endsWith('_down') ? 'down' : null
  const sig = s.verdict.startsWith('significant')
  const robust = sig && !!s.robustness?.robust
  const twin = s.second_opinion.find((x) => x.agrees)

  let light: Light = 'grey'
  let answer: string
  let trust: string
  if (s.verdict === 'too_short' || !s.rate) {
    answer = t('simple.unclear')
    trust = t('simple.trust.short')
  } else if (!dir || s.verdict === 'no_trend') {
    answer = q ? t('simple.no') : t('simple.flat')
    trust = t('simple.trust.none')
  } else {
    const yes = q ? dir === q.yes : null
    if (sig) {
      light = robust ? 'green' : 'yellow'
      answer =
        yes === null
          ? t(dir === 'up' ? 'simple.rising' : 'simple.falling')
          : t(yes ? (robust ? 'simple.yes' : 'simple.ratherYes') : 'simple.opposite')
      trust = robust ? t('simple.trust.sure') + (twin ? ' ' + t('simple.trust.twin', { src: twin.source }) : '') : t('simple.trust.fragile')
    } else {
      light = 'yellow'
      answer =
        yes === null ? t(dir === 'up' ? 'simple.maybeRising' : 'simple.maybeFalling') : t(yes ? 'simple.maybeYes' : 'simple.maybeOpposite')
      trust = t('simple.trust.likely')
    }
  }

  const tn = thenNow(s)
  const d = s.variable.decimals
  const u = unit(s.variable.units)
  const change = tn
    ? (s.variable.kind === 'rel' || !s.variable.units) && tn.then
      ? `${num(((tn.now - tn.then) / Math.abs(tn.then)) * 100, 0, true)}%`
      : `${num(tn.now - tn.then, d, true)} ${u}`.trim()
    : null

  return (
    <div className={`trend-panel simple-panel ${loading ? 'loading' : ''}`}>
      <header>
        <div className="kicker">{q ? l(q.title) : l(s.variable.name)}</div>
        <h2>{name}</h2>
      </header>
      <div className={`verdicts simple-answer ${light}`}>
        <div className="simple-head">
          <span className="light" aria-hidden />
          <span className="simple-word">{answer}</span>
        </div>
        {tn && change && light !== 'grey' && (
          <div className="simple-change">
            <span className="small muted">{t('simple.change', { a: tn.a, b: tn.b })}</span>
            <b>{change}</b>
            <span className="small muted">
              {num(tn.then, d)} → {num(tn.now, d)} {u}
            </span>
          </div>
        )}
        <p className="small simple-trust">{trust}</p>
      </div>
      <TrendChart main={s} other={null} mainName={name} otherName="" simple />
      <OutlookNote s={s} />
      <div className="panel-actions">
        <button type="button" className="btn wide" onClick={onDetailed}>
          {t('simple.more')}
        </button>
        <button type="button" className="btn" onClick={onReport}>
          {t('report.open')}
        </button>
      </div>
      <p className="muted small">{t('simple.source', { what: l(s.variable.name), src: s.variable.source })}</p>
    </div>
  )
}
