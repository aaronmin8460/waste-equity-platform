"""Lane C contract QA for ``GET /api/v1/landfill/municipal-costs``.

This suite is deliberately about the *stable HTTP contract*, not about how the
indicator is computed. It never re-derives a numerator, never re-applies an
accounting-eligibility rule, and never asserts a provisional result count
(``45``/``32``/…) — those are ingestion semantics and they are being revised.
What it pins are the properties a consumer is entitled to rely on whatever the
loader decides:

* the analytical geography is exactly the reviewed 25 / 10 / 31 = 66, and a
  post-2024 Incheon unit never appears in the published year;
* an absent number is ``null`` and never ``0``, even when a source workbook for
  that municipality exists;
* nulls sort last where the contract promises it, and an identical request
  serves an identical ordering;
* a status filter narrows the rows but never the scope denominators;
* a reason code always arrives with its machine-readable partner data;
* the payload states, under every filter and sort, that it is **not** the
  official Sudokwon Landfill inbound fee;
* nothing serializes a private source path.

Seeding is shared with :mod:`tests.test_municipal_cost_routes` so there is one
synthetic fixture rather than two that can drift. All values are SYNTHETIC.
"""

from __future__ import annotations

import json
import unicodedata
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_municipal_cost_routes import (
    ENDPOINT,
    NOW,
    _seed,
    _seed_quantities,
    _seed_sources,
    get,
)
from waste_equity_backend.analysis.municipal_cost import (
    EXPECTED_COUNT_BY_METROPOLITAN,
    EXPECTED_MUNICIPALITY_COUNT,
    METROPOLITAN_CODES,
    METROPOLITAN_GYEONGGI,
    METROPOLITAN_INCHEON,
    METROPOLITAN_SEOUL,
    MUNICIPALITIES_BY_KEY,
    POST_2024_INCHEON_UNITS,
    REASON_LABELS_KO,
    describe_reasons,
    nfc,
)
from waste_equity_backend.api.app import create_app
from waste_equity_backend.api.routes import municipal_costs as municipal_cost_routes
from waste_equity_backend.models import (
    MunicipalCostGeography,
    MunicipalCostIndicatorValue,
    MunicipalCostSourceFile,
)
from waste_equity_backend.models.landfill_inbound import (
    ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW,
)
from waste_equity_backend.models.municipal_cost import (
    ACCOUNTING_BASIS_MUNICIPAL_CONTRACT_PAYMENT,
    BOUNDARY_VINTAGE,
    EVIDENCE_OFFICIAL_DERIVED,
    INDICATOR_UNIT,
    METHODOLOGY_VERSION,
    MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA,
    MUNICIPALITY_LEVEL_SIGUNGU,
    POPULATION_DERIVED_WARD_SUM,
    REASON_CODES,
    REASON_MISSING_PAYMENT,
    REASON_MISSING_POPULATION,
    STATUS_AVAILABLE,
    STATUS_PARTIAL,
    STATUS_UNAVAILABLE,
)
from waste_equity_backend.schemas.municipal_cost import (
    MunicipalCostQuantityCoverage,
    MunicipalCostRow,
)

STATUSES = (STATUS_AVAILABLE, STATUS_PARTIAL, STATUS_UNAVAILABLE)
SORTS = ("payment_per_capita_desc", "total_payment_desc", "region_name_asc")
VALUE_SORTS = (
    ("payment_per_capita_desc", "payment_per_capita_krw"),
    ("total_payment_desc", "total_eligible_payment_krw"),
)
# Every filter combination a consumer can ask for, including the unfiltered one.
FILTER_COMBINATIONS: list[dict[str, str]] = [
    {key: value for key, value in (("sido", sido), ("status", status)) if value is not None}
    for sido in (None, *METROPOLITAN_CODES)
    for status in (None, *STATUSES)
]
# Money fields that must never be served as a bare JSON number, and never as 0
# when the municipality has no defensible value.
MONEY_FIELDS = ("total_eligible_payment_krw", "payment_per_capita_krw")
OFFICIAL_LANDFILL_PATHS = ("/summary", "/trends", "/composition", "/flows")


@pytest.fixture
def seeded(session: Session) -> dict[str, int]:
    """The shared synthetic fixture: all 66 registry rows, sources, quantities."""

    keys = _seed(session)
    _seed_sources(session, keys)
    _seed_quantities(session, keys)
    return keys


def _geography(**overrides: Any) -> MunicipalCostGeography:
    """A minimal registry row. Defaults satisfy every table CHECK constraint.

    ``DERIVED_SUM_OF_CONSTITUENT_WARDS`` with a NULL ``direct_region_id`` is used
    so the row needs no ``regions`` parent, which keeps these tests independent
    of the geometry-free ``regions`` shim.
    """

    defaults: dict[str, Any] = {
        "municipality_key": "11-종로구",
        "display_name": "종로구",
        "metropolitan_code": METROPOLITAN_SEOUL,
        "metropolitan_name": "서울특별시",
        "municipality_level": MUNICIPALITY_LEVEL_SIGUNGU,
        "boundary_vintage": BOUNDARY_VINTAGE,
        "direct_region_id": None,
        "direct_region_code": None,
        "population_method": POPULATION_DERIVED_WARD_SUM,
        "population_definition": None,
        "reference_year": 2024,
        # A geography with no usable denominator is UNAVAILABLE with a NULL
        # population — the CHECK constraint forbids storing 0 here.
        "population": None,
        "evidence_status": EVIDENCE_OFFICIAL_DERIVED,
        "status": STATUS_UNAVAILABLE,
        "reason_codes": [],
        "created_at": NOW,
        "updated_at": NOW,
    }
    return MunicipalCostGeography(**{**defaults, **overrides})


