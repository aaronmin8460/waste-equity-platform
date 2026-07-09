"""Normalized waste-treatment facilities (RCIS facility PIDs, Phase 2.3).

The RCIS facility PIDs report one row per facility with the facility's location
(sido/sigungu name + street address, no coordinates), capacity, annual
throughput, and residue/landfill attributes. The accounting basis is
``FACILITY_LOCATION_BASED_THROUGHPUT``: quantities describe activity at the
facility's own location, NOT the origin region's generated waste (that is the
Phase 2.2 ``regional_waste_statistics`` origin-based accounting). The two must
never be conflated.

Phase 2.4 populates ``geometry`` from the official VWorld geocoder and records
the geocode provenance columns; coordinates are never fabricated, so a failed
geocode keeps ``geometry`` NULL with ``geocode_status = 'FAILED'``. Six PIDs
are ingested across two archetypes:

- Processing facilities (NTN031/032/040/046): ``capacity_quantity`` in 톤/일,
  ``throughput_quantity`` (DISP_QTY) in 톤/년, residue breakdown in 톤/년.
- Landfill facilities (NTN033/043): volume/area columns (㎥/㎡),
  ``throughput_quantity`` (FILL_QTY_TON) in 톤/년.

PID-specific columns that are not modeled explicitly (costs, energy recovery,
landfill gas, waste-type descriptors) are preserved verbatim in ``source_fields``
for reproducibility.
"""

import datetime
from decimal import Decimal
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

ACCOUNTING_BASIS_FACILITY_THROUGHPUT = "FACILITY_LOCATION_BASED_THROUGHPUT"

JsonVariant = JSON().with_variant(postgresql.JSONB(), "postgresql")
Quantity = Numeric(precision=20, scale=6, asdecimal=True)


