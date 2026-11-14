// Simple view: everyday questions instead of the list of variables. Each question is answered by one variable;
// `yes` is the direction of change that means "yes" (soil drying = the moisture falls).
import type { L10n } from './api'
import type { IconName } from './components/Icon'

export type Question = { id: string; icon: IconName; variable: string; yes: 'up' | 'down'; title: L10n }

export const QUESTIONS: Question[] = [
  { id: 'hotter', icon: 'thermometer', variable: 't2m', yes: 'up', title: { en: 'Is it getting hotter?', ru: 'Становится жарче?' } },
  { id: 'greener', icon: 'leaf', variable: 'ndvi', yes: 'up', title: { en: 'Is the land getting greener?', ru: 'Земля зеленеет?' } },
  {
    id: 'snow',
    icon: 'snowflake',
    variable: 'snow_depth',
    yes: 'down',
    title: { en: 'Is there less snow?', ru: 'Снега становится меньше?' },
  },
  {
    id: 'air',
    icon: 'factory',
    variable: 'omi_no2',
    yes: 'up',
    title: { en: 'Is the air getting dirtier?', ru: 'Воздух становится грязнее?' },
  },
  { id: 'soil', icon: 'drought', variable: 'gldas_soil', yes: 'down', title: { en: 'Is the soil drying out?', ru: 'Почва пересыхает?' } },
  { id: 'rain', icon: 'rain', variable: 'precip_gpm', yes: 'up', title: { en: 'Is there more rain?', ru: 'Дождей становится больше?' } },
  { id: 'ocean', icon: 'waves', variable: 'ts_ocean', yes: 'up', title: { en: 'Is the ocean warming?', ru: 'Океан теплеет?' } },
  {
    id: 'stratosphere',
    icon: 'altitude',
    variable: 't_50',
    yes: 'down',
    title: { en: 'Is the upper atmosphere cooling?', ru: 'Остывает ли верхняя атмосфера?' },
  },
  {
    id: 'ice',
    icon: 'iceberg',
    variable: 'sea_ice',
    yes: 'down',
    title: { en: 'Is sea ice shrinking?', ru: 'Морского льда становится меньше?' },
  },
]

export const questionFor = (variableId: string | undefined) => QUESTIONS.find((q) => q.variable === variableId) ?? null
