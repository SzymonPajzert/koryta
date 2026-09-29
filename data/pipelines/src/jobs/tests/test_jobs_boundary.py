"""The line between pipelines and jobs, where import-linter cannot draw it.

The layers contract keeps `analysis`, `stores`, `scrapers`, `util` and
`entities` from importing `jobs`. It sees only packages, though, and the two
modules that decide what a pipeline run is - `pipelines`, the registry `koryta`
runs from, and `koryta` itself - are top-level modules outside every contract.
"""

import ast
import inspect

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
