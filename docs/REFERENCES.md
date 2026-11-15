# References

Sources of the data, the methods and the scientific statements used in TerraScope. Every method entry names
the place in the code where it is applied.

## Data

| Dataset | Version | DOI or address | Used for |
|---|---|---|---|
| MERRA-2 reanalysis, monthly single level fields | 5.12.4 | https://doi.org/10.1175/JCLI-D-16-0758.1 (Gelaro et al. 2017); read through the NASA POWER open data store, https://registry.opendata.aws/nasa-power/ | air temperature, humidity, wind, pressure, ozone column, precipitation, evaporation, soil moisture, snow, sea ice, surface temperature |
| MERRA-2 instM_3d_asm_Np (M2IMNPASM), pressure levels | 5.12.4 | https://doi.org/10.5067/2E096JV59PK7 | air temperature, relative humidity and ozone by height |
| GPM IMERG Final, monthly | V07 | https://doi.org/10.5067/GPM/IMERG/3B-MONTH/07 (read through NASA POWER) | precipitation |
| CERES SYN1deg with MODIS clouds | as served by NASA POWER | https://power.larc.nasa.gov/ | clouds, aerosol optical depth, sunlight at the surface, albedo |
| MODIS Terra MOD13C2 vegetation indices | 061 | https://doi.org/10.5067/MODIS/MOD13C2.061 | NDVI, EVI |
| MODIS Terra MOD11C3 land surface temperature | 061 | https://doi.org/10.5067/MODIS/MOD11C3.061 | land surface temperature by day and by night |
| MODIS MCD12C1 land cover | 061 | https://doi.org/10.5067/MODIS/MCD12C1.061 | terrain types (forests, croplands, deserts, cities and others) |
| MODIS Aqua Level 3 mapped chlorophyll | 2022.0 | https://doi.org/10.5067/AQUA/MODIS/L3M/CHL/2022.0 | ocean chlorophyll |
| GLDAS Noah, monthly 0.25 degree | 2.1 | https://doi.org/10.5067/SXAVCZFAQLNO | soil moisture, evaporation, runoff, snow water equivalent |
| AIRS AIRS3STM, monthly 1 degree | 7.0 | https://doi.org/10.5067/UBENJB9D3T2H | air temperature, water vapour, outgoing longwave radiation |
| OMI OMNO2d, daily 0.25 degree | 004 | https://doi.org/10.5067/AURA/OMI/DATA3407 | tropospheric NO2 |
| Natural Earth | 1:10m | https://www.naturalearthdata.com/ (public domain) | countries and first level regions; deserts, mountains, plateaus, plains, deltas; oceans, seas, gulfs, bays; large cities |

Descriptions of the main data sets:

* Gelaro, R., et al. (2017). The Modern-Era Retrospective Analysis for Research and Applications, Version 2
  (MERRA-2). Journal of Climate, 30, 5419-5454. https://doi.org/10.1175/JCLI-D-16-0758.1
* Rodell, M., et al. (2004). The Global Land Data Assimilation System. Bulletin of the American Meteorological
  Society, 85, 381-394. https://doi.org/10.1175/BAMS-85-3-381
* Huffman, G. J., et al. (2020). Integrated Multi-satellite Retrievals for the Global Precipitation Measurement
  (GPM) Mission (IMERG). In Satellite Precipitation Measurement, Advances in Global Change Research 67.
  https://doi.org/10.1007/978-3-030-24568-9_19
* Sulla-Menashe, D., Gray, J. M., Abercrombie, S. P., Friedl, M. A. (2019). Hierarchical mapping of annual global
  land cover 2001 to present: The MODIS Collection 6 Land Cover product. Remote Sensing of Environment, 222,
  183-194. https://doi.org/10.1016/j.rse.2018.12.013

## Services and APIs

