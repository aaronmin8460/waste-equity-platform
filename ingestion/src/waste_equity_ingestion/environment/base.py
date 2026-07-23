"""Env-backed config + abstract ingestion-job base (Suitability Phase 1A).

Inert scaffolding. ``EnvironmentalIngestionConfig`` resolves the Git-ignored raw
data root from the ``ENVIRONMENTAL_DATA_ROOT`` environment variable (never a
hardcoded absolute path, mirroring how ``PROBE_SAMPLE_DIR`` resolves
``data/samples``). ``EnvironmentalIngestionJob`` is the abstract base a Phase 1B
per-layer loader subclasses; in Phase 1A its ``run`` is unimplemented and the
provided :meth:`not_implemented_report` returns the ``NOT_IMPLEMENTED`` state so
the seam is exercised without any database access or file read.

This module intentionally does **not** register a CLI subcommand: nothing here is
runnable as an ingestion job in Phase 1A, so production behaviour is unchanged.
"""

from __future__ import annotations

import abc
import os
from dataclasses import dataclass
from pathlib import Path

from waste_equity_backend.environment import (
    EnvironmentalLayerReport,
    EnvironmentalLayerSpec,
)

from ..config import find_env_file, resolve_config_path

# Default raw-data root (project-relative, Git-ignored). Overridable via the
# ENVIRONMENTAL_DATA_ROOT env var. This is NOT a hardcoded absolute path — it is
# resolved against the project directory exactly like the sample dir default.
_DEFAULT_DATA_ROOT = "data/raw/environment"


@dataclass(frozen=True)
class EnvironmentalIngestionConfig:
    """Configuration for the (future) environmental-layer ingestion jobs."""

    environmental_data_root: str

    @classmethod
    def from_env(cls) -> EnvironmentalIngestionConfig:
        """Resolve the raw-data root from ``ENVIRONMENTAL_DATA_ROOT`` (or default).

        The path is resolved relative to the project directory that owns ``.env``,
        so no absolute path is baked into the code. The directory is not required
        to exist in Phase 1A (nothing reads it yet).
        """

        env_path = find_env_file()
        root = resolve_config_path(
            env_path.parent,
            os.getenv("ENVIRONMENTAL_DATA_ROOT", _DEFAULT_DATA_ROOT),
        )
        return cls(environmental_data_root=root)

    def layer_source_dir(self, layer_name: str) -> Path:
        """Per-layer raw-source directory under the data root (path only, no I/O)."""

        return Path(self.environmental_data_root) / layer_name


class EnvironmentalIngestionJob(abc.ABC):
    """Abstract base for a future per-layer environmental ingestion job.

    A Phase 1B subclass sets :attr:`transformation_version` (e.g.
    ``"env-dem-slope-v1"``), binds a concrete :class:`EnvironmentalLayerSpec`, and
    implements :meth:`run` against real sources following the structural-loader
    conventions (idempotent, sanitized-raw preserved, fail-visibly, versioned).
    Phase 1A leaves :meth:`run` unimplemented.
    """

    #: Set by each Phase 1B subclass; empty until then.
    transformation_version: str = ""

    def __init__(self, spec: EnvironmentalLayerSpec, config: EnvironmentalIngestionConfig) -> None:
        self.spec = spec
        self.config = config

    @property
    def layer_name(self) -> str:
        return self.spec.layer_name

    @abc.abstractmethod
    def run(self, *, write: bool) -> EnvironmentalLayerReport:
        """Execute the ingestion job (Phase 1B). Not implemented in Phase 1A."""

        raise NotImplementedError(
            "Environmental ingestion is not implemented in Phase 1A (foundation only)."
        )

    def not_implemented_report(self, *, mode: str = "inspect") -> EnvironmentalLayerReport:
        """Return the inert ``NOT_IMPLEMENTED`` report (no DB access, no file read)."""

        return EnvironmentalLayerReport(
            layer_name=self.layer_name,
            mode=mode,
            status="NOT_IMPLEMENTED",
            message=(
                f"Environmental layer '{self.layer_name}' is catalogued but not yet "
                "ingested. Ingestion is a future Phase 1B change; no source data was "
                "read and no synthetic data was substituted."
            ),
        )
