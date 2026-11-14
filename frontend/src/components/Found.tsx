import { useEffect, useState } from 'react'
import {
  api,
  type ChainDetail,
  type ChainKey,
  type FoundChain,
  type FoundLink,
  type FoundPair,
  type FoundPairDetail,
  type L10n,
  type Region,
} from '../api'
import { useI18n } from '../i18n'

const OCEAN_VARS = new Set(['chl', 'ts_ocean', 'sea_ice'])
const SHOWN = 14
const q = (x: string) => JSON.stringify(x) // a JSON string is a valid double-quoted YAML string

/** "Precipitation leads NDVI by 1 month": the lag of a found link in words. */
export function useLagText() {
  const { t, l } = useI18n()
  return (k: { a_name: FoundLink['a_name']; b_name: FoundLink['b_name'] }, lag: number) =>
    lag === 0
      ? t('found.same')
      : t('found.leads', { a: l(lag > 0 ? k.a_name : k.b_name), b: l(lag > 0 ? k.b_name : k.a_name), n: Math.abs(lag) })
}

type RuleLinkDraft = { from: string; to: string; sign: '+' | '-'; lag: number }

/** A session hypothesis in the rules format; the server validates it like any rules file.
 *  origin: found by the exhaustive search on `found` territories, or checked by hand on the links page. */
export function ruleYaml(
  name: { en: string; ru: string },
  found: number,
  links: RuleLinkDraft[],
  oceans: boolean,
  origin: 'search' | 'checked' = 'search',
): string {
  const desc =
    origin === 'search'
      ? {
          en: `Found by the exhaustive search on ${found} territories; the cause is not established.`,
          ru: `Найдено перебором на ${found} территориях; причина не установлена.`,
        }
      : {
          en: 'Linked on the links page; checked here on every country.',
          ru: 'Связь видна на странице связей; здесь проверена на каждой стране.',
        }
  return (
    [
      'version: 1',
      'rules:',
      `  - id: found_${Date.now().toString(36)}`,
      '    name:',
      `      en: ${q(name.en)}`,
      `      ru: ${q(name.ru)}`,
      '    description:',
      `      en: ${q(desc.en)}`,
      `      ru: ${q(desc.ru)}`,
      '    links:',
      ...links.map((k) => `      - {from: ${k.from}, to: ${k.to}, sign: "${k.sign}", max_lag: ${Math.min(6, Math.abs(k.lag) + 1)}}`),
      `    territories: ${oceans ? 'oceans' : 'countries'}`,
    ].join('\n') + '\n'
  )
}

/** A found pair as a hypothesis: the leader becomes "from", the usual lag (+1) the allowed delay. */
export function pairYaml(p: FoundPair): string {
  const lag = Math.round(p.median_lag ?? 0)
  const [from, to] = lag < 0 ? [p.b, p.a] : [p.a, p.b]
  const [nf, nt] = lag < 0 ? [p.b_name, p.a_name] : [p.a_name, p.b_name]
  return ruleYaml(
    { en: `${nf.en} and ${nt.en}`, ru: `${nf.ru} и ${nt.ru}` },
    p.found,
    [{ from, to, sign: p.positive >= p.negative ? '+' : '-', lag }],
    OCEAN_VARS.has(p.a) || OCEAN_VARS.has(p.b),
  )
}

/** A found chain as a two-link hypothesis; the signs are those of most territories where it was found. */
function chainYaml(d: ChainDetail): string {
  const sign = (k: 'r_ab' | 'r_bc') => (d.regions.filter((x) => x[k] > 0).length * 2 >= d.regions.length ? '+' : '-')
  return ruleYaml(
    { en: `${d.a_name.en} → ${d.b_name.en} → ${d.c_name.en}`, ru: `${d.a_name.ru} → ${d.b_name.ru} → ${d.c_name.ru}` },
    d.found,
    [
      { from: d.a, to: d.b, sign: sign('r_ab'), lag: Math.round(d.lag1) },
      { from: d.b, to: d.c, sign: sign('r_bc'), lag: Math.round(d.lag2) },
    ],
    [d.a, d.b, d.c].some((v) => OCEAN_VARS.has(v)),
  )
}

type Tab = 'countries' | 'regions' | 'other'
const tabOf = (level: number): Tab => (level === 0 ? 'countries' : level === 1 ? 'regions' : 'other')

