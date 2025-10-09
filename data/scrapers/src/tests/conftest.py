import pytest


def pytest_runtest_setup(item):
    skip_funcs = [
        mark.args[0] for mark in item.iter_markers(name="parametrize_skip_if")
    ]
    if any(f(**item.callspec.params) for f in skip_funcs):
        pytest.skip()
