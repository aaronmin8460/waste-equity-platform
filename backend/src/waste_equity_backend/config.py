"""Environment-backed application settings.

Credential values must never be logged, serialized into API responses,
or echoed in error messages.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    app_name: str = "waste-equity-platform"
    backend_host: str = "127.0.0.1"
    backend_port: int = 8000
    database_url: str = "postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity"
    # Comma-separated list; restrict before any non-local deployment.
    cors_allow_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allow_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