class WasteTreatmentFacility(Base):
    __tablename__ = "waste_treatment_facilities"
    __table_args__ = (
        # Facilities have no official id, and a single site can report multiple
        # process lines that share every business attribute (name, address,
        # SEQ, type) and differ only in quantities. The reviewed identity key is
        # therefore the source PID, reference year, and stable source row
        # position (see ``source_row_index``).
        UniqueConstraint(
            "source_pid",
            "reference_year",
            "source_row_index",
            name="uq_waste_treatment_facilities_identity",
        ),
        CheckConstraint(
            f"accounting_basis = '{ACCOUNTING_BASIS_FACILITY_THROUGHPUT}'",
            name="waste_treatment_facilities_accounting_basis_allowed",
        ),
        CheckConstraint(
            "capacity_quantity IS NULL OR capacity_quantity >= 0",
            name="waste_treatment_facilities_capacity_nonnegative",
        ),
        CheckConstraint(
            "throughput_quantity IS NULL OR throughput_quantity >= 0",
            name="waste_treatment_facilities_throughput_nonnegative",
        ),
        CheckConstraint(
            "region_mapping_status IN "
            "('EXACT_MATCH','GEOCODED_MATCH','REQUIRES_GEOCODE','UNMATCHED','AMBIGUOUS')",
            name="waste_treatment_facilities_region_status_allowed",
        ),
        CheckConstraint(
            "geocode_status IS NULL OR geocode_status IN ('SUCCEEDED','FAILED')",
            name="waste_treatment_facilities_geocode_status_allowed",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("data_sources.source_id"), index=True)
    source_pid: Mapped[str] = mapped_column(String(20), index=True)
    official_dataset_name: Mapped[str] = mapped_column(String(200))
    reference_year: Mapped[int] = mapped_column(Integer)
    reference_period: Mapped[str] = mapped_column(String(50))

    # Derived from the PID: PUBLIC_INCINERATION, PUBLIC_OTHER, PUBLIC_LANDFILL,
    # PRIVATE_INTERMEDIATE_INCINERATION, PRIVATE_FINAL_DISPOSAL,
    # PRIVATE_RECYCLING.
    facility_category: Mapped[str] = mapped_column(String(40), index=True)
    # PROCESSING or LANDFILL.
    facility_kind: Mapped[str] = mapped_column(String(20), index=True)
    # PUBLIC or PRIVATE.
    ownership: Mapped[str] = mapped_column(String(20), index=True)

    facility_name: Mapped[str] = mapped_column(String(300))
    operator_name: Mapped[str | None] = mapped_column(String(200))
    address: Mapped[str] = mapped_column(String(500))
    source_seq: Mapped[str | None] = mapped_column(String(20))
    # Stable position among real facility rows in the PID response; part of the
    # identity key because facilities have no natural unique business key.
    source_row_index: Mapped[int] = mapped_column(Integer)

    # Location. region_id is set for an exact SGIS name match (EXACT_MATCH) or a
    # geocoded point-in-polygon resolution of a multi-district-city facility
    # (GEOCODED_MATCH); other statuses keep a NULL region_id pending review.
    region_id: Mapped[int | None] = mapped_column(ForeignKey("regions.id"), index=True)
    rcis_sido_name: Mapped[str] = mapped_column(String(50))
    rcis_sigungu_name: Mapped[str] = mapped_column(String(50))
    source_geographic_level: Mapped[str] = mapped_column(String(20))
    region_mapping_status: Mapped[str] = mapped_column(String(20), index=True)
    # EPSG:4326 point from the VWorld geocoder (Phase 2.4); NULL until geocoded
    # and NULL forever if the geocoder cannot resolve the address.
    geometry: Mapped[Any | None] = mapped_column(Geometry(geometry_type="POINT", srid=4326))

    # VWorld geocode provenance (Phase 2.4). geocode_request_address is the
    # exact query string sent; together with geocode_status it is the
    # idempotency key that prevents re-geocoding unchanged addresses.
    geocode_status: Mapped[str | None] = mapped_column(String(20), index=True)
    geocode_request_address: Mapped[str | None] = mapped_column(String(600))
    geocode_address_type: Mapped[str | None] = mapped_column(String(10))
    geocode_refined_address: Mapped[str | None] = mapped_column(String(600))
    # Legal-dong code from refined.structure.level4AC; its 2-digit prefix is a
    # sido-level cross-check (서울 11, 인천 28, 경기 41).
    geocode_level4ac: Mapped[str | None] = mapped_column(String(10))
    geocode_crs: Mapped[str | None] = mapped_column(String(20))
    geocode_note: Mapped[str | None] = mapped_column(Text)
    geocoded_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    geocode_raw_response_id: Mapped[int | None] = mapped_column(ForeignKey("raw_api_responses.id"))

    # Processing capacity (톤/일 for NTN031/032/040, ABILITY_QTY for NTN046);
    # NULL for landfills, which use volume capacity instead.
    capacity_quantity: Mapped[Decimal | None] = mapped_column(Quantity)
    capacity_unit: Mapped[str | None] = mapped_column(String(20))
    # Annual throughput: DISP_QTY (processing) or FILL_QTY_TON (landfill), 톤/년.
    throughput_quantity: Mapped[Decimal | None] = mapped_column(Quantity)
    throughput_unit: Mapped[str | None] = mapped_column(String(20))

    # Residue disposition (processing PIDs), 톤/년.
    residue_total: Mapped[Decimal | None] = mapped_column(Quantity)
    residue_recycling: Mapped[Decimal | None] = mapped_column(Quantity)
    residue_incineration: Mapped[Decimal | None] = mapped_column(Quantity)
    residue_landfill: Mapped[Decimal | None] = mapped_column(Quantity)
    residue_other: Mapped[Decimal | None] = mapped_column(Quantity)

    # Landfill attributes (NTN033/043).
    fill_area_m2: Mapped[Decimal | None] = mapped_column(Quantity)
    total_fill_capacity_m3: Mapped[Decimal | None] = mapped_column(Quantity)
    remaining_fill_capacity_m3: Mapped[Decimal | None] = mapped_column(Quantity)
    fill_quantity_m3: Mapped[Decimal | None] = mapped_column(Quantity)
    fill_use_period: Mapped[str | None] = mapped_column(String(50))

    # Source-reported permit/return dates, kept as text to preserve source form.
    permit_date: Mapped[str | None] = mapped_column(String(20))
    return_date: Mapped[str | None] = mapped_column(String(20))

    quantity_note: Mapped[str | None] = mapped_column(Text)
    accounting_basis: Mapped[str] = mapped_column(String(40))
    # All source fields not modeled above, sanitized and preserved verbatim.
    source_fields: Mapped[Any] = mapped_column(JsonVariant)

    retrieved_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    transformation_version: Mapped[str] = mapped_column(String(100))
    raw_response_id: Mapped[int | None] = mapped_column(ForeignKey("raw_api_responses.id"))
    ingestion_run_id: Mapped[int] = mapped_column(ForeignKey("ingestion_runs.run_id"), index=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
