"""Discover, resolve, and load the 2024 municipal waste-cost workbooks.

Pipeline, in order:

1. recursively discover ``*.xlsx`` under the source root (NFC-normalized paths)
2. compute SHA-256 (the file identity; the recorded path is metadata)
3. classify layout and parse (see :mod:`municipal_cost_parser`)
4. resolve the municipality, or reject the workbook and keep its provenance
5. detect quantity series copied verbatim between workbooks
6. build the 66-row 2024 analytical geography registry
7. derive the seven ward-split Gyeonggi city populations by exact ward sum
8. compute the payment-per-capita indicator for **all 66** municipalities
9. write transactionally (``--write``) or report only (``--dry-run``)

``--dry-run`` opens no write transaction and makes zero database writes; it still
*reads* the official ``regions`` / ``regional_population`` rows, because the
denominator is part of what a dry run has to prove.

Writing is content-addressed and idempotent: a byte-identical second run over
unchanged inputs inserts no source file, contract, quantity, or indicator row,
updates no stored value, and leaves every timestamp untouched. Nothing outside
these six tables is ever written — in particular no ``regions`` row is created or
modified, and no row is ever added to ``landfill_inbound_monthly``.
"""

from __future__ import annotations

import datetime
import hashlib
from collections import Counter, defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from waste_equity_backend.analysis.municipal_cost import (
    EXPECTED_COUNT_BY_METROPOLITAN,
    EXPECTED_MUNICIPALITIES,
    EXPECTED_MUNICIPALITY_COUNT,
    METROPOLITAN_CODES,
    METROPOLITAN_GYEONGGI,
    METROPOLITAN_INCHEON,
    METROPOLITAN_NAMES,
    METROPOLITAN_SEOUL,
    POST_2024_INCHEON_UNITS,
    IndicatorOutcome,
    MunicipalityDefinition,
    describe_reasons,
    evaluate_indicator,
    find_rejection_rule,
    find_reviewed_limitations,
    find_reviewed_mapping,
    match_municipality_name,
    nfc,
    order_reasons,
)
from waste_equity_backend.db import get_sessionmaker
from waste_equity_backend.models import (
    DatasetFreshness,
    IngestionRun,
    MunicipalCostGeography,
    MunicipalCostGeographyComponent,
    MunicipalCostIndicatorValue,
    MunicipalCostSourceFile,
    MunicipalWasteContract,
    MunicipalWasteQuantity,
    Region,
    RegionalPopulation,
)
from waste_equity_backend.models.metadata import GRANULARITY_ANNUAL
from waste_equity_backend.models.municipal_cost import (
    BOUNDARY_VINTAGE,
    CLASS_AMBIGUOUS_REGION_MAPPING,
    CLASS_BOUNDARY_MISMATCH,
    CURRENCY_KRW,
    DATASET_ROLE_A,
    DATASET_ROLE_B,
    EVIDENCE_LOCAL_GOVERNMENT_DERIVED,
    EVIDENCE_LOCAL_GOVERNMENT_REPORTED,
    EVIDENCE_OFFICIAL_DERIVED,
    INDICATOR_UNIT,
    INGESTION_DECISION_ACCEPTED,
    INGESTION_DECISION_REJECTED,
    METHODOLOGY_VERSION,
    MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA,
    MUNICIPALITY_LEVEL_SIGUNGU,
    NUMERATOR_ELIGIBLE_BASES,
    POPULATION_DEFINITION_SGIS,
    POPULATION_DERIVED_WARD_SUM,
    QUANTITY_UNIT_TONNE,
    REASON_AMBIGUOUS_REGION_MAPPING,
    REASON_BOUNDARY_MISMATCH,
    REASON_DUPLICATE_SOURCE_RECORD,
    REASON_MISSING_POPULATION,
    REASON_MISSING_QUANTITY,
    REVIEWED_RESOLUTION_REASONS,
    SOURCE_ID,
    STATUS_AVAILABLE,
    STATUS_PARTIAL,
    STATUS_UNAVAILABLE,
    TRANSFORMATION_VERSION,
)

from .errors import IngestionError
from .municipal_cost_parser import ParsedWorkbook, parse_workbook, sha256_file

REFERENCE_YEAR = 2024
DEFAULT_SOURCE_DIR = "data/import/municipal-costs/2024"

# Top-level folders declaring the dataset role. The role is confirmed against
# parsed content; the folder alone is never trusted (the 양천구 workbook proves a
# folder can be wrong).
_ROLE_FOLDERS = {"DATA_A": DATASET_ROLE_A, "DATA_B": DATASET_ROLE_B}

# Region-folder prefix → metropolitan code. The Gyeonggi folders embed delivery
# progress counts ("경기도(31개 중 22개 완료 8.4 기준)") and differ between DATA_A
# and DATA_B, so only the prefix is meaningful.
_METROPOLITAN_FOLDER_PREFIXES = (
    ("서울", METROPOLITAN_SEOUL),
    ("인천", METROPOLITAN_INCHEON),
    ("경기", METROPOLITAN_GYEONGGI),
)

# Prefixes stripped from a workbook 기관명 before matching ("인천광역시 동구청").
_ORGANISATION_PREFIXES = ("서울특별시", "인천광역시", "경기도")

RESOLUTION_WORKBOOK_NAME = "WORKBOOK_ORGANISATION_NAME"
RESOLUTION_FILENAME = "FILENAME"
RESOLUTION_REVIEWED_MAPPING = "REVIEWED_MAPPING"
RESOLUTION_UNRESOLVED = "UNRESOLVED"


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(tz=datetime.UTC)


# ---------------------------------------------------------------------------
# Discovery + resolution
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DiscoveredFile:
    path: Path
    relative_path: str
    filename: str
    filename_stem: str
    filename_annotation: str
    dataset_role: str
    region_folder: str
    metropolitan_code: str
    size_bytes: int
    sha256: str


@dataclass
class Resolution:
    geography_key: str | None
    resolution_basis: str
    resolution_evidence: str | None
    decision: str
    reasons: list[str] = field(default_factory=list)
    explanation: str | None = None
    classification_override: str | None = None


