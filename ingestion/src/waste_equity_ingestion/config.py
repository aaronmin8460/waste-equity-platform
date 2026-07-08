"""Environment-backed probe settings."""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv


@dataclass(frozen=True)
class ProbeSettings:
    rcis_api_key: Optional[str]
    rcis_user_id: Optional[str]
    rcis_api_base_url: str
    sgis_consumer_key: Optional[str]
    sgis_consumer_secret: Optional[str]
    data_go_kr_service_key: Optional[str]
    airkorea_service_key: Optional[str]
    kma_service_key: Optional[str]
    vworld_api_key: Optional[str]
    vworld_api_domain: Optional[str]
    sample_dir: str

    @classmethod
    def from_env(cls) -> "ProbeSettings":
        env_path = find_env_file()
        if env_path.exists():
            load_dotenv(env_path, override=False)
        sample_dir = resolve_config_path(
            env_path.parent,
            os.getenv("PROBE_SAMPLE_DIR", "data/samples"),
        )
        return cls(
            rcis_api_key=os.getenv("RCIS_API_KEY"),
            rcis_user_id=os.getenv("RCIS_USER_ID"),
            rcis_api_base_url=os.getenv("RCIS_API_BASE_URL", "https://www.recycling-info.or.kr"),
            sgis_consumer_key=os.getenv("SGIS_CONSUMER_KEY"),
            sgis_consumer_secret=os.getenv("SGIS_CONSUMER_SECRET"),
            data_go_kr_service_key=os.getenv("DATA_GO_KR_SERVICE_KEY"),
            airkorea_service_key=os.getenv("AIRKOREA_SERVICE_KEY"),
            kma_service_key=os.getenv("KMA_SERVICE_KEY"),
            vworld_api_key=os.getenv("VWORLD_API_KEY"),
            vworld_api_domain=os.getenv("VWORLD_API_DOMAIN"),
            sample_dir=sample_dir,
        )

    def airkorea_key(self) -> Optional[str]:
        return self.airkorea_service_key or self.data_go_kr_service_key

    def kma_key(self) -> Optional[str]:
        return self.kma_service_key or self.data_go_kr_service_key

    def missing(self, names: list[str]) -> list[str]:
        values: dict[str, Optional[str]] = {
            "RCIS_API_KEY": self.rcis_api_key,
            "RCIS_USER_ID": self.rcis_user_id,
            "SGIS_CONSUMER_KEY": self.sgis_consumer_key,
            "SGIS_CONSUMER_SECRET": self.sgis_consumer_secret,
            "DATA_GO_KR_SERVICE_KEY": self.data_go_kr_service_key,
            "AIRKOREA_SERVICE_KEY": self.airkorea_service_key,
            "KMA_SERVICE_KEY": self.kma_service_key,
            "VWORLD_API_KEY": self.vworld_api_key,
        }
        return [name for name in names if not values.get(name)]


def find_env_file() -> Path:
    """Find a local .env from the current directory or a parent project directory."""
    cwd = Path.cwd()
    candidates = (cwd, *cwd.parents)
    for directory in candidates:
        env_path = directory / ".env"
        if env_path.exists():
            return env_path
    return cwd / ".env"


def resolve_config_path(base_dir: Path, value: str) -> str:
    path = Path(value)
    if path.is_absolute():
        return str(path)
    return str(base_dir / path)
