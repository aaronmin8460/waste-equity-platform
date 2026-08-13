"""Tests for ``scripts/deployment/backup-local-database.sh``.

The release rehearsal found that this script addressed whatever Compose project
the *current directory basename* happened to imply. Run from a Git worktree it
therefore missed the running dev stack, started a fresh one, and dumped a brand
new empty database — a valid-looking backup of the wrong database, which is the
one failure mode a pre-release backup must not have.

These tests pin the two properties that prevent it: the target project is
resolved independently of the working directory, and ``pg_dump`` is reached only
after the resolved container has been proven to hold the application database.

``docker`` is replaced by a stub on ``PATH`` that records every invocation, so no
container, database or real dump is involved. The script is copied into a
throwaway tree whose basename varies per test — the script ``cd``s to its own
repo root, so the basename is exactly the variable that used to leak in.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "deployment" / "backup-local-database.sh"

# The pinned local dev stack. Same value as the script's default; asserted here so
# a change to either side has to be a deliberate change to both.
EXPECTED_PROJECT = "waste-equity-platform"
CONTAINER_ID = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
DUMP_BODY = b"PGDMP-stub-custom-format-body"

# Commands that would bring a stack into existence. None may ever be issued.
CREATING_SUBCOMMANDS = {"up", "start", "create", "run"}


DOCKER_STUB = r'''#!/usr/bin/env python3
"""Stand-in for the docker CLI: records argv, answers from a JSON fixture."""
# The stub runs under whichever python3 is on the test PATH, which on macOS is
# the 3.9 system interpreter — so PEP 604 annotations must stay deferred.
from __future__ import annotations

import json
import os
import sys

cfg = json.load(open(os.environ["STUB_CONFIG"]))
argv = sys.argv[1:]

with open(cfg["log"], "a") as handle:
    handle.write(json.dumps(argv) + "\n")


def die(msg: str) -> None:
    sys.stderr.write(msg + "\n")
    raise SystemExit(1)


def opt(name: str) -> str | None:
    return argv[argv.index(name) + 1] if name in argv else None


if argv and argv[0] == "compose":
    project = opt("-p")
    if "ps" in argv:
        # Only a project that actually has a container reports one. `ps -q` never
        # creates anything, so an unknown project yields an empty answer.
        cid = cfg["containers"].get(project or "")
        if cid:
            print(cid)
        raise SystemExit(0)
    die(f"stub: unexpected compose subcommand: {argv}")

if argv and argv[0] == "inspect":
    cid = argv[-1]
    if cid not in cfg["containers"].values():
        die("Error: No such object")
    print("true" if cfg["running"] else "false")
    raise SystemExit(0)

if argv and argv[0] == "exec":
    cid = next((a for a in argv if a in cfg["containers"].values()), None)
    if cid is None:
        die("Error: No such container")
    if "pg_isready" in argv:
        raise SystemExit(0 if cfg["pg_isready"] else 1)
    if "pg_dump" in argv:
        if not cfg.get("allow_dump", True):
            die("stub: pg_dump refused")
        sys.stdout.buffer.write(bytes.fromhex(cfg["dump_hex"]))
        raise SystemExit(0)
    if "psql" in argv:
        query = opt("-c") or ""
        if "current_database" in query:
            print(cfg["db_name"])
        elif "to_regclass" in query:
            table = query.split("public.")[1].split("'")[0]
            print("t" if table in cfg["tables"] else "f")
        elif "version_num" in query:
            if cfg["alembic"]:
                print(cfg["alembic"])
        elif "count(*) FROM regions" in query:
            print(cfg["regions"])
        else:
            die(f"stub: unexpected query: {query}")
        raise SystemExit(0)
    die(f"stub: unexpected exec: {argv}")

die(f"stub: unexpected docker invocation: {argv}")
'''


def default_config(log: Path) -> dict[str, Any]:
    """A healthy dev stack: the container lives under the pinned project only."""

    return {
        "log": str(log),
        "containers": {EXPECTED_PROJECT: CONTAINER_ID},
        "running": True,
        "pg_isready": True,
        "db_name": "waste_equity",
        "alembic": "0021",
        "tables": ["alembic_version", "regions", "data_sources", "ingestion_runs"],
        "regions": 1234,
        "dump_hex": DUMP_BODY.hex(),
    }


class Result:
    """One script run plus the docker invocations it produced."""

    def __init__(self, completed: subprocess.CompletedProcess[str], root: Path, log: Path):
        self.completed = completed
        self.root = root
        self.calls: list[list[str]] = [
            json.loads(line) for line in log.read_text().splitlines() if line.strip()
        ]

    @property
    def returncode(self) -> int:
        return self.completed.returncode

    @property
    def stdout(self) -> str:
        return self.completed.stdout

    @property
    def stderr(self) -> str:
        return self.completed.stderr

    @property
    def output(self) -> str:
        return self.completed.stdout + self.completed.stderr

    def ran(self, token: str) -> bool:
        return any(token in call for call in self.calls)

    def projects_addressed(self) -> list[str]:
        found = []
        for call in self.calls:
            if call and call[0] == "compose" and "-p" in call:
                found.append(call[call.index("-p") + 1])
        return found

    def dumps(self) -> list[Path]:
        backups = self.root / "backups"
        return sorted(backups.glob("*.dump")) if backups.is_dir() else []


@pytest.fixture
def stub_dir(tmp_path: Path) -> Path:
    """A PATH entry holding only the docker stub."""

    directory = tmp_path / "stub-bin"
    directory.mkdir()
    docker = directory / "docker"
    docker.write_text(DOCKER_STUB)
    docker.chmod(0o755)
    return directory


def run_script(
    tmp_path: Path,
    stub_dir: Path,
    *,
    basename: str,
    config: dict[str, Any] | None = None,
    args: list[str] | None = None,
) -> Result:
    """Copy the script into a checkout called ``basename`` and run it there."""

    root = tmp_path / basename
    (root / "scripts" / "deployment").mkdir(parents=True)
    shutil.copy2(SCRIPT_PATH, root / "scripts" / "deployment" / SCRIPT_PATH.name)
    # Only its existence is checked; the stub answers every compose query.
    (root / "docker-compose.yml").write_text("services:\n  database:\n    image: stub\n")

    log = tmp_path / f"docker-calls-{basename}.log"
    log.write_text("")
    cfg = dict(config or default_config(log))
    cfg["log"] = str(log)
    config_path = tmp_path / f"stub-config-{basename}.json"
    config_path.write_text(json.dumps(cfg))

    completed = subprocess.run(
        ["bash", str(root / "scripts" / "deployment" / SCRIPT_PATH.name), *(args or [])],
        capture_output=True,
        text=True,
        # A minimal PATH: the stub first, and no directory that holds a real docker,
        # so a real daemon can never be contacted even if resolution regressed.
        env={
            "PATH": f"{stub_dir}:/usr/bin:/bin:/usr/sbin:/sbin",
            "HOME": str(tmp_path),
            "STUB_CONFIG": str(config_path),
        },
        cwd=str(tmp_path),
    )
    return Result(completed, root, log)


# ---------------------------------------------------------------------------
# 1-3. project resolution is independent of the working directory
# ---------------------------------------------------------------------------


def test_primary_checkout_resolves_the_intended_database(tmp_path: Path, stub_dir: Path) -> None:
    result = run_script(tmp_path, stub_dir, basename=EXPECTED_PROJECT)

    assert result.returncode == 0, result.output
    assert result.projects_addressed() == [EXPECTED_PROJECT]
    assert result.ran(CONTAINER_ID)
    assert result.ran("pg_dump")


def test_git_worktree_resolves_the_same_database(tmp_path: Path, stub_dir: Path) -> None:
    """The regression: a worktree basename must not change the target."""

    worktree = run_script(tmp_path, stub_dir, basename="waste-equity-municipal-integration")
    primary = run_script(tmp_path, stub_dir, basename=EXPECTED_PROJECT)

    assert worktree.returncode == 0, worktree.output
    assert worktree.projects_addressed() == primary.projects_addressed() == [EXPECTED_PROJECT]
    assert worktree.ran(CONTAINER_ID)
    assert worktree.ran("pg_dump")
    # Never the basename-derived project, which is what Compose would have used.
    assert "waste-equity-municipal-integration" not in worktree.projects_addressed()


@pytest.mark.parametrize(
    "basename",
    [
        EXPECTED_PROJECT,
        "waste-equity-municipal-integration",
        "waste-equity-demo-release",
        "some-unrelated-directory",
    ],
)
def test_directory_basename_cannot_select_or_create_another_database(
    tmp_path: Path, stub_dir: Path, basename: str
) -> None:
    """No basename may address a different project, nor bring a stack into being."""

    result = run_script(tmp_path, stub_dir, basename=basename)

    assert result.returncode == 0, result.output
    assert set(result.projects_addressed()) == {EXPECTED_PROJECT}
    assert basename not in result.projects_addressed() or basename == EXPECTED_PROJECT
    for call in result.calls:
        assert not CREATING_SUBCOMMANDS.intersection(call), f"stack-creating call: {call}"
    # Exactly one container was ever touched.
    touched = {arg for call in result.calls for arg in call if arg == CONTAINER_ID}
    assert touched == {CONTAINER_ID}


# ---------------------------------------------------------------------------
# 4. a missing target fails; it is never created
# ---------------------------------------------------------------------------


def test_missing_database_fails_instead_of_creating_one(tmp_path: Path, stub_dir: Path) -> None:
    log = tmp_path / "unused.log"
    config = default_config(log)
    config["containers"] = {}  # the pinned project has no database container

    result = run_script(tmp_path, stub_dir, basename=EXPECTED_PROJECT, config=config)

    assert result.returncode != 0
    assert EXPECTED_PROJECT in result.stderr
    for call in result.calls:
        assert not CREATING_SUBCOMMANDS.intersection(call), f"stack-creating call: {call}"
    assert not result.ran("pg_dump")
    assert result.dumps() == []


def test_missing_database_under_an_explicit_wrong_project_fails(
    tmp_path: Path, stub_dir: Path
) -> None:
    """Even asked directly for an empty project, it refuses rather than populating it."""

    result = run_script(
        tmp_path, stub_dir, basename=EXPECTED_PROJECT, args=["--project", "waste-equity-elsewhere"]
    )

    assert result.returncode != 0
    assert result.projects_addressed() == ["waste-equity-elsewhere"]
    for call in result.calls:
        assert not CREATING_SUBCOMMANDS.intersection(call)
    assert not result.ran("pg_dump")
    assert result.dumps() == []


# ---------------------------------------------------------------------------
# 5. pg_dump is never executed against an unverified target
# ---------------------------------------------------------------------------


def _broken(log: Path, **overrides: Any) -> dict[str, Any]:
    config = default_config(log)
    config.update(overrides)
    return config


@pytest.mark.parametrize(
    ("label", "overrides"),
    [
        ("container not running", {"running": False}),
        ("not accepting connections", {"pg_isready": False}),
        ("wrong database name", {"db_name": "postgres"}),
        ("no alembic_version table", {"tables": ["regions", "data_sources", "ingestion_runs"]}),
        ("unreadable migration head", {"alembic": ""}),
        ("missing regions", {"tables": ["alembic_version", "data_sources", "ingestion_runs"]}),
        ("missing data_sources", {"tables": ["alembic_version", "regions", "ingestion_runs"]}),
        ("missing ingestion_runs", {"tables": ["alembic_version", "regions", "data_sources"]}),
        ("empty compose instance", {"regions": 0}),
    ],
)
def test_pg_dump_never_runs_against_an_unverified_target(
    tmp_path: Path, stub_dir: Path, label: str, overrides: dict[str, Any]
) -> None:
    log = tmp_path / "unused.log"
    result = run_script(
        tmp_path, stub_dir, basename=EXPECTED_PROJECT, config=_broken(log, **overrides)
    )

    assert result.returncode != 0, f"{label}: should have failed\n{result.output}"
    assert not result.ran("pg_dump"), f"{label}: dumped an unverified target"
    assert result.dumps() == [], f"{label}: left a dump behind"
    assert "✗" in result.stderr, f"{label}: failed quietly"


def test_verification_failure_names_the_project_it_refused(tmp_path: Path, stub_dir: Path) -> None:
    """The operator has to be told which stack was wrong, not just that one was."""

    log = tmp_path / "unused.log"
    result = run_script(
        tmp_path, stub_dir, basename=EXPECTED_PROJECT, config=_broken(log, regions=0)
    )

    assert result.returncode != 0
    assert EXPECTED_PROJECT in result.stderr


# ---------------------------------------------------------------------------
# 6. the normal backup still behaves as before
# ---------------------------------------------------------------------------


def test_normal_backup_behaviour_is_unchanged(tmp_path: Path, stub_dir: Path) -> None:
    result = run_script(tmp_path, stub_dir, basename=EXPECTED_PROJECT)

    assert result.returncode == 0, result.output

    dumps = result.dumps()
    assert len(dumps) == 1
    dump = dumps[0]
    assert dump.name.startswith("waste_equity_local_")
    assert dump.name.endswith(".dump")
    assert dump.read_bytes() == DUMP_BODY

    assert "backup complete" in result.stdout
    assert str(dump.relative_to(result.root)) in result.stdout
    assert hashlib.sha256(DUMP_BODY).hexdigest() in result.stdout
    assert "alembic head 0021" in result.stdout
    # The dump body and credentials are never echoed.
    assert DUMP_BODY.decode() not in result.stdout
    assert "waste_equity" in result.stdout  # the database name is fine to print
    assert "PGPASSWORD" not in result.output
    assert "--password" not in result.output


def test_empty_dump_is_rejected_and_removed(tmp_path: Path, stub_dir: Path) -> None:
    log = tmp_path / "unused.log"
    result = run_script(
        tmp_path, stub_dir, basename=EXPECTED_PROJECT, config=_broken(log, dump_hex="")
    )

    assert result.returncode != 0
    assert "empty" in result.output
    assert result.dumps() == []


def test_out_dir_is_honoured(tmp_path: Path, stub_dir: Path) -> None:
    result = run_script(
        tmp_path, stub_dir, basename=EXPECTED_PROJECT, args=["--out-dir", "backups/nested"]
    )

    assert result.returncode == 0, result.output
    written = sorted((result.root / "backups" / "nested").glob("*.dump"))
    assert len(written) == 1


# ---------------------------------------------------------------------------
# static checks
# ---------------------------------------------------------------------------


def test_script_is_syntactically_valid() -> None:
    completed = subprocess.run(["bash", "-n", str(SCRIPT_PATH)], capture_output=True, text=True)
    assert completed.returncode == 0, completed.stderr


def test_script_pins_the_project_and_never_starts_a_stack() -> None:
    """A source-level guard: the two habits that caused the defect stay gone."""

    source = SCRIPT_PATH.read_text()
    assert 'docker compose -p "${PROJECT}"' in source
    for creating in ("up -d ", "compose start", "compose run"):
        for line in source.splitlines():
            stripped = line.strip()
            if stripped.startswith("#") or stripped.startswith("echo "):
                continue  # documented remediation, not an executed command
            assert creating not in stripped, f"stack-creating command survives: {line}"


def test_environment_variable_and_flag_both_select_the_project(
    tmp_path: Path, stub_dir: Path
) -> None:
    """COMPOSE_PROJECT matches scripts/deploy/, and --project outranks it."""

    source = SCRIPT_PATH.read_text()
    assert 'PROJECT="${COMPOSE_PROJECT:-' in source
    assert "--project) PROJECT=" in source

    # The flag is applied after the environment default, so it wins.
    env_index = source.index('PROJECT="${COMPOSE_PROJECT:-')
    flag_index = source.index("--project) PROJECT=")
    assert flag_index > env_index