def discover_files(source_dir: Path) -> list[DiscoveredFile]:
    """Every workbook under the source root, in deterministic NFC path order."""

    if not source_dir.is_dir():
        raise IngestionError(f"municipal-costs source directory not found: {source_dir}")

    found: list[DiscoveredFile] = []
    for path in source_dir.rglob("*.xlsx"):
        if not path.is_file() or path.name.startswith("~$") or path.name.startswith("."):
            continue
        relative = nfc(str(path.relative_to(source_dir)))
        parts = relative.split("/")
        role = _ROLE_FOLDERS.get(parts[0])
        if role is None:
            continue
        region_folder = parts[1] if len(parts) > 2 else ""
        metropolitan = _metropolitan_from_folder(region_folder)
        if metropolitan is None:
            continue
        stem = nfc(path.stem)
        annotation = stem.split(" - ", 1)[1].strip() if " - " in stem else ""
        found.append(
            DiscoveredFile(
                path=path,
                relative_path=relative,
                filename=nfc(path.name),
                filename_stem=stem,
                filename_annotation=annotation,
                dataset_role=role,
                region_folder=region_folder,
                metropolitan_code=metropolitan,
                size_bytes=path.stat().st_size,
                sha256=sha256_file(path),
            )
        )
    return sorted(found, key=lambda item: item.relative_path)


def _metropolitan_from_folder(folder: str) -> str | None:
    normalized = nfc(folder)
    for prefix, code in _METROPOLITAN_FOLDER_PREFIXES:
        if normalized.startswith(prefix):
            return code
    return None


def normalize_organisation_name(raw: str) -> str:
    """``인천광역시 동구청`` → ``동구``; ``가평군청`` → ``가평군``."""

    name = nfc(raw).strip()
    for prefix in _ORGANISATION_PREFIXES:
        if name.startswith(prefix):
            name = name[len(prefix) :].strip()
    if name.endswith("청"):
        name = name[:-1].strip()
    return name


def _filename_candidate(stem: str) -> str:
    """Municipality token at the head of a filename stem.

    Delivered filenames carry operator annotations after " - " and occasional
    ``xlsx`` suffixes (``남동구xlsx``), so only the leading token is used and the
    registry match is a longest-prefix match.
    """

    head = nfc(stem).split(" - ", 1)[0].strip()
    return head[:-4].strip() if head.endswith("xlsx") else head


def resolve_file(discovered: DiscoveredFile, parsed: ParsedWorkbook) -> Resolution:
    """Resolve a workbook to a 2024 municipality, or reject it with its reasons."""

    rejection = find_rejection_rule(
        discovered.dataset_role, discovered.metropolitan_code, discovered.filename
    )
    if rejection is not None:
        return Resolution(
            geography_key=None,
            resolution_basis=RESOLUTION_UNRESOLVED,
            resolution_evidence=rejection.explanation,
            decision=INGESTION_DECISION_REJECTED,
            reasons=list(rejection.reasons),
            explanation=rejection.explanation,
            classification_override=(
                CLASS_BOUNDARY_MISMATCH
                if REASON_BOUNDARY_MISMATCH in rejection.reasons
                else CLASS_AMBIGUOUS_REGION_MAPPING
            ),
        )

    reviewed = find_reviewed_mapping(
        discovered.dataset_role, discovered.metropolitan_code, discovered.filename
    )
    if reviewed is not None:
        definition = match_municipality_name(discovered.metropolitan_code, reviewed.display_name)
        if definition is None:  # pragma: no cover - reviewed names are registry names
            raise IngestionError(
                f"reviewed mapping names an unknown municipality: {reviewed.display_name}"
            )
        return Resolution(
            geography_key=definition.municipality_key,
            resolution_basis=RESOLUTION_REVIEWED_MAPPING,
            resolution_evidence=reviewed.evidence,
            decision=INGESTION_DECISION_ACCEPTED,
            reasons=[reviewed.reason],
        )

    filename_name = _filename_candidate(discovered.filename_stem)
    filename_match = match_municipality_name(discovered.metropolitan_code, filename_name)

    workbook_match: MunicipalityDefinition | None = None
    workbook_name = ""
    if parsed.source_municipality_names:
        workbook_name = normalize_organisation_name(parsed.source_municipality_names[0])
        workbook_match = match_municipality_name(discovered.metropolitan_code, workbook_name)

    # A post-2024 Incheon name with no in-workbook 2024 unit and no reviewed
    # mapping is a boundary mismatch: there is no documented, reproducible
    # conversion, and the 2024 values of 중구/동구/서구 are never redistributed.
    if workbook_match is None and nfc(filename_name) in POST_2024_INCHEON_UNITS:
        return Resolution(
            geography_key=None,
            resolution_basis=RESOLUTION_UNRESOLVED,
            resolution_evidence=f"파일명 '{filename_name}'은 2024년 행정구역이 아닙니다.",
            decision=INGESTION_DECISION_REJECTED,
            reasons=[REASON_BOUNDARY_MISMATCH, REASON_AMBIGUOUS_REGION_MAPPING],
            explanation="2024년 행정구역으로 환원할 문서화된 근거가 없는 2024년 이후 명칭입니다.",
            classification_override=CLASS_BOUNDARY_MISMATCH,
        )

    if workbook_match is not None and filename_match is not None:
        if workbook_match.municipality_key != filename_match.municipality_key:
            # Signals conflict with no third signal to break the tie: never
            # silently pick one.
            return Resolution(
                geography_key=None,
                resolution_basis=RESOLUTION_UNRESOLVED,
                resolution_evidence=(
                    f"워크북 기관명 '{workbook_name}'과 파일명 '{filename_name}'이 "
                    "서로 다른 행정구역을 가리킵니다."
                ),
                decision=INGESTION_DECISION_REJECTED,
                reasons=[REASON_AMBIGUOUS_REGION_MAPPING],
                explanation="행정구역 신호가 충돌하며 이를 해소할 검토된 매핑이 없습니다.",
                classification_override=CLASS_AMBIGUOUS_REGION_MAPPING,
            )
    if workbook_match is not None:
        return Resolution(
            geography_key=workbook_match.municipality_key,
            resolution_basis=RESOLUTION_WORKBOOK_NAME,
            resolution_evidence=f"워크북 기관명 셀: {parsed.source_municipality_names[0]}",
            decision=INGESTION_DECISION_ACCEPTED,
        )
    if filename_match is not None:
        return Resolution(
            geography_key=filename_match.municipality_key,
            resolution_basis=RESOLUTION_FILENAME,
            resolution_evidence=f"파일명: {discovered.filename}",
            decision=INGESTION_DECISION_ACCEPTED,
        )

    return Resolution(
        geography_key=None,
        resolution_basis=RESOLUTION_UNRESOLVED,
        resolution_evidence=(
            f"'{filename_name}'은(는) {METROPOLITAN_NAMES[discovered.metropolitan_code]} "
            "2024년 행정구역 목록에 없습니다."
        ),
        decision=INGESTION_DECISION_REJECTED,
        reasons=[REASON_AMBIGUOUS_REGION_MAPPING],
        explanation="폴더가 가리키는 광역지자체의 2024년 행정구역과 일치하지 않습니다.",
        classification_override=CLASS_AMBIGUOUS_REGION_MAPPING,
    )