def _sortable_row(municipality_key: str, metropolitan_code: str) -> MunicipalCostRow:
    """An UNAVAILABLE serialized row, for exercising the ordering key directly.

    Both money fields are ``None`` and the display name is shared, so two of these
    tie on everything the value sorts look at except ``municipality_key``.
    """

    return MunicipalCostRow(
        municipality_key=municipality_key,
        display_name="중구",
        metropolitan_code=metropolitan_code,
        metropolitan_name="",
        direct_region_code=None,
        boundary_vintage=BOUNDARY_VINTAGE,
        population=None,
        population_method=POPULATION_DERIVED_WARD_SUM,
        population_definition=None,
        population_components=[],
        total_eligible_payment_krw=None,
        eligible_contract_count=0,
        payment_per_capita_krw=None,
        status=STATUS_UNAVAILABLE,
        evidence_status=EVIDENCE_OFFICIAL_DERIVED,
        reason_codes=[],
        limitations=[],
        source_files=[],
        has_data_a=False,
        has_data_b=False,
        quantity_coverage=MunicipalCostQuantityCoverage(
            observation_count=0,
            measured_count=0,
            measured_zero_count=0,
            missing_count=0,
            repeated_municipal_block_count=0,
            months_covered=0,
            waste_categories=[],
        ),
    )


