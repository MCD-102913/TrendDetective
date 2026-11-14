import { useEffect } from 'react'
import type { Series } from '../api'
import { useI18n } from '../i18n'
import { shownRate } from '../rate'
import { Mark } from './Icon'
import { SkillTable } from './Outlook'
import { VerifyCard } from './VerifyCard'

const P_LEVEL = 0.05

/** The statistical evidence behind the verdict for the selected territory. */
function Evidence({ s, name }: { s: Series; name: string }) {
  const { t, num, unit, l } = useI18n()
  if (!s.tests || !s.sen || !s.rate) return <p className="muted">{t('verdict.too_short')}</p>
  const tt = s.tests
  const scale = s.variable.kind === 'rel' && s.mean ? 100 / Math.abs(s.mean) : 1
  const { units, decimals } = shownRate(s)
  const pText = (p: number | undefined) => (p === undefined || p === null ? 'p ·' : p < 0.001 ? `p < ${num(0.001, 3)}` : `p = ${num(p, 3)}`)
  const row = (ok: boolean, label: string, detail: string) => (
    <li className={ok ? 'pass' : 'fail'}>
      <span className="mark" aria-hidden>
        <Mark ok={ok} fail="open" />
      </span>
      <div>
        <div>{label}</div>
        <div className="muted small">{detail}</div>
      </div>
    </li>
  )
  const sig = (p: number | undefined) => p !== undefined && p < P_LEVEL
  const rb = s.robustness
  const cp = s.change_point
  const need = s.years_to_detect
  return (
    <section className="evidence">
      <h3>{t('method.evidenceFor', { what: l(s.variable.name), where: name })}</h3>
      <ul className="tests">
        {row(
          sig(tt.t_test.p),
          t('tests.t'),
          `${pText(tt.t_test.p)} · ${sig(tt.t_test.p) ? t('tests.pass') : t('tests.fail')} · ${t('tests.neff', { n: s.n_months, e: num(tt.t_test.n_eff, 0), r: num(tt.t_test.r1, 2) })}`,
        )}
        {row(
          sig(tt.mann_kendall.p),
          t('tests.mk'),
          `${pText(tt.mann_kendall.p)} · ${sig(tt.mann_kendall.p) ? t('tests.pass') : t('tests.fail')}`,
        )}
        {row(
          tt.sen_interval.excludes_zero,
          t('tests.sen', {
            v: `${num(s.sen.per_decade * scale, decimals, true)} ${unit(units)}`,
            lo: num(s.sen.lo * scale, decimals, true),
            hi: num(s.sen.hi * scale, decimals, true),
          }),
          tt.sen_interval.excludes_zero ? t('tests.senOut') : t('tests.senIn'),
        )}
      </ul>
      {rb?.checks && (
        <>
          <h3>{t('robust.title')}</h3>
          <ul className="tests">
            {row(
              rb.checks.halves,
              t('robust.halves', { year: rb.split_year ?? '' }),
              t('robust.halvesDetail', {
                a: `${num((rb.first_half ?? 0) * scale, decimals, true)} ${unit(units)}`,
                b: `${num((rb.second_half ?? 0) * scale, decimals, true)} ${unit(units)}`,
              }),
            )}
            {row(rb.checks.drop_start, t('robust.dropStart'), rb.checks.drop_start ? t('robust.holds') : t('robust.breaks'))}
            {row(rb.checks.drop_end, t('robust.dropEnd'), rb.checks.drop_end ? t('robust.holds') : t('robust.breaks'))}
            {row(
              rb.checks.no_step,
              t('robust.noStep'),
              cp?.is_step
                ? t('cp.step', { v: `${num(cp.shift, s.variable.decimals, true)} ${unit(s.variable.units)}`, year: cp.year })
                : t('cp.none'),
            )}
          </ul>
        </>
      )}
      {s.second_opinion.length > 0 && (
        <>
          <h3>{t('twin.title')}</h3>
          <ul className="tests">
            {s.second_opinion.map((tw) =>
              row(
                tw.agrees,
                `${l(tw.name)} · ${tw.source}`,
                `${num(tw.per_decade, tw.decimals, true)} ${unit(tw.units)} ${t('rate.perDecade')} · ${t(`verdict.${tw.verdict}`)} · ${tw.years[0]} ${t('word.to')} ${tw.years[1]}`,
              ),
            )}
          </ul>
        </>
      )}
      {need && need > s.n_years && <p className="note">{t('detect.need', { n: num(need, 0), have: s.n_years })}</p>}
    </section>
  )
}

