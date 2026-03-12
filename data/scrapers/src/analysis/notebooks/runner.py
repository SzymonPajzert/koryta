import typing

from conductor import _setup_context
from main import Pipeline


def run_pipeline(p_type: typing.Type):
    ctx = _setup_context(False)[0]
    p: Pipeline = Pipeline.create(p_type)
    # TODO remove it, None is needed only for old format
    return None, p.read_or_process(ctx)
