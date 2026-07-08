"""Provider-level result-code and schema validation."""

from collections.abc import Iterable
from typing import Any

from .errors import ProviderResultError, SchemaValidationError
from .http import nested_get


def require_result_code(
    payload: dict[str, Any],
    *,
    path: str,
    ok_values: Iterable[Any],
    provider: str,
) -> None:
    value = nested_get(payload, path)
    if value not in set(ok_values):
        raise ProviderResultError(f"{provider} provider result code failure at {path}: {value!r}")


def require_vworld_ok(payload: dict[str, Any]) -> None:
    status = payload.get("response", {}).get("status", payload.get("status"))
    if status != "OK":
        raise ProviderResultError(f"VWorld provider status failure: {status!r}")


def require_paths(payload: dict[str, Any], paths: Iterable[str], provider: str) -> None:
    missing = [path for path in paths if nested_get(payload, path) is None]
    if missing:
        raise SchemaValidationError(
            f"{provider} response missing required field path(s): {', '.join(missing)}"
        )
