# Hypotheses: how to write a rule

A rule (a hypothesis) is an expert statement of the form "A drives B, B drives C". TerraScope checks it on
NASA data for every country or for the territories you choose and shows where the hypothesis holds, where it does
not, and where the data say the opposite.

No programming is needed. A rule is a few lines of YAML: which quantities are linked, in which direction and with
what delay.

```yaml
  - id: rain_feeds_plants
    name:
      en: Rain wets the soil, wet soil greens the land
      ru: Дождь увлажняет почву, влажная почва озеленяет землю
    links:
      - {from: precip_gpm, to: soil_root, sign: "+", max_lag: 2}
      - {from: soil_root, to: ndvi, sign: "+", max_lag: 3}
    territories: countries
```

It reads: "more rain, wetter root zone soil (within 2 months), greener vegetation (within 3 months); check in every
country".

There are two kinds of rules:

* **shared rules** live in `rules/rules.yaml` and are shown to everyone;
* **session rules**: a visitor builds a hypothesis in the form on the site and sees the result at once; it stays in
  that browser tab only and is never stored on the server (section 7).

## 1. A rule in five steps

1. **Say the chain in words.** For example: "the more aerosol, the less sunlight reaches the ground, and the lower
   the daily maximum temperature".
2. **Find the quantities** in the reference (section 4) and write down their codes: aerosol `aod`, sunlight
   `sw_down`, daily maximum `t2m_max`.
3. **Choose a sign for every link** (section 6): `"+"` when they rise and fall together, `"-"` when one rises as the
   other falls. Aerosol to sunlight: `"-"`. Sunlight to daily maximum: `"+"`.
4. **Choose the delay** `max_lag` in months (section 6): how long the effect may take to follow the cause. Sunlight
   and temperature 0 or 1, rain and soil 1 or 2, soil and vegetation 2 or 3.
5. **Choose the territories** (section 5): `countries` (every country) or a list of codes.

### Template

```yaml
  - id: my_hypothesis                 # lowercase Latin letters, digits and _, 3 to 40 characters
    name:
      en: Short title in English
      ru: Короткое название по-русски
    description:                      # optional: the mechanism in one or two sentences
      en: Why A should drive B.
      ru: Почему A должно влиять на B.
    author: First Last                # optional
    source: "Author et al., year, journal"   # optional: where the hypothesis comes from
    links:
      - {from: CAUSE_CODE, to: EFFECT_CODE, sign: "+", max_lag: 1}
    territories: countries            # or a list: [IND, PAK, BGD]
```

A rule goes at the end of the `rules` list. Indentation matters: two spaces before `- id:`, four before the other
fields. Spaces only, no tabs.

## 2. The file

```yaml
version: 1
rules:
  - id: first_rule
    ...
  - id: second_rule
    ...
```

UTF-8, at most 64 KB and 40 rules. Lines starting with `#` are comments.

## 3. Fields

| Field | Required | Content | Limits |
|---|---|---|---|
| `id` | yes | unique code of the rule | lowercase Latin letters, digits and `_`; 3 to 40 characters; starts with a letter; unique |
| `name` | yes | title | a string or an `en` / `ru` pair; up to 120 characters |
| `description` | no | the mechanism | a string or an `en` / `ru` pair; up to 600 characters |
| `author` | no | author of the hypothesis | up to 80 characters |
| `source` | no | publication the hypothesis comes from | up to 200 characters |
| `links` | yes | links of the chain | 1 to 6 links |
| `territories` | no | where to check | `countries` (default), `oceans` (every ocean region) or a list of up to 300 codes |
| `start_year` | no | first year of data to use | an integer from 1980 to 2020 |

Fields of a link:

| Field | Required | Content |
|---|---|---|
| `from` | yes | code of the cause |
| `to` | yes | code of the effect |
| `sign` | yes | `"+"` or `"-"`, **always in quotes** |
| `max_lag` | no | how many months the effect may lag: 0 to 6, default 3 |
| `note` | no | a note on the link, up to 200 characters, a string or an `en` / `ru` pair |