| Service | Address | Used for |
|---|---|---|
| NASA POWER open data store (Zarr on AWS S3) | https://registry.opendata.aws/nasa-power/ | monthly grids of MERRA-2, IMERG and CERES |
| NASA POWER API | https://power.larc.nasa.gov/ | point values to cross check our series |
| NASA Earthdata Login | https://urs.earthdata.nasa.gov/ | access token for the archives |
| NASA CMR | https://cmr.earthdata.nasa.gov/search/ | finding the files of every product and month |
| NASA cloud OPeNDAP | https://opendap.earthdata.nasa.gov/ | reading single pressure levels of MERRA-2 |
| GES DISC | https://disc.gsfc.nasa.gov/ | GLDAS, AIRS, OMI, MERRA-2 pressure levels |
| LP DAAC | https://lpdaac.usgs.gov/ | MODIS vegetation, land surface temperature, land cover |
| OB.DAAC (NASA Ocean Biology) | https://oceancolor.gsfc.nasa.gov/ | MODIS Aqua chlorophyll |
| NASA Harmony with the Giovanni averaging service | https://harmony.earthdata.nasa.gov/, https://giovanni.gsfc.nasa.gov/giovanni/ | area averages computed by NASA, to verify ours (`docs/VERIFICATION.md`) |
| NASA GIBS | https://nasa-gibs.github.io/gibs-api-docs/ | recent satellite imagery on the map |
| NASA Worldview | https://worldview.earthdata.nasa.gov/ | links from the map to the same imagery |
| Google Gemini API, models gemini-3.8-flash and gemini-2.5-flash (fallback) | https://aistudio.google.com/ | the SI detective: chooses which of our tests to run for a question (`backend/app/ai.py`); the numbers come from our tests |

## Methods

### Trend of one series (`backend/app/trend.py`)

* Seasonal cycle removed by subtracting the mean of each calendar month (anomalies); the linear trend is fitted
  to the anomalies.
* Linear trend with a t test and 95% interval, the sample size corrected for autocorrelation of the residuals:
  Santer, B. D., et al. (2000). Statistical significance of trends and trend differences in layer-average
  atmospheric temperature time series. Journal of Geophysical Research: Atmospheres, 105, 7337-7356.
  https://doi.org/10.1029/1999JD901105
* Mann-Kendall test for a monotonic trend: Mann, H. B. (1945). Nonparametric tests against trend. Econometrica,
  13, 245-259. https://doi.org/10.2307/1907187; Kendall, M. G. (1975). Rank Correlation Methods. Griffin, London.
* Mann-Kendall variance corrected for autocorrelation: Hamed, K. H., Rao, A. R. (1998). A modified Mann-Kendall
  trend test for autocorrelated data. Journal of Hydrology, 204, 182-196.
  https://doi.org/10.1016/S0022-1694(97)00125-X
* Seasonal Mann-Kendall (computed, not used for the verdict): Hirsch, R. M., Slack, J. R., Smith, R. A. (1982).
  Techniques of trend analysis for monthly water quality data. Water Resources Research, 18, 107-121.
  https://doi.org/10.1029/WR018i001p00107
* Theil-Sen slope and its interval: Sen, P. K. (1968). Estimates of the regression coefficient based on Kendall's
  tau. Journal of the American Statistical Association, 63, 1379-1389.
  https://doi.org/10.1080/01621459.1968.10480934; Theil, H. (1950). A rank-invariant method of linear and
  polynomial regression analysis (reprinted 1992). https://doi.org/10.1007/978-94-011-2546-8_20
* Step instead of a trend (change point): Pettitt, A. N. (1979). A non-parametric approach to the change-point
  problem. Applied Statistics, 28, 126-135. https://doi.org/10.2307/2346729
* Record length needed to detect a trend: Weatherhead, E. C., et al. (1998). Factors affecting the detection of
  trends: Statistical considerations and applications to environmental data. Journal of Geophysical Research:
  Atmospheres, 103, 17149-17161. https://doi.org/10.1029/98JD00995

### Maps of significant change (`backend/app/trend.py`, `backend/app/maps.py`)

* False discovery rate control over all grid cells: Benjamini, Y., Hochberg, Y. (1995). Controlling the false
  discovery rate: a practical and powerful approach to multiple testing. Journal of the Royal Statistical Society
  B, 57, 289-300. https://doi.org/10.1111/j.2517-6161.1995.tb02031.x
* Why maps need it: Wilks, D. S. (2016). "The stippling shows statistically significant grid points": How research
  results are routinely overstated and overinterpreted, and what to do about it. Bulletin of the American
  Meteorological Society, 97, 2263-2273. https://doi.org/10.1175/BAMS-D-15-00267.1