# ---------------------------------------------------------------------------
# Cross-file duplicate detection
# ---------------------------------------------------------------------------


def detect_duplicate_series(
    parsed_by_path: dict[str, ParsedWorkbook],
    municipality_by_path: dict[str, str | None],
) -> dict[str, list[tuple[str, str]]]:
    """Find quantity series that are byte-identical across **different** municipalities.

    Two municipalities cannot independently report identical tonnage to two
    decimals across twelve months; one is a copy of the other. An identical
    series *within* one municipality is the opposite — it is the documented
    DATA_A/DATA_B reconciliation (고양시's DATA_A 수도권매립지 반입 equals its
    DATA_B 일반 exactly) — so same-municipality matches are not duplicates and are
    deliberately not flagged. Returns ``{relative_path: [(other_path, series), …]}``.
    """

    fingerprints: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for path, parsed in parsed_by_path.items():
        by_series: dict[str, list[tuple[str, str]]] = defaultdict(list)
        for quantity in parsed.quantities:
            if quantity.reference_month is None or quantity.quantity_value is None:
                continue
            series = quantity.source_label.split(":", 1)[0]
            by_series[series].append((quantity.reference_month, str(quantity.quantity_value)))
        for series, points in by_series.items():
            if len(points) < 12:
                continue
            digest = hashlib.sha256(
                "|".join(f"{month}={value}" for month, value in sorted(points)).encode("utf-8")
            ).hexdigest()
            fingerprints[digest].append((path, series))

    duplicates: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for members in fingerprints.values():
        if len(members) < 2:
            continue
        for path, series in members:
            for other_path, _other_series in members:
                if other_path == path:
                    continue
                own = municipality_by_path.get(path)
                other = municipality_by_path.get(other_path)
                # Same municipality → cross-source reconciliation, not a duplicate.
                # An unresolved workbook has no municipality, so a match against
                # any resolved one is still a collision worth reporting.
                if own is not None and own == other:
                    continue
                duplicates[path].append((other_path, series))
    return dict(duplicates)


# ---------------------------------------------------------------------------
# Geography registry
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ComponentPopulation:
    region_id: int
    region_code: str
    region_name: str
    population: int


@dataclass
class RegistryEntry:
    definition: MunicipalityDefinition
    direct_region_id: int | None
    direct_region_code: str | None
    population: int | None
    components: list[ComponentPopulation]
    status: str
    reasons: list[str]

    @property
    def key(self) -> str:
        return self.definition.municipality_key

    @property
    def evidence_status(self) -> str:
        return self.definition.evidence_status


def _load_region_index(session: Session) -> dict[str, tuple[int, str]]:
    """``region_code -> (id, region_name)`` for the 2024 SIGUNGU boundary vintage."""

    rows = session.execute(
        select(Region.id, Region.region_code, Region.region_name)
        .where(Region.boundary_reference_period == BOUNDARY_VINTAGE)
        .where(Region.region_level == MUNICIPALITY_LEVEL_SIGUNGU)
    ).all()
    return {str(code): (int(region_id), str(name)) for region_id, code, name in rows}


def _load_population_index(session: Session) -> dict[int, int]:
    """``region_id -> 2024 SGIS annual population``.

    Deliberately scoped to the ANNUAL SGIS series: the MOIS monthly
    resident-registration series is metropolitan-only and cannot denominate a
    municipal indicator, and mixing the two would silently blank the map.
    """

    rows = session.execute(
        select(RegionalPopulation.region_id, RegionalPopulation.population)
        .where(RegionalPopulation.reference_year == REFERENCE_YEAR)
        .where(RegionalPopulation.population_temporal_granularity == GRANULARITY_ANNUAL)
        .where(RegionalPopulation.population_definition == POPULATION_DEFINITION_SGIS)
    ).all()
    return {int(region_id): int(population) for region_id, population in rows}


def build_registry(session: Session) -> list[RegistryEntry]:
    """The 66 expected 2024 municipalities with their denominators."""

    regions = _load_region_index(session)
    populations = _load_population_index(session)

    entries: list[RegistryEntry] = []
    for definition in EXPECTED_MUNICIPALITIES:
        components: list[ComponentPopulation] = []
        reasons: list[str] = []
        direct_region_id: int | None = None
        direct_region_code: str | None = None
        population: int | None = None

        if definition.canonical_region_code is not None:
            direct_region_code = definition.canonical_region_code
            located = regions.get(direct_region_code)
            if located is None:
                reasons.append(REASON_MISSING_POPULATION)
            else:
                direct_region_id = located[0]
                population = populations.get(direct_region_id)
                if population is None:
                    reasons.append(REASON_MISSING_POPULATION)
        else:
            # Exact sum of the constituent 일반구 populations. A partial sum is
            # never published: if any ward is missing, the city has no denominator.
            missing = False
            for ward_code in definition.ward_region_codes:
                located = regions.get(ward_code)
                if located is None:
                    missing = True
                    continue
                ward_id, ward_name = located
                ward_population = populations.get(ward_id)
                if ward_population is None:
                    missing = True
                    continue
                components.append(
                    ComponentPopulation(
                        region_id=ward_id,
                        region_code=ward_code,
                        region_name=ward_name,
                        population=ward_population,
                    )
                )
            if missing or len(components) != len(definition.ward_region_codes):
                reasons.append(REASON_MISSING_POPULATION)
                components = []
            else:
                population = sum(component.population for component in components)

        status = STATUS_UNAVAILABLE if population is None or population <= 0 else STATUS_AVAILABLE
        if status == STATUS_UNAVAILABLE:
            population = None
            if REASON_MISSING_POPULATION not in reasons:
                reasons.append(REASON_MISSING_POPULATION)
        entries.append(
            RegistryEntry(
                definition=definition,
                direct_region_id=direct_region_id,
                direct_region_code=direct_region_code,
                population=population,
                components=components,
                status=status,
                reasons=reasons,
            )
        )

    if len(entries) != EXPECTED_MUNICIPALITY_COUNT:  # pragma: no cover - registry is a constant
        raise IngestionError(
            f"registry built {len(entries)} municipalities, expected {EXPECTED_MUNICIPALITY_COUNT}"
        )
    return entries


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