A link can be written on one line (`- {from: aod, to: sw_down, sign: "-", max_lag: 1}`) or on several; both mean
the same:

```yaml
      - from: aod
        to: sw_down
        sign: "-"
        max_lag: 1
```

Texts may not contain `<`, `>`, `{`, `}`. A text with a colon needs quotes:
`source: "Behrenfeld et al. 2006: Nature"`.

**Texts with commas go on separate lines**, as in the template. Inside curly braces a comma separates fields:
`name: {en: More snow, more runoff, ru: ...}` breaks at "more runoff". On one line, quote the texts:
`name: {en: "More snow, more runoff", ru: "Больше снега, больше стока"}`.

## 4. Quantities

"From" is the first year of data. A link is checked on the years the two quantities have in common; there must be
at least 10. The current list is also served by the API: `GET /api/variables`.

### Atmosphere

| Code | Quantity | Source | Units | From |
|---|---|---|---|---|
| `t2m` | Air temperature at 2 m | MERRA-2 | °C | 1981 |
| `t2m_max` | Daily maximum temperature | MERRA-2 | °C | 1981 |
| `t2m_min` | Daily minimum temperature | MERRA-2 | °C | 1981 |
| `qv2m` | Specific humidity at 2 m | MERRA-2 | g/kg | 1981 |
| `rh2m` | Relative humidity at 2 m | MERRA-2 | % | 1981 |
| `tqv` | Total column water vapour | MERRA-2 | kg/m² | 1981 |
| `ws10m` | Wind speed at 10 m | MERRA-2 | m/s | 1981 |
| `slp` | Sea level pressure | MERRA-2 | hPa | 1981 |
| `ozone` | Total column ozone | MERRA-2 | DU | 1981 |
| `omi_no2` | Nitrogen dioxide (NO₂), troposphere | OMI | 10¹⁵ molec/cm² | 2004 |
| `airs_tair` | Surface air temperature (satellite) | AIRS | °C | 2002 |
| `airs_h2o` | Total water vapour (satellite) | AIRS | kg/m² | 2002 |

### Water cycle

| Code | Quantity | Source | Units | From |
|---|---|---|---|---|
| `precip_gpm` | Precipitation (satellite) | GPM IMERG | mm/day | 1998 |
| `precip_merra` | Precipitation (model) | MERRA-2 | mm/day | 1981 |
| `evland` | Evaporation from land | MERRA-2 | mm/day | 1981 |
| `gldas_evap` | Evapotranspiration | GLDAS | mm/day | 2000 |
| `gldas_runoff` | Runoff | GLDAS | mm/day | 2000 |

### Land surface

| Code | Quantity | Source | Units | From |
|---|---|---|---|---|
| `gldas_soil` | Soil moisture, top 10 cm | GLDAS | kg/m² | 2000 |
| `gldas_root` | Root zone soil moisture | GLDAS | kg/m² | 2000 |
| `soil_top` | Surface soil wetness | MERRA-2 | fraction (0 to 1) | 1981 |
| `soil_root` | Root zone soil wetness | MERRA-2 | fraction (0 to 1) | 1981 |
| `ts` | Surface skin temperature | MERRA-2 | °C | 1981 |
| `ndvi` | Vegetation greenness (NDVI) | MODIS Terra | none | 2000 |
| `evi` | Vegetation index (EVI) | MODIS Terra | none | 2000 |
| `lst_day` | Land surface temperature, day | MODIS Terra | °C | 2000 |
| `lst_night` | Land surface temperature, night | MODIS Terra | °C | 2000 |

### Snow and ice

| Code | Quantity | Source | Units | From |
|---|---|---|---|---|
| `snow_depth` | Snow depth | MERRA-2 | cm | 1981 |
| `snow_frac` | Snow covered fraction | MERRA-2 | fraction (0 to 1) | 1981 |
| `gldas_swe` | Snow water equivalent | GLDAS | mm | 2000 |
| `sea_ice` | Sea ice fraction | MERRA-2 | fraction (0 to 1) | 1981 |

