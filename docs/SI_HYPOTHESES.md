# Hypotheses from the literature, tested on the data

The challenge suggests using SI (super intelligence, the term the challenge uses for artificial intelligence) to find which variables may show trends in particular areas, from research papers
or from the character of a region (a desert, a rainforest, a city). We did this with Claude Science, an SI research
assistant, working through the public API of TerraScope on 15 November 2026.

The division of work was strict:

* **The SI** chose territory types, found peer-reviewed papers, wrote each hypothesis down before any test (variables,
  territory, expected sign, expected lag, paper DOI) and checked every DOI in Crossref.
* **TerraScope** computed every number: trends, links, p-values and verdicts come from our API, the same tests
  the site uses (`backend/app/trend.py`). The SI did not compute or adjust any statistic.

The team then checked the key numbers again through the API; they match.

## Protocol

* 19 hypotheses, written down before testing. At most 20 were allowed, to keep the number of tests small.
* Every hypothesis was tested twice, on independent periods: 1981 to 2003 and 2004 to 2025. Shorter satellite records
  were split in halves: OMI NO2 2005 to 2014 and 2015 to 2025; MODIS and CERES 2001 to 2012 and 2013 to 2025.
* **Supported** means a significant verdict with the expected sign in both periods (`significant_up`,
  `significant_down`, `linked_positive`, `linked_negative`). A "likely" verdict (right sign, p above 0.05) does not
  count. **Contradicted** means a significant verdict of the opposite sign in either period.
* Benjamini-Hochberg correction (q = 0.05) over all 38 tests: 29 survive, including all 24 tests behind the supported
  hypotheses.

## Results: 12 supported, 5 not supported, 2 contradicted

| ID | Territory | Hypothesis | Paper | 1981 to 2003 (or first half) | 2004 to 2025 (or second half) | Verdict |
|---|---|---|---|---|---|---|
| H01 | Whole Earth | The middle stratosphere (10 hPa, about 31 km) is cooling | Randel et al. 2009; Steiner et al. 2020 | -0.54 °C per decade, significant | -0.72 °C per decade, significant | supported |
| H02 | Tropics | The upper troposphere (300 hPa) is warming | Santer et al. 2013; Steiner et al. 2020 | +0.31, likely (p 0.09) | +0.43, likely (p 0.06) | not supported |
| H03 | Antarctic | Less ozone at 50 hPa goes with a colder lower stratosphere | Randel and Wu 1999 | r = +0.59, lag 0 | r = +0.86, lag 0 | supported |
| H04 | Barents Sea | Sea ice is declining | Onarheim et al. 2018 | no trend | no trend | not supported |
| H05 | Barents Sea | Months with less sea ice have warmer air | Screen and Simmonds 2010 | r = -0.75, lag 0 | r = -0.74, lag 0 | supported |
| H06 | Barents Sea | Warmer sea surface goes with less sea ice | Smedsrud et al. 2013 | r = -0.85, lag 0 | r = -0.84, lag 0 | supported |
| H07 | Arctic | The Arctic is warming | Rantanen et al. 2022; Screen and Simmonds 2010 | +0.36 °C per decade, significant | +0.45 °C per decade, significant | supported |
| H08 | Sahara | The Sahara is warming | Cook and Vizy 2015 | +0.52 °C per decade, significant | +0.10, no trend | not supported |
| H09 | Sahara | Windier months carry more dust | Evan et al. 2016 | r = +0.53, lag 0 | r = +0.54, lag 0 | supported |
| H10 | Amazon basin, rainforest only | Near-surface humidity is falling | Barkhordarian et al. 2019 | -0.45 % per decade, no trend | -1.49, no trend | not supported |
| H11 | Amazon basin | Drier months are hotter months | Jimenez-Munoz et al. 2016; Marengo et al. 2018 | r = -0.55, lag 0 | r = -0.58, lag 0 | supported |
| H12 | Delhi | NO2 is rising | Hilboll et al. 2013 | +0.85 per decade, significant | -0.85 per decade, significant | contradicted |
| H13 | Beijing | NO2 is falling | Zheng et al. 2018 | no trend | -5.01 per decade, significant | not supported |
| H14 | Indo-Gangetic Plain, croplands | Aerosol is rising | Dey and Di Girolamo 2011 | +0.095 per decade, significant | +0.080 per decade, significant | supported |
| H15 | Indo-Gangetic Plain | Hazier months bring less sunlight | Padma Kumari et al. 2007 | r = -0.45, lag 0 | r = -0.60, lag 0 | supported |
| H16 | Indo-Gangetic Plain, croplands | Croplands are greening | Chen et al. 2019 | +0.020 NDVI per decade, significant | +0.035 per decade, significant | supported |
| H17 | Iowa (US Corn Belt) | Drier root-zone soil goes with hotter afternoons | Seneviratne et al. 2010 | r = -0.40, lag 0 | r = -0.44, lag 0 | supported |
| H18 | Nile Delta | The delta is warming | Domroes and El-Tantawi 2005 | +0.30 °C per decade, significant | +0.45 °C per decade, significant | supported |
| H19 | Mekong Delta | The delta is warming | Phuong et al. 2019 | -0.40 °C per decade, significant | +0.03, no trend | contradicted |