@dataclass
class MunicipalCostReport:
    mode: str
    status: str
    reference_year: int
    source_dir: str
    discovered_count: int = 0
    parsed_count: int = 0
    accepted_count: int = 0
    rejected_count: int = 0
    dataset_role_counts: dict[str, int] = field(default_factory=dict)
    layout_family_counts: dict[str, int] = field(default_factory=dict)
    primary_class_counts: dict[str, int] = field(default_factory=dict)
    rejected_files: list[dict[str, Any]] = field(default_factory=list)
    duplicate_series: list[dict[str, Any]] = field(default_factory=list)
    registry_counts: dict[str, int] = field(default_factory=dict)
    derived_cities: list[dict[str, Any]] = field(default_factory=list)
    contract_count: int = 0
    eligible_contract_count: int = 0
    # Contracts kept as source rows but excluded from the numerator because they
    # are payments on another accounting basis.
    non_collection_transport_contracts: list[dict[str, Any]] = field(default_factory=list)
    reviewed_limitations: list[dict[str, Any]] = field(default_factory=list)
    quantity_count: int = 0
    repeated_block_files: int = 0
    repeated_block_quantities: int = 0
    numerator_total_krw: str | None = None
    indicator_counts: dict[str, int] = field(default_factory=dict)
    municipalities: list[dict[str, Any]] = field(default_factory=list)
    writes: dict[str, int] = field(default_factory=dict)
    idempotent_no_op: bool | None = None
    ingestion_run_id: int | None = None
    warnings: list[str] = field(default_factory=list)

    def sanitized_summary(self) -> dict[str, Any]:
        """JSON-safe summary. Paths are relative to the source root only."""

        return {
            "source": "municipal-waste-costs",
            "mode": self.mode,
            "status": self.status,
            "reference_year": self.reference_year,
            "source_dir": self.source_dir,
            "indicator_code": MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA,
            "methodology_version": METHODOLOGY_VERSION,
            "transformation_version": TRANSFORMATION_VERSION,
            "ingestion_run_id": self.ingestion_run_id,
            "source_files": {
                "discovered": self.discovered_count,
                "parsed": self.parsed_count,
                "accepted": self.accepted_count,
                "rejected": self.rejected_count,
                "by_dataset_role": dict(sorted(self.dataset_role_counts.items())),
                "by_layout_family": dict(sorted(self.layout_family_counts.items())),
                "by_primary_classification": dict(sorted(self.primary_class_counts.items())),
            },
            "rejected_files": self.rejected_files,
            "duplicate_source_series": self.duplicate_series,
            "registry": {
                "expected": EXPECTED_MUNICIPALITY_COUNT,
                "built": sum(self.registry_counts.values()),
                "by_metropolitan": dict(sorted(self.registry_counts.items())),
                "expected_by_metropolitan": dict(sorted(EXPECTED_COUNT_BY_METROPOLITAN.items())),
                "derived_population_cities": self.derived_cities,
            },
            "observations": {
                "contracts": self.contract_count,
                "eligible_contracts": self.eligible_contract_count,
                "non_collection_transport_contracts": len(self.non_collection_transport_contracts),
                "quantities": self.quantity_count,
                "files_with_repeated_quantity_blocks": self.repeated_block_files,
                "logical_quantities_from_repeated_blocks": self.repeated_block_quantities,
            },
            "excluded_contract_basis": self.non_collection_transport_contracts,
            "reviewed_municipality_limitations": self.reviewed_limitations,
            "indicator": {
                "unit": INDICATOR_UNIT,
                "numerator_total_krw": self.numerator_total_krw,
                "counts": dict(sorted(self.indicator_counts.items())),
            },
            "municipalities": self.municipalities,
            "writes": dict(sorted(self.writes.items())),
            "idempotent_no_op": self.idempotent_no_op,
            "warnings": self.warnings,
        }


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


@dataclass
class _FileOutcome:
    discovered: DiscoveredFile
    parsed: ParsedWorkbook
    resolution: Resolution


def run_municipal_cost_ingestion(
    *,
    source_dir: str = DEFAULT_SOURCE_DIR,
    year: int = REFERENCE_YEAR,
    write: bool = False,
    session_factory: sessionmaker[Session] | None = None,
) -> MunicipalCostReport:
    """Run the full pipeline. ``write=False`` performs zero database writes."""

    if year != REFERENCE_YEAR:
        raise IngestionError(
            f"municipal-costs currently supports reference year {REFERENCE_YEAR} only"
        )

    root = Path(source_dir)
    report = MunicipalCostReport(
        mode="write" if write else "dry-run",
        status="SUCCEEDED" if write else "DRY_RUN_OK",
        reference_year=year,
        source_dir=nfc(str(root)),
    )

    discovered = discover_files(root)
    report.discovered_count = len(discovered)

    outcomes: list[_FileOutcome] = []
    parsed_by_path: dict[str, ParsedWorkbook] = {}
    for item in discovered:
        parsed = parse_workbook(
            item.path,
            dataset_role=item.dataset_role,
            reference_year=year,
            filename_annotation=item.filename_annotation,
        )
        parsed_by_path[item.relative_path] = parsed
        outcomes.append(_FileOutcome(item, parsed, resolve_file(item, parsed)))
    report.parsed_count = len(outcomes)

    duplicates = detect_duplicate_series(
        parsed_by_path,
        {item.discovered.relative_path: item.resolution.geography_key for item in outcomes},
    )
    for path, matches in sorted(duplicates.items()):
        report.duplicate_series.append(
            {
                "relative_path": path,
                "identical_to": sorted({other for other, _ in matches}),
                "series": sorted({series for _, series in matches}),
            }
        )
        parsed_by_path[path].source_notes.append(
            "동일한 월별 수량 계열이 다른 워크북과 완전히 일치합니다: "
            + ", ".join(sorted({other for other, _ in matches}))
        )
        if REASON_DUPLICATE_SOURCE_RECORD not in parsed_by_path[path].quantity_limitation_reasons:
            parsed_by_path[path].quantity_limitation_reasons.append(REASON_DUPLICATE_SOURCE_RECORD)

    report.dataset_role_counts = dict(Counter(item.discovered.dataset_role for item in outcomes))
    report.layout_family_counts = dict(Counter(item.parsed.layout_family for item in outcomes))
    report.primary_class_counts = dict(
        Counter(
            item.resolution.classification_override or item.parsed.primary_classification
            for item in outcomes
        )
    )
    report.accepted_count = sum(
        1 for item in outcomes if item.resolution.decision == INGESTION_DECISION_ACCEPTED
    )
    report.rejected_count = len(outcomes) - report.accepted_count
    for outcome in outcomes:
        if outcome.resolution.decision != INGESTION_DECISION_REJECTED:
            continue
        report.rejected_files.append(
            {
                "relative_path": outcome.discovered.relative_path,
                "filename": outcome.discovered.filename,
                "dataset_role": outcome.discovered.dataset_role,
                "reason_codes": order_reasons(outcome.resolution.reasons),
                "explanation": outcome.resolution.explanation,
            }
        )

    factory = session_factory or get_sessionmaker()
    session = factory()
    try:
        registry = build_registry(session)
        _fill_registry_report(report, registry)
        outcomes_by_key = _group_by_municipality(outcomes)
        indicators = _compute_indicators(registry, outcomes_by_key)
        _fill_indicator_report(report, registry, outcomes_by_key, indicators)
        if write:
            _write_all(session, report, registry, outcomes, indicators)
        else:
            report.writes = {}
    finally:
        session.close()
    return report


