"""Parse the Git-ignored operational source manifest for a structural family.

A manifest (``data/raw/vworld/<family>/source_manifest.json``) is the authority
for how the official protected/road archives map to layers and dataset releases:
it records provider, official dataset name, per-layer codes/categories/geometry
family, coverage type (regional vs nationwide), the per-dataset official
reference date and source CRS, filename aliases (so nationwide layer identity is
never taken from the archive filename), and the officially-unavailable cells.

The manifest carries provenance and mapping only — it never contains feature
data, and the loader still reads/validates every actual .prj/.dbf/.shp. This
module has no I/O beyond reading the manifest JSON and no database access.
"""

from __future__ import annotations

import datetime
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from .errors import IngestionError

POLYGON = "POLYGON"
LINE = "LINE"
REGIONAL = "regional"
NATIONWIDE = "nationwide"

# Per-(region, layer) coverage statuses.
COMPLETE_WITH_FEATURES = "COMPLETE_WITH_FEATURES"
COMPLETE_ZERO_FEATURES = "COMPLETE_ZERO_FEATURES"
OFFICIAL_SOURCE_UNAVAILABLE = "OFFICIAL_SOURCE_UNAVAILABLE"
SOURCE_MISSING = "SOURCE_MISSING"
VALIDATION_FAILURE = "VALIDATION_FAILURE"
NOT_APPLICABLE = "NOT_APPLICABLE"
NATIONWIDE_SOURCE_EVALUATED = "NATIONWIDE_SOURCE_EVALUATED"

# Family-level coverage.
COMPLETE = "COMPLETE"
COMPLETE_FOR_AVAILABLE_SOURCES = "COMPLETE_FOR_AVAILABLE_SOURCES"
PARTIAL = "PARTIAL"
INCOMPLETE = "INCOMPLETE"

_NON_ALNUM = re.compile(r"[^A-Z0-9]")


def _normalize(name: str) -> str:
    return _NON_ALNUM.sub("", name.upper())


class ManifestError(IngestionError):
    """Raised when a required source manifest is missing or malformed."""


@dataclass(frozen=True)
class LayerSpec:
    layer_code: str
    layer_identifier: str
    category: str
    official_layer_name: str
    geometry_family: str  # POLYGON | LINE
    filename_aliases: tuple[str, ...]
    exclude_aliases: tuple[str, ...] = ()
    provider_feature_id_fields: tuple[str, ...] = ()

    def matches(self, shp_stem: str) -> bool:
        token = _normalize(shp_stem)
        if any(_normalize(x) and _normalize(x) in token for x in self.exclude_aliases):
            return False
        return any(_normalize(a) and _normalize(a) in token for a in self.filename_aliases)

    def longest_alias_len(self, shp_stem: str) -> int:
        token = _normalize(shp_stem)
        return max(
            (len(_normalize(a)) for a in self.filename_aliases if _normalize(a) in token), default=0
        )


@dataclass(frozen=True)
class DatasetSpec:
    dataset_key: str
    provider: str
    official_dataset_name: str
    provider_dataset_identifier: str
    coverage_type: str  # regional | nationwide
    reference_date: datetime.date
    source_update_date: str | None
    source_crs: str | None
    official_source_url: str | None
    evidence: str | None
    layers: tuple[LayerSpec, ...]

    @property
    def is_nationwide(self) -> bool:
        return self.coverage_type == NATIONWIDE


@dataclass(frozen=True)
class SourceManifest:
    family: str
    datasets: tuple[DatasetSpec, ...]
    # {(region_dir, layer_code): evidence}
    official_unavailable: dict[tuple[str, str], str] = field(default_factory=dict)

    def all_layers(self) -> tuple[LayerSpec, ...]:
        return tuple(layer for ds in self.datasets for layer in ds.layers)

    def match(self, shp_stem: str) -> tuple[DatasetSpec, LayerSpec] | None:
        """Resolve (dataset, layer) for a shapefile base name via manifest aliases.

        Longer alias matches win so a specific code (e.g. ``N3L_A0020000``)
        beats a shorter fallback (``A0020000``). Returns ``None`` when nothing
        matches so unrelated files are skipped without guessing.
        """

        best: tuple[DatasetSpec, LayerSpec] | None = None
        best_len = 0
        for ds in self.datasets:
            for layer in ds.layers:
                if layer.matches(shp_stem):
                    length = layer.longest_alias_len(shp_stem)
                    if length > best_len:
                        best = (ds, layer)
                        best_len = length
        return best

    def unavailable_evidence(self, region_dir: str, layer_code: str) -> str | None:
        return self.official_unavailable.get((region_dir.lower(), layer_code.upper()))


