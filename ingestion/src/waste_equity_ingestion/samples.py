"""Sanitized sample persistence for probe responses."""

from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SENSITIVE_KEYS = {
    "authorization",
    "access_token",
    "accessToken",
    "apiKey",
    "api_key",
    "consumer_key",
    "consumer_secret",
    "key",
    "rcis_api_key",
    "rcis_user_id",
    "secret",
    "serviceKey",
    "ServiceKey",
    "token",
    "usrid",
}


@dataclass(frozen=True)
class SampleEnvelope:
    source: str
    endpoint: str
    verification_status: str
    schema_validation_status: str
    retrieved_at: str
    request_metadata: dict[str, Any]
    payload: dict[str, Any]


def sanitize(value: Any) -> Any:
    normalized_sensitive_keys = {key.lower() for key in SENSITIVE_KEYS}
    if isinstance(value, dict):
        clean: dict[str, Any] = {}
        for key, item in value.items():
            if key in SENSITIVE_KEYS or key.lower() in normalized_sensitive_keys:
                clean[key] = "[REDACTED]"
            else:
                clean[key] = sanitize(item)
        return clean
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    return value


def build_envelope(
    *,
    source: str,
    endpoint: str,
    payload: dict[str, Any],
    verification_status: str,
    schema_validation_status: str,
    request_metadata: dict[str, Any] | None = None,
) -> SampleEnvelope:
    if verification_status not in {"LIVE_VERIFIED", "FIXTURE_ONLY"}:
        raise ValueError("verification_status must be LIVE_VERIFIED or FIXTURE_ONLY")
    if schema_validation_status not in {"LIVE_VERIFIED", "SCHEMA_UNVERIFIED", "FIXTURE_ONLY"}:
        raise ValueError(
            "schema_validation_status must be LIVE_VERIFIED, SCHEMA_UNVERIFIED, or FIXTURE_ONLY"
        )
    return SampleEnvelope(
        source=source,
        endpoint=endpoint,
        verification_status=verification_status,
        schema_validation_status=schema_validation_status,
        retrieved_at=datetime.now(timezone.utc).isoformat(),
        request_metadata=sanitize(deepcopy(request_metadata or {})),
        payload=sanitize(deepcopy(payload)),
    )


def save_sample(directory: str, filename: str, envelope: SampleEnvelope) -> Path:
    sample_dir = Path(directory)
    sample_dir.mkdir(parents=True, exist_ok=True)
    path = sample_dir / filename
    path.write_text(
        json.dumps(envelope.__dict__, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return path
