"""Scenario identity and tile addressing for a NON-historical component model.

Both surfaces here read a weight vector by component name. Both took the
historical `zoning`/`road`/`equity`/`demand` order as an unstated default, so a
successor scenario — whose vector carries none of those four keys — raised
`KeyError: 'zoning'` and turned every V3 preview, candidate detail and scenario
tile into a 500. These tests pin the model-aware behaviour AND the byte-for-byte
identity of the historical form, which existing links and caches depend on.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from waste_equity_backend.analysis.suitability import component_model, scenario
from waste_equity_backend.api.routes.suitability_scenarios import _relative_tile_url

HISTORICAL_ORDER = list(component_model.COMPONENT_ORDER_HISTORICAL)
SUCCESSOR_ORDER = list(component_model.COMPONENT_ORDER_SUCCESSOR)

HISTORICAL_WEIGHTS = {c: Decimal("0.25") for c in HISTORICAL_ORDER}
SUCCESSOR_WEIGHTS = {c: Decimal("0.25") for c in SUCCESSOR_ORDER}


def test_a_successor_vector_hashes_instead_of_raising_on_a_historical_name() -> None:
    payload = scenario.canonical_hash_payload(48, SUCCESSOR_WEIGHTS, SUCCESSOR_ORDER)
    assert '"existing_burden":"0.25000000"' in payload
    for historical in HISTORICAL_ORDER:
        assert f'"{historical}"' not in payload
    assert len(scenario.scenario_hash(48, SUCCESSOR_WEIGHTS, SUCCESSOR_ORDER)) == 64


def test_a_successor_vector_under_the_historical_order_still_fails_loudly() -> None:
    """The default is not silently permissive: passing the wrong order is a bug."""

    with pytest.raises(KeyError):
        scenario.scenario_hash(48, SUCCESSOR_WEIGHTS)


def test_the_historical_hash_is_unchanged_by_the_new_parameter() -> None:
    """Every existing scenario link and cached tile URL keeps its identity."""

    implicit = scenario.scenario_hash(47, HISTORICAL_WEIGHTS)
    explicit = scenario.scenario_hash(47, HISTORICAL_WEIGHTS, HISTORICAL_ORDER)
    assert implicit == explicit
    assert (
        scenario.canonical_hash_payload(47, HISTORICAL_WEIGHTS)
        == '{"method_version":"' + scenario.USER_WEIGHT_SCENARIO_METHOD_VERSION + '",'
        '"run_id":47,"weights":{"zoning":"0.25000000","road":"0.25000000",'
        '"equity":"0.25000000","demand":"0.25000000"}}'
    )


def test_two_models_at_equal_weights_are_different_scenarios() -> None:
    assert scenario.scenario_hash(48, SUCCESSOR_WEIGHTS, SUCCESSOR_ORDER) != scenario.scenario_hash(
        48, HISTORICAL_WEIGHTS, HISTORICAL_ORDER
    )


def test_the_historical_tile_url_keeps_its_wz_wr_we_wd_contract() -> None:
    canonical = {c: "0.25000000" for c in HISTORICAL_ORDER}
    url = _relative_tile_url(47, canonical, "deadbeef")
    assert url == (
        "/api/v1/suitability/scenarios/tiles/47/{z}/{x}/{y}.mvt"
        "?wz=0.25000000&wr=0.25000000&we=0.25000000&wd=0.25000000"
        "&scenario_hash=deadbeef"
    )


def test_a_successor_tile_url_uses_the_model_agnostic_pair_form() -> None:
    """`we` must never be reused for `existing_burden` — see the endpoint's note."""

    canonical = {c: "0.25000000" for c in SUCCESSOR_ORDER}
    url = _relative_tile_url(48, canonical, "deadbeef", SUCCESSOR_ORDER)
    assert "wz=" not in url and "wr=" not in url and "we=" not in url and "wd=" not in url
    for component in SUCCESSOR_ORDER:
        assert f"w={component}:0.25000000" in url
    assert url.index("w=existing_burden") < url.index("w=air_impact_proxy")
