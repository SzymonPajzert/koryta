"""The line between pipelines and jobs, where import-linter cannot draw it.

The layers contract keeps `analysis`, `stores`, `scrapers`, `util` and
`entities` from importing `jobs`. It sees only packages, though, and the two
modules that decide what a pipeline run is - `pipelines`, the registry `koryta`
runs from, and `koryta` itself - are top-level modules outside every contract.
"""

import ast
import importlib
import inspect
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