/** Territories of a found link or chain, split into countries, regions inside countries, oceans and belts. */
function TerritoryList<T extends Region>({
  rows,
  currentRegion,
  value,
  onPick,
}: {
  rows: T[]
  currentRegion: string | null
  value: (x: T) => string
  onPick: (x: T) => void
}) {
  const { t, l } = useI18n()
  const counts: Record<Tab, number> = { countries: 0, regions: 0, other: 0 }
  rows.forEach((x) => counts[tabOf(x.level)]++)
  const [tab, setTab] = useState<Tab>(counts.countries ? 'countries' : counts.regions ? 'regions' : 'other')
  const shown = rows.filter((x) => tabOf(x.level) === tab)
  return (
    <>
      <div className="rule-tabs" role="tablist">
        {(['countries', 'regions', 'other'] as const)
          .filter((k) => counts[k])
          .map((k) => (
            <button
              type="button"
              key={k}
              role="tab"
              aria-selected={tab === k}
              className={`btn ${tab === k ? 'on' : ''}`}
              onClick={() => setTab(k)}
            >
              {t(`terr.${k}`)} {counts[k]}
            </button>
          ))}
      </div>
      <ul className="rule-list">
        {shown.slice(0, SHOWN).map((x) => (
          <li key={x.region_id}>
            <button type="button" className={x.region_id === currentRegion ? 'active' : ''} onClick={() => onPick(x)}>
              <span>
                {l(x.name)}
                {x.level === 1 && x.parent_name ? <span className="muted">, {l(x.parent_name)}</span> : null}
              </span>
              <span className="scan-rate">{value(x)}</span>
            </button>
          </li>
        ))}
      </ul>
      {shown.length > SHOWN && <p className="muted small">{t('rule.more', { n: shown.length - SHOWN })}</p>}
    </>
  )
}

/** Map overlay: the territories where the exhaustive search found and replicated the link of one pair. */
export function FoundPanel({
  pair,
  currentRegion,
  onPick,
  onClose,
  onHypothesis,
}: {
  pair: FoundPair
  currentRegion: string | null
  onPick: (r: Region, a: string, b: string) => void
  onClose: () => void
  onHypothesis: (yaml: string) => void
}) {
  const { t, l, num } = useI18n()
  const lagText = useLagText()
  const [d, setD] = useState<FoundPairDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setD(null)
    setError(null)
    api
      .foundPair(pair.a, pair.b)
      .then(setD)
      .catch((e) => setError(String(e.message ?? e)))
  }, [pair.a, pair.b])
  return (
    <div className="scan rule-panel">
      <header>
        <div>
          <div className="legend-title">
            {l(pair.a_name)} ↔ {l(pair.b_name)}
          </div>
          <div className="muted small">{t('found.panelHint')}</div>
        </div>
        <button type="button" className="btn" onClick={onClose} aria-label={t('method.close')}>
          ×
        </button>
      </header>
      <p className={`found-kind ${pair.kind} small`}>{t(`found.kind.${pair.kind}`)}</p>
      <p className="small">
        {t('found.summary', { n: pair.found, m: pair.tested, pos: pair.positive, neg: pair.negative })}{' '}
        {pair.median_lag !== null && t('found.usual', { x: lagText(pair, Math.round(pair.median_lag)) })}
      </p>
      {error && <p className="error small">{error}</p>}
      {!d && !error && <p className="muted small">{t('rule.loading')}</p>}
      {d && (
        <>
          <TerritoryList
            rows={d.regions}
            currentRegion={currentRegion}
            value={(x) => `r = ${num(x.r, 2, true)}`}
            onPick={(x) => onPick(x, pair.a, pair.b)}
          />
          <p className="muted small">{t('found.note', { k: num(d.counts.found_null, 0), n: num(d.counts.found, 0) })}</p>
        </>
      )}
      <button type="button" className="btn wide" onClick={() => onHypothesis(pairYaml(pair))}>
        {t('found.toRule')}
      </button>
    </div>
  )
}

const arrow = (n: { a_name: L10n; b_name: L10n; c_name: L10n }, l: (x: L10n) => string) =>
  `${l(n.a_name)} → ${l(n.b_name)} → ${l(n.c_name)}`

