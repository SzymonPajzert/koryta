"""The line between pipelines and jobs, where import-linter cannot draw it.

The layers contract keeps `analysis`, `stores`, `scrapers`, `util` and
`entities` from importing `jobs`. It sees only packages, though, and the two
modules that decide what a pipeline run is - `pipelines`, the registry `koryta`
runs from, and `koryta` itself - are top-level modules outside every contract.
"""

import ast
import importlib
import inspect
import subprocess
import sys
import tomllib
from pathlib import Path

import koryta
import pipelines
from pipelines import PIPELINES


def imported_modules(module) -> set[str]:
    tree = ast.parse(inspect.getsource(module))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


def test_no_job_is_registered_as_a_pipeline():
    assert [p.__name__ for p in PIPELINES if p.__module__.startswith("jobs")] == []


def test_the_pipeline_entry_points_do_not_import_jobs():
    for module in (pipelines, koryta):
        leaked = {m for m in imported_modules(module) if m.split(".")[0] == "jobs"}
        assert leaked == set(), module.__name__


def test_importing_the_pipeline_entry_points_loads_no_job():
    """Nor through what they import: `conductor` is outside every contract too.

    In a fresh interpreter, because this test session has imported jobs itself.
    """
    code = (
        "import sys, koryta, pipelines; "
        "print(sorted(m for m in sys.modules if m.split('.')[0] == 'jobs'))"
    )
    out = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, check=True
    )
    assert out.stdout.strip().splitlines()[-1] == "[]"


def test_every_job_directory_is_a_package():
    """A job without an __init__.py is invisible to import-linter.

    So it is outside every contract, and nothing says so: rejestr_umow and
    custom_scrapers came in that way on 2026-10-26.
    """
    jobs = Path(__file__).resolve().parents[1]
    loose = sorted(
        child.name
        for child in jobs.iterdir()
        if child.is_dir()
        and child.name not in ("tests", "__pycache__")
        and not (child / "__init__.py").is_file()
    )
    assert loose == []


def test_every_console_script_names_a_callable():
    """A job that moves keeps its script name; the target must follow it."""
    pyproject = Path(__file__).resolve().parents[3] / "pyproject.toml"
    scripts = tomllib.loads(pyproject.read_text())["project"]["scripts"]
    broken = []
    for name, target in scripts.items():
        module, _, attr = target.partition(":")
        if not callable(getattr(importlib.import_module(module), attr, None)):
            broken.append(name)
    assert broken == []
