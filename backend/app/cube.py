"""The data cube: one memory-mapped float32 array [lat, lon, month] per variable (written by etl/).

Gives area-weighted monthly series for a territory (polygon, box, point or the whole globe) and annual-mean grids for
the trend maps. Cells are weighted by cos(latitude); a month is valid when at least MIN_COVERAGE of the territory's
data-bearing area has a value.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import shapely

from . import trend

MIN_COVERAGE = 0.7


@dataclass
class Grid:
    lat0: float
    dlat: float
    nlat: int
    lon0: float
    dlon: float
    nlon: int

    @property
    def lat(self) -> np.ndarray:
        return self.lat0 + self.dlat * np.arange(self.nlat)

    @property
    def lon(self) -> np.ndarray:
        return self.lon0 + self.dlon * np.arange(self.nlon)

    @property
    def key(self) -> tuple:
        return (self.lat0, self.dlat, self.nlat, self.lon0, self.dlon, self.nlon)

    def weights(self) -> np.ndarray:
        """Relative cell area per latitude row."""
        lo = np.clip(self.lat - self.dlat / 2, -90, 90)
        hi = np.clip(self.lat + self.dlat / 2, -90, 90)
        return np.sin(np.radians(hi)) - np.sin(np.radians(lo))

    def cells_in(self, geom) -> tuple[np.ndarray, np.ndarray]:
        """Row and column indices of the cells whose centres fall inside the geometry.

        A territory smaller than a cell gets the cell nearest to its representative point.
        """
        w, s, e, n = geom.bounds
        ii = np.nonzero((self.lat >= s - self.dlat / 2) & (self.lat <= n + self.dlat / 2))[0]
        jj = np.nonzero((self.lon >= w - self.dlon / 2) & (self.lon <= e + self.dlon / 2))[0]
        if len(ii) and len(jj):
            gi, gj = np.meshgrid(ii, jj, indexing="ij")
            inside = shapely.contains_xy(geom, self.lon[gj.ravel()], self.lat[gi.ravel()])
            if inside.any():
                return gi.ravel()[inside], gj.ravel()[inside]
        p = geom.representative_point()
        return np.array([self.row(p.y)]), np.array([self.col(p.x)])

    def row(self, lat: float) -> int:
        return int(np.clip(round((lat - self.lat0) / self.dlat), 0, self.nlat - 1))

    def col(self, lon: float) -> int:
        lon = (lon - self.lon0) % 360 + self.lon0
        return round((lon - self.lon0) / self.dlon) % self.nlon


class Variable:
    def __init__(self, path: Path):
        self.path = path
        self.meta = json.loads((path / "meta.json").read_text())
        m = self.meta
        self.grid = Grid(m["lat0"], m["dlat"], m["nlat"], m["lon0"], m["dlon"], m["nlon"])
        self.data = np.load(path / "data.npy", mmap_mode="r")
        y0, m0 = (int(x) for x in m["t0"].split("-"))
        k = y0 * 12 + (m0 - 1) + np.arange(m["nt"])
        self.year, self.month = k // 12, k % 12 + 1
        self._annual: np.ndarray | None = None

    @property
    def t1(self) -> str:
        return f"{self.year[-1]}-{self.month[-1]:02d}"

    def series(self, ii: np.ndarray, jj: np.ndarray) -> tuple[np.ndarray, dict]:
        """Area-weighted mean over the cells (ii, jj) for every month."""
        w_row = self.grid.weights()
        nt = self.data.shape[2]
        num, den = np.zeros(nt), np.zeros(nt)
        total = 0.0
        n_data = 0
        for i in np.unique(ii):
            cols = jj[ii == i]
            block = np.asarray(self.data[i][cols])  # [cells, months]
            ok = np.isfinite(block)
            has = ok.any(axis=1)  # cells that ever carry data (land-only variables)
            n_data += int(has.sum())
            total += w_row[i] * has.sum()
            num += w_row[i] * np.where(ok, block, 0.0).sum(axis=0)
            den += w_row[i] * ok.sum(axis=0)
        with np.errstate(invalid="ignore", divide="ignore"):
            y = np.where(den >= MIN_COVERAGE * total, num / den, np.nan) if total > 0 else np.full(nt, np.nan)
        return y, {"cells": len(ii), "cells_with_data": n_data}

    def annual(self) -> np.ndarray:
        """Annual means of the monthly anomalies per cell [nlat * nlon, years]; a year needs trend.MIN_MONTHS_ANOMALY
        valid months.

        Anomalies (value minus that cell's mean for the calendar month) keep a missing season from biasing the year.
        Cached on disk with the cell means.
        """
        if self._annual is None:
            f, fm = self.path / "annual_anom.npy", self.path / "cell_mean.npy"
            src = (self.path / "data.npy").stat().st_mtime
            if f.exists() and fm.exists() and f.stat().st_mtime >= src:
                self._annual, self._mean = np.load(f), np.load(fm)
            else:
                years = self.annual_years()
                ncell = self.grid.nlat * self.grid.nlon
                out = np.full((ncell, len(years)), np.nan, dtype=np.float32)
                mean = np.full(ncell, np.nan, dtype=np.float32)
                month0 = self.month - 1
                year_idx = self.year - years[0]
                rows = max(1, 4_000_000 // (self.grid.nlon * len(self.year)))  # ~16 MB of float32 per band
                with np.errstate(invalid="ignore", divide="ignore"):
                    for r0 in range(0, self.grid.nlat, rows):
                        a = np.asarray(self.data[r0 : r0 + rows], dtype=np.float32).reshape(-1, len(self.year))
                        c0 = r0 * self.grid.nlon
                        mean[c0 : c0 + a.shape[0]] = np.nanmean(a, axis=1)
                        clim = np.stack([np.nanmean(a[:, month0 == m], axis=1) for m in range(12)], axis=1)
                        anom = a - clim[:, month0]
                        for k in range(len(years)):
                            sel = year_idx == k
                            v = anom[:, sel]
                            n = np.isfinite(v).sum(axis=1)
                            m_ = np.nansum(v, axis=1) / np.maximum(n, 1)
                            m_[n < trend.MIN_MONTHS_ANOMALY] = np.nan
                            out[c0 : c0 + a.shape[0], k] = m_
                np.save(f, out)
                np.save(fm, mean)
                self._annual, self._mean = out, mean
        return self._annual

    def cell_mean(self) -> np.ndarray:
        """Mean of all months per cell (for rates in % of the mean)."""
        self.annual()
        return self._mean

    def annual_years(self) -> np.ndarray:
        return np.arange(self.year.min(), self.year.max() + 1)


class Cube:
    def __init__(self, data_dir: Path):
        self.root = data_dir / "cube"
        self.vars: dict[str, Variable] = {}
        self.reload()

    def reload(self) -> None:
        for meta in sorted(self.root.glob("*/meta.json")):
            vid = meta.parent.name
            if vid not in self.vars:
                self.vars[vid] = Variable(meta.parent)

    def __getitem__(self, vid: str) -> Variable:
        return self.vars[vid]

    def __contains__(self, vid: str) -> bool:
        return vid in self.vars
