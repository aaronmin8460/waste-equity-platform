"""Environmental-layer catalogue table (Suitability Phase 1A).

``environmental_layer_registry`` is a **metadata catalogue** of the
environmental/physical layers a future suitability phase may add. It holds no
score, no geometry, and no candidate data — only each layer's identity, form,
lifecycle, and Phase 1B ingestion-readiness recommendation. Every row carries an
explicit ``lifecycle`` (IMPLEMENTED / PLANNED / FUTURE / EXPERIMENTAL) so a
planned layer is never presented as implemented.

The rows are seeded (migration 0017) from the single source of truth in
``waste_equity_backend.environment.layers.registry_seed_rows``; a unit test
asserts the migration's inlined seed never diverges from it, exactly as the
facility standard-cost seed is cross-checked. This table changes no existing
table and no suitability result. See
``docs/SUITABILITY_ENVIRONMENTAL_ARCHITECTURE.md``.
"""

import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class EnvironmentalLayerRegistry(Base):
    """One catalogued environmental layer (metadata only; not data)."""

    __tablename__ = "environmental_layer_registry"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Stable machine name (snake_case); the catalogue key (unique constraint
    # provides its index).
    layer_name: Mapped[str] = mapped_column(String(50), unique=True)
    korean_label: Mapped[str] = mapped_column(String(100))
    # LayerModality value: vector_polygon / vector_line / raster / point_and_polygon /
    # raster_or_polygon.
    modality: Mapped[str] = mapped_column(String(30))
    # LayerLifecycle value: IMPLEMENTED / PLANNED / FUTURE / EXPERIMENTAL.
    lifecycle: Mapped[str] = mapped_column(String(20), index=True)
    # Roadmap label: "reuse" (already implemented), "1B", or "1C".
    target_phase: Mapped[str] = mapped_column(String(20))
    # Contract-verification status: LIVE_VERIFIED / DOCUMENTED_NOT_TESTED / ...
    verification_status: Mapped[str] = mapped_column(String(40))
    # Phase 1B ingestion-readiness: GO / CONDITIONAL_GO / NO_GO (never a scoring decision).
    readiness_recommendation: Mapped[str] = mapped_column(String(20))
    suitability_role: Mapped[str] = mapped_column(String(300))
    implementation_difficulty: Mapped[str] = mapped_column(String(40))
    # Short catalogue note; never a fabricated score or completion percentage.
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
