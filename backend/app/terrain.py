"""Terrain types: the dominant MODIS land cover of every 0.5 degree cell, used to narrow a territory to its forests,
deserts, croplands and so on. The file is built by tools/build_terrain.py; without it the filter is simply absent.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

# id -> (en, ru); the ids and their order come from the file
LABELS = {
    "rainforest": ("Tropical rainforest", "Тропические леса"),
    "forest": ("Temperate and boreal forest", "Леса умеренного и северного пояса"),
    "shrubland": ("Shrubland", "Кустарники"),
    "savanna": ("Savanna", "Саванны"),
    "grassland": ("Grassland and steppe", "Степи и луга"),
    "wetland": ("Wetland", "Болота"),
    "cropland": ("Cropland", "Пашни"),
    "urban": ("City", "Города"),
    "ice": ("Ice and snow", "Льды и снега"),
    "barren": ("Desert and bare land", "Пустыни и голая земля"),
}
MIXED = 255


class Terrain:
    def __init__(self, data_dir: Path):
        path = data_dir / "terrain.npz"
        self.ok = path.exists()
        if not self.ok:
            return
        with np.load(path) as f:
            self.dominant = f["dominant"]
            self.types = [str(t) for t in f["types"]]
            self.lat0, self.dlat = float(f["lat0"]), float(f["dlat"])
            self.lon0, self.dlon = float(f["lon0"]), float(f["dlon"])
            self.year = int(f["year"])
        self.nlat, self.nlon = self.dominant.shape

    def label(self, tid: str) -> dict[str, str]:
        en, ru = LABELS.get(tid, (tid, tid))
        return {"en": en, "ru": ru}

    def _types_at(self, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
        rows = np.clip(np.round((lat - self.lat0) / self.dlat).astype(int), 0, self.nlat - 1)
        cols = np.round(((lon - self.lon0) % 360) / self.dlon).astype(int) % self.nlon
        return self.dominant[rows, cols]

    def keep(self, lat: np.ndarray, lon: np.ndarray, tid: str) -> np.ndarray:
        """Which of the cells with these centres belong to the terrain type."""
        return self._types_at(lat, lon) == self.types.index(tid)

    def counts(self, lat: np.ndarray, lon: np.ndarray) -> dict[str, int]:
        """Cells of every terrain type among the cells with these centres (mixed cells are not counted)."""
        t = self._types_at(lat, lon)
        return {tid: int((t == i).sum()) for i, tid in enumerate(self.types) if (t == i).any()}