def _rows_and_meta(
    client: TestClient, **params: Any
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    payload = get(client, **params)
    return payload["municipalities"], payload["meta"]


def _by_name(client: TestClient, **params: Any) -> dict[str, dict[str, Any]]:
    return {row["display_name"]: row for row in get(client, **params)["municipalities"]}


# ---------------------------------------------------------------------------
# 1. Analytical geography — exactly 25 / 10 / 31, of the published vintage
# ---------------------------------------------------------------------------


def test_served_keys_are_exactly_the_reviewed_2024_registry(
    client: TestClient, seeded: dict[str, int]
) -> None:
    """Not "66 rows" but "*these* 66 rows" — a count alone would admit a swap."""

    served = {row["municipality_key"] for row in get(client)["municipalities"]}
    assert served == set(MUNICIPALITIES_BY_KEY)


@pytest.mark.parametrize(
    ("sido", "expected"),
    [(METROPOLITAN_SEOUL, 25), (METROPOLITAN_INCHEON, 10), (METROPOLITAN_GYEONGGI, 31)],
)
def test_metropolitan_scope_is_25_10_31(
    client: TestClient, seeded: dict[str, int], sido: str, expected: int
) -> None:
    rows, meta = _rows_and_meta(client, sido=sido)
    assert EXPECTED_COUNT_BY_METROPOLITAN[sido] == expected
    assert meta["expected_count"] == expected
    assert len(rows) == expected
    assert {row["metropolitan_code"] for row in rows} == {sido}


def test_the_three_metropolitan_scopes_partition_the_66(
    client: TestClient, seeded: dict[str, int]
) -> None:
    """25 + 10 + 31 with no municipality counted twice and none left out."""

    full = {row["municipality_key"] for row in get(client)["municipalities"]}
    per_sido = {
        sido: {row["municipality_key"] for row in get(client, sido=sido)["municipalities"]}
        for sido in METROPOLITAN_CODES
    }
    assert sum(len(keys) for keys in per_sido.values()) == EXPECTED_MUNICIPALITY_COUNT
    assert set().union(*per_sido.values()) == full
    for left in METROPOLITAN_CODES:
        for right in METROPOLITAN_CODES:
            if left != right:
                assert per_sido[left].isdisjoint(per_sido[right])


@pytest.mark.parametrize("unit", POST_2024_INCHEON_UNITS)
def test_a_post_2024_incheon_unit_is_never_served_for_2024(
    client: TestClient, session: Session, seeded: dict[str, int], unit: str
) -> None:
    """A 2026 Incheon district stored against 2024 must not reach a consumer.

    Seeded straight into the registry table, which is what a defective loader
    would do — the response must still be the reviewed 2024 geography. Asserting
    only over correctly-loaded data would make this vacuous.
    """

    session.add(
        _geography(
            municipality_key=f"{METROPOLITAN_INCHEON}-{unit}",
            display_name=unit,
            metropolitan_code=METROPOLITAN_INCHEON,
            metropolitan_name="인천광역시",
        )
    )
    session.commit()

    rows, meta = _rows_and_meta(client)
    assert unit not in {row["display_name"] for row in rows}
    assert {row["municipality_key"] for row in rows} == set(MUNICIPALITIES_BY_KEY)
    assert len(rows) == meta["expected_count"] == EXPECTED_MUNICIPALITY_COUNT

    incheon, incheon_meta = _rows_and_meta(client, sido=METROPOLITAN_INCHEON)
    assert unit not in {row["display_name"] for row in incheon}
    assert len(incheon) == incheon_meta["expected_count"] == 10
    # The rogue row must not be laundered into a status tally either.
    assert (
        incheon_meta["available_count"]
        + incheon_meta["partial_count"]
        + incheon_meta["unavailable_count"]
        == 10
    )


def test_a_registry_key_stored_in_nfd_is_still_served(client: TestClient, session: Session) -> None:
    """The scope guard must not mistake a decomposed Korean key for out-of-scope.

    macOS hands Korean text back in NFD. A byte comparison against the NFC
    registry would fail to match *every* Korean municipality and blank the whole
    response — a far worse failure than the one the guard exists to prevent.
    """

    key = "11-종로구"
    decomposed = unicodedata.normalize("NFD", key)
    assert decomposed != key, "the test is meaningless if the two forms already match"

    session.add(_geography(municipality_key=decomposed))
    session.commit()

    rows = get(client)["municipalities"]
    assert len(rows) == 1
    assert nfc(rows[0]["municipality_key"]) == key


def test_boundary_vintage_matches_the_requested_year(
    client: TestClient, seeded: dict[str, int]
) -> None:
    rows, meta = _rows_and_meta(client, year=2024)
    assert meta["reference_year"] == 2024
    assert {row["boundary_vintage"] for row in rows} == {"2024"}


# ---------------------------------------------------------------------------
# 2. Absence is null, never zero
# ---------------------------------------------------------------------------


def test_no_money_field_is_ever_served_as_a_json_number(
    client: TestClient, seeded: dict[str, int]
) -> None:
    """Exact decimals stay strings end to end — a JSON number would be a float.

    Parsed with ``parse_float=Decimal`` so a float slipping through surfaces as a
    ``Decimal`` here instead of silently comparing equal to a string after
    coercion.
    """

    payload = json.loads(client.get(ENDPOINT).text, parse_float=Decimal)
    for row in payload["municipalities"]:
        for field in MONEY_FIELDS:
            value = row[field]
            assert value is None or isinstance(value, str), (row["display_name"], field, value)
            if isinstance(value, str):
                # No exponent form: "1E+2" is a legal Decimal string but is not a
                # money amount any consumer should have to normalize.
                assert "e" not in value.lower()
                Decimal(value)  # raises if it is not an exact decimal literal


def test_an_unavailable_row_serves_null_for_every_number_it_cannot_defend(
    client: TestClient, seeded: dict[str, int]
) -> None:
    rows = [row for row in get(client)["municipalities"] if row["status"] == STATUS_UNAVAILABLE]
    assert rows, "the fixture must contain at least one unavailable municipality"
    for row in rows:
        for field in MONEY_FIELDS:
            assert row[field] is None, (row["display_name"], field)
            # Belt and braces: a "0"/"0.00" string is not an acceptable stand-in
            # for absence either.
            assert row[field] not in ("0", "0.0", "0.00", "0.0000")
        assert row["reason_codes"], row["display_name"]


def test_an_accepted_source_file_alone_does_not_manufacture_a_zero(
    client: TestClient, seeded: dict[str, int]
) -> None:
    """A workbook exists for 종로구, yet no eligible numerator does.

    The row must still carry its provenance — so a reader can see the file was
    read — while every money field stays null. "We have the file" is not the same
    claim as "the municipality paid 0".
    """

    row = _by_name(client)["종로구"]
    assert row["source_files"], "the fixture must give 종로구 an accepted workbook"
    assert row["has_data_b"] is True
    assert row["status"] == STATUS_UNAVAILABLE
    assert row["total_eligible_payment_krw"] is None
    assert row["payment_per_capita_krw"] is None
    assert row["eligible_contract_count"] == 0
    assert REASON_MISSING_PAYMENT in row["reason_codes"]


def test_a_missing_population_is_null_and_not_zero(client: TestClient, session: Session) -> None:
    """The denominator follows the same rule as the numerator."""

    session.add(
        _geography(
            municipality_key="41-과천시",
            display_name="과천시",
            metropolitan_code=METROPOLITAN_GYEONGGI,
            metropolitan_name="경기도",
            population=None,
            reason_codes=[REASON_MISSING_POPULATION],
        )
    )
    session.commit()

    (row,) = get(client)["municipalities"]
    assert row["population"] is None
    assert row["population_definition"] is None
    assert row["population_components"] == []
    assert row["payment_per_capita_krw"] is None
    assert REASON_MISSING_POPULATION in row["reason_codes"]


def test_a_registry_row_with_no_indicator_row_is_served_as_unavailable(
    client: TestClient, session: Session, seeded: dict[str, int]
) -> None:
    """A half-loaded municipality degrades to null, not to a fabricated 0.

    Partial ingestion is a real state — the indicator table is written after the
    registry — so the route's "no indicator row" branch has to be exercised.
    """

    session.execute(
        delete(MunicipalCostIndicatorValue).where(
            MunicipalCostIndicatorValue.geography_id == seeded["광명시"]
        )
    )
    session.commit()

    rows, meta = _rows_and_meta(client)
    row = {r["display_name"]: r for r in rows}["광명시"]
    assert row["status"] == STATUS_UNAVAILABLE
    assert row["total_eligible_payment_krw"] is None
    assert row["payment_per_capita_krw"] is None
    assert row["eligible_contract_count"] == 0
    # The scope is unchanged: the municipality is still one of the 66.
    assert len(rows) == meta["expected_count"] == EXPECTED_MUNICIPALITY_COUNT


# ---------------------------------------------------------------------------
# 3. Reason codes stay machine-readable and paired with their explanation
# ---------------------------------------------------------------------------


def test_every_reason_code_in_the_vocabulary_has_a_plain_korean_label() -> None:
    """The alignment guarantee below is only true while this holds.

    ``describe_reasons`` drops a code it cannot label, which shortens the served
    ``limitations`` list and silently shifts every later sentence onto the wrong
    code — the frontend pairs the two arrays *positionally*. A new reason code
    added without a label would therefore mislabel a municipality's limitation
    rather than merely omit it, so the vocabulary is pinned here.
    """

    assert [code for code in REASON_CODES if code not in REASON_LABELS_KO] == []
    assert describe_reasons(list(REASON_CODES)) == [REASON_LABELS_KO[c] for c in REASON_CODES]


@pytest.mark.parametrize("params", FILTER_COMBINATIONS, ids=str)
def test_limitations_stay_positionally_aligned_with_reason_codes(
    client: TestClient, seeded: dict[str, int], params: dict[str, str]
) -> None:
    for row in get(client, **params)["municipalities"]:
        assert len(row["limitations"]) == len(row["reason_codes"]), row["display_name"]
        for sentence in row["limitations"]:
            assert isinstance(sentence, str) and sentence.strip()


def test_a_partial_row_keeps_both_its_code_and_its_sentence(
    client: TestClient, seeded: dict[str, int]
) -> None:
    """PARTIAL is a value *with* a caveat — the caveat has to survive the wire."""

    rows = get(client, status=STATUS_PARTIAL)["municipalities"]
    assert rows, "the fixture must contain at least one PARTIAL municipality"
    for row in rows:
        assert row["payment_per_capita_krw"] is not None
        assert row["reason_codes"], row["display_name"]
        assert row["limitations"], row["display_name"]
        # The raw codes stay machine-readable: a consumer can branch on them
        # without parsing Korean prose.
        assert all(code == code.upper() for code in row["reason_codes"])


def test_reason_data_is_identical_whether_or_not_a_status_filter_is_applied(
    client: TestClient, seeded: dict[str, int]
) -> None:
    unfiltered = {row["municipality_key"]: row for row in get(client)["municipalities"]}
    for status in STATUSES:
        for row in get(client, status=status)["municipalities"]:
            reference = unfiltered[row["municipality_key"]]
            assert row["reason_codes"] == reference["reason_codes"]
            assert row["limitations"] == reference["limitations"]
            assert row["evidence_status"] == reference["evidence_status"]


# ---------------------------------------------------------------------------
# 4. Sorting — nulls last, and stable
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(("sort", "field"), VALUE_SORTS)
def test_a_value_sort_puts_nulls_last(
    client: TestClient, seeded: dict[str, int], sort: str, field: str
) -> None:
    values = [row[field] for row in get(client, sort=sort)["municipalities"]]
    valued = [Decimal(value) for value in values if value is not None]
    assert valued, "the fixture must contain at least one valued municipality"
    assert values[len(valued) :] == [None] * (len(values) - len(valued))
    assert valued == sorted(valued, reverse=True)


@pytest.mark.parametrize("sort", SORTS)
def test_an_identical_request_serves_an_identical_ordering(
    client: TestClient, seeded: dict[str, int], sort: str
) -> None:
    """Dozens of rows tie on a null value; the order must not be luck of the DB.

    Without a unique final tiebreak the tied rows fall back to whatever order a
    SELECT with no ORDER BY happened to return, so two identical requests could
    serve two different orderings of the same data.
    """

    first = [row["municipality_key"] for row in get(client, sort=sort)["municipalities"]]
    second = [row["municipality_key"] for row in get(client, sort=sort)["municipalities"]]
    assert first == second
    assert len(set(first)) == len(first)


@pytest.mark.parametrize(("sort", "field"), VALUE_SORTS)
def test_a_value_sort_breaks_ties_on_the_municipality_key(
    client: TestClient, seeded: dict[str, int], sort: str, field: str
) -> None:
    """The ordering is total, so the tied rows have one defined arrangement.

    Most municipalities share the same null value, and 서울 중구 / 인천 중구 share a
    display name on top of that — so value-plus-name leaves genuine ties. Anything
    the route does not order explicitly is left to the order the database happened
    to return, which is not a contract. The served order is compared against the
    documented key, ``municipality_key`` last.
    """

    rows = get(client, sort=sort)["municipalities"]

    def ordering_key(row: dict[str, Any]) -> tuple[bool, Decimal, str, str]:
        value = row[field]
        return (
            value is None,
            -Decimal(value if value is not None else 0),
            row["display_name"],
            row["municipality_key"],
        )

    partial_keys = [ordering_key(row)[:3] for row in rows]
    assert any(partial_keys.count(key) > 1 for key in partial_keys), (
        "the fixture must leave a genuine tie for this assertion to be meaningful"
    )
    assert rows == sorted(rows, key=ordering_key)
    assert len({row["municipality_key"] for row in rows}) == len(rows)


@pytest.mark.parametrize("sort", [sort for sort, _ in VALUE_SORTS])
def test_a_value_ordering_separates_two_rows_that_tie_on_value_and_name(sort: str) -> None:
    """The tiebreak, pinned on the sort key itself rather than through HTTP.

    Over HTTP the only genuine tie the fixture produces — 서울 중구 and 인천 중구,
    both unavailable — happens to reach the sorter in registry order, which is
    already its key order, so the served payload cannot tell a total ordering
    apart from an accidental one. Here the pair is sorted in the *wrong* order,
    and neither the value nor the display name can fix it: the value sorts do not
    look at ``metropolitan_code``, so ``municipality_key`` is the only remaining
    discriminator.
    """

    seoul = _sortable_row("11-중구", METROPOLITAN_SEOUL)
    incheon = _sortable_row("28-중구", METROPOLITAN_INCHEON)
    key = municipal_cost_routes._SORTS[sort]

    assert key(seoul) != key(incheon), "the ordering must be total over these two rows"
    assert sorted([incheon, seoul], key=key) == [seoul, incheon]
    assert sorted([seoul, incheon], key=key) == [seoul, incheon]


def test_region_name_asc_orders_the_same_name_by_metropolitan() -> None:
    """중구 exists in both Seoul and Incheon; the name sort must not merge them."""

    seoul = _sortable_row("11-중구", METROPOLITAN_SEOUL)
    incheon = _sortable_row("28-중구", METROPOLITAN_INCHEON)
    key = municipal_cost_routes._SORTS["region_name_asc"]
    assert key(seoul) != key(incheon)
    assert sorted([incheon, seoul], key=key) == [seoul, incheon]


@pytest.mark.parametrize("sort", SORTS)
def test_the_requested_sort_is_echoed_back(
    client: TestClient, seeded: dict[str, int], sort: str
) -> None:
    assert get(client, sort=sort)["sort"] == sort


def test_region_name_asc_groups_by_metropolitan_then_name(
    client: TestClient, seeded: dict[str, int]
) -> None:
    rows = get(client, sort="region_name_asc")["municipalities"]
    ordered = [(row["metropolitan_code"], row["display_name"]) for row in rows]
    assert ordered == sorted(ordered)


@pytest.mark.parametrize("sort", SORTS)
def test_a_sort_reorders_the_rows_but_never_changes_the_set(
    client: TestClient, seeded: dict[str, int], sort: str
) -> None:
    assert {row["municipality_key"] for row in get(client, sort=sort)["municipalities"]} == set(
        MUNICIPALITIES_BY_KEY
    )


# ---------------------------------------------------------------------------
# 5. Filters never falsify the scope the response reports
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("params", FILTER_COMBINATIONS, ids=str)
def test_returned_count_always_equals_the_rows_served(
    client: TestClient, seeded: dict[str, int], params: dict[str, str]
) -> None:
    rows, meta = _rows_and_meta(client, **params)
    assert meta["returned_count"] == len(rows)
    if "sido" in params:
        assert {row["metropolitan_code"] for row in rows} <= {params["sido"]}
    if "status" in params:
        assert {row["status"] for row in rows} <= {params["status"]}


@pytest.mark.parametrize("sido", [None, *METROPOLITAN_CODES])
def test_a_status_filter_narrows_rows_but_never_the_scope_counts(
    client: TestClient, seeded: dict[str, int], sido: str | None
) -> None:
    """The denominators stay honest: they describe the scope, not the selection.

    Counts are compared against the same request without ``status`` rather than
    against fixed numbers, so this keeps holding when the loader's semantics
    change how many municipalities land in each bucket.
    """

    scope = {"sido": sido} if sido else {}
    _, baseline = _rows_and_meta(client, **scope)
    scope_keys = ("expected_count", "available_count", "partial_count", "unavailable_count")

    for status in STATUSES:
        rows, meta = _rows_and_meta(client, **scope, status=status)
        assert {key: meta[key] for key in scope_keys} == {key: baseline[key] for key in scope_keys}
        # …and the selection is exactly the bucket that was asked for.
        assert meta["returned_count"] == baseline[f"{status.lower()}_count"] == len(rows)


@pytest.mark.parametrize("sido", [None, *METROPOLITAN_CODES])
def test_the_status_counts_partition_the_rows_in_scope(
    client: TestClient, seeded: dict[str, int], sido: str | None
) -> None:
    rows, meta = _rows_and_meta(client, **({"sido": sido} if sido else {}))
    assert meta["available_count"] + meta["partial_count"] + meta["unavailable_count"] == len(rows)
    assert len(rows) <= meta["expected_count"]


def test_the_requested_filters_are_echoed_back(client: TestClient, seeded: dict[str, int]) -> None:
    payload = get(client, sido=METROPOLITAN_INCHEON, status=STATUS_PARTIAL)
    assert payload["sido_filter"] == METROPOLITAN_INCHEON
    assert payload["status_filter"] == STATUS_PARTIAL
    unfiltered = get(client)
    assert unfiltered["sido_filter"] is None
    assert unfiltered["status_filter"] is None


def test_an_empty_but_valid_selection_returns_no_rows_rather_than_fake_ones(
    client: TestClient, seeded: dict[str, int]
) -> None:
    """A legitimately empty bucket is data — not an error and not a filler row.

    The empty combination is discovered from the served counts instead of being
    hard-coded, so this survives a change in which municipalities have values.
    """

    empty = [
        (sido, status)
        for sido in METROPOLITAN_CODES
        for status in STATUSES
        if get(client, sido=sido)["meta"][f"{status.lower()}_count"] == 0
    ]
    assert empty, "the fixture must contain at least one empty (sido, status) bucket"

    for sido, status in empty:
        payload = get(client, sido=sido, status=status)
        assert payload["municipalities"] == []
        assert payload["meta"]["returned_count"] == 0
        # The scope it was selected from is still described truthfully.
        assert payload["meta"]["expected_count"] == EXPECTED_COUNT_BY_METROPOLITAN[sido]
        assert payload["sido_filter"] == sido
        assert payload["status_filter"] == status
        assert payload["meta"]["is_official_landfill_fee"] is False


def test_the_two_rejected_file_counts_agree(client: TestClient, seeded: dict[str, int]) -> None:
    """``meta.rejected_source_file_count`` and ``source_coverage`` are two queries."""

    meta = get(client)["meta"]
    coverage = meta["source_coverage"]
    assert meta["rejected_source_file_count"] == coverage["rejected_file_count"]
    assert len(meta["rejected_source_files"]) == meta["rejected_source_file_count"]
    assert (
        coverage["accepted_file_count"] + coverage["rejected_file_count"]
        == (coverage["discovered_file_count"])
    )


@pytest.mark.parametrize("params", FILTER_COMBINATIONS, ids=str)
def test_source_coverage_describes_the_dataset_not_the_selection(
    client: TestClient, seeded: dict[str, int], params: dict[str, str]
) -> None:
    """Pinning an intentional asymmetry so it cannot drift into a half-scoped mix.

    The scope counts (``expected_count`` and the status tallies) follow the
    ``sido`` filter; the source-coverage block does not — it describes the
    workbooks that were discovered, which is a property of the delivery and not
    of the current query. Both readings are defensible, but only one can be true
    at a time, so the contract is fixed here.
    """

    assert (
        get(client, **params)["meta"]["source_coverage"] == get(client)["meta"]["source_coverage"]
    )


# ---------------------------------------------------------------------------
# 6. Invalid input is rejected cleanly
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "params",
    [
        {"year": 2023},
        {"year": 2025},
        {"year": 0},
        {"year": "twenty-twenty-four"},
        {"year": ""},
        {"sido": "99"},
        # The canonical SGIS parent code, which is a different namespace from the
        # 11/28/41 the dashboard filters on — it must not resolve here.
        {"sido": "23"},
        {"sido": ""},
        {"sido": "11,28"},
        {"status": "MISSING"},
        {"status": "available"},  # the enum is case-sensitive
        {"status": ""},
        {"sort": "cheapest"},
        {"sort": "payment_per_capita_asc"},
        {"sort": ""},
    ],
    ids=str,
)
def test_an_invalid_parameter_is_rejected_with_422_and_a_json_body(
    client: TestClient, seeded: dict[str, int], params: dict[str, Any]
) -> None:
    response = client.get(ENDPOINT, params=params)
    assert response.status_code == 422, response.text
    body = response.json()
    assert isinstance(body["detail"], list) and body["detail"]
    # A rejection, never a partially-served payload.
    assert "municipalities" not in body