/** "Methodology and evidence": the numbers behind the current verdict + how every number is obtained. */
export function Method({ series, name, onClose }: { series: Series | null; name: string; onClose: () => void }) {
  const { t, lang } = useI18n()
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t('method.title')}>
        <header className="modal-head">
          <h2>{t('method.title')}</h2>
          <button type="button" className="btn" onClick={onClose}>
            {t('method.close')}
          </button>
        </header>
        <div className="modal-body">
          {series && <Evidence s={series} name={name} />}
          {series && <VerifyCard s={series} />}
          {lang === 'ru' ? <TextRu /> : <TextEn />}
          <SkillTable />
        </div>
      </div>
    </div>
  )
}

function TextEn() {
  return (
    <section className="method-text">
      <h3>How a verdict is reached</h3>
      <ol>
        <li>
          <b>Series of a territory.</b> Area-weighted mean of the grid cells inside it, month by month. A month counts only if at least 70%
          of the area has data.
        </li>
        <li>
          <b>Season removed.</b> Each month is compared with the average of the same calendar month, so summer and winter do not masquerade
          as change.
        </li>
        <li>
          <b>Rate.</b> Straight-line fit to the monthly values, expressed per decade, with a 95% interval.
        </li>
        <li>
          <b>Significance needs two independent tests.</b> A t-test of the rate, corrected for autocorrelation (neighbouring months are not
          independent, which shrinks the effective sample), and the Mann-Kendall rank test on annual means with the Hamed-Rao correction.
          "Significant" means both give p &lt; 0.05 with the same sign. The Sen slope interval is shown as a third, outlier-resistant
          witness.
        </li>
        <li>
          <b>Robust trend.</b> On top of significance: the same sign in both halves of the record, still significant without the first fifth
          of the years and without the last fifth, and not better explained by one abrupt step.
        </li>
        <li>
          <b>Second source.</b> Where NASA offers the same quantity from another instrument or model, its trend over the common period is
          shown next to ours.
        </li>
      </ol>
      <h3>How a link between two variables is proven</h3>
      <p>
        Two series that both trend will always correlate, so the trend of each is removed first. What is left are the month-to-month and
        year-to-year swings: if those move together, the two quantities are physically connected. Lags of up to six months in either
        direction are tried, and the p-value of the best one is multiplied by the number of lags tried. A link is reported when p &lt; 0.05
        and |r| is at least 0.3. If only the raw series correlate, the verdict is "shared trend, no proven link". Correlation shows a
        connection, not which one causes the other.
      </p>
      <h3>The map</h3>
      <p>
        Every cell gets a Sen slope and a Mann-Kendall test on its annual means. With 200,000 cells, 5% would look significant by chance, so
        the Benjamini-Hochberg procedure keeps false discoveries at 5% of the highlighted cells.
      </p>
      <h3>Map layers</h3>
      <p>
        <b>Trend</b> is the rate of change per decade with its significance, as described above. <b>Normal</b> is the mean of all months of
        the record in each cell: where a quantity is high or low at all. <b>Last year</b> is the annual mean anomaly of the last complete
        year against that normal (in % of the mean for quantities like rain). <b>From space</b> is the latest NASA GIBS imagery closest to
        the variable, the same pictures as in NASA Worldview: a single day or month, weather rather than climate. None of the verdicts is
        computed from it.
      </p>
      <h3>How we know the tests are honest</h3>
      <p>
        On synthetic series with no trend (30 years, noise with autocorrelation from 0 to 0.8) the verdict "significant" appears in 3.5 to
        4% of runs, and the 95% interval contains the true rate in 95% of runs. The plain seasonal Mann-Kendall test gave false alarms in 12
        to 50% of the same runs, so it is not used. For links: independent series are called linked in 0 to 2% of runs, and two series that
        share only a trend are never called linked.
      </p>
      <h3>If the trend continues</h3>
      <p>
        For a significant and robust trend the annual means are continued for a third of the record length (25 years of data give 8 years
        ahead). Four models keep the same straight-line slope and differ in where they start: the fitted line itself; the line from the mean
        of the last five years (it catches a recent step or acceleration); a damped trend from that level, whose yearly step shrinks by 10%
        each year ahead; and the average of the two lines. An acceleration is never extrapolated.
      </p>
      <p>
        Which model to use, and how wide the ranges must be, is learned from the past. For every variable we pretended it was earlier: on
        the first 60, 67.5 and 75% of the record of every country, every larger region inside a country and every ocean region, each model
        was continued and compared with what really happened. The model with the smallest error is chosen, and the 80% and 95% ranges are
        widened until they held 80% and 95% of the real years (never narrower than the theory). This is done for the whole world and
        separately for each climate zone: the tropics, the two mid-latitude belts and the polar regions. The numbers you see are judged
        honestly: the countries are split into two halves, the model is chosen and calibrated on one half and scored on the other. The
        outlook is shown in a zone only if there it beat both naive answers, "as on average" and "as in the last five years", and its 95%
        range held at least 85% of the real years; where a zone had too few checks, the verdict for the whole world applies.
      </p>
      <h3>Links found by the exhaustive search</h3>
      <p>
        Every pair of variables is tested on every country, ocean region and latitude belt with the same test as a hypothesis. With over a
        hundred thousand tests, chance alone would produce thousands of "links", so three filters apply. Pairs that are the same quantity
        from different sources (for example NDVI and EVI) are skipped. The link is searched on the first half of the common years and must
        pass the Benjamini-Hochberg threshold computed over all tests at once. Then it must repeat on the second half, which the search
        never saw: the same sign, nearly the same delay, p &lt; 0.05. To measure what slips through, the whole search is repeated on pairs
        shifted by whole years, where any real link is destroyed but season, trend and autocorrelation stay; the number it still finds is
        shown as the expected share of chance findings. A found link is a connection, not a proven cause.
      </p>
      <p>
        The search covers countries, ocean regions, latitude belts and the regions inside countries that span at least eight grid cells.{' '}
        <b>Chains</b> A → B → C are assembled only from links found on the same territory, with A not later than B and B not later than C
        and a real delay somewhere. On the second half of the years, which the search never saw, A must relate to C at the summed delay with
        the sign the two links imply, and taking B into account must remove at least half of that relation: B carries it. Chains whose both
        links come from one model are dropped.
      </p>
      <h3>Known traps</h3>
      <ul>
        <li>
          MERRA-2 and GLDAS are models: when a new satellite enters the system the record can shift in one step. The step check flags this.
        </li>
        <li>GLDAS has no glaciers, so snow piles up without limit on ice sheets; such cells are masked.</li>
        <li>The orbit of the Terra satellite has drifted since 2022, which affects its daytime surface temperature.</li>
        <li>Satellite precipitation is unreliable poleward of 60 degrees.</li>
      </ul>
    </section>
  )
}