NO2 rates are in 10¹⁵ molecules per cm² per decade, aerosol in optical depth per decade. The API marked several
significant trends as not robust (H07, H14, H16, H18 among the supported ones); they are less certain than H01, which
passed every robustness check.

### What the failures tell

* **Delhi NO2 (H12)** rose until 2014 and has fallen since. The paper studied the earlier years; the trend reversed.
* **Beijing NO2 (H13)** fell strongly only after 2015, in line with the clean air policies of the paper, but the rule
  of two agreeing periods cannot be met by a change that starts in the second one.
* **Mekong Delta (H19)** cooled in 1981 to 2003 in our data. The delta covers only a few cells of the 0.5 degree
  MERRA-2 grid, so this more likely reflects the grid than the real climate.
* **Barents Sea ice (H04)** declines mainly in winter; a trend over all months in 22 or 23 year windows is too weak
  here. Over the full record the decline is significant.

## Rules on the site

Six supported links became hypotheses on the site (section "Hypotheses", `rules/rules.yaml`), checked on every
country or ocean region: `ozone_warms_stratosphere`, `sea_ice_insulates_air`, `warm_water_melts_ice`,
`wind_lifts_dust`, `dry_months_hot_forest`, `dry_soil_hot_days`. The seventh (H15) repeats the team's rule
`aerosol_dimming` and was not added twice.

## Limitations

* One expected sign in both periods: trends that reverse (ozone recovery, NO2 in large cities) cannot pass.
* No season filter: winter-only or summer-only changes cannot be tested.
* The 0.5 degree grid: deltas and 50 km city circles cover a handful of cells.
* Missing variables: vapour pressure deficit, dust-only aerosol, river discharge, sea level, irrigation, emissions,
  climate indices such as El Nino.
* Satellite halves of 10 to 13 years have little statistical power.
* Links are correlations at lag 0: the direction of each rule comes from its paper, not from the data.
* The report of the SI says the link test has no terrain filter. It has one (`terrain` in the request); it was simply
  not described in the instructions the SI received, so H11 and H15 used all land cover of their regions.

## Papers

* Barkhordarian et al. 2019, https://doi.org/10.1038/s41598-019-51857-8
* Chen et al. 2019, https://doi.org/10.1038/s41893-019-0220-7
* Cook and Vizy 2015, https://doi.org/10.1175/JCLI-D-14-00230.1
* Dey and Di Girolamo 2011, https://doi.org/10.1029/2011GL048153
* Domroes and El-Tantawi 2005, https://doi.org/10.1002/joc.1114
* Evan et al. 2016, https://doi.org/10.1038/nature17149
* Hilboll et al. 2013, https://doi.org/10.5194/acp-13-4145-2013
* Jimenez-Munoz et al. 2016, https://doi.org/10.1038/srep33130
* Marengo et al. 2018, https://doi.org/10.3389/feart.2018.00228
* Onarheim et al. 2018, https://doi.org/10.1175/JCLI-D-17-0427.1
* Padma Kumari et al. 2007, https://doi.org/10.1029/2007GL031133
* Phuong et al. 2019, https://doi.org/10.34154/2019-ejcc-0101-01-16/euraass
* Randel et al. 2009, https://doi.org/10.1029/2008JD010421
* Randel and Wu 1999, https://doi.org/10.1175/1520-0442(1999)012%3C1467:COTAAA%3E2.0.CO;2
* Rantanen et al. 2022, https://doi.org/10.1038/s43247-022-00498-3
* Santer et al. 2013, https://doi.org/10.1073/pnas.1305332110
* Screen and Simmonds 2010, https://doi.org/10.1038/nature09051
* Seneviratne et al. 2010, https://doi.org/10.1016/j.earscirev.2010.02.004
* Smedsrud et al. 2013, https://doi.org/10.1002/rog.20017
* Steiner et al. 2020, https://doi.org/10.1175/JCLI-D-19-0998.1
* Zheng et al. 2018, https://doi.org/10.5194/acp-18-14095-2018