def test_the_published_year_is_accepted_in_both_forms(
    client: TestClient, seeded: dict[str, int]
) -> None:
    for value in (2024, "2024"):
        response = client.get(ENDPOINT, params={"year": value})
        assert response.status_code == 200, response.text
        assert response.json()["meta"]["reference_year"] == 2024


@pytest.mark.parametrize("status", STATUSES)
def test_every_documented_status_is_a_valid_filter(
    client: TestClient, seeded: dict[str, int], status: str
) -> None:
    """All three are accepted even when the bucket happens to be empty."""

    payload = get(client, status=status)
    assert payload["status_filter"] == status
    assert {row["status"] for row in payload["municipalities"]} <= {status}


def test_omitting_the_status_filter_serves_every_status(
    client: TestClient, seeded: dict[str, int]
) -> None:
    payload = get(client)
    assert {row["status"] for row in payload["municipalities"]} <= set(STATUSES)
    assert payload["meta"]["returned_count"] == EXPECTED_MUNICIPALITY_COUNT


# ---------------------------------------------------------------------------
# 7. Separation from the official landfill inbound fee
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("params", FILTER_COMBINATIONS, ids=str)
def test_the_disclaimer_survives_every_filter_combination(
    client: TestClient, seeded: dict[str, int], params: dict[str, str]
) -> None:
    meta = get(client, **params)["meta"]
    assert meta["is_official_landfill_fee"] is False
    assert "LANDFILL_INBOUND_FEE_PER_CAPITA" in meta["difference_from_official_landfill_fee"]
    assert meta["caveats"]
    assert any("수도권매립지" in caveat for caveat in meta["caveats"])
    assert meta["indicator_code"] == MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA
    assert meta["accounting_basis"] == ACCOUNTING_BASIS_MUNICIPAL_CONTRACT_PAYMENT


