"""Shared probe result types."""

from typing import Any, TypedDict


class ProbeResult(TypedDict):
    source: str
    endpoint_identifier: str
    payload: dict[str, Any]
    schema_validation_status: str
    geographic_coverage: str
    latest_reference_period_observed: str
    request_metadata: dict[str, Any]