### Clouds and sunlight

| Code | Quantity | Source | Units | From |
|---|---|---|---|---|
| `cloud` | Cloud amount | CERES / MODIS | % | 2001 |
| `aod` | Aerosol optical depth | CERES / MODIS | none | 2001 |
| `sw_down` | Sunlight reaching the surface | CERES / MODIS | W/m² | 2001 |
| `albedo` | Surface albedo | CERES / MODIS | fraction (0 to 1) | 2001 |
| `airs_olr` | Outgoing longwave radiation | AIRS | W/m² | 2002 |

### Ocean

| Code | Quantity | Source | Units | From |
|---|---|---|---|---|
| `chl` | Chlorophyll a (phytoplankton) | MODIS Aqua | mg/m³ | 2002 |
| `ts_ocean` | Sea surface temperature | MERRA-2 | °C | 1981 |

## 5. Territories

### Every country

`territories: countries` checks every country (about 260; countries smaller than two grid cells of 0.5 to 1
degree are skipped, so usually 150 to 180 are checked).

### Every ocean region

`territories: oceans` checks the 17 ocean regions listed below.

### Chosen countries

A list of codes: `territories: [IND, PAK, BGD]`. The codes are the three-letter codes of Natural Earth. Almost
always they are ISO codes (`RUS`, `IND`, `DEU`, `BRA`, `CHN`, `USA`, `AUS`, `CAN`), with exceptions such as South
Sudan, `SDS`. The search on the site or `GET /api/regions?q=Sudan` shows the code.

### Regions inside countries

First-level regions have codes such as `RUS-2612` (Sakha Republic). Search: `GET /api/regions?q=Sakha`.

### Deserts, mountains, seas and cities

Named regions of Natural Earth have codes made of their kind and English name: `desert_sahara`,
`mountains_alps`, `plateau_tibetan_plateau`, `sea_mediterranean_sea`, `bay_bay_of_bengal`. A city is a circle of
50 km around it: `city_delhi`, `city_beijing`. Search: `GET /api/regions?q=Sahara`; the code is also in the address
of the page after `r=`. A rule cannot narrow a territory to one terrain type yet; on the site it can.

### Latitude belts

| Code | Territory |
|---|---|
| `global` | Whole Earth |
| `arctic` | Arctic (north of 66.5°N) |
| `nh_mid` | Northern mid-latitudes |
| `tropics` | Tropics |
| `sh_mid` | Southern mid-latitudes |
| `antarctic` | Antarctic (south of 66.5°S) |

### Ocean regions

Ocean quantities (`chl`, `ts_ocean`) have no data over countries: check them on these regions.

| Code | Region |
|---|---|
| `ocean_n_pacific_gyre` | North Pacific subtropical gyre |
| `ocean_s_pacific_gyre` | South Pacific subtropical gyre |
| `ocean_n_atlantic_gyre` | North Atlantic subtropical gyre (Sargasso Sea) |
| `ocean_s_atlantic_gyre` | South Atlantic subtropical gyre |
| `ocean_indian_gyre` | South Indian Ocean gyre |
| `ocean_n_atlantic_subpolar` | North Atlantic subpolar |
| `ocean_eq_pacific` | Equatorial Pacific |
| `ocean_southern` | Southern Ocean |
| `ocean_arabian_sea` | Arabian Sea |
| `ocean_bay_of_bengal` | Bay of Bengal |
| `ocean_mediterranean` | Mediterranean Sea |
| `ocean_baltic` | Baltic Sea |
| `ocean_gulf_of_mexico` | Gulf of Mexico |
| `ocean_benguela` | Benguela upwelling (off southwest Africa) |
| `ocean_humboldt` | Humboldt upwelling (off Peru) |
| `ocean_bering` | Bering Sea |
| `ocean_barents` | Barents Sea |