@pytest.mark.parametrize("sort", SORTS)
def test_the_disclaimer_survives_every_sort(
    client: TestClient, seeded: dict[str, int], sort: str
) -> None:
    assert get(client, sort=sort)["meta"]["is_official_landfill_fee"] is False


def test_a_municipal_payment_is_never_labelled_with_the_official_accounting_basis(
    client: TestClient, seeded: dict[str, int]
) -> None:
    """The official basis string must not appear anywhere in this payload."""

    body = client.get(ENDPOINT).text
    assert ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW not in body
    assert "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW" not in body
    payload = json.loads(body)
    # The official indicator name appears only inside the sentence explaining the
    # difference — never as this response's own indicator_code.
    assert payload["meta"]["indicator_code"] != "LANDFILL_INBOUND_FEE_PER_CAPITA"
    assert payload["meta"]["unit"] == INDICATOR_UNIT


def test_the_municipal_router_owns_exactly_one_path() -> None:
    """It borrows the landfill prefix for placement, not the landfill contract."""

    paths = {
        route.path  # type: ignore[attr-defined]
        for route in municipal_cost_routes.router.routes
    }
    assert paths == {"/api/v1/landfill/municipal-costs"}


def test_the_landfill_path_inventory_is_exactly_the_published_set() -> None:
    """A new route under the shared prefix has to be a deliberate decision.

    Read from ``app.openapi()`` rather than ``app.routes``: FastAPI wraps each
    included router in an object that carries no ``path``, so walking
    ``app.routes`` silently finds nothing and the assertion would pass vacuously.
    """

    paths = {path for path in create_app().openapi()["paths"] if "/landfill" in path}
    assert paths == {
        "/api/v1/landfill/summary",
        "/api/v1/landfill/trends",
        "/api/v1/landfill/composition",
        "/api/v1/landfill/flows",
        "/api/v1/landfill/municipal-costs",
    }


