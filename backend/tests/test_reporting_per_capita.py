"""Unit tests for the reporting per-capita child-population derivation.

Pure-function tests (no database): the derived-city denominator must be the exact
sum of the child SGIS populations, requiring exactly one eligible row per child
and a single shared definition/source, else a precise exclusion reason.
"""

from waste_equity_backend.api.routes.reporting import (
    _population_issue,
    _sum_child_population,
)
from waste_equity_backend.models import RegionalPopulation


def _pop(
    region_id: int, population: int, definition: str = "RESIDENT_REGISTERED", source: str = "sgis"
) -> RegionalPopulation:
    row = RegionalPopulation()
    row.region_id = region_id
    row.population = population
    row.population_definition = definition
    row.source_id = source
    return row


def test_sum_equals_exact_child_total() -> None:
    populations = {1: [_pop(1, 229980)], 2: [_pop(2, 315820)]}
    total, reason = _sum_child_population([1, 2], expected_count=2, populations=populations)
    assert reason is None
    assert total == 545800


def test_missing_child_population_excludes() -> None:
    populations = {1: [_pop(1, 100)]}
    total, reason = _sum_child_population([1, 2], expected_count=2, populations=populations)
    assert reason == "NO_POPULATION_DENOMINATOR"
    assert total == 0


def test_duplicate_child_population_excludes() -> None:
    populations = {1: [_pop(1, 100)], 2: [_pop(2, 200), _pop(2, 201)]}
    total, reason = _sum_child_population([1, 2], expected_count=2, populations=populations)
    assert reason == "AMBIGUOUS_POPULATION_DEFINITION"


def test_incomplete_child_set_excludes() -> None:
    populations = {1: [_pop(1, 100)], 2: [_pop(2, 200)]}
    total, reason = _sum_child_population([1], expected_count=2, populations=populations)
    assert reason == "INCOMPLETE_CHILD_POPULATION"


def test_mixed_population_definition_excludes() -> None:
    populations = {
        1: [_pop(1, 100, definition="RESIDENT_REGISTERED")],
        2: [_pop(2, 200, definition="SERVICE_POPULATION")],
    }
    total, reason = _sum_child_population([1, 2], expected_count=2, populations=populations)
    assert reason == "AMBIGUOUS_POPULATION_DEFINITION"


def test_population_issue_single_row_is_ok() -> None:
    assert _population_issue([_pop(1, 100)]) is None
    assert _population_issue([]) == "NO_POPULATION_DENOMINATOR"
    assert _population_issue([_pop(1, 100), _pop(1, 101)]) == "AMBIGUOUS_POPULATION_DEFINITION"