def _fill_registry_report(report: MunicipalCostReport, registry: Sequence[RegistryEntry]) -> None:
    report.registry_counts = dict(Counter(entry.definition.metropolitan_code for entry in registry))
    for entry in registry:
        if entry.definition.population_method != POPULATION_DERIVED_WARD_SUM:
            continue
        report.derived_cities.append(
            {
                "municipality_key": entry.key,
                "display_name": entry.definition.display_name,
                "population_method": POPULATION_DERIVED_WARD_SUM,
                "population": entry.population,
                "component_sum": (
                    sum(component.population for component in entry.components)
                    if entry.components
                    else None
                ),
                "components": [
                    {
                        "region_code": component.region_code,
                        "region_name": component.region_name,
                        "population": component.population,
                    }
                    for component in entry.components
                ],
            }
        )
    missing = [entry.key for entry in registry if entry.status == STATUS_UNAVAILABLE]
    if missing:
        report.warnings.append(
            f"{len(missing)} municipality/ies have no 2024 denominator: " + ", ".join(missing)
        )
    for code in METROPOLITAN_CODES:
        actual = report.registry_counts.get(code, 0)
        expected = EXPECTED_COUNT_BY_METROPOLITAN[code]
        if actual != expected:  # pragma: no cover - registry is a reviewed constant
            raise IngestionError(
                f"registry has {actual} municipalities for metropolitan {code}, expected {expected}"
            )


def _group_by_municipality(outcomes: Sequence[_FileOutcome]) -> dict[str, list[_FileOutcome]]:
    grouped: dict[str, list[_FileOutcome]] = defaultdict(list)
    for outcome in outcomes:
        key = outcome.resolution.geography_key
        if key is None or outcome.resolution.decision != INGESTION_DECISION_ACCEPTED:
            continue
        grouped[key].append(outcome)
    return dict(grouped)


def _compute_indicators(
    registry: Sequence[RegistryEntry], outcomes_by_key: dict[str, list[_FileOutcome]]
) -> dict[str, IndicatorOutcome]:
    """Payment-per-capita for every registry entry, available or not."""

    results: dict[str, IndicatorOutcome] = {}
    for entry in registry:
        files = outcomes_by_key.get(entry.key, [])
        numerator: Decimal | None = None
        contract_count = 0
        reasons: list[str] = list(entry.reasons)

        for outcome in files:
            # Only payment-side limitations may reach the indicator: quantity
            # completeness is not an input to a payment indicator.
            reasons.extend(outcome.parsed.payment_limitation_reasons)
            reasons.extend(
                reason
                for reason in outcome.resolution.reasons
                if reason in REVIEWED_RESOLUTION_REASONS
            )
            for contract in outcome.parsed.contracts:
                if not contract.is_primary_numerator_eligible:
                    continue
                if contract.payment_amount_krw is None:  # pragma: no cover - eligibility implies it
                    continue
                numerator = (numerator or Decimal(0)) + contract.payment_amount_krw
                contract_count += 1
                reasons.extend(contract.limitation_reasons)

        # Informational only: a municipality with no numeric tonnage anywhere.
        # It never blocks and never degrades the payment indicator.
        if files and not any(outcome.parsed.has_numeric_quantity for outcome in files):
            reasons.append(REASON_MISSING_QUANTITY)

        # Limitations a previous delivery evidenced and this one merely stopped
        # printing (see REVIEWED_MUNICIPALITY_LIMITATIONS). Applied only where a
        # DATA_A payment workbook was actually accepted, because every one of
        # them qualifies *payment* evidence: attaching them to a municipality
        # that delivered no payment workbook would explain a limitation of data
        # that does not exist. order_reasons() dedupes, so a future delivery that
        # restores the wording derives the identical code without doubling it.
        if any(item.discovered.dataset_role == DATASET_ROLE_A for item in files):
            reasons.extend(
                limitation.reason
                for limitation in find_reviewed_limitations(
                    entry.definition.metropolitan_code,
                    entry.definition.display_name,
                    REFERENCE_YEAR,
                )
            )

        results[entry.key] = evaluate_indicator(
            population=entry.population,
            numerator_krw=numerator,
            contract_count=contract_count,
            has_source_file=bool(files),
            reason_codes=reasons,
        )
    return results