### Links between quantities and hypotheses (`backend/app/trend.py`, `backend/app/rules.py`)

* Correlation of anomalies after the season and the linear trend are removed, with lags; the p value uses the
  effective sample size of two autocorrelated series: Bretherton, C. S., et al. (1999). The effective number of
  spatial degrees of freedom of a time-varying field. Journal of Climate, 12, 1990-2009.
  https://doi.org/10.1175/1520-0442(1999)012<1990:TENOSD>2.0.CO;2
* Bonferroni correction over the tested lags; Benjamini-Hochberg over all territories of a hypothesis (as above).

### Exhaustive search of links and chains (`backend/app/discovery.py`, `tools/discover.py`)

* Discovery on the first half of the record with the Benjamini-Hochberg threshold over all tests, replication on
  the second half that the search never saw, and a null control on pairs shifted by whole years (our design,
  built on the false discovery rate procedure above).
* A chain A to B to C is kept when the partial correlation of A and C given B is much weaker than their direct
  correlation (mediation): Baron, R. M., Kenny, D. A. (1986). The moderator-mediator variable distinction in social
  psychological research. Journal of Personality and Social Psychology, 51, 1173-1182.
  https://doi.org/10.1037/0022-3514.51.6.1173

### "If the trend continues" (`backend/app/trend.py`, `backend/app/forecast.py`, `tools/hindcast.py`)

* Damped trend model: Gardner, E. S., McKenzie, E. (1985). Forecasting trends in time series. Management Science,
  31, 1237-1246. https://doi.org/10.1287/mnsc.31.10.1237
* Hindcasts scored against climatology and persistence, cross-validated over countries, intervals calibrated on
  past errors: Wilks, D. S. (2019). Statistical Methods in the Atmospheric Sciences, 4th edition. Elsevier.
  https://doi.org/10.1016/C2017-0-03921-6

### Territories (`backend/app/regions.py`, `backend/app/terrain.py`)

* Territory averages weight each grid cell by its area (sine of the latitude bounds).
* A territory is the set of grid cells whose centres fall inside it; an area drawn by the visitor is a polygon
  treated the same way, and a territory smaller than a cell takes the nearest cell.
* Terrain types: the IGBP classes of MCD12C1 grouped into ten types; a 0.5 degree cell gets a type that covers at
  least half of it (a quarter for cities).

## Scientific context of statements in the interface

* Cooling of the stratosphere while the troposphere warms: Santer, B. D., et al. (2013). Identifying human
  influences on atmospheric temperature. Proceedings of the National Academy of Sciences, 110, 26-33.
  https://doi.org/10.1073/pnas.1210514109; Gulev, S. K., et al. (2021). Changing State of the Climate System. In
  Climate Change 2021: The Physical Science Basis, IPCC AR6 WG1, Chapter 2. https://doi.org/10.1017/9781009157896.004
* Stratospheric ozone recovery: WMO (2022). Scientific Assessment of Ozone Depletion: 2022.
  https://csl.noaa.gov/assessments/ozone/2022/
* Greening of croplands in India and China: Chen, C., et al. (2019). China and India lead in greening of the world
  through land-use management. Nature Sustainability, 2, 122-129. https://doi.org/10.1038/s41893-019-0220-7
* Warmer ocean surface, less phytoplankton (a hypothesis in `rules/rules.yaml`): Behrenfeld, M. J., et al. (2006).
  Climate-driven trends in contemporary ocean productivity. Nature, 444, 752-755. https://doi.org/10.1038/nature05317

## Hypotheses from the literature

The papers behind the 19 hypotheses that Claude Science formulated and our API tested are listed with the results in
`docs/SI_HYPOTHESES.md`.

## Software

Python: NumPy, SciPy, Shapely, DuckDB, xarray, Zarr, h5py, pyhdf, FastAPI, Pydantic, Uvicorn, Pillow, PyYAML,
pycountry. Browser: React, TypeScript, Vite, MapLibre GL, ECharts, Lucide icons. Versions are in `requirements.txt`,
`frontend/package.json` and the README.
