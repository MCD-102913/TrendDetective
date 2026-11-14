import { useEffect, useState } from 'react'
import { api, type Region, type RuleCard, type RuleResult, type RuleStatus } from '../api'
import { useI18n } from '../i18n'

type Props = {
  rule: RuleCard
  currentRegion: string | null
  onPick: (r: Region, variable: string) => void
  onClose: () => void
  /** a session rule: its YAML (to re-check after a reload and to copy) and the result already computed */
  session?: { yaml: string; result?: RuleResult }
}

const ORDER: RuleStatus[] = ['confirmed', 'partial', 'contradicted', 'not_confirmed']
const SHOWN = 14

/** A hypothesis ("A drives B drives C") checked on every territory: where it holds and where the data contradict it. */
export function RulePanel({ rule, currentRegion, onPick, onClose, session }: Props) {
  const { t, l, num } = useI18n()
  const [res, setRes] = useState<RuleResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<RuleStatus>('confirmed')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const ctrl = new AbortController()
    setRes(null)
    setError(null)
    if (session?.result) setRes(session.result)
    else if (session)
      api
        .tryRule(session.yaml, ctrl.signal)
        .then((r) => ('errors' in r ? setError(r.errors.join('; ')) : setRes(r)))
        .catch((e) => {
          if (e.name !== 'AbortError') setError(String(e.message ?? e))
        })
    else
      api
        .rule(rule.id, ctrl.signal)
        .then(setRes)
        .catch((e) => {
          if (e.name !== 'AbortError') setError(String(e.message ?? e))
        })
    return () => ctrl.abort()
    // the session object is rebuilt on every render of the parent: the effect depends on the rule text, not on the object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule.id, session?.yaml])

  const mine = res?.territories.find((x) => x.region_id === currentRegion)
  const lastVar = rule.links[rule.links.length - 1].to
  const rows = res?.territories.filter((x) => x.status === tab) ?? []
  const checked = res ? res.territories.length - res.counts.no_data : 0

  return (
    <div className="scan rule-panel">
      <header>
        <div>
          <div className="legend-title">{l(rule.name)}</div>
          {rule.description && <div className="muted small">{l(rule.description)}</div>}
        </div>
        <button type="button" className="btn" onClick={onClose} aria-label={t('method.close')}>
          ×
        </button>
      </header>
      <ol className="rule-links">
        {rule.links.map((k, i) => (
          <li key={i}>
            {l(k.from_name)} <span className="rule-sign">{k.sign === '+' ? '↑ → ↑' : '↑ → ↓'}</span> {l(k.to_name)}
            <span className="muted small">
              {' '}
              · {t(k.sign === '+' ? 'rule.together' : 'rule.opposite')}, {t('rule.lag', { n: k.max_lag })}
            </span>
          </li>
        ))}
      </ol>
      {session && (
        <div className="rb-session small">
          <span>{t('rb.badge')}</span>
          <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(session.yaml).then(() => setCopied(true))}>
            {copied ? t('rb.copied') : t('rb.copy')}
          </button>
        </div>
      )}
      {(rule.author || rule.source) && <div className="muted small">{[rule.author, rule.source].filter(Boolean).join(' · ')}</div>}
      {error && <p className="error small">{error}</p>}
      {!res && !error && <p className="muted small">{t('rule.loading')}</p>}
      {res && (
        <>
          <p className="small">
            {t('rule.summary', { n: checked, ok: res.counts.confirmed, part: res.counts.partial, bad: res.counts.contradicted })}
          </p>
          {mine && mine.status !== 'no_data' && (
            <div className={`rule-mine ${mine.status}`}>
              <b>
                {l(mine.name)}: {t(`rule.${mine.status}`)}
              </b>
              <ul>
                {mine.links.map((k, i) => (
                  <li key={i} className="small">
                    {l(rule.links[i].from_name)} → {l(rule.links[i].to_name)}:{' '}
                    {k.status === 'no_data'
                      ? t('rule.no_data')
                      : `${t(`rule.link.${k.status}`)}, r = ${num(k.r, 2, true)}${k.lag ? `, ${t('rule.lagged', { n: k.lag })}` : ''}`}
                    {k.trends_agree === true && ` · ${t('rule.trendsAgree')}`}
                    {k.trends_agree === false && ` · ${t('rule.trendsDisagree')}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="rule-tabs" role="tablist">
            {ORDER.map((s) => (
              <button
                type="button"
                key={s}
                role="tab"
                aria-selected={tab === s}
                className={`btn ${tab === s ? 'on' : ''}`}
                onClick={() => setTab(s)}
              >
                {t(`rule.${s}`)} {res.counts[s]}
              </button>
            ))}
          </div>
          <ul className="rule-list">
            {rows.slice(0, SHOWN).map((x) => (
              <li key={x.region_id}>
                <button type="button" onClick={() => onPick(x, lastVar)}>
                  <span>{l(x.name)}</span>
                  <span className="scan-rate">{x.links.map((k) => (k.r === undefined ? '·' : num(k.r, 2, true))).join(' / ')}</span>
                </button>
              </li>
            ))}
          </ul>
          {rows.length > SHOWN && <p className="muted small">{t('rule.more', { n: rows.length - SHOWN })}</p>}
          <p className="muted small">{t('rule.note', { n: res.n_tests })}</p>
        </>
      )}
    </div>
  )
}