def _fill_indicator_report(
    report: MunicipalCostReport,
    registry: Sequence[RegistryEntry],
    outcomes_by_key: dict[str, list[_FileOutcome]],
    indicators: dict[str, IndicatorOutcome],
) -> None:
    numerator_total = Decimal(0)
    for entry in registry:
        outcome = indicators[entry.key]
        files = outcomes_by_key.get(entry.key, [])
        if outcome.numerator_krw is not None:
            numerator_total += outcome.numerator_krw
        report.municipalities.append(
            {
                "municipality_key": entry.key,
                "display_name": entry.definition.display_name,
                "metropolitan_code": entry.definition.metropolitan_code,
                "population": entry.population,
                "population_method": entry.definition.population_method,
                "status": outcome.status,
                "value": None if outcome.value is None else str(outcome.value),
                "numerator_krw": (
                    None if outcome.numerator_krw is None else str(outcome.numerator_krw)
                ),
                "eligible_contract_count": outcome.contract_count,
                "reason_codes": outcome.reason_codes,
                "source_file_count": len(files),
                "has_data_a": any(item.discovered.dataset_role == DATASET_ROLE_A for item in files),
                "has_data_b": any(item.discovered.dataset_role == DATASET_ROLE_B for item in files),
            }
        )
    report.indicator_counts = dict(Counter(indicators[entry.key].status for entry in registry))
    for status in (STATUS_AVAILABLE, STATUS_PARTIAL, STATUS_UNAVAILABLE):
        report.indicator_counts.setdefault(status, 0)
    report.numerator_total_krw = str(numerator_total)

    accepted = [outcome for outcomes in outcomes_by_key.values() for outcome in outcomes]
    report.contract_count = sum(len(item.parsed.contracts) for item in accepted)
    report.eligible_contract_count = sum(item.parsed.eligible_contract_count for item in accepted)
    for key in sorted(outcomes_by_key):
        for item in outcomes_by_key[key]:
            for contract in item.parsed.contracts:
                if contract.accounting_basis in NUMERATOR_ELIGIBLE_BASES:
                    continue
                report.non_collection_transport_contracts.append(
                    {
                        "municipality_key": key,
                        "relative_path": item.discovered.relative_path,
                        "source_row": contract.source_row,
                        "contract_name": contract.contract_name,
                        "accounting_basis": contract.accounting_basis,
                        "payment_amount_krw": (
                            None
                            if contract.payment_amount_krw is None
                            else str(contract.payment_amount_krw)
                        ),
                        "payment_type": contract.payment_type,
                        "is_primary_numerator_eligible": contract.is_primary_numerator_eligible,
                    }
                )
    for entry in registry:
        for limitation in find_reviewed_limitations(
            entry.definition.metropolitan_code, entry.definition.display_name, REFERENCE_YEAR
        ):
            report.reviewed_limitations.append(
                {
                    "municipality_key": entry.key,
                    "reason_code": limitation.reason,
                    "evidence": limitation.evidence,
                    "omission_basis": limitation.omission_basis,
                    "applied": limitation.reason in indicators[entry.key].reason_codes,
                    "status": indicators[entry.key].status,
                }
            )
    report.quantity_count = sum(len(item.parsed.quantities) for item in accepted)
    repeated_files = 0
    repeated_quantities = 0
    for item in accepted:
        count = sum(
            1
            for quantity in item.parsed.quantities
            if quantity.attribution == "MUNICIPAL_TOTAL_REPEATED_PER_CONTRACT"
        )
        if count:
            repeated_files += 1
            repeated_quantities += count
    report.repeated_block_files = repeated_files
    report.repeated_block_quantities = repeated_quantities


# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------


def _write_all(
    session: Session,
    report: MunicipalCostReport,
    registry: Sequence[RegistryEntry],
    outcomes: Sequence[_FileOutcome],
    indicators: dict[str, IndicatorOutcome],
) -> None:
    """One transaction for the registry, every workbook, and every indicator row."""

    now = _utcnow()
    run = IngestionRun(
        source_id=SOURCE_ID,
        started_at=now,
        status="RUNNING",
        rows_received=len(outcomes),
        rows_inserted=0,
        rows_updated=0,
        rows_rejected=report.rejected_count,
        reference_period=str(report.reference_year),
        transformation_version=TRANSFORMATION_VERSION,
    )
    counters: Counter[str] = Counter()
    try:
        session.add(run)
        session.flush()
        report.ingestion_run_id = int(run.run_id)

        geography_ids = _upsert_registry(session, registry, now, counters)
        _upsert_source_files(session, outcomes, geography_ids, run, now, counters)
        _upsert_indicators(session, registry, indicators, geography_ids, run, now, counters)

        inserted = sum(value for key, value in counters.items() if key.endswith("_inserted"))
        updated = sum(value for key, value in counters.items() if key.endswith("_updated"))
        run.status = "SUCCEEDED"
        run.completed_at = _utcnow()
        run.rows_inserted = inserted
        run.rows_updated = updated

        freshness = session.get(DatasetFreshness, SOURCE_ID)
        if freshness is None:
            freshness = DatasetFreshness(source_id=SOURCE_ID)
            session.add(freshness)
        freshness.latest_reference_period = str(report.reference_year)
        freshness.last_checked_at = run.completed_at
        freshness.last_success_at = run.completed_at
        freshness.freshness_status = "FRESH"
        session.commit()
    except Exception as exc:
        session.rollback()
        run = IngestionRun(
            source_id=SOURCE_ID,
            started_at=now,
            completed_at=_utcnow(),
            status="FAILED",
            rows_received=len(outcomes),
            rows_inserted=0,
            rows_updated=0,
            rows_rejected=report.rejected_count,
            reference_period=str(report.reference_year),
            transformation_version=TRANSFORMATION_VERSION,
            error_category=type(exc).__name__,
            error_message=str(exc)[:2000],
        )
        session.add(run)
        session.commit()
        report.status = "FAILED"
        report.warnings.append(f"ingestion failed and was rolled back: {exc}")
        raise

    report.writes = dict(sorted(counters.items()))
    report.idempotent_no_op = all(
        value == 0 for key, value in counters.items() if not key.endswith("_unchanged")
    )


def _assign(target: Any, values: dict[str, Any]) -> bool:
    """Assign only the fields that actually differ; report whether any did.

    Keeping this comparison exact is what makes a re-run a true no-op: an
    unchanged row is never rewritten, so its ``updated_at`` never moves.
    """

    changed = False
    for name, value in values.items():
        if getattr(target, name) != value:
            setattr(target, name, value)
            changed = True
    return changed


