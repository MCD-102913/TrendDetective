// Ready-made examples. Each one was checked against the data on 12.11.2026:
// the two territories show statistically significant trends of opposite sign or very different size.
import type { L10n } from './api'

export type Case = { id: string; title: L10n; variable: string; region: string; compare: string | null }

export const CASES: Case[] = [
  {
    id: 'arctic',
    variable: 't2m',
    region: 'arctic',
    compare: 'global',
    title: { en: 'The Arctic warms 2.5 times faster than the planet', ru: 'Арктика теплеет в 2,5 раза быстрее планеты' },
  },
  {
    id: 'aerosol',
    variable: 'aod',
    region: 'DEU',
    compare: 'IND',
    title: { en: 'Air clears over Germany, thickens over India', ru: 'Воздух над Германией очищается, над Индией мутнеет' },
  },
  {
    id: 'sunlight',
    variable: 'sw_down',
    region: 'DEU',
    compare: 'IND',
    title: { en: 'Brightening in Europe, dimming in South Asia', ru: 'Европа светлеет, Южная Азия темнеет' },
  },
  {
    id: 'tmax',
    variable: 't2m_max',
    region: 'DEU',
    compare: 'IND',
    title: { en: 'Hotter days in Germany, cooler days in India', ru: 'Дни в Германии жарче, в Индии прохладнее' },
  },
  {
    id: 'ice',
    variable: 'sea_ice',
    region: 'arctic',
    compare: 'antarctic',
    title: { en: 'Sea ice at the two poles', ru: 'Морской лёд на двух полюсах' },
  },
  {
    id: 'rain',
    variable: 'precip_gpm',
    region: 'BRA',
    compare: 'CHN',
    title: { en: 'Less rain over Brazil, more over China', ru: 'В Бразилии дождей меньше, в Китае больше' },
  },
  {
    id: 'no2',
    variable: 'omi_no2',
    region: 'DEU',
    compare: 'IND',
    title: { en: 'NO₂ pollution: down in Germany, up in India', ru: 'Загрязнение NO₂: в Германии падает, в Индии растёт' },
  },
  {
    id: 'plankton',
    variable: 'chl',
    region: 'ocean_n_pacific_gyre',
    compare: null,
    title: { en: 'North Pacific: warmer water, less plankton', ru: 'Север Тихого океана: вода теплее, планктона меньше' },
  },
  {
    id: 'greening',
    variable: 'ndvi',
    region: 'IND',
    compare: 'CHN',
    title: { en: 'India and China are getting greener', ru: 'Индия и Китай зеленеют' },
  },
  {
    id: 'drying',
    variable: 'soil_root',
    region: 'BRA',
    compare: null,
    title: { en: 'Brazil is drying out: two sources agree', ru: 'Бразилия высыхает: два источника согласны' },
  },
  {
    id: 'ozone',
    variable: 'ozone',
    region: 'KAZ',
    compare: null,
    title: { en: 'A step, not a trend: ozone over Kazakhstan', ru: 'Ступенька, а не тренд: озон над Казахстаном' },
  },
]