@pytest.mark.parametrize("path", OFFICIAL_LANDFILL_PATHS)
def test_the_official_landfill_endpoints_never_mention_the_municipal_indicator(
    client: TestClient, seeded: dict[str, int], path: str
) -> None:
    """Seeded municipal rows must not leak into an official landfill response."""

    response = client.get(f"/api/v1/landfill{path}")
    assert response.status_code in (200, 404), (path, response.text)
    assert MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA not in response.text
    assert ACCOUNTING_BASIS_MUNICIPAL_CONTRACT_PAYMENT not in response.text
    assert "municipal_cost" not in response.text


# ---------------------------------------------------------------------------
# 8. No private source path is ever serialized
# ---------------------------------------------------------------------------


def test_a_successful_response_never_serializes_a_source_path(
    client: TestClient, session: Session, seeded: dict[str, int]
) -> None:
    """Workbooks are identified by filename and hash, never by where they live.

    The stored ``relative_path`` is deliberately given a private-looking absolute
    value here so the assertion is about the serializer rather than about the
    fixture's tidiness.
    """

    private = "/Users/analyst/Desktop/비공개 원자료/DATA_A/서울특별시/종로구.xlsx"
    file_row = session.scalars(
        select(MunicipalCostSourceFile).where(MunicipalCostSourceFile.sha256 == "b" * 64)
    ).one()
    file_row.relative_path = private
    session.commit()

    body = client.get(ENDPOINT).text
    assert private not in body
    assert "relative_path" not in body
    assert "/Users/" not in body
    assert "비공개 원자료" not in body
    # The provenance a consumer is entitled to is still there.
    reference = json.loads(body)
    row = {r["display_name"]: r for r in reference["municipalities"]}["종로구"]
    assert row["source_files"][0]["filename"] == "종로구.xlsx"
    assert row["source_files"][0]["sha256"] == "b" * 64


