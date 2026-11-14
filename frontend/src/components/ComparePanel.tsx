import type { Series, Target, Variable } from '../api'
import { useI18n } from '../i18n'
import { RelationCard } from './RelationCard'
import { PlainVerdict, Verdict } from './TrendPanel'

type Props = {
  a: Series | null
  b: Series | null
  varA: Variable | null
  varB: Variable | null
  variables: Variable[]
  target: Target
  startYear: number | null
  loading: boolean
  error: string | null
  simple: boolean
  territory: string
  onMethod: () => void
  onReport: () => void
  onCsv: () => void
}

/** Compare mode: two variables on one territory. Both trends side by side, then the proof of a link. */
export function ComparePanel({
  a,
  b,
  varA,
  varB,
  variables,
  target,
  startYear,
  loading,
  error,
  simple,
  territory,
  onMethod,
  onReport,
  onCsv,
}: Props) {
  const { t, l } = useI18n()
  if (error) return <p className="error">{t('err.load', { msg: error })}</p>
  if (!a || !b || !varA || !varB) return <p className="muted empty">{loading ? t('cmp.loading') : t('panel.empty')}</p>
  const V = simple ? PlainVerdict : Verdict
  const nameA = simple ? territory : l(a.variable.name)
  const nameB = simple ? territory : l(b.variable.name)
  return (
    <div className={`trend-panel ${loading ? 'loading' : ''}`}>
      <header>
        <div className="kicker">{t('cmp.kicker')}</div>
        <h2>{territory}</h2>
        <div className="muted small">
          {l(a.variable.name)} · {l(b.variable.name)}
        </div>
      </header>
      <div className="verdicts">
        <div className="cmp-tag">A</div>
        <V s={a} name={nameA} tone="main" />
        <div className="cmp-tag b">B</div>
        <V s={b} name={nameB} tone="compare" />
      </div>
      <RelationCard variable={varA} variables={variables} target={target} startYear={startYear} fixedOther={varB.id} />
      <div className="panel-actions">
        <button className="btn wide" onClick={onMethod}>
          {t('method.open')}
        </button>
        <button className="btn" onClick={onReport}>
          {t('cmp.report')}
        </button>
        <button className="btn" onClick={onCsv}>
          CSV
        </button>
      </div>
      <p className="muted small">{t('cmp.hint')}</p>
    </div>
  )
}