## 6. Sign and delay

**The sign** describes how the **swings** of the two quantities from month to month and from year to year go
together (the trends are removed before the check, see section 8):

* `"+"`: in months when A is above normal, B is above normal too (rain and soil moisture, sunlight and daytime
  temperature);
* `"-"`: when A is above normal, B is below normal (clouds and sunlight, aerosol and sunlight).

**The delay** `max_lag` is how many months the effect may lag behind the cause. Every delay from minus one month to
`max_lag` is tried and the best one counts, with a correction for the number tried. Minus one month is always
allowed: monthly means blur timing.

| Kind of link | Examples | Delay |
|---|---|---|
| Immediate physics | clouds to sunlight, aerosol to sunlight, sunlight to temperature | 0 or 1 |
| Water in the soil | rain to soil moisture, rain to runoff | 1 or 2 |
| Vegetation response | soil moisture to NDVI, rain to NDVI | 2 or 3 |
| Slow processes | snow to spring runoff, sea temperature to chlorophyll | 1 to 6 |

The larger the delay, the more options are tried and the stricter the correction: a delay of 6 where 1 is expected
only weakens the check.

**Direction is not tested.** A correlation shows that a link exists and has the expected sign, not which of the two
is the cause. The direction comes from the expert; the data test the sign and the strength.

## 7. Adding a rule

### To the shared file

1. Add the rule to `rules/rules.yaml` (or to your own copy).
2. Check it with the same validator the server uses:
   ```
   python tools/check_rules.py rules/rules.yaml
   ```
   This checks everything except the territory codes; with `--regions` and the address of a running instance it
   checks those as well. A valid file prints `OK` with the number of rules and their chains.
3. The API validates the file again every time it reads it. If the file has any error, no rule from it is shown, so a
   broken file never gives half checked results.

### For one session, on the site

1. In the "Hypotheses" section on the left press **"+ My hypothesis"**.
2. In the "Form" tab give a title, the links (cause, direction, effect, delay) and the territories: every country,
   the ocean regions, or chosen countries and regions. The "YAML" tab is for writing the rule as text.
3. Press **"Check the hypothesis"**. The server checks it with the same validator and the same statistics as the
   shared rules and shows the result in the same panel over the map; an error shows a list of messages (section 9).
4. The hypothesis appears in the list marked "mine". It is kept in this browser tab only (sessionStorage) and
   disappears when the tab is closed; it is not stored on the server and other visitors do not see it.
5. **"Copy as YAML"** in its panel gives the text for the shared file.

The server checks at most two session hypotheses at a time (when busy it asks to try again in a minute), a rule is
at most 8 KB, exactly one rule per request: `POST /api/rules/try` with the body `{"yaml": "..."}`.

## 8. What is checked

For every territory and every link:

1. The monthly series of both quantities over their common period (at least 10 years).
2. The season and the linear trend of each series are removed. This is the key step: two quantities that merely
   both rise are not called linked.
3. The correlation of what is left is computed at delays from minus one month to `max_lag`; its significance
   accounts for autocorrelation (effective sample size), and the p value of the best delay is multiplied by the
   number of delays tried.
4. Over all territories and links of the rule the Benjamini Hochberg correction for multiple tests is applied
   (false discovery rate 5%).
5. A link is **proven** when it passes the correction, its strength |r| is at least 0.3 and its sign matches
   `sign`. With the opposite sign it is **contradicted**.
6. Trends are compared as well: when both ends of a link have a significant trend, their directions must agree with
   the sign of the link.

### Reading the result

On the site: the "Hypotheses" section on the left, a click on a rule, a panel over the map with tabs.

| Status of a territory | Meaning |
|---|---|
| **Confirmed** | every link proven, the trends do not contradict |
| **Partial** | some links proven, none contradicted |
| **Contradicted** | at least one link has the opposite sign |
| **Not confirmed** | no link proven (a weak link or none) |
| no data | the territory is too small for the grid, or the quantities share fewer than 10 years |