def _upsert_registry(
    session: Session,
    registry: Sequence[RegistryEntry],
    now: datetime.datetime,
    counters: Counter[str],
) -> dict[str, int]:
    existing = {
        row.municipality_key: row
        for row in session.scalars(
            select(MunicipalCostGeography).where(
                MunicipalCostGeography.reference_year == REFERENCE_YEAR
            )
        )
    }
    geography_ids: dict[str, int] = {}
    for entry in registry:
        values: dict[str, Any] = {
            "display_name": entry.definition.display_name,
            "metropolitan_code": entry.definition.metropolitan_code,
            "metropolitan_name": entry.definition.metropolitan_name,
            "municipality_level": MUNICIPALITY_LEVEL_SIGUNGU,
            "boundary_vintage": BOUNDARY_VINTAGE,
            "direct_region_id": entry.direct_region_id,
            "direct_region_code": entry.direct_region_code,
            "population_method": entry.definition.population_method,
            "population_definition": (
                POPULATION_DEFINITION_SGIS if entry.status == STATUS_AVAILABLE else None
            ),
            "population": entry.population,
            "evidence_status": entry.evidence_status,
            "status": entry.status,
            "reason_codes": order_reasons(entry.reasons),
        }
        row = existing.get(entry.key)
        if row is None:
            row = MunicipalCostGeography(
                municipality_key=entry.key,
                reference_year=REFERENCE_YEAR,
                created_at=now,
                updated_at=now,
                **values,
            )
            session.add(row)
            session.flush()
            counters["geographies_inserted"] += 1
        elif _assign(row, values):
            row.updated_at = now
            counters["geographies_updated"] += 1
        else:
            counters["geographies_unchanged"] += 1
        geography_ids[entry.key] = int(row.id)
        _upsert_components(session, entry, int(row.id), counters)
    return geography_ids


def _upsert_components(
    session: Session, entry: RegistryEntry, geography_id: int, counters: Counter[str]
) -> None:
    existing = {
        row.component_region_id: row
        for row in session.scalars(
            select(MunicipalCostGeographyComponent).where(
                MunicipalCostGeographyComponent.geography_id == geography_id
            )
        )
    }
    wanted = {component.region_id: component for component in entry.components}
    for region_id, component in wanted.items():
        values = {
            "component_region_code": component.region_code,
            "component_region_name": component.region_name,
            "component_population": component.population,
            "reference_year": REFERENCE_YEAR,
            "population_definition": POPULATION_DEFINITION_SGIS,
        }
        row = existing.get(region_id)
        if row is None:
            session.add(
                MunicipalCostGeographyComponent(
                    geography_id=geography_id, component_region_id=region_id, **values
                )
            )
            counters["components_inserted"] += 1
        elif _assign(row, values):
            counters["components_updated"] += 1
        else:
            counters["components_unchanged"] += 1
    for region_id, row in existing.items():
        if region_id not in wanted:
            session.delete(row)
            counters["components_deleted"] += 1


def _upsert_source_files(
    session: Session,
    outcomes: Sequence[_FileOutcome],
    geography_ids: dict[str, int],
    run: IngestionRun,
    now: datetime.datetime,
    counters: Counter[str],
) -> None:
    existing = {
        row.sha256: row
        for row in session.scalars(
            select(MunicipalCostSourceFile).where(
                MunicipalCostSourceFile.reference_year == REFERENCE_YEAR
            )
        )
    }
    for outcome in outcomes:
        discovered, parsed, resolution = outcome.discovered, outcome.parsed, outcome.resolution
        geography_id = (
            geography_ids.get(resolution.geography_key) if resolution.geography_key else None
        )
        if resolution.decision == INGESTION_DECISION_REJECTED:
            geography_id = None
        values: dict[str, Any] = {
            "relative_path": discovered.relative_path,
            "filename": discovered.filename,
            "file_size_bytes": discovered.size_bytes,
            "dataset_role": discovered.dataset_role,
            "region_folder": discovered.region_folder,
            "workbook_sheet": parsed.sheet_name,
            "used_range": parsed.used_range,
            "layout_family": parsed.layout_family,
            "source_municipality_name": (
                parsed.source_municipality_names[0][:120]
                if parsed.source_municipality_names
                else None
            ),
            "resolved_geography_id": geography_id,
            "resolution_basis": resolution.resolution_basis,
            "resolution_evidence": resolution.resolution_evidence,
            "boundary_vintage": BOUNDARY_VINTAGE,
            "primary_classification": (
                resolution.classification_override or parsed.primary_classification
            ),
            "ingestion_decision": resolution.decision,
            "rejection_reasons": order_reasons(resolution.reasons)
            if resolution.decision == INGESTION_DECISION_REJECTED
            else [],
            "source_notes": parsed.source_notes,
        }
        row = existing.get(discovered.sha256)
        if row is None:
            row = MunicipalCostSourceFile(
                sha256=discovered.sha256,
                reference_year=REFERENCE_YEAR,
                ingestion_run_id=run.run_id,
                transformation_version=TRANSFORMATION_VERSION,
                imported_at=now,
                **values,
            )
            session.add(row)
            session.flush()
            counters["source_files_inserted"] += 1
            _replace_observations(session, row, outcome, geography_id, run, now, counters)
            continue
        if _assign(row, values):
            row.ingestion_run_id = run.run_id
            row.transformation_version = TRANSFORMATION_VERSION
            row.imported_at = now
            counters["source_files_updated"] += 1
            _replace_observations(session, row, outcome, geography_id, run, now, counters)
        else:
            counters["source_files_unchanged"] += 1
            # Identical bytes and identical derived metadata: the children were
            # written by the earlier run from the same parse and are left exactly
            # as they are (no delete, no reinsert, no timestamp movement).
            counters["observations_unchanged"] += _count_observations(session, int(row.id))


def _count_observations(session: Session, source_file_id: int) -> int:
    contracts = session.scalars(
        select(MunicipalWasteContract.id).where(
            MunicipalWasteContract.source_file_id == source_file_id
        )
    ).all()
    quantities = session.scalars(
        select(MunicipalWasteQuantity.id).where(
            MunicipalWasteQuantity.source_file_id == source_file_id
        )
    ).all()
    return len(contracts) + len(quantities)


