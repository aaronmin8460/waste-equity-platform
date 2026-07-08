"""Probe exceptions with distinct failure semantics."""


class ProbeError(Exception):
    """Base class for probe failures."""


class MissingCredentialsError(ProbeError):
    """Raised when a live probe cannot run because credentials are absent."""

    def __init__(self, missing: list[str]) -> None:
        super().__init__("Missing required environment variables: " + ", ".join(missing))
        self.missing = missing


class MissingConfigurationError(ProbeError):
    """Raised when a required non-secret request configuration value is absent."""

    def __init__(self, missing: list[str]) -> None:
        super().__init__("Missing required configuration variables: " + ", ".join(missing))
        self.missing = missing


class ProviderResultError(ProbeError):
    """Raised when the provider-level result code signals failure."""


class SchemaValidationError(ProbeError):
    """Raised when a live response is missing fields required by the contract."""


class UnverifiedContractError(ProbeError):
    """Raised when official documentation is insufficient for a live contract."""


class IngestionError(ProbeError):
    """Raised when a production ingestion job cannot safely complete."""


class QuotaExceededError(ProviderResultError):
    """Raised when the provider signals a per-minute or daily quota breach."""


class UnsupportedSchemaEraError(ProbeError):
    """Raised when a requested YEAR falls in a schema era this phase rejects."""


class RegionMappingError(IngestionError):
    """Raised when RCIS region records cannot be mapped without assumptions."""