def _parse_date(value: str, ctx: str) -> datetime.date:
    try:
        return datetime.date.fromisoformat(value)
    except (ValueError, TypeError) as exc:
        raise ManifestError(f"{ctx}: reference_date must be YYYY-MM-DD, got {value!r}") from exc


def _tuple(values: object) -> tuple[str, ...]:
    if not values:
        return ()
    if not isinstance(values, list):
        raise ManifestError(f"expected a list, got {type(values).__name__}")
    return tuple(str(v) for v in values)


def parse_manifest(raw: dict[str, object], *, family: str) -> SourceManifest:
    """Validate and parse a manifest mapping for ``family``."""

    declared_family = str(raw.get("family", "")).strip()
    if declared_family and declared_family != family:
        raise ManifestError(
            f"manifest declares family {declared_family!r} but loader family is {family!r}"
        )
    datasets_raw = raw.get("datasets")
    if not isinstance(datasets_raw, list) or not datasets_raw:
        raise ManifestError(f"{family} manifest has no datasets")

    datasets: list[DatasetSpec] = []
    for entry in datasets_raw:
        if not isinstance(entry, dict):
            raise ManifestError("each dataset must be an object")
        key = str(entry.get("dataset_key") or "").strip()
        if not key:
            raise ManifestError("dataset missing dataset_key")
        coverage = str(entry.get("coverage_type") or "").strip().lower()
        if coverage not in (REGIONAL, NATIONWIDE):
            raise ManifestError(f"{key}: coverage_type must be 'regional' or 'nationwide'")
        layers_raw = entry.get("layers")
        if not isinstance(layers_raw, list) or not layers_raw:
            raise ManifestError(f"{key}: dataset has no layers")
        layers: list[LayerSpec] = []
        for layer in layers_raw:
            if not isinstance(layer, dict):
                raise ManifestError(f"{key}: each layer must be an object")
            geom = str(layer.get("geometry_family") or "").strip().upper()
            if geom not in (POLYGON, LINE):
                raise ManifestError(f"{key}: layer geometry_family must be POLYGON or LINE")
            aliases = _tuple(layer.get("filename_aliases"))
            if not aliases:
                raise ManifestError(
                    f"{key}: layer {layer.get('layer_code')} has no filename_aliases"
                )
            layers.append(
                LayerSpec(
                    layer_code=str(layer["layer_code"]),
                    layer_identifier=str(layer.get("layer_identifier") or layer["layer_code"]),
                    category=str(layer["category"]),
                    official_layer_name=str(layer.get("official_layer_name") or ""),
                    geometry_family=geom,
                    filename_aliases=aliases,
                    exclude_aliases=_tuple(layer.get("exclude_aliases")),
                    provider_feature_id_fields=_tuple(layer.get("provider_feature_id_fields")),
                )
            )
        datasets.append(
            DatasetSpec(
                dataset_key=key,
                provider=str(entry.get("provider") or ""),
                official_dataset_name=str(entry.get("official_dataset_name") or ""),
                provider_dataset_identifier=str(entry.get("provider_dataset_identifier") or key),
                coverage_type=coverage,
                reference_date=_parse_date(str(entry.get("reference_date")), key),
                source_update_date=(
                    str(entry["source_update_date"]) if entry.get("source_update_date") else None
                ),
                source_crs=(str(entry["source_crs"]) if entry.get("source_crs") else None),
                official_source_url=(
                    str(entry["official_source_url"]) if entry.get("official_source_url") else None
                ),
                evidence=(str(entry["evidence"]) if entry.get("evidence") else None),
                layers=tuple(layers),
            )
        )

    unavailable: dict[tuple[str, str], str] = {}
    unavailable_raw = raw.get("official_source_unavailable")
    if isinstance(unavailable_raw, list):
        for cell in unavailable_raw:
            if not isinstance(cell, dict):
                continue
            region = str(cell.get("region") or "").strip().lower()
            layer = str(cell.get("layer") or "").strip().upper()
            if region and layer:
                unavailable[(region, layer)] = str(cell.get("evidence") or "")

    return SourceManifest(family=family, datasets=tuple(datasets), official_unavailable=unavailable)


def load_manifest(source_path: Path, *, family: str) -> SourceManifest:
    """Read and parse ``<source_path>/source_manifest.json`` for ``family``."""

    manifest_path = source_path / "source_manifest.json"
    if not manifest_path.is_file():
        raise ManifestError(
            f"Required source manifest not found: {manifest_path}. The {family} loader is "
            "manifest-driven (per-dataset reference dates, CRS, and nationwide layer identity)."
        )
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise ManifestError(f"Could not read {manifest_path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise ManifestError(f"{manifest_path} must contain a JSON object")
    return parse_manifest(raw, family=family)