def _replace_observations(
    session: Session,
    source_file: MunicipalCostSourceFile,
    outcome: _FileOutcome,
    geography_id: int | None,
    run: IngestionRun,
    now: datetime.datetime,
    counters: Counter[str],
) -> None:
    """Delete-and-reinsert this file's children inside the run's transaction.

    A rejected workbook keeps its ``municipal_cost_source_files`` row and its
    rejection reasons but contributes no contract and no quantity.
    """

    for stored_quantity in session.scalars(
        select(MunicipalWasteQuantity).where(
            MunicipalWasteQuantity.source_file_id == source_file.id
        )
    ):
        session.delete(stored_quantity)
        counters["quantities_deleted"] += 1
    for stored_contract in session.scalars(
        select(MunicipalWasteContract).where(
            MunicipalWasteContract.source_file_id == source_file.id
        )
    ):
        session.delete(stored_contract)
        counters["contracts_deleted"] += 1
    session.flush()

    if geography_id is None or outcome.resolution.decision != INGESTION_DECISION_ACCEPTED:
        return

    parsed = outcome.parsed
    contract_ids: list[int] = []
    for contract in parsed.contracts:
        contract_row = MunicipalWasteContract(
            source_file_id=source_file.id,
            geography_id=geography_id,
            source_row=contract.source_row,
            source_row_end=contract.source_row_end,
            reference_year=REFERENCE_YEAR,
            source_period_label=contract.source_period_label,
            contract_name=contract.contract_name,
            contractor_name=contract.contractor_name,
            payment_type=contract.payment_type,
            payment_amount_krw=contract.payment_amount_krw,
            currency=CURRENCY_KRW,
            payment_source_text=contract.payment_source_text,
            is_primary_numerator_eligible=contract.is_primary_numerator_eligible,
            payment_period_start=contract.payment_period_start,
            payment_period_end=contract.payment_period_end,
            waste_scope=contract.waste_scope,
            geographic_scope=contract.geographic_scope,
            destination_names=list(contract.destination_names),
            treatment_methods=list(contract.treatment_methods),
            evidence_status=EVIDENCE_LOCAL_GOVERNMENT_REPORTED,
            completeness_status=contract.completeness_status,
            limitation_reasons=order_reasons(contract.limitation_reasons),
            source_note=contract.source_note,
            ingestion_run_id=run.run_id,
            transformation_version=TRANSFORMATION_VERSION,
            imported_at=now,
        )
        session.add(contract_row)
        session.flush()
        contract_ids.append(int(contract_row.id))
        counters["contracts_inserted"] += 1

    for parsed_quantity in parsed.quantities:
        index = parsed_quantity.contract_index
        contract_id = (
            contract_ids[index] if index is not None and index < len(contract_ids) else None
        )
        session.add(
            MunicipalWasteQuantity(
                source_file_id=source_file.id,
                contract_id=contract_id,
                geography_id=geography_id,
                source_row=parsed_quantity.source_row,
                source_column=parsed_quantity.source_column,
                source_label=parsed_quantity.source_label,
                source_repetition_rows=list(parsed_quantity.source_repetition_rows),
                reference_year=REFERENCE_YEAR,
                reference_month=parsed_quantity.reference_month,
                quantity_period=parsed_quantity.quantity_period,
                waste_category=parsed_quantity.waste_category,
                destination_name=parsed_quantity.destination_name,
                treatment_method=parsed_quantity.treatment_method,
                quantity_value=parsed_quantity.quantity_value,
                quantity_unit=QUANTITY_UNIT_TONNE,
                value_state=parsed_quantity.value_state,
                attribution=parsed_quantity.attribution,
                evidence_status=EVIDENCE_LOCAL_GOVERNMENT_REPORTED,
                limitation_reasons=order_reasons(parsed_quantity.limitation_reasons),
                ingestion_run_id=run.run_id,
                transformation_version=TRANSFORMATION_VERSION,
                imported_at=now,
            )
        )
        counters["quantities_inserted"] += 1


def _upsert_indicators(
    session: Session,
    registry: Sequence[RegistryEntry],
    indicators: dict[str, IndicatorOutcome],
    geography_ids: dict[str, int],
    run: IngestionRun,
    now: datetime.datetime,
    counters: Counter[str],
) -> None:
    existing = {
        row.geography_id: row
        for row in session.scalars(
            select(MunicipalCostIndicatorValue)
            .where(MunicipalCostIndicatorValue.reference_year == REFERENCE_YEAR)
            .where(
                MunicipalCostIndicatorValue.indicator_code
                == MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA
            )
            .where(MunicipalCostIndicatorValue.methodology_version == METHODOLOGY_VERSION)
        )
    }
    for entry in registry:
        outcome = indicators[entry.key]
        geography_id = geography_ids[entry.key]
        values: dict[str, Any] = {
            "value": outcome.value,
            "unit": INDICATOR_UNIT,
            "numerator_amount_krw": outcome.numerator_krw,
            "denominator_population": outcome.denominator_population,
            "numerator_contract_count": outcome.contract_count,
            "population_method": entry.definition.population_method,
            "population_definition": (
                POPULATION_DEFINITION_SGIS if outcome.denominator_population else None
            ),
            "evidence_status": (
                EVIDENCE_LOCAL_GOVERNMENT_DERIVED
                if outcome.value is not None
                else _unavailable_evidence(entry)
            ),
            "status": outcome.status,
            "reason_codes": outcome.reason_codes,
            "limitations": describe_reasons(outcome.reason_codes),
        }
        row = existing.get(geography_id)
        if row is None:
            session.add(
                MunicipalCostIndicatorValue(
                    geography_id=geography_id,
                    reference_year=REFERENCE_YEAR,
                    indicator_code=MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA,
                    methodology_version=METHODOLOGY_VERSION,
                    ingestion_run_id=run.run_id,
                    computed_at=now,
                    **values,
                )
            )
            counters["indicator_values_inserted"] += 1
        elif _assign(row, values):
            row.ingestion_run_id = run.run_id
            row.computed_at = now
            counters["indicator_values_updated"] += 1
        else:
            counters["indicator_values_unchanged"] += 1


def _unavailable_evidence(entry: RegistryEntry) -> str:
    """Evidence class of a row that carries no value.

    A derived-population geography is an official-inputs derivation even when the
    indicator itself cannot be served.
    """

    return (
        EVIDENCE_OFFICIAL_DERIVED
        if entry.definition.population_method == POPULATION_DERIVED_WARD_SUM
        else EVIDENCE_LOCAL_GOVERNMENT_DERIVED
    )


__all__ = [
    "DEFAULT_SOURCE_DIR",
    "DiscoveredFile",
    "MunicipalCostReport",
    "RegistryEntry",
    "Resolution",
    "build_registry",
    "detect_duplicate_series",
    "discover_files",
    "normalize_organisation_name",
    "resolve_file",
    "run_municipal_cost_ingestion",
]
