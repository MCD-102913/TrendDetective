# Trend Detective

What is changing on Earth, where, how fast, and is it real?

Trend Detective is our project for the NASA Space Apps Challenge 2026, challenge
**Be An Earth System Trend Detective**. We are just getting started: this repository will grow during the
hackathon, and both the scope and the final shape of the tool are still open.

## The idea

NASA keeps decades of Earth observations: temperature, rain, vegetation, snow, air quality, the ocean. We want
to make it easy for anyone to pick a quantity and a place and get an honest answer to a few simple questions:

* What is changing, and where?
* How fast?
* Is the change statistically real, or could it be noise?
* Is it connected to changes in other quantities?

We care most about the last word of our tagline: every number shown should come with the test behind it, and
the tests themselves should be checked.

## What we are exploring

These are directions we are working on; what ends up in the final version is not decided yet.

* Time series of a territory with the season removed, and the rate of change with its uncertainty.
* Significance tests that hold up against autocorrelation, and checks of whether a trend is robust.
* Maps of where the change is significant.
* Links between quantities that go beyond simply sharing a trend.
* Careful, tested continuation of trends a few years ahead.
* A simple way to look at all of this for people who are not scientists.

## Data we use

Monthly global records, regridded to a common grid of 0.5 to 1 degree.

| Dataset | Archive or service | Quantities |
|---|---|---|
| MERRA-2 reanalysis | NASA POWER open data store (Zarr on AWS S3) | air temperature (mean, daily maximum and minimum), humidity, water vapour, wind, sea level pressure, ozone, precipitation, evaporation, soil moisture, snow depth and cover, sea ice, surface temperature |
| MERRA-2 M2IMNPASM (5.12.4), pressure levels | GES DISC through NASA cloud OPeNDAP | air temperature from 850 to 10 hPa (about 1.5 to 31 km), relative humidity at 850, 500 and 300 hPa, stratospheric ozone at 50 and 10 hPa |
| GPM IMERG | NASA POWER open data store | precipitation |
| CERES SYN1deg (with MODIS clouds) | NASA POWER open data store | cloud amount, aerosol optical depth, sunlight at the surface, albedo |
| MODIS Terra MOD13C2 (6.1) | LP DAAC | vegetation indices NDVI and EVI |
| MODIS Terra MOD11C3 (6.1) | LP DAAC | land surface temperature by day and by night |
| MODIS MCD12C1 (6.1) land cover | LP DAAC | terrain types (forests, croplands, deserts, cities and others) to narrow a territory |
| MODIS Aqua L3 mapped chlorophyll a | OB.DAAC (NASA Ocean Biology) | ocean chlorophyll |
| GLDAS Noah 0.25 degree monthly (2.1) | GES DISC | soil moisture, evaporation, runoff, snow water equivalent |
| AIRS AIRS3STM (7.0) | GES DISC | air temperature, water vapour, outgoing longwave radiation |
| OMI OMNO2d (004) | GES DISC | tropospheric NO2 |
| Natural Earth | naturalearthdata.com | country and region boundaries; deserts, mountain ranges, plateaus, plains, deltas; oceans, seas and gulfs; large cities |

## APIs and services

* **NASA POWER**: the open data store on AWS S3 (no login) for the monthly grids, and the
  [POWER API](https://power.larc.nasa.gov/) for point values used to cross check our numbers.
* **NASA Earthdata Login**: a personal token for the archives that require it.
* **NASA CMR** (Common Metadata Repository): to find the files of every product and month.
* **NASA cloud OPeNDAP**: to read only the needed pressure levels of MERRA-2 instead of whole files.
* **LP DAAC, GES DISC, OB.DAAC**: download of the MODIS, GLDAS, AIRS, OMI, ocean colour and land cover files over HTTPS.
* **NASA Harmony** with the Giovanni averaging service: area averaged series computed by NASA, to verify ours.
* **NASA GIBS** (the imagery behind NASA Worldview): recent satellite pictures shown on the map for context.
* **Claude Science** (an AI research assistant): turned peer-reviewed papers into 19 hypotheses about deserts,
  rainforests, cities, croplands, deltas, polar seas and the upper atmosphere, tested through our API on two
  independent periods; 12 were supported. See `docs/AI_HYPOTHESES.md`.
* **Google Gemini API** (model Gemini 4 Hydrogen): the AI detective that decides which of our tests to run for a
  question; every number it shows comes from our own statistics. Optional: set `GEMINI_API_KEY` on the server.

## Stack

We have settled on the main stack. The list of dependencies is not final yet and may still change as the
project grows.

**Server** (Python 3.14)

| Purpose | Packages (versions we use now) |
|---|---|
| API | FastAPI 0.162, Uvicorn 0.54, Pydantic 2.14 |
| Statistics and arrays | NumPy 2.5, SciPy 1.18 |
| Territories and maps | Shapely 2.2, Pillow 13, DuckDB 2.0 |
| Data access | Requests 2.34, xarray 2026.9, Zarr 3.4, s3fs 2026.9 |
| NASA file formats | h5py 3.16 (HDF5 and NetCDF), pyhdf 0.11 (HDF4) |
| Configuration and lookup | PyYAML 6.0, pycountry 26.2 |
| Tests | pytest 9.2 |

Storage: monthly data as NumPy memory mapped arrays; precomputed results in SQLite and JSON.

**Browser**

| Purpose | Packages |
|---|---|
| Interface | React 19, TypeScript 7 |
| Build | Vite 8 |
| Map and globe | MapLibre GL 6.16 |
| Charts | ECharts 6 |

The server dependencies are listed in `requirements.txt`, the browser ones in `frontend/package.json`.
Still open: how the project will be packaged for others to run.

## Repository layout

| Folder | Contents |
|---|---|
| `backend/` | API and statistics |
| `etl/` | loaders that fetch NASA data |
| `tools/` | batch jobs: the check of trend outlooks on past data, the outlooks by country, the exhaustive search of links |
| `rules/` | hypotheses checked against the data, in YAML |
| `tests/` | tests of the statistics on synthetic series |
| `frontend/` | web interface: the map and globe, outlooks, links between quantities, a simple mode |
| `docs/` | how to write a hypothesis (`docs/RULES.md`), the check against NASA tools (`docs/VERIFICATION.md`) |

Parts of the code are being added step by step.

## Running locally

The API reads a monthly data cube that the loaders in `etl/` build from the NASA archives. Some archives need
an Earthdata token, read from `EARTHDATA_TOKEN` in the environment or in a `.env` file in the project root.
The full cube takes a long time to download and about 13 GB of disk.

```
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
TREND_DATA_DIR=/path/to/data uvicorn backend.app.main:app --port 8000
```

In a second terminal:

```
cd frontend
npm install
npm run dev
```

The development server forwards `/api` to `http://127.0.0.1:8000`; set `API_TARGET` to use another backend.
Tests: `pytest tests`.

## Status

Work in progress during the hackathon, November 2026. See `ROADMAP.md`.

## Credits

Data: NASA (MERRA-2, GPM IMERG, CERES, MODIS, GLDAS, AIRS, OMI, NASA POWER, NASA GIBS, Earthdata taken from GES DISC: https://disc.gsfc.nasa.gov/datasets/) and
Natural Earth. Built for the NASA Space Apps Challenge 2026.

## License

MIT, see `LICENSE`. The NASA data keep their own terms of use.