function TextRu() {
  return (
    <section className="method-text">
      <h3>Как получается вывод</h3>
      <ol>
        <li>
          <b>Ряд территории.</b> Среднее по ячейкам сетки внутри неё с весами по площади, месяц за месяцем. Месяц учитывается, только если
          данные есть не меньше чем на 70% площади.
        </li>
        <li>
          <b>Убираем сезон.</b> Каждый месяц сравнивается со средним для того же календарного месяца, чтобы лето и зима не выдавали себя за
          изменение.
        </li>
        <li>
          <b>Скорость.</b> Прямая по месячным значениям, в пересчёте на 10 лет, с 95%-м интервалом.
        </li>
        <li>
          <b>Значимость требует двух независимых проверок.</b> Это t-тест скорости с поправкой на автокорреляцию (соседние месяцы не
          независимы, поэтому эффективная выборка меньше) и ранговый тест Манна-Кендалла по годовым средним с поправкой Хамеда-Рао.
          «Значимо» означает, что оба дают p &lt; 0,05 и один знак. Интервал наклона Сена показан как третий свидетель, устойчивый к
          выбросам.
        </li>
        <li>
          <b>Устойчивый тренд.</b> Сверх значимости: знак одинаков в обеих половинах ряда, значимость сохраняется без первой пятой части лет
          и без последней, и изменение не объясняется лучше одной резкой ступенькой.
        </li>
        <li>
          <b>Второй источник.</b> Если у NASA есть та же величина по другому прибору или модели, её тренд за общий период показан рядом.
        </li>
      </ol>
      <h3>Как доказывается связь двух показателей</h3>
      <p>
        Два ряда с трендами всегда коррелируют, поэтому сначала из каждого убирается его тренд. Остаются колебания от месяца к месяцу и от
        года к году: если они идут вместе, величины связаны физически. Проверяются сдвиги до шести месяцев в обе стороны, и p-значение
        лучшего умножается на число проверенных сдвигов. Связь считается доказанной при p &lt; 0,05 и |r| не меньше 0,3. Если коррелируют
        только исходные ряды, вывод: «общий тренд, связь не доказана». Корреляция показывает связь, а не то, что из двух причина.
      </p>
      <h3>Карта</h3>
      <p>
        Для каждой ячейки считается наклон Сена и тест Манна-Кендалла по годовым средним. При 200 000 ячеек 5% выглядели бы значимыми
        случайно, поэтому процедура Бенджамини-Хохберга ограничивает долю ложных находок пятью процентами выделенных ячеек.
      </p>
      <h3>Слои карты</h3>
      <p>
        <b>Тренд</b>: скорость изменения за 10 лет и её значимость, как описано выше. <b>Норма</b>: среднее за все месяцы ряда в каждой
        ячейке, то есть где величина вообще высокая или низкая. <b>Прошлый год</b>: отклонение среднего за последний полный год от этой
        нормы (для величин вроде осадков в процентах от среднего). <b>Из космоса</b>: свежий снимок NASA GIBS, ближайший к показателю, те же
        картинки, что в NASA Worldview. Это один день или месяц, погода, а не климат; ни один вывод по нему не считается.
      </p>
      <h3>Откуда мы знаем, что проверки честные</h3>
      <p>
        На синтетических рядах без тренда (30 лет, шум с автокорреляцией от 0 до 0,8) вывод «значимо» появляется в 3,5-4% прогонов, а 95%-й
        интервал содержит истинную скорость в 95% прогонов. Обычный сезонный тест Манна-Кендалла на тех же рядах ошибался в 12-50% случаев,
        поэтому он не используется. Для связей: независимые ряды называются связанными в 0-2% прогонов, а ряды, у которых общий только
        тренд, ни разу.
      </p>
      <h3>Если тренд сохранится</h3>
      <p>
        Для значимого и устойчивого тренда годовые средние продлеваются на треть длины ряда (25 лет данных дают 8 лет вперёд). Четыре модели
        сохраняют один и тот же наклон прямой и отличаются тем, откуда стартуют: сама прямая; прямая от среднего за последние пять лет (она
        ловит недавнюю ступеньку или ускорение); затухающий тренд от того же уровня, у которого шаг за год каждый следующий год меньше на
        10%; среднее двух прямых. Ускорение никогда не продлевается.
      </p>
      <p>
        Какую модель брать и насколько широкими делать диапазоны, мы узнаём по прошлому. Для каждого показателя мы делали вид, что сейчас
        раньше: по первым 60, 67,5 и 75% ряда каждой страны, каждого крупного региона внутри страны и каждого океанского района каждая
        модель продлевалась и сравнивалась с тем, что было на самом деле. Выбирается модель с наименьшей ошибкой, а диапазоны 80% и 95%
        расширяются, пока не накроют 80% и 95% реальных лет (но не уже теории). Это делается для всего мира и отдельно для каждой
        климатической зоны: тропиков, двух поясов умеренных широт и полярных районов. Числа на сайте проверены честно: страны делятся на две
        половины, модель выбирается и настраивается на одной и оценивается на другой. Продолжение показывается в зоне, только если там оно
        оказалось точнее обоих наивных ответов, «как в среднем» и «как в последние пять лет», а его 95%-й диапазон накрыл не меньше 85%
        реальных лет; если в зоне проверок мало, действует вывод по всему миру.
      </p>
      <h3>Связи, найденные перебором</h3>
      <p>
        Каждая пара показателей проверяется на каждой стране, океанском районе и широтном поясе той же проверкой, что и гипотеза. При сотне
        тысяч проверок случайность сама дала бы тысячи «связей», поэтому стоят три фильтра. Пары, которые являются одной величиной из разных
        источников (например NDVI и EVI), пропускаются. Связь ищется на первой половине общих лет и должна пройти порог Бенджамини-Хохберга,
        посчитанный сразу по всем проверкам. Затем она должна повториться на второй половине, которую перебор не видел: тот же знак, почти
        та же задержка, p &lt; 0,05. Чтобы измерить, что проскакивает, весь перебор повторяется на парах, сдвинутых на целые годы: настоящая
        связь там разрушена, а сезон, тренд и автокорреляция остаются. Сколько он находит там, показано как ожидаемая доля случайных
        находок. Найденная связь показывает связь, а не доказанную причину.
      </p>
      <p>
        Перебор идёт по странам, океанским районам, широтным поясам и регионам внутри стран, которые занимают хотя бы восемь ячеек сетки.{' '}
        <b>Цепочки</b> A → B → C собираются только из связей, найденных на той же территории: A не позже B, B не позже C, и где-то есть
        настоящая задержка. На второй половине лет, которую перебор не видел, A должно быть связано с C с суммарной задержкой и со знаком,
        который следует из двух звеньев, а учёт B должен убрать хотя бы половину этой связи: значит, её передаёт B. Цепочки, у которых оба
        звена из одной модели, отбрасываются.
      </p>
      <h3>Известные ловушки</h3>
      <ul>
        <li>
          MERRA-2 и GLDAS это модели: когда в систему входит новый спутник, ряд может сдвинуться одной ступенькой. Проверка на ступеньку это
          отмечает.
        </li>
        <li>В GLDAS нет ледников, поэтому на ледяных щитах снег копится без предела; такие ячейки замаскированы.</li>
        <li>Орбита спутника Terra дрейфует с 2022 года, это влияет на его дневную температуру поверхности.</li>
        <li>Спутниковые осадки ненадёжны ближе к полюсам, чем 60 градусов широты.</li>
      </ul>
    </section>
  )
}
