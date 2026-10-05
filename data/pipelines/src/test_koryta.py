"""The runner's --keep-going: one broken pipeline does not stop the rest."""

from unittest.mock import Mock

import pandas as pd
import pytest

from koryta import run_selected
from scrapers.stores import Context, Pipeline, ProcessPolicy


class Breaks(Pipeline):
    filename = "breaks"

    def process(self, ctx: Context):
        raise AttributeError("'Person' object has no attribute 'teryt_candidacy'")


class Builds(Pipeline):
    filename = "builds"

    def process(self, ctx: Context):
        return pd.DataFrame({"a": [1]})


class Printed:
    def __init__(self) -> None:
        self.results: list = []

    def print_results(self, res) -> None:
        self.results.append(res)


def context() -> Mock:
    ctx = Mock(spec=Context)
    ctx.io = Mock()
    ctx.io.dumper = Mock()
    ctx.io.get_mtime.return_value = None
    ctx.refresh_policy = ProcessPolicy.with_default(refresh=["all"])
    return ctx


def run(keep_going: bool, printed: Printed) -> list[str]:
    return run_selected(
        {"Breaks", "Builds"},
        context(),
        printed,
        keep_going=keep_going,
        pipelines=[Breaks, Builds],
    )


def test_without_keep_going_the_first_failure_ends_the_run():
    printed = Printed()

    with pytest.raises(AttributeError):
        run(keep_going=False, printed=printed)
    assert printed.results == []


def test_keep_going_builds_the_rest_and_names_what_failed():
    """The nightly rebuild stopped at the first broken root of ~45 (2026-10-05)."""
    printed = Printed()

    assert run(keep_going=True, printed=printed) == ["Breaks"]
    assert len(printed.results) == 1