@pytest.mark.parametrize(
    "params",
    [{"year": 1999}, {"sido": "99"}, {"status": "NOPE"}, {"sort": "../../etc/passwd"}],
    ids=str,
)
def test_a_validation_error_never_leaks_a_path_or_an_internal_symbol(
    client: TestClient, seeded: dict[str, int], params: dict[str, Any]
) -> None:
    body = client.get(ENDPOINT, params=params).text
    for leak in ("/Users/", "waste_equity_backend", "Traceback", "sqlalchemy", "site-packages"):
        assert leak not in body, (params, leak)


# ---------------------------------------------------------------------------
# 9. Frontend-facing schema compatibility
# ---------------------------------------------------------------------------

# The exact key sets ``frontend/src/lib/api.ts`` declares. Adding, removing, or
# renaming a served field breaks a typed consumer, so the TypeScript interfaces
# are mirrored here and have to be updated in the same change.
#
# The mirror was checked mechanically against api.ts when it was written — all
# eight interfaces (MunicipalCostResponse / Row / Meta / QuantityCoverage /
# SourceRef / SourceCoverage / RejectedSource / PopulationComponent) matched
# field for field. Re-check with a diff of the interface bodies if either side is
# edited; a Python-side test cannot parse TypeScript for itself.
FRONTEND_ENVELOPE_KEYS = {"meta", "sido_filter", "status_filter", "sort", "municipalities"}
FRONTEND_ROW_KEYS = {
    "municipality_key",
    "display_name",
    "metropolitan_code",
    "metropolitan_name",
    "direct_region_code",
    "boundary_vintage",
    "population",
    "population_method",
    "population_definition",
    "population_components",
    "total_eligible_payment_krw",
    "eligible_contract_count",
    "payment_per_capita_krw",
    "status",
    "evidence_status",
    "reason_codes",
    "limitations",
    "source_files",
    "has_data_a",
    "has_data_b",
    "quantity_coverage",
}
FRONTEND_META_KEYS = {
    "indicator_code",
    "display_name",
    "description",
    "reference_year",
    "unit",
    "accounting_basis",
    "methodology_version",
    "geography_policy",
    "population_policy",
    "numerator_definition",
    "difference_from_official_landfill_fee",
    "is_official_landfill_fee",
    "expected_count",
    "available_count",
    "partial_count",
    "unavailable_count",
    "returned_count",
    "rejected_source_file_count",
    "rejected_source_files",
    "source_coverage",
    "caveats",
}
FRONTEND_QUANTITY_COVERAGE_KEYS = {
    "observation_count",
    "measured_count",
    "measured_zero_count",
    "missing_count",
    "repeated_municipal_block_count",
    "months_covered",
    "waste_categories",
}
FRONTEND_SOURCE_REF_KEYS = {
    "filename",
    "dataset_role",
    "layout_family",
    "primary_classification",
    "resolution_basis",
    "sha256",
}
FRONTEND_SOURCE_COVERAGE_KEYS = {
    "discovered_file_count",
    "accepted_file_count",
    "rejected_file_count",
    "data_a_file_count",
    "data_b_file_count",
    "municipalities_with_data_a",
    "municipalities_with_data_b",
    "municipalities_with_no_source_file",
}
FRONTEND_REJECTED_SOURCE_KEYS = {"filename", "dataset_role", "reason_codes", "explanation"}
FRONTEND_POPULATION_COMPONENT_KEYS = {"region_code", "region_name", "population"}


def test_the_served_field_names_match_the_frontend_typescript_contract(
    client: TestClient, seeded: dict[str, int]
) -> None:
    payload = get(client)
    assert set(payload) == FRONTEND_ENVELOPE_KEYS
    assert set(payload["meta"]) == FRONTEND_META_KEYS
    assert set(payload["meta"]["source_coverage"]) == FRONTEND_SOURCE_COVERAGE_KEYS
    for rejected in payload["meta"]["rejected_source_files"]:
        assert set(rejected) == FRONTEND_REJECTED_SOURCE_KEYS

    rows = payload["municipalities"]
    assert rows
    saw_source_ref = saw_component = False
    for row in rows:
        assert set(row) == FRONTEND_ROW_KEYS, row["display_name"]
        assert set(row["quantity_coverage"]) == FRONTEND_QUANTITY_COVERAGE_KEYS
        for ref in row["source_files"]:
            assert set(ref) == FRONTEND_SOURCE_REF_KEYS
            saw_source_ref = True
        for component in row["population_components"]:
            assert set(component) == FRONTEND_POPULATION_COMPONENT_KEYS
            saw_component = True
    # The nested shapes above are only checked if something exercised them.
    assert saw_source_ref and saw_component