The numbers next to the countries are the correlations of each link (r), separated by `/`. A click on a country
opens it on the map.

"Contradicted" is a result too. "Greener land is cooler by day" holds in dry countries and is contradicted in cold
ones (Norway, Sweden, the Baltic states), where vegetation is limited by heat rather than by water. The tool shows
where a hypothesis works and where it does not.

## 9. Common mistakes

The validator answers in Russian; the messages are quoted as they appear.

| Mistake | Message | Fix |
|---|---|---|
| Minus without quotes: `sign: -` | `.sign: нужно "+" ... или "-" ..., в кавычках` | `sign: "-"` |
| Typo in a quantity code | `неизвестная переменная «presip_gpm»` | compare with section 4 |
| Wrong country code | `неизвестная территория «SSD»` | find the code with the search (section 5) |
| Capitals or a hyphen in `id` | `.id: латинские строчные буквы, цифры и _ ...` | `my_rule`, not `My-Rule` |
| A tab instead of spaces, broken indentation | `это не корректный YAML (строка N, столбец M)` | align with spaces like the neighbouring rules |
| A colon in a text without quotes | `это не корректный YAML ...` | put the text in quotes |
| A comma in a text inside `{ }` | `.name: должна быть строка или пара {en: ..., ru: ...}` | write `name` on several lines or quote the text |
| A repeated `id` | `id повторяется` | choose another code |
| An extra field, for example `territory` instead of `territories` | `неизвестный ключ «territory»` | fix the field name |
| A delay above 6 | `.max_lag: целое число месяцев от 0 до 6` | lower it |
| An ocean quantity on countries | saved, but "no data" almost everywhere | use the ocean regions |
| Quantities with almost no common years | saved, but "no data" | check the first years in section 4 |

## 10. What the server refuses

A save is refused as a whole on any error:

* invalid YAML; Python objects and tags; anchors and aliases (`&name`, `*name`); repeated keys;
* a file above 64 KB, more than 40 rules, more than 6 links in a rule, more than 300 territories;
* any unknown key at any level; `version` other than 1;
* an invalid or repeated `id`; empty or too long texts; `< > { }` and control characters;
* an unknown quantity; a link from a quantity to itself; a repeated pair in one rule;
* a sign other than `"+"` / `"-"`; a delay outside 0 to 6; an unknown or repeated territory; a year outside 1980 to
  2020.

A warning, not an error: the quantity is in the catalog but not loaded yet. The rule is saved and the link shows
"no data".

All of this is covered by automated tests (`tests/test_rules.py`): the shipped file is accepted, 24 kinds of
invalid files are refused with the right reason.

## 11. Examples

The rules in `rules/rules.yaml` can serve as models. Two more to start with:

```yaml
  - id: snow_feeds_spring_runoff
    name:
      en: More snow, more runoff
      ru: Больше снега, больше стока
    description:
      en: Snowmelt feeds rivers weeks to months later.
      ru: Талая вода питает реки через недели и месяцы.
    links:
      - {from: gldas_swe, to: gldas_runoff, sign: "+", max_lag: 4}
    territories: [RUS, CAN, NOR, SWE, FIN, KAZ, MNG, USA]

  - id: dry_air_dry_soil
    name:
      en: Dry air, dry soil
      ru: Сухой воздух, сухая почва
    links:
      - {from: rh2m, to: soil_top, sign: "+", max_lag: 1}
      - {from: soil_top, to: gldas_evap, sign: "+", max_lag: 1}
    territories: countries
```

## 12. Limits

* A link describes a linear relation between the swings of two monthly series. Threshold effects ("only during a
  drought"), a link in one season only and delays above 6 months are not part of the format yet. New optional
  fields can be added later without changing existing rules.
* Countries smaller than two grid cells are not checked.
* Ocean regions are rectangles along textbook boundaries, not coastlines.
* A link in the data does not prove a cause: it shows that the link the expert predicted exists, has the expected
  sign and is not explained by the trends alone.
