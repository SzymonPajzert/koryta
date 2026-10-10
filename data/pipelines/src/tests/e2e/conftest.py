"""Fixtures for the assertions run against a completed pipeline pass.

These tests read `versioned/`, they never run a pipeline themselves -- the run
is a separate CI job whose output they inherit. Locally there is usually no
such output, so a missing file skips; CI sets KORYTA_E2E_STRICT=1 and a missing
file fails there instead.

What they check is bands, not values. Exact counts would go red on every
Wikipedia edit; a count that halves, or a column that stops being populated, is
a real regression. The bands live in baseline.json, which is written by
`KORYTA_E2E_UPDATE_BASELINE=1` from an observed run rather than guessed.
"""

import json
import os
from collections.abc import Iterator
from pathlib import Path

import pandas as pd
import pytest

# Importing this is also what creates versioned/ and downloaded/.
from stores.config import VERSIONED_DIR

BASELINE_PATH = Path(__file__).parent / "baseline.json"

with open(BASELINE_PATH) as _f:
    BASELINE = json.load(_f)

OUTPUTS = BASELINE["outputs"]

# Written next to versioned/ so CI can upload it as an artifact, and so a
# failed run tells you what to put in the baseline.
METRICS_FILENAME = "e2e-metrics.json"


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes"}


def strict() -> bool:
    """Whether a missing pipeline output is a failure rather than a skip."""
    return _flag("KORYTA_E2E_STRICT")


def updating_baseline() -> bool:
    return _flag("KORYTA_E2E_UPDATE_BASELINE")


def tier() -> str:
    """`full` for a whole-dump run, `slice` for a single-shard one.

    A shard holds a fraction of the articles, so its counts say nothing about
    the full run's -- band checks only apply to `full`.
    """
    return os.environ.get("KORYTA_E2E_TIER", "full").strip().lower()


def required_outputs() -> set[str]:
    """Outputs this tier is expected to have produced.

    The slice tier runs the wiki pipeline alone, so demanding the rest of
    versioned/ from it would just be noise -- anything outside this set skips
    when absent, even under KORYTA_E2E_STRICT.
    """
    return set(BASELINE["required"].get(tier(), []))


@pytest.fixture(scope="session")
def baseline() -> dict:
    return BASELINE


@pytest.fixture(scope="session")
def metrics() -> Iterator[dict]:
    """Collects what this run observed, and writes it out at the end.

    With KORYTA_E2E_UPDATE_BASELINE=1 it lands in baseline.json instead, which
    is how the file gets its numbers in the first place.
    """
    collected: dict = {}
    yield collected

    if not collected:
        return

    out = Path(VERSIONED_DIR) / METRICS_FILENAME
    with open(out, "w") as f:
        json.dump(collected, f, indent=2, sort_keys=True)
    print(f"\nWrote observed metrics to {out}")

    if updating_baseline():
        with open(BASELINE_PATH) as f:
            current = json.load(f)
        for name, observed in collected.items():
            current.setdefault("outputs", {}).setdefault(name, {}).update(observed)
        with open(BASELINE_PATH, "w") as f:
            json.dump(current, f, indent=2, sort_keys=True)
            f.write("\n")
        print(f"Updated {BASELINE_PATH}")


def output_path(name: str, fmt: str = "jsonl") -> Path:
    """Where a pipeline writes, mirroring Pipeline.output_path."""
    return Path(VERSIONED_DIR) / name / f"{name}.{fmt}"


@pytest.fixture(scope="session")
def read_output():
    """Reads one pipeline's output, skipping the test if the run didn't make it.

    `dtype` names the columns to read as they are written rather than as
    pandas guesses: a column of KRS numbers and nothing else reads as numbers,
    and loses its leading zeros.
    """

    cache: dict[tuple, pd.DataFrame] = {}

    def read(name: str, fmt: str = "jsonl", dtype: dict | None = None) -> pd.DataFrame:
        key = (name, fmt, tuple(sorted((dtype or {}).items())))
        if key in cache:
            return cache[key]

        path = output_path(name, fmt)
        if not path.exists():
            message = f"{path} is missing -- no pipeline output to check"
            if strict() and name in required_outputs():
                pytest.fail(message)
            pytest.skip(message)

        if fmt == "jsonl":
            df = pd.read_json(path, lines=True, dtype=dtype or True)
        elif fmt == "csv":
            df = pd.read_csv(path, dtype=dtype)
        else:
            raise ValueError(f"Unsupported format {fmt}")

        cache[key] = df
        return df

    return read