def test_the_served_field_types_match_the_frontend_typescript_contract(
    client: TestClient, seeded: dict[str, int]
) -> None:
    """Nullability included: a TS ``string | null`` must never arrive as ``0``."""

    payload = get(client)
    meta = payload["meta"]
    assert isinstance(meta["is_official_landfill_fee"], bool)
    assert isinstance(meta["reference_year"], int)
    assert isinstance(meta["caveats"], list)
    assert all(isinstance(caveat, str) for caveat in meta["caveats"])
    for key in ("expected_count", "available_count", "partial_count", "unavailable_count"):
        assert isinstance(meta[key], int)
    assert isinstance(payload["sort"], str)

    for row in payload["municipalities"]:
        assert isinstance(row["municipality_key"], str)
        assert row["status"] in STATUSES
        assert row["metropolitan_code"] in METROPOLITAN_CODES
        assert isinstance(row["has_data_a"], bool)
        assert isinstance(row["has_data_b"], bool)
        assert isinstance(row["eligible_contract_count"], int)
        assert row["population"] is None or isinstance(row["population"], int)
        assert row["direct_region_code"] is None or isinstance(row["direct_region_code"], str)
        for key in ("reason_codes", "limitations", "source_files", "population_components"):
            assert isinstance(row[key], list)


def test_the_frontend_sido_and_sort_vocabularies_are_the_served_ones(
    client: TestClient, seeded: dict[str, int]
) -> None:
    """``MunicipalCostSido`` / ``MunicipalCostSort`` in api.ts, pinned to the API."""

    assert set(METROPOLITAN_CODES) == {"11", "28", "41"}
    for sido in ("11", "28", "41"):
        assert client.get(ENDPOINT, params={"sido": sido}).status_code == 200
    for sort in SORTS:
        assert client.get(ENDPOINT, params={"sort": sort}).status_code == 200


# ---------------------------------------------------------------------------
# 10. Decimal fidelity
# ---------------------------------------------------------------------------


def test_a_stored_decimal_round_trips_without_binary_float_corruption(
    client: TestClient, session: Session
) -> None:
    """The served string must equal the stored Decimal exactly.

    NOTE: on the in-memory SQLite tier SQLAlchemy round-trips ``Numeric`` through
    a C double, so this asserts fidelity only within double precision — the
    magnitudes used here are safely inside it. Full-width ``NUMERIC(20, 2)``
    fidelity is a property of the PostgreSQL column type and belongs to the
    TEST_DATABASE_URL tier.
    """

    payment = Decimal("23099780450.25")
    value = Decimal("84809.9851")
    geography = _geography(
        municipality_key="41-광명시",
        display_name="광명시",
        metropolitan_code=METROPOLITAN_GYEONGGI,
        metropolitan_name="경기도",
        population=272371,
        status=STATUS_AVAILABLE,
    )
    session.add(geography)
    session.flush()
    session.add(
        MunicipalCostIndicatorValue(
            geography_id=geography.id,
            reference_year=2024,
            indicator_code=MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA,
            value=value,
            unit=INDICATOR_UNIT,
            numerator_amount_krw=payment,
            denominator_population=272371,
            numerator_contract_count=3,
            population_method=POPULATION_DERIVED_WARD_SUM,
            population_definition=None,
            evidence_status=EVIDENCE_OFFICIAL_DERIVED,
            status=STATUS_AVAILABLE,
            reason_codes=[],
            limitations=[],
            methodology_version=METHODOLOGY_VERSION,
            ingestion_run_id=None,
            computed_at=NOW,
        )
    )
    session.commit()

    (row,) = get(client)["municipalities"]
    assert Decimal(row["total_eligible_payment_krw"]) == payment
    assert Decimal(row["payment_per_capita_krw"]) == value
    # The declared scale is preserved rather than trimmed to the shortest repr.
    assert row["total_eligible_payment_krw"] == "23099780450.25"
    assert row["payment_per_capita_krw"] == "84809.9851"


def test_the_quantity_coverage_block_counts_missing_apart_from_zero(
    client: TestClient, seeded: dict[str, int]
) -> None:
    """Tonnage evidence is reported, and a blank is never tallied as a measured 0."""

    for row in get(client)["municipalities"]:
        coverage = row["quantity_coverage"]
        assert (
            coverage["measured_count"] + coverage["measured_zero_count"] + coverage["missing_count"]
            == coverage["observation_count"]
        )
        assert coverage["months_covered"] <= 12
        assert coverage["repeated_municipal_block_count"] <= coverage["observation_count"]


# ---------------------------------------------------------------------------
# 11. Read-only
# ---------------------------------------------------------------------------


def test_the_endpoint_is_read_only(
    client: TestClient, session: Session, seeded: dict[str, int]
) -> None:
    """No verb other than GET, and a GET changes no stored row."""

    def snapshot() -> tuple[int, int, int]:
        return (
            len(session.scalars(select(MunicipalCostGeography)).all()),
            len(session.scalars(select(MunicipalCostIndicatorValue)).all()),
            len(session.scalars(select(MunicipalCostSourceFile)).all()),
        )

    before = snapshot()
    for params in FILTER_COMBINATIONS:
        assert client.get(ENDPOINT, params=params).status_code == 200
    session.expire_all()
    assert snapshot() == before

    for method in (client.post, client.put, client.patch, client.delete):
        assert method(ENDPOINT).status_code == 405


def test_a_second_identical_request_serves_a_byte_identical_body(
    client: TestClient, seeded: dict[str, int]
) -> None:
    assert client.get(ENDPOINT).text == client.get(ENDPOINT).text