/** Map overlay: one chain A -> B -> C and the territories where it holds. */
export function ChainPanel({
  chain,
  currentRegion,
  onPick,
  onClose,
  onHypothesis,
}: {
  chain: ChainKey
  currentRegion: string | null
  onPick: (r: Region, a: string, b: string) => void
  onClose: () => void
  onHypothesis: (yaml: string) => void
}) {
  const { t, l, num } = useI18n()
  const [d, setD] = useState<ChainDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setD(null)
    setError(null)
    api
      .chain(chain.a, chain.b, chain.c)
      .then(setD)
      .catch((e) => setError(String(e.message ?? e)))
  }, [chain.a, chain.b, chain.c])
  return (
    <div className="scan rule-panel">
      <header>
        <div>
          <div className="legend-title">{d ? arrow(d, l) : '…'}</div>
          <div className="muted small">{t('chain.panelHint')}</div>
        </div>
        <button type="button" className="btn" onClick={onClose} aria-label={t('method.close')}>
          ×
        </button>
      </header>
      {error && <p className="error small">{error}</p>}
      {!d && !error && <p className="muted small">{t('rule.loading')}</p>}
      {d && (
        <>
          <p className={`found-kind ${d.kind} small`}>{t(`found.kind.${d.kind}`)}</p>
          <p className="small">
            {t('chain.summary', { n: d.found, m: d.tested, k: d.countries })} {t('chain.delays', { l1: d.lag1, l2: d.lag2 })}{' '}
            {t('chain.mediation', {
              a: l(d.a_name),
              b: l(d.b_name),
              c: l(d.c_name),
              r: num(d.median_r_ac, 2, true),
              p: num(d.median_partial, 2, true),
            })}
          </p>
          <TerritoryList
            rows={d.regions}
            currentRegion={currentRegion}
            value={(x) => `${num(x.r_ac, 2, true)} → ${num(x.partial, 2, true)}`}
            onPick={(x) => onPick(x, d.a, d.b)}
          />
          <p className="muted small">{t('chain.note')}</p>
          <button type="button" className="btn wide" onClick={() => onHypothesis(chainYaml(d))}>
            {t('found.toRule')}
          </button>
        </>
      )}
    </div>
  )
}

/** In the trend panel: what else the search found linked on this territory, and the chains there. */
export function FoundHere({
  regionId,
  onLink,
  onChain,
}: {
  regionId: string
  onLink: (a: string, b: string) => void
  onChain: (c: ChainKey) => void
}) {
  const { t, l, num } = useI18n()
  const lagText = useLagText()
  const [links, setLinks] = useState<FoundLink[] | null>(null)
  const [chains, setChains] = useState<FoundChain[]>([])
  const [total, setTotal] = useState(0)
  const [chainsTotal, setChainsTotal] = useState(0)
  const [all, setAll] = useState(false)
  useEffect(() => {
    setLinks(null)
    setChains([])
    setAll(false)
    api
      .foundRegion(regionId)
      .then((r) => {
        setLinks(r.links)
        setTotal(r.total)
        setChains(r.chains ?? [])
        setChainsTotal(r.chains_total ?? 0)
      })
      .catch(() => setLinks([]))
  }, [regionId])
  if (!links) return null
  const shown = all ? links : links.slice(0, 6)
  return (
    <section className="found-here">
      <h3>{t('found.hereTitle')}</h3>
      {links.length === 0 ? (
        <p className="muted small">{t('found.hereNone')}</p>
      ) : (
        <>
          <p className="muted small">{t('found.hereHint', { n: total })}</p>
          <ul className="found-list">
            {shown.map((k) => (
              <li key={`${k.a}-${k.b}`}>
                <button type="button" onClick={() => onLink(k.a, k.b)}>
                  <span>
                    {l(k.a_name)} ↔ {l(k.b_name)}
                  </span>
                  <span className="muted small">
                    r = {num(k.r, 2, true)} · {lagText(k, k.lag)}
                  </span>
                  {k.kind !== 'independent' && <span className={`found-kind ${k.kind} small`}>{t(`found.kindShort.${k.kind}`)}</span>}
                </button>
              </li>
            ))}
          </ul>
          {links.length > 6 && (
            <button type="button" className="btn" onClick={() => setAll((v) => !v)}>
              {all ? t('found.less') : t(total > links.length ? 'found.allShown' : 'found.all', { n: links.length })}
            </button>
          )}
        </>
      )}
      {chains.length > 0 && (
        <>
          <h3>{t('chain.hereTitle')}</h3>
          <p className="muted small">{t('chain.hereHint', { n: chainsTotal })}</p>
          <ul className="found-list">
            {chains.slice(0, 6).map((c) => (
              <li key={`${c.a}-${c.b}-${c.c}`}>
                <button type="button" onClick={() => onChain({ a: c.a, b: c.b, c: c.c })}>
                  <span>{arrow(c, l)}</span>
                  <span className="muted small">
                    {t('chain.delays', { l1: c.lag1, l2: c.lag2 })} · r = {num(c.r_ac, 2, true)} → {num(c.partial, 2, true)}
                  </span>
                  {c.kind !== 'independent' && <span className={`found-kind ${c.kind} small`}>{t(`found.kindShort.${c.kind}`)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
