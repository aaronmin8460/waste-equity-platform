"""Small stdlib HTTP helper for live API probes."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

DEFAULT_TIMEOUT_SECONDS = 15.0


@dataclass(frozen=True)
class JsonResponse:
    status: int
    content_type: str
    payload: dict[str, Any]


def get_json(
    url: str, params: dict[str, Any], timeout: float = DEFAULT_TIMEOUT_SECONDS
) -> dict[str, Any]:
    return get_json_response(url, params, timeout).payload


def get_json_response(
    url: str, params: dict[str, Any], timeout: float = DEFAULT_TIMEOUT_SECONDS
) -> JsonResponse:
    query = urlencode(params)
    request_url = f"{url}?{query}" if query else url
    request = Request(request_url, headers={"Accept": "application/json"})
    with urlopen(request, timeout=timeout) as response:
        status = getattr(response, "status", response.getcode())
        content_type = response.headers.get("Content-Type", "")
        body = response.read()
    if status < 200 or status >= 300:
        raise RuntimeError(f"HTTP status {status}")
    if "json" not in content_type.lower():
        raise RuntimeError(f"Expected JSON content type, got {content_type!r}")
    decoded = body.decode("utf-8", errors="replace")
    payload = json.loads(decoded)
    if not isinstance(payload, dict):
        raise RuntimeError("Expected a JSON object response")
    return JsonResponse(status=status, content_type=content_type, payload=payload)


def nested_get(payload: dict[str, Any], dotted_path: str) -> Any | None:
    current: Any = payload
    for part in dotted_path.split("."):
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current
