"""Abstract environmental-layer pipeline interfaces (Suitability Phase 1A).

These are the **contracts** a future Phase 1B ingestor/preprocessor will
implement. They are inert in Phase 1A: every operational method raises
``NotImplementedError``. No file is read, no dataset is imported, no score is
computed here. The abstraction exists so Phase 1B can add one concrete pipeline
per environmental layer without redesigning the seam, and so the empty ingestion
framework (``waste_equity_ingestion.environment``) has a stable base to build on.

Design conventions reused from the codebase:

* A job returns a report dataclass exposing ``sanitized_summary() -> dict``
  (as ``StructuralIngestionReport`` / ``SuitabilityBuildReport`` do), so the CLI
  can print JSON with no credentials or absolute paths.
* Reproject to EPSG:4326, normalize, fingerprint, version — the structural
  loader pattern. Distance/area use geodesic/projected CRS, never degrees.
* Raw source files live under a Git-ignored data root and are never committed;
  only checksums + provenance are persisted.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Any

from .layers import EnvironmentalLayerSpec, LayerModality

# Marker raised by every operational method in this foundation phase. Phase 1B
# replaces the ``raise`` with a real implementation, not this string.
_PHASE_1B = "Not implemented in Phase 1A (foundation only); scheduled for Phase 1B."


@dataclass(frozen=True)
class PreprocessingPlan:
    """Declarative preprocessing plan for one layer — description, not execution.

    Phase 1A can *describe* what a layer's preprocessing will entail (so the
    architecture and future API are concrete) without running any of it. A plan
    is a list of ordered, human-readable step labels plus the modality-implied
    reduction target (per-cell statistic for raster; versioned features for
    vector).
    """

    layer_name: str
    modality: LayerModality
    steps: tuple[str, ...]
    produces: str

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "layer_name": self.layer_name,
            "modality": self.modality.value,
            "steps": list(self.steps),
            "produces": self.produces,
        }


@dataclass
class EnvironmentalLayerReport:
    """Job report for a (future) environmental-layer pipeline run.

    Mirrors the platform's report contract: a plain dataclass with a
    ``sanitized_summary()`` the CLI prints. In Phase 1A it is only ever
    constructed in the ``NOT_IMPLEMENTED`` state — no real run produces one.
    """

    layer_name: str
    mode: str  # "inspect" | "dry-run" | "write" (future)
    status: str  # "NOT_IMPLEMENTED" in Phase 1A
    message: str
    dataset_version_id: int | None = None
    ingestion_run_id: int | None = None
    features_inserted: int = 0
    warnings: list[str] = field(default_factory=list)

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "layer_name": self.layer_name,
            "mode": self.mode,
            "status": self.status,
            "message": self.message,
            "dataset_version_id": self.dataset_version_id,
            "ingestion_run_id": self.ingestion_run_id,
            "features_inserted": self.features_inserted,
            "warnings": list(self.warnings),
        }


class EnvironmentalLayerPipeline(abc.ABC):
    """Abstract base for one environmental layer's ingest→normalize→derive pipeline.

    A future Phase 1B subclass binds a concrete :class:`EnvironmentalLayerSpec`
    and implements the operational methods against real sources. In Phase 1A the
    base is inert: the operational methods raise ``NotImplementedError`` and only
    :meth:`describe` and :meth:`plan` (pure, data-free) are usable.
    """

    def __init__(self, spec: EnvironmentalLayerSpec) -> None:
        self.spec = spec

    @property
    def layer_name(self) -> str:
        return self.spec.layer_name

    def describe(self) -> dict[str, Any]:
        """Return the layer's catalogue metadata (pure; no data access)."""

        return {
            "layer_name": self.spec.layer_name,
            "korean_label": self.spec.korean_label,
            "modality": self.spec.modality.value,
            "lifecycle": self.spec.lifecycle.value,
            "target_phase": self.spec.target_phase,
            "verification": self.spec.verification.value,
            "recommendation": self.spec.recommendation.value,
            "storage_crs": self.spec.storage_crs,
        }

    @abc.abstractmethod
    def plan(self) -> PreprocessingPlan:
        """Return the declarative preprocessing plan (description only)."""

        raise NotImplementedError

    # --- Operational seam (Phase 1B) — inert in Phase 1A -------------------- #

    def discover_sources(self, source_root: str) -> list[str]:
        """Discover raw source files for this layer under ``source_root``.

        Phase 1B implements manifest-matched discovery (the structural loader
        pattern). Phase 1A raises.
        """

        raise NotImplementedError(_PHASE_1B)

    def validate_sources(self, source_paths: list[str]) -> None:
        """Validate CRS/sidecars/checksums of discovered sources. Phase 1B."""

        raise NotImplementedError(_PHASE_1B)

    def preprocess(self, source_paths: list[str]) -> EnvironmentalLayerReport:
        """Run the reproject/normalize (vector) or raster→zonal reduction. Phase 1B."""

        raise NotImplementedError(_PHASE_1B)

    def normalize(self, source_paths: list[str]) -> EnvironmentalLayerReport:
        """Persist normalized versioned features / per-cell statistics. Phase 1B."""

        raise NotImplementedError(_PHASE_1B)
