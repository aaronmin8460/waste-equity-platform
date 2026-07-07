"""Probe scaffold for the Resource Circulation Information System waste statistics API."""

from ..config import ProbeSettings
from ..errors import MissingCredentialsError, UnverifiedContractError
from ..result import ProbeResult

SOURCE = "waste_statistics"


def probe(settings: ProbeSettings) -> ProbeResult:
    missing = settings.missing(["RCIS_API_ID", "RCIS_API_KEY"])
    if missing:
        raise MissingCredentialsError(missing)
    raise UnverifiedContractError(
        "RCIS public documentation found in Phase 0 does not expose a confirmed endpoint contract."
    )
